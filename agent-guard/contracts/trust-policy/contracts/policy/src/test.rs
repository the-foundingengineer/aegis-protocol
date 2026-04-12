#![cfg(test)]
use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger, LedgerInfo},
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

#[test]
fn test_full_lifecycle() {
    let (env, owner, client) = setup_env();
    let recipient = Address::generate(&env);
    let mut allowlist = Vec::new(&env);
    allowlist.push_back(recipient.clone());

    // Initialize: per_tx=5, daily=20, total=20
    client.initialize(&owner, &5, &20, &20, &allowlist);

    // 1. Valid payment
    assert!(client.authorize(&recipient, &3)); // Total 3

    // 2. Exceed per_tx
    assert!(!client.authorize(&recipient, &6));

    // 3. Check daily reset
    assert!(client.authorize(&recipient, &5)); // Total 8, Today 8
    
    // Advance ledger time by 25 hours
    env.ledger().set(LedgerInfo {
        timestamp: 90_000, 
        protocol_version: 20,
        sequence_number: 100,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 1,
        min_persistent_entry_ttl: 1,
        max_entry_ttl: 1000,
    });
    
    assert!(client.authorize(&recipient, &5)); // Total 13, Today 5. Reset works!

    // 4. Exceed total budget
    assert!(client.authorize(&recipient, &5)); // Total 18, Today 10
    assert!(!client.authorize(&recipient, &5)); // 18 + 5 = 23 > 20 (BLOCKED)

    // 5. Revoke / Resume
    client.revoke();
    assert!(!client.authorize(&recipient, &1)); // Blocked by revoke
    client.resume();
    assert!(client.authorize(&recipient, &1)); // Total 19, Today 11 (PASS)

    // 6. Hit total budget exactly
    assert!(client.authorize(&recipient, &1)); // Total 20, Today 12 (PASS)
    assert!(!client.authorize(&recipient, &1)); // Total 21 > 20 (BLOCKED)
}

#[test]
fn test_allowlist_management() {
    let (env, owner, client) = setup_env();
    let r1 = Address::generate(&env);
    let r2 = Address::generate(&env);
    client.initialize(&owner, &100, &1000, &10000, &Vec::new(&env));

    assert!(!client.authorize(&r1, &1));
    client.add_to_allowlist(&r1);
    assert!(client.authorize(&r1, &1));

    client.add_to_allowlist(&r2);
    assert!(client.authorize(&r2, &1));

    client.remove_from_allowlist(&r1);
    assert!(!client.authorize(&r1, &1));
    assert!(client.authorize(&r2, &1));
}
