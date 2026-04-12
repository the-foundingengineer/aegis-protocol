import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { paymentMiddlewareFromConfig } from '@x402/express';
import { ExactStellarScheme } from '@x402/stellar/exact/server';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3003;
const SERVICE_ADDRESS = process.env.SERVICE_ADDRESS || 'GAZGOWU725MSRJS237W6L4CO7DDBR3D3YQ6E3J45V6YV6NQN4XN5R5N5';

const paymentMiddleware = paymentMiddlewareFromConfig({
    "/risk-signal": {
        accepts: {
            scheme: "exact",
            payTo: SERVICE_ADDRESS,
            price: { amount: "10000", asset: "native" },
            network: "stellar:testnet"
        }
    }
}, [], [{ network: "stellar:testnet", server: new ExactStellarScheme() }], undefined, undefined, false);

app.use(paymentMiddleware);

app.get('/risk-signal', (req, res) => {
    res.json({
        signal: 'Bullish',
        confidence: 0.82,
        whale_activity: true,
        volatility: 'Low',
        timestamp: Date.now(),
        source: 'AgentGuard Mock Service B'
    });
});

app.listen(PORT, () => {
    console.log(`Mock Risk Signal Service (x402) listening on port ${PORT}`);
});
