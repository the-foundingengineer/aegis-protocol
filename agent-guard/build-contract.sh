#!/bin/bash
set -e

echo "🔨 Building TrustPolicy contract..."
cd contracts/trust-policy
cargo build --target wasm32-unknown-unknown --release

echo "🧪 Running tests..."
cargo test

echo ""
echo "✅ Contract compiled successfully."
echo "WASM target available at: target/wasm32-unknown-unknown/release/policy.wasm"
echo "To deploy to testnet, run:"
echo "soroban contract deploy --wasm target/wasm32-unknown-unknown/release/policy.wasm --source <YOUR_SOURCE_ACCOUNT> --network testnet"
