import { Anthropic } from '@anthropic-ai/sdk';
import axios from 'axios';
import dotenv from 'dotenv';
import http from 'http';
import { Keypair } from '@stellar/stellar-sdk';
import { x402Client, x402HTTPClient } from '@x402/core/client';
import { createEd25519Signer, ExactStellarScheme } from '@x402/stellar';
import { logEvent, getRecentEvents, clearLog } from './logger.js';

dotenv.config();

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const agentKeypair = Keypair.fromSecret(process.env.AGENT_SECRET!);
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';
const SERVICE_A_URL = 'http://localhost:3002/market-data';
const SERVICE_B_URL = 'http://localhost:3003/risk-signal';

// ── 10x Moat: Risk Scorer ───────────────────────────────────────────────────

interface Intent {
    action: string;
    amount: string;
    reason: string;
    confidence: number;
}

function scoreRisk(intent: Intent): { score: number; reason: string } {
    let score = 0;
    let reason = 'Low risk';

    const injectionPatterns = [/ignore/i, /override/i, /drain/i, /all funds/i, /transfer everything/i];
    if (injectionPatterns.some(p => p.test(intent.reason))) {
        return { score: 1.0, reason: 'High Risk: Potential Prompt Injection Detected' };
    }

    if (intent.confidence < 0.6) {
        score += 0.4;
        reason = 'Medium Risk: Low confidence decision';
    }

    if (BigInt(intent.amount) > 1000000000n) {
        score += 0.3;
        reason = 'Medium Risk: Large transaction amount';
    }

    return { score: Math.min(score, 1.0), reason };
}

// ── x402 Client Setup ──────────────────────────────────────────────────────

const signer = createEd25519Signer(agentKeypair.secret());
const client = new x402Client().register('stellar:testnet', new ExactStellarScheme(signer));
const x402 = new x402HTTPClient(client);

async function fetchWithX402(url: string, serviceName: string, intentParams: Partial<Intent>) {
    logEvent({ type: 'service_call_attempt', service: serviceName, data: { url } });

    let response = await axios.get(url, { validateStatus: () => true });

    if (response.status === 402) {
        console.log('💰 HTTP 402 Payment Required intercepted');

        const getHeader = (name: string) => response.headers[name] || response.headers[name.toLowerCase()];
        const paymentRequired = x402.getPaymentRequiredResponse(getHeader);

        const requirement = paymentRequired.accepts[0];
        const requiredAmount = requirement ? requirement.amount : '10000';
        const recipientAddress = requirement?.payTo || 'Unknown';

        const intent: Intent = {
            action: intentParams.action || 'api_call',
            amount: requiredAmount,
            reason: intentParams.reason || 'Fetching paid resource',
            confidence: intentParams.confidence || 1.0
        };

        // Off-chain risk scoring
        const risk = scoreRisk(intent);
        console.log(`🔍 Risk Scorer: ${risk.score.toFixed(2)} - ${risk.reason}`);

        if (risk.score > 0.7) {
            logEvent({
                type: 'trust_blocked',
                service: serviceName,
                recipient: recipientAddress,
                amountStroops: Number(requiredAmount),
                result: 'blocked',
                reason: `Risk Score: ${risk.reason}`
            });
            throw new Error(`Blocked by Risk Scorer: ${risk.reason}`);
        }

        // On-chain policy check via backend
        logEvent({
            type: 'trust_check',
            service: serviceName,
            recipient: recipientAddress,
            amountStroops: Number(requiredAmount),
            amountXlm: (Number(requiredAmount) / 10_000_000).toFixed(7),
        });

        console.log('⛓️ Checking On-chain Policy...');
        const authResponse = await axios.post(`${BACKEND_URL}/authorize`, {
            recipient: recipientAddress,
            amount: requiredAmount,
        }, { validateStatus: () => true });

        if (authResponse.status >= 400 || !authResponse.data.authorized) {
            logEvent({
                type: 'trust_blocked',
                service: serviceName,
                recipient: recipientAddress,
                amountStroops: Number(requiredAmount),
                result: 'blocked',
                reason: authResponse.data.reason || 'On-chain policy violation'
            });
            throw new Error('Blocked by On-chain Policy');
        }

        logEvent({
            type: 'trust_approved',
            service: serviceName,
            recipient: recipientAddress,
            amountStroops: Number(requiredAmount),
            result: 'approved',
            txHash: authResponse.data.txHash
        });
        console.log('✅ On-chain Authorization Granted');

        // Generate the x402 payment payload and retry
        const payload = await x402.createPaymentPayload(paymentRequired);
        const headers = x402.encodePaymentSignatureHeader(payload);

        console.log('💸 Sending payment with retry...');
        response = await axios.get(url, { headers, validateStatus: () => true });

        if (response.status === 200) {
            const paymentTxHash = authResponse.data.txHash || 'x402_payment';
            logEvent({
                type: 'payment_confirmed',
                service: serviceName,
                recipient: recipientAddress,
                amountStroops: Number(requiredAmount),
                amountXlm: (Number(requiredAmount) / 10_000_000).toFixed(7),
                txHash: paymentTxHash,
                result: 'success'
            });
            console.log('📄 Payment Finalized. Recording audit trail...');

            // Record payment on-chain (best effort — don't block on failure)
            try {
                await axios.post(`${BACKEND_URL}/record-payment`, {
                    recipient: recipientAddress,
                    amount: requiredAmount,
                    txHash: paymentTxHash.padEnd(64, '0').slice(0, 64) // ensure 32-byte hex
                });
            } catch (e: any) {
                console.warn(`⚠️ Failed to record payment: ${e.message}`);
            }
        } else {
            logEvent({
                type: 'error',
                service: serviceName,
                reason: `Payment retry failed with status ${response.status}`
            });
            throw new Error(`Payment failed with status: ${response.status}`);
        }
    }

    logEvent({
        type: 'service_response',
        service: serviceName,
        result: 'success',
        data: { keys: Object.keys(response.data || {}) }
    });

    return response.data;
}

// ── Agent Tools ─────────────────────────────────────────────────────────────

const tools: Anthropic.Tool[] = [
    {
        name: 'get_market_data',
        description: 'Fetch real-time market data for XLM/USDC. Requires payment via x402.',
        input_schema: { type: 'object' as const, properties: {} }
    },
    {
        name: 'get_risk_signal',
        description: 'Fetch proprietary risk signals for trading decisions. Requires payment via x402.',
        input_schema: { type: 'object' as const, properties: {} }
    },
    {
        name: 'execute_trade',
        description: 'Execute a trade on-chain. Governed by trust layer policy.',
        input_schema: {
            type: 'object' as const,
            properties: {
                amount: { type: 'string', description: 'Amount in stroops' },
                reason: { type: 'string', description: 'Justification for the trade' },
                confidence: { type: 'number', description: '0 to 1 scale' }
            },
            required: ['amount', 'reason', 'confidence']
        }
    },
    {
        name: 'finish',
        description: 'Complete the task and return the final answer.',
        input_schema: {
            type: 'object' as const,
            properties: {
                answer: { type: 'string', description: 'The complete answer to the user task' }
            },
            required: ['answer']
        }
    }
];

// ── Main Reasoning Loop ───────────────────────────────────────────────────

export async function runAgent(task: string): Promise<string> {
    logEvent({ type: 'task_received', data: { task } });

    // Check if agent is revoked before starting
    try {
        const policyRes = await axios.get(`${BACKEND_URL}/policy`, { timeout: 5000 });
        if (policyRes.data.revoked) {
            logEvent({ type: 'error', reason: 'Agent is revoked — cannot start' });
            return 'Agent is currently revoked by the owner. Cannot execute tasks.';
        }
    } catch {
        console.warn('⚠️ Could not check policy state — proceeding');
    }

    let messages: Anthropic.MessageParam[] = [{
        role: 'user',
        content: `You are a research/trading agent with access to paid data services.
Complete this task using the available tools: "${task}"

Important: Each tool call costs real money (XLM). Be efficient — only call tools you need.
Available tools:
- get_market_data: Fetch XLM/USDC market data (costs XLM via x402)
- get_risk_signal: Fetch risk signals (costs XLM via x402)
- execute_trade: Execute a trade (governed by on-chain trust policy)
- finish: Return your final answer

Start by planning which tools you need, then call them, then finish.`
    }];

    let iterations = 0;
    const MAX_ITERATIONS = 8;

    while (iterations < MAX_ITERATIONS) {
        iterations++;

        let response;
        try {
            response = await anthropic.messages.create({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 1024,
                tools,
                messages
            });
        } catch (e: any) {
            console.log(`⚠️ Anthropic API Error (${e.message}). Using mock reasoning mode.`);
            // Graceful mock fallback for demo without API key
            if (iterations === 1) {
                response = {
                    stop_reason: 'tool_use' as const,
                    content: [
                        { type: 'text' as const, text: 'I need to check the market data first.' },
                        { type: 'tool_use' as const, id: 'mock_1', name: 'get_market_data', input: {} }
                    ]
                };
            } else if (iterations === 2) {
                response = {
                    stop_reason: 'tool_use' as const,
                    content: [
                        { type: 'text' as const, text: 'Let me check risk signals to confirm.' },
                        { type: 'tool_use' as const, id: 'mock_2', name: 'get_risk_signal', input: {} }
                    ]
                };
            } else if (iterations === 3) {
                response = {
                    stop_reason: 'tool_use' as const,
                    content: [
                        { type: 'text' as const, text: 'Signals confirm. Executing trade.' },
                        { type: 'tool_use' as const, id: 'mock_3', name: 'execute_trade', input: { amount: '500000000', reason: 'Bullish signal confirmed.', confidence: 0.95 } }
                    ]
                };
            } else {
                response = {
                    stop_reason: 'end_turn' as const,
                    content: [{ type: 'text' as const, text: 'Task completed. Market was bullish, trade executed successfully.' }]
                };
            }
            await new Promise(r => setTimeout(r, 1000));
        }

        messages.push({ role: 'assistant', content: response.content });

        if (response.stop_reason !== 'tool_use') {
            const textBlock = response.content.find(b => b.type === 'text');
            const answer = textBlock?.type === 'text' ? textBlock.text : 'Task complete';
            logEvent({ type: 'task_complete', data: { answer: answer.slice(0, 200) } });
            return answer;
        }

        for (const content of response.content) {
            if (content.type === 'tool_use') {
                const { name, input, id } = content;
                console.log(`\n🛠️ Agent wants to use tool: ${name}`);

                if (name === 'finish') {
                    const answer = (input as { answer: string }).answer;
                    logEvent({ type: 'task_complete', data: { answer: answer.slice(0, 200) } });
                    return answer;
                }

                let result;
                try {
                    if (name === 'get_market_data') {
                        const data = await fetchWithX402(SERVICE_A_URL, 'market-data', {
                            action: 'market_data', reason: 'Fetching data for analysis', confidence: 1.0
                        });
                        result = JSON.stringify(data);
                    } else if (name === 'get_risk_signal') {
                        const data = await fetchWithX402(SERVICE_B_URL, 'risk-signal', {
                            action: 'risk_signal', reason: 'Seeking confirmation signal', confidence: 0.9
                        });
                        result = JSON.stringify(data);
                    } else if (name === 'execute_trade') {
                        const intent = input as Intent;
                        const risk = scoreRisk(intent);
                        if (risk.score > 0.7) {
                            logEvent({ type: 'trust_blocked', reason: risk.reason, result: 'blocked' });
                            throw new Error(`Blocked by Risk Scorer: ${risk.reason}`);
                        }

                        const auth = await axios.post(`${BACKEND_URL}/authorize`, {
                            recipient: process.env.SERVICE_ADDRESS || 'G_DEX_ADDRESS...',
                            amount: intent.amount
                        });

                        if (!auth.data.authorized) {
                            logEvent({ type: 'trust_blocked', reason: 'On-chain policy violation', result: 'blocked' });
                            throw new Error('Blocked by On-chain Policy');
                        }

                        logEvent({
                            type: 'trust_approved',
                            amountStroops: Number(intent.amount),
                            result: 'approved',
                            txHash: auth.data.txHash
                        });
                        result = 'Trade executed successfully';
                    }

                    console.log('✅ Tool execution successful');
                    messages.push({
                        role: 'user',
                        content: [{ type: 'tool_result' as const, tool_use_id: id || 'mock_tool', content: String(result) }]
                    });
                } catch (err: any) {
                    console.error(`❌ Tool execution failed: ${err.message}`);
                    logEvent({ type: 'error', reason: err.message });

                    // If blocked by trust policy, stop the agent
                    if (err.message.includes('Policy') || err.message.includes('Risk Scorer')) {
                        return `Agent stopped: ${err.message}`;
                    }

                    messages.push({
                        role: 'user',
                        content: [{ type: 'tool_result' as const, tool_use_id: id || 'mock_tool', content: `Error: ${err.message}`, is_error: true }]
                    });
                }
            }
        }
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

    if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'ok', agent: agentKeypair.publicKey() }));
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

// ── CLI entry point ───────────────────────────────────────────────────────
if (process.argv[2] === 'run') {
    const task = process.argv.slice(3).join(' ') || 'Analyze the market and if the signal is bullish, execute a trade for 50 XLM';
    runAgent(task).then(console.log).catch(console.error);
}
