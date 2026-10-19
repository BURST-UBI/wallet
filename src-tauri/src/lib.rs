mod commands;
mod group_policy;
mod delegation;
mod constitution;
mod offline;
mod offline_actions;
mod profile_access;
mod signing_device;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri::Manager;
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(commands::WalletState::default())
        .setup(|app| {
            let directory = app.path().app_data_dir()?.join("offline-payments");
            std::fs::create_dir_all(&directory)?;
            #[cfg(unix)] {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700))?;
            }
            let access = profile_access::ProfileAccess::open(&directory)?;
            if access.require_signer().is_ok() {
                signing_device::migrate_bindings(&directory).map_err(std::io::Error::other)?;
                if let Err(error) = burst_wallet_core::offline::migrate_account_named_journal(&directory) {
                    eprintln!("BURST legacy receipt maintenance deferred: {error}");
                }
            }
            app.state::<commands::WalletState>().profile_access.set(access)
                .map_err(|_| std::io::Error::other("profile access already initialized"))?;
            app.state::<commands::WalletState>().offline_directory.set(directory)
                .map_err(|_| std::io::Error::other("offline payment directory already initialized"))?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_node_info,
            signing_device::signing_device_status,
            signing_device::take_over_signing,
            commands::create_wallet,
            commands::watch_wallet,
            commands::import_mnemonic,
            commands::import_private_key,
            commands::lock_wallet,
            commands::unlock_wallet,
            commands::save_keystore,
            commands::load_keystore_cmd,
            commands::get_address,
            commands::is_locked,
            commands::get_brn_balance,
            commands::get_brn_components,
            commands::get_trst_balance,
            commands::get_account_info,
            commands::get_trst_portfolio,
            commands::get_trst_origins,
            commands::get_payment_origins,
            commands::pay,
            offline::prepare_offline_payment,
            offline::prepare_offline_action,
            offline_actions::prepare_offline_review,
            offline_actions::review_saved_offline_action,
            offline::sign_offline_action,
            offline::submit_offline_action,
            offline::prepare_offline_receive,
            offline::sign_offline_receive,
            offline::offline_signing_available,
            offline::discard_offline_payment,
            offline::sign_offline_payment,
            offline::get_offline_payment,
            offline::review_offline_payment,
            offline::submit_offline_payment,
            offline::resolve_offline_payment,
            commands::transfer_trst,
            commands::merge_trst,
            commands::receive_pending,
            commands::reject_pending,
            commands::maintain_wallet,
            commands::begin_automation,
            commands::cancel_automation,
            group_policy::load_group_directory,
            group_policy::validate_group_policy,
            commands::get_pending,
            commands::get_account_history,
            commands::get_verification_status,
            commands::set_verifier_participation,
            commands::get_verification_review,
            commands::get_verifier_assignments,
            commands::cast_verification_vote,
            commands::endorse_wallet,
            commands::challenge_wallet,
            commands::get_appeal_review,
            commands::appeal_wallet,
            commands::vote_proposal,
            commands::get_governance_proposals,
            commands::get_governance_proposal_info,
            constitution::get_constitution_context,
            constitution::propose_constitution,
            constitution::propose_parameter,
            constitution::endorse_governance_proposal,
            constitution::withdraw_governance_proposal,
            commands::change_representative,
            commands::delegate_vote,
            commands::revoke_delegation,
            commands::get_delegation_info,
            delegation::get_scoped_delegations,
            delegation::set_scoped_delegation,
            delegation::vote_with_delegation,
            commands::export_private_key,
        ])
        .run(tauri::generate_context!())
        .expect("error while running BURST Wallet");
}
