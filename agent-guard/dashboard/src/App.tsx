import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

// Material Symbols helper (matches landing page icon set)
const MI = ({ icon, size = 16 }: { icon: string; size?: number }) => (
  <span
    className="material-symbols-outlined"
    style={{
      fontSize: size,
      fontVariationSettings: "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 24",
      lineHeight: 1,
      verticalAlign: 'middle',
      display: 'inline-block',
    }}
  >
    {icon}
  </span>
);

const BACKEND_URL = `http://${window.location.hostname}:3001`;
// Agent URL isn't used for the current demo script, but keeping it dynamic just in case
const AGENT_URL = `http://${window.location.hostname}:4003`;

// ── Types ────────────────────────────────────────────────────────────────────

interface Policy {
  owner: string;
  perTxCap: number;
  dailyCap: number;
  totalBudget: number;
  spentToday: number;
  spentTotal: number;
  revoked: boolean;
}

interface AgentEvent {
  id: string;
  timestamp: string;
  type: string;
  service?: string;
  recipient?: string;
  amountStroops?: number;
  amountXlm?: string;
  txHash?: string;
  result?: string;
  reason?: string;
  data?: any;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function stroopsToXlm(stroops: number): string {
  return (stroops / 10_000_000).toFixed(2);
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ── Event Badge Config ───────────────────────────────────────────────────────

const EVENT_CONFIG: Record<string, { label: string; badgeClass: string }> = {
  trust_approved: { label: 'Approved', badgeClass: 'approved' },
  trust_blocked: { label: 'Blocked', badgeClass: 'blocked' },
  payment_confirmed: { label: 'Paid', badgeClass: 'paid' },
  service_response: { label: 'Data', badgeClass: 'data' },
  task_complete: { label: 'Complete', badgeClass: 'complete' },
  error: { label: 'Error', badgeClass: 'error' },
  trust_check: { label: 'Checking', badgeClass: 'checking' },
  service_call_attempt: { label: 'Calling', badgeClass: 'default' },
  agent_start: { label: 'Started', badgeClass: 'complete' },
  task_received: { label: 'Task', badgeClass: 'default' },
};

// ── Components ───────────────────────────────────────────────────────────────

function TransactionFeed({ events }: { events: AgentEvent[] }) {
  if (events.length === 0) {
    return <div className="empty-state">No agent activity yet. Run the agent to see live events here.</div>;
  }

  return (
    <div style={{ marginTop: 16 }}>
      <div className="card-title">
        <MI icon="timeline" /> ACTIVITY
        <span style={{
          marginLeft: 8, fontSize: 11, fontWeight: 500,
          background: 'var(--bg-color)',
          border: '1px solid var(--card-border)',
          padding: '1px 8px', borderRadius: 20,
          color: 'var(--text-muted)',
        }}>
          {events.length} events
        </span>
      </div>
      <div className="event-feed">
        {events.map(event => {
          const config = EVENT_CONFIG[event.type] || { label: event.type, badgeClass: 'default' };
          return (
            <div key={event.id} className="event-item">
              <span className={`event-badge ${config.badgeClass}`}>{config.label}</span>
              {event.service && <span className="event-service">{event.service}</span>}
              {event.amountStroops && (
                <span className="event-amount">
                  {(event.amountStroops / 10_000_000).toFixed(1)} XLM
                </span>
              )}
              {event.recipient && (
                <span className="event-recipient">
                  {event.recipient.slice(0, 6)}...{event.recipient.slice(-4)}
                </span>
              )}
              {event.txHash && (
                <a
                  href={`https://stellar.expert/explorer/testnet/tx/${event.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="event-tx-link"
                  title="View on Stellar Expert"
                >
                  {event.txHash.slice(0, 8)}... <MI icon="open_in_new" size={11} />
                </a>
              )}
              {event.reason && <span className="event-reason">{event.reason}</span>}
              <span className="event-spacer" />
              <span className="event-time">{formatTime(event.timestamp)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BudgetBar({ label, spent, cap, color }: { label: string; spent: number; cap: number; color: 'blue' | 'purple' }) {
  const pct = cap > 0 ? Math.min(100, (spent / cap) * 100) : 0;
  const barClass = pct >= 100 ? 'danger' : pct >= 80 ? 'warning' : color;

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontSize: 13 }}>
        <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{label}</span>
        <span style={{ color: 'var(--text-secondary)' }}>
          {stroopsToXlm(spent)} / {stroopsToXlm(cap)} XLM
          <span style={{ marginLeft: 8, fontWeight: 600, color: pct >= 100 ? 'var(--danger)' : pct >= 80 ? 'var(--warning)' : 'var(--text-primary)' }}>
            ({pct.toFixed(0)}%)
          </span>
        </span>
      </div>
      <div className="progress-container">
        <div className={`progress-bar ${barClass}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function PolicyPanel({ policy, onUpdate }: { policy: Policy; onUpdate: () => void }) {
  const [open, setOpen] = useState(false);
  const [perTx, setPerTx] = useState(stroopsToXlm(policy.perTxCap));
  const [daily, setDaily] = useState(stroopsToXlm(policy.dailyCap));
  const [total, setTotal] = useState(stroopsToXlm(policy.totalBudget));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const handleSave = async () => {
    setSaving(true);
    try {
      await axios.post(`${BACKEND_URL}/update-caps`, {
        perTxCap: Math.round(parseFloat(perTx) * 10_000_000),
        dailyCap: Math.round(parseFloat(daily) * 10_000_000),
        totalBudget: Math.round(parseFloat(total) * 10_000_000),
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
    <>
      <button className="policy-toggle" onClick={() => setOpen(!open)}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <MI icon="tune" size={16} /> Policy Configuration
        </span>
        <MI icon={open ? 'keyboard_arrow_up' : 'keyboard_arrow_down'} size={18} />
      </button>
      {open && (
        <div className="policy-content">
          <div className="policy-grid">
            {[
              { label: 'Per-tx cap (XLM)', value: perTx, set: setPerTx },
              { label: 'Daily cap (XLM)', value: daily, set: setDaily },
              { label: 'Total budget (XLM)', value: total, set: setTotal },
            ].map(({ label, value, set }) => (
              <div key={label}>
                <label className="form-label">{label}</label>
                <input
                  type="number"
                  value={value}
                  onChange={e => set(e.target.value)}
                  step="0.5"
                  min="0"
                  className="form-input"
                />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save Policy'}
            </button>
            {msg && <span style={{ fontSize: 13, color: 'var(--success)' }}>{msg}</span>}
          </div>
          <div style={{ marginTop: 16, padding: 12, background: 'var(--bg-color)', borderRadius: 8, fontSize: 12, color: 'var(--text-muted)' }}>
            <strong style={{ color: 'var(--text-secondary)' }}>Owner:</strong> {policy.owner.slice(0, 12)}...
            <br />
            Changes take effect on the next authorize() call (~5s on testnet).
          </div>
        </div>
      )}
    </>
  );
}

// ── Main App ─────────────────────────────────────────────────────────────────

const App: React.FC = () => {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [agentEvents, setAgentEvents] = useState<AgentEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [task, setTask] = useState('Analyze the market and if the signal is bullish, execute a trade for 50 XLM');
  const [revokeLoading, setRevokeLoading] = useState(false);
  const [lastAction, setLastAction] = useState('');

  const refreshPolicy = useCallback(async () => {
    try {
      const res = await axios.get(`${BACKEND_URL}/policy`);
      setPolicy(res.data);
    } catch (e) {
      console.error('Failed to fetch policy:', e);
    }
  }, []);

  const refreshEvents = useCallback(async () => {
    try {
      // Fetch Soroban events directly from the backend now
      const res = await axios.get(`${BACKEND_URL}/events`);

      // Parse the events to match the UI's expected format
      const formattedEvents = (res.data.events || []).map((e: any) => {
        let recipient, amountXlm, reason;

        if (Array.isArray(e.value)) {
          recipient = typeof e.value[0] === 'string' ? e.value[0] : (e.value[0]?.address || e.value[0]);
          amountXlm = typeof e.value[1] === 'string' || typeof e.value[1] === 'number' || typeof e.value[1] === 'bigint' ? (Number(e.value[1]) / 10000000).toFixed(2) : undefined;
          reason = e.value[2]?.symbol || e.value[2];
        } else {
          recipient = e.value?.address;
          amountXlm = e.value?.i128 ? (Number(e.value.i128) / 10000000).toFixed(2) : undefined;
        }

        return {
          id: e.id,
          timestamp: e.ledgerClosedAt || new Date().toISOString(),
          type: e.type === 'intent' ? (e.subtype === 'approved' ? 'trust_approved' : 'trust_blocked') :
            (e.type === 'revoke' ? 'error' : 'task_complete'),
          recipient: recipient,
          amountXlm: amountXlm,
          reason: reason,
          txHash: e.txHash,
        };
      });
      setAgentEvents(formattedEvents);
    } catch {
      // Backend might be warming up
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      await Promise.all([refreshPolicy(), refreshEvents()]);
      setLoading(false);
    };
    init();

    const interval = setInterval(() => {
      refreshPolicy();
      refreshEvents();
    }, 2000);
    return () => clearInterval(interval);
  }, [refreshPolicy, refreshEvents]);

  const handleRevoke = async () => {
    setRevokeLoading(true);
    try {
      await axios.post(`${BACKEND_URL}/revoke`);
      setLastAction('Agent revoked at ' + new Date().toLocaleTimeString());
      await refreshPolicy();
    } catch (e: any) {
      setLastAction('Error: ' + e.message);
    } finally {
      setRevokeLoading(false);
    }
  };

  const handleResume = async () => {
    setRevokeLoading(true);
    try {
      await axios.post(`${BACKEND_URL}/resume`);
      setLastAction('Agent resumed at ' + new Date().toLocaleTimeString());
      await refreshPolicy();
    } catch (e: any) {
      setLastAction('Error: ' + e.message);
    } finally {
      setRevokeLoading(false);
    }
  };

  const handleRunAgent = async () => {
    try {
      setAgentEvents([]); // Clear ui instantly
      await axios.post(`${BACKEND_URL}/run-demo`);
      setTimeout(refreshEvents, 1000);
    } catch (e: any) {
      console.error('Failed to run agent:', e);
    }
  };

  if (loading || !policy) {
    return (
      <div className="loading-container">
        <div className="loading-logo">
          <MI icon="security" size={24} /> Aegis
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Connecting to TrustLayer...</div>
      </div>
    );
  }

  return (
    <div className="dashboard-container">
      {/* Header */}
      <header className="header">
        <div className="logo">
          Aegis
          <span className="logo-sub">Stellar Testnet</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => setAgentEvents([])}>
            <MI icon="delete_sweep" size={15} />&nbsp;Clear Log
          </button>
        </div>
      </header>

      {/* Status Banner */}
      <div className={`status-banner ${policy.revoked ? 'revoked' : 'active'}`}>
        <span className={`status-text ${policy.revoked ? 'revoked' : 'active'}`}>
          {policy.revoked ? 'Agent Revoked' : 'Agent Active'}
        </span>
        <span className="status-msg">
          {lastAction || (policy.revoked
            ? 'All payments are blocked until resumed'
            : 'Watching all payments through TrustLayer')}
        </span>
        {policy.revoked ? (
          <button className="btn btn-resume" onClick={handleResume} disabled={revokeLoading}>
            <MI icon="lock_open" size={15} />&nbsp;
            {revokeLoading ? 'Resuming...' : 'Resume Agent'}
          </button>
        ) : (
          <button className="btn btn-revoke" onClick={handleRevoke} disabled={revokeLoading}>
            <MI icon="emergency_home" size={15} />&nbsp;
            {revokeLoading ? 'Revoking...' : 'Revoke Agent'}
          </button>
        )}
      </div>

      {/* Agent Task Input */}
      <div className="agent-input-row">
        <input
          value={task}
          onChange={e => setTask(e.target.value)}
          className="agent-input"
          placeholder="Give the agent a task..."
        />
        <button className="btn btn-primary" onClick={handleRunAgent} disabled={policy.revoked}>
          <MI icon="play_arrow" size={16} />&nbsp;Run Agent
        </button>
      </div>

      {/* Budget Cards */}
      <div className="grid" style={{ marginBottom: '1.5rem' }}>
        <div className="card" style={{ gridColumn: 'span 4' }}>
          <div className="card-title"><MI icon="bolt" /> Daily Spending</div>
          <div className="card-value">
            {stroopsToXlm(policy.spentToday)} <span className="unit">XLM</span>
          </div>
          <BudgetBar label="Today" spent={policy.spentToday} cap={policy.dailyCap} color="blue" />
          <div className="card-subtitle">
            Remaining: {stroopsToXlm(policy.dailyCap - policy.spentToday)} XLM
          </div>
        </div>

        <div className="card" style={{ gridColumn: 'span 4' }}>
          <div className="card-title"><MI icon="trending_up" /> Lifetime Budget</div>
          <div className="card-value">
            {stroopsToXlm(policy.spentTotal)} <span className="unit">XLM</span>
          </div>
          <BudgetBar label="Total" spent={policy.spentTotal} cap={policy.totalBudget} color="purple" />
          <div className="card-subtitle">
            Remaining: {stroopsToXlm(policy.totalBudget - policy.spentTotal)} XLM
          </div>
        </div>

        <div className="card" style={{ gridColumn: 'span 4' }}>
          <div className="card-title"><MI icon="lock" /> Per-Transaction Limit</div>
          <div className="card-value">
            {stroopsToXlm(policy.perTxCap)} <span className="unit">XLM</span>
          </div>
          <div className="card-subtitle" style={{ marginTop: '1.5rem' }}>
            Max single payment
          </div>
          <div className="card-subtitle">
            Contract: {policy.owner ? `${policy.owner.slice(0, 8)}...` : 'N/A'}
          </div>
        </div>
      </div>

      {/* Policy Panel */}
      <PolicyPanel policy={policy} onUpdate={refreshPolicy} />

      {/* Transaction Feed */}
      <TransactionFeed events={agentEvents} />

      {/* Footer */}
      <footer className="footer">
        Aegis &bull; Built on Stellar &amp; Soroban &bull; x402 Protocol
      </footer>
    </div>
  );
};

export default App;
