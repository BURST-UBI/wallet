use crate::commands::{get_wallet_address, takeover_keys, stop_automation, WalletState};
use burst_types::BlockHash;
use burst_wallet_core::{signed_client::{parse_address, parse_hash}, NodeClient};
use tauri::State;

fn binding_path(state: &WalletState, account: &str) -> Result<std::path::PathBuf, String> {
    let draft = crate::offline::draft_path(state, account)?;
    Ok(draft.parent().ok_or("Missing journal directory")?.join("devices").join(format!("{account}.json")))
}

fn device_directory(journal: &std::path::Path) -> Result<std::path::PathBuf, String> {
    let directory = journal.join("devices");
    match std::fs::create_dir(&directory) {
        Ok(()) => {
            #[cfg(unix)] {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
                std::fs::File::open(journal).and_then(|file| file.sync_all()).map_err(|e| e.to_string())?;
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {},
        Err(error) => return Err(error.to_string()),
    }
    if !std::fs::symlink_metadata(&directory).map_err(|e| e.to_string())?.is_dir() {
        return Err("Device bindings must use a directory, not a link".into());
    }
    Ok(directory)
}

// The caller owns the profile's exclusive signing lease. Preserve exact bytes
// and refuse conflicts; never interpret a binding as a receipt or a new grant.
pub(crate) fn migrate_bindings(journal: &std::path::Path) -> Result<(), String> {
    for entry in std::fs::read_dir(journal).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        let Some(account) = name.to_str().and_then(|name| name.strip_prefix("device-")).and_then(|name| name.strip_suffix(".json")) else { continue; };
        let address = parse_address(account).map_err(|e| e.to_string())?;
        if !entry.file_type().map_err(|e| e.to_string())?.is_file() { return Err("Invalid legacy device binding".into()); }
        burst_wallet_core::signing_device::load(&entry.path(), &address).map_err(|e| e.to_string())?;
        let directory = device_directory(journal)?;
        let target = directory.join(format!("{account}.json"));
        match std::fs::hard_link(entry.path(), &target) {
            Ok(()) => {},
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                if !std::fs::symlink_metadata(&target).map_err(|e| e.to_string())?.is_file() {
                    return Err("Invalid device binding target".into());
                }
                burst_wallet_core::signing_device::load(&target, &address).map_err(|e| e.to_string())?;
                if std::fs::read(&target).map_err(|e| e.to_string())? != std::fs::read(entry.path()).map_err(|e| e.to_string())? {
                    return Err("Conflicting device bindings; preserving both".into());
                }
            }
            Err(error) => return Err(error.to_string()),
        }
        std::fs::File::open(&target).and_then(|file| file.sync_all()).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        std::fs::File::open(&directory).and_then(|file| file.sync_all()).map_err(|e| e.to_string())?;
        std::fs::remove_file(entry.path()).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        std::fs::File::open(journal).and_then(|file| file.sync_all()).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub(crate) fn grant(state: &WalletState, account: &str) -> Result<BlockHash, String> {
    let address = parse_address(account).map_err(|e| e.to_string())?;
    burst_wallet_core::signing_device::load(&binding_path(state, account)?, &address).map_err(|e| e.to_string())
}

pub(crate) fn activate_confirmed(state: &WalletState, block: &burst_ledger::StateBlock) -> Result<(), String> {
    if block.block_type != burst_ledger::BlockType::ChangeSigner { return Ok(()); }
    let path = binding_path(state, block.account.as_str())?;
    let journal = path.parent().and_then(std::path::Path::parent).ok_or("Missing journal directory")?;
    device_directory(journal)?;
    burst_wallet_core::signing_device::activate(&path, &block.account, block).map_err(|e| e.to_string())
}

pub(crate) fn require_local_grant(state: &WalletState, block: &burst_ledger::StateBlock) -> Result<(), String> {
    if grant(state, block.account.as_str())? != block.signing_grant {
        return Err("This offline context belongs to another signing device. Do not replace its grant.".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn signing_device_status(rpc_url: String, expected_account: String, state: State<'_, WalletState>) -> Result<serde_json::Value, String> {
    if get_wallet_address(&state)? != expected_account { return Err("Your wallet changed".into()); }
    let client = NodeClient::new(rpc_url).map_err(|e| e.to_string())?;
    let account = parse_address(&expected_account).map_err(|e| e.to_string())?;
    let network = client.inspect_signing_state(&account).await.map_err(|e| e.to_string())?;
    let params = client.rpc_call("params_hash", serde_json::json!({})).await.map_err(|e| e.to_string())?;
    let local = grant(&state, &expected_account)?;
    Ok(serde_json::json!({"head":network.head.to_string(), "grant":network.signing_grant.to_string(),
        "params_hash":params["params_hash"], "active_here":!local.is_zero() && local == network.signing_grant,
        "enrolled":!network.signing_grant.is_zero()}))
}

#[tauri::command]
pub async fn take_over_signing(rpc_url: String, expected_account: String, reviewed_head: String,
    reviewed_grant: String, reviewed_params: String, state: State<'_, WalletState>) -> Result<(), String> {
    stop_automation(&state)?;
    let _guard = state.signing.lock().await;
    let path = crate::offline::draft_path(&state, &expected_account)?;
    let keys = takeover_keys(&state)?;
    let client = crate::commands::journaled_client(&state, &rpc_url, &expected_account)?;
    let nonce = BlockHash::new(burst_crypto::generate_keypair().public.0);
    client.handoff_signing_device(&keys, parse_hash(&reviewed_head).map_err(|e| e.to_string())?,
        parse_hash(&reviewed_grant).map_err(|e| e.to_string())?, parse_hash(&reviewed_params).map_err(|e| e.to_string())?, nonce)
        .await.map_err(|e| e.to_string())?;
    // Confirmation leaves the journal reserved until the local grant is durable.
    let block = burst_wallet_core::offline::load_payment(&path).map_err(|e| e.to_string())?;
    activate_confirmed(&state, &block)?;
    burst_wallet_core::offline::archive_payment(&path, "confirmed").map_err(|e| e.to_string())
}
