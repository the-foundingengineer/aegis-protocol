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
    service?: string;
    recipient?: string;
    amountStroops?: number;
    amountXlm?: string;
    txHash?: string;
    result?: 'approved' | 'blocked' | 'success' | 'failure';
    reason?: string;
    data?: any;
}

let eventIdCounter = 0;

export function logEvent(event: Omit<AgentEvent, 'id' | 'timestamp'>): AgentEvent {
    const fullEvent: AgentEvent = {
        id: `evt_${Date.now()}_${++eventIdCounter}`,
        timestamp: new Date().toISOString(),
        ...event,
    };

    const line = JSON.stringify(fullEvent) + '\n';
    fs.appendFileSync(LOG_PATH, line, 'utf8');

    const icon: Record<string, string> = {
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
    };

    console.log(`${icon[event.type] || '•'} [${fullEvent.timestamp.slice(11, 19)}] ${event.type}`,
        event.recipient ? `→ ${event.recipient.slice(0, 8)}...` : '',
        event.amountStroops ? `(${(event.amountStroops / 10_000_000).toFixed(1)} XLM)` : '',
        event.result ? `[${event.result}]` : '',
        event.reason ? `— ${event.reason}` : ''
    );

    return fullEvent;
}

export function getRecentEvents(limit = 50): AgentEvent[] {
    try {
        if (!fs.existsSync(LOG_PATH)) return [];
        const content = fs.readFileSync(LOG_PATH, 'utf8');
        const lines = content.trim().split('\n').filter(Boolean);
        const events = lines.map(line => JSON.parse(line) as AgentEvent);
        return events.slice(-limit).reverse();
    } catch {
        return [];
    }
}

export function clearLog(): void {
    if (fs.existsSync(LOG_PATH)) {
        fs.writeFileSync(LOG_PATH, '', 'utf8');
    }
    eventIdCounter = 0;
    console.log('[Logger] Event log cleared');
}
