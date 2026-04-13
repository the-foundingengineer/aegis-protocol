# Deploying Aegis Protocol

This guide outlines exactly how to deploy the full Aegis Protocol stack from scratch. The stack consists of three main components: the Soroban smart contract, the Node.js Policy Node (backend), and the React interactive dashboard.

## Prerequisites

- Node.js (v18+)
- Rust & Cargo
- Stellar CLI (`cargo install --locked stellar-cli`)
- Python 3 (for the landing page)

---

## 1. Deploying the Smart Contract (Soroban)

Navigate to the contract directory and build the WASM binary:
```bash
cd agent-guard/contracts/trust-policy
cargo build --target wasm32v1-none --release
```

Generate keys and fund them on the Stellar Testnet:
```bash
stellar keys generate --global owner --network testnet
stellar keys generate --global service_a --network testnet
```

Deploy the contract:
```bash
stellar contract deploy \
  --wasm target/wasm32v1-none/release/policy.wasm \
  --source owner \
  --network testnet
```
*Note the returned Contract ID.*

Initialize the contract with spending caps (amounts are in Stroops, 1 XLM = 10,000,000):
```bash
stellar contract invoke \
  --id <YOUR_CONTRACT_ID> \
  --source owner \
  --network testnet \
  -- initialize \
  --owner $(stellar keys address owner) \
  --per_tx_cap 5000000 \
  --daily_cap 20000000 \
  --total_budget 100000000 \
  --allowlist "[\"$(stellar keys address service_a)\"]"
```

---

## 2. Environment Configuration

Create a `.env` file in `agent-guard/backend/.env`:

```env
CONTRACT_ID=<YOUR_CONTRACT_ID>
OWNER_SECRET=<YOUR_OWNER_SECRET_KEY> # Run: stellar keys show owner
RPC_URL=https://soroban-testnet.stellar.org
PORT=3001
```

---

## 3. Starting the Backend Policy Node

The backend connects to the Stellar network, manages the agent intent requests, and streams live blockchain events.

```bash
cd agent-guard/backend
npm install
npm run dev
```

---

## 4. Starting the Interactive Dashboard

The dashboard monitors the AI agent's live requests and blocks.

```bash
cd agent-guard/dashboard
npm install
npm run dev
```

---

## 5. Starting the Landing Page

The landing page outlines the Aegis Prime architecture and intent-execution documentation.

```bash
cd agent-guard/landing
python3 -m http.server 8080
```

---

## 6. Running the Live Demo

1. Open **http://localhost:8080** to view the landing page.
2. Open **http://localhost:5173** to view the dashboard.
3. Click the **Run Agent** button on the dashboard to activate the simulation backend. Events will immediately begin streaming into the dashboard feed, complete with clickable testnet transaction hashes.
