# Engineer 2 — Full LLM Prompt Sequence
# TrustLayer: Agent Runtime + Mock Services + React Dashboard
# 14 prompts — execute in order, each builds on the last

---

## PROMPT E2-01 — Repo Scaffold + Tooling

You are a TypeScript engineer scaffolding the Engineer 2 side of the TrustLayer project. This repo contains three things: two mock paid HTTP services, an AI agent runtime, and a React dashboard.

**Create this repo structure:**

```
trustlayer-agent/
  services/
    service-a/          ← mock "weather data" paid API
      index.ts
    service-b/          ← mock "research summary" paid API
      index.ts
  agent/
    src/
      index.ts          ← agent entry point
      x402.ts           ← x402 payment protocol handler
      trust.ts          ← trust layer check (calls E1 backend)
      stellar.ts        ← Stellar SDK wrapper
      logger.ts         ← event log writer
    tsconfig.json
  dashboard/            ← React + Vite app
    src/
      App.tsx
      components/
        TransactionFeed.tsx
        BudgetBar.tsx
        PolicyPanel.tsx
        RevokeButton.tsx
      api.ts            ← backend API client
    index.html
    vite.config.ts
    package.json
  .env.example
  .env
  package.json          ← workspace root
  tsconfig.base.json
```

**Create root `package.json` (npm workspaces):**
```json
{
  "name": "trustlayer-agent",
  "private": true,
  "workspaces": ["services/service-a", "services/service-b", "agent", "dashboard"],
  "scripts": {
    "services": "concurrently \"npm run dev --workspace=services/service-a\" \"npm run dev --workspace=services/service-b\"",
    "agent": "npm run dev --workspace=agent",
    "dashboard": "npm run dev --workspace=dashboard",
    "dev": "concurrently \"npm run services\" \"npm run agent\" \"npm run dashboard\""
  },
  "devDependencies": {
    "concurrently": "^8.0.0"
  }
}
```

**Create `.env.example`:**
```
# From Engineer 1
TRUST_POLICY_CONTRACT_ID=C...
BACKEND_URL=http://localhost:3001
SERVICE_A_ADDRESS=G...
SERVICE_B_ADDRESS=G...

# Agent Stellar keypair (separate from owner)
AGENT_PUBLIC_KEY=G...
AGENT_SECRET_KEY=S...

# LLM for agent reasoning
ANTHROPIC_API_KEY=sk-ant-...

# Ports
SERVICE_A_PORT=4001
SERVICE_B_PORT=4002
AGENT_PORT=4003
DASHBOARD_PORT=5173
```

**Install root deps:**
```bash
npm install
```

**Deliverable:** Repo structure created. `npm install` completes. Copy `.env.example` to `.env` and fill in values from Engineer 1 (TRUST_POLICY_CONTRACT_ID, BACKEND_URL, SERVICE_A_ADDRESS, SERVICE_B_ADDRESS).

---

## PROMPT E2-02 — Stellar SDK Setup + Agent Wallet

You are a TypeScript engineer. Set up the Stellar SDK and create a funded agent wallet for the TrustLayer agent. The agent needs its own keypair to sign x402 payment transactions — separate from the owner keypair.

**Create `agent/package.json`:**
```json
{
  "name": "trustlayer-agent-runtime",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.24.0",
    "@stellar/stellar-sdk": "^12.0.0",
    "axios": "^1.6.0",
    "dotenv": "^16.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.0.0"
  }
}
```

**Create `agent/src/stellar.ts`:**

```typescript
import {
  Keypair,
  Networks,
  TransactionBuilder,
  BASE_FEE,
  Operation,
  Asset,
  SorobanRpc,
  Memo,
} from '@stellar/stellar-sdk';
import dotenv from 'dotenv';
dotenv.config();

export const NETWORK_PASSPHRASE = Networks.TESTNET;
export const RPC_URL = 'https://soroban-testnet.stellar.org';
export const HORIZON_URL = 'https://horizon-testnet.stellar.org';

export const server = new SorobanRpc.Server(RPC_URL);

// The agent's own keypair — used to sign x402 payments
// NOT the owner keypair — the agent is a separate identity
export const agentKeypair = Keypair.fromSecret(process.env.AGENT_SECRET_KEY!);

/**
 * Generate a fresh keypair and fund it from friendbot.
 * Run this ONCE to create the agent wallet. Save output to .env.
 */
export async function generateAndFundAgentWallet(): Promise<void> {
  const kp = Keypair.random();
  console.log('AGENT_PUBLIC_KEY=' + kp.publicKey());
  console.log('AGENT_SECRET_KEY=' + kp.secret());

  const fundUrl = `https://friendbot.stellar.org?addr=${kp.publicKey()}`;
  const res = await fetch(fundUrl);
  if (!res.ok) throw new Error('Friendbot failed: ' + await res.text());
  console.log('Agent wallet funded on testnet');
}

/**
 * Send a native XLM payment (used for x402 demo with XLM).
 * In production this would be USDC via the Stellar asset contract.
 */
export async function sendPayment(params: {
  destination: string;
  amount: string; // In XLM — e.g. "1.0000000"
  memo?: string;
}): Promise<{ txHash: string; success: boolean; error?: string }> {
  try {
    const account = await server.getAccount(agentKeypair.publicKey());

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        Operation.payment({
          destination: params.destination,
          asset: Asset.native(),
          amount: params.amount,
        })
      )
      .addMemo(params.memo ? Memo.text(params.memo.slice(0, 28)) : Memo.none())
      .setTimeout(30)
      .build();

    tx.sign(agentKeypair);

    // Use Horizon for classic payments (not Soroban)
    const horizonServer = new (await import('@stellar/stellar-sdk')).Horizon.Server(HORIZON_URL);
    const result = await horizonServer.submitTransaction(tx);

    return { txHash: result.hash, success: true };
  } catch (e: any) {
    const detail = e?.response?.data?.extras?.result_codes || e.message;
    return { success: false, txHash: '', error: JSON.stringify(detail) };
  }
}

/**
 * Convert USDC amount (human-readable) to stroops equivalent for policy checks.
 * Stellar USDC has 7 decimal places: 1 USDC = 10_000_000 stroops
 */
export function usdcToStroops(usdc: number): number {
  return Math.round(usdc * 10_000_000);
}

export function stroopsToUsdc(stroops: number): string {
  return (stroops / 10_000_000).toFixed(7);
}
```

**Run this one-time to create and fund the agent wallet:**
```bash
cd agent
npx tsx -e "
import { generateAndFundAgentWallet } from './src/stellar.ts';
generateAndFundAgentWallet().then(() => process.exit(0));
"
```
Copy the output `AGENT_PUBLIC_KEY` and `AGENT_SECRET_KEY` into `.env`.

**Verify the wallet:**
```bash
curl "https://horizon-testnet.stellar.org/accounts/$AGENT_PUBLIC_KEY" | python3 -m json.tool | grep balance
```

**Deliverable:** Agent wallet created, funded, credentials in `.env`. Stellar SDK installed. `sendPayment` function tested with a 0.0000001 XLM self-payment to confirm the signing pipeline works.

---

## PROMPT E2-03 — Mock Paid Service A (Weather Data API)

You are a TypeScript engineer building a mock "weather data" HTTP service that implements the x402 payment protocol. When an agent calls this service without payment, it returns HTTP 402 with payment instructions. After payment, it returns mock weather data.

**Create `services/service-a/package.json`:**
```json
{
  "name": "trustlayer-service-a",
  "version": "1.0.0",
  "type": "module",
  "scripts": { "dev": "tsx watch index.ts" },
  "dependencies": {
    "express": "^4.18.0",
    "dotenv": "^16.0.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.0",
    "@types/node": "^20.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.0.0"
  }
}
```

**Create `services/service-a/index.ts`:**

```typescript
import express from 'express';
import dotenv from 'dotenv';
import crypto from 'crypto';
dotenv.config({ path: '../../.env' });

const app = express();
app.use(express.json());

const PORT = process.env.SERVICE_A_PORT || 4001;
// The Stellar address that should receive payment for this service
const PAYMENT_ADDRESS = process.env.SERVICE_A_ADDRESS!;
// Price per request: 1 USDC = 10_000_000 stroops
// For demo purposes, we use 0.5 XLM (XLM native, easier for testnet demo)
const PRICE_XLM = '0.5000000';
const PRICE_STROOPS = 5_000_000; // used in 402 header for policy check

// Simple in-memory token store — in production this would be verified onchain
const validPaymentTokens = new Set<string>();

/**
 * x402 Payment Required response.
 * The WWW-Authenticate header tells the agent exactly what to pay and where.
 * Format follows the x402 spec: https://github.com/coinbase/x402
 */
function send402(res: express.Response, resource: string): void {
  res.status(402)
    .set({
      'WWW-Authenticate': [
        `Stellar realm="TrustLayer Weather Service"`,
        `address="${PAYMENT_ADDRESS}"`,
        `amount="${PRICE_XLM}"`,
        `asset="native"`,
        `network="testnet"`,
        `memo="weather:${resource}"`,
      ].join(', '),
      'X-Payment-Amount-Stroops': String(PRICE_STROOPS),
      'X-Service-Name': 'Weather Data API',
      'Content-Type': 'application/json',
    })
    .json({
      error: 'Payment Required',
      service: 'Weather Data API',
      resource,
      price: { xlm: PRICE_XLM, stroops: PRICE_STROOPS },
      payTo: PAYMENT_ADDRESS,
      instructions: 'Send a Stellar payment to the address above, then retry with X-Payment-TxHash header',
    });
}

/**
 * Verify a payment by checking the tx hash was submitted.
 * In production: verify onchain that the payment went to PAYMENT_ADDRESS.
 * For hackathon: check the header exists and looks like a valid tx hash.
 */
function verifyPayment(txHash: string | undefined): boolean {
  if (!txHash) return false;
  // Accept if it looks like a valid Stellar tx hash (64 hex chars)
  // OR if it's in our valid token store
  const isValidFormat = /^[a-fA-F0-9]{64}$/.test(txHash);
  return isValidFormat || validPaymentTokens.has(txHash);
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.get('/weather/:city', (req, res) => {
  const { city } = req.params;
  const txHash = req.headers['x-payment-txhash'] as string | undefined;

  if (!verifyPayment(txHash)) {
    return send402(res, city);
  }

  // Paid — return mock weather data
  const mockData = {
    city,
    temperature: Math.round(20 + Math.random() * 15),
    unit: 'celsius',
    condition: ['sunny', 'cloudy', 'rainy', 'windy'][Math.floor(Math.random() * 4)],
    humidity: Math.round(40 + Math.random() * 40),
    fetched_at: new Date().toISOString(),
    paid_with_tx: txHash,
    service: 'TrustLayer Weather API (testnet demo)',
  };

  console.log(`[Service A] Paid request for ${city} — tx: ${txHash?.slice(0, 16)}...`);
  res.json(mockData);
});

app.get('/health', (_, res) => {
  res.json({ service: 'weather-api', address: PAYMENT_ADDRESS, price: PRICE_XLM });
});

app.listen(PORT, () => {
  console.log(`Service A (Weather) running on :${PORT}`);
  console.log(`Payment address: ${PAYMENT_ADDRESS}`);
  console.log(`Price: ${PRICE_XLM} XLM per request`);
});
```

**Test it:**
```bash
cd services/service-a && npm install && npm run dev
# In another terminal:
curl http://localhost:4001/weather/Lagos
# Should get 402 with payment instructions
curl -H "X-Payment-TxHash: aabbccdd$(python3 -c 'import random,string; print(\"\".join(random.choices(\"0123456789abcdef\",k=56)))')" http://localhost:4001/weather/Lagos
# Should get weather data
```

**Deliverable:** Service A running. GET `/weather/:city` returns 402 without payment header, returns data with any valid 64-char hex hash. Note the `X-Payment-Amount-Stroops` header — Engineer 2's trust module reads this to know how much to authorize.

---

## PROMPT E2-04 — Mock Paid Service B (Research Summary API)

You are a TypeScript engineer building a mock "research summary" HTTP service — the second paid service the agent can call.

**Create `services/service-b/index.ts`** (same package.json pattern as service-a):

```typescript
import express from 'express';
import dotenv from 'dotenv';
dotenv.config({ path: '../../.env' });

const app = express();
app.use(express.json());

const PORT = process.env.SERVICE_B_PORT || 4002;
const PAYMENT_ADDRESS = process.env.SERVICE_B_ADDRESS!;
const PRICE_XLM = '1.0000000';  // Research costs more than weather
const PRICE_STROOPS = 10_000_000;

function send402(res: express.Response, topic: string): void {
  res.status(402)
    .set({
      'WWW-Authenticate': [
        `Stellar realm="TrustLayer Research Service"`,
        `address="${PAYMENT_ADDRESS}"`,
        `amount="${PRICE_XLM}"`,
        `asset="native"`,
        `network="testnet"`,
        `memo="research:${topic.slice(0, 20)}"`,
      ].join(', '),
      'X-Payment-Amount-Stroops': String(PRICE_STROOPS),
      'X-Service-Name': 'Research Summary API',
      'Content-Type': 'application/json',
    })
    .json({
      error: 'Payment Required',
      service: 'Research Summary API',
      topic,
      price: { xlm: PRICE_XLM, stroops: PRICE_STROOPS },
      payTo: PAYMENT_ADDRESS,
      instructions: 'Send a Stellar payment to the address above, then retry with X-Payment-TxHash header',
    });
}

function verifyPayment(txHash: string | undefined): boolean {
  if (!txHash) return false;
  return /^[a-fA-F0-9]{64}$/.test(txHash);
}

const MOCK_RESEARCH: Record<string, string> = {
  stellar: 'Stellar is a decentralized protocol for fast, low-cost cross-border payments. Key innovations include the Stellar Consensus Protocol (SCP) and built-in DEX. Soroban is its smart contract platform.',
  defi: 'DeFi on Stellar is growing with AMMs, lending protocols, and stablecoin infrastructure. USDC is natively issued on Stellar. x402 enables micropayment-native APIs.',
  agents: 'AI agents are becoming economic actors — capable of reasoning, planning, and executing financial transactions. The main bottleneck is secure, scoped payment authorization.',
  default: 'Research summary not available for this topic. Please try: stellar, defi, or agents.',
};

app.get('/research/:topic', (req, res) => {
  const { topic } = req.params;
  const txHash = req.headers['x-payment-txhash'] as string | undefined;

  if (!verifyPayment(txHash)) {
    return send402(res, topic);
  }

  const summary = MOCK_RESEARCH[topic.toLowerCase()] || MOCK_RESEARCH.default;

  console.log(`[Service B] Paid research request: ${topic} — tx: ${txHash?.slice(0, 16)}...`);
  res.json({
    topic,
    summary,
    word_count: summary.split(' ').length,
    fetched_at: new Date().toISOString(),
    paid_with_tx: txHash,
    service: 'TrustLayer Research API (testnet demo)',
  });
});

app.get('/health', (_, res) => {
  res.json({ service: 'research-api', address: PAYMENT_ADDRESS, price: PRICE_XLM });
});

app.listen(PORT, () => {
  console.log(`Service B (Research) running on :${PORT}`);
  console.log(`Payment address: ${PAYMENT_ADDRESS}`);
  console.log(`Price: ${PRICE_XLM} XLM per request`);
});
```

**Deliverable:** Both services running simultaneously:
- `http://localhost:4001/weather/:city` — 0.5 XLM per call
- `http://localhost:4002/research/:topic` — 1.0 XLM per call

Both return 402 with `X-Payment-Amount-Stroops` header. Both accept any valid 64-char hex tx hash. Services are independent — each has its own Stellar address that receives payment.

---

## PROMPT E2-05 — x402 Protocol Handler

You are a TypeScript engineer building the x402 payment handler for the TrustLayer agent. This module is the bridge between HTTP 402 responses and actual Stellar payments.

**Create `agent/src/x402.ts`:**

```typescript
import axios, { AxiosResponse } from 'axios';
import { sendPayment } from './stellar.js';

export interface X402PaymentRequired {
  address: string;       // Stellar address to pay
  amount: string;        // XLM amount as string
  amountStroops: number; // For trust policy check
  asset: string;         // 'native' for XLM
  network: string;       // 'testnet' or 'mainnet'
  memo?: string;         // Optional payment memo
  serviceName: string;   // Human-readable service name
}

export interface X402Result {
  success: boolean;
  data?: any;
  txHash?: string;
  paymentDetails?: X402PaymentRequired;
  error?: string;
  blocked?: boolean;  // true if blocked by trust policy (not a payment failure)
}

/**
 * Parse the WWW-Authenticate header from a 402 response.
 * Header format: Stellar realm="...", address="G...", amount="1.0", asset="native", ...
 */
export function parse402Header(header: string): X402PaymentRequired | null {
  try {
    const get = (key: string): string => {
      const match = header.match(new RegExp(`${key}="([^"]+)"`));
      return match ? match[1] : '';
    };

    const address = get('address');
    const amount = get('amount');
    const asset = get('asset') || 'native';
    const network = get('network') || 'testnet';
    const memo = get('memo');
    const realm = get('realm');

    if (!address || !amount) {
      console.error('[x402] Failed to parse required fields from header:', header);
      return null;
    }

    return {
      address,
      amount,
      amountStroops: Math.round(parseFloat(amount) * 10_000_000),
      asset,
      network,
      memo,
      serviceName: realm,
    };
  } catch (e) {
    console.error('[x402] Header parse error:', e);
    return null;
  }
}

/**
 * Make an HTTP request that handles x402 payment challenges.
 * Flow:
 *   1. Make the request
 *   2. If 402, parse payment requirements
 *   3. Check with trust layer (Engineer 1's backend)
 *   4. If approved, make Stellar payment
 *   5. Retry original request with payment proof
 *
 * onPaymentRequired: callback that checks trust policy BEFORE paying
 * Returns the final response data or an error
 */
export async function fetchWithPayment(
  url: string,
  options: {
    onPaymentRequired: (details: X402PaymentRequired) => Promise<boolean>;
    onPaymentMade?: (txHash: string, details: X402PaymentRequired) => Promise<void>;
    maxRetries?: number;
  }
): Promise<X402Result> {
  const { onPaymentRequired, onPaymentMade, maxRetries = 1 } = options;

  try {
    // First attempt — no payment header
    const response = await axios.get(url, {
      validateStatus: (status) => status < 500, // Don't throw on 402
    });

    if (response.status === 200) {
      return { success: true, data: response.data };
    }

    if (response.status !== 402) {
      return { success: false, error: `Unexpected status ${response.status}` };
    }

    // ── Got 402 — parse payment requirements ──────────────────────────────
    const wwwAuth = response.headers['www-authenticate'] as string;
    const amountStroopsHeader = response.headers['x-payment-amount-stroops'];

    if (!wwwAuth) {
      return { success: false, error: 'Got 402 but no WWW-Authenticate header' };
    }

    const paymentDetails = parse402Header(wwwAuth);
    if (!paymentDetails) {
      return { success: false, error: 'Could not parse 402 payment requirements' };
    }

    // Override stroops from the dedicated header if available (more reliable)
    if (amountStroopsHeader) {
      paymentDetails.amountStroops = parseInt(amountStroopsHeader);
    }

    console.log(`[x402] Payment required for ${url}`);
    console.log(`  → Pay: ${paymentDetails.amount} XLM to ${paymentDetails.address.slice(0, 8)}...`);

    // ── Check trust policy before paying ──────────────────────────────────
    const approved = await onPaymentRequired(paymentDetails);
    if (!approved) {
      console.log(`[x402] Payment BLOCKED by trust policy for ${url}`);
      return {
        success: false,
        blocked: true,
        paymentDetails,
        error: 'Blocked by TrustLayer policy',
      };
    }

    // ── Make the Stellar payment ───────────────────────────────────────────
    console.log(`[x402] Trust approved — sending payment...`);
    const payment = await sendPayment({
      destination: paymentDetails.address,
      amount: paymentDetails.amount,
      memo: paymentDetails.memo,
    });

    if (!payment.success) {
      return {
        success: false,
        paymentDetails,
        error: `Payment failed: ${payment.error}`,
      };
    }

    console.log(`[x402] Payment confirmed: ${payment.txHash}`);

    // Notify caller about the payment (for audit logging)
    if (onPaymentMade) {
      await onPaymentMade(payment.txHash, paymentDetails);
    }

    // ── Retry the original request with payment proof ─────────────────────
    const retryResponse = await axios.get(url, {
      headers: { 'X-Payment-TxHash': payment.txHash },
      validateStatus: (status) => status < 500,
    });

    if (retryResponse.status === 200) {
      return {
        success: true,
        data: retryResponse.data,
        txHash: payment.txHash,
        paymentDetails,
      };
    }

    return {
      success: false,
      txHash: payment.txHash,
      paymentDetails,
      error: `Retry failed with status ${retryResponse.status}`,
    };

  } catch (e: any) {
    return { success: false, error: e.message };
  }
}
```

**Deliverable:** Module compiles. Test it manually:
```typescript
// Quick smoke test — run with: npx tsx test-x402.ts
import { parse402Header } from './src/x402.js';
const header = 'Stellar realm="Weather API", address="GABC123", amount="0.5", asset="native", network="testnet"';
const parsed = parse402Header(header);
console.log(parsed);
// Should output the parsed object with all fields
```

---

## PROMPT E2-06 — Trust Layer Integration Module

You are a TypeScript engineer. Build the module that calls Engineer 1's backend to check the trust policy before every payment. This is the critical integration point.

**Create `agent/src/trust.ts`:**

```typescript
import axios from 'axios';
import dotenv from 'dotenv';
import type { X402PaymentRequired } from './x402.js';
dotenv.config();

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

export interface TrustCheckResult {
  authorized: boolean;
  txHash?: string;      // The Soroban transaction hash for the authorize() call
  reason?: string;      // Why it was blocked, if applicable
  error?: string;       // System error (not a policy block)
}

export interface PolicyState {
  owner: string;
  perTxCap: number;
  dailyCap: number;
  totalBudget: number;
  spentToday: number;
  spentTotal: number;
  revoked: boolean;
}

/**
 * Check with the TrustLayer contract (via E1 backend) whether this payment is allowed.
 * This is called BEFORE every x402 payment.
 *
 * @param recipient - The Stellar address that will receive the payment
 * @param amountStroops - The payment amount in stroops
 */
export async function checkTrustPolicy(
  recipient: string,
  amountStroops: number
): Promise<TrustCheckResult> {
  try {
    console.log(`[Trust] Checking policy: ${amountStroops} stroops → ${recipient.slice(0, 8)}...`);

    const response = await axios.post(
      `${BACKEND_URL}/authorize`,
      { recipient, amount: amountStroops },
      { timeout: 15_000 } // 15s timeout — Stellar testnet can be slow
    );

    const { authorized, txHash, reason } = response.data;

    if (authorized) {
      console.log(`[Trust] APPROVED ✓ (soroban tx: ${txHash?.slice(0, 16)}...)`);
    } else {
      console.log(`[Trust] BLOCKED ✗ — reason: ${reason}`);
    }

    return { authorized, txHash, reason };
  } catch (e: any) {
    // If the backend is unreachable, FAIL CLOSED — block the payment
    // This is the correct security default: no trust check = no payment
    console.error(`[Trust] Backend unreachable — failing closed:`, e.message);
    return {
      authorized: false,
      error: `Trust backend unreachable: ${e.message}`,
    };
  }
}

/**
 * Record a completed payment with the TrustLayer contract.
 * Called AFTER payment is confirmed on Stellar.
 * Creates the immutable onchain audit trail.
 */
export async function recordPayment(
  recipient: string,
  amountStroops: number,
  stellarTxHash: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await axios.post(
      `${BACKEND_URL}/record-payment`,
      { recipient, amount: amountStroops, txHash: stellarTxHash },
      { timeout: 15_000 }
    );
    console.log(`[Trust] Payment recorded onchain ✓`);
    return { success: true };
  } catch (e: any) {
    console.error(`[Trust] Failed to record payment:`, e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Get the current policy state from the backend.
 * Used by the agent to log its operating context.
 */
export async function getPolicyState(): Promise<PolicyState | null> {
  try {
    const response = await axios.get(`${BACKEND_URL}/policy`, { timeout: 10_000 });
    return response.data;
  } catch {
    return null;
  }
}

/**
 * Build the onPaymentRequired callback for fetchWithPayment().
 * This is the glue between x402.ts and trust.ts.
 */
export function makeTrustCallback(): (details: X402PaymentRequired) => Promise<boolean> {
  return async (details: X402PaymentRequired): Promise<boolean> => {
    const result = await checkTrustPolicy(details.address, details.amountStroops);
    return result.authorized;
  };
}
```

**Test the integration** (with E1 backend running):
```bash
# Quick test — should return authorized: true
curl -X POST http://localhost:3001/authorize \
  -H "Content-Type: application/json" \
  -d "{\"recipient\": \"$SERVICE_A_ADDRESS\", \"amount\": 5000000}"
```

**Deliverable:** Trust module compiles. The `makeTrustCallback()` function returns the right callback shape for `fetchWithPayment()`. The critical design choice is documented in a comment: **fail closed** — if the backend is unreachable, payments are blocked, not allowed. This is the correct default for a trust layer.

---

## PROMPT E2-07 — Event Logger

You are a TypeScript engineer. Build the event logger that writes every agent action to a local append-only JSON log. This feeds the dashboard's live transaction feed.

**Create `agent/src/logger.ts`:**

```typescript
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_PATH = path.join(__dirname, '../../agent-events.jsonl');

export type EventType =
  | 'agent_start'
  | 'task_received'
  | 'service_call_attempt'
  | 'trust_check'
  | 'trust_approved'
  | 'trust_blocked'
  | 'payment_sent'
  | 'payment_confirmed'
  | 'service_response'
  | 'task_complete'
  | 'error';

export interface AgentEvent {
  id: string;
  timestamp: string;
  type: EventType;
  service?: string;        // Which service was called
  recipient?: string;      // Stellar address
  amountStroops?: number;  // Payment amount
  amountXlm?: string;      // Human readable
  txHash?: string;         // Stellar or Soroban tx hash
  result?: 'approved' | 'blocked' | 'success' | 'failure';
  reason?: string;         // Block reason or error
  data?: any;              // Additional context
}

let eventIdCounter = 0;

/**
 * Write an event to the append-only JSONL log.
 * Each line is a complete JSON object — easy to tail and parse.
 */
export function logEvent(event: Omit<AgentEvent, 'id' | 'timestamp'>): AgentEvent {
  const fullEvent: AgentEvent = {
    id: `evt_${Date.now()}_${++eventIdCounter}`,
    timestamp: new Date().toISOString(),
    ...event,
  };

  const line = JSON.stringify(fullEvent) + '\n';
  fs.appendFileSync(LOG_PATH, line, 'utf8');

  // Also log to console for development visibility
  const icon = {
    agent_start: '🚀',
    task_received: '📋',
    service_call_attempt: '📡',
    trust_check: '🔐',
    trust_approved: '✅',
    trust_blocked: '🚫',
    payment_sent: '💸',
    payment_confirmed: '✓',
    service_response: '📦',
    task_complete: '🏁',
    error: '❌',
  }[event.type] || '•';

  console.log(`${icon} [${fullEvent.timestamp.slice(11, 19)}] ${event.type}`, 
    event.recipient ? `→ ${event.recipient.slice(0, 8)}...` : '',
    event.amountStroops ? `(${(event.amountStroops / 10_000_000).toFixed(1)} XLM)` : '',
    event.result ? `[${event.result}]` : '',
    event.reason ? `— ${event.reason}` : ''
  );

  return fullEvent;
}

/**
 * Read recent events from the log.
 * Dashboard polls this via the agent's local HTTP server.
 */
export function getRecentEvents(limit = 50): AgentEvent[] {
  try {
    if (!fs.existsSync(LOG_PATH)) return [];
    const content = fs.readFileSync(LOG_PATH, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    const events = lines.map(line => JSON.parse(line) as AgentEvent);
    return events.slice(-limit).reverse(); // Most recent first
  } catch {
    return [];
  }
}

/**
 * Clear the log — used before each demo run.
 */
export function clearLog(): void {
  if (fs.existsSync(LOG_PATH)) {
    fs.writeFileSync(LOG_PATH, '', 'utf8');
  }
  eventIdCounter = 0;
  console.log('[Logger] Event log cleared');
}
```

**Deliverable:** Logger module compiles. Add a test event:
```typescript
import { logEvent } from './src/logger.js';
logEvent({ type: 'agent_start', data: { version: '1.0.0' } });
```
Confirm `agent-events.jsonl` is created with the event as a JSON line.

---

## PROMPT E2-08 — AI Agent Reasoning Loop

You are a TypeScript engineer building the intelligent agent core for TrustLayer. The agent uses Claude as its reasoning layer to decide which paid services to call in order to complete a research goal. Every service call goes through the x402 + trust layer pipeline.

**Create `agent/src/index.ts`:**

```typescript
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import http from 'http';
import { fetchWithPayment } from './x402.js';
import { makeTrustCallback, recordPayment, getPolicyState } from './trust.js';
import { logEvent, getRecentEvents, clearLog } from './logger.js';
dotenv.config();

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Available tools the agent can call ───────────────────────────────────────
const SERVICE_A_URL = `http://localhost:${process.env.SERVICE_A_PORT || 4001}`;
const SERVICE_B_URL = `http://localhost:${process.env.SERVICE_B_PORT || 4002}`;

interface ServiceCall {
  service: 'weather' | 'research';
  params: Record<string, string>;
  url: string;
  recipientAddress: string;
}

function buildServiceCall(service: 'weather' | 'research', params: Record<string, string>): ServiceCall {
  if (service === 'weather') {
    return {
      service,
      params,
      url: `${SERVICE_A_URL}/weather/${params.city || 'Lagos'}`,
      recipientAddress: process.env.SERVICE_A_ADDRESS!,
    };
  }
  return {
    service,
    params,
    url: `${SERVICE_B_URL}/research/${params.topic || 'stellar'}`,
    recipientAddress: process.env.SERVICE_B_ADDRESS!,
  };
}

// ── Agent tools schema for Claude ────────────────────────────────────────────
const AGENT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_weather',
    description: 'Fetch current weather data for a city. Costs 0.5 XLM per call.',
    input_schema: {
      type: 'object',
      properties: {
        city: { type: 'string', description: 'City name, e.g. Lagos, London, Tokyo' },
      },
      required: ['city'],
    },
  },
  {
    name: 'get_research',
    description: 'Fetch a research summary on a topic. Costs 1.0 XLM per call. Available topics: stellar, defi, agents.',
    input_schema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'Research topic: stellar, defi, or agents' },
      },
      required: ['topic'],
    },
  },
  {
    name: 'finish',
    description: 'Complete the task and return the final answer.',
    input_schema: {
      type: 'object',
      properties: {
        answer: { type: 'string', description: 'The complete answer to the user task' },
      },
      required: ['answer'],
    },
  },
];

// ── Execute a single service call through x402 + trust layer ─────────────────
async function executeServiceCall(call: ServiceCall): Promise<{ success: boolean; data?: any; error?: string }> {
  logEvent({
    type: 'service_call_attempt',
    service: call.service,
    recipient: call.recipientAddress,
    data: { url: call.url },
  });

  const trustCallback = makeTrustCallback();

  const result = await fetchWithPayment(call.url, {
    onPaymentRequired: async (details) => {
      logEvent({
        type: 'trust_check',
        service: call.service,
        recipient: details.address,
        amountStroops: details.amountStroops,
        amountXlm: details.amount,
      });

      const approved = await trustCallback(details);

      logEvent({
        type: approved ? 'trust_approved' : 'trust_blocked',
        service: call.service,
        recipient: details.address,
        amountStroops: details.amountStroops,
        result: approved ? 'approved' : 'blocked',
      });

      return approved;
    },

    onPaymentMade: async (txHash, details) => {
      logEvent({
        type: 'payment_confirmed',
        service: call.service,
        recipient: details.address,
        amountStroops: details.amountStroops,
        amountXlm: details.amount,
        txHash,
        result: 'success',
      });

      // Record the payment onchain for the audit trail
      await recordPayment(details.address, details.amountStroops, txHash);
    },
  });

  if (result.success) {
    logEvent({
      type: 'service_response',
      service: call.service,
      result: 'success',
      data: { keys: Object.keys(result.data || {}) },
    });
    return { success: true, data: result.data };
  }

  if (result.blocked) {
    return { success: false, error: 'Blocked by TrustLayer policy — agent stopped' };
  }

  return { success: false, error: result.error };
}

// ── Main agent loop ───────────────────────────────────────────────────────────
export async function runAgent(task: string): Promise<string> {
  logEvent({ type: 'task_received', data: { task } });

  const policy = await getPolicyState();
  if (policy?.revoked) {
    logEvent({ type: 'error', reason: 'Agent is revoked — cannot start' });
    return 'Agent is currently revoked by the owner. Cannot execute tasks.';
  }

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: `You are a research agent with access to paid data services. 
Complete this task using the available tools: "${task}"

Important: Each tool call costs real money (XLM). Be efficient — only call tools you need.
Available tools:
- get_weather: Fetch weather for any city (0.5 XLM)
- get_research: Research summaries on stellar, defi, or agents (1.0 XLM)
- finish: Return your final answer

Start by planning which tools you need, then call them, then finish.`,
    },
  ];

  let iterations = 0;
  const MAX_ITERATIONS = 8; // Safety limit on spending

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    const response = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 1024,
      tools: AGENT_TOOLS,
      messages,
    });

    // Add assistant response to history
    messages.push({ role: 'assistant', content: response.content });

    // Handle tool calls
    const toolUses = response.content.filter(b => b.type === 'tool_use');

    if (toolUses.length === 0 || response.stop_reason === 'end_turn') {
      // No more tool calls — extract final text
      const textBlock = response.content.find(b => b.type === 'text');
      const answer = textBlock?.type === 'text' ? textBlock.text : 'Task complete';
      logEvent({ type: 'task_complete', data: { answer: answer.slice(0, 100) } });
      return answer;
    }

    // Execute each tool call
    const toolResults: Anthropic.MessageParam['content'] = [];

    for (const toolUse of toolUses) {
      if (toolUse.type !== 'tool_use') continue;

      if (toolUse.name === 'finish') {
        const input = toolUse.input as { answer: string };
        logEvent({ type: 'task_complete', data: { answer: input.answer.slice(0, 100) } });
        return input.answer;
      }

      let serviceResult: { success: boolean; data?: any; error?: string };

      if (toolUse.name === 'get_weather') {
        const input = toolUse.input as { city: string };
        const call = buildServiceCall('weather', { city: input.city });
        serviceResult = await executeServiceCall(call);
      } else if (toolUse.name === 'get_research') {
        const input = toolUse.input as { topic: string };
        const call = buildServiceCall('research', { topic: input.topic });
        serviceResult = await executeServiceCall(call);
      } else {
        serviceResult = { success: false, error: `Unknown tool: ${toolUse.name}` };
      }

      // If blocked by trust policy, stop the agent
      if (!serviceResult.success && serviceResult.error?.includes('TrustLayer')) {
        const blockedMsg = `Agent stopped: ${serviceResult.error}`;
        logEvent({ type: 'error', reason: blockedMsg });
        return blockedMsg;
      }

      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: serviceResult.success
          ? JSON.stringify(serviceResult.data)
          : `Error: ${serviceResult.error}`,
      });
    }

    messages.push({ role: 'user', content: toolResults });
  }

  return 'Agent reached maximum iterations';
}

// ── Local HTTP server — accepts tasks and serves events to dashboard ──────────
const PORT = process.env.AGENT_PORT || 4003;

const agentServer = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (req.method === 'GET' && req.url === '/events') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ events: getRecentEvents(100) }));
  }

  if (req.method === 'POST' && req.url === '/run') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { task } = JSON.parse(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'started', task }));
        // Run agent in background
        runAgent(task).then(result => {
          console.log('[Agent] Task complete:', result.slice(0, 100));
        });
      } catch (e: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/clear') {
    clearLog();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true }));
  }

  res.writeHead(404);
  res.end('Not found');
});

agentServer.listen(PORT, () => {
  console.log(`Agent runtime server on :${PORT}`);
  logEvent({ type: 'agent_start', data: { port: PORT } });
});

// ── CLI entry point ───────────────────────────────────────────────────────────
if (process.argv[2] === 'run') {
  const task = process.argv.slice(3).join(' ') || 'Research Stellar DeFi and get weather for Lagos';
  runAgent(task).then(console.log).catch(console.error);
}
```

**Test the agent:**
```bash
# Make sure services are running (service-a and service-b)
# Make sure E1 backend is running on :3001
cd agent
npx tsx src/index.ts run "Get weather for Lagos and research the Stellar ecosystem"
```

**Deliverable:** Agent runs, calls services, checks trust policy before each payment, logs every event. Trust blocks propagate cleanly — if the agent is revoked mid-task, it stops on the next tool call.

---

## PROMPT E2-09 — React Dashboard Scaffold

You are a React/TypeScript engineer scaffolding the TrustLayer owner dashboard. This is the control panel a human uses to watch their agent spend money in real time.

**Create `dashboard/package.json`:**
```json
{
  "name": "trustlayer-dashboard",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "axios": "^1.6.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "@vitejs/plugin-react": "^4.0.0",
    "typescript": "^5.0.0",
    "vite": "^5.0.0"
  }
}
```

**Create `dashboard/vite.config.ts`:**
```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
});
```

**Create `dashboard/src/api.ts` — the central API client:**

```typescript
import axios from 'axios';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
const AGENT = import.meta.env.VITE_AGENT_URL || 'http://localhost:4003';

export interface PolicyState {
  owner: string;
  perTxCap: number;
  dailyCap: number;
  totalBudget: number;
  spentToday: number;
  spentTotal: number;
  revoked: boolean;
}

export interface ContractEvent {
  id: string;
  type: string;
  subtype: string | null;
  value: any;
  ledger: number;
  ledgerClosedAt: string;
  txHash: string;
}

export interface AgentEvent {
  id: string;
  timestamp: string;
  type: string;
  service?: string;
  recipient?: string;
  amountStroops?: number;
  txHash?: string;
  result?: string;
  reason?: string;
}

export const api = {
  // ── Policy ──────────────────────────────────────────────────────────────
  getPolicy: () => axios.get<PolicyState>(`${BACKEND}/policy`).then(r => r.data),
  getAllowlist: () => axios.get<{ allowlist: string[] }>(`${BACKEND}/allowlist`).then(r => r.data),

  // ── Actions ──────────────────────────────────────────────────────────────
  revoke: () => axios.post<{ success: boolean; txHash: string }>(`${BACKEND}/revoke`).then(r => r.data),
  resume: () => axios.post<{ success: boolean; txHash: string }>(`${BACKEND}/resume`).then(r => r.data),
  updateCaps: (caps: { perTxCap?: number; dailyCap?: number; totalBudget?: number }) =>
    axios.post(`${BACKEND}/update-caps`, caps).then(r => r.data),
  addAllowlist: (address: string) =>
    axios.post(`${BACKEND}/add-allowlist`, { address }).then(r => r.data),
  removeAllowlist: (address: string) =>
    axios.post(`${BACKEND}/remove-allowlist`, { address }).then(r => r.data),

  // ── Events ───────────────────────────────────────────────────────────────
  getContractEvents: () =>
    axios.get<{ events: ContractEvent[] }>(`${BACKEND}/events`).then(r => r.data),
  getAgentEvents: () =>
    axios.get<{ events: AgentEvent[] }>(`${AGENT}/events`).then(r => r.data),

  // ── Agent control ─────────────────────────────────────────────────────────
  runAgent: (task: string) =>
    axios.post(`${AGENT}/run`, { task }).then(r => r.data),
  clearAgentLog: () =>
    axios.post(`${AGENT}/clear`).then(r => r.data),
};
```

**Create `dashboard/src/App.tsx`:**
```typescript
import { useState, useEffect, useCallback } from 'react';
import { api, PolicyState, AgentEvent } from './api';
import { TransactionFeed } from './components/TransactionFeed';
import { BudgetBar } from './components/BudgetBar';
import { RevokeButton } from './components/RevokeButton';
import { PolicyPanel } from './components/PolicyPanel';

export default function App() {
  const [policy, setPolicy] = useState<PolicyState | null>(null);
  const [agentEvents, setAgentEvents] = useState<AgentEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [task, setTask] = useState('Research Stellar DeFi and get weather for Lagos');

  const refreshPolicy = useCallback(async () => {
    try {
      const p = await api.getPolicy();
      setPolicy(p);
    } catch (e) {
      console.error('Failed to fetch policy:', e);
    }
  }, []);

  const refreshEvents = useCallback(async () => {
    try {
      const { events } = await api.getAgentEvents();
      setAgentEvents(events);
    } catch (e) {
      console.error('Failed to fetch agent events:', e);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      await Promise.all([refreshPolicy(), refreshEvents()]);
      setLoading(false);
    };
    init();

    // Poll every 2 seconds
    const interval = setInterval(() => {
      refreshPolicy();
      refreshEvents();
    }, 2000);

    return () => clearInterval(interval);
  }, [refreshPolicy, refreshEvents]);

  const handleRunAgent = async () => {
    await api.clearAgentLog();
    await api.runAgent(task);
    setTimeout(refreshEvents, 1000);
  };

  if (loading) {
    return (
      <div style={{ padding: 32, fontFamily: 'monospace', color: '#888' }}>
        Connecting to TrustLayer...
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: 24, fontFamily: 'system-ui' }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>TrustLayer</h1>
        <p style={{ color: '#888', margin: '4px 0 0', fontSize: 14 }}>
          Programmable trust for autonomous agent payments · Stellar testnet
        </p>
      </header>

      {policy && (
        <>
          <RevokeButton
            revoked={policy.revoked}
            onRevoke={async () => { await api.revoke(); await refreshPolicy(); }}
            onResume={async () => { await api.resume(); await refreshPolicy(); }}
          />

          <BudgetBar policy={policy} />

          <div style={{ margin: '16px 0', display: 'flex', gap: 8 }}>
            <input
              value={task}
              onChange={e => setTask(e.target.value)}
              style={{
                flex: 1, padding: '8px 12px', borderRadius: 8,
                border: '1px solid #ddd', fontSize: 14,
              }}
              placeholder="Give the agent a task..."
            />
            <button
              onClick={handleRunAgent}
              disabled={policy.revoked}
              style={{
                padding: '8px 20px', borderRadius: 8, border: 'none',
                background: policy.revoked ? '#ddd' : '#0066cc',
                color: policy.revoked ? '#999' : 'white',
                cursor: policy.revoked ? 'not-allowed' : 'pointer',
                fontSize: 14, fontWeight: 500,
              }}
            >
              Run Agent
            </button>
          </div>

          <PolicyPanel policy={policy} onUpdate={refreshPolicy} />
          <TransactionFeed events={agentEvents} />
        </>
      )}
    </div>
  );
}
```

**Deliverable:** Dashboard scaffold created. `npm install && npm run dev` runs without errors. The shell renders "TrustLayer" header and "Connecting..." state. Components are empty stubs for now — filled in E2-10 through E2-12.

---

## PROMPT E2-10 — Transaction Feed Component

You are a React engineer building the live transaction feed for the TrustLayer dashboard. This component shows every agent action in real time.

**Create `dashboard/src/components/TransactionFeed.tsx`:**

```typescript
import type { AgentEvent } from '../api';

const EVENT_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  trust_approved:    { label: 'Approved',   color: '#1a7a4a', bg: '#e6f7ef' },
  trust_blocked:     { label: 'Blocked',    color: '#b91c1c', bg: '#fef2f2' },
  payment_confirmed: { label: 'Paid',       color: '#1d4ed8', bg: '#eff6ff' },
  service_response:  { label: 'Data rcvd',  color: '#6b21a8', bg: '#faf5ff' },
  task_complete:     { label: 'Complete',   color: '#065f46', bg: '#ecfdf5' },
  error:             { label: 'Error',      color: '#991b1b', bg: '#fef2f2' },
  trust_check:       { label: 'Checking',   color: '#92400e', bg: '#fffbeb' },
  service_call_attempt: { label: 'Calling', color: '#374151', bg: '#f9fafb' },
};

function formatAmount(stroops: number): string {
  return (stroops / 10_000_000).toFixed(1) + ' XLM';
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

interface Props {
  events: AgentEvent[];
}

export function TransactionFeed({ events }: Props) {
  if (events.length === 0) {
    return (
      <div style={{
        marginTop: 24, padding: 32, textAlign: 'center',
        background: '#f9fafb', borderRadius: 12, color: '#9ca3af',
        fontSize: 14, border: '1px dashed #e5e7eb',
      }}>
        No agent activity yet. Run the agent to see live events here.
      </div>
    );
  }

  return (
    <div style={{ marginTop: 24 }}>
      <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: '#111' }}>
        Live activity
        <span style={{
          marginLeft: 8, fontSize: 12, fontWeight: 400,
          color: '#6b7280', background: '#f3f4f6',
          padding: '2px 8px', borderRadius: 10,
        }}>
          {events.length} events
        </span>
      </h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {events.map(event => {
          const config = EVENT_CONFIG[event.type] || {
            label: event.type, color: '#374151', bg: '#f9fafb'
          };

          return (
            <div key={event.id} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '10px 14px', borderRadius: 8,
              background: config.bg,
              border: `1px solid ${config.color}22`,
              fontSize: 13,
            }}>
              {/* Badge */}
              <span style={{
                padding: '2px 8px', borderRadius: 6,
                background: config.color + '18',
                color: config.color,
                fontWeight: 500, fontSize: 11,
                minWidth: 72, textAlign: 'center', flexShrink: 0,
              }}>
                {config.label}
              </span>

              {/* Service */}
              {event.service && (
                <span style={{
                  padding: '2px 8px', borderRadius: 6,
                  background: '#e5e7eb', color: '#374151',
                  fontSize: 11, flexShrink: 0,
                }}>
                  {event.service === 'weather' ? 'Weather API' : 'Research API'}
                </span>
              )}

              {/* Amount */}
              {event.amountStroops && (
                <span style={{ color: '#374151', fontWeight: 500, flexShrink: 0 }}>
                  {formatAmount(event.amountStroops)}
                </span>
              )}

              {/* Recipient */}
              {event.recipient && (
                <span style={{
                  color: '#6b7280', fontFamily: 'monospace', fontSize: 12, flexShrink: 0,
                }}>
                  {event.recipient.slice(0, 6)}...{event.recipient.slice(-4)}
                </span>
              )}

              {/* Tx hash */}
              {event.txHash && (
                <a
                  href={`https://stellar.expert/explorer/testnet/tx/${event.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    color: '#2563eb', fontFamily: 'monospace', fontSize: 11,
                    textDecoration: 'none', flexShrink: 0,
                  }}
                  title="View on Stellar Expert"
                >
                  {event.txHash.slice(0, 8)}...
                </a>
              )}

              {/* Reason */}
              {event.reason && (
                <span style={{ color: '#9ca3af', fontSize: 12, flexShrink: 0 }}>
                  {event.reason}
                </span>
              )}

              {/* Spacer */}
              <span style={{ flex: 1 }} />

              {/* Timestamp */}
              <span style={{ color: '#9ca3af', fontSize: 11, flexShrink: 0 }}>
                {formatTime(event.timestamp)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

**Deliverable:** Component renders correctly with mock data. Every trust_approved event shows green, trust_blocked shows red. Tx hashes link to stellar.expert testnet explorer. Empty state shows when no events exist.

---

## PROMPT E2-11 — Budget Bar Component

You are a React engineer. Build the budget visualization component — the most important "at a glance" element in the dashboard.

**Create `dashboard/src/components/BudgetBar.tsx`:**

```typescript
import type { PolicyState } from '../api';

function stroopsToXlm(stroops: number): string {
  return (stroops / 10_000_000).toFixed(2);
}

interface BarProps {
  label: string;
  spent: number;
  cap: number;
  color: string;
}

function SpendBar({ label, spent, cap, color }: BarProps) {
  const pct = cap > 0 ? Math.min(100, (spent / cap) * 100) : 0;
  const isWarning = pct >= 80;
  const barColor = pct >= 100 ? '#dc2626' : isWarning ? '#d97706' : color;

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        marginBottom: 5, fontSize: 13,
      }}>
        <span style={{ color: '#374151', fontWeight: 500 }}>{label}</span>
        <span style={{ color: '#6b7280' }}>
          {stroopsToXlm(spent)} / {stroopsToXlm(cap)} XLM
          <span style={{
            marginLeft: 8, fontWeight: 600,
            color: barColor,
          }}>
            ({pct.toFixed(0)}%)
          </span>
        </span>
      </div>
      <div style={{
        height: 8, background: '#f3f4f6',
        borderRadius: 4, overflow: 'hidden',
      }}>
        <div style={{
          height: '100%',
          width: `${pct}%`,
          background: barColor,
          borderRadius: 4,
          transition: 'width 0.4s ease, background 0.3s ease',
        }} />
      </div>
    </div>
  );
}

interface Props {
  policy: PolicyState;
}

export function BudgetBar({ policy }: Props) {
  const { perTxCap, dailyCap, totalBudget, spentToday, spentTotal, revoked } = policy;

  return (
    <div style={{
      padding: 20, borderRadius: 12,
      background: revoked ? '#fef2f2' : '#f9fafb',
      border: `1px solid ${revoked ? '#fecaca' : '#e5e7eb'}`,
      marginTop: 16,
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', marginBottom: 16,
      }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>Budget</h2>
        <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#6b7280' }}>
          <span>Per-tx limit: <strong style={{ color: '#111' }}>{stroopsToXlm(perTxCap)} XLM</strong></span>
        </div>
      </div>

      <SpendBar
        label="Today's spend"
        spent={spentToday}
        cap={dailyCap}
        color="#2563eb"
      />
      <SpendBar
        label="Total lifetime spend"
        spent={spentTotal}
        cap={totalBudget}
        color="#7c3aed"
      />

      {/* Summary stats */}
      <div style={{
        display: 'flex', gap: 16, marginTop: 12, paddingTop: 12,
        borderTop: '1px solid #e5e7eb', fontSize: 12,
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: '#6b7280' }}>Budget remaining</div>
          <div style={{ fontWeight: 600, fontSize: 15, color: '#111' }}>
            {stroopsToXlm(totalBudget - spentTotal)} XLM
          </div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: '#6b7280' }}>Today remaining</div>
          <div style={{ fontWeight: 600, fontSize: 15, color: '#111' }}>
            {stroopsToXlm(dailyCap - spentToday)} XLM
          </div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: '#6b7280' }}>Transactions today</div>
          <div style={{ fontWeight: 600, fontSize: 15, color: '#111' }}>
            {dailyCap > 0 ? Math.round(spentToday / perTxCap) : 0}
          </div>
        </div>
      </div>
    </div>
  );
}
```

**Deliverable:** BudgetBar renders with smooth animated fills. Goes amber at 80%, red at 100%. Shows XLM values with two decimal places. Background turns red when agent is revoked.

---

## PROMPT E2-12 — Revoke Button + Policy Panel

You are a React engineer. Build the two final dashboard components: the revoke/resume control and the policy configuration panel.

**Create `dashboard/src/components/RevokeButton.tsx`:**

```typescript
import { useState } from 'react';

interface Props {
  revoked: boolean;
  onRevoke: () => Promise<void>;
  onResume: () => Promise<void>;
}

export function RevokeButton({ revoked, onRevoke, onResume }: Props) {
  const [loading, setLoading] = useState(false);
  const [lastAction, setLastAction] = useState<string | null>(null);

  const handleRevoke = async () => {
    setLoading(true);
    try {
      await onRevoke();
      setLastAction('Agent revoked at ' + new Date().toLocaleTimeString());
    } catch (e: any) {
      setLastAction('Error: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResume = async () => {
    setLoading(true);
    try {
      await onResume();
      setLastAction('Agent resumed at ' + new Date().toLocaleTimeString());
    } catch (e: any) {
      setLastAction('Error: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px',
      borderRadius: 12,
      background: revoked ? '#fef2f2' : '#f0fdf4',
      border: `1px solid ${revoked ? '#fecaca' : '#bbf7d0'}`,
    }}>
      {/* Status indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{
          width: 10, height: 10, borderRadius: '50%',
          background: revoked ? '#ef4444' : '#22c55e',
          boxShadow: revoked
            ? '0 0 0 3px #fca5a533'
            : '0 0 0 3px #86efac33',
        }} />
        <span style={{
          fontWeight: 600, fontSize: 14,
          color: revoked ? '#b91c1c' : '#15803d',
        }}>
          {revoked ? 'Agent revoked' : 'Agent active'}
        </span>
      </div>

      <span style={{ flex: 1, fontSize: 12, color: '#9ca3af' }}>
        {lastAction || (revoked
          ? 'All payments are blocked until resumed'
          : 'Watching all payments through TrustLayer')}
      </span>

      {revoked ? (
        <button
          onClick={handleResume}
          disabled={loading}
          style={{
            padding: '8px 20px', borderRadius: 8, border: 'none',
            background: loading ? '#d1d5db' : '#16a34a',
            color: 'white', cursor: loading ? 'wait' : 'pointer',
            fontWeight: 600, fontSize: 13,
          }}
        >
          {loading ? 'Resuming...' : 'Resume agent'}
        </button>
      ) : (
        <button
          onClick={handleRevoke}
          disabled={loading}
          style={{
            padding: '8px 20px', borderRadius: 8, border: 'none',
            background: loading ? '#d1d5db' : '#dc2626',
            color: 'white', cursor: loading ? 'wait' : 'pointer',
            fontWeight: 600, fontSize: 13,
          }}
        >
          {loading ? 'Revoking...' : 'Revoke agent'}
        </button>
      )}
    </div>
  );
}
```

**Create `dashboard/src/components/PolicyPanel.tsx`:**

```typescript
import { useState } from 'react';
import { api, PolicyState } from '../api';

function stroopsToXlm(stroops: number): string {
  return (stroops / 10_000_000).toFixed(1);
}

function xlmToStroops(xlm: string): number {
  return Math.round(parseFloat(xlm) * 10_000_000);
}

interface Props {
  policy: PolicyState;
  onUpdate: () => void;
}

export function PolicyPanel({ policy, onUpdate }: Props) {
  const [open, setOpen] = useState(false);
  const [perTx, setPerTx] = useState(stroopsToXlm(policy.perTxCap));
  const [daily, setDaily] = useState(stroopsToXlm(policy.dailyCap));
  const [total, setTotal] = useState(stroopsToXlm(policy.totalBudget));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updateCaps({
        perTxCap: xlmToStroops(perTx),
        dailyCap: xlmToStroops(daily),
        totalBudget: xlmToStroops(total),
      });
      setMsg('Policy updated ✓');
      onUpdate();
      setTimeout(() => setMsg(''), 3000);
    } catch (e: any) {
      setMsg('Error: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      marginTop: 16, borderRadius: 12,
      border: '1px solid #e5e7eb', overflow: 'hidden',
    }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: '100%', padding: '12px 20px',
          background: '#f9fafb', border: 'none',
          display: 'flex', justifyContent: 'space-between',
          cursor: 'pointer', fontSize: 14, fontWeight: 500,
          color: '#374151',
        }}
      >
        <span>Policy configuration</span>
        <span style={{ color: '#9ca3af' }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{ padding: 20, background: 'white' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
            {[
              { label: 'Per-tx cap (XLM)', value: perTx, set: setPerTx },
              { label: 'Daily cap (XLM)', value: daily, set: setDaily },
              { label: 'Total budget (XLM)', value: total, set: setTotal },
            ].map(({ label, value, set }) => (
              <div key={label}>
                <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>
                  {label}
                </label>
                <input
                  type="number"
                  value={value}
                  onChange={e => set(e.target.value)}
                  step="0.5"
                  min="0"
                  style={{
                    width: '100%', padding: '8px 10px', borderRadius: 8,
                    border: '1px solid #d1d5db', fontSize: 14, boxSizing: 'border-box',
                  }}
                />
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                padding: '8px 20px', borderRadius: 8, border: 'none',
                background: saving ? '#d1d5db' : '#2563eb',
                color: 'white', cursor: saving ? 'wait' : 'pointer',
                fontWeight: 500, fontSize: 13,
              }}
            >
              {saving ? 'Saving...' : 'Save policy'}
            </button>
            {msg && <span style={{ fontSize: 13, color: '#16a34a' }}>{msg}</span>}
          </div>

          <div style={{ marginTop: 16, padding: 12, background: '#f9fafb', borderRadius: 8, fontSize: 12, color: '#6b7280' }}>
            <strong style={{ color: '#374151' }}>Current allowlist:</strong>{' '}
            {policy.owner.slice(0, 8)}... (owner)
            <br />
            Changes to caps take effect on the next authorize() call (~5s on testnet).
          </div>
        </div>
      )}
    </div>
  );
}
```

**Deliverable:** Both components render. Revoke button fires correctly and reflects new state within 2s (next poll). Policy panel saves and confirms. Dashboard is now fully functional end to end.

---

## PROMPT E2-13 — End-to-End Wiring + Environment Config

You are a TypeScript engineer doing the final integration pass on TrustLayer. Wire all four pieces together and confirm the full demo flow works.

**Step 1 — Create `dashboard/.env`:**
```
VITE_BACKEND_URL=http://localhost:3001
VITE_AGENT_URL=http://localhost:4003
```

**Step 2 — Confirm all `.env` values are set:**
```
# From Engineer 1 (required)
TRUST_POLICY_CONTRACT_ID=C...    ← must be filled
BACKEND_URL=http://localhost:3001
SERVICE_A_ADDRESS=G...           ← must be filled
SERVICE_B_ADDRESS=G...           ← must be filled

# Agent wallet (created in E2-02)
AGENT_PUBLIC_KEY=G...            ← must be filled
AGENT_SECRET_KEY=S...            ← must be filled

# LLM
ANTHROPIC_API_KEY=sk-ant-...     ← must be filled

# Ports
SERVICE_A_PORT=4001
SERVICE_B_PORT=4002
AGENT_PORT=4003
```

**Step 3 — Start everything in order:**

Terminal 1 — Engineer 1 backend:
```bash
cd trustlayer/backend && npm run dev
# Wait for: "TrustLayer backend running on port 3001"
```

Terminal 2 — Service A:
```bash
cd trustlayer-agent/services/service-a && npm run dev
# Wait for: "Service A (Weather) running on :4001"
```

Terminal 3 — Service B:
```bash
cd trustlayer-agent/services/service-b && npm run dev
# Wait for: "Service B (Research) running on :4002"
```

Terminal 4 — Agent:
```bash
cd trustlayer-agent/agent && npm run dev
# Wait for: "Agent runtime server on :4003"
```

Terminal 5 — Dashboard:
```bash
cd trustlayer-agent/dashboard && npm run dev
# Open http://localhost:5173
```

**Step 4 — Run the full demo scenario:**

1. Open dashboard at `http://localhost:5173`
2. Confirm policy shows: revoked=false, all budgets at 0 spent
3. Click "Run Agent" with task: "Research Stellar DeFi and get weather for Lagos"
4. Watch live activity feed populate with trust_check, trust_approved, payment_confirmed events
5. Watch budget bars fill in real time
6. While agent is running (or after), click "Revoke agent"
7. Confirm agent's next payment attempt is blocked — dashboard shows trust_blocked event
8. Click "Resume agent" — confirm it goes green
9. Confirm all payment tx hashes link correctly to stellar.expert testnet explorer

**Step 5 — Confirm Stellar testnet transactions:**
```bash
# Get a tx hash from the dashboard, then verify it onchain:
curl "https://horizon-testnet.stellar.org/transactions/YOUR_TX_HASH" | python3 -m json.tool | grep -E '"successful"|"hash"'
```

**Deliverable:** Full demo scenario runs successfully. Every payment in the dashboard has a working Stellar testnet tx link. Revoke fires and blocks in under 10 seconds (one ledger close + one agent cycle). Collect 5 tx hashes for the README.

---

## PROMPT E2-14 — Demo Video Script + README Content

You are a technical writer and Engineer 2. Write the demo video script and your section of the README.

**Demo Video Script (2 min 30 sec):**

```
[0:00–0:20] — The problem
"AI agents can reason, plan, and act. But when they need to spend money, 
there's no primitive for scoped, auditable, revocable financial authority.
An agent with a wallet is an agent with unlimited power. 
TrustLayer fixes that."

[0:20–0:45] — Architecture in one sentence
"TrustLayer is a Soroban smart contract on Stellar that sits between 
an AI agent and every payment it makes. The agent cannot spend unless 
the contract says yes — and the contract logs every decision onchain."

[0:45–1:30] — Live demo
"Watch this. I give the agent a task: research Stellar and get weather for Lagos.
It needs to pay for each API call. Before every payment — it checks the TrustLayer policy.
Policy approves — you can see the spend counters update in real time.
Every payment is a real Stellar testnet transaction — here's the tx hash.
The owner — that's me — can see exactly what the agent is doing and how much it's spent."

[1:30–1:50] — The kill switch
"Now watch what happens when I click Revoke.
[CLICK REVOKE]
The agent's next payment — blocked. Not by the agent. By the contract.
Onchain. Instant. Auditable.
Resume — and it's back."

[2:00–2:30] — What this becomes
"Today this is a hackathon demo. But the primitive is real.
Every enterprise deploying AI agents faces this unsolved problem:
how do you give an agent economic authority without unlimited authority?
TrustLayer is the answer — programmable, auditable, chain-native agent authorization.
We built it on Stellar because the rails are finally here: 
x402, Soroban, fast settlement, near-zero cost.
This is the OAuth layer for AI money."
```

**Your README section (`## Agent & Dashboard`):**

```markdown
## Agent & Dashboard

### How the agent works

The agent runtime (`agent/src/index.ts`) uses Claude as its reasoning layer. Given a task, Claude decides which paid APIs to call. Before every payment, the agent:

1. Receives a HTTP 402 from the paid service
2. Parses the payment requirements from the `WWW-Authenticate` header  
3. Calls the TrustLayer backend `POST /authorize` with recipient address and amount
4. The backend calls `authorize()` on the Soroban contract — if `true`, payment proceeds
5. Sends a real Stellar payment to the service address
6. Retries the request with the `X-Payment-TxHash` header
7. Calls `POST /record-payment` to create the onchain audit trail

If the agent is revoked at any point, the next `authorize()` call returns `false` and the agent stops immediately.

### Paid services

| Service | Endpoint | Price | Address |
|---------|----------|-------|---------|
| Weather API | `GET /weather/:city` | 0.5 XLM | `$SERVICE_A_ADDRESS` |
| Research API | `GET /research/:topic` | 1.0 XLM | `$SERVICE_B_ADDRESS` |

### Dashboard

The React dashboard polls the agent event log every 2 seconds. The Revoke button calls `POST /revoke` on the backend signing server, which signs and submits a Soroban transaction calling `revoke()` on the TrustPolicy contract. Policy changes take effect within one Stellar ledger (~5 seconds).

### Running locally

```bash
cp .env.example .env
# Fill in values from Engineer 1 (CONTRACT_ID, SERVICE addresses)
# Generate agent wallet (run once):
npx tsx agent/src/stellar.ts generate

npm install
npm run dev  # starts all services, agent, and dashboard
```
```

**Deliverable:** Video script ready to record. README section written and pushed to repo. Collect the 5 real Stellar testnet tx hashes from the demo run and add them to the README under `## Testnet Transactions`.
```
