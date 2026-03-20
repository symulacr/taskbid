// TaskBid Dashboard — Main Application
// Connects to FastAPI backend via REST + WebSocket

const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:8000'
  : window.location.origin;

// WebSocket: falls back to polling on Vercel (serverless has no WS support)
const IS_VERCEL = !window.location.hostname.includes('localhost') && !window.location.hostname.includes('127.0.0.1');
const WS_URL = IS_VERCEL ? null : API_BASE.replace('http', 'ws') + '/ws';

// ============================================================
// State
// ============================================================

const state = {
  tasks: [],
  bids: [],
  molbots: [],
  payments: [],
  stats: { total_tasks: 0, active_tasks: 0, total_volume: 0, total_staked: 0, total_molbots: 0 },
  filter: 'all',
  ws: null,
  connected: false,
  walletAddress: null,
};

// ============================================================
// Formatting Helpers
// ============================================================

function formatUSDCx(microAmount) {
  return (microAmount / 1_000_000).toFixed(2);
}

function formatSBTC(sats) {
  return (sats / 100_000_000).toFixed(4);
}

function formatAddress(addr) {
  if (!addr) return '—';
  if (addr.length <= 12) return addr;
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

function timeAgo(blockHeight) {
  const diff = (state.stats.current_block || 100) - blockHeight;
  if (diff < 0) return 'future';
  if (diff === 0) return 'just now';
  if (diff < 10) return `${diff} blocks ago`;
  return `${diff} blocks ago`;
}

function statusName(code) {
  const map = { 0: 'open', 1: 'assigned', 2: 'submitted', 3: 'completed', 4: 'expired', 5: 'cancelled' };
  return map[code] || 'unknown';
}

function statusClass(code) {
  return 'status-' + statusName(code);
}

function now() {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

// ============================================================
// API Calls
// ============================================================

async function api(path, options = {}) {
  try {
    const resp = await fetch(API_BASE + path, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options,
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: resp.statusText }));
      throw new Error(err.detail || resp.statusText);
    }
    return resp.json();
  } catch (e) {
    console.error(`API ${path}:`, e);
    throw e;
  }
}

async function loadTasks() {
  try {
    state.tasks = await api('/api/tasks');
    renderTasks();
  } catch (e) { console.warn('Failed to load tasks:', e); }
}

async function loadBids() {
  try {
    state.bids = await api('/api/bids');
    renderBids();
  } catch (e) { console.warn('Failed to load bids:', e); }
}

async function loadMolbots() {
  try {
    state.molbots = await api('/api/molbots');
    renderMolbots();
  } catch (e) { console.warn('Failed to load molbots:', e); }
}

async function loadPayments() {
  try {
    state.payments = await api('/api/payments');
    renderPayments();
  } catch (e) { console.warn('Failed to load payments:', e); }
}

async function loadStats() {
  try {
    state.stats = await api('/api/stats');
    renderStats();
  } catch (e) { console.warn('Failed to load stats:', e); }
}

async function loadAll() {
  await Promise.all([loadTasks(), loadBids(), loadMolbots(), loadPayments(), loadStats()]);
}

// ============================================================
// Rendering
// ============================================================

function renderStats() {
  const s = state.stats;
  document.getElementById('stat-tasks').textContent = s.total_tasks || 0;
  document.getElementById('stat-active').textContent = s.active_tasks || 0;
  document.getElementById('stat-volume').textContent = formatUSDCx(s.total_volume || 0);
  document.getElementById('stat-staked').textContent = formatSBTC(s.total_staked || 0);
  document.getElementById('stat-molbots').textContent = s.total_molbots || 0;
}

function renderTasks() {
  const container = document.getElementById('task-list');
  let filtered = state.tasks;
  if (state.filter !== 'all') {
    const statusMap = { open: 0, assigned: 1, submitted: 2, completed: 3, expired: 4 };
    filtered = state.tasks.filter(t => t.status === statusMap[state.filter]);
  }

  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty-state">No tasks match this filter</div>';
    return;
  }

  container.innerHTML = filtered.map(t => `
    <div class="card" data-task-id="${t.id}">
      <div class="card-title">${escapeHtml(t.title)}</div>
      <div class="card-meta">
        <span>Skill: ${escapeHtml(t.skill_required)}</span>
        <span>By: ${formatAddress(t.poster)}</span>
        <span>Bids: ${t.bid_count}</span>
      </div>
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:6px;">${escapeHtml(t.description)}</div>
      <div class="card-footer">
        <div>
          <span class="amount-usdcx">$${formatUSDCx(t.reward_amount)} USDCx</span>
          <span style="margin:0 6px;color:var(--text-muted)">|</span>
          <span class="amount-sbtc">${formatSBTC(t.required_stake)} sBTC stake</span>
        </div>
        <span class="status ${statusClass(t.status)}">${statusName(t.status)}</span>
      </div>
    </div>
  `).join('');
}

function renderBids() {
  const container = document.getElementById('bid-list');
  const activeBids = state.bids.filter(b => b.status === 0);
  document.getElementById('bid-count').textContent = activeBids.length;

  if (state.bids.length === 0) {
    container.innerHTML = '<div class="empty-state">No bids yet</div>';
    return;
  }

  container.innerHTML = state.bids.map(b => {
    const task = state.tasks.find(t => t.id === b.task_id);
    const statusLabels = { 0: 'Pending', 1: 'Accepted', 2: 'Rejected' };
    const statusColors = { 0: 'var(--yellow)', 1: 'var(--green)', 2: 'var(--red)' };
    return `
    <div class="card">
      <div class="bid-card">
        <div class="bid-info">
          <div class="card-title">Bid on: ${task ? escapeHtml(task.title) : 'Task #' + b.task_id}</div>
          <div class="card-meta">
            <span>Bidder: ${formatAddress(b.bidder)}</span>
            <span>Price: <span class="amount-usdcx">$${formatUSDCx(b.bid_price)}</span></span>
            <span>Stake: <span class="amount-sbtc">${formatSBTC(b.stake_amount)}</span></span>
          </div>
        </div>
        <span style="color:${statusColors[b.status]};font-size:12px;font-weight:600;">${statusLabels[b.status]}</span>
      </div>
    </div>
  `}).join('');
}

function renderMolbots() {
  const container = document.getElementById('molbot-list');
  if (state.molbots.length === 0) {
    container.innerHTML = '<div class="empty-state">No molbots registered</div>';
    return;
  }

  container.innerHTML = state.molbots.map(m => {
    const repPct = (m.reputation_score / 1000 * 100).toFixed(0);
    const repClass = m.reputation_score >= 700 ? 'rep-high' : m.reputation_score >= 400 ? 'rep-mid' : 'rep-low';
    const avatarBg = m.skill_type === 'content-generation' ? 'var(--purple)' : 'var(--blue)';
    const emoji = m.skill_type === 'content-generation' ? '&#9998;' : '&#128269;';
    return `
    <div class="card">
      <div class="molbot-card">
        <div class="molbot-avatar" style="background:${avatarBg}">${emoji}</div>
        <div class="molbot-info">
          <div class="card-title">${formatAddress(m.address)}</div>
          <div class="molbot-stats">
            <span>Skill: ${escapeHtml(m.skill_type)}</span>
            <span>Completed: ${m.total_tasks_completed}</span>
            <span>Earned: <span class="amount-usdcx">$${formatUSDCx(m.total_earned)}</span></span>
            <span>Slashed: <span class="amount-sbtc">${formatSBTC(m.total_slashed)}</span></span>
          </div>
          <div class="rep-bar">
            <div class="rep-fill ${repClass}" style="width:${repPct}%"></div>
          </div>
          <div style="font-size:10px;color:var(--text-muted);margin-top:2px;">Rep: ${m.reputation_score}/1000</div>
        </div>
      </div>
    </div>
  `}).join('');
}

function renderPayments() {
  const container = document.getElementById('payment-list');
  document.getElementById('payment-count').textContent = state.payments.length;

  if (state.payments.length === 0) {
    container.innerHTML = '<div class="empty-state">No payments yet</div>';
    return;
  }

  container.innerHTML = state.payments.map(p => {
    const typeClass = `payment-${p.tx_type}`;
    const isUSDCx = p.token === 'USDCx';
    const amountClass = isUSDCx ? 'amount-usdcx' : 'amount-sbtc';
    const amountStr = isUSDCx ? `$${formatUSDCx(p.amount)}` : `${formatSBTC(p.amount)} sBTC`;
    return `
    <div class="card">
      <div class="payment-card">
        <div class="payment-info">
          <div style="font-size:12px;">
            ${formatAddress(p.from_address)} → ${formatAddress(p.to_address)}
          </div>
          <div class="card-meta">
            <span>Task #${p.task_id}</span>
            <span>${p.timestamp || ''}</span>
          </div>
        </div>
        <div style="text-align:right;">
          <span class="${amountClass}">${amountStr}</span>
          <div><span class="payment-type ${typeClass}">${p.tx_type}</span></div>
        </div>
      </div>
    </div>
  `}).join('');
}

// ============================================================
// WebSocket
// ============================================================

function connectWebSocket() {
  // On Vercel (serverless), WebSockets are not supported — use polling instead
  if (IS_VERCEL || !WS_URL) {
    startPolling();
    return;
  }

  if (state.ws && state.ws.readyState === WebSocket.OPEN) return;

  state.ws = new WebSocket(WS_URL);

  state.ws.onopen = () => {
    state.connected = true;
    addEventLog('system', 'Connected to TaskBid backend');
  };

  state.ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleWSEvent(data);
    } catch (e) {
      console.warn('WS parse error:', e);
    }
  };

  state.ws.onclose = () => {
    state.connected = false;
    addEventLog('system', 'Disconnected. Reconnecting...');
    setTimeout(connectWebSocket, 3000);
  };

  state.ws.onerror = () => {
    state.ws.close();
  };
}

function startPolling() {
  state.connected = true;
  addEventLog('system', 'Connected to TaskBid backend (polling mode)');
  // Poll for updates every 4 seconds
  setInterval(() => loadAll(), 4000);
}

function handleWSEvent(data) {
  const { event_type, payload } = data;

  addEventLog(event_type, formatEventMessage(event_type, payload));

  // Reload relevant data
  switch (event_type) {
    case 'task_created':
      loadTasks();
      loadPayments();
      loadStats();
      break;
    case 'bid_placed':
      loadBids();
      loadTasks();
      loadStats();
      break;
    case 'bid_accepted':
      loadBids();
      loadTasks();
      break;
    case 'work_submitted':
      loadTasks();
      break;
    case 'delivery_confirmed':
      loadTasks();
      loadBids();
      loadPayments();
      loadMolbots();
      loadStats();
      break;
    case 'stake_slashed':
      loadTasks();
      loadPayments();
      loadMolbots();
      loadStats();
      break;
    case 'molbot_registered':
      loadMolbots();
      loadStats();
      break;
    default:
      loadAll();
  }
}

function formatEventMessage(type, payload) {
  switch (type) {
    case 'task_created':
      return `Task #${payload.task_id} posted: "${escapeHtml(payload.title)}" — $${formatUSDCx(payload.reward_amount)} USDCx reward`;
    case 'bid_placed':
      return `Bid on Task #${payload.task_id} by ${formatAddress(payload.bidder)} — ${formatSBTC(payload.stake_amount)} sBTC staked`;
    case 'bid_accepted':
      return `Bid #${payload.bid_id} accepted for Task #${payload.task_id} — ${formatAddress(payload.assigned_to)} assigned`;
    case 'work_submitted':
      return `Work submitted for Task #${payload.task_id} by ${formatAddress(payload.worker)}`;
    case 'delivery_confirmed':
      return `Task #${payload.task_id} completed! $${formatUSDCx(payload.reward)} USDCx paid, ${formatSBTC(payload.stake_released)} sBTC released`;
    case 'stake_slashed':
      return `Task #${payload.task_id} expired! ${formatSBTC(payload.slashed_amount)} sBTC slashed from ${formatAddress(payload.worker)}`;
    case 'molbot_registered':
      return `Molbot ${formatAddress(payload.address)} registered — skill: ${escapeHtml(payload.skill_type)}`;
    default:
      return escapeHtml(JSON.stringify(payload));
  }
}

// ============================================================
// Event Log
// ============================================================

function addEventLog(type, message) {
  const body = document.getElementById('event-log-body');
  const entry = document.createElement('div');
  entry.className = 'event-entry';
  entry.innerHTML = `
    <span class="event-time">${now()}</span>
    <span class="event-type event-type-${type}">[${type}]</span>
    ${message}
  `;
  body.insertBefore(entry, body.firstChild);

  // Keep max 50 entries
  while (body.children.length > 50) {
    body.removeChild(body.lastChild);
  }
}

// ============================================================
// Event Handlers
// ============================================================

function setupEventHandlers() {
  // Post Task modal
  document.getElementById('btn-post-task').addEventListener('click', () => {
    document.getElementById('modal-post-task').style.display = 'flex';
  });

  document.getElementById('modal-close').addEventListener('click', () => {
    document.getElementById('modal-post-task').style.display = 'none';
  });

  document.getElementById('modal-post-task').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
      document.getElementById('modal-post-task').style.display = 'none';
    }
  });

  // Form submit
  document.getElementById('form-post-task').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('task-title').value;
    const description = document.getElementById('task-description').value;
    const skill = document.getElementById('task-skill').value;
    const reward = Math.round(parseFloat(document.getElementById('task-reward').value) * 1_000_000);
    const stake = Math.round(parseFloat(document.getElementById('task-stake').value) * 100_000_000);
    const deadline = parseInt(document.getElementById('task-deadline').value);

    try {
      await api('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title, description,
          skill_required: skill,
          reward_amount: reward,
          required_stake: stake,
          deadline_blocks: deadline,
          poster: state.walletAddress || 'ST2JHG361ZXG51QTKY2NQCVBPPRRE2KZB1HR05NNC',
        }),
      });
      document.getElementById('modal-post-task').style.display = 'none';
      document.getElementById('form-post-task').reset();
    } catch (e) {
      alert('Failed to post task: ' + e.message);
    }
  });

  // Filter buttons
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.filter = btn.dataset.filter;
      renderTasks();
    });
  });

  // Event log toggle
  const logBody = document.getElementById('event-log-body');
  document.getElementById('btn-toggle-log').addEventListener('click', () => {
    logBody.style.display = logBody.style.display === 'none' ? 'block' : 'none';
  });

  // Connect wallet (mock)
  document.getElementById('btn-connect-wallet').addEventListener('click', () => {
    state.walletAddress = 'ST2JHG361ZXG51QTKY2NQCVBPPRRE2KZB1HR05NNC';
    document.getElementById('btn-connect-wallet').textContent = formatAddress(state.walletAddress);
    document.getElementById('btn-connect-wallet').classList.remove('btn-primary');
    document.getElementById('btn-connect-wallet').style.borderColor = 'var(--green)';
    addEventLog('system', `Wallet connected: ${formatAddress(state.walletAddress)}`);
  });
}

// ============================================================
// Utils
// ============================================================

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ============================================================
// Init
// ============================================================

async function init() {
  setupEventHandlers();
  addEventLog('system', 'TaskBid Dashboard initializing...');

  // Load data
  try {
    await loadAll();
    addEventLog('system', 'Data loaded successfully');
  } catch (e) {
    addEventLog('system', 'Backend not available — running in offline mode');
  }

  // Connect WebSocket
  connectWebSocket();

  // Auto-refresh every 15s as fallback
  setInterval(loadAll, 15000);
}

// Start when DOM ready
document.addEventListener('DOMContentLoaded', init);
