use crate::commands::{signing_keys, stop_automation, WalletState};
use burst_governance::{key_delegation::view, ProposalContent};
use burst_transactions::governance::GovernanceVote;
use burst_types::{appeal::AppealReview, ChallengeReason};
use burst_wallet_core::{offline::{OfflineAction, OfflineActionContext}, signed_client::{parse_address, parse_hash}};
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Request {
    Transfer { to: String, amount: String, origin: String },
    Merge { selected: Vec<burst_wallet_core::portfolio::MergeSelection> },
    Reject { payment: String },
    Endorse { target: String, amount: String },
    Challenge { target: String, stake: String, reason: String },
    Appeal { reviewed: AppealReview },
    VerificationVote { target: String, context: String, vote: u8, stake: String },
    Parameter { parameter: String, value: String, revision: String },
    Constitution { draft: crate::constitution::Draft, revision: String },
    Vote { proposal: String, vote: String },
    EndorseProposal { proposal: String, amount: String },
    Withdraw { proposal: String },
    Participation { enabled: bool },
    Delegation { scope: view::ScopeChoice, delegate: Option<String>, generation: String, genesis: String },
    DelegatedVote { entry: view::Entry, proposal: String, vote: String },
}

fn amount(value: &str) -> Result<u128, String> {
    if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err("Enter an exact non-negative amount.".into());
    }
    value.parse().map_err(|_| "Amount is too large.".into())
}
fn vote(value: &str) -> Result<GovernanceVote, String> {
    match value { "yea" => Ok(GovernanceVote::Yea), "nay" => Ok(GovernanceVote::Nay), "abstain" => Ok(GovernanceVote::Abstain), _ => Err("Choose support, oppose or abstain.".into()) }
}

#[derive(Serialize)]
pub struct Review {
    pub title: String,
    pub fields: Vec<(String, String)>,
}
#[derive(Serialize)]
pub struct Prepared {
    context: String,
    review: Review,
}
fn units(raw: u128, unit: &str) -> String {
    let fraction = format!("{:018}", raw % 1_000_000_000_000_000_000).trim_end_matches('0').to_string();
    format!("{}{} {unit}", raw / 1_000_000_000_000_000_000,
        if fraction.is_empty() { String::new() } else { format!(".{fraction}") })
}
fn brn(raw: u128) -> String { units(raw, "BRN") }
fn choice(vote: GovernanceVote) -> &'static str {
    match vote { GovernanceVote::Yea => "Support", GovernanceVote::Nay => "Oppose", GovernanceVote::Abstain => "Abstain" }
}
fn proposal_fields(content: &ProposalContent) -> Vec<(String, String)> {
    match content {
        ProposalContent::ParameterChange { param, new_value } => vec![("Parameter".into(), param.name().into()), ("Proposed value (raw units)".into(), new_value.to_string())],
        _ => vec![("Complete proposal".into(), serde_json::to_string_pretty(content).expect("proposal content is serializable"))],
    }
}
fn describe(action: &OfflineAction) -> Review {
    let mut fields = Vec::new();
    let mut field = |label: &str, value: String| fields.push((label.into(), value));
    let title = match action {
        OfflineAction::Transfer { to, amount, origin } => { field("To", to.to_string()); field("Amount", units(*amount,"TRST")); field("Origin", origin.to_string()); field("Age", "Original age and expiry are preserved.".into()); "Transfer TRST" }
        OfflineAction::Merge { selected } => {
            let total = selected.iter().try_fold(0u128, |total, batch| total.checked_add(batch.amount.parse().ok()?));
            field("Combined amount", total.map(|value| units(value,"TRST")).unwrap_or_else(|| "Invalid amount".into()));
            field("Batches", selected.iter().map(|batch| batch.id.as_str()).collect::<Vec<_>>().join("\n"));
            field("Age", "Keeps the oldest age. Newer TRST may expire sooner. This cannot be undone.".into());
            if selected.first().is_some_and(|batch| batch.status == "expired") { field("Status", "Expired reputation; not spendable.".into()); }
            "Combine batches"
        }
        OfflineAction::Reject { payment } => { field("Payment", payment.to_string()); field("Return", "Returns TRST to its sender to claim. Does not reverse a BRN burn.".into()); "Return payment" }
        OfflineAction::Endorse { target, burn } => { field("Wallet", target.to_string()); field("Permanently burn", brn(*burn)); "Endorse identity" }
        OfflineAction::Challenge { target, stake, reason } => { field("Wallet", target.to_string()); field("Reason", format!("{reason:?}")); field("Stake at risk", brn(*stake)); "Challenge identity" }
        OfflineAction::Appeal { reviewed } => { field("Wallet", reviewed.account.clone()); field("Stake at risk", reviewed.required_stake.parse().map(brn).unwrap_or_else(|_| "Invalid stake".into())); if let Some(outcome) = &reviewed.outcome { field("Decision", format!("{:?}: {}", outcome.reason, if outcome.legitimate {"dismissed"} else {"confirmed"})); field("Outcome", outcome.hash.clone()); } "Appeal decision" }
        OfflineAction::VerificationVote { target, context, vote, stake } => { field("Wallet", target.to_string()); field("Decision", match vote {1=>"Legitimate",2=>"Illegitimate",_=>"Neither"}.into()); field("Stake at risk", brn(*stake)); field("Panel context", context.to_string()); "Identity review" }
        OfflineAction::Proposal { content } => { fields = proposal_fields(content); "Publish proposal" }
        OfflineAction::GovernanceVote { proposal, vote } => { field("Proposal", proposal.to_string()); field("Vote", choice(*vote).into()); "Governance vote" }
        OfflineAction::GovernanceEndorse { proposal, burn } => { field("Proposal", proposal.to_string()); field("Permanently burn", brn(*burn)); "Endorse proposal" }
        OfflineAction::GovernanceWithdraw { proposal } => { field("Proposal", proposal.to_string()); "Withdraw proposal" }
        OfflineAction::VerifierParticipation { enabled } => { field("Participation", if *enabled {"Join verifier pool"} else {"Leave verifier pool"}.into()); "Verifier participation" }
        OfflineAction::Delegation { scope, delegate, generation, genesis } => { field("Scope", format!("{scope:?}")); field("Delegate", delegate.as_ref().map(ToString::to_string).unwrap_or_else(|| "Revoke delegation".into())); field("Reviewed generation", generation.clone()); field("Network genesis", genesis.clone()); "Voting delegation" }
        OfflineAction::DelegatedVote { entry, proposal, vote } => { field("For", entry.owner.clone()); field("Proposal", proposal.to_string()); field("Vote", choice(*vote).into()); field("Scope", format!("{:?}", entry.scope)); field("Grant", entry.grant_block.clone().unwrap_or_default()); "Delegated ballot" }
    };
    Review { title:title.into(), fields }
}

#[tauri::command]
pub async fn prepare_offline_review(rpc_url: String, expected_account: String, request: Request, state: State<'_, WalletState>) -> Result<Prepared, String> {
    stop_automation(&state)?;
    let _guard = state.signing.lock().await;
    crate::offline::draft_path(&state, &expected_account)?;
    let keys = signing_keys(&state)?;
    let account = burst_crypto::derive_address(&keys.public);
    if account.as_str() != expected_account { return Err("Your wallet changed. Review again.".into()); }
    let client = crate::commands::journaled_client(&state, &rpc_url, &expected_account)?;
    let address = |value: &str| parse_address(value).map_err(|error| error.to_string());
    let hash = |value: &str| parse_hash(value).map(|hash| hash.into_tx_hash()).map_err(|error| error.to_string());
    let action = match request {
        Request::Transfer { to, amount: raw, origin } => OfflineAction::Transfer {to:address(&to)?, amount:amount(&raw)?, origin:hash(&origin)?},
        Request::Merge { selected } => OfflineAction::Merge {selected},
        Request::Reject { payment } => OfflineAction::Reject {payment:hash(&payment)?},
        Request::Endorse { target, amount: raw } => OfflineAction::Endorse { target:address(&target)?, burn:amount(&raw)? },
        Request::Challenge { target, stake, reason } => OfflineAction::Challenge { target:address(&target)?, stake:amount(&stake)?, reason:match reason.as_str() {"fraud"=>ChallengeReason::Fraud,"inactivity"=>ChallengeReason::Inactivity,_=>return Err("Choose a challenge reason.".into())} },
        Request::Appeal { reviewed } => OfflineAction::Appeal { reviewed },
        Request::VerificationVote { target, context, vote, stake } => OfflineAction::VerificationVote { target:address(&target)?, context:parse_hash(&context).map_err(|error| error.to_string())?, vote, stake:amount(&stake)? },
        Request::Parameter { parameter, value, revision } => {
            let current = crate::constitution::context(&client, expected_account.clone()).await?;
            if current.revision != revision { return Err("Network rules changed. Review the proposal again.".into()); }
            OfflineAction::Proposal { content:ProposalContent::ParameterChange { param:burst_governance::GovernableParam::from_name(&parameter).map_err(|error| error.to_string())?, new_value:crate::constitution::parameter_value(&current, &parameter, &value)? } }
        }
        Request::Constitution { draft, revision } => {
            let current = crate::constitution::context(&client, expected_account.clone()).await?;
            if current.revision != revision { return Err("The constitution changed. Review the amendment again.".into()); }
            OfflineAction::Proposal { content:draft.content()? }
        }
        Request::Vote { proposal, vote: selected } => OfflineAction::GovernanceVote { proposal:hash(&proposal)?, vote:vote(&selected)? },
        Request::EndorseProposal { proposal, amount: raw } => OfflineAction::GovernanceEndorse { proposal:hash(&proposal)?, burn:amount(&raw)? },
        Request::Withdraw { proposal } => OfflineAction::GovernanceWithdraw { proposal:hash(&proposal)? },
        Request::Participation { enabled } => OfflineAction::VerifierParticipation { enabled },
        Request::Delegation { scope, delegate, generation, genesis } => OfflineAction::Delegation { scope, delegate:delegate.as_deref().map(address).transpose()?, generation, genesis },
        Request::DelegatedVote { entry, proposal, vote: selected } => OfflineAction::DelegatedVote { entry:Box::new(entry), proposal:hash(&proposal)?, vote:vote(&selected)? },
    };
    let context = client.prepare_offline_action(&account, action).await.map_err(|error| error.to_string())?;
    prepared(context)
}
fn prepared(context: OfflineActionContext) -> Result<Prepared, String> {
    let mut review = describe(context.action());
    if matches!(context.action(), OfflineAction::Reject {..}) {
        let info = context.review();
        review.fields.push(("From".into(), info["sender"].as_str().ok_or("Missing payment sender")?.into()));
        review.fields.push(("Amount".into(), units(amount(info["amount"].as_str().ok_or("Missing payment amount")?)?,"TRST")));
    }
    // Proposal RPC content is displayed as text, never parsed back into signing input.
    if matches!(context.action(), OfflineAction::GovernanceVote { .. } | OfflineAction::GovernanceEndorse { .. } | OfflineAction::DelegatedVote { .. }) {
        let info = context.review();
        for (key, label) in [("amendment_text", "Amendment"), ("param", "Parameter"), ("proposed_value", "Proposed value")] {
            if let Some(value) = info.get(key).filter(|value| !value.is_null()) { review.fields.push((label.into(), value.as_str().map(str::to_owned).unwrap_or_else(|| value.to_string()))); }
        }
        if let Some(value) = info.get("amendment_operations").filter(|value| !value.is_null()) { review.fields.push(("Complete changes".into(), serde_json::to_string_pretty(value).map_err(|error| error.to_string())?)); }
    }
    Ok(Prepared { context:serde_json::to_string(&context).map_err(|error| error.to_string())?, review })
}

#[tauri::command]
pub async fn review_saved_offline_action(rpc_url: String, expected_account: String, expected_hash: String, state: State<'_, WalletState>) -> Result<Review, String> {
    use burst_ledger::BlockType;
    use burst_governance::key_delegation::operation::DelegationOperation;
    let _guard = state.signing.lock().await;
    let path = crate::offline::draft_path(&state, &expected_account)?;
    let (block, content) = burst_wallet_core::offline::load_action_with_content(&path).map_err(|error| error.to_string())?;
    if block.account.as_str() != expected_account || block.hash.to_string() != expected_hash { return Err("Saved action changed. Review again.".into()); }
    let mut fields = vec![("Wallet".into(), expected_account)];
    let target = || burst_crypto::derive_address(&burst_types::PublicKey(*block.link.as_bytes())).to_string();
    let title = if !block.delegation_payload.is_empty() {
        match DelegationOperation::decode(&block.delegation_payload).map_err(|error| error.to_string())? {
            DelegationOperation::Grant(grant) => { fields.extend([("Delegate".into(), burst_crypto::derive_address(&grant.delegate).to_string()), ("Scope".into(), format!("{:?}", grant.scope)), ("Generation".into(), grant.generation.to_string())]); "Voting delegation" }
            DelegationOperation::Revoke(revoked) => { fields.extend([("Scope".into(), format!("{:?}", revoked.scope)), ("Generation".into(), revoked.generation.to_string())]); "Revoke delegation" }
            DelegationOperation::Ballot { ballot, grant_block } => { fields.extend([("For".into(), ballot.owner.to_string()), ("Proposal".into(), ballot.proposal.to_string()), ("Vote".into(), choice(ballot.vote).into()), ("Grant".into(), grant_block.to_string())]); "Delegated ballot" }
        }
    } else {
        match block.block_type {
            BlockType::Send => { fields.extend([("To".into(),target()),("Origin".into(),block.origin.to_string()),("Age".into(),"Original age and expiry are preserved.".into())]); "Transfer TRST" }
            BlockType::Merge => { fields.extend([("Batches".into(),block.merge_sources.iter().map(ToString::to_string).collect::<Vec<_>>().join("\n")),("Age".into(),"Keeps the oldest age. Newer TRST may expire sooner. This cannot be undone.".into())]); "Combine batches" }
            BlockType::RejectReceive => { fields.extend([("Payment".into(),block.link.to_string()),("Return".into(),"Returns TRST to its sender to claim. Does not reverse a BRN burn.".into())]); "Return payment" }
            BlockType::Endorse => { fields.push(("Endorsing".into(), target())); "Endorse identity" }
            BlockType::Challenge => {
                fields.push(("Target wallet".into(), target()));
                fields.push(("Reason".into(), format!("{:?}", ChallengeReason::from_origin(block.origin.as_bytes()))));
                if !block.target_head.is_zero() { fields.push(("Appealed outcome".into(), block.target_head.to_string())); "Appeal decision" } else { "Challenge identity" }
            }
            BlockType::VerificationVote => { fields.extend([("Target wallet".into(), target()), ("Decision".into(), match block.transaction.as_bytes()[0] {1=>"Legitimate",2=>"Illegitimate",3=>"Neither",_=>return Err("Invalid vote".into())}.into()), ("Panel context".into(), block.origin.to_string())]); "Identity review" }
            BlockType::GovernanceProposal => {
                let manifest = burst_governance::content::ContentManifest::from_block_fields(block.link, block.origin, block.transaction).map_err(|error| error.to_string())?.ok_or("Missing full proposal content")?;
                let proposal = manifest.decode_verified(content.as_deref().ok_or("Missing proposal content")?).map_err(|error| error.to_string())?;
                fields.extend(proposal_fields(&proposal)); "Publish proposal"
            }
            BlockType::GovernanceVote => { fields.extend([("Proposal".into(), block.link.to_string()), ("Vote".into(), match block.transaction.as_bytes()[0] {0=>"Support",1=>"Oppose",2=>"Abstain",_=>return Err("Invalid vote".into())}.into())]); "Governance vote" }
            BlockType::GovernanceEndorse => { fields.push(("Proposal".into(), block.link.to_string())); "Endorse proposal" }
            BlockType::GovernanceWithdraw => { fields.push(("Proposal".into(), block.link.to_string())); "Withdraw proposal" }
            BlockType::VerifierOptIn => "Join verifier pool",
            BlockType::VerifierOptOut => "Leave verifier pool",
            _ => return Err("This saved transaction needs its original review flow.".into()),
        }
    };
    if matches!(block.block_type, BlockType::Endorse | BlockType::Challenge | BlockType::VerificationVote | BlockType::GovernanceEndorse | BlockType::Send) {
        let client = burst_wallet_core::NodeClient::new(rpc_url).map_err(|error| error.to_string())?;
        let previous = client.rpc_call("block_info", serde_json::json!({"hash":block.previous.to_string()})).await.map_err(|error| error.to_string())?;
        if previous["account"].as_str() != Some(block.account.as_str()) || previous["confirmed"] != true { return Err("Cannot verify the saved action's previous balance.".into()); }
        if block.block_type == BlockType::Send {
            let balance = amount(previous["trst_balance"].as_str().ok_or("Missing previous TRST balance")?)?;
            let cost = balance.checked_sub(block.trst_balance).filter(|value|*value>0).ok_or("Invalid saved transfer amount")?;
            fields.push(("Amount".into(),units(cost,"TRST")));
        } else {
        let spent = amount(previous["brn_balance"].as_str().ok_or("Missing previous BRN balance")?)?;
        let cost = block.brn_balance.checked_sub(spent).ok_or("Invalid saved BRN amount")?;
        fields.push((if matches!(block.block_type, BlockType::Endorse | BlockType::GovernanceEndorse) {"Permanently burn"} else {"Stake at risk"}.into(), brn(cost)));
        }
    }
    Ok(Review { title:title.into(), fields })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn offline_action_bridge_keeps_exact_amounts_and_review_text() {
        assert_eq!(brn(1_000_000_000_000_000_001), "1.000000000000000001 BRN");
        assert_eq!(amount(&u128::MAX.to_string()).unwrap(), u128::MAX);
        for value in ["-1", "1e18", "1.1", "", "340282366920938463463374607431768211456"] { assert!(amount(value).is_err()); }
        let request: Request = serde_json::from_str(r#"{"kind":"endorse","target":"wallet","amount":"1000000000000000001"}"#).unwrap();
        assert!(matches!(request, Request::Endorse {amount, ..} if amount == "1000000000000000001"));
        assert!(serde_json::from_str::<Request>(r#"{"kind":"endorse","target":"wallet","amount":1000000000000000001}"#).is_err());
        let review = describe(&OfflineAction::Proposal {content:ProposalContent::ParameterChange {param:burst_governance::GovernableParam::BrnRate,new_value:u128::MAX}});
        assert_eq!(review.fields[1].1, u128::MAX.to_string());
        assert!(vote("unexpected").is_err());
        let target=burst_crypto::derive_address(&burst_crypto::keypair_from_seed(&[1;32]).public);
        let review=describe(&OfflineAction::Transfer {to:target,amount:1_000_000_000_000_000_001,origin:burst_types::TxHash::new([2;32])});
        assert_eq!(review.fields[1].1,"1.000000000000000001 TRST");
        assert!(matches!(serde_json::from_str::<Request>(r#"{"kind":"reject","payment":"saved-hash"}"#).unwrap(),Request::Reject {..}));
    }
}
