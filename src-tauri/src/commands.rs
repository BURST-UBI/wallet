use std::path::PathBuf;
use std::sync::Mutex;

use burst_transactions::Transaction;
use burst_types::{BlockHash, Timestamp, TxHash, WalletAddress};
use burst_wallet_core::transaction_builder::{
    build_burn_tx, build_state_block, sign_state_block, AccountState,
};
use burst_wallet_core::wallet::Wallet;
use burst_wallet_core::{decrypt_keystore, encrypt_keystore, load_keystore, KeystoreFile};
use serde::{Deserialize, Serialize};
use tauri::State;

pub struct WalletState {
    wallet: Mutex<Option<Wallet>>,
    keystore: Mutex<Option<KeystoreFile>>,
}

impl Default for WalletState {
    fn default() -> Self {
        Self {
            wallet: Mutex::new(None),
            keystore: Mutex::new(None),
        }
    }
}

// ── Response types ──────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct WalletInfo {
    pub address: String,
    pub verification_state: String,
}

#[derive(Debug, Serialize)]
pub struct TrstBalance {
    pub active: String,
    pub expired: String,
    pub revoked: String,
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
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PendingResult {
    pub blocks: Vec<PendingEntry>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TrstBatch {
    pub origin: String,
    pub amount: String,
    pub originator: String,
    pub timestamp: u64,
    pub expiry_at: u64,
    pub status: String,
    pub chain_length: u32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TrstPortfolio {
    pub batches: Vec<TrstBatch>,
    pub total_active: String,
    pub total_expired: String,
    pub total_revoked: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct VerificationStatus {
    pub state: String,
    pub verified_at: Option<u64>,
    pub endorsement_count: u32,
    pub endorsement_threshold: u32,
    #[serde(default)]
    pub endorsers: Vec<String>,
    #[serde(default)]
    pub verifier_votes: Vec<VerifierVote>,
    #[serde(default)]
    pub challenge_active: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct VerifierVote {
    pub verifier: String,
    pub vote: String,
    pub timestamp: u64,
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
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("RPC request failed: {e}"))?;
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
    }
}

fn get_wallet_address(state: &WalletState) -> Result<String, String> {
    let guard = state.wallet.lock().unwrap();
    let wallet = guard.as_ref().ok_or("Wallet not loaded")?;
    Ok(wallet.address.to_string())
}

fn parse_tx_result(result: serde_json::Value) -> TxResult {
    TxResult {
        hash: result
            .get("hash")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        accepted: result
            .get("accepted")
            .and_then(|v| v.as_bool())
            .unwrap_or(true),
        detail: result
            .get("detail")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
    }
}

// ── Wallet management ───────────────────────────────────────────────────

#[tauri::command]
pub async fn create_wallet(state: State<'_, WalletState>) -> Result<WalletInfo, String> {
    let wallet = Wallet::create().map_err(|e| format!("{e}"))?;
    let info = wallet_info(&wallet);
    *state.wallet.lock().unwrap() = Some(wallet);
    Ok(info)
}

#[tauri::command]
pub async fn import_mnemonic(
    phrase: String,
    state: State<'_, WalletState>,
) -> Result<WalletInfo, String> {
    let wallet = Wallet::from_mnemonic(&phrase).map_err(|e| format!("{e}"))?;
    let info = wallet_info(&wallet);
    *state.wallet.lock().unwrap() = Some(wallet);
    Ok(info)
}

#[tauri::command]
pub async fn import_private_key(
    hex_key: String,
    state: State<'_, WalletState>,
) -> Result<WalletInfo, String> {
    let bytes = hex::decode(&hex_key).map_err(|e| format!("Invalid hex: {e}"))?;
    let wallet = Wallet::from_private_key(&bytes).map_err(|e| format!("{e}"))?;
    let info = wallet_info(&wallet);
    *state.wallet.lock().unwrap() = Some(wallet);
    Ok(info)
}

#[tauri::command]
pub async fn lock_wallet(state: State<'_, WalletState>) -> Result<(), String> {
    *state.wallet.lock().unwrap() = None;
    Ok(())
}

#[tauri::command]
pub async fn unlock_wallet(
    password: String,
    state: State<'_, WalletState>,
) -> Result<WalletInfo, String> {
    let keystore = {
        let ks = state.keystore.lock().unwrap();
        ks.as_ref().ok_or("No keystore loaded")?.clone()
    };
    let secret = decrypt_keystore(&keystore, &password).map_err(|e| format!("{e}"))?;
    let wallet = Wallet::from_seed(&secret);
    let info = wallet_info(&wallet);
    *state.wallet.lock().unwrap() = Some(wallet);
    Ok(info)
}

#[tauri::command]
pub async fn save_keystore(
    password: String,
    path: String,
    state: State<'_, WalletState>,
) -> Result<(), String> {
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
    let keystore = load_keystore(&PathBuf::from(&path)).map_err(|e| format!("{e}"))?;
    *state.keystore.lock().unwrap() = Some(keystore);
    Ok(true)
}

#[tauri::command]
pub async fn get_address(state: State<'_, WalletState>) -> Result<String, String> {
    get_wallet_address(&state)
}

#[tauri::command]
pub async fn is_locked(state: State<'_, WalletState>) -> Result<bool, String> {
    Ok(state.wallet.lock().unwrap().is_none())
}

// ── Balance queries ─────────────────────────────────────────────────────

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
    let account = get_wallet_address(&state)?;
    let result = rpc_call(
        &rpc_url,
        serde_json::json!({"action": "account_info", "account": account}),
    )
    .await?;
    Ok(TrstBalance {
        active: result
            .get("trst_balance")
            .and_then(|v| v.as_str())
            .unwrap_or("0")
            .to_string(),
        expired: result
            .get("trst_expired")
            .and_then(|v| v.as_str())
            .unwrap_or("0")
            .to_string(),
        revoked: result
            .get("trst_revoked")
            .and_then(|v| v.as_str())
            .unwrap_or("0")
            .to_string(),
    })
}

#[tauri::command]
pub async fn get_account_info(
    rpc_url: String,
    state: State<'_, WalletState>,
) -> Result<AccountInfoResponse, String> {
    let account = get_wallet_address(&state)?;
    let result = rpc_call(
        &rpc_url,
        serde_json::json!({"action": "account_info", "account": account}),
    )
    .await?;
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

/// Pay: burn BRN from this wallet, provider receives TRST.
/// Builds and signs a burn block client-side, then submits via process.
#[tauri::command]
pub async fn pay(
    rpc_url: String,
    provider: String,
    amount: String,
    state: State<'_, WalletState>,
) -> Result<TxResult, String> {
    let (account, sender, private_key) = {
        let guard = state.wallet.lock().unwrap();
        let w = guard.as_ref().ok_or("Wallet not loaded")?;
        let mut pk_bytes = [0u8; 32];
        pk_bytes.copy_from_slice(&w.primary_keys.private.0);
        (
            w.address.to_string(),
            w.address.clone(),
            burst_types::PrivateKey(pk_bytes),
        )
    };
    let amount_u128: u128 = amount
        .parse()
        .map_err(|_| "Invalid amount")?;

    // 1. Fetch account_info (head, representative, balances)
    // For new accounts the node may return error - we use defaults (head=0, self-rep)
    let acc_result = rpc_call(
        &rpc_url,
        serde_json::json!({"action": "account_info", "account": account}),
    )
    .await;
    let (head, representative, brn_balance, trst_balance, block_count) = match acc_result {
        Ok(acc_json) => (
            parse_block_hash_from_str(
                acc_json.get("head").and_then(|h| h.as_str()).unwrap_or("0"),
            )?,
            WalletAddress::new(
                acc_json
                    .get("representative")
                    .and_then(|r| r.as_str())
                    .unwrap_or(&account)
                    .to_string(),
            ),
            acc_json
                .get("brn_balance")
                .and_then(|b| b.as_str())
                .unwrap_or("0")
                .parse()
                .map_err(|_| "Invalid brn_balance from node")?,
            acc_json
                .get("trst_balance")
                .and_then(|b| b.as_str())
                .unwrap_or("0")
                .parse()
                .map_err(|_| "Invalid trst_balance from node")?,
            acc_json
                .get("block_count")
                .and_then(|b| b.as_u64())
                .unwrap_or(0),
        ),
        Err(_) => (
            BlockHash::ZERO,
            sender.clone(),
            0u128,
            0u128,
            0u64,
        ),
    };

    // 2. Fetch params_hash
    let params_json = rpc_call(
        &rpc_url,
        serde_json::json!({"action": "params_hash"}),
    )
    .await?;
    let params_hash = parse_block_hash_from_str(
        params_json
            .get("params_hash")
            .and_then(|p| p.as_str())
            .ok_or("Node did not return params_hash")?,
    )?;

    // 3. Build burn tx and state block
    let receiver = WalletAddress::new(provider.clone());
    let now = Timestamp::now();
    let burn_tx = build_burn_tx(&sender, &receiver, amount_u128, now)
        .map_err(|e| format!("Build burn tx: {e}"))?;
    let tx = Transaction::Burn(burn_tx);

    let account_state = AccountState {
        head,
        block_count,
        representative,
        brn_balance,
        trst_balance,
    };
    let mut block = build_state_block(
        &account_state,
        &tx,
        TxHash::ZERO,
        params_hash,
    )
    .map_err(|e| format!("Build state block: {e}"))?;

    // 4. Sign
    block = sign_state_block(block, &private_key);

    // 5. Proof-of-work
    let block_hash_hex = format!("{}", block.hash);
    let work_result = rpc_call(
        &rpc_url,
        serde_json::json!({"action": "work_generate", "hash": block_hash_hex}),
    )
    .await?;
    let work_hex = work_result
        .get("work")
        .and_then(|w| w.as_str())
        .ok_or("Node did not return work")?;
    block.work = u64::from_str_radix(work_hex, 16).map_err(|_| "Invalid work from node")?;

    // 6. Submit via process (hex-encoded bincode)
    let block_bytes = bincode::serialize(&block).map_err(|e| format!("Serialize block: {e}"))?;
    let block_hex = hex::encode(&block_bytes);
    let result = rpc_call(
        &rpc_url,
        serde_json::json!({"action": "process", "block": block_hex}),
    )
    .await?;

    Ok(parse_tx_result(result))
}

fn parse_block_hash_from_str(s: &str) -> Result<BlockHash, String> {
    let s = s.trim();
    if s.is_empty() || s == "0" || s.chars().all(|c| c == '0') {
        return Ok(BlockHash::ZERO);
    }
    let bytes = hex::decode(s).map_err(|e| format!("Invalid hash hex: {e}"))?;
    if bytes.len() != 32 {
        return Err(format!("Hash must be 32 bytes, got {}", bytes.len()));
    }
    let mut arr = [0u8; 32];
    arr.copy_from_slice(&bytes);
    Ok(BlockHash::new(arr))
}

/// Transfer: send existing TRST to another wallet.
#[tauri::command]
pub async fn transfer_trst(
    rpc_url: String,
    to: String,
    amount: String,
    state: State<'_, WalletState>,
) -> Result<TxResult, String> {
    let from = get_wallet_address(&state)?;
    let result = rpc_call(
        &rpc_url,
        serde_json::json!({
            "action": "send",
            "source": from,
            "destination": to,
            "amount": amount,
        }),
    )
    .await?;
    Ok(parse_tx_result(result))
}

/// Receive a pending TRST block.
#[tauri::command]
pub async fn receive_pending(
    rpc_url: String,
    hash: String,
    state: State<'_, WalletState>,
) -> Result<TxResult, String> {
    let account = get_wallet_address(&state)?;
    let result = rpc_call(
        &rpc_url,
        serde_json::json!({
            "action": "receive",
            "account": account,
            "block": hash,
        }),
    )
    .await?;
    Ok(parse_tx_result(result))
}

#[tauri::command]
pub async fn get_pending(
    rpc_url: String,
    state: State<'_, WalletState>,
) -> Result<PendingResult, String> {
    let account = get_wallet_address(&state)?;
    let result = rpc_call(
        &rpc_url,
        serde_json::json!({"action": "account_pending", "account": account, "count": 100}),
    )
    .await?;
    let empty: Vec<serde_json::Value> = vec![];
    let pending = result
        .get("pending")
        .and_then(|p| p.as_array())
        .unwrap_or(&empty)
        .iter()
        .filter_map(|p| {
            let hash = p.get("hash").and_then(|h| h.as_str()).unwrap_or("").to_string();
            let source = p.get("source").and_then(|s| s.as_str()).unwrap_or("").to_string();
            let amount = p.get("amount").and_then(|a| a.as_str()).unwrap_or("0").to_string();
            let block_type = p
                .get("block_type")
                .and_then(|b| b.as_str())
                .unwrap_or("send")
                .to_string();
            Some(PendingEntry {
                hash,
                source,
                amount,
                block_type,
            })
        })
        .collect();
    Ok(PendingResult { blocks: pending })
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

/// Endorse another wallet: permanently burn BRN to vouch for their humanity.
#[tauri::command]
pub async fn endorse_wallet(
    rpc_url: String,
    target: String,
    amount: String,
    state: State<'_, WalletState>,
) -> Result<TxResult, String> {
    let account = get_wallet_address(&state)?;
    let result = rpc_call(
        &rpc_url,
        serde_json::json!({
            "action": "endorse",
            "account": account,
            "target": target,
            "amount": amount,
        }),
    )
    .await?;
    Ok(parse_tx_result(result))
}

/// Challenge another wallet's verification: stake BRN to initiate revote.
#[tauri::command]
pub async fn challenge_wallet(
    rpc_url: String,
    target: String,
    stake: String,
    state: State<'_, WalletState>,
) -> Result<TxResult, String> {
    let account = get_wallet_address(&state)?;
    let result = rpc_call(
        &rpc_url,
        serde_json::json!({
            "action": "challenge",
            "account": account,
            "target": target,
            "stake": stake,
        }),
    )
    .await?;
    Ok(parse_tx_result(result))
}

// ── Governance & Delegation ─────────────────────────────────────────────

#[tauri::command]
pub async fn vote_proposal(
    rpc_url: String,
    proposal: String,
    vote: String,
    state: State<'_, WalletState>,
) -> Result<TxResult, String> {
    let account = get_wallet_address(&state)?;
    let result = rpc_call(
        &rpc_url,
        serde_json::json!({
            "action": "governance_vote",
            "account": account,
            "proposal": proposal,
            "vote": vote,
        }),
    )
    .await?;
    Ok(parse_tx_result(result))
}

#[tauri::command]
pub async fn change_representative(
    rpc_url: String,
    rep: String,
    state: State<'_, WalletState>,
) -> Result<TxResult, String> {
    let account = get_wallet_address(&state)?;
    let result = rpc_call(
        &rpc_url,
        serde_json::json!({
            "action": "change_representative",
            "account": account,
            "representative": rep,
        }),
    )
    .await?;
    Ok(parse_tx_result(result))
}

/// Delegate governance vote to another wallet.
#[tauri::command]
pub async fn delegate_vote(
    rpc_url: String,
    delegate_to: String,
    state: State<'_, WalletState>,
) -> Result<TxResult, String> {
    let account = get_wallet_address(&state)?;
    let result = rpc_call(
        &rpc_url,
        serde_json::json!({
            "action": "delegate",
            "account": account,
            "delegate": delegate_to,
        }),
    )
    .await?;
    Ok(parse_tx_result(result))
}

/// Revoke governance vote delegation.
#[tauri::command]
pub async fn revoke_delegation(
    rpc_url: String,
    state: State<'_, WalletState>,
) -> Result<TxResult, String> {
    let account = get_wallet_address(&state)?;
    let result = rpc_call(
        &rpc_url,
        serde_json::json!({
            "action": "revoke_delegation",
            "account": account,
        }),
    )
    .await?;
    Ok(parse_tx_result(result))
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
pub async fn export_mnemonic(
    password: String,
    state: State<'_, WalletState>,
) -> Result<String, String> {
    let keystore = {
        let ks = state.keystore.lock().unwrap();
        ks.as_ref().ok_or("No keystore loaded")?.clone()
    };
    let secret = decrypt_keystore(&keystore, &password).map_err(|e| format!("{e}"))?;
    Ok(hex::encode(secret))
}
