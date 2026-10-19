use burst_groups::{GroupClient, GroupInfo, GroupRegistry};
use burst_wallet_core::trust_policy::OfflineFallback;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GroupMode {
    #[default]
    Protocol,
    Any,
    All,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct GroupEndpoint {
    pub id: String,
    pub name: String,
    pub description: String,
    pub endpoint_url: String,
    #[serde(default = "trust_directly_default")]
    pub trust_directly: bool,
}

fn trust_directly_default() -> bool {
    true
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct GroupPolicy {
    pub mode: GroupMode,
    pub groups: Vec<GroupEndpoint>,
    pub offline_fallback: OfflineFallback,
    #[serde(default)]
    pub max_hops: u8,
}

impl Default for GroupPolicy {
    fn default() -> Self {
        Self {
            mode: GroupMode::Protocol,
            groups: Vec::new(),
            offline_fallback: OfflineFallback::Protocol,
            max_hops: 0,
        }
    }
}

impl GroupPolicy {
    pub fn registry(&self) -> Result<GroupRegistry, String> {
        if self.groups.len() > 32 {
            return Err("Choose at most 32 groups".into());
        }
        if self.max_hops > burst_groups::trust_graph::MAX_TRUST_HOPS {
            return Err("Group trust depth must be between 0 and 8".into());
        }
        if self.mode != GroupMode::Protocol && !self.groups.iter().any(|group| group.trust_directly)
        {
            return Err("Choose a group or use protocol checks only".into());
        }
        let mut registry = GroupRegistry::new();
        for group in &self.groups {
            registry
                .register(GroupInfo {
                    id: group.id.clone(),
                    name: group.name.clone(),
                    description: group.description.clone(),
                    endpoint_url: group.endpoint_url.clone(),
                    member_count: 0,
                })
                .map_err(|error| error.to_string())?;
        }
        Ok(registry)
    }
}

#[tauri::command]
pub fn validate_group_policy(policy: GroupPolicy) -> Result<GroupPolicy, String> {
    policy.registry()?;
    Ok(policy)
}

#[tauri::command]
pub async fn load_group_directory(url: String) -> Result<Vec<GroupEndpoint>, String> {
    let registry = GroupClient::new()
        .map_err(|error| error.to_string())?
        .fetch_directory(&url)
        .await
        .map_err(|error| error.to_string())?;
    Ok(registry
        .list()
        .into_iter()
        .map(|group| GroupEndpoint {
            id: group.id.clone(),
            name: group.name.clone(),
            description: group.description.clone(),
            endpoint_url: group.endpoint_url.clone(),
            trust_directly: true,
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_rules_stay_direct_and_graph_requires_an_explicit_root() {
        let mut policy: GroupPolicy = serde_json::from_value(serde_json::json!({
            "mode":"any","offline_fallback":"protocol","groups":[{
                "id":"root","name":"Root","description":"","endpoint_url":"https://root.example.test"
            }]
        })).unwrap();
        assert_eq!(policy.max_hops, 0);
        assert!(policy.groups[0].trust_directly);
        assert!(policy.registry().is_ok());
        policy.max_hops = 2;
        policy.groups[0].trust_directly = false;
        assert!(policy.registry().is_err());
        policy.groups[0].trust_directly = true;
        assert!(policy.registry().is_ok());
        policy.max_hops = 9;
        assert!(policy.registry().is_err());
    }

    #[test]
    fn protocol_is_explicit_and_group_modes_require_real_validated_endpoints() {
        assert!(GroupPolicy::default().registry().is_ok());
        let mut policy = GroupPolicy {
            mode: GroupMode::Any,
            ..Default::default()
        };
        assert!(policy.registry().is_err());
        policy.groups.push(GroupEndpoint {
            id: "local".into(),
            name: "Local".into(),
            description: String::new(),
            endpoint_url: "https://example.test".into(),
            trust_directly: true,
        });
        assert!(policy.registry().is_ok());
        policy.groups.push(policy.groups[0].clone());
        assert!(policy.registry().is_err());
        policy.groups.truncate(1);
        policy.groups[0].endpoint_url = "file:///tmp/groups".into();
        assert!(policy.registry().is_err());
        assert!(serde_json::from_value::<GroupPolicy>(
            serde_json::json!({"mode":"any","groups":[]})
        )
        .is_err());
        assert!(serde_json::from_value::<GroupPolicy>(
            serde_json::json!({"mode":"unknown","groups":[],"offline_fallback":"protocol"})
        )
        .is_err());
    }
}
