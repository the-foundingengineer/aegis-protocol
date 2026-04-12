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

#[contract]
pub struct TrustPolicyContract;

#[contractimpl]
impl TrustPolicyContract {

    /// Called once after deployment. Sets the owner and initial policy parameters.
    pub fn initialize(
        env: Env,
        owner: Address,
        per_tx_cap: i128,
        daily_cap: i128,
        total_budget: i128,
        allowlist: Vec<Address>,
    ) -> Result<(), TrustError> {
        if env.storage().instance().has(&DataKey::Initialized) {
            return Err(TrustError::AlreadyInitialized);
        }

        if per_tx_cap <= 0 || daily_cap <= 0 || total_budget <= 0 {
            return Err(TrustError::InvalidAmount);
        }
        
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

        env.events().publish(
            (symbol_short!("init"),),
            (owner, per_tx_cap, daily_cap, total_budget),
        );

        Ok(())
    }

    /// Primary authorization gate. Called by the agent before every payment.
    /// Returns Ok(true) if payment is authorized, Ok(false) if blocked by policy.
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

        // ── Policy checks ──────────────────────────────────────────────────
        
        let revoked: bool = env.storage().instance().get(&DataKey::Revoked).unwrap();
        if revoked {
            Self::emit_blocked(&env, &recipient, amount, symbol_short!("revoked"));
            return Ok(false);
        }

        let per_tx_cap: i128 = env.storage().instance().get(&DataKey::PerTxCap).unwrap();
        if amount > per_tx_cap {
            Self::emit_blocked(&env, &recipient, amount, symbol_short!("pertxcap"));
            return Ok(false);
        }

        let allowlist: Vec<Address> = env.storage().instance().get(&DataKey::Allowlist).unwrap();
        if !allowlist.contains(&recipient) {
            Self::emit_blocked(&env, &recipient, amount, symbol_short!("notallwd"));
            return Ok(false);
        }

        let daily_cap: i128 = env.storage().instance().get(&DataKey::DailyCap).unwrap();
        let spent_today: i128 = env.storage().instance().get(&DataKey::SpentToday).unwrap();
        if spent_today.saturating_add(amount) > daily_cap {
            Self::emit_blocked(&env, &recipient, amount, symbol_short!("dailycap"));
            return Ok(false);
        }

        let total_budget: i128 = env.storage().instance().get(&DataKey::TotalBudget).unwrap();
        let spent_total: i128 = env.storage().instance().get(&DataKey::SpentTotal).unwrap();
        if spent_total.saturating_add(amount) > total_budget {
            Self::emit_blocked(&env, &recipient, amount, symbol_short!("budget"));
            return Ok(false);
        }

        // ── All checks passed ──────────────────────────────────────────────
        env.storage().instance().set(&DataKey::SpentToday, &spent_today.saturating_add(amount));
        env.storage().instance().set(&DataKey::SpentTotal, &spent_total.saturating_add(amount));

        env.events().publish(
            (symbol_short!("auth"), symbol_short!("ok")),
            (recipient, amount),
        );

        Ok(true)
    }

    /// Records a confirmed payment hash for an immutable audit trail.
    pub fn record_payment(
        env: Env,
        recipient: Address,
        amount: i128,
        tx_hash: BytesN<32>,
    ) -> Result<(), TrustError> {
        Self::assert_initialized(&env)?;

        env.events().publish(
            (symbol_short!("payment"),),
            (recipient, amount, tx_hash, env.ledger().timestamp()),
        );

        Ok(())
    }

    // ── Admin Functions ──────────────────────────────────────────────────────

    pub fn revoke(env: Env) -> Result<(), TrustError> {
        Self::assert_initialized(&env)?;
        Self::get_owner(&env).require_auth();
        env.storage().instance().set(&DataKey::Revoked, &true);
        env.events().publish((symbol_short!("revoke"),), ());
        Ok(())
    }

    pub fn resume(env: Env) -> Result<(), TrustError> {
        Self::assert_initialized(&env)?;
        Self::get_owner(&env).require_auth();
        env.storage().instance().set(&DataKey::Revoked, &false);
        env.events().publish((symbol_short!("resume"),), ());
        Ok(())
    }

    pub fn update_caps(
        env: Env,
        per_tx_cap: i128,
        daily_cap: i128,
        total_budget: i128,
    ) -> Result<(), TrustError> {
        Self::assert_initialized(&env)?;
        Self::get_owner(&env).require_auth();
        
        if per_tx_cap > 0 { env.storage().instance().set(&DataKey::PerTxCap, &per_tx_cap); }
        if daily_cap > 0 { env.storage().instance().set(&DataKey::DailyCap, &daily_cap); }
        if total_budget > 0 { env.storage().instance().set(&DataKey::TotalBudget, &total_budget); }

        env.events().publish((symbol_short!("capupd"),), (per_tx_cap, daily_cap, total_budget));
        Ok(())
    }

    pub fn add_to_allowlist(env: Env, recipient: Address) -> Result<(), TrustError> {
        Self::assert_initialized(&env)?;
        Self::get_owner(&env).require_auth();
        
        let mut allowlist: Vec<Address> = env.storage().instance().get(&DataKey::Allowlist).unwrap();
        if allowlist.len() >= 50 { return Err(TrustError::AllowlistFull); }
        if !allowlist.contains(&recipient) {
            allowlist.push_back(recipient.clone());
            env.storage().instance().set(&DataKey::Allowlist, &allowlist);
        }
        
        env.events().publish((symbol_short!("aladd"),), (recipient,));
        Ok(())
    }

    pub fn remove_from_allowlist(env: Env, recipient: Address) -> Result<(), TrustError> {
        Self::assert_initialized(&env)?;
        Self::get_owner(&env).require_auth();
        
        let allowlist: Vec<Address> = env.storage().instance().get(&DataKey::Allowlist).unwrap();
        let mut new_list: Vec<Address> = Vec::new(&env);
        for a in allowlist.iter() {
            if a != recipient { new_list.push_back(a); }
        }
        env.storage().instance().set(&DataKey::Allowlist, &new_list);
        
        env.events().publish((symbol_short!("alrem"),), (recipient,));
        Ok(())
    }

    // ── Getters ──────────────────────────────────────────────────────────────

    pub fn get_policy(env: Env) -> Result<(Address, i128, i128, i128, i128, i128, bool), TrustError> {
        Self::assert_initialized(&env)?;
        let owner = Self::get_owner(&env);
        let per_tx = env.storage().instance().get(&DataKey::PerTxCap).unwrap();
        let daily = env.storage().instance().get(&DataKey::DailyCap).unwrap();
        let total = env.storage().instance().get(&DataKey::TotalBudget).unwrap();
        let spent_today = env.storage().instance().get(&DataKey::SpentToday).unwrap();
        let spent_total = env.storage().instance().get(&DataKey::SpentTotal).unwrap();
        let revoked = env.storage().instance().get(&DataKey::Revoked).unwrap();
        Ok((owner, per_tx, daily, total, spent_today, spent_total, revoked))
    }

    pub fn get_allowlist(env: Env) -> Result<Vec<Address>, TrustError> {
        Self::assert_initialized(&env)?;
        Ok(env.storage().instance().get(&DataKey::Allowlist).unwrap())
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    fn assert_initialized(env: &Env) -> Result<(), TrustError> {
        if !env.storage().instance().has(&DataKey::Initialized) {
            return Err(TrustError::NotInitialized);
        }
        Ok(())
    }

    fn get_owner(env: &Env) -> Address {
        env.storage().instance().get(&DataKey::Owner).unwrap()
    }

    fn emit_blocked(env: &Env, recipient: &Address, amount: i128, reason: soroban_sdk::Symbol) {
        env.events().publish(
            (symbol_short!("auth"), symbol_short!("blocked")),
            (recipient.clone(), amount, reason),
        );
    }
}

mod test;
