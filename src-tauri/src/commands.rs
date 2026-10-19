use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use burst_types::WalletAddress;
use burst_wallet_core::transaction_builder::*;
use burst_wallet_core::signed_client::parse_address;
use burst_transactions::Transaction;
use burst_types::{Timestamp, TxHash};
use burst_wallet_core::wallet::Wallet;
use burst_wallet_core::{decrypt_keystore, encrypt_keystore, load_keystore, KeystoreFile};
use serde::{Deserialize, Serialize};
use tauri::State;

pub struct WalletState {
    pub(crate) signing: tokio::sync::Mutex<()>,
    pub(crate) offline_directory: OnceLock<PathBuf>,
    pub(crate) profile_access: OnceLock<crate::profile_access::ProfileAccess>,
    automation: Mutex<AutomationSessions>,
    automation_changed: tokio::sync::Notify,
    pending_scan: Mutex<(String, Option<String>)>,
    wallet: Mutex<Option<Wallet>>,
    watch_address: Mutex<Option<WalletAddress>>,
    keystore: Mutex<Option<KeystoreFile>>,
}

impl Default for WalletState {
    fn default() -> Self {
        Self {
            signing: tokio::sync::Mutex::new(()),
            offline_directory: OnceLock::new(),
            profile_access: OnceLock::new(),
            automation: Mutex::new(AutomationSessions::default()),
            automation_changed: tokio::sync::Notify::new(),
            pending_scan: Mutex::new((String::new(), None)),
            wallet: Mutex::new(None),
            watch_address: Mutex::new(None),
            keystore: Mutex::new(None),
        }
    }
}

#[derive(Default)]
struct AutomationSessions {
    issued: u64,
    active: Option<u64>,
}

impl AutomationSessions {
    fn begin(&mut self) -> Result<String, String> {
        self.issued = self.issued.checked_add(1).ok_or("Automation session limit reached")?;
        self.active = Some(self.issued);
        Ok(self.issued.to_string())
    }

    fn cancel(&mut self, session: u64) {
        if self.active == Some(session) { self.active = None; }
    }
}

fn parse_automation_session(value: &str) -> Result<u64, String> {
    let token = value.parse::<u64>().map_err(|_|"Invalid automation session")?;
    if token == 0 || token.to_string() != value { return Err("Invalid automation session".into()); }
    Ok(token)
}

#[tauri::command]
pub fn begin_automation(state: State<'_, WalletState>) -> Result<String, String> {
    require_writable_session(&state)?;
    let token=state.automation.lock().map_err(|_|"Automation state unavailable")?.begin()?;
    state.automation_changed.notify_waiters();
    Ok(token)
}

#[tauri::command]
pub fn cancel_automation(session: String, state: State<'_, WalletState>) -> Result<(), String> {
    let token=parse_automation_session(&session)?;
    let mut sessions=state.automation.lock().map_err(|_|"Automation state unavailable")?;
    if sessions.active==Some(token) {sessions.cancel(token);state.automation_changed.notify_waiters();}
    Ok(())
}

pub(crate) fn stop_automation(state: &WalletState) -> Result<(), String> {
    state.automation.lock().map_err(|_|"Automation state unavailable")?.active=None;
    state.automation_changed.notify_waiters();
    Ok(())
}

async fn automation_read<T>(state: &WalletState, session: u64, read: impl std::future::Future<Output=Result<T,String>>) -> Result<T,String> {
    let changed=state.automation_changed.notified();
    tokio::pin!(changed);
    changed.as_mut().enable();
    check_automation_session(state,session)?;
    tokio::select! {
        biased;
        _=&mut changed => Err("Automation settings changed; remaining payments were not submitted".into()),
        result=read => result,
    }
}

fn check_automation_session(state: &WalletState, session: u64) -> Result<(), String> {
    if state.automation.lock().map_err(|_|"Automation state unavailable")?.active != Some(session) {
        return Err("Automation settings changed; remaining payments were not submitted".into());
    }
    Ok(())
}

#[cfg(test)]
mod automation_session_tests {
    use super::*;

    #[test]
    fn cancellation_is_scoped_and_old_sessions_never_become_current_again() {
        let state = WalletState::default();
        let first = state.automation.lock().unwrap().begin().unwrap();
        let first = parse_automation_session(&first).unwrap();
        assert!(check_automation_session(&state,first).is_ok());
        let second = state.automation.lock().unwrap().begin().unwrap();
        let second = parse_automation_session(&second).unwrap();
        state.automation.lock().unwrap().cancel(first);
        assert!(check_automation_session(&state,first).is_err());
        assert!(check_automation_session(&state,second).is_ok());
        state.automation.lock().unwrap().cancel(second);
        assert!(check_automation_session(&state,second).is_err());
        let third = state.automation.lock().unwrap().begin().unwrap();
        assert!(parse_automation_session(&third).unwrap()>second);
    }

    #[test]
    fn invalid_tokens_and_counter_exhaustion_fail_closed() {
        for token in ["", "0", "01", "-1", "1.5", "18446744073709551616"] {
            assert!(parse_automation_session(token).is_err());
        }
        let mut sessions = AutomationSessions {issued:u64::MAX,active:None};
        assert!(sessions.begin().is_err());
        assert_eq!(sessions.active,None);
    }
}

// ── Response types ──────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct WalletInfo {
    pub address: String,
    pub verification_state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recovery_phrase: Option<String>,
    pub watch_only: bool,
}

#[derive(Debug, Serialize)]
pub struct TrstBalance {
    pub active: String,
    pub expired: String,
    pub revoked: String,
    pub pending: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct TxResult {
    pub hash: String,
    pub accepted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AccountInfoResponse {
    pub address: String,
    #[serde(default)]
    pub head: String,
    pub brn_balance: String,
    pub trst_balance: String,
    #[serde(default)]
    pub trst_expired: String,
    #[serde(default)]
    pub trst_revoked: String,
    #[serde(default)]
    pub total_brn_burned: String,
    #[serde(default)]
    pub total_brn_staked: String,
    pub verification_state: String,
    #[serde(default)]
    pub verified_at: Option<u64>,
    pub block_count: u64,
    #[serde(default)]
    pub confirmation_height: u64,
    pub representative: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub hash: String,
    pub block_type: String,
    pub account: String,
    pub amount: String,
    pub timestamp: u64,
    #[serde(default)]
    pub origin: Option<String>,
    #[serde(default)]
    pub link: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AccountHistory {
    pub account: String,
    pub history: Vec<HistoryEntry>,
    #[serde(default)]
    pub cursor: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PendingEntry {
    pub hash: String,
    pub source: String,
    pub amount: String,
    #[serde(default)]
    pub block_type: String,
    #[serde(default)]
    pub return_credit: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PendingResult {
    #[serde(rename(deserialize = "pending"))]
    pub blocks: Vec<PendingEntry>,
    #[serde(default)]
    pub cursor: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TrstBatch {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub origin_kind: Option<String>,
    pub origin: String,
    pub amount: String,
    pub originator: String,
    pub timestamp: u64,
    pub expiry_at: Option<u64>,
    #[serde(default)]
    pub reference_value_bps: Option<u16>,
    pub status: String,
    pub chain_length: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TrstPortfolio {
    pub batches: Vec<TrstBatch>,
    pub total_active: String,
    pub total_expired: String,
    pub total_revoked: String,
    #[serde(default)]
    pub total_pending: Option<String>,
}

#[cfg(test)]
mod portfolio_reference_tests {
    use super::TrstBatch;

    #[test]
    fn reference_is_preserved_and_older_nodes_remain_readable() {
        let mut value = serde_json::json!({"origin":"a", "amount":"1000",
            "originator":"brst_creator", "timestamp":100, "expiry_at":200,
            "status":"active", "chain_length":null});
        let old: TrstBatch = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(old.reference_value_bps, None);
        for bps in [0, 5000, 10000] {
            value["reference_value_bps"] = serde_json::json!(bps);
            let batch: TrstBatch = serde_json::from_value(value.clone()).unwrap();
            assert_eq!(batch.reference_value_bps, Some(bps));
            assert_eq!(batch.amount, "1000");
            assert_eq!(serde_json::to_value(batch).unwrap()["reference_value_bps"], bps);
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct VerificationStatus {
    #[serde(alias = "status")]
    pub state: String,
    pub verified_at: Option<u64>,
    #[serde(alias = "endorser_count")]
    pub endorsement_count: u32,
    pub endorsement_threshold: u32,
    #[serde(default)]
    pub endorsers: Vec<String>,
    #[serde(default)]
    pub verifier_votes: Vec<VerifierVote>,
    #[serde(default)]
    pub challenge_active: bool,
    #[serde(default)]
    pub selection_available: Option<bool>,
    #[serde(default)]
    pub verifier_opted_in: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct VerifierVote {
    pub verifier: String,
    pub vote: String,
    pub timestamp: u64,
}

#[cfg(test)]
mod verification_status_tests {
    use super::{TrstBatch, VerificationStatus};

    #[test]
    fn selected_panel_review_accepts_unchanged_terms_and_rejects_changed_or_closed_terms() {
        let review = super::VerificationReview {
            target: "target".into(), selection_context: Some("context".into()),
            phase: Some("voting".into()), enabled: true, selected: true, voted: false,
            stake: "500000000000000000001".into(), params_hash: "rules".into(),
        };
        assert!(review.matches_current(&review));
        for index in 0..8 {
            let mut changed = review.clone();
            match index {
                0 => changed.selection_context = None,
                1 => changed.selection_context = Some("new round".into()),
                2 => changed.stake = "500000000000000000002".into(),
                3 => changed.params_hash = "new rules".into(),
                4 => changed.enabled = false,
                5 => changed.selected = false,
                6 => changed.voted = true,
                _ => changed.phase = Some("verified".into()),
            }
            assert!(!review.matches_current(&changed));
            if index == 0 || index >= 4 { assert!(!changed.matches_current(&changed)); }
        }
        let mut challenge = review.clone();
        challenge.phase = Some("challenged".into());
        assert!(challenge.matches_current(&challenge));
    }

    #[test]
    fn participation_preserves_true_false_and_unknown_from_node() {
        for participation in [Some(true), Some(false), None] {
            let mut response = serde_json::json!({"status":"verified", "endorser_count":0, "endorsement_threshold":3});
            if let Some(value) = participation { response["verifier_opted_in"] = value.into(); }
            let parsed: VerificationStatus = serde_json::from_value(response).unwrap();
            assert_eq!(parsed.verifier_opted_in, participation);
            assert_eq!(serde_json::to_value(parsed).unwrap()["verifier_opted_in"], serde_json::json!(participation));
        }
    }

    #[test]
    fn pending_pages_are_bounded_and_malformed_responses_are_not_empty_wallets() {
        let address=burst_wallet_core::Wallet::from_seed(&[77;32]).address;
        let entry=serde_json::json!({"hash":"ab".repeat(32),"source":address.as_str(),"amount":"17"});
        let valid=super::parse_pending_page(serde_json::json!({"pending":[entry.clone()],"cursor":"next"}),None).unwrap();
        assert_eq!(valid.blocks.len(),1);
        assert!(!valid.blocks[0].return_credit);
        assert_eq!(valid.cursor.as_deref(),Some("next"));
        let serialized=serde_json::to_value(valid).unwrap();
        assert!(serialized.get("blocks").is_some());
        assert!(serialized.get("pending").is_none());
        let mut returned=entry.clone();
        returned["return_credit"]=serde_json::json!(true);
        let returned=super::parse_pending_page(serde_json::json!({"pending":[returned]}),None).unwrap();
        assert!(returned.blocks[0].return_credit);
        assert_eq!(serde_json::to_value(returned).unwrap()["blocks"][0]["return_credit"],true);
        assert!(super::parse_pending_page(serde_json::json!({"pending":[]}),None).unwrap().blocks.is_empty());
        for value in [serde_json::json!({}),serde_json::json!({"pending":null}),
            serde_json::json!({"pending":[entry.clone(),entry.clone()]}),
            serde_json::json!({"pending":[{"hash":"bad","source":address.as_str(),"amount":"17"}]}),
            serde_json::json!({"pending":[{"hash":"ab".repeat(32),"source":"bad","amount":"17"}]}),
            serde_json::json!({"pending":[{"hash":"ab".repeat(32),"source":address.as_str(),"amount":"not-a-number"}]}),
            serde_json::json!({"pending":[entry.clone()],"cursor":""}),
            serde_json::json!({"pending":vec![entry.clone();21]})] {
            assert!(super::parse_pending_page(value,None).is_err());
        }
        assert!(super::parse_pending_page(serde_json::json!({"pending":[entry],"cursor":"next"}),Some("next")).is_err());
    }

    #[test]
    fn portfolio_keeps_holding_identity_and_does_not_guess_legacy_origin_kind() {
        for kind in [Some("burn"), Some("merge"), None] {
            let mut response = serde_json::json!({
                "id":"holding", "origin":"origin", "originator":"brst_fixture",
                "amount":"17", "timestamp":1700000000, "expiry_at":null,
                "status":"active", "chain_length":null,
            });
            if let Some(kind) = kind { response["origin_kind"] = kind.into(); }
            let batch: TrstBatch = serde_json::from_value(response).unwrap();
            assert_eq!(batch.id.as_deref(), Some("holding"));
            assert_eq!(batch.origin_kind.as_deref(), kind);
            let forwarded = serde_json::to_value(batch).unwrap();
            assert_eq!(forwarded["id"], "holding");
            assert_eq!(forwarded["origin_kind"], serde_json::json!(kind));
        }
    }

    #[test]
    fn selection_capability_survives_the_native_adapter() {
        for capability in [Some(true), Some(false), None] {
            let mut response = serde_json::json!({
                "status": "verified",
                "endorser_count": 3,
                "endorsement_threshold": 3,
            });
            if let Some(available) = capability {
                response["selection_available"] = available.into();
            }
            let status: VerificationStatus = serde_json::from_value(response).unwrap();
            assert_eq!(status.selection_available, capability);
            let forwarded = serde_json::to_value(status).unwrap();
            assert_eq!(forwarded["selection_available"], serde_json::json!(capability));
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DelegationInfo {
    pub delegated_to: Option<String>,
    pub delegated_from: Vec<String>,
}

// ── Helpers ─────────────────────────────────────────────────────────────

async fn rpc_call(url: &str, body: serde_json::Value) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let resp = client
        .post(url)
        .timeout(std::time::Duration::from_secs(10))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("RPC request failed: {e}"))?;
    let resp = resp.error_for_status().map_err(|e| format!("RPC HTTP error: {e}"))?;
    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Invalid JSON response: {e}"))?;
    if let Some(err) = json.get("error").and_then(|e| e.as_str()) {
        return Err(format!("Node error: {err}"));
    }
    Ok(json.get("result").cloned().unwrap_or(json))
}

fn wallet_info(wallet: &Wallet) -> WalletInfo {
    WalletInfo {
        address: wallet.address.to_string(),
        verification_state: format!("{:?}", wallet.state),
        recovery_phrase: None,
        watch_only: false,
    }
}

pub(crate) fn get_wallet_address(state: &WalletState) -> Result<String, String> {
    let guard = state.wallet.lock().unwrap();
    if let Some(wallet) = guard.as_ref() {
        return Ok(wallet.address.to_string());
    }
    state.watch_address.lock().map_err(|_| "Wallet access unavailable")?
        .as_ref().map(ToString::to_string).ok_or("Wallet not loaded".into())
}

fn select_watch_account(state: &WalletState, address: &str) -> Result<WalletInfo, String> {
    let address = parse_address(address.trim()).map_err(|e| e.to_string())?;
    // Callers serialize account changes with the signing mutex.
    *state.wallet.lock().map_err(|_| "Wallet access unavailable")? = None;
    *state.keystore.lock().map_err(|_| "Wallet access unavailable")? = None;
    *state.watch_address.lock().map_err(|_| "Wallet access unavailable")? = Some(address.clone());
    Ok(WalletInfo { address: address.to_string(), verification_state: "Unknown".into(), recovery_phrase: None, watch_only: true })
}

#[tauri::command]
pub async fn watch_wallet(address: String, state: State<'_, WalletState>) -> Result<WalletInfo, String> {
    stop_automation(&state)?;
    let _signing = state.signing.lock().await;
    select_watch_account(&state, &address)
}

pub(crate) fn require_writable_session(state: &WalletState) -> Result<(), String> {
    if state.watch_address.lock().map_err(|_| "Wallet access unavailable")?.is_some() {
        return Err("This wallet is view only. Use your signing device to make changes.".into());
    }
    Ok(())
}


// ── Wallet management ───────────────────────────────────────────────────

#[tauri::command]
pub async fn get_node_info(rpc_url: String) -> Result<serde_json::Value, String> {
    rpc_call(&rpc_url, serde_json::json!({"action": "node_info"})).await
}

#[tauri::command]
pub async fn create_wallet(state: State<'_, WalletState>) -> Result<WalletInfo, String> {
    stop_automation(&state)?;
    let _signing = state.signing.lock().await;
    let (wallet, phrase) = Wallet::create_with_mnemonic().map_err(|e| format!("{e}"))?;
    let mut info = wallet_info(&wallet);
    info.recovery_phrase = Some(phrase);
    *state.keystore.lock().unwrap() = None;
    *state.wallet.lock().unwrap() = Some(wallet);
    *state.watch_address.lock().unwrap() = None;
    Ok(info)
}

#[tauri::command]
pub async fn import_mnemonic(
    phrase: String,
    state: State<'_, WalletState>,
) -> Result<WalletInfo, String> {
    stop_automation(&state)?;
    let _signing = state.signing.lock().await;
    let wallet = Wallet::from_mnemonic(&phrase).map_err(|e| format!("{e}"))?;
    *state.keystore.lock().unwrap() = None;
    let info = wallet_info(&wallet);
    *state.wallet.lock().unwrap() = Some(wallet);
    *state.watch_address.lock().unwrap() = None;
    Ok(info)
}

#[tauri::command]
pub async fn import_private_key(
    hex_key: String,
    state: State<'_, WalletState>,
) -> Result<WalletInfo, String> {
    stop_automation(&state)?;
    let _signing = state.signing.lock().await;
    let bytes = hex::decode(&hex_key).map_err(|e| format!("Invalid hex: {e}"))?;
    let wallet = Wallet::from_private_key(&bytes).map_err(|e| format!("{e}"))?;
    *state.keystore.lock().unwrap() = None;
    let info = wallet_info(&wallet);
    *state.wallet.lock().unwrap() = Some(wallet);
    *state.watch_address.lock().unwrap() = None;
    Ok(info)
}

#[tauri::command]
pub async fn lock_wallet(state: State<'_, WalletState>) -> Result<(), String> {
    stop_automation(&state)?;
    let _signing = state.signing.lock().await;
    *state.wallet.lock().unwrap() = None;
    *state.watch_address.lock().unwrap() = None;
    Ok(())
}

#[tauri::command]
pub async fn unlock_wallet(
    password: String,
    state: State<'_, WalletState>,
) -> Result<WalletInfo, String> {
    let _signing = state.signing.lock().await;
    let keystore = {
        let ks = state.keystore.lock().unwrap();
        ks.as_ref().ok_or("No keystore loaded")?.clone()
    };
    let secret = decrypt_keystore(&keystore, &password).map_err(|e| format!("{e}"))?;
    let wallet = Wallet::from_seed(&secret);
    let info = wallet_info(&wallet);
    *state.wallet.lock().unwrap() = Some(wallet);
    *state.watch_address.lock().unwrap() = None;
    Ok(info)
}

#[tauri::command]
pub async fn save_keystore(
    password: String,
    path: String,
    state: State<'_, WalletState>,
) -> Result<(), String> {
    let _signing = state.signing.lock().await;
    let private_key = {
        let guard = state.wallet.lock().unwrap();
        let wallet = guard.as_ref().ok_or("Wallet not loaded")?;
        wallet.primary_keys.private.0
    };
    let keystore = encrypt_keystore(&private_key, &password).map_err(|e| format!("{e}"))?;
    burst_wallet_core::save_keystore(&keystore, &PathBuf::from(&path))
        .map_err(|e| format!("{e}"))?;
    *state.keystore.lock().unwrap() = Some(keystore);
    Ok(())
}

#[tauri::command]
pub async fn load_keystore_cmd(
    path: String,
    state: State<'_, WalletState>,
) -> Result<bool, String> {
    stop_automation(&state)?;
    let _signing = state.signing.lock().await;
    let keystore = load_keystore(&PathBuf::from(&path)).map_err(|e| format!("{e}"))?;
    *state.wallet.lock().unwrap() = None;
    *state.keystore.lock().unwrap() = Some(keystore);
    *state.watch_address.lock().unwrap() = None;
    Ok(true)
}

#[tauri::command]
pub async fn get_address(state: State<'_, WalletState>) -> Result<String, String> {
    get_wallet_address(&state)
}

#[tauri::command]
pub async fn is_locked(state: State<'_, WalletState>) -> Result<bool, String> {
    Ok(state.wallet.lock().unwrap().is_none() && state.watch_address.lock().unwrap().is_none())
}

// ── Balance queries ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_brn_components(rpc_url: String, state: State<'_, WalletState>) -> Result<serde_json::Value, String> {
    let account = get_wallet_address(&state)?;
    match rpc_call(&rpc_url, serde_json::json!({"action":"brn_components", "account":account})).await {
        Err(error) if error.starts_with("Node error: account not found:") => Ok(serde_json::json!({
            "verified_at":0, "total_burned":"0", "total_staked":"0", "accrual_active":false,
            "accrual_stopped_at":0, "as_of":Timestamp::now().as_secs(), "rate_history":[]
        })),
        result => result,
    }
}

#[tauri::command]
pub async fn get_brn_balance(
    rpc_url: String,
    state: State<'_, WalletState>,
) -> Result<String, String> {
    let account = get_wallet_address(&state)?;
    let result = rpc_call(
        &rpc_url,
        serde_json::json!({"action": "account_balance", "account": account}),
    )
    .await?;
    result
        .get("brn_balance")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "Missing brn_balance field".to_string())
}

#[tauri::command]
pub async fn get_trst_balance(
    rpc_url: String,
    state: State<'_, WalletState>,
) -> Result<TrstBalance, String> {
    let portfolio = get_trst_portfolio(rpc_url, state).await?;
    Ok(TrstBalance { active: portfolio.total_active, expired: portfolio.total_expired, revoked: portfolio.total_revoked, pending: portfolio.total_pending })
}

#[tauri::command]
pub async fn get_account_info(
    rpc_url: String,
    state: State<'_, WalletState>,
) -> Result<AccountInfoResponse, String> {
    let account = get_wallet_address(&state)?;
    let result = match rpc_call(
        &rpc_url,
        serde_json::json!({"action": "account_info", "account": account}),
    )
    .await {
        Ok(value) => value,
        Err(error) if error.starts_with("Node error: account not found:") => serde_json::json!({
            "address":account, "head":"0".repeat(64), "brn_balance":"0", "trst_balance":"0",
            "trst_expired":"0", "trst_revoked":"0", "total_brn_burned":"0", "total_brn_staked":"0",
            "verification_state":"unverified", "verified_at":null, "block_count":0,
            "confirmation_height":0, "representative":account
        }),
        Err(error) => return Err(error),
    };
    serde_json::from_value(result).map_err(|e| format!("Parse error: {e}"))
}

// ── TRST Portfolio ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_trst_portfolio(
    rpc_url: String,
    state: State<'_, WalletState>,
) -> Result<TrstPortfolio, String> {
    let account = get_wallet_address(&state)?;
    let result = rpc_call(
        &rpc_url,
        serde_json::json!({"action": "trst_portfolio", "account": account}),
    )
    .await?;
    serde_json::from_value(result).map_err(|e| format!("Parse error: {e}"))
}

// ── Transactions ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_trst_origins(
    rpc_url: String,
    origin: String,
) -> Result<burst_wallet_core::provenance::OriginReport, String> {
    let client = burst_wallet_core::NodeClient::new(rpc_url).map_err(|e| e.to_string())?;
    client.trst_origins(&origin).await.map_err(|e| e.to_string())
}

/// Public origin inspection does not load keys or sign a receive block.
#[tauri::command]
pub async fn get_payment_origins(
    rpc_url: String,
    payment: String,
) -> Result<burst_wallet_core::provenance::PaymentOrigins, String> {
    let client = burst_wallet_core::NodeClient::new(rpc_url).map_err(|e| e.to_string())?;
    client.payment_origins(&payment).await.map_err(|e| e.to_string())
}

/// Signing material stays inside the native process, never sent over RPC.
pub(crate) fn signing_keys(state: &WalletState) -> Result<burst_types::KeyPair, String> {
    let keys = takeover_keys(state)?;
    require_enrolled_device(state, &keys)?;
    Ok(keys)
}

fn require_enrolled_device(state: &WalletState, keys: &burst_types::KeyPair) -> Result<(), String> {
    if state.offline_directory.get().is_some() {
        let account = burst_crypto::derive_address(&keys.public);
        if crate::signing_device::grant(state, account.as_str())?.is_zero() {
            return Err("Set up this signing device in Settings → Security before signing.".into());
        }
    }
    Ok(())
}

/// Root material may authorize a reviewed takeover without an existing role.
pub(crate) fn takeover_keys(state: &WalletState) -> Result<burst_types::KeyPair, String> {
    require_writable_session(state)?;
    if let Some(access) = state.profile_access.get() { access.require_signer()?; }
    let guard = state.wallet.lock().map_err(|_| "Wallet lock unavailable")?;
    let wallet = guard.as_ref().ok_or("Wallet not loaded")?;
    if let Some(directory) = state.offline_directory.get() {
        let account = burst_crypto::derive_address(&wallet.primary_keys.public);
        let path = directory.join(format!("{}.json", account.as_str()));
        match std::fs::symlink_metadata(path) {
            Ok(_) => return Err("A saved offline payment needs recovery before signing another transaction.".into()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {},
            Err(error) => return Err(format!("Cannot check pending offline payment: {error}")),
        }
    }
    Ok(burst_types::KeyPair {
        public: wallet.primary_keys.public.clone(),
        private: burst_types::PrivateKey(wallet.primary_keys.private.0),
    })
}

#[cfg(test)]
mod offline_reservation_tests {
    use super::*;

    fn restored(directory: &std::path::Path, seed: u8) -> WalletState {
        let state = WalletState::default();
        state.offline_directory.set(directory.to_path_buf()).unwrap();
        *state.wallet.lock().unwrap() = Some(Wallet::from_seed(&[seed; 32]));
        state
    }

    // Unit fixture only; this does not establish network confirmation.
    pub(super) fn bind_test_device(state: &WalletState) {
        let keys = takeover_keys(state).unwrap();
        let account = burst_crypto::derive_address(&keys.public);
        let context = AccountState {
            signing_grant: burst_types::BlockHash::ZERO, payment_epoch: burst_types::BlockHash::new([1;32]),
            head: burst_types::BlockHash::new([2;32]), block_count: 1, representative: account.clone(),
            brn_balance: 0, trst_balance: 0, release_sources: vec![],
        };
        let block = sign_state_block(build_signing_handoff(&context, &account,
            burst_types::BlockHash::new([3;32]), burst_types::BlockHash::new([4;32]), Timestamp::new(100)).unwrap(), &keys.private);
        crate::signing_device::activate_confirmed(state, &block).unwrap();
    }

    #[test]
    fn device_enrollment_is_required_and_a_confirmed_local_binding_enables_signing() {
        let directory = tempfile::tempdir().unwrap();
        let state = restored(directory.path(), 18);
        assert!(signing_keys(&state).err().unwrap().contains("Set up this signing device"));
        bind_test_device(&state);
        assert!(signing_keys(&state).is_ok());
        drop(state);
        assert!(signing_keys(&restored(directory.path(), 18)).is_ok());
        let other = tempfile::tempdir().unwrap();
        assert!(signing_keys(&restored(other.path(), 18)).is_err());
    }

    #[test]
    fn device_binding_migration_preserves_role_and_allows_receipt_marker_cleanup() {
        let directory = tempfile::tempdir().unwrap();
        let state = restored(directory.path(), 18);
        bind_test_device(&state);
        let account = get_wallet_address(&state).unwrap();
        let path = directory.path().join("devices").join(format!("{account}.json"));
        let original = std::fs::read(&path).unwrap();
        let block: burst_ledger::StateBlock = serde_json::from_slice(&original).unwrap();
        let legacy = directory.path().join(format!("device-{account}.json"));
        std::fs::rename(&path, &legacy).unwrap();
        crate::signing_device::migrate_bindings(directory.path()).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), original);
        assert!(!legacy.exists());
        assert!(signing_keys(&state).is_ok());
        // Interrupted migration may leave both names. Reopen completes it.
        std::fs::hard_link(&path, &legacy).unwrap();
        crate::signing_device::migrate_bindings(directory.path()).unwrap();
        assert!(!legacy.exists());
        let pending = directory.path().join(format!("{account}.json"));
        burst_wallet_core::offline::save_signed_action(&pending, &block, &[], None).unwrap();
        let marker = directory.path().join(format!("attempted-{}.marker", block.hash));
        std::fs::write(&marker, b"1\n").unwrap();
        burst_wallet_core::offline::archive_payment(&pending, "confirmed").unwrap();
        assert!(!marker.exists(), "binding must not obstruct completed-receipt maintenance");
        assert_eq!(std::fs::read(&path).unwrap(), original);
    }

    #[test]
    fn device_binding_migration_preserves_conflicting_or_corrupt_files() {
        let directory = tempfile::tempdir().unwrap();
        let state = restored(directory.path(), 18);
        bind_test_device(&state);
        let account = get_wallet_address(&state).unwrap();
        let path = directory.path().join("devices").join(format!("{account}.json"));
        let original = std::fs::read(&path).unwrap();
        let legacy = directory.path().join(format!("device-{account}.json"));
        std::fs::write(&legacy, &original).unwrap();
        std::fs::write(&path, b"interrupted binding").unwrap();
        assert!(crate::signing_device::migrate_bindings(directory.path()).is_err());
        assert_eq!(std::fs::read(&legacy).unwrap(), original);
        assert_eq!(std::fs::read(&path).unwrap(), b"interrupted binding");
        assert!(signing_keys(&state).is_err());
    }

    #[test]
    fn watch_wallet_reads_public_account_without_retaining_signing_keys() {
        let directory = tempfile::tempdir().unwrap();
        let state = restored(directory.path(), 18);
        *state.keystore.lock().unwrap() = Some(encrypt_keystore(&[18; 32], "disposable test password").unwrap());
        let address = get_wallet_address(&state).unwrap();
        let journal = directory.path().join(format!("{address}.json"));
        std::fs::write(&journal, b"retained pending transaction").unwrap();
        let info = select_watch_account(&state, &address).unwrap();
        assert!(info.watch_only);
        assert!(info.recovery_phrase.is_none());
        assert_eq!(get_wallet_address(&state).unwrap(), address);
        assert!(state.wallet.lock().unwrap().is_none());
        assert!(state.keystore.lock().unwrap().is_none());
        assert!(signing_keys(&state).err().unwrap().contains("view only"));
        assert!(require_writable_session(&state).is_err());
        assert_eq!(std::fs::read(journal).unwrap(), b"retained pending transaction");
        let independent = WalletState::default();
        select_watch_account(&independent, &address).unwrap();
        assert_eq!(get_wallet_address(&independent).unwrap(), address);
        assert!(signing_keys(&independent).is_err());
        // Watch-only selection never persists account or session authority.
        assert!(get_wallet_address(&WalletState::default()).is_err());
    }

    #[test]
    fn watch_wallet_invalid_address_does_not_replace_the_open_account() {
        let directory = tempfile::tempdir().unwrap();
        let state = restored(directory.path(), 18);
        let address = get_wallet_address(&state).unwrap();
        for invalid in ["", "brst_invalid", "do not accept recovery words here"] {
            assert!(select_watch_account(&state, invalid).is_err());
            assert_eq!(get_wallet_address(&state).unwrap(), address);
            assert!(takeover_keys(&state).is_ok());
            assert!(signing_keys(&state).err().unwrap().contains("Set up this signing device"));
        }
    }

    #[test]
    fn offline_reservation_survives_wallet_restore_and_blocks_all_key_access() {
        let directory = tempfile::tempdir().unwrap();
        let state = restored(directory.path(), 18);
        let keys = takeover_keys(&state).unwrap();
        let address = burst_crypto::derive_address(&keys.public);
        let path = directory.path().join(format!("{}.json", address.as_str()));
        // Even corrupt/incomplete stored state must not silently unlock signing.
        std::fs::write(&path, b"interrupted draft").unwrap();
        assert!(signing_keys(&state).err().unwrap().contains("saved offline payment"));
        assert!(reviewed_signing_keys(&state, address.as_str()).is_err());
        drop(state);
        let reopened = restored(directory.path(), 18);
        assert!(signing_keys(&reopened).is_err());
        assert!(takeover_keys(&restored(directory.path(), 19)).is_ok());
        assert_eq!(std::fs::read(path).unwrap(), b"interrupted draft");
    }

    #[test]
    fn unreadable_reservation_directory_fails_closed() {
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join("not-a-directory");
        std::fs::write(&file, b"occupied").unwrap();
        let state = restored(&file, 18);
        assert!(signing_keys(&state).err().unwrap().contains("Cannot check pending"));
    }

    #[test]
    fn profile_access_secondary_wallet_keeps_reads_but_cannot_sign() {
        let directory = tempfile::tempdir().unwrap();
        let first = restored(directory.path(), 18);
        let second = restored(directory.path(), 18);
        assert!(first.profile_access.set(crate::profile_access::ProfileAccess::open(directory.path()).unwrap()).is_ok());
        assert!(second.profile_access.set(crate::profile_access::ProfileAccess::open(directory.path()).unwrap()).is_ok());
        assert_eq!(get_wallet_address(&first).unwrap(), get_wallet_address(&second).unwrap());
        assert!(takeover_keys(&first).is_ok());
        assert!(signing_keys(&first).err().unwrap().contains("Set up this signing device"));
        assert!(signing_keys(&second).err().unwrap().contains("read-only"));
        drop(first);
        assert!(signing_keys(&second).is_err());
    }
}

/// The caller holds `signing` through validation and submission.
fn reviewed_signing_keys(state: &WalletState, expected: &str) -> Result<burst_types::KeyPair, String> {
    let keys = takeover_keys(state)?;
    if burst_crypto::derive_address(&keys.public).as_str() != expected {
        return Err("Your wallet changed. Review this action again.".into());
    }
    require_enrolled_device(state, &keys)?;
    Ok(keys)
}

pub(crate) fn journaled_client(state: &WalletState, rpc_url: &str, expected_account: &str) -> Result<burst_wallet_core::NodeClient, String> {
    let path = crate::offline::draft_path(state, expected_account)?;
    let grant = crate::signing_device::grant(state, expected_account)?;
    burst_wallet_core::NodeClient::new(rpc_url).map(|client| client.with_payment_journal(path).with_signing_grant(grant))
        .map_err(|error| error.to_string())
}

async fn submit_wallet_action<F>(state: &WalletState, rpc_url: &str, expected_account: &str, build: F) -> Result<TxResult, String>
where F: FnOnce(&WalletAddress) -> Result<Transaction, burst_wallet_core::WalletError> {
    stop_automation(state)?;
    let _guard = state.signing.lock().await;
    let keys = reviewed_signing_keys(state, expected_account)?;
    let account = burst_crypto::derive_address(&keys.public);
    let transaction = build(&account).map_err(|e| e.to_string())?;
    let node = journaled_client(state, rpc_url, expected_account)?;
    node.submit_signed(&keys, &transaction, TxHash::ZERO).await.map(tx_result).map_err(|e| e.to_string())
}

pub(crate) fn tx_result(result: burst_wallet_core::wallet::ProcessResult) -> TxResult {
    TxResult { hash: result.hash, accepted: result.accepted, detail: result.detail }
}

/// Pay burns BRN 1:1; the provider must accept the resulting pending TRST.
#[tauri::command]
pub async fn pay(rpc_url: String, provider: String, amount: String, expected_account: String, state: State<'_, WalletState>) -> Result<TxResult, String> {
    stop_automation(&state)?;
    let _signing = state.signing.lock().await;
    let keys = reviewed_signing_keys(&state, &expected_account)?;
    let client = journaled_client(&state, &rpc_url, &expected_account)?;
    let amount = amount.parse::<u128>().map_err(|_| "Invalid raw amount")?;
    client.pay_signed(&keys, &parse_address(&provider).map_err(|e|e.to_string())?, amount).await.map(tx_result).map_err(|e|e.to_string())
}

/// Transfer one origin at a time; never silently discard provenance or merge
/// batches with different expiry dates to satisfy an aggregate balance.
#[tauri::command]
pub async fn transfer_trst(rpc_url: String, to: String, amount: String, origin: Option<String>, expected_account: String, state: State<'_, WalletState>) -> Result<TxResult, String> {
    stop_automation(&state)?;
    let _signing = state.signing.lock().await;
    let keys = reviewed_signing_keys(&state, &expected_account)?;
    let account = burst_crypto::derive_address(&keys.public);
    let client = journaled_client(&state, &rpc_url, &expected_account)?;
    let amount = amount.parse::<u128>().map_err(|_| "Invalid raw amount")?;
    let portfolio = client.rpc_call("trst_portfolio", serde_json::json!({"account":account})).await.map_err(|e|e.to_string())?;
    let batches = portfolio["batches"].as_array().ok_or("Missing TRST portfolio")?;
    let origin = burst_wallet_core::portfolio::select_transfer_origin(batches, amount, origin.as_deref())?;
    client.transfer_signed(&keys, &parse_address(&to).map_err(|e|e.to_string())?, amount, origin).await.map(tx_result).map_err(|e|e.to_string())
}

#[tauri::command]
pub async fn receive_pending(rpc_url: String, hash: String, expected_account: String, state: State<'_, WalletState>) -> Result<TxResult, String> {
    stop_automation(&state)?;
    let _signing = state.signing.lock().await;
    let keys = reviewed_signing_keys(&state, &expected_account)?;
    let client = journaled_client(&state, &rpc_url, &expected_account)?;
    client.receive_signed(&keys, &hash).await.map(tx_result).map_err(|e|e.to_string())
}

use burst_wallet_core::portfolio::{reviewed_merge_sources, MergeSelection};

#[cfg(test)]
mod merge_selection_tests {
    use super::*;

    fn batches(status: &str, count: usize) -> Vec<serde_json::Value> {
        (1..=count).map(|id| serde_json::json!({
            "id": format!("{id:064x}"), "amount": "7", "status": status, "expiry_at": 1000
        })).collect()
    }

    fn selection(batches: &[serde_json::Value]) -> Vec<MergeSelection> {
        batches.iter().cloned().map(|batch| serde_json::from_value(batch).unwrap()).collect()
    }

    #[test]
    fn active_and_expired_batches_can_be_combined_up_to_the_limit() {
        for status in ["active", "expired"] {
            for count in [2, 256] {
                let batches = batches(status, count);
                assert_eq!(reviewed_merge_sources(&batches, &selection(&batches)).unwrap().len(), count);
            }
        }
    }

    #[test]
    fn stale_review_cannot_change_the_signed_selection() {
        let original = batches("active", 2);
        let selected = selection(&original);
        for (field, value) in [("amount", serde_json::json!("8")), ("status", serde_json::json!("expired")), ("expiry_at", serde_json::json!(999))] {
            let mut current = original.clone();
            current[0][field] = value;
            assert!(reviewed_merge_sources(&current, &selected).is_err());
        }
        assert!(reviewed_merge_sources(&original[..1], &selected).is_err());
    }

    #[test]
    fn invalid_groups_and_amounts_are_rejected() {
        for count in [0, 1, 257] {
            let current = batches("active", count);
            assert!(reviewed_merge_sources(&current, &selection(&current)).is_err());
        }
        let mut current = batches("revoked", 2);
        assert!(reviewed_merge_sources(&current, &selection(&current)).is_err());
        current = batches("active", 2);
        current[1]["status"] = serde_json::json!("expired");
        assert!(reviewed_merge_sources(&current, &selection(&current)).is_err());
        current = batches("active", 2);
        assert!(reviewed_merge_sources(&current, &vec![selection(&current)[0].clone(); 2]).is_err());
        for amount in ["0", "invalid", "340282366920938463463374607431768211455"] {
            current[0]["amount"] = serde_json::json!(amount);
            assert!(reviewed_merge_sources(&current, &selection(&current)).is_err());
        }
    }
}

#[tauri::command]
pub async fn merge_trst(rpc_url: String, selected: Vec<MergeSelection>, expected_account: String, state: State<'_, WalletState>) -> Result<TxResult, String> {
    stop_automation(&state)?;
    let _signing = state.signing.lock().await;
    let keys = reviewed_signing_keys(&state, &expected_account)?;
    let client = journaled_client(&state, &rpc_url, &expected_account)?;
    let portfolio = client.rpc_call("trst_portfolio", serde_json::json!({"account":expected_account})).await.map_err(|error| error.to_string())?;
    let batches = portfolio["batches"].as_array().ok_or("Missing TRST portfolio")?;
    let sources = reviewed_merge_sources(batches, &selected)?;
    let account = burst_crypto::derive_address(&keys.public);
    let tx = build_merge_tx(&account, sources, Timestamp::now()).map_err(|error| error.to_string())?;
    client.submit_signed(&keys, &Transaction::Merge(tx), TxHash::ZERO).await.map(tx_result).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn reject_pending(rpc_url: String, hash: String, expected_account: String, state: State<'_, WalletState>) -> Result<TxResult, String> {
    stop_automation(&state)?;
    let _signing = state.signing.lock().await;
    let account = get_wallet_address(&state)?;
    if account != expected_account { return Err("Wallet changed. Review the payment again.".into()); }
    let keys = signing_keys(&state)?;
    let client = journaled_client(&state, &rpc_url, &expected_account)?;
    client.reject_signed(&keys, &hash).await.map(tx_result).map_err(|e|e.to_string())
}

/// Wallet automation signs normal protocol blocks, only while unlocked. Work
/// is bounded per poll and serialized with manual actions and wallet switching.
#[tauri::command]
pub async fn maintain_wallet(rpc_url: String, expected_account: String, auto_accept: bool,
    trusted_senders: Vec<String>, merge_level: u8, automation_session: String, group_policy: Option<crate::group_policy::GroupPolicy>, state: State<'_, WalletState>) -> Result<serde_json::Value, String> {
    use crate::group_policy::GroupMode;
    use burst_wallet_core::trust_policy::{evaluate_payment_group_graph, GroupRequirements, TrustDecision};
    let group_policy=group_policy.unwrap_or_default();
    let registry=group_policy.registry()?;
    let group_ids: Vec<_>=group_policy.groups.iter().filter(|group|group.trust_directly).map(|group|group.id.clone()).collect();
    let group_client=burst_groups::GroupClient::new().map_err(|error|error.to_string())?;
    let session = parse_automation_session(&automation_session)?;
    check_automation_session(&state, session)?;
    let _signing = state.signing.lock().await;
    check_automation_session(&state, session)?;
    let account = get_wallet_address(&state)?;
    if account != expected_account { return Err("Wallet changed; automation cancelled".into()); }
    let keys = signing_keys(&state)?;
    let node = journaled_client(&state, &rpc_url, &expected_account)?;
    let mut received = 0;
    let mut held = 0;
    let mut held_reasons = Vec::new();
    let mut checked_hashes = Vec::new();
    let mut protocol_fallbacks = 0;
    if auto_accept {
        let scan_context=serde_json::json!([account,node.node_url(),trusted_senders,group_policy]).to_string();
        let cursor={let scan=state.pending_scan.lock().map_err(|_|"Pending scan unavailable")?;
            if scan.0==scan_context {scan.1.clone()} else {None}};
        let pending = automation_read(&state,session,async {
            let value=node.rpc_call("account_pending",serde_json::json!({"account":account,"count":8,"cursor":cursor})).await.map_err(|e|e.to_string())?;
            serde_json::from_value::<burst_wallet_core::wallet::AccountPendingResult>(value).map_err(|e|e.to_string())
        }).await?;
        for payment in pending.blocks.iter().take(8) {
            check_automation_session(&state, session)?;
            checked_hashes.push(payment.hash.clone());
            // An allow-list is an explicit sender rule, not a claim that we
            // validated the entire origin/merger graph or group membership.
            if !trusted_senders.is_empty() && !trusted_senders.contains(&payment.source) { held += 1; continue; }
            let mut used_fallback=false;
            if group_policy.mode != GroupMode::Protocol {
                let origins=automation_read(&state,session,async {node.payment_origins(&payment.hash).await.map_err(|e|e.to_string())}).await;
                check_automation_session(&state,session)?;
                match origins {
                    Ok(origins) => {
                        let result=automation_read(&state,session,async {Ok(evaluate_payment_group_graph(&origins,GroupRequirements {
                            group_ids:&group_ids,require_all:group_policy.mode==GroupMode::All,max_hops:group_policy.max_hops },
                            group_policy.offline_fallback,&group_client,&registry).await)}).await?;
                        match result.decision {
                            TrustDecision::Accept => used_fallback=result.used_protocol_fallback,
                            TrustDecision::Reject {reason} | TrustDecision::Warn {reason} => {
                                held+=1; held_reasons.push(serde_json::json!({"hash":payment.hash,"reason":reason})); continue;
                            }
                        }
                    },
                    Err(error) => {
                        held+=1; held_reasons.push(serde_json::json!({"hash":payment.hash,"reason":format!("Original creators unavailable: {error}")})); continue;
                    }
                }
            }
            check_automation_session(&state, session)?;
            node.receive_signed(&keys, &payment.hash).await.map_err(|e|e.to_string())?;
            received += 1;
            if used_fallback { protocol_fallbacks+=1; }
        }
        *state.pending_scan.lock().map_err(|_|"Pending scan unavailable")?=(scan_context,if received>0 {None} else {pending.cursor});
    }
    let mut merged = 0;
    if merge_level > 0 {
        check_automation_session(&state, session)?;
        let info = node.account_info(&account).await;
        // Unverified recipients may receive, but cannot merge/spend.
        if info.as_ref().is_ok_and(|i| matches!(i.verification_state.as_str(), "verified" | "challenged")) {
            let portfolio = node.rpc_call("trst_portfolio", serde_json::json!({"account":account})).await.map_err(|e|e.to_string())?;
            let batches = portfolio["batches"].as_array().ok_or("Missing TRST portfolio")?;
            let mut holdings = Vec::new();
            for batch in batches.iter().filter(|b|b["status"] == "active") {
                holdings.push(burst_wallet_core::portfolio::TrstHolding {
                    token_id: batch["id"].as_str().ok_or("Missing token ID")?.into(),
                    amount: batch["amount"].as_str().and_then(|s|s.parse().ok()).ok_or("Invalid amount")?,
                    origin_wallet: batch["originator"].as_str().unwrap_or("").into(),
                    origin_timestamp: Timestamp::new(batch["timestamp"].as_u64().ok_or("Missing origin time")?),
                    state: burst_types::TrstState::Active,
                    time_to_expiry_secs: Some(batch["expiry_at"].as_u64().map(|expiry|expiry.saturating_sub(Timestamp::now().as_secs())).unwrap_or(u64::MAX)),
                });
            }
            let config = burst_wallet_core::portfolio::AutoMergePolicy::new(merge_level).config();
            if let Some(group) = burst_wallet_core::auto_merge::compute_merge_groups(&holdings, &config).first() {
                let sources = group.token_ids.iter().map(|id|burst_wallet_core::signed_client::parse_hash(id).map(|h|h.into_tx_hash())).collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
                let tx = build_merge_tx(&WalletAddress::new(account), sources, Timestamp::now()).map_err(|e|e.to_string())?;
                check_automation_session(&state, session)?;
                node.submit_signed(&keys, &Transaction::Merge(tx), TxHash::ZERO).await.map_err(|e|e.to_string())?;
                merged = group.token_ids.len();
            }
        }
    }
    Ok(serde_json::json!({"received":received,"held":held,"merged":merged,"held_reasons":held_reasons,"checked_hashes":checked_hashes,"protocol_fallbacks":protocol_fallbacks}))
}

#[tauri::command]
pub async fn get_pending(
    rpc_url: String,
    cursor: Option<String>,
    expected_account: Option<String>,
    state: State<'_, WalletState>,
) -> Result<PendingResult, String> {
    let account = get_wallet_address(&state)?;
    if expected_account.as_ref().is_some_and(|expected| expected != &account) {
        return Err("Wallet changed. Refresh pending payments.".into());
    }
    let result = rpc_call(
        &rpc_url,
        serde_json::json!({"action": "account_pending", "account": account, "count": 20, "cursor": cursor}),
    )
    .await?;
    parse_pending_page(result, cursor.as_deref())
}

fn parse_pending_page(value: serde_json::Value, requested_cursor: Option<&str>) -> Result<PendingResult, String> {
    let result: PendingResult = serde_json::from_value(value).map_err(|error| format!("Invalid pending payments: {error}"))?;
    let mut hashes = std::collections::HashSet::new();
    if result.blocks.len() > 20 || result.blocks.iter().any(|entry| {
        burst_wallet_core::signed_client::parse_hash(&entry.hash).is_err()
            || burst_wallet_core::signed_client::parse_address(&entry.source).is_err()
            || entry.amount.parse::<u128>().is_err()
            || !hashes.insert(&entry.hash)
    }) || result.cursor.as_deref().is_some_and(|next| next.is_empty() || next.len() > 512 || Some(next) == requested_cursor) {
        return Err("Invalid pending payment page. Refresh or check the connected node.".into());
    }
    Ok(result)
}

#[tauri::command]
pub async fn get_account_history(
    rpc_url: String,
    cursor: Option<String>,
    count: u32,
    state: State<'_, WalletState>,
) -> Result<AccountHistory, String> {
    let account = get_wallet_address(&state)?;
    let mut params = serde_json::json!({
        "action": "account_history",
        "account": account,
        "count": count,
    });
    if let Some(c) = cursor {
        params["cursor"] = serde_json::json!(c);
    }
    let result = rpc_call(&rpc_url, params).await?;
    serde_json::from_value(result).map_err(|e| format!("Parse error: {e}"))
}

// ── Verification & Endorsement ──────────────────────────────────────────

/// Get verification status for this wallet.
#[tauri::command]
pub async fn get_verification_status(
    rpc_url: String,
    state: State<'_, WalletState>,
) -> Result<VerificationStatus, String> {
    let account = get_wallet_address(&state)?;
    let result = rpc_call(
        &rpc_url,
        serde_json::json!({"action": "verification_status", "account": account}),
    )
    .await?;
    serde_json::from_value(result).map_err(|e| format!("Parse error: {e}"))
}

/// Panel and economic terms shown before the wallet signs a review vote.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VerificationReview {
    target: String,
    selection_context: Option<String>,
    phase: Option<String>,
    enabled: bool,
    selected: bool,
    voted: bool,
    stake: String,
    params_hash: String,
}

impl VerificationReview {
    fn matches_current(&self, current: &Self) -> bool {
        self == current && current.enabled && current.selected && !current.voted
            && current.selection_context.is_some()
            && matches!(current.phase.as_deref(), Some("voting" | "challenged"))
    }
}

async fn verification_review(rpc_url: &str, target: &str, voter: &str) -> Result<VerificationReview, String> {
    parse_address(target).map_err(|e| e.to_string())?;
    let status = rpc_call(rpc_url, serde_json::json!({"action":"verification_status", "account":target})).await?;
    let params = rpc_call(rpc_url, serde_json::json!({"action":"params_hash"})).await?;
    let rules = rpc_call(rpc_url, serde_json::json!({"action":"protocol_params"})).await?;
    let selected = status["selected_verifiers"].as_array().ok_or("Node does not report selected verifier panels; update it first")?;
    let votes = status["verifier_votes"].as_array().ok_or("Missing verifier votes")?;
    Ok(VerificationReview {
        target: target.to_owned(),
        selection_context: status["selection_context"].as_str().map(str::to_owned),
        phase: status["phase"].as_str().map(str::to_owned),
        enabled: status["selection_available"] == true,
        selected: selected.iter().any(|account| account == voter),
        voted: votes.iter().any(|vote| vote["verifier"] == voter),
        stake: rules["verifier_stake_amount"].as_str().ok_or("Missing verifier stake")?.to_owned(),
        params_hash: params["params_hash"].as_str().ok_or("Missing parameter hash")?.to_owned(),
    })
}

#[tauri::command]
pub async fn get_verification_review(rpc_url: String, target: String, state: State<'_, WalletState>) -> Result<VerificationReview, String> {
    verification_review(&rpc_url, &target, &get_wallet_address(&state)?).await
}

#[tauri::command]
pub async fn get_verifier_assignments(rpc_url: String, cursor: Option<String>, state: State<'_, WalletState>) -> Result<VerifierAssignments, String> {
    let account = get_wallet_address(&state)?;
    let result = rpc_call(&rpc_url, serde_json::json!({"action":"verifier_assignments", "account":account, "cursor":cursor})).await?;
    let page: VerifierAssignments = serde_json::from_value(result).map_err(|e| format!("Invalid assignments: {e}"))?;
    if page.targets.len() > 20
        || page.targets.iter().any(|target| parse_address(target).is_err() || cursor.as_ref().is_some_and(|cursor| target <= cursor))
        || page.targets.windows(2).any(|pair| pair[0] >= pair[1])
        || page.cursor.as_ref().is_some_and(|next| Some(next) != page.targets.last())
    { return Err("Invalid assignment page. Check the connected node.".into()); }
    Ok(page)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct VerifierAssignments { targets: Vec<String>, cursor: Option<String> }

#[tauri::command]
pub async fn cast_verification_vote(rpc_url: String, reviewed: VerificationReview, vote: u8, expected_account: String, state: State<'_, WalletState>) -> Result<TxResult, String> {
    stop_automation(&state)?;
    let _signing = state.signing.lock().await;
    let keys = reviewed_signing_keys(&state, &expected_account)?;
    let current = verification_review(&rpc_url, &reviewed.target, &expected_account).await
        .map_err(|error| format!("verification vote not submitted: {error}"))?;
    if !reviewed.matches_current(&current) {
        return Err("verification vote not submitted: panel or eligibility changed; review again".into());
    }
    let context = burst_wallet_core::signed_client::parse_hash(current.selection_context.as_deref().ok_or("Missing certified panel context")?).map_err(|e| e.to_string())?;
    let stake = if vote == 3 { 0 } else { current.stake.parse::<u128>().map_err(|_| "Invalid verifier stake")? };
    let target = parse_address(&current.target).map_err(|e| e.to_string())?;
    let account = burst_crypto::derive_address(&keys.public);
    let transaction = build_verification_vote_tx(&account, &target, context, vote, stake, Timestamp::now()).map_err(|e| e.to_string())?;
    let node = journaled_client(&state, &rpc_url, &expected_account)?;
    node.submit_signed(&keys, &Transaction::VerificationVote(transaction), TxHash::ZERO).await.map(tx_result).map_err(|e| e.to_string())
}

/// Volunteer for future panels without changing existing assignments.
#[tauri::command]
pub async fn set_verifier_participation(
    rpc_url: String,
    opted_in: bool,
    expected_account: String,
    state: State<'_, WalletState>,
) -> Result<TxResult, String> {
    stop_automation(&state)?;
    let _signing = state.signing.lock().await;
    let keys = reviewed_signing_keys(&state, &expected_account)?;
    let node = journaled_client(&state, &rpc_url, &expected_account)?;
    node.set_verifier_opt_in_signed(&keys, opted_in).await.map(tx_result).map_err(|e| e.to_string())
}

/// Endorse another wallet: permanently burn BRN to vouch for their humanity.
#[tauri::command]
pub async fn endorse_wallet(
    rpc_url: String,
    target: String,
    amount: String,
    expected_account: String,
    state: State<'_, WalletState>,
) -> Result<TxResult, String> {
    let amount = amount.parse::<u128>().map_err(|_| "Invalid raw BRN amount")?;
    if amount == 0 { return Err("Endorsement must burn a positive amount".into()); }
    let target = parse_address(&target).map_err(|e|e.to_string())?;
    submit_wallet_action(&state, &rpc_url, &expected_account, |account| build_endorse_tx(account, &target, amount, Timestamp::now()).map(Transaction::Endorse)).await
}

/// Challenge another wallet's verification: stake BRN to initiate revote.
#[tauri::command]
pub async fn challenge_wallet(
    rpc_url: String,
    target: String,
    stake: String,
    reason: Option<String>,
    expected_account: String,
    state: State<'_, WalletState>,
) -> Result<TxResult, String> {
    let amount = stake.parse::<u128>().map_err(|_| "Invalid raw BRN stake")?;
    let reason = match reason.as_deref().unwrap_or("fraud") {
        "fraud" => burst_types::ChallengeReason::Fraud,
        "inactivity" => burst_types::ChallengeReason::Inactivity,
        _ => return Err("Unknown challenge reason".into()),
    };
    let target = parse_address(&target).map_err(|e|e.to_string())?;
    submit_wallet_action(&state, &rpc_url, &expected_account, |account| build_challenge_tx(account, &target, amount, reason, Timestamp::now()).map(Transaction::Challenge)).await
}

#[tauri::command]
pub async fn get_appeal_review(rpc_url: String, target: String) -> Result<burst_types::appeal::AppealReview, String> {
    let target = parse_address(&target).map_err(|e| e.to_string())?;
    let node = burst_wallet_core::NodeClient::new(rpc_url).map_err(|e| e.to_string())?;
    node.appeal_review(&target).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn appeal_wallet(rpc_url: String, reviewed: burst_types::appeal::AppealReview, expected_account: String,
    state: State<'_, WalletState>) -> Result<TxResult, String> {
    submit_appeal(&rpc_url, &reviewed, &expected_account, &state).await
}

async fn submit_appeal(rpc_url: &str, reviewed: &burst_types::appeal::AppealReview,
    expected_account: &str, state: &WalletState) -> Result<TxResult, String> {
    let preflight = |error| format!("appeal not submitted: {error}");
    stop_automation(state).map_err(preflight)?;
    let _signing = state.signing.lock().await;
    let keys = reviewed_signing_keys(state, expected_account).map_err(preflight)?;
    let node = journaled_client(state, rpc_url, expected_account).map_err(preflight)?;
    node.appeal_signed(&keys, reviewed, Timestamp::now()).await.map(tx_result).map_err(|e| e.to_string())
}

#[cfg(test)]
#[path = "appeal_tests.rs"]
mod appeal_tests;

// ── Governance & Delegation ─────────────────────────────────────────────

#[tauri::command]
pub async fn get_governance_proposals(rpc_url: String, cursor: Option<String>) -> Result<serde_json::Value, String> {
    let mut params = serde_json::json!({"action":"governance_proposals", "count":25});
    if let Some(cursor) = cursor { params["cursor"] = cursor.into(); }
    rpc_call(&rpc_url, params).await
}

#[tauri::command]
pub async fn get_governance_proposal_info(rpc_url: String, hash: String) -> Result<serde_json::Value, String> {
    burst_wallet_core::signed_client::parse_hash(&hash).map_err(|error| error.to_string())?;
    let mut proposal = rpc_call(&rpc_url, serde_json::json!({"action":"governance_proposal_info", "hash":hash})).await?;
    crate::constitution::exact_article_numbers(&mut proposal);
    Ok(proposal)
}

#[tauri::command]
pub async fn vote_proposal(
    rpc_url: String,
    proposal: String,
    vote: String,
    expected_account: String,
    state: State<'_, WalletState>,
) -> Result<TxResult, String> {
    let vote = match vote.to_lowercase().as_str() {
        "yea" => burst_transactions::governance::GovernanceVote::Yea,
        "nay" => burst_transactions::governance::GovernanceVote::Nay,
        "abstain" => burst_transactions::governance::GovernanceVote::Abstain,
        _ => return Err("Vote must be yea, nay or abstain".into()),
    };
    let proposal = burst_wallet_core::signed_client::parse_hash(&proposal).map_err(|e| e.to_string())?.into_tx_hash();
    submit_wallet_action(&state, &rpc_url, &expected_account, |account| {
        build_governance_vote_tx(account, proposal, vote, Timestamp::now()).map(Transaction::GovernanceVote)
    }).await
}

#[tauri::command]
pub async fn change_representative(
    rpc_url: String,
    rep: String,
    expected_account: String,
    state: State<'_, WalletState>,
) -> Result<TxResult, String> {
    let rep = parse_address(&rep).map_err(|e|e.to_string())?;
    submit_wallet_action(&state, &rpc_url, &expected_account, |account| build_change_rep_tx(account, &rep, Timestamp::now()).map(Transaction::ChangeRepresentative)).await
}

/// Delegate governance vote to another wallet.
#[tauri::command]
pub async fn delegate_vote(
    rpc_url: String,
    delegate_to: String,
    expected_account: String,
    state: State<'_, WalletState>,
) -> Result<TxResult, String> {
    let delegate_to = parse_address(&delegate_to).map_err(|e|e.to_string())?;
    submit_wallet_action(&state, &rpc_url, &expected_account, |account| build_delegate_tx(account, &delegate_to, Timestamp::now()).map(Transaction::Delegate)).await
}

/// Revoke governance vote delegation.
#[tauri::command]
pub async fn revoke_delegation(
    rpc_url: String,
    expected_account: String,
    state: State<'_, WalletState>,
) -> Result<TxResult, String> {
    submit_wallet_action(&state, &rpc_url, &expected_account, |account| build_revoke_delegation_tx(account, Timestamp::now()).map(Transaction::RevokeDelegation)).await
}

/// Get current delegation info.
#[tauri::command]
pub async fn get_delegation_info(
    rpc_url: String,
    state: State<'_, WalletState>,
) -> Result<DelegationInfo, String> {
    let account = get_wallet_address(&state)?;
    let result = rpc_call(
        &rpc_url,
        serde_json::json!({"action": "delegation_info", "account": account}),
    )
    .await?;
    serde_json::from_value(result).map_err(|e| format!("Parse error: {e}"))
}

// ── Keystore export ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn export_private_key(
    password: String,
    state: State<'_, WalletState>,
) -> Result<String, String> {
    let _signing = state.signing.lock().await;
    require_writable_session(&state)?;
    let keystore = {
        let ks = state.keystore.lock().unwrap();
        ks.as_ref().ok_or("No keystore loaded")?.clone()
    };
    let secret = decrypt_keystore(&keystore, &password).map_err(|e| format!("{e}"))?;
    Ok(hex::encode(secret))
}
