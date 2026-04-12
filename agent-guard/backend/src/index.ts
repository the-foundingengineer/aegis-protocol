import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import {
  Asset,
  Keypair,
  Networks,
  rpc,
  TransactionBuilder,
  xdr,
  StrKey,
  Address,
  nativeToScVal,
  scValToNative,
  Operation,
  Contract,
  BASE_FEE
} from '@stellar/stellar-sdk';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const RPC_URL = process.env.RPC_URL || 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = process.env.NETWORK_PASSPHRASE || Networks.TESTNET;

const server = new rpc.Server(RPC_URL);
const ownerKeypair = Keypair.fromSecret(process.env.OWNER_SECRET!);
const contractId = process.env.CONTRACT_ID!;
const contract = new Contract(contractId);

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
    if (rpc.Api.isSimulationError(simResult)) {
      return { success: false, error: (simResult as any).error || 'Simulation failed' };
    }

    const preparedTx = rpc.assembleTransaction(tx, simResult).build();
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

// ── Read-only contract query (simulate only, no submit) ──────────────────────

async function queryContract(
  method: string,
  args: xdr.ScVal[] = []
): Promise<{ success: boolean; result?: any; error?: string }> {
  try {
    const account = await server.getAccount(ownerKeypair.publicKey());

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(30)
      .build();

    const simResult = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(simResult)) {
      return { success: false, error: (simResult as any).error || 'Query failed' };
    }

    const result = scValToNative((simResult as rpc.Api.SimulateTransactionSuccessResponse).result!.retval);
    return { success: true, result };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

// ── Endpoints ───────────────────────────────────────────────────────────────

// GET /health
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', contractId, owner: ownerKeypair.publicKey() });
});

// GET /policy — returns current policy state
app.get('/policy', async (_req: Request, res: Response) => {
  const result = await queryContract('get_policy');
  if (!result.success) {
    return res.status(500).json({ error: result.error });
  }
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
app.get('/allowlist', async (_req: Request, res: Response) => {
  const result = await queryContract('get_allowlist');
  if (!result.success) return res.status(500).json({ error: result.error });
  res.json({ allowlist: result.result });
});

// POST /authorize — agent calls this before every payment (NO x402 paywall)
app.post('/authorize', async (req: Request, res: Response) => {
  const { recipient, amount } = req.body;

  if (!recipient || !amount || amount <= 0) {
    return res.status(400).json({ error: 'recipient and positive amount required' });
  }

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
    reason: authorized ? null : 'blocked_by_policy',
  });
});

// POST /record-payment — agent calls after Stellar payment is confirmed
app.post('/record-payment', async (req: Request, res: Response) => {
  const { recipient, amount, txHash: paymentTxHash } = req.body;

  if (!recipient || !amount || !paymentTxHash) {
    return res.status(400).json({ error: 'recipient, amount, and txHash required' });
  }

  // Convert hex tx hash to 32 bytes
  const hashBytes = Buffer.from(paymentTxHash, 'hex');
  if (hashBytes.length !== 32) {
    return res.status(400).json({ error: 'txHash must be 64-char hex (32 bytes)' });
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

// POST /revoke — kill switch
app.post('/revoke', async (_req: Request, res: Response) => {
  const result = await invokeContract('revoke');
  if (!result.success) return res.status(500).json({ error: result.error });
  res.json({ success: true, txHash: result.txHash });
});

// POST /resume — re-enable agent
app.post('/resume', async (_req: Request, res: Response) => {
  const result = await invokeContract('resume');
  if (!result.success) return res.status(500).json({ error: result.error });
  res.json({ success: true, txHash: result.txHash });
});

// POST /update-caps — update spending caps
app.post('/update-caps', async (req: Request, res: Response) => {
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
app.post('/add-allowlist', async (req: Request, res: Response) => {
  const { address } = req.body;
  if (!address) return res.status(400).json({ error: 'address required' });
  const args = [new Address(address).toScVal()];
  const result = await invokeContract('add_to_allowlist', args);
  if (!result.success) return res.status(500).json({ error: result.error });
  res.json({ success: true, txHash: result.txHash });
});

// POST /remove-allowlist
app.post('/remove-allowlist', async (req: Request, res: Response) => {
  const { address } = req.body;
  if (!address) return res.status(400).json({ error: 'address required' });
  const args = [new Address(address).toScVal()];
  const result = await invokeContract('remove_from_allowlist', args);
  if (!result.success) return res.status(500).json({ error: result.error });
  res.json({ success: true, txHash: result.txHash });
});

// GET /events — polls Soroban events for the contract
app.get('/events', async (_req: Request, res: Response) => {
  try {
    const latestLedger = await server.getLatestLedger();
    const startLedger = Math.max(1, latestLedger.sequence - 1000);

    const eventsResult = await server.getEvents({
      startLedger,
      filters: [
        {
          type: 'contract',
          contractIds: [contractId],
        },
      ],
      limit: 100,
    });

    const events = eventsResult.events.map((e: any) => ({
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
app.listen(PORT, () => {
  console.log(`TrustLayer backend running on port ${PORT}`);
  console.log(`Contract: ${contractId}`);
  console.log(`Owner: ${ownerKeypair.publicKey()}`);
});
