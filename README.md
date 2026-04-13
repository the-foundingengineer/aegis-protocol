# Aegis — Trust Layer for Autonomous AI Agents

Aegis is a decentralized authorization and policy enforcement layer built on the **Stellar** network using **Soroban** smart contracts. It enables human owners to delegate spending power to autonomous AI agents while maintaining hard, on-chain constraints on their behavior.

![Architecture Diagram](https://mermaid.ink/svg/pako:eNptkMFugzAMhl_F8pm2V9gjT-p62GnTtEttxYmXNoRKEkIChKr67lMgo-0SJ_6_P9uO0yZpZInST8mF8I33T_KORAnSscYV6uV6fSYXzHIdG_eWbT6f-R0SscMv3vN6iGv2fI8Y4_uT9wy_Bv-Z0979V7M_vN8S36E6gZ67z6_N_vB6v8d3-N8_vDfBf67OEPB-9Xv-vX-9j--EPr012R0L_DkR_y9gAn9N_InFaymEV77X3p9qXNNDfKiPPtRHM6r5R69p3T67A-v8H75f7g9_AZL_t4o)

## 🏛 Architecture

Aegis implements the **x402 Payment Protocol** to bridge the gap between AI intent and on-chain action:

1.  **AI Agent (Autonomous)**: Performs tasks (browsing, research, purchasing).
2.  **x402 Middleware (Trust Enforcement)**: Inspects Every HTTP request. If a payment is required (402 Required), it calls Aegis.
3.  **Aegis Backend (Signing Authority)**: Evaluates the payment intent, checks with the Soroban contract, and signs transactions on behalf of the owner if policy permits.
4.  **Soroban Smart Contract (On-chain Truth)**: Stores immutable spending caps, allowlists, and a master revocation switch.

## ✨ Key Features

-   🛡 **Intent-Level Authorization**: Payments are only signed if they match the user's intent and safety guardrails.
-   📉 **On-chain Spending Caps**: Enforce per-transaction, daily, and lifetime budgets directly in the smart contract.
-   🚫 **Master Kill Switch**: Revoke an agent's access instantly from the dashboard.
-   📜 **Immutable Audit Trail**: Every payment record is permanently logged as a Soroban event for forensic trust.
-   💎 **Stellar/USDC Native**: Built on the world's most efficient payment network.

## 🚀 Getting Started

### Prerequisites
-   Stellar CLI (`cargo install --locked stellar-cli`)
-   Node.js v20+
-   Rust (wasm32-unknown-unknown target)

### Installation

1.  **Contract Build**:
    ```bash
    cd agent-guard/contracts/trust-policy
    stellar contract build
    ```

2.  **Run Dashboard**:
    ```bash
    cd agent-guard/dashboard
    npm install
    npm run dev
    ```

3.  **Start Services**:
    ```bash
    # See individual READMEs in agent-guard/services for backend and agent setup
    ```

## 🛠 Tech Stack

-   **Smart Contract**: Rust & Soroban
-   **Backend**: TypeScript & Express
-   **Frontend**: React (Vite) + Vanilla CSS (Stripe-inspired design)
-   **Network**: Stellar Testnet

---
Built for the **Stellar AI Hackathon**.
Aegis — Protecting the future of autonomous commerce.
