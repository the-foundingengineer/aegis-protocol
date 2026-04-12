import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { paymentMiddlewareFromConfig } from '@x402/express';
import { ExactStellarScheme } from '@x402/stellar/exact/server';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3002;
const SERVICE_ADDRESS = process.env.SERVICE_ADDRESS || 'GAZGOWU725MSRJS237W6L4CO7DDBR3D3YQ6E3J45V6YV6NQN4XN5R5N5';

// For P2P Exact Stellar, we just instantiate the middleware with a RouteConfig
const paymentMiddleware = paymentMiddlewareFromConfig({
    "/market-data": {
        accepts: {
            scheme: "exact",
            payTo: SERVICE_ADDRESS,
            price: { amount: "10000", asset: "native" },
            network: "stellar:testnet"
        }
    }
}, [], [{ network: "stellar:testnet", server: new ExactStellarScheme() }], undefined, undefined, false);

app.use(paymentMiddleware);

app.get('/market-data', (req, res) => {
    res.json({
        symbol: 'XLM/USDC',
        price: '0.1254',
        volume_24h: '4.2M',
        timestamp: Date.now(),
        source: 'AgentGuard Mock Service A'
    });
});

app.listen(PORT, () => {
    console.log(`Mock Market Data Service (x402) listening on port ${PORT}`);
});
