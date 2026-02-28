mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(commands::WalletState::default())
        .invoke_handler(tauri::generate_handler![
            commands::create_wallet,
            commands::import_mnemonic,
            commands::import_private_key,
            commands::lock_wallet,
            commands::unlock_wallet,
            commands::save_keystore,
            commands::load_keystore_cmd,
            commands::get_address,
            commands::is_locked,
            commands::get_brn_balance,
            commands::get_trst_balance,
            commands::get_account_info,
            commands::get_trst_portfolio,
            commands::pay,
            commands::transfer_trst,
            commands::receive_pending,
            commands::get_pending,
            commands::get_account_history,
            commands::get_verification_status,
            commands::endorse_wallet,
            commands::challenge_wallet,
            commands::vote_proposal,
            commands::change_representative,
            commands::delegate_vote,
            commands::revoke_delegation,
            commands::get_delegation_info,
            commands::export_mnemonic,
        ])
        .run(tauri::generate_context!())
        .expect("error while running BURST Wallet");
}
