# Engineer 1 — Full LLM Prompt Sequence
# TrustLayer: Soroban Contract + Backend Signing Server
# 12 prompts — execute in order, each builds on the last

---

## PROMPT E1-01 — Environment Setup

You are a Rust and Stellar/Soroban expert setting up a fresh development environment for a smart contract project called TrustLayer. Execute the following setup completely.

**Goal:** Have a working Soroban development environment with a funded testnet account.

**Steps to execute:**

1. Install the Rust toolchain:
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-unknown-unknown
```

2. Install stellar-cli (version 21 or latest stable):
```bash
cargo install --locked stellar-cli --features opt
```

3. Configure the testnet network:
```bash
stellar network add --global testnet \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015"
```

4. Generate a new keypair and fund it:
```bash
stellar keys generate --global owner --network testnet
stellar keys address owner
# Copy the public key output — save it as OWNER_PUBLIC_KEY in a .env file
```

5. Fund the account via friendbot:
```bash
curl "https://friendbot.stellar.org?addr=$(stellar keys address owner)"
```

6. Verify the account exists:
```bash
stellar account get --account-id $(stellar keys address owner) --network testnet
```

7. Create the project repo structure:
```
trustlayer/
  contracts/
    trust_policy/
      src/
        lib.rs
        test.rs
      Cargo.toml
  backend/
    src/
      index.ts
    package.json
    tsconfig.json
  .env.example
  README.md
```

8. Initialize the Soroban contract project:
```bash
cd trustlayer
stellar contract init contracts/trust_policy
```

**Deliverable:** Confirm the account is funded by running:
```bash
stellar account get --account-id $(stellar keys address owner) --network testnet | grep balance
```
You should see a non-zero XLM balance. Save the owner address and secret key to `.env`:
```
OWNER_PUBLIC_KEY=G...
OWNER_SECRET_KEY=S...
NETWORK=testnet
```

---

## PROMPT E1-02 — Hello World Deploy Proof

You are a Rust/Soroban engineer. Your goal is to deploy a working contract to Stellar testnet and invoke it — proving the toolchain works end to end before writing the real contract.

**Context:** You have completed E1-01. You have stellar-cli installed, a funded testnet account, and a project at `trustlayer/contracts/trust_policy/`.

**Step 1 — Write a minimal hello world contract** in `contracts/trust_policy/src/lib.rs`:

```rust
#![no_std]
use soroban_sdk::{contract, contractimpl, Env, Symbol, symbol_short};

#[contract]
pub struct TrustPolicyContract;

#[contractimpl]
impl TrustPolicyContract {
    pub fn hello(env: Env, to: Symbol) -> Symbol {
        symbol_short!("Hello")
    }
}

mod test;
```

**Step 2 — Write `contracts/trust_policy/Cargo.toml`:**

```toml
[package]
name = "trust-policy"
version = "0.1.0"
edition = "2021"
publish = false

[lib]
crate-type = ["cdylib"]

[features]
testutils = ["soroban-sdk/testutils"]

[dependencies]
soroban-sdk = { version = "21.0.0" }

[dev-dependencies]
soroban-sdk = { version = "21.0.0", features = ["testutils"] }

[profile.release]
opt-level = "z"
overflow-checks = true
debug = 0
strip = "symbols"
debug-assertions = false
panic = "abort"
codegen-units = 1
lto = true
```

**Step 3 — Create workspace `trustlayer/Cargo.toml`:**

```toml
[workspace]
resolver = "2"
members = ["contracts/trust_policy"]
```

**Step 4 — Build:**
```bash
cd trustlayer
stellar contract build
```
Confirm you see `target/wasm32-unknown-unknown/release/trust_policy.wasm`

**Step 5 — Deploy to testnet:**
```bash
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/trust_policy.wasm \
  --source owner \
  --network testnet
```
**Save the output contract ID** — it looks like `C...`. Add to `.env`:
```
HELLO_CONTRACT_ID=C...
```

**Step 6 — Invoke it:**
```bash
stellar contract invoke \
  --id $HELLO_CONTRACT_ID \
  --source owner \
  --network testnet \
  -- hello --to friend
```

**Deliverable:** You see `"Hello"` returned from the live testnet call. Screenshot or copy the transaction hash from the output. This confirms the full deploy → invoke pipeline works. Delete the hello function from lib.rs — you are now ready for the real contract.

---

## PROMPT E1-03 — Contract Data Model

You are a Rust/Soroban engineer designing the storage schema for a smart contract called TrustPolicy. This contract enforces spending rules for AI agents making payments on behalf of human owners.

**Context:** Soroban contracts use a key-value storage model. Keys must be variants of a `#[contracttype]` enum. There are three storage tiers: `instance` (evicts with contract), `persistent` (survives eviction, requires rent), `temporary` (auto-expires). Use `instance` for all policy state since it is always needed when the contract is called.

**Goal:** Write only the data model section of `contracts/trust_policy/src/lib.rs` — no functions yet.

**Write this complete file:**

```rust
#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror,
    Address, Env, Vec, BytesN,
    symbol_short,
};

// ── Storage keys ──────────────────────────────────────────────────────────────
#[contracttype]
pub enum DataKey {
    Owner,          // Address
    PerTxCap,       // i128 — max stroops per single transaction
    DailyCap,       // i128 — max stroops per day
    TotalBudget,    // i128 — lifetime budget ceiling
    SpentToday,     // i128 — running total for today
    SpentTotal,     // i128 — lifetime running total
    LastReset,      // u64  — unix timestamp of last daily reset
    Allowlist,      // Vec<Address> — approved recipient addresses
    Revoked,        // bool — master kill switch
    Initialized,    // bool — init guard
}

// ── Error types ───────────────────────────────────────────────────────────────
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum TrustError {
    AlreadyInitialized    = 1,
    NotInitialized        = 2,
    Unauthorized          = 3,
    Revoked               = 4,
    ExceedsPerTxCap       = 5,
    ExceedsDailyCap       = 6,
    ExceedsTotalBudget    = 7,
    RecipientNotAllowed   = 8,
    InvalidAmount         = 9,
    AllowlistFull         = 10,
}

// ── Contract struct ───────────────────────────────────────────────────────────
#[contract]
pub struct TrustPolicyContract;
```

**Explain each decision in comments inline:**
- Why `i128` for amounts: Stellar token amounts are in stroops (1 XLM = 10_000_000 stroops). i128 handles large USDC values safely with no overflow risk.
- Why `instance` storage for all keys: Policy state is always accessed together. Instance storage is cheaper per-access than persistent for frequently-read data.
- Why `Vec<Address>` for allowlist: Soroban's no_std Vec is the correct collection type — Rust's standard Vec is not available in the WASM environment.
- Why a separate `Initialized` key: Prevents the `initialize()` function from being called twice, which would let anyone overwrite the owner.

**Deliverable:** The file compiles with `cargo check` (from the workspace root). No functions yet — just types, enums, and the contract struct.

---

## PROMPT E1-04 — Contract Scaffold + initialize()

You are a Rust/Soroban engineer. You have the data model from E1-03. Now implement the contract scaffold and the `initialize()` function.

**Context:** Soroban contracts must be initialized explicitly after deployment. The `initialize()` function sets the owner and all policy parameters. It must be callable only once — protected by the `Initialized` key. After this, all state-modifying functions require `owner.require_auth()`.

**Add the following `#[contractimpl]` block to `lib.rs` after the struct definition:**

```rust
#[contractimpl]
impl TrustPolicyContract {

    /// Called once after deployment. Sets the owner and initial policy parameters.
    /// Amounts are in stroops (1 USDC = 10_000_000 if USDC has 7 decimals).
    /// per_tx_cap: max stroops per single agent payment
    /// daily_cap: max stroops the agent can spend in one calendar day
    /// total_budget: lifetime spending ceiling — once hit, agent is permanently blocked
    pub fn initialize(
        env: Env,
        owner: Address,
        per_tx_cap: i128,
        daily_cap: i128,
        total_budget: i128,
        allowlist: Vec<Address>,
    ) -> Result<(), TrustError> {
        // Guard: can only be called once
        if env.storage().instance().has(&DataKey::Initialized) {
            return Err(TrustError::AlreadyInitialized);
        }

        // Validate amounts are positive
        if per_tx_cap <= 0 || daily_cap <= 0 || total_budget <= 0 {
            return Err(TrustError::InvalidAmount);
        }

        // daily_cap must not exceed total_budget
        // per_tx_cap must not exceed daily_cap
        // These are soft validations — enforcing logical consistency
        
        // Write all state
        env.storage().instance().set(&DataKey::Owner, &owner);
        env.storage().instance().set(&DataKey::PerTxCap, &per_tx_cap);
        env.storage().instance().set(&DataKey::DailyCap, &daily_cap);
        env.storage().instance().set(&DataKey::TotalBudget, &total_budget);
        env.storage().instance().set(&DataKey::SpentToday, &0_i128);
        env.storage().instance().set(&DataKey::SpentTotal, &0_i128);
        env.storage().instance().set(&DataKey::LastReset, &env.ledger().timestamp());
        env.storage().instance().set(&DataKey::Allowlist, &allowlist);
        env.storage().instance().set(&DataKey::Revoked, &false);
        env.storage().instance().set(&DataKey::Initialized, &true);

        // Emit initialization event
        env.events().publish(
            (symbol_short!("init"),),
            (owner, per_tx_cap, daily_cap, total_budget),
        );

        Ok(())
    }

    /// Read the full policy state — used by the backend to serve the dashboard.
    pub fn get_policy(env: Env) -> Result<(Address, i128, i128, i128, i128, i128, bool), TrustError> {
        Self::assert_initialized(&env)?;
        let owner: Address = env.storage().instance().get(&DataKey::Owner).unwrap();
        let per_tx_cap: i128 = env.storage().instance().get(&DataKey::PerTxCap).unwrap();
        let daily_cap: i128 = env.storage().instance().get(&DataKey::DailyCap).unwrap();
        let total_budget: i128 = env.storage().instance().get(&DataKey::TotalBudget).unwrap();
        let spent_today: i128 = env.storage().instance().get(&DataKey::SpentToday).unwrap();
        let spent_total: i128 = env.storage().instance().get(&DataKey::SpentTotal).unwrap();
        let revoked: bool = env.storage().instance().get(&DataKey::Revoked).unwrap();
        Ok((owner, per_tx_cap, daily_cap, total_budget, spent_today, spent_total, revoked))
    }

    // ── Internal helpers ─────────────────────────────────────────────────────

    fn assert_initialized(env: &Env) -> Result<(), TrustError> {
        if !env.storage().instance().has(&DataKey::Initialized) {
            return Err(TrustError::NotInitialized);
        }
        Ok(())
    }

    fn get_owner(env: &Env) -> Address {
        env.storage().instance().get(&DataKey::Owner).unwrap()
    }
}
```

**Deliverable:** Run `cargo check` from workspace root. Fix any type errors. The contract compiles cleanly. Do not deploy yet.

---

## PROMPT E1-05 — authorize() — The Core Function

You are a Rust/Soroban engineer. This is the most important function in the entire project. `authorize()` is called by Engineer 2's agent before every single payment. It must be correct, fast, and emit a useful event regardless of outcome.

**Context:** The agent calls `authorize(recipient, amount)` before paying. The contract checks: (1) not revoked, (2) recipient is in allowlist, (3) amount ≤ per_tx_cap, (4) spending_today + amount ≤ daily_cap, (5) spent_total + amount ≤ total_budget. If all pass, it returns `true` and updates spend counters. If any fail, it returns `false` with a specific reason code — it must NOT panic/error on a policy block because the agent needs to handle the refusal gracefully.

**Daily reset logic:** At the start of `authorize()`, check if 86400 seconds have elapsed since `LastReset`. If yes, zero `SpentToday` and update `LastReset` to current timestamp. This is the correct place for this check because it happens atomically with the spend.

**Add these functions inside the existing `#[contractimpl]` block:**

```rust
    /// Primary authorization gate. Called by the agent before every payment.
    /// Returns Ok(true) if payment is authorized, Ok(false) if blocked by policy.
    /// Never returns Err for policy violations — only for system errors.
    /// Emits an "auth" event with the outcome so the backend can log it.
    pub fn authorize(
        env: Env,
        recipient: Address,
        amount: i128,
    ) -> Result<bool, TrustError> {
        Self::assert_initialized(&env)?;

        if amount <= 0 {
            return Err(TrustError::InvalidAmount);
        }

        // ── Daily reset check ──────────────────────────────────────────────
        let now: u64 = env.ledger().timestamp();
        let last_reset: u64 = env.storage().instance().get(&DataKey::LastReset).unwrap();
        if now.saturating_sub(last_reset) >= 86400 {
            env.storage().instance().set(&DataKey::SpentToday, &0_i128);
            env.storage().instance().set(&DataKey::LastReset, &now);
        }

        // ── Policy checks — order matters: cheapest checks first ───────────

        // 1. Revocation (single bool read — cheapest)
        let revoked: bool = env.storage().instance().get(&DataKey::Revoked).unwrap();
        if revoked {
            env.events().publish(
                (symbol_short!("auth"), symbol_short!("blocked")),
                (recipient.clone(), amount, symbol_short!("revoked")),
            );
            return Ok(false);
        }

        // 2. Per-tx cap
        let per_tx_cap: i128 = env.storage().instance().get(&DataKey::PerTxCap).unwrap();
        if amount > per_tx_cap {
            env.events().publish(
                (symbol_short!("auth"), symbol_short!("blocked")),
                (recipient.clone(), amount, symbol_short!("pertxcap")),
            );
            return Ok(false);
        }

        // 3. Allowlist check
        let allowlist: Vec<Address> = env.storage().instance().get(&DataKey::Allowlist).unwrap();
        let mut allowed = false;
        for i in 0..allowlist.len() {
            if allowlist.get(i).unwrap() == recipient {
                allowed = true;
                break;
            }
        }
        if !allowed {
            env.events().publish(
                (symbol_short!("auth"), symbol_short!("blocked")),
                (recipient.clone(), amount, symbol_short!("notallwd")),
            );
            return Ok(false);
        }

        // 4. Daily cap
        let daily_cap: i128 = env.storage().instance().get(&DataKey::DailyCappe).unwrap();
        let spent_today: i128 = env.storage().instance().get(&DataKey::SpentToday).unwrap();
        if spent_today.saturating_add(amount) > daily_cap {
            env.events().publish(
                (symbol_short!("auth"), symbol_short!("blocked")),
                (recipient.clone(), amount, symbol_short!("dailycap")),
            );
            return Ok(false);
        }

        // 5. Total budget
        let total_budget: i128 = env.storage().instance().get(&DataKey::TotalBudget).unwrap();
        let spent_total: i128 = env.storage().instance().get(&DataKey::SpentTotal).unwrap();
        if spent_total.saturating_add(amount) > total_budget {
            env.events().publish(
                (symbol_short!("auth"), symbol_short!("blocked")),
                (recipient.clone(), amount, symbol_short!("budget")),
            );
            return Ok(false);
        }

        // ── All checks passed — update counters ────────────────────────────
        env.storage().instance().set(
            &DataKey::SpentToday,
            &spent_today.saturating_add(amount),
        );
        env.storage().instance().set(
            &DataKey::SpentTotal,
            &spent_total.saturating_add(amount),
        );

        // Emit success event
        env.events().publish(
            (symbol_short!("auth"), symbol_short!("ok")),
            (recipient, amount),
        );

        Ok(true)
    }
```

**Fix the typo in the code above:** `DataKey::DailyCappe` should be `DataKey::DailyCap`. This is intentional — always read what you paste.

**Deliverable:** `cargo check` passes. The logic is correct. Write a one-paragraph comment at the top of the function explaining why `Ok(false)` is returned instead of `Err()` for policy blocks — this will matter for the audit.

---

## PROMPT E1-06 — Admin Functions (revoke, resume, update_caps, allowlist)

You are a Rust/Soroban engineer. Add all owner-gated administrative functions to the TrustPolicy contract.

**Context:** All functions below require `owner.require_auth()`. This means the transaction invoking these functions must be signed by the owner's keypair. The backend signing server (built in E1-12) handles this — it holds the owner keypair and signs transactions when the dashboard calls it.

**Add these functions inside the existing `#[contractimpl]` block:**

```rust
    /// Immediately blocks all future authorize() calls.
    /// The agent will be stopped on its next payment attempt.
    /// This is the "kill switch" — must be instant and irrevocable until resume() is called.
    pub fn revoke(env: Env) -> Result<(), TrustError> {
        Self::assert_initialized(&env)?;
        let owner = Self::get_owner(&env);
        owner.require_auth();

        env.storage().instance().set(&DataKey::Revoked, &true);

        env.events().publish(
            (symbol_short!("revoke"),),
            (owner, env.ledger().timestamp()),
        );

        Ok(())
    }

    /// Re-enables the agent after a revoke. Owner must explicitly resume.
    pub fn resume(env: Env) -> Result<(), TrustError> {
        Self::assert_initialized(&env)?;
        let owner = Self::get_owner(&env);
        owner.require_auth();

        env.storage().instance().set(&DataKey::Revoked, &false);

        env.events().publish(
            (symbol_short!("resume"),),
            (owner, env.ledger().timestamp()),
        );

        Ok(())
    }

    /// Update spending caps. All values must be positive.
    /// Pass 0 to keep a cap unchanged.
    pub fn update_caps(
        env: Env,
        per_tx_cap: i128,
        daily_cap: i128,
        total_budget: i128,
    ) -> Result<(), TrustError> {
        Self::assert_initialized(&env)?;
        let owner = Self::get_owner(&env);
        owner.require_auth();

        if per_tx_cap > 0 {
            env.storage().instance().set(&DataKey::PerTxCap, &per_tx_cap);
        }
        if daily_cap > 0 {
            env.storage().instance().set(&DataKey::DailyCappe, &daily_cap);
        }
        if total_budget > 0 {
            env.storage().instance().set(&DataKey::TotalBudget, &total_budget);
        }

        env.events().publish(
            (symbol_short!("capupd"),),
            (per_tx_cap, daily_cap, total_budget),
        );

        Ok(())
    }

    /// Add an address to the approved recipients list.
    /// The allowlist caps at 50 entries to bound storage cost.
    pub fn add_to_allowlist(env: Env, recipient: Address) -> Result<(), TrustError> {
        Self::assert_initialized(&env)?;
        let owner = Self::get_owner(&env);
        owner.require_auth();

        let mut allowlist: Vec<Address> = env.storage().instance()
            .get(&DataKey::Allowlist).unwrap();

        if allowlist.len() >= 50 {
            return Err(TrustError::AllowlistFull);
        }

        // Idempotent — don't add duplicates
        for i in 0..allowlist.len() {
            if allowlist.get(i).unwrap() == recipient {
                return Ok(());
            }
        }

        allowlist.push_back(recipient.clone());
        env.storage().instance().set(&DataKey::Allowlist, &allowlist);

        env.events().publish(
            (symbol_short!("aladd"),),
            (recipient,),
        );

        Ok(())
    }

    /// Remove an address from the allowlist.
    pub fn remove_from_allowlist(env: Env, recipient: Address) -> Result<(), TrustError> {
        Self::assert_initialized(&env)?;
        let owner = Self::get_owner(&env);
        owner.require_auth();

        let allowlist: Vec<Address> = env.storage().instance()
            .get(&DataKey::Allowlist).unwrap();

        let mut new_list: Vec<Address> = Vec::new(&env);
        for i in 0..allowlist.len() {
            let addr = allowlist.get(i).unwrap();
            if addr != recipient {
                new_list.push_back(addr);
            }
        }

        env.storage().instance().set(&DataKey::Allowlist, &new_list);

        env.events().publish(
            (symbol_short!("alrem"),),
            (recipient,),
        );

        Ok(())
    }

    /// Get current allowlist — used by backend for dashboard display.
    pub fn get_allowlist(env: Env) -> Result<Vec<Address>, TrustError> {
        Self::assert_initialized(&env)?;
        let allowlist: Vec<Address> = env.storage().instance()
            .get(&DataKey::Allowlist).unwrap();
        Ok(allowlist)
    }
```

**Fix the typo carried from E1-05:** `DataKey::DailyCappe` → `DataKey::DailyCap` in update_caps. Do a global find-and-replace across lib.rs.

**Deliverable:** `cargo check` passes. All six functions compile. Confirm `require_auth()` is on the first line of each admin function — before any storage reads. This matters for security: auth checks must happen before any state access.

---

## PROMPT E1-07 — record_payment() + Soroban Events

You are a Rust/Soroban engineer. Add the `record_payment()` function which Engineer 2's agent calls after a payment has been confirmed on-chain.

**Context:** `authorize()` updates spend counters optimistically (before the payment is confirmed). `record_payment()` exists for the audit trail — it records the actual Stellar transaction hash against the payment, creating an immutable onchain log. This is what makes the project fundable: every agent payment is traceable back to an authorized policy decision.

**Important:** In the hackathon demo, the agent calls `authorize()` then pays then calls `record_payment()`. In a production protocol, you would use atomic cross-contract calls or a challenge/response — document this in a TODO comment.

**Add to the `#[contractimpl]` block:**

```rust
    /// Called by the agent after a payment is confirmed on Stellar.
    /// Records the tx_hash against the payment for the onchain audit trail.
    /// tx_hash is the Stellar transaction hash as a 32-byte value.
    pub fn record_payment(
        env: Env,
        recipient: Address,
        amount: i128,
        tx_hash: BytesN<32>,
    ) -> Result<(), TrustError> {
        Self::assert_initialized(&env)?;

        if amount <= 0 {
            return Err(TrustError::InvalidAmount);
        }

        // Emit the audit event — this is the permanent onchain record
        // A future version would verify the tx_hash against the Stellar ledger
        // TODO: In production, use a Soroban cross-contract call to the Stellar
        // asset contract to verify the transfer actually occurred before recording
        env.events().publish(
            (symbol_short!("payment"),),
            (
                recipient,
                amount,
                tx_hash,
                env.ledger().timestamp(),
                env.ledger().sequence(),
            ),
        );

        Ok(())
    }
```

**Also add a function to reset daily spend manually (admin only — for testing):**

```rust
    /// Dev/admin function to reset daily spend counter.
    /// Useful during testing and demo setup.
    pub fn reset_daily(env: Env) -> Result<(), TrustError> {
        Self::assert_initialized(&env)?;
        let owner = Self::get_owner(&env);
        owner.require_auth();

        env.storage().instance().set(&DataKey::SpentToday, &0_i128);
        env.storage().instance().set(&DataKey::LastReset, &env.ledger().timestamp());

        Ok(())
    }
```

**Deliverable:** `cargo check` passes. Confirm the `BytesN<32>` import is present in the use statement at the top of the file. The full events emitted by this contract are now: `init`, `auth/ok`, `auth/blocked`, `revoke`, `resume`, `capupd`, `aladd`, `alrem`, `payment`. Document this list in a comment block at the top of lib.rs — Engineer 2's backend needs to know all event types.

---

## PROMPT E1-08 — Write the Full Test Suite

You are a Rust/Soroban engineer writing a comprehensive test suite for the TrustPolicy contract. Tests use `soroban-sdk`'s testutils feature which provides a mock `Env` — no network calls needed.

**Create `contracts/trust_policy/src/test.rs`:**

```rust
#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger, LedgerInfo},
    Address, Env, Vec,
};

fn setup_env() -> (Env, Address, TrustPolicyContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();  // Auto-approve all require_auth() calls in tests
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
#[should_panic(expected = "AlreadyInitialized")]
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

    // per_tx=5, daily=20, total=100 (in units of 1_000_000 stroops = 1 USDC)
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

    // First payment: 5 USDC — ok (spent_today=5)
    assert!(client.authorize(&recipient, &5_000_000));
    // Second payment: 5 USDC — would bring daily to 10, over cap of 8
    assert!(!client.authorize(&recipient, &5_000_000));
}

#[test]
fn test_authorize_blocked_by_total_budget() {
    let (env, owner, client) = setup_env();
    let recipient = Address::generate(&env);
    let allowlist = default_allowlist(&env, &[recipient.clone()]);

    // per_tx=5, daily=20, total=7 (tight total budget)
    client.initialize(&owner, &5_000_000, &20_000_000, &7_000_000, &allowlist);

    assert!(client.authorize(&recipient, &5_000_000)); // spent=5
    // Next payment would bring total to 9, over budget of 7
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
fn test_revoke_blocks_authorize() {
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

    // daily=8 USDC
    client.initialize(&owner, &5_000_000, &8_000_000, &100_000_000, &allowlist);

    // Spend 5 USDC today
    assert!(client.authorize(&recipient, &5_000_000));
    // Trying to spend 5 more would exceed daily cap
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

    // After reset, daily spend should be 0 again — 5 USDC should pass
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
```

**Run the tests:**
```bash
cargo test
```

**All 11 tests must pass.** Fix any compilation errors — common issues are missing imports, wrong function signatures, or missing `env.mock_all_auths()`. Do not move forward to E1-09 until `cargo test` shows 11 passing.

---

## PROMPT E1-09 — Deploy TrustPolicy to Testnet + CLI Verification

You are a Rust/Soroban engineer. All tests pass. Now deploy the real TrustPolicy contract to Stellar testnet and verify every function from the CLI.

**Step 1 — Build the optimized WASM:**
```bash
cd trustlayer
stellar contract build
ls -la target/wasm32-unknown-unknown/release/trust_policy.wasm
# Should be under 100KB
```

**Step 2 — Deploy:**
```bash
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/trust_policy.wasm \
  --source owner \
  --network testnet
```
Save the contract ID to `.env`:
```
TRUST_POLICY_CONTRACT_ID=C...
```

**Step 3 — Generate two test service addresses for the allowlist.** These will be Engineer 2's mock services:
```bash
stellar keys generate --global service_a --network testnet
stellar keys generate --global service_b --network testnet
SERVICE_A=$(stellar keys address service_a)
SERVICE_B=$(stellar keys address service_b)
echo "SERVICE_A=$SERVICE_A"
echo "SERVICE_B=$SERVICE_B"
```
Add both to `.env`.

**Step 4 — Initialize the contract:**
```bash
stellar contract invoke \
  --id $TRUST_POLICY_CONTRACT_ID \
  --source owner \
  --network testnet \
  -- initialize \
  --owner $(stellar keys address owner) \
  --per_tx_cap 5000000 \
  --daily_cap 20000000 \
  --total_budget 100000000 \
  --allowlist "[\"$SERVICE_A\",\"$SERVICE_B\"]"
```

**Step 5 — Verify policy was stored:**
```bash
stellar contract invoke \
  --id $TRUST_POLICY_CONTRACT_ID \
  --source owner \
  --network testnet \
  -- get_policy
```
Confirm the output shows the correct caps and `revoked: false`.

**Step 6 — Test authorize() from CLI:**
```bash
stellar contract invoke \
  --id $TRUST_POLICY_CONTRACT_ID \
  --source owner \
  --network testnet \
  -- authorize \
  --recipient $SERVICE_A \
  --amount 1000000
```
Should return `true`.

**Step 7 — Test revoke():**
```bash
stellar contract invoke \
  --id $TRUST_POLICY_CONTRACT_ID \
  --source owner \
  --network testnet \
  -- revoke

stellar contract invoke \
  --id $TRUST_POLICY_CONTRACT_ID \
  --source owner \
  --network testnet \
  -- authorize \
  --recipient $SERVICE_A \
  --amount 1000000
```
Should return `false`.

**Step 8 — Resume and confirm:**
```bash
stellar contract invoke \
  --id $TRUST_POLICY_CONTRACT_ID \
  --source owner \
  --network testnet \
  -- resume

stellar contract invoke \
  --id $TRUST_POLICY_CONTRACT_ID \
  --source owner \
  --network testnet \
  -- authorize \
  --recipient $SERVICE_A \
  --amount 1000000
```
Should return `true` again.

**Deliverable:** Share with Engineer 2:
- `TRUST_POLICY_CONTRACT_ID`
- `SERVICE_A` address
- `SERVICE_B` address
- `OWNER_PUBLIC_KEY`

These go into E2's `.env` file. Engineer 2 is now unblocked to wire the trust check.

---

## PROMPT E1-10 — Backend Signing Server (TypeScript/Express)

You are a TypeScript engineer building a thin signing server that sits between Engineer 2's React dashboard and the Soroban contract. The dashboard cannot hold a Stellar keypair — this server does.

**Context:** The owner keypair is sensitive. It lives only in this backend process, loaded from env vars. The dashboard calls simple REST endpoints like `POST /revoke` and the server signs and submits the Stellar transaction.

**Create `trustlayer/backend/package.json`:**
```json
{
  "name": "trustlayer-backend",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@stellar/stellar-sdk": "^12.0.0",
    "cors": "^2.8.5",
    "dotenv": "^16.0.0",
    "express": "^4.18.0"
  },
  "devDependencies": {
    "@types/cors": "^2.8.0",
    "@types/express": "^4.17.0",
    "@types/node": "^20.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.0.0"
  }
}
```

**Create `trustlayer/backend/src/index.ts`:**

```typescript
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import {
  Networks,
  Keypair,
  TransactionBuilder,
  BASE_FEE,
  Operation,
  Address,
  nativeToScVal,
  scValToNative,
  SorobanRpc,
  xdr,
  Contract,
} from '@stellar/stellar-sdk';

dotenv.config({ path: '../.env' });

const app = express();
app.use(cors());
app.use(express.json());

// ── Config ────────────────────────────────────────────────────────────────────
const NETWORK_PASSPHRASE = Networks.TESTNET;
const RPC_URL = 'https://soroban-testnet.stellar.org';
const CONTRACT_ID = process.env.TRUST_POLICY_CONTRACT_ID!;
const OWNER_SECRET = process.env.OWNER_SECRET_KEY!;

const server = new SorobanRpc.Server(RPC_URL);
const ownerKeypair = Keypair.fromSecret(OWNER_SECRET);
const contract = new Contract(CONTRACT_ID);

// ── Helper: build, simulate, sign, submit a contract call ────────────────────
async function invokeContract(
  method: string,
  args: xdr.ScVal[] = []
): Promise<{ success: boolean; result?: any; txHash?: string; error?: string }> {
  try {
    const account = await server.getAccount(ownerKeypair.publicKey());

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(30)
      .build();

    // Simulate first to get the footprint
    const simResult = await server.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(simResult)) {
      return { success: false, error: simResult.error };
    }

    const preparedTx = SorobanRpc.assembleTransaction(tx, simResult).build();
    preparedTx.sign(ownerKeypair);

    const sendResult = await server.sendTransaction(preparedTx);
    if (sendResult.status === 'ERROR') {
      return { success: false, error: JSON.stringify(sendResult.errorResult) };
    }

    // Poll for confirmation
    const txHash = sendResult.hash;
    let getResult = await server.getTransaction(txHash);
    let attempts = 0;
    while (getResult.status === 'NOT_FOUND' && attempts < 20) {
      await new Promise(r => setTimeout(r, 1500));
      getResult = await server.getTransaction(txHash);
      attempts++;
    }

    if (getResult.status === 'SUCCESS') {
      const returnVal = getResult.returnValue
        ? scValToNative(getResult.returnValue)
        : null;
      return { success: true, result: returnVal, txHash };
    }

    return { success: false, error: `Transaction failed: ${getResult.status}` };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /health
app.get('/health', (_, res) => {
  res.json({ status: 'ok', contractId: CONTRACT_ID, owner: ownerKeypair.publicKey() });
});

// GET /policy — returns current policy state
app.get('/policy', async (_, res) => {
  const result = await invokeContract('get_policy');
  if (!result.success) {
    return res.status(500).json({ error: result.error });
  }
  // result.result is a tuple: [owner, per_tx_cap, daily_cap, total_budget, spent_today, spent_total, revoked]
  const [owner, perTxCap, dailyCap, totalBudget, spentToday, spentTotal, revoked] = result.result;
  res.json({
    owner,
    perTxCap: Number(perTxCap),
    dailyCap: Number(dailyCap),
    totalBudget: Number(totalBudget),
    spentToday: Number(spentToday),
    spentTotal: Number(spentTotal),
    revoked,
  });
});

// GET /allowlist
app.get('/allowlist', async (_, res) => {
  const result = await invokeContract('get_allowlist');
  if (!result.success) return res.status(500).json({ error: result.error });
  res.json({ allowlist: result.result });
});

// POST /revoke
app.post('/revoke', async (_, res) => {
  const result = await invokeContract('revoke');
  if (!result.success) return res.status(500).json({ error: result.error });
  res.json({ success: true, txHash: result.txHash });
});

// POST /resume
app.post('/resume', async (_, res) => {
  const result = await invokeContract('resume');
  if (!result.success) return res.status(500).json({ error: result.error });
  res.json({ success: true, txHash: result.txHash });
});

// POST /update-caps
// Body: { perTxCap?: number, dailyCap?: number, totalBudget?: number }
app.post('/update-caps', async (req, res) => {
  const { perTxCap = 0, dailyCap = 0, totalBudget = 0 } = req.body;
  const args = [
    nativeToScVal(BigInt(perTxCap), { type: 'i128' }),
    nativeToScVal(BigInt(dailyCap), { type: 'i128' }),
    nativeToScVal(BigInt(totalBudget), { type: 'i128' }),
  ];
  const result = await invokeContract('update_caps', args);
  if (!result.success) return res.status(500).json({ error: result.error });
  res.json({ success: true, txHash: result.txHash });
});

// POST /add-allowlist
// Body: { address: string }
app.post('/add-allowlist', async (req, res) => {
  const { address } = req.body;
  const args = [new Address(address).toScVal()];
  const result = await invokeContract('add_to_allowlist', args);
  if (!result.success) return res.status(500).json({ error: result.error });
  res.json({ success: true, txHash: result.txHash });
});

// POST /remove-allowlist
// Body: { address: string }
app.post('/remove-allowlist', async (req, res) => {
  const { address } = req.body;
  const args = [new Address(address).toScVal()];
  const result = await invokeContract('remove_from_allowlist', args);
  if (!result.success) return res.status(500).json({ error: result.error });
  res.json({ success: true, txHash: result.txHash });
});

// GET /events — polls Soroban events for the contract and returns recent ones
// Engineer 2's dashboard polls this every 2 seconds
app.get('/events', async (_, res) => {
  try {
    const latestLedger = await server.getLatestLedger();
    // Fetch last 1000 ledgers worth of events (~1.4 hours at 5s per ledger)
    const startLedger = Math.max(1, latestLedger.sequence - 1000);

    const eventsResult = await server.getEvents({
      startLedger,
      filters: [
        {
          type: 'contract',
          contractIds: [CONTRACT_ID],
        },
      ],
      limit: 100,
    });

    const events = eventsResult.events.map(e => ({
      id: e.id,
      type: e.topic[0] ? scValToNative(e.topic[0]) : 'unknown',
      subtype: e.topic[1] ? scValToNative(e.topic[1]) : null,
      value: scValToNative(e.value),
      ledger: e.ledger,
      ledgerClosedAt: e.ledgerClosedAt,
      txHash: e.txHash,
    }));

    res.json({ events: events.reverse() }); // Most recent first
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.BACKEND_PORT || 3001;
app.listen(PORT, () => {
  console.log(`TrustLayer backend running on port ${PORT}`);
  console.log(`Contract: ${CONTRACT_ID}`);
  console.log(`Owner: ${ownerKeypair.publicKey()}`);
});
```

**Install and start:**
```bash
cd trustlayer/backend
npm install
npm run dev
```

**Test the server:**
```bash
curl http://localhost:3001/health
curl http://localhost:3001/policy
curl -X POST http://localhost:3001/revoke
curl http://localhost:3001/policy  # revoked should now be true
curl -X POST http://localhost:3001/resume
curl http://localhost:3001/events
```

**Deliverable:** All six curl commands return valid JSON. Share `http://localhost:3001` with Engineer 2 as `BACKEND_URL` in their `.env`. This is the only thing they need to call — they never touch the Soroban SDK directly.

---

## PROMPT E1-11 — authorize() Endpoint for Agent (No Owner Auth)

You are a TypeScript engineer. Engineer 2's agent needs to call `authorize()` before every payment. Unlike admin functions, `authorize()` does not require owner auth — it's a read/write function that the agent calls with its own account.

**Problem:** The agent holds its own Stellar keypair (not the owner keypair). It needs to call `authorize()` on the contract signed with its own key, then check the boolean result.

**Add this route to the backend server in `src/index.ts`:**

```typescript
// POST /authorize
// Called by Engineer 2's agent before every payment
// Body: { recipient: string, amount: number }
// Returns: { authorized: boolean, reason?: string, txHash?: string }
app.post('/authorize', async (req, res) => {
  const { recipient, amount } = req.body;

  if (!recipient || !amount || amount <= 0) {
    return res.status(400).json({ error: 'recipient and positive amount required' });
  }

  // The agent signs this transaction with the owner key for simplicity in the hackathon.
  // In production: the agent would have its own delegated keypair registered in the contract.
  // TODO: Add agent key registration to the contract for production use.
  const args = [
    new Address(recipient).toScVal(),
    nativeToScVal(BigInt(Math.round(amount)), { type: 'i128' }),
  ];

  const result = await invokeContract('authorize', args);

  if (!result.success) {
    return res.status(500).json({ error: result.error });
  }

  const authorized = result.result === true;

  res.json({
    authorized,
    txHash: result.txHash,
    // Read events to get the block reason if not authorized
    reason: authorized ? null : 'blocked_by_policy',
  });
});
```

**Also add a POST /record-payment endpoint:**

```typescript
// POST /record-payment
// Called by agent after Stellar payment is confirmed
// Body: { recipient: string, amount: number, txHash: string }
app.post('/record-payment', async (req, res) => {
  const { recipient, amount, txHash: paymentTxHash } = req.body;

  if (!recipient || !amount || !paymentTxHash) {
    return res.status(400).json({ error: 'recipient, amount, and txHash required' });
  }

  // Convert hex tx hash to 32 bytes
  const hashBytes = Buffer.from(paymentTxHash, 'hex');
  if (hashBytes.length !== 32) {
    return res.status(400).json({ error: 'txHash must be 32 bytes hex' });
  }

  const args = [
    new Address(recipient).toScVal(),
    nativeToScVal(BigInt(Math.round(amount)), { type: 'i128' }),
    xdr.ScVal.scvBytes(hashBytes),
  ];

  const result = await invokeContract('record_payment', args);

  if (!result.success) {
    return res.status(500).json({ error: result.error });
  }

  res.json({ success: true, txHash: result.txHash });
});
```

**Test both endpoints:**
```bash
# Replace with actual SERVICE_A address from .env
curl -X POST http://localhost:3001/authorize \
  -H "Content-Type: application/json" \
  -d '{"recipient": "G...", "amount": 1000000}'

# Should return: {"authorized": true, "txHash": "..."}
```

**Deliverable:** Both endpoints tested and returning correct responses. Restart the backend with `npm run dev`. Engineer 2 now has a complete API contract:
- `POST /authorize` → `{ authorized: bool }`
- `POST /record-payment` → `{ success: bool }`
- `POST /revoke` → triggers kill switch
- `GET /policy` → live policy state
- `GET /events` → recent contract events

---

## PROMPT E1-12 — Integration Test + Demo Dry Run

You are an engineer preparing the full end-to-end demo scenario for TrustLayer. Run the complete flow manually before Engineer 2 wires it into the agent.

**Prerequisites:** Backend running on port 3001. Contract deployed and initialized on testnet.

**Step 1 — Confirm clean state:**
```bash
curl http://localhost:3001/policy
```
Expected: `revoked: false`, `spentToday: 0`, `spentTotal: 0`.

**Step 2 — Simulate 3 agent payments manually:**
```bash
# Payment 1: to SERVICE_A, 2 USDC
curl -X POST http://localhost:3001/authorize \
  -H "Content-Type: application/json" \
  -d "{\"recipient\": \"$SERVICE_A\", \"amount\": 2000000}"

# Payment 2: to SERVICE_B, 3 USDC
curl -X POST http://localhost:3001/authorize \
  -H "Content-Type: application/json" \
  -d "{\"recipient\": \"$SERVICE_B\", \"amount\": 3000000}"

# Payment 3: to SERVICE_A, 5 USDC
curl -X POST http://localhost:3001/authorize \
  -H "Content-Type: application/json" \
  -d "{\"recipient\": \"$SERVICE_A\", \"amount\": 5000000}"
```
All three should return `authorized: true`.

**Step 3 — Check spend counters updated:**
```bash
curl http://localhost:3001/policy
```
`spentToday` should be `10000000` (10 USDC in stroops).

**Step 4 — Try exceeding per_tx_cap:**
```bash
curl -X POST http://localhost:3001/authorize \
  -H "Content-Type: application/json" \
  -d "{\"recipient\": \"$SERVICE_A\", \"amount\": 6000000}"
```
Should return `authorized: false`.

**Step 5 — Revoke:**
```bash
curl -X POST http://localhost:3001/revoke
curl -X POST http://localhost:3001/authorize \
  -H "Content-Type: application/json" \
  -d "{\"recipient\": \"$SERVICE_A\", \"amount\": 1000000}"
```
Should return `authorized: false`.

**Step 6 — Resume:**
```bash
curl -X POST http://localhost:3001/resume
curl -X POST http://localhost:3001/authorize \
  -H "Content-Type: application/json" \
  -d "{\"recipient\": \"$SERVICE_A\", \"amount\": 1000000}"
```
Should return `authorized: true`.

**Step 7 — Check events:**
```bash
curl http://localhost:3001/events | python3 -m json.tool | head -80
```
You should see `auth/ok`, `auth/blocked`, `revoke`, `resume` events in the list.

**Step 8 — Reset for demo:**
```bash
stellar contract invoke \
  --id $TRUST_POLICY_CONTRACT_ID \
  --source owner \
  --network testnet \
  -- reset_daily
```

**Deliverable:** All 8 steps complete successfully. Write the output of step 7 (events JSON) into a file called `demo_events_sample.json` in the repo. Share with Engineer 2 — they need this to build the event parsing in the dashboard.
