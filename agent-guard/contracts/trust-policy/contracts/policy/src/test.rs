#![cfg(test)]
use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    Address, Env, Vec,
};

fn setup_env() -> (Env, Address, TrustPolicyContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, TrustPolicyContract);
    let client = TrustPolicyContractClient::new(&env, &contract_id);
    let owner = Address::generate(&env);
    (env, owner, client)
}

fn default_allowlist(env: &Env, recipients: &[Address]) -> Vec<Address> {
    let mut list = Vec::new(env);
    for r in recipients {
        list.push_back(r.clone());
    }
    list
}

// ── Initialization tests ──────────────────────────────────────────────────────

#[test]
fn test_initialize_success() {
    let (env, owner, client) = setup_env();
    let recipient = Address::generate(&env);
    let allowlist = default_allowlist(&env, &[recipient]);

    client.initialize(&owner, &5_000_000, &20_000_000, &100_000_000, &allowlist);

    let (stored_owner, per_tx, daily, total, spent_today, spent_total, revoked)
        = client.get_policy();

    assert_eq!(stored_owner, owner);
    assert_eq!(per_tx, 5_000_000);
    assert_eq!(daily, 20_000_000);
    assert_eq!(total, 100_000_000);
    assert_eq!(spent_today, 0);
    assert_eq!(spent_total, 0);
    assert!(!revoked);
}

#[test]
#[should_panic]
fn test_initialize_twice_panics() {
    let (env, owner, client) = setup_env();
    let allowlist = Vec::new(&env);
    client.initialize(&owner, &1_000_000, &10_000_000, &100_000_000, &allowlist);
    client.initialize(&owner, &1_000_000, &10_000_000, &100_000_000, &allowlist);
}

// ── authorize() tests ─────────────────────────────────────────────────────────

#[test]
fn test_authorize_passes_under_all_caps() {
    let (env, owner, client) = setup_env();
    let recipient = Address::generate(&env);
    let allowlist = default_allowlist(&env, &[recipient.clone()]);

    client.initialize(&owner, &5_000_000, &20_000_000, &100_000_000, &allowlist);

    let result = client.authorize(&recipient, &3_000_000);
    assert!(result);
}

#[test]
fn test_authorize_blocked_by_per_tx_cap() {
    let (env, owner, client) = setup_env();
    let recipient = Address::generate(&env);
    let allowlist = default_allowlist(&env, &[recipient.clone()]);

    client.initialize(&owner, &5_000_000, &20_000_000, &100_000_000, &allowlist);

    // Request 6 USDC — over per_tx cap of 5
    let result = client.authorize(&recipient, &6_000_000);
    assert!(!result);
}

#[test]
fn test_authorize_blocked_by_daily_cap() {
    let (env, owner, client) = setup_env();
    let recipient = Address::generate(&env);
    let allowlist = default_allowlist(&env, &[recipient.clone()]);

    // per_tx=5, daily=8, total=100
    client.initialize(&owner, &5_000_000, &8_000_000, &100_000_000, &allowlist);

    // First payment: 5 USDC — ok
    assert!(client.authorize(&recipient, &5_000_000));
    // Second payment: 5 USDC — would bring daily to 10, over cap of 8
    assert!(!client.authorize(&recipient, &5_000_000));
}

#[test]
fn test_authorize_blocked_by_total_budget() {
    let (env, owner, client) = setup_env();
    let recipient = Address::generate(&env);
    let allowlist = default_allowlist(&env, &[recipient.clone()]);

    // per_tx=5, daily=20, total=7
    client.initialize(&owner, &5_000_000, &20_000_000, &7_000_000, &allowlist);

    assert!(client.authorize(&recipient, &5_000_000));
    // Next payment would bring total to 10, over budget of 7
    assert!(!client.authorize(&recipient, &5_000_000));
}

#[test]
fn test_authorize_blocked_recipient_not_in_allowlist() {
    let (env, owner, client) = setup_env();
    let allowed = Address::generate(&env);
    let stranger = Address::generate(&env);
    let allowlist = default_allowlist(&env, &[allowed]);

    client.initialize(&owner, &5_000_000, &20_000_000, &100_000_000, &allowlist);

    let result = client.authorize(&stranger, &1_000_000);
    assert!(!result);
}

// ── revoke/resume tests ───────────────────────────────────────────────────────

#[test]
fn test_authorize_blocked_by_revoke() {
    let (env, owner, client) = setup_env();
    let recipient = Address::generate(&env);
    let allowlist = default_allowlist(&env, &[recipient.clone()]);

    client.initialize(&owner, &5_000_000, &20_000_000, &100_000_000, &allowlist);

    // Confirm payment works before revoke
    assert!(client.authorize(&recipient, &1_000_000));

    // Revoke
    client.revoke();

    // Now authorize must return false
    assert!(!client.authorize(&recipient, &1_000_000));
}

#[test]
fn test_resume_re_enables_after_revoke() {
    let (env, owner, client) = setup_env();
    let recipient = Address::generate(&env);
    let allowlist = default_allowlist(&env, &[recipient.clone()]);

    client.initialize(&owner, &5_000_000, &20_000_000, &100_000_000, &allowlist);
    client.revoke();
    assert!(!client.authorize(&recipient, &1_000_000));

    client.resume();
    assert!(client.authorize(&recipient, &1_000_000));
}

// ── Daily reset test ──────────────────────────────────────────────────────────

#[test]
fn test_daily_reset_after_24h() {
    let (env, owner, client) = setup_env();
    let recipient = Address::generate(&env);
    let allowlist = default_allowlist(&env, &[recipient.clone()]);

    // daily=8
    client.initialize(&owner, &5_000_000, &8_000_000, &100_000_000, &allowlist);

    assert!(client.authorize(&recipient, &5_000_000));
    assert!(!client.authorize(&recipient, &5_000_000));

    // Advance ledger time by 25 hours
    env.ledger().set(LedgerInfo {
        timestamp: env.ledger().timestamp() + 90_000, // 25h in seconds
        protocol_version: 20,
        sequence_number: env.ledger().sequence() + 100,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 1,
        min_persistent_entry_ttl: 1,
        max_entry_ttl: 1000,
    });

    // After reset, daily spend should be 0 again
    assert!(client.authorize(&recipient, &5_000_000));
}

// ── Allowlist management tests ────────────────────────────────────────────────

#[test]
fn test_add_remove_allowlist() {
    let (env, owner, client) = setup_env();
    let r1 = Address::generate(&env);
    let r2 = Address::generate(&env);
    let allowlist = default_allowlist(&env, &[r1.clone()]);

    client.initialize(&owner, &5_000_000, &20_000_000, &100_000_000, &allowlist);

    // r2 is not allowed yet
    assert!(!client.authorize(&r2, &1_000_000));

    // Add r2
    client.add_to_allowlist(&r2);
    assert!(client.authorize(&r2, &1_000_000));

    // Remove r2
    client.remove_from_allowlist(&r2);
    assert!(!client.authorize(&r2, &1_000_000));
}
