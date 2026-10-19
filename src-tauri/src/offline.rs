use crate::commands::{
    get_wallet_address, require_writable_session, signing_keys, stop_automation, tx_result, TxResult, WalletState,
};
use burst_types::{Timestamp, TxHash, WalletAddress};
use burst_wallet_core::{
    offline::{load_payment, load_payment_with_ancestry, payment_was_submitted, OfflineAction, OfflineActionContext, OfflinePaymentContext, OfflineReceiveContext, OfflinePaymentReview},
    signed_client::parse_address,
    transaction_builder::build_burn_tx,
    NodeClient,
};
use std::path::PathBuf;
use tauri::State;

pub(crate) fn draft_path(state: &WalletState, expected_account: &str) -> Result<PathBuf, String> {
    let account = parse_address(expected_account).map_err(|error| error.to_string())?;
    if get_wallet_address(state)? != account.as_str() {
        return Err("Your wallet changed. Review this action again.".into());
    }
    Ok(state
        .offline_directory
        .get()
        .ok_or("Offline payment storage unavailable")?
        .join(format!("{}.json", account.as_str())))
}

/// Opaque public context: no key material and no JS conversion of raw amounts.
#[tauri::command]
pub async fn prepare_offline_payment(
    rpc_url: String,
    expected_account: String,
    state: State<'_, WalletState>,
) -> Result<String, String> {
    stop_automation(&state)?;
    let _guard = state.signing.lock().await;
    draft_path(&state, &expected_account)?;
    let keys = signing_keys(&state)?;
    let account = burst_crypto::derive_address(&keys.public);
    if account.as_str() != expected_account {
        return Err("Your wallet changed. Review this action again.".into());
    }
    let context = crate::commands::journaled_client(&state, &rpc_url, &expected_account)?
        .prepare_offline_payment(&account)
        .await
        .map_err(|error| error.to_string())?;
    serde_json::to_string(&context).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn prepare_offline_action(
    rpc_url: String,
    action: String,
    expected_account: String,
    state: State<'_, WalletState>,
) -> Result<String, String> {
    stop_automation(&state)?;
    let _guard = state.signing.lock().await;
    draft_path(&state, &expected_account)?;
    let keys = signing_keys(&state)?;
    let account = burst_crypto::derive_address(&keys.public);
    if account.as_str() != expected_account {
        return Err("Your wallet changed. Review this action again.".into());
    }
    if action.len() > 512 * 1024 {
        return Err("Offline action is too large".into());
    }
    let action: OfflineAction = serde_json::from_str(&action).map_err(|error| error.to_string())?;
    let context = crate::commands::journaled_client(&state, &rpc_url, &expected_account)?
        .prepare_offline_action(&account, action).await.map_err(|error| error.to_string())?;
    serde_json::to_string(&context).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn sign_offline_action(
    context: String,
    expected_account: String,
    state: State<'_, WalletState>,
) -> Result<String, String> {
    stop_automation(&state)?;
    let _guard = state.signing.lock().await;
    let path = draft_path(&state, &expected_account)?;
    let keys = signing_keys(&state)?;
    if context.len() > 512 * 1024 {
        return Err("Offline signing context is too large".into());
    }
    let context: OfflineActionContext = serde_json::from_str(&context).map_err(|error| error.to_string())?;
    let signed = context.sign(&keys, Timestamp::now()).map_err(|error| error.to_string())?;
    crate::signing_device::require_local_grant(&state, signed.block())?;
    if signed.block().account.as_str() != expected_account {
        return Err("Your wallet changed. Review this action again.".into());
    }
    signed.save(&path).map_err(|error| error.to_string())?;
    Ok(signed.block().hash.to_string())
}

#[derive(serde::Serialize)]
pub struct PreparedReceipt {
    context: String,
    review: OfflinePaymentReview,
}

#[tauri::command]
pub async fn prepare_offline_receive(
    rpc_url: String,
    payment: String,
    expected_account: String,
    state: State<'_, WalletState>,
) -> Result<PreparedReceipt, String> {
    stop_automation(&state)?;
    let _guard = state.signing.lock().await;
    draft_path(&state, &expected_account)?;
    let keys = signing_keys(&state)?;
    let account = burst_crypto::derive_address(&keys.public);
    if account.as_str() != expected_account {
        return Err("Your wallet changed. Review this action again.".into());
    }
    let context = crate::commands::journaled_client(&state, &rpc_url, &expected_account)?
        .prepare_offline_receive(&account, &payment).await.map_err(|error| error.to_string())?;
    Ok(PreparedReceipt { review: context.review(), context: serde_json::to_string(&context).map_err(|error| error.to_string())? })
}

#[tauri::command]
pub async fn sign_offline_receive(
    context: String,
    expected_account: String,
    state: State<'_, WalletState>,
) -> Result<String, String> {
    stop_automation(&state)?;
    let _guard = state.signing.lock().await;
    let path = draft_path(&state, &expected_account)?;
    let keys = signing_keys(&state)?;
    if context.len() > 512 * 1024 {
        return Err("Offline signing context is too large".into());
    }
    let context: OfflineReceiveContext = serde_json::from_str(&context).map_err(|error| error.to_string())?;
    let block = context.sign(&keys, Timestamp::now()).map_err(|error| error.to_string())?;
    crate::signing_device::require_local_grant(&state, &block)?;
    if block.account.as_str() != expected_account {
        return Err("Your wallet changed. Review this action again.".into());
    }
    context.save_payment(&path, &block).map_err(|error| error.to_string())?;
    Ok(block.hash.to_string())
}

#[tauri::command]
pub async fn sign_offline_payment(
    context: String,
    provider: String,
    amount: String,
    expected_account: String,
    state: State<'_, WalletState>,
) -> Result<String, String> {
    stop_automation(&state)?;
    let _guard = state.signing.lock().await;
    let path = draft_path(&state, &expected_account)?;
    let keys = signing_keys(&state)?;
    let account = burst_crypto::derive_address(&keys.public);
    if account.as_str() != expected_account {
        return Err("Your wallet changed. Review this action again.".into());
    }
    if context.len() > 512 * 1024 {
        return Err("Offline signing context is too large".into());
    }
    let context: OfflinePaymentContext =
        serde_json::from_str(&context).map_err(|error| error.to_string())?;
    let provider = parse_address(&provider).map_err(|error| error.to_string())?;
    let amount = amount.parse::<u128>().map_err(|_| "Invalid raw amount")?;
    let transaction = burst_transactions::Transaction::Burn(
        build_burn_tx(&account, &provider, amount, Timestamp::now())
            .map_err(|error| error.to_string())?,
    );
    let block = context
        .sign(&keys, &transaction, TxHash::ZERO)
        .map_err(|error| error.to_string())?;
    crate::signing_device::require_local_grant(&state, &block)?;
    context.save_payment(&path, &block).map_err(|error| error.to_string())?;
    Ok(block.hash.to_string())
}

/// Return the saved hash without exposing a signing key or converting raw amounts.
#[derive(serde::Serialize)]
pub struct OfflinePaymentStatus {
    hash: String,
    can_discard: bool,
    kind: String,
    can_review_payment: bool,
}

#[tauri::command]
pub fn offline_signing_available(state: State<'_, WalletState>) -> Result<bool, String> {
    if require_writable_session(&state).is_err() { return Ok(false); }
    Ok(state
        .profile_access
        .get()
        .ok_or("Profile access unavailable")?
        .require_signer()
        .is_ok())
}

#[tauri::command]
pub async fn get_offline_payment(
    expected_account: String,
    state: State<'_, WalletState>,
) -> Result<Option<OfflinePaymentStatus>, String> {
    let _guard = state.signing.lock().await;
    let path = draft_path(&state, &expected_account)?;
    match std::fs::symlink_metadata(&path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
        Ok(_) => {}
    }
    let block = load_payment(&path).map_err(|error| error.to_string())?;
    if block.account.as_str() != expected_account {
        return Err("Saved payment belongs to another wallet".into());
    }
    Ok(Some(OfflinePaymentStatus {
        hash: block.hash.to_string(),
        kind: format!("{:?}", block.block_type),
        can_review_payment: matches!(
            block.block_type,
            burst_ledger::BlockType::Burn
                | burst_ledger::BlockType::Receive
                | burst_ledger::BlockType::Open
        ),
        can_discard: !payment_was_submitted(&path, &block.hash)
            .map_err(|error| error.to_string())?,
    }))
}

#[tauri::command]
pub async fn discard_offline_payment(
    expected_account: String,
    expected_hash: String,
    state: State<'_, WalletState>,
) -> Result<(), String> {
    stop_automation(&state)?;
    let _guard = state.signing.lock().await;
    require_writable_session(&state)?;
    state
        .profile_access
        .get()
        .ok_or("Profile access unavailable")?
        .require_signer()?;
    let path = draft_path(&state, &expected_account)?;
    let block = load_payment(&path).map_err(|error| error.to_string())?;
    if block.account.as_str() != expected_account {
        return Err("Saved payment belongs to another wallet".into());
    }
    if block.hash.to_string() != expected_hash {
        return Err("Saved payment changed. Review it again.".into());
    }
    if payment_was_submitted(&path, &block.hash).map_err(|error| error.to_string())? {
        return Err(
            "This payment may already be submitted. Check confirmation instead of discarding it."
                .into(),
        );
    }
    archive_payment(&path, "discarded")
}

#[tauri::command]
pub async fn submit_offline_payment(
    rpc_url: String,
    expected_account: String,
    expected_hash: String,
    state: State<'_, WalletState>,
) -> Result<TxResult, String> {
    submit_saved_action(rpc_url, expected_account, expected_hash, state, true).await
}

#[tauri::command]
pub async fn submit_offline_action(
    rpc_url: String,
    expected_account: String,
    expected_hash: String,
    state: State<'_, WalletState>,
) -> Result<TxResult, String> {
    submit_saved_action(rpc_url, expected_account, expected_hash, state, false).await
}

async fn submit_saved_action(
    rpc_url: String,
    expected_account: String,
    expected_hash: String,
    state: State<'_, WalletState>,
    payment_only: bool,
) -> Result<TxResult, String> {
    stop_automation(&state)?;
    let _guard = state.signing.lock().await;
    require_writable_session(&state)?;
    state
        .profile_access
        .get()
        .ok_or("Profile access unavailable")?
        .require_signer()?;
    let path = draft_path(&state, &expected_account)?;
    if load_payment(&path)
        .map_err(|error| error.to_string())?
        .hash
        .to_string()
        != expected_hash
    {
        return Err("Saved payment changed. Review it again.".into());
    }
    let account = WalletAddress::new(&expected_account);
    let client = crate::commands::journaled_client(&state, &rpc_url, &expected_account)?;
    let result = if payment_only {
        client.submit_saved_offline_payment(&path, &account).await
    } else {
        client.submit_saved_offline_action(&path, &account).await
    }.map_err(|error| error.to_string())?;
    archive_payment(&path, "confirmed")?;
    Ok(tx_result(result))
}

#[derive(serde::Serialize)]
pub struct OfflineResolution {
    hash: String,
    confirmed_successor: Option<String>,
    status: &'static str,
}

#[tauri::command]
pub async fn resolve_offline_payment(
    rpc_url: String,
    expected_account: String,
    expected_hash: String,
    state: State<'_, WalletState>,
) -> Result<OfflineResolution, String> {
    stop_automation(&state)?;
    let _guard = state.signing.lock().await;
    require_writable_session(&state)?;
    state
        .profile_access
        .get()
        .ok_or("Profile access unavailable")?
        .require_signer()?;
    let path = draft_path(&state, &expected_account)?;
    let block = load_payment(&path).map_err(|error| error.to_string())?;
    if block.hash.to_string() != expected_hash {
        return Err("Saved payment changed. Review it again.".into());
    }
    if block.account.as_str() != expected_account {
        return Err("Saved payment belongs to another wallet".into());
    }
    let client = NodeClient::new(rpc_url).map_err(|error| error.to_string())?;
    let (saved, ancestry) = load_payment_with_ancestry(&path).map_err(|error| error.to_string())?;
    if saved.hash != block.hash {
        return Err("Saved payment changed. Review it again.".into());
    }
    let successor = client.confirmed_offline_resolution(&block, &ancestry).await;
    let successor_error = successor.as_ref().err().map(ToString::to_string);
    let Some(successor) = successor.ok().flatten() else {
        // Sparse history can lack the predecessor body. The atomic exclusion
        // endpoint uses canonical indexes instead; an error alone releases nothing.
        let epoch = client.excluded_offline_payment(&block).await
            .map_err(|error| match &successor_error {
                Some(previous) => format!("Payment remains unresolved: {previous}; exclusion check: {error}"),
                None => error.to_string(),
            })?
            .ok_or_else(|| successor_error.unwrap_or_else(|| "Payment remains unresolved. Keep the saved draft and retry after confirmation.".into()))?;
        archive_payment(&path, &format!("excluded-by-epoch-{epoch}"))?;
        return Ok(OfflineResolution {
            hash: block.hash.to_string(),
            confirmed_successor: None,
            status: "excluded",
        });
    };
    let status = if successor == block.hash {
        "confirmed"
    } else {
        "superseded"
    };
    if successor == block.hash { crate::signing_device::activate_confirmed(&state, &block)?; }
    archive_payment(&path, &format!("{status}-by-{successor}"))?;
    Ok(OfflineResolution {
        hash: block.hash.to_string(),
        confirmed_successor: Some(successor.to_string()),
        status,
    })
}

#[tauri::command]
pub async fn review_offline_payment(
    rpc_url: String,
    expected_account: String,
    expected_hash: String,
    state: State<'_, WalletState>,
) -> Result<burst_wallet_core::offline::OfflinePaymentReview, String> {
    let _guard = state.signing.lock().await;
    let block =
        load_payment(&draft_path(&state, &expected_account)?).map_err(|error| error.to_string())?;
    if block.account.as_str() != expected_account || block.hash.to_string() != expected_hash {
        return Err("Saved payment changed. Review it again.".into());
    }
    NodeClient::new(rpc_url)
        .map_err(|error| error.to_string())?
        .review_offline_payment(&block)
        .await
        .map_err(|error| error.to_string())
}

fn archive_payment(path: &std::path::Path, prefix: &str) -> Result<(), String> {
    burst_wallet_core::offline::archive_payment(path, prefix).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use burst_wallet_core::offline::{save_payment, save_payment_with_ancestry};
    use super::*;
    use burst_types::BlockHash;
    use burst_wallet_core::transaction_builder::{build_and_sign_state_block, AccountState};

    #[test]
    fn offline_archive_recovers_publication_interruption_and_preserves_conflicts() {
        let keys = burst_crypto::keypair_from_seed(&[74; 32]);
        let account = burst_crypto::derive_address(&keys.public);
        let state = AccountState { signing_grant: burst_types::BlockHash::ZERO,
            payment_epoch: BlockHash::new([1; 32]),
            release_sources: vec![],
            head: BlockHash::new([2; 32]),
            block_count: 1,
            representative: account.clone(),
            brn_balance: 0,
            trst_balance: 0,
        };
        let build = |amount| {
            let tx = burst_transactions::Transaction::Burn(
                build_burn_tx(&account, &account, amount, Timestamp::new(42)).unwrap(),
            );
            build_and_sign_state_block(
                &state,
                &tx,
                &keys.private,
                TxHash::ZERO,
                BlockHash::new([3; 32]),
            )
            .unwrap()
        };
        let block = build(1);
        let directory = tempfile::tempdir().unwrap();
        let pending = directory.path().join("pending.json");
        let archive = directory
            .path()
            .join(format!("confirmed-{}.json", block.hash));
        save_payment(&pending, &block).unwrap();
        let original = std::fs::read(&pending).unwrap();
        // Model interruption after publishing the immutable receipt but before
        // releasing the pending reservation. Retrying must preserve the receipt.
        save_payment(&archive, &block).unwrap();
        archive_payment(&pending, "confirmed").unwrap();
        assert!(!pending.exists());
        assert_eq!(std::fs::read(&archive).unwrap(), original);
        save_payment(&pending, &block).unwrap();
        let conflict = directory
            .path()
            .join(format!("superseded-{}.json", block.hash));
        save_payment(&conflict, &build(2)).unwrap();
        let conflicting_bytes = std::fs::read(&conflict).unwrap();
        assert!(archive_payment(&pending, "superseded").is_err());
        assert_eq!(std::fs::read(&pending).unwrap(), original);
        assert_eq!(std::fs::read(&conflict).unwrap(), conflicting_bytes);
        let mut child = build(2);
        child.previous = block.hash;
        child.hash = child.compute_hash();
        child.signature = burst_crypto::sign_message(child.hash.as_bytes(), &keys.private);
        let pending = directory.path().join("with-ancestry.json");
        save_payment_with_ancestry(&pending, &child, &[block.clone()]).unwrap();
        let original = std::fs::read(&pending).unwrap();
        let archive = pending.with_file_name(format!("superseded-{}.json",child.hash));
        save_payment(&archive, &child).unwrap();
        assert!(archive_payment(&pending,"superseded").is_err(), "cannot release the draft while its receipt loses recovery evidence");
        assert_eq!(std::fs::read(&pending).unwrap(),original);
        archive_payment(&pending,"resolved").unwrap();
        let archive = pending.parent().unwrap().join("completed").join(child.account.as_str())
            .join(format!("resolved-{}.json",child.hash));
        assert_eq!(std::fs::read(&archive).unwrap(),original);
        assert_eq!(load_payment_with_ancestry(&archive).unwrap().1[0].hash,block.hash);
    }
}
