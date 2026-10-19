use super::*;
use burst_types::appeal::{AppealOutcome, AppealReview};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

fn review() -> AppealReview {
    AppealReview {
        account: Wallet::from_seed(&[19; 32]).address.to_string(),
        enabled: true,
        challenge_active: false,
        required_stake: "100".into(),
        outcome: Some(AppealOutcome {
            hash: "ab".repeat(32),
            checkpoint: "cd".repeat(32),
            reason: burst_types::ChallengeReason::Fraud,
            legitimate: false,
            completed_at: 1,
        }),
    }
}

fn loaded() -> (WalletState, String) {
    let state = WalletState::default();
    let wallet = Wallet::from_seed(&[18; 32]);
    let account = wallet.address.to_string();
    *state.wallet.lock().unwrap() = Some(wallet);
    (state, account)
}

#[tokio::test]
async fn manual_actions_bind_the_review_before_building_a_transaction() {
    let (state, account) = loaded();
    let error = submit_wallet_action(&state, "invalid URL", "another wallet", |_| {
        panic!("changed wallet reached the transaction builder")
    })
    .await
    .unwrap_err();
    assert_eq!(error, "Your wallet changed. Review this action again.");
    let error = submit_wallet_action(&state, "invalid URL", &account, |signer| {
        assert_eq!(signer.as_str(), account);
        Err(burst_wallet_core::WalletError::TransactionBuild(
            "checked signer".into(),
        ))
    })
    .await
    .unwrap_err();
    assert!(error.contains("checked signer"));
}

#[test]
fn reviewed_keys_are_bound_to_the_keypair_not_cached_wallet_metadata() {
    let (state, account) = loaded();
    state.wallet.lock().unwrap().as_mut().unwrap().address = Wallet::from_seed(&[20; 32]).address;
    assert!(reviewed_signing_keys(&state, &account).is_ok());
    let other = get_wallet_address(&state).unwrap();
    assert!(reviewed_signing_keys(&state, &other).is_err());
}

#[tokio::test]
async fn appeal_requires_the_reviewed_signer_before_contacting_the_node() {
    let (state, _) = loaded();
    let review = review();
    for expected in ["", "invalid", review.account.as_str()] {
        let error = submit_appeal("invalid URL", &review, expected, &state)
            .await
            .unwrap_err();
        assert_eq!(
            error,
            "appeal not submitted: Your wallet changed. Review this action again."
        );
    }
}

#[tokio::test]
async fn appeal_rechecks_the_signer_after_waiting_for_the_signing_lock() {
    let (state, account) = loaded();
    let guard = state.signing.lock().await;
    let review = review();
    let mut pending = Box::pin(submit_appeal("invalid URL", &review, &account, &state));
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(10), &mut pending)
            .await
            .is_err()
    );
    *state.wallet.lock().unwrap() = Some(Wallet::from_seed(&[20; 32]));
    drop(guard);
    assert_eq!(
        pending.await.unwrap_err(),
        "appeal not submitted: Your wallet changed. Review this action again."
    );
}

#[tokio::test]
async fn locked_wallet_is_an_unsubmitted_appeal() {
    let error = submit_appeal("invalid URL", &review(), "", &WalletState::default())
        .await
        .unwrap_err();
    assert_eq!(error, "appeal not submitted: Wallet not loaded");
}

#[tokio::test]
async fn matching_sponsor_rechecks_the_target_without_submitting_a_changed_review() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let review = review();
    let mut current = review.clone();
    current.challenge_active = true;
    let reply = serde_json::to_string(&current).unwrap();
    let target = review.account.clone();
    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let mut request = Vec::new();
        loop {
            let mut buffer = [0; 1024];
            let count = stream.read(&mut buffer).await.unwrap();
            assert!(count > 0);
            request.extend_from_slice(&buffer[..count]);
            assert!(request.len() < 8192);
            if let Some(end) = request.windows(4).position(|bytes| bytes == b"\r\n\r\n") {
                if let Ok(body) = serde_json::from_slice::<serde_json::Value>(&request[end + 4..]) {
                    assert_eq!(body["action"], "appeal_review");
                    assert_eq!(body["account"], target);
                    break;
                }
            }
        }
        let response = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", reply.len(), reply);
        stream.write_all(response.as_bytes()).await.unwrap();
        listener
    });
    let (state, account) = loaded();
    let journal = tempfile::tempdir().unwrap();
    state.offline_directory.set(journal.path().to_path_buf()).unwrap();
    offline_reservation_tests::bind_test_device(&state);
    let error = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        submit_appeal(&url, &review, &account, &state),
    )
    .await
    .unwrap()
    .unwrap_err();
    assert!(error.starts_with("appeal not submitted:"), "{error}");
    assert!(error.contains("A review is already active"), "{error}");
    let listener = server.await.unwrap();
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(20), listener.accept())
            .await
            .is_err()
    );
}
