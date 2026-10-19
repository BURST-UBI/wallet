use crate::commands::{
    get_wallet_address, signing_keys, stop_automation, tx_result, TxResult, WalletState,
};
use burst_wallet_core::{
    delegation::view::{Direction, Entry, Page, Query, ScopeChoice},
    signed_client::{parse_address, parse_hash},
    NodeClient,
};
use tauri::State;

#[tauri::command]
pub async fn get_scoped_delegations(
    rpc_url: String,
    incoming: bool,
    scope: Option<ScopeChoice>,
    cursor: Option<String>,
    state: State<'_, WalletState>,
) -> Result<Page, String> {
    let account = get_wallet_address(&state)?;
    NodeClient::new(&rpc_url)
        .map_err(|e| e.to_string())?
        .delegation_keys(&Query {
            account,
            direction: if incoming {
                Direction::Incoming
            } else {
                Direction::Outgoing
            },
            scope,
            cursor,
        })
        .await
        .map_err(|e| e.to_string())
}

fn ensure_wallet(state: &WalletState, expected: &str) -> Result<(), String> {
    if get_wallet_address(state)? != expected {
        return Err("Your wallet changed. Review this action again.".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn set_scoped_delegation(
    rpc_url: String,
    expected_account: String,
    scope: ScopeChoice,
    delegate: Option<String>,
    generation: String,
    expected_genesis: String,
    state: State<'_, WalletState>,
) -> Result<TxResult, String> {
    stop_automation(&state)?;
    let _guard = state.signing.lock().await;
    ensure_wallet(&state, &expected_account)?;
    let keys = signing_keys(&state)?;
    let delegate = delegate
        .map(|value| parse_address(&value))
        .transpose()
        .map_err(|e| e.to_string())?;
    crate::commands::journaled_client(&state, &rpc_url, &expected_account)?
        .set_scoped_delegation(&keys, &scope, delegate.as_ref(), &generation, &expected_genesis)
        .await
        .map(tx_result)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vote_with_delegation(
    rpc_url: String,
    expected_account: String,
    entry: Entry,
    proposal: String,
    vote: String,
    state: State<'_, WalletState>,
) -> Result<TxResult, String> {
    stop_automation(&state)?;
    let _guard = state.signing.lock().await;
    ensure_wallet(&state, &expected_account)?;
    let keys = signing_keys(&state)?;
    let proposal = parse_hash(&proposal)
        .map_err(|e| e.to_string())?
        .into_tx_hash();
    use burst_transactions::governance::GovernanceVote;
    let vote = match vote.as_str() {
        "yea" => GovernanceVote::Yea,
        "nay" => GovernanceVote::Nay,
        "abstain" => GovernanceVote::Abstain,
        _ => return Err("Invalid vote".into()),
    };
    crate::commands::journaled_client(&state, &rpc_url, &expected_account)?
        .vote_with_delegation(&keys, &entry, proposal, vote)
        .await
        .map(tx_result)
        .map_err(|e| e.to_string())
}
