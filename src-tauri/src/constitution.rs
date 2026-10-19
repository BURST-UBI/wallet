use crate::commands::{
    get_wallet_address, signing_keys, stop_automation, tx_result, TxResult, WalletState,
};
use burst_governance::{proposal::AmendmentOp, ProposalContent};
use burst_wallet_core::{
    delegation::view::{Direction, Query, ScopeChoice},
    NodeClient,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;

#[derive(Clone, Deserialize, Serialize)]
pub enum Edit {
    AddArticle {
        title: String,
        text: String,
    },
    ModifyArticle {
        article_number: String,
        new_text: String,
    },
    RepealArticle {
        article_number: String,
    },
}

#[derive(Clone, Deserialize, Serialize)]
pub struct Draft {
    title: String,
    operations: Vec<Edit>,
}

impl Draft {
    pub(crate) fn content(self) -> Result<ProposalContent, String> {
        let number = |text: String| {
            text.parse::<u64>()
                .ok()
                .filter(|n| *n > 0)
                .ok_or_else(|| "Enter a valid article number.".to_string())
        };
        let operations = self
            .operations
            .into_iter()
            .map(|edit| {
                Ok(match edit {
                    Edit::AddArticle { title, text } => AmendmentOp::AddArticle { title, text },
                    Edit::ModifyArticle {
                        article_number,
                        new_text,
                    } => AmendmentOp::ModifyArticle {
                        article_number: number(article_number)?,
                        new_text,
                    },
                    Edit::RepealArticle { article_number } => AmendmentOp::RepealArticle {
                        article_number: number(article_number)?,
                    },
                })
            })
            .collect::<Result<_, String>>()?;
        let content = ProposalContent::ConstitutionalDiff {
            title: self.title,
            operations,
        };
        content.validate_content().map_err(|e| e.to_string())?;
        Ok(content)
    }
}

#[derive(Serialize)]
pub struct Context {
    enabled: bool,
    document: Value,
    genesis: String,
    params_hash: String,
    endorsement_cost: String,
    pub(crate) revision: String,
    parameters: Vec<burst_governance::params::view::ParameterValue>,
}

pub(crate) async fn context(client: &NodeClient, account: String) -> Result<Context, String> {
    let identity = client
        .delegation_keys(&Query {
            account,
            direction: Direction::Outgoing,
            scope: Some(ScopeChoice::Parameter("brn_rate".into())),
            cursor: None,
        })
        .await
        .map_err(|e| e.to_string())?;
    let capability = client
        .rpc_call("params_hash", json!({}))
        .await
        .map_err(|e| e.to_string())?;
    let params = client
        .rpc_call("protocol_params", json!({}))
        .await
        .map_err(|e| e.to_string())?;
    if capability["params_hash"] != params["params_hash"] {
        return Err("Network rules changed. Reload the constitution.".into());
    }
    let mut document = client
        .rpc_call("consti", json!({}))
        .await
        .map_err(|e| e.to_string())?;
    let version = document["version"]
        .as_u64()
        .ok_or("Missing constitution version")?;
    document["version"] = Value::String(version.to_string());
    let mut result = Context {
        enabled: capability["full_governance_content"] == true,
        document,
        genesis: identity.genesis,
        params_hash: params["params_hash"]
            .as_str()
            .ok_or("Missing parameter identity")?
            .into(),
        endorsement_cost: params["governance_endorsement_cost"]
            .as_str()
            .ok_or("Missing endorsement cost")?
            .into(),
        revision: String::new(),
        parameters: match params.get("governable_parameters") {
            Some(value) => serde_json::from_value(value.clone()).map_err(|e| e.to_string())?,
            None => Vec::new(),
        },
    };
    result.revision = hex::encode(burst_crypto::blake2b_256(
        &serde_json::to_vec(&result).map_err(|e| e.to_string())?,
    ));
    Ok(result)
}

#[tauri::command]
pub async fn get_constitution_context(
    rpc_url: String,
    state: State<'_, WalletState>,
) -> Result<Context, String> {
    let client = NodeClient::new(&rpc_url).map_err(|e| e.to_string())?;
    context(&client, get_wallet_address(&state)?).await
}

fn reviewed_wallet(state: &WalletState, expected: &str) -> Result<(), String> {
    if get_wallet_address(state)? != expected {
        return Err("Your wallet changed. Review this action again.".into());
    }
    Ok(())
}

pub(crate) fn parameter_value(current: &Context, name: &str, value: &str) -> Result<u128, String> {
    let row = current
        .parameters
        .iter()
        .find(|row| row.name == name)
        .ok_or("This node does not provide the requested parameter.")?;
    let param = burst_governance::GovernableParam::from_name(name).map_err(|e| e.to_string())?;
    let shape = param.value_view(&burst_types::ProtocolParams::burst_defaults());
    if row.maximum != shape.maximum || row.unit != shape.unit || row.legacy != shape.legacy {
        return Err("The node returned an incompatible parameter definition.".into());
    }
    if shape.legacy {
        return Err("This legacy parameter no longer changes protocol behavior.".into());
    }
    if value.is_empty() || !value.bytes().all(|ch| ch.is_ascii_digit()) {
        return Err("Enter an exact non-negative value.".into());
    }
    let value = value
        .parse::<u128>()
        .map_err(|_| "The proposed value is too large.")?;
    let maximum = row
        .maximum
        .parse::<u128>()
        .map_err(|_| "Invalid parameter limit")?;
    if value > maximum {
        return Err("The proposed value exceeds this parameter's storage range.".into());
    }
    if row.current.parse::<u128>().ok() == Some(value) {
        return Err("Choose a value different from the current value.".into());
    }
    Ok(value)
}

#[tauri::command]
pub async fn propose_parameter(
    rpc_url: String,
    expected_account: String,
    expected_revision: String,
    parameter: String,
    new_value: String,
    state: State<'_, WalletState>,
) -> Result<TxResult, String> {
    let param =
        burst_governance::GovernableParam::from_name(&parameter).map_err(|e| e.to_string())?;
    stop_automation(&state)?;
    let _guard = state.signing.lock().await;
    reviewed_wallet(&state, &expected_account)?;
    let keys = signing_keys(&state)?;
    let client = crate::commands::journaled_client(&state, &rpc_url, &expected_account)?;
    let current = context(&client, expected_account).await?;
    if current.revision != expected_revision {
        return Err("Network rules changed. Review your proposal again.".into());
    }
    let value = parameter_value(&current, &parameter, &new_value)?;
    client
        .propose_parameter_reviewed_signed(&keys, param, value, &current.params_hash)
        .await
        .map(tx_result)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn propose_constitution(
    rpc_url: String,
    expected_account: String,
    expected_revision: String,
    draft: Draft,
    state: State<'_, WalletState>,
) -> Result<TxResult, String> {
    let content = draft.content()?;
    stop_automation(&state)?;
    let _guard = state.signing.lock().await;
    reviewed_wallet(&state, &expected_account)?;
    let keys = signing_keys(&state)?;
    let client = crate::commands::journaled_client(&state, &rpc_url, &expected_account)?;
    let current = context(&client, expected_account).await?;
    if !current.enabled {
        return Err("Constitution proposals are not enabled on this node yet.".into());
    }
    if current.revision != expected_revision {
        return Err(
            "The constitution or network rules changed. Review your amendment again.".into(),
        );
    }
    client
        .propose_content_reviewed_signed(&keys, &content, &current.params_hash)
        .await
        .map(tx_result)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn endorse_governance_proposal(
    rpc_url: String,
    expected_account: String,
    expected_revision: String,
    proposal: String,
    state: State<'_, WalletState>,
) -> Result<TxResult, String> {
    stop_automation(&state)?;
    let _guard = state.signing.lock().await;
    reviewed_wallet(&state, &expected_account)?;
    let keys = signing_keys(&state)?;
    let client = crate::commands::journaled_client(&state, &rpc_url, &expected_account)?;
    let current = context(&client, expected_account).await?;
    if current.revision != expected_revision {
        return Err("Network rules changed. Review the endorsement again.".into());
    }
    let hash = burst_wallet_core::signed_client::parse_hash(&proposal)
        .map_err(|e| e.to_string())?
        .into_tx_hash();
    let cost = current
        .endorsement_cost
        .parse::<u128>()
        .map_err(|e| e.to_string())?;
    client
        .endorse_proposal_signed(&keys, hash, cost)
        .await
        .map(tx_result)
        .map_err(|e| e.to_string())
}

fn withdrawal_allowed(proposal: &Value, hash: &str, account: &str, now: u64) -> Result<(), String> {
    if proposal["hash"].as_str() != Some(hash) || proposal["proposer"].as_str() != Some(account) {
        return Err("Only the wallet that proposed this change can withdraw it.".into());
    }
    if proposal["phase"] != "Proposal"
        || !proposal["phase_deadline"]
            .as_u64()
            .is_some_and(|deadline| now < deadline)
    {
        return Err("This proposal can no longer be withdrawn. Refresh its status.".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn withdraw_governance_proposal(
    rpc_url: String,
    expected_account: String,
    expected_revision: String,
    proposal: String,
    state: State<'_, WalletState>,
) -> Result<TxResult, String> {
    let hash =
        burst_wallet_core::signed_client::parse_hash(&proposal).map_err(|e| e.to_string())?;
    stop_automation(&state)?;
    let _guard = state.signing.lock().await;
    reviewed_wallet(&state, &expected_account)?;
    let keys = signing_keys(&state)?;
    let client = crate::commands::journaled_client(&state, &rpc_url, &expected_account)?;
    let current = context(&client, expected_account.clone()).await?;
    if current.revision != expected_revision {
        return Err("Network rules changed. Review the withdrawal again.".into());
    }
    let proposal = client
        .rpc_call("governance_proposal_info", json!({"hash":hash.to_string()}))
        .await
        .map_err(|e| e.to_string())?;
    withdrawal_allowed(
        &proposal,
        &hash.to_string(),
        &expected_account,
        burst_types::Timestamp::now().as_secs(),
    )?;
    client
        .withdraw_proposal_signed(&keys, hash.into_tx_hash())
        .await
        .map(tx_result)
        .map_err(|e| e.to_string())
}

pub fn exact_article_numbers(proposal: &mut Value) {
    if let Some(operations) = proposal["amendment_operations"].as_array_mut() {
        for operation in operations {
            for kind in ["ModifyArticle", "RepealArticle"] {
                if let Some(number) = operation[kind]["article_number"].as_u64() {
                    operation[kind]["article_number"] = Value::String(number.to_string());
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn withdrawal_requires_owner_and_an_open_proposal_window() {
        let mut proposal = json!({"hash":"proposal", "proposer":"owner", "phase":"Proposal", "phase_deadline":100});
        assert!(withdrawal_allowed(&proposal, "proposal", "owner", 99).is_ok());
        assert!(withdrawal_allowed(&proposal, "other", "owner", 99).is_err());
        assert!(withdrawal_allowed(&proposal, "proposal", "other", 99).is_err());
        assert!(withdrawal_allowed(&proposal, "proposal", "owner", 100).is_err());
        for phase in [
            "Exploration",
            "Cooldown",
            "Activation",
            "Activated",
            "Rejected",
            "Withdrawn",
        ] {
            proposal["phase"] = json!(phase);
            assert!(withdrawal_allowed(&proposal, "proposal", "owner", 99).is_err());
        }
        proposal["phase"] = json!("Proposal");
        proposal["phase_deadline"] = Value::Null;
        assert!(withdrawal_allowed(&proposal, "proposal", "owner", 99).is_err());
    }
    #[test]
    fn parameter_review_rejects_rounding_overflow_legacy_and_incompatible_metadata() {
        let mut context = Context {
            enabled: false,
            document: json!({}),
            genesis: String::new(),
            params_hash: String::new(),
            endorsement_cost: "1".into(),
            revision: String::new(),
            parameters: burst_governance::params::view::snapshot(
                &burst_types::ProtocolParams::burst_defaults(),
            ),
        };
        assert_eq!(
            parameter_value(&context, "brn_rate", "2000000000000000001").unwrap(),
            2_000_000_000_000_000_001
        );
        assert_eq!(
            parameter_value(&context, "governance_quorum_bps", "0").unwrap(),
            0
        );
        assert_eq!(
            parameter_value(&context, "min_verification_age_secs", "0").unwrap(),
            0
        );
        assert_eq!(
            parameter_value(&context, "neither_penalty_cooldown_secs", "7").unwrap(),
            7
        );
        for (name, value) in [
            ("brn_rate", "1.5"),
            ("brn_rate", "-1"),
            ("brn_rate", "1e18"),
            ("brn_rate", "340282366920938463463374607431768211456"),
            ("num_verifiers", "4294967296"),
            ("trst_expiry_secs", "18446744073709551616"),
            ("governance_promotion_duration_secs", "1"),
            ("unknown", "1"),
        ] {
            assert!(
                parameter_value(&context, name, value).is_err(),
                "{name}: {value}"
            );
        }
        context.parameters[0].maximum = "1".into();
        assert!(parameter_value(&context, "brn_rate", "1")
            .unwrap_err()
            .contains("incompatible"));
    }

    #[test]
    fn preserves_unicode_and_large_article_numbers_without_javascript_rounding() {
        let draft: Draft = serde_json::from_value(json!({"title":"共同 🌍", "operations":[
            {"ModifyArticle":{"article_number":u64::MAX.to_string(),"new_text":"人 🌍"}},
            {"RepealArticle":{"article_number":"2"}}
        ]}))
        .unwrap();
        let ProposalContent::ConstitutionalDiff { operations, .. } = draft.content().unwrap()
        else {
            panic!()
        };
        assert!(
            matches!(&operations[0], AmendmentOp::ModifyArticle { article_number: u64::MAX, new_text } if new_text == "人 🌍")
        );
        let mut proposal = json!({"amendment_operations":operations});
        exact_article_numbers(&mut proposal);
        assert_eq!(
            proposal["amendment_operations"][0]["ModifyArticle"]["article_number"],
            u64::MAX.to_string()
        );
    }
}
