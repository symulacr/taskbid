// TaskBid Dashboard
// Suppress extension injection errors (Tally Ho / other EVM wallets redefining ethereum)
window.onerror = (msg, src) => {
  const m = String(msg), s = String(src);
  if (s.includes('chrome-extension') || s.includes('moz-extension')) return true;
  if (m.includes('redefine property') || m.includes('Cannot redefine') || m.includes('ethereum')) return true;
};

const API_BASE = '';

// ─── Terminal instrumentation ─────────────────────────────────────
const LOG_PREFIX = '%c[TaskBid]';
const LOG_STYLE  = 'color:#e8b84b;font-weight:bold';
const _t0 = performance.now();

function log(category, msg, data) {
  const ms   = Math.round(performance.now() - _t0);
  const ts   = new Date().toISOString().slice(11, 23);
  const icons = { init:'🚀', wallet:'👛', api:'📡', render:'🖥', action:'🎯',
                  error:'❌', warn:'⚠️', poll:'🔄', nav:'🧭', perf:'⏱',
                  click:'👆', scroll:'📜', form:'📝', pattern:'🔍', vis:'👁' };
  const icon = icons[category] ?? '·';
  const line = `${icon} [${ts}] +${ms}ms [${category}] ${msg}`;
  if (data !== undefined) {
    console.groupCollapsed(line);
    console.log(LOG_PREFIX, LOG_STYLE, data);
    console.groupEnd();
  } else {
    console.log(line);
  }
}

// ─── Balance fetcher ─────────────────────────────────────────────
const DEPLOYER_ADDR = 'ST1E79A6EWV7VB0Z777XTGD2KFXSB9VPHF53KPNFJ';
const EXPLORER      = 'https://explorer.hiro.so';

async function fetchBalance(addr, { silent = false } = {}) {
  if (!addr) return;

  // Show bar immediately (even before data arrives)
  const bar = document.getElementById('balance-bar');
  if (bar && bar.style.display === 'none') bar.style.display = 'flex';
  document.body.classList.add('has-balance');

  try {
    const r = await fetch(
      `https://api.testnet.hiro.so/extended/v1/address/${addr}/balances`,
      { cache: 'no-store' }
    );
    if (!r.ok) return;
    const d = await r.json();

    const ft      = d.fungible_tokens ?? {};
    const sbtcKey  = Object.keys(ft).find(k => k.includes(`.sbtc::sbtc`));
    const usdcxKey = Object.keys(ft).find(k => k.includes(`.usdcx::usdcx`));

    const sbtcRaw  = parseInt(sbtcKey  ? ft[sbtcKey].balance  : '0') || 0;
    const usdcxRaw = parseInt(usdcxKey ? ft[usdcxKey].balance : '0') || 0;

    // Skip DOM update if nothing changed
    if (sbtcRaw === state._lastBalSbtc && usdcxRaw === state._lastBalUsdcx) return;
    state._lastBalSbtc  = sbtcRaw;
    state._lastBalUsdcx = usdcxRaw;

    const sbtcAmt  = sbtcRaw  / 1e8;
    const usdcxAmt = usdcxRaw / 1e6;

    const canPost = usdcxAmt >= 1 && sbtcAmt >= 1;
    const canBid  = sbtcAmt >= 1;

    let capText, capClass;
    if (sbtcAmt === 0 && usdcxAmt === 0) {
      capText = 'No tokens — click ⛽ Faucet'; capClass = 'cap-warn';
    } else if (!canBid) {
      capText = `Need ≥1 sBTC to bid/post`; capClass = 'cap-low';
    } else if (canPost) {
      capText = 'Can post & bid'; capClass = 'cap-ok';
    } else {
      capText = 'Can bid · need USDCx to post'; capClass = 'cap-warn';
    }

    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('bal-sbtc',  sbtcAmt.toFixed(4));
    set('bal-usdcx', usdcxAmt.toFixed(2));
    const elCap = document.getElementById('bal-cap');
    if (elCap) { elCap.textContent = capText; elCap.className = `cap-item ${capClass}`; }

    if (!silent) log('wallet', `balance: ${sbtcAmt.toFixed(4)} sBTC · ${usdcxAmt.toFixed(2)} USDCx → ${capText}`);
  } catch (e) {
    if (!silent) log('warn', `fetchBalance: ${e.message}`);
  }
}

// ─── Status dots ─────────────────────────────────────────────────
function flashDot(id, state = 'ok') {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = 'sdot';            // reset
  void el.offsetWidth;              // force reflow so animation restarts
  el.classList.add(state, 'flash');
}

// ─── Behaviour tracer ─────────────────────────────────────────────
// Captures every click, scroll, focus, hover-before-click, rage-click,
// dead-click, scroll depth, and interaction sequences.
// All captured to the console; key signals also sent to /api/track.

const _ux = {
  clicks:        [],   // { ts, target, x, y, interactive, sinceLastClick }
  scrolls:       [],   // { ts, top, dir, velocity }
  interactions:  [],   // ordered sequence of all meaningful events (pattern trace)
  lastClickTs:   0,
  lastScrollTop: 0,
  lastScrollTs:  0,
  rageMap:       {},   // key → { count, ts }
  firstInteract: null,
  formTimes:     {},   // fieldId → focusTs
  hoverTarget:   null, // last hovered element before click
  maxScrollPct:  0,    // furthest scroll depth reached (0–100)
};

// Describe any DOM element concisely for logging
function describeEl(el) {
  if (!el) return 'null';
  const id  = el.id  ? `#${el.id}`  : '';
  const cls = el.className && typeof el.className === 'string'
    ? '.' + el.className.trim().split(/\s+/).slice(0,2).join('.') : '';
  const tag = el.tagName?.toLowerCase() ?? '?';
  const txt = el.textContent?.trim().slice(0, 28);
  return `<${tag}${id}${cls}> "${txt}"`;
}

function isInteractive(el) {
  if (!el) return false;
  const tag = el.tagName?.toLowerCase();
  if (['button','a','input','select','textarea'].includes(tag)) return true;
  if (el.onclick || el.getAttribute('data-filter') || el.getAttribute('data-view')
      || el.getAttribute('data-task-id') || el.closest('button,a')) return true;
  return false;
}

function pushInteraction(type, detail) {
  _ux.interactions.push({ t: Math.round(performance.now() - _t0), type, detail });
  // keep last 60 interactions for pattern dump
  if (_ux.interactions.length > 60) _ux.interactions.shift();
}

// ── Global click tracer ──────────────────────────────────────────
document.addEventListener('click', e => {
  const now   = performance.now();
  const el    = e.target;
  const inter = isInteractive(el) || isInteractive(el.closest?.('button,a,[data-filter],[data-view],[data-task-id]'));
  const since = _ux.lastClickTs ? Math.round(now - _ux.lastClickTs) : null;
  const entry = {
    ts: Math.round(now - _t0),
    target: describeEl(el),
    interactive: inter,
    x: Math.round(e.clientX), y: Math.round(e.clientY),
    sinceLastClick: since,
    hoverBefore: _ux.hoverTarget ? describeEl(_ux.hoverTarget) : null,
    view: state?.activeView ?? '?',
    wallet: !!state?.walletAddress,
  };
  _ux.clicks.push(entry);
  if (!_ux.firstInteract) { _ux.firstInteract = entry.ts; log('pattern', `first interaction at +${entry.ts}ms`); }

  // Dead click
  if (!inter) {
    log('click', `DEAD CLICK on ${describeEl(el)} @ (${entry.x},${entry.y})`, entry);
    enqueue('dead_click', 'click', entry);
  } else {
    log('click', `click on ${describeEl(el)} | since_last=${since ?? 'first'}ms | view=${entry.view}`, entry);
    enqueue('click', 'click', entry);
  }

  // Rage click: 3+ clicks on same element within 800 ms
  const key = entry.target;
  const rc  = _ux.rageMap[key] ?? { count: 0, ts: 0 };
  if (now - rc.ts < 800) { rc.count++; } else { rc.count = 1; }
  rc.ts = now;
  _ux.rageMap[key] = rc;
  if (rc.count === 3) {
    log('pattern', `🤬 RAGE CLICK (×${rc.count}) on ${describeEl(el)}`, entry);
    enqueue('rage_click', 'pattern', { target: entry.target, count: rc.count, view: entry.view });
  }

  _ux.lastClickTs = now;
  pushInteraction('click', entry.target);
}, true); // capture phase so we see it before handlers

// ── Global scroll tracer ─────────────────────────────────────────
let _scrollTimer = null;
document.addEventListener('scroll', () => {
  const top  = Math.round(window.scrollY);
  const now  = performance.now();
  const dir  = top > _ux.lastScrollTop ? '↓' : '↑';
  const dt   = now - (_ux.lastScrollTs || now);
  const vel  = dt > 0 ? Math.abs(top - _ux.lastScrollTop) / dt : 0; // px/ms

  // Scroll depth as % of total scrollable
  const scrollable = document.documentElement.scrollHeight - window.innerHeight;
  const pct = scrollable > 0 ? Math.round((top / scrollable) * 100) : 0;
  if (pct > _ux.maxScrollPct) {
    _ux.maxScrollPct = pct;
    if (pct >= 25 && pct < 26) { log('scroll', 'depth milestone: 25%'); enqueue('scroll_depth', 'scroll', { pct: 25 }); }
    if (pct >= 50 && pct < 51) { log('scroll', 'depth milestone: 50%'); enqueue('scroll_depth', 'scroll', { pct: 50 }); }
    if (pct >= 90 && pct < 91) { log('scroll', 'depth milestone: 90%'); enqueue('scroll_depth', 'scroll', { pct: 90 }); }
  }

  _ux.scrolls.push({ ts: Math.round(now - _t0), top, dir, vel: +vel.toFixed(3), pct });
  if (_ux.scrolls.length > 200) _ux.scrolls.shift();
  _ux.lastScrollTop = top;
  _ux.lastScrollTs  = now;

  // Debounced log (don't spam)
  clearTimeout(_scrollTimer);
  _scrollTimer = setTimeout(() => {
    const last5  = _ux.scrolls.slice(-5);
    const avgVel = (last5.reduce((s,x) => s + x.vel, 0) / last5.length).toFixed(3);
    log('scroll', `${dir} scrollY=${top}px depth=${pct}% avgVel=${avgVel}px/ms`);
    enqueue('scroll', 'scroll', { dir, top, pct, avgVel: +avgVel });
    pushInteraction('scroll', `${dir} to ${top}px (${pct}%)`);
  }, 150);
}, { passive: true });

// Main panel scroll (cards area can overflow)
document.addEventListener('scroll', e => {
  const t = e.target;
  if (t && t !== document && t.id && (t.scrollTop !== undefined)) {
    log('scroll', `element scroll: #${t.id} scrollTop=${t.scrollTop}`);
  }
}, { passive: true, capture: true });

// ── Form field timing ────────────────────────────────────────────
document.addEventListener('focusin', e => {
  const el = e.target;
  if (!['INPUT','TEXTAREA','SELECT'].includes(el.tagName)) return;
  const id = el.id || el.name || el.tagName;
  _ux.formTimes[id] = performance.now();
  log('form', `focus → ${id}`);
  pushInteraction('focus', id);
});

document.addEventListener('focusout', e => {
  const el  = e.target;
  if (!['INPUT','TEXTAREA','SELECT'].includes(el.tagName)) return;
  const id  = el.id || el.name || el.tagName;
  const dur = _ux.formTimes[id] ? Math.round(performance.now() - _ux.formTimes[id]) : null;
  const val = el.type === 'password' ? '[redacted]' : (el.value?.slice(0, 40) ?? '');
  log('form', `blur ← ${id}  filled=${val.length > 0}  time=${dur}ms  value="${val}"`);
  enqueue('form_blur', 'form', { field: id, filled: val.length > 0, duration_ms: dur });
  pushInteraction('blur', `${id} (${dur}ms)`);
  delete _ux.formTimes[id];
});

// ── Hover-before-click ───────────────────────────────────────────
document.addEventListener('mouseover', e => {
  if (isInteractive(e.target)) _ux.hoverTarget = e.target;
}, { passive: true });

// ── Visibility observer: which cards are actually seen ───────────
let _visObs = null;
function observeCards() {
  if (_visObs) _visObs.disconnect();
  _visObs = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const title = entry.target.querySelector('.card-title')?.textContent?.slice(0,30) ?? '';
        log('vis', `card in view: "${title}" | intersectionRatio=${entry.intersectionRatio.toFixed(2)}`);
        pushInteraction('visible', title);
      }
    });
  }, { threshold: 0.6 });
  document.querySelectorAll('.card').forEach(c => _visObs.observe(c));
}

// ── Pattern dump: print full interaction sequence on demand ──────
function dumpPattern() {
  console.group('🔍 [pattern] Interaction sequence dump');
  console.log(`Total: ${_ux.interactions.length} interactions | firstAt=+${_ux.firstInteract}ms | maxScrollDepth=${_ux.maxScrollPct}%`);
  console.table(_ux.interactions);
  console.groupEnd();
  console.group('👆 Click summary');
  const dead  = _ux.clicks.filter(c => !c.interactive).length;
  const total = _ux.clicks.length;
  console.log(`Total clicks: ${total}  Dead clicks: ${dead} (${Math.round(dead/total*100)||0}%)`);
  const gaps = _ux.clicks.filter(c => c.sinceLastClick !== null).map(c => c.sinceLastClick);
  if (gaps.length) console.log(`Avg ms between clicks: ${Math.round(gaps.reduce((a,b)=>a+b,0)/gaps.length)}`);
  console.groupEnd();
  console.group('📜 Scroll summary');
  console.log(`Total scroll events: ${_ux.scrolls.length} | maxDepth: ${_ux.maxScrollPct}%`);
  if (_ux.scrolls.length > 1) {
    const downCount = _ux.scrolls.filter(s => s.dir === '↓').length;
    console.log(`Direction: ↓${downCount} ↑${_ux.scrolls.length - downCount}`);
  }
  console.groupEnd();
}

// Expose globally so devs can call `taskbidDump()` in console
window.taskbidDump   = dumpPattern;
window.taskbidClicks = () => console.table(_ux.clicks);
window.taskbidPattern= () => console.table(_ux.interactions);

// ─── Session / Analytics ──────────────────────────────────────────
const SESSION_ID = crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
const _perf = {};
function perfStart(k)  { _perf[k] = performance.now(); }
function perfEnd(k)    { const ms = Math.round(performance.now() - (_perf[k] || performance.now())); delete _perf[k]; return ms; }

// ─── Batch event queue ────────────────────────────────────────────
// All events accumulate here; flushed every 3 s or on unload.
// A single POST /api/track with an array body inserts them in bulk.
const _queue = [];
let   _flushTimer = null;

function enqueue(event, category, data) {
  const entry = {
    event,
    category:   category ?? null,
    session_id: SESSION_ID,
    wallet:     state?.walletAddress ?? null,
    view:       state?.activeView    ?? null,
    data:       data ?? null,
    ts:         new Date().toISOString(),
  };
  _queue.push(entry);
  scheduleFlush();
}

function scheduleFlush() {
  if (_flushTimer) return;
  _flushTimer = setTimeout(flushQueue, 3000);
}

function flushQueue(sync = false) {
  clearTimeout(_flushTimer);
  _flushTimer = null;
  if (!_queue.length) return;
  const batch = _queue.splice(0, _queue.length);
  log('api', `flush ${batch.length} events to Supabase`);
  const body = JSON.stringify(batch);
  if (sync && navigator.sendBeacon) {
    navigator.sendBeacon('/api/track', new Blob([body], { type: 'application/json' }));
  } else {
    fetch('/api/track', { method:'POST', headers:{'Content-Type':'application/json'}, body }).catch(()=>{});
  }
}

// Convenience wrapper used throughout the app
function track(event, props = {}) {
  log('action', `track: ${event}`, Object.keys(props).length ? props : undefined);
  enqueue(event, 'action', props);
}

// ─── State ────────────────────────────────────────────────────────
const state = {
  tasks: [], bids: [], molbots: [], payments: [],
  stats: { total_tasks:0, active_tasks:0, total_volume:0, total_staked:0, total_molbots:0, current_block:0 },
  filter: 'all',
  walletAddress: null,
  activeView: 'tasks',
  // snapshot hashes to skip pointless re-renders
  _hash: { tasks:'', bids:'', molbots:'', payments:'', stats:'' },
  demoMode: false,
  resourceErrors: { tasks:false, bids:false, molbots:false, payments:false, stats:false },
};

// ─── Toast ────────────────────────────────────────────────────────
function toast(msg, type = 'info') {
  const c = document.getElementById('toast-container');
  if (!c) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  c.appendChild(el);
  requestAnimationFrame(() => { el.classList.add('toast-visible'); });
  setTimeout(() => {
    el.classList.remove('toast-visible');
    setTimeout(() => el.remove(), 300);
  }, 4000);
}

// ─── Wallet — single-click, no modal ─────────────────────────────
// Uses the bundled @stacks/connect (window.StacksConnect) which handles
// Leather and Xverse natively, including old Xverse authenticationRequest.
// Flow: click → library opens wallet popup → approve → address back.
// Zero modals, zero sub-tabs, zero friction.

function detectWallets() {
  const hasLeather = !!window.LeatherProvider;
  const hasXverse  = !!(window.XverseProviders?.StacksProvider || window.XverseProviders);
  log('wallet', `detectWallets — leather=${hasLeather} xverse=${hasXverse}`);
  return { hasLeather, hasXverse };
}

function trySilentReconnect() {
  // 1. Check @stacks/connect localStorage (persisted after previous connect)
  try {
    const sc = window.StacksConnect;
    if (sc?.isConnected?.()) {
      const data = sc.getLocalStorage?.();
      const addr = data?.addresses?.stx?.[0]?.address;
      if (addr) { finishWalletConnect(addr, 'stacks-connect', { silent: true }); return true; }
    }
  } catch {}
  // 2. Fallback: our own localStorage key
  try {
    const saved = localStorage.getItem('taskbid_wallet');
    if (saved && (saved.startsWith('ST') || saved.startsWith('SP'))) {
      finishWalletConnect(saved, 'saved', { silent: true });
      return true;
    }
  } catch {}
  return false;
}

// Called by the "Connect Wallet" header button — NO modal, direct connect
async function handleConnectClick() {
  if (state.walletAddress) { disconnectWallet(); return; }

  const sc = window.StacksConnect;
  if (!sc) {
    // Bundle not loaded yet — show fallback
    showWalletFallback('Wallet library loading, try again in a moment.');
    return;
  }

  const btn = document.getElementById('btn-connect-wallet');
  if (btn) { btn.disabled = true; btn.textContent = 'Connecting…'; }
  track('wallet_connect_attempt', { method: 'stacks-connect' });
  log('wallet', 'calling StacksConnect.connect()');

  try {
    await sc.connect();
    const data = sc.getLocalStorage?.();
    const addr = data?.addresses?.stx?.[0]?.address;
    if (!addr) throw new Error('No STX address returned');
    finishWalletConnect(addr, 'stacks-connect');
  } catch (e) {
    const msg = e?.message ?? String(e);
    log('error', `StacksConnect.connect failed: ${msg}`);
    track('wallet_connect_error', { error: msg });
    if (msg.toLowerCase().includes('cancel') || msg.toLowerCase().includes('reject')) {
      toast('Connect cancelled', 'info');
    } else {
      showWalletFallback(msg);
    }
  } finally {
    if (btn) { btn.disabled = false; if (!state.walletAddress) btn.textContent = 'Connect Wallet'; }
  }
}

function showWalletFallback(errorMsg) {
  const panel = document.getElementById('wallet-fallback');
  if (!panel) return;
  if (errorMsg) {
    const el = document.getElementById('wallet-error');
    if (el) { el.textContent = errorMsg; el.style.display = 'block'; }
  }
  panel.style.display = 'block';
  setTimeout(() => document.getElementById('manual-addr-input')?.focus(), 50);
}

function hideWalletFallback() {
  const panel = document.getElementById('wallet-fallback');
  if (panel) panel.style.display = 'none';
  const el = document.getElementById('wallet-error');
  if (el) el.style.display = 'none';
}

function disconnectWallet() {
  state.walletAddress = null;
  try { localStorage.removeItem('taskbid_wallet'); } catch {}
  try { window.StacksConnect?.disconnect?.(); } catch {}
  const btn = document.getElementById('btn-connect-wallet');
  if (btn) { btn.textContent = 'Connect Wallet'; btn.classList.remove('connected'); }
  const fw = document.getElementById('footer-wallet');
  if (fw) fw.textContent = '';
  const bar = document.getElementById('balance-bar');
  if (bar) bar.style.display = 'none';
  document.body.classList.remove('has-balance');
  log('wallet', 'disconnected');
  track('wallet_disconnect', {});
  toast('Wallet disconnected', 'info');
  renderTasks();
}

function finishWalletConnect(address, provider, opts = {}) {
  state.walletAddress = address;
  if (!opts.silent) {
    try { localStorage.setItem('taskbid_wallet', address); } catch {}
  }
  const btn = document.getElementById('btn-connect-wallet');
  if (btn) { btn.textContent = fAddr(address); btn.classList.add('connected'); }
  const fw = document.getElementById('footer-wallet');
  if (fw) fw.textContent = fAddr(address);
  hideWalletFallback();
  log('wallet', `connected: ${address} via ${provider}${opts.silent ? ' (silent)' : ''}`);
  if (!opts.silent) {
    track('wallet_connect_success', { provider });
    toast('Wallet connected', 'success');
  }
  renderTasks();
  fetchBalance(address); // show balances immediately
  if (state._pendingAction) {
    log('action', 'wallet connected — firing deferred action');
    setTimeout(state._pendingAction, 100);
    state._pendingAction = null;
  }
}

// ─── API ──────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  flashDot('dot-api', 'ok');
  try {
    const r = await fetch(API_BASE + path, {
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      ...opts,
    });

    if (!r.ok) {
      const raw = await r.text();
      let msg = raw || r.statusText || `HTTP ${r.status}`;
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          msg = parsed?.message || parsed?.error || msg;
        } catch {}
      }
      flashDot('dot-api', 'err');
      throw new Error(msg);
    }

    flashDot('dot-db', 'ok');
    return r.json();
  } catch (e) {
    flashDot('dot-api', 'err');
    throw e;
  }
}

function buildPaymentHeaders() {
  if (!state.demoMode) return {};
  return { 'X-PAYMENT-SIGNATURE': 'x402-demo-' + Date.now() };
}

function setResourceError(resource, hasError) {
  state.resourceErrors[resource] = !!hasError;
  updateFooterStatus();
}

// ─── On-chain contract calls via wallet ──────────────────────────
// DEPLOYER = address that holds all contracts on Stacks testnet
const DEPLOYER = DEPLOYER_ADDR;   // single source of truth
const NETWORK  = 'testnet';

// Helper: call openContractCall from the bundled @stacks/connect.
// Returns a Promise that resolves when the wallet broadcasts the tx.
function callContract({ contract, fn, args, onFinish, onCancel }) {
  const sc = window.StacksConnect;
  if (!sc?.openContractCall) throw new Error('Wallet library not loaded');

  const u  = sc.uintCV;
  const s  = sc.stringAsciiCV;
  const p  = sc.standardPrincipalCV;

  return new Promise((resolve, reject) => {
    sc.openContractCall({
      network:         NETWORK,
      contractAddress: DEPLOYER,
      contractName:    contract,
      functionName:    fn,
      functionArgs:    args({ u, s, p, sc }),
      postConditionMode: 1, // Allow
      onFinish: (data) => {
        log('chain', `tx broadcast: ${contract}.${fn} txid=${data?.txId}`);
        track('contract_call', { contract, fn, txId: data?.txId });
        resolve(data);
        if (onFinish) onFinish(data);
      },
      onCancel: () => {
        log('chain', `tx cancelled: ${contract}.${fn}`);
        reject(new Error('Transaction cancelled'));
        if (onCancel) onCancel();
      },
    });
  });
}

// After a contract call, poll for tx confirmation then sync DB
// Wait for a tx to confirm, then sync DB state. action = 'post_task' | 'bid' | etc.
async function waitAndSync(txId, label, action = '', dbTaskId = null) {
  toast(`${label} submitted — awaiting confirmation`, 'info');
  log('chain', `waiting for ${txId}…`);
  const explorerBase = 'https://explorer.hiro.so/txid/';
  let attempts = 0;
  const poll = async () => {
    try {
      const r = await fetch(`https://api.testnet.hiro.so/extended/v1/tx/${txId}`);
      const d = await r.json();
      if (d.tx_status === 'success') {
        log('chain', `${label} confirmed: ${txId}`);
        toast(`${label} confirmed ✓`, 'success');
        // Refresh balance after any confirmed tx
        if (state.walletAddress) {
          _lastBalanceFetch = 0; // force immediate refresh on next poll
          fetchBalance(state.walletAddress);
        }
        // Stamp on_chain_task_id on the DB record
        if (action === 'post_task' && dbTaskId) {
          try {
            await api('/api/chain-sync', {
              method: 'POST',
              body: JSON.stringify({ tx_id: txId, action: 'post_task', db_task_id: dbTaskId }),
            });
          } catch {}
        }
        loadAll();
        return;
      }
      if (d.tx_status === 'abort_by_response' || d.tx_status === 'abort_by_post_condition') {
        // Parse error code from tx result if available
        const repr = d.tx_result?.repr ?? d.tx_status;
        const errCode = repr.match(/u(\d+)/)?.[1];
        const errMsg = {
          '100': 'Not authorized', '101': 'Task not found (not posted on-chain)',
          '102': 'Bid not found', '103': 'Invalid status', '104': 'Already bid on this task',
          '105': 'Insufficient stake', '106': 'Task expired', '107': 'Not assigned',
          '108': 'Already registered', '109': 'Cannot bid on own task', '110': 'Invalid amount',
          '111': 'Task has bids — cannot cancel', '112': 'Not expired yet',
        }[errCode] ?? repr;
        toast(`${label} failed: ${errMsg}`, 'error');
        return;
      }
    } catch {}
    if (++attempts < 60) setTimeout(poll, 3000);
    else toast(`${label} unconfirmed — view: ${explorerBase}${txId}?chain=testnet`, 'warn');
  };
  setTimeout(poll, 3000);
}

function updateFooterStatus() {
  const fs = document.getElementById('footer-status');
  if (!fs) return;

  const failed = Object.entries(state.resourceErrors)
    .filter(([, hasError]) => hasError)
    .map(([resource]) => resource);

  const demoSuffix = state.demoMode ? ' demo' : '';
  if (failed.length > 0) {
    fs.textContent = `degraded: ${failed.join(', ')}${demoSuffix}`;
    fs.classList.add('status-degraded');
    // Mark DB dot red
    const dbDot = document.getElementById('dot-db');
    if (dbDot) { dbDot.className = 'sdot err'; }
    return;
  }

  fs.classList.remove('status-degraded');
  fs.textContent = `ok${demoSuffix}`;
  const dbDot = document.getElementById('dot-db');
  if (dbDot && !dbDot.classList.contains('ok')) dbDot.classList.add('ok');
}

async function refreshRuntimeMode() {
  try {
    const health = await api('/api/health');
    state.demoMode = health?.demo_mode === true;
  } catch (e) {
    state.demoMode = false;
    log('warn', `runtime mode probe failed: ${e.message}`);
  }
  updateFooterStatus();
}

// ─── Data loading (no-flicker diff) ──────────────────────────────
function hash(data) { return JSON.stringify(data); }
let _pollCount = 0;

async function loadTasks() {
  perfStart('tasks');
  try {
    const data = await api('/api/tasks');
    setResourceError('tasks', false);
    const ms = perfEnd('tasks');
    const h = hash(data);
    const changed = h !== state._hash.tasks;
    log('api', `GET /api/tasks → ${data.length} rows, ${ms}ms, changed=${changed}`);
    if (!changed) return;
    state._hash.tasks = h;
    state.tasks = data;
    renderTasks();
    log('render', `renderTasks(): filter=${state.filter}, visible=${document.querySelectorAll('#task-list .card').length}`);
  } catch (e) {
    log('error', `loadTasks failed: ${e.message}`);
    track('load_error', { resource:'tasks', error: String(e) });
    document.getElementById('task-list').innerHTML = '<div class="error-state">Could not load tasks</div>';
    setResourceError('tasks', true);
  }
}

async function loadBids() {
  perfStart('bids');
  try {
    const data = await api('/api/bids');
    setResourceError('bids', false);
    const ms = perfEnd('bids');
    const h = hash(data);
    const changed = h !== state._hash.bids;
    log('api', `GET /api/bids → ${data.length} rows, ${ms}ms, changed=${changed}`);
    if (!changed) return;
    state._hash.bids = h;
    state.bids = data;
    renderBids();
  } catch (e) {
    log('error', `loadBids failed: ${e.message}`);
    document.getElementById('bid-list').innerHTML = '<div class="error-state">Could not load bids</div>';
    setResourceError('bids', true);
  }
}

async function loadMolbots() {
  perfStart('molbots');
  try {
    const data = await api('/api/molbots');
    setResourceError('molbots', false);
    const ms = perfEnd('molbots');
    const h = hash(data);
    const changed = h !== state._hash.molbots;
    log('api', `GET /api/molbots → ${data.length} rows, ${ms}ms, changed=${changed}`);
    if (!changed) return;
    state._hash.molbots = h;
    state.molbots = data;
    renderMolbots();
  } catch (e) {
    log('error', `loadMolbots failed: ${e.message}`);
    document.getElementById('molbot-list').innerHTML = '<div class="error-state">Could not load molbots</div>';
    setResourceError('molbots', true);
  }
}

async function loadPayments() {
  perfStart('payments');
  try {
    const data = await api('/api/payments');
    setResourceError('payments', false);
    const ms = perfEnd('payments');
    const h = hash(data);
    const changed = h !== state._hash.payments;
    log('api', `GET /api/payments → ${data.length} rows, ${ms}ms, changed=${changed}`);
    if (!changed) return;
    state._hash.payments = h;
    state.payments = data;
    renderPayments();
  } catch (e) {
    log('error', `loadPayments failed: ${e.message}`);
    document.getElementById('payment-list').innerHTML = '<div class="error-state">Could not load payments</div>';
    setResourceError('payments', true);
  }
}

async function loadStats() {
  try {
    const data = await api('/api/stats');
    setResourceError('stats', false);
    const h = hash(data);
    if (h === state._hash.stats) return;
    state._hash.stats = h;
    state.stats = data;
    renderStats();
    log('api', `GET /api/stats → block=${data.current_block}, tasks=${data.total_tasks}, active=${data.active_tasks}`);
  } catch (e) {
    setResourceError('stats', true);
    log('error', `loadStats failed: ${e.message}`);
  }
}

// ─── Live block height from Stacks API ───────────────────────────
// Polls api.testnet.hiro.so/v2/info every 10 s independently of the
// main poll loop — Stacks blocks are ~10 min so 10 s is fine.
let _lastKnownBlock = 0;
async function fetchLiveBlockHeight() {
  flashDot('dot-net', 'ok');
  try {
    const r = await fetch('https://api.testnet.hiro.so/v2/info', { cache: 'no-store' });
    if (!r.ok) { flashDot('dot-net', 'err'); return; }
    const d = await r.json();
    const h = d.stacks_tip_height ?? d.burn_block_height;
    if (!h || h === _lastKnownBlock) return;
    _lastKnownBlock = h;
    state.stats.current_block = h;
    document.querySelectorAll('#stat-block').forEach(el => { el.textContent = h; });
    updateFooterStatus();
    log('api', `live block height: ${h}`);
  } catch (e) {
    flashDot('dot-net', 'err');
    log('warn', `fetchLiveBlockHeight failed: ${e.message}`);
  }
}

function startBlockHeightPoller() {
  fetchLiveBlockHeight(); // immediate first fetch
  setInterval(fetchLiveBlockHeight, 10_000);
}

let _lastBalanceFetch  = 0;
let _lastActivityFetch = 0;

async function loadAll() {
  _pollCount++;
  log('poll', `─── poll #${_pollCount} ───────────────────────────────`);
  const t = performance.now();
  const tasks = [loadTasks(), loadBids(), loadMolbots(), loadPayments(), loadStats()];
  const now = Date.now();
  // Balance every 10s when wallet connected
  if (state.walletAddress && now - _lastBalanceFetch > 10_000) {
    _lastBalanceFetch = now;
    tasks.push(fetchBalance(state.walletAddress, { silent: true }));
  }
  // Activity every 15s (or on demand when view is active)
  if (now - _lastActivityFetch > 15_000 || state.activeView === 'activity') {
    _lastActivityFetch = now;
    tasks.push(loadActivity());
  }
  await Promise.all(tasks);
  log('perf', `poll #${_pollCount} complete in ${Math.round(performance.now()-t)}ms`);
}

// ─── Formatting ───────────────────────────────────────────────────
const fUSDCx   = n => '$' + (n / 1_000_000).toFixed(2);
const fSBTC    = n => (n / 100_000_000).toFixed(4);
const fAddr    = a => !a ? '—' : a.length <= 12 ? a : a.slice(0,6) + '…' + a.slice(-4);
const fStatus  = c => ({0:'open',1:'assigned',2:'submitted',3:'completed',4:'expired',5:'cancelled'}[c] ?? 'unknown');
const esc      = s => { const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; };

// ─── Render — Tasks ───────────────────────────────────────────────
function taskActions(t) {
  const w = state.walletAddress;
  const blk = state.stats.current_block || 0;
  const expired = blk > t.deadline;
  const parts = [];
  if (t.status === 0 && w && w !== t.poster)
    parts.push(`<button class="btn-action btn-bid" data-task-id="${t.id}" data-stake="${t.required_stake}" data-on-chain="${t.on_chain_task_id ?? ''}">Bid</button>`);
  if (t.status === 0 && w === t.poster) {
    state.bids.filter(b => b.task_id === t.id && b.status === 0).forEach(b =>
      parts.push(`<button class="btn-action btn-accept-bid" data-task-id="${t.id}" data-bid-id="${b.id}">Accept ${fAddr(b.bidder)}</button>`)
    );
  }
  if (t.status === 1 && w && w === t.assigned_to)
    parts.push(`<button class="btn-action btn-submit-work" data-task-id="${t.id}">Submit Work</button>`);
  if (t.status === 2 && w === t.poster)
    parts.push(`<button class="btn-action btn-confirm" data-task-id="${t.id}">Confirm Delivery</button>`);
  if ((t.status === 1 || t.status === 2) && expired)
    parts.push(`<button class="btn-action btn-slash" data-task-id="${t.id}">Slash</button>`);
  return parts.length ? `<div class="task-actions">${parts.join('')}</div>` : '';
}

function renderTasks() {
  const el = document.getElementById('task-list');
  const statusMap = { open:0, assigned:1, submitted:2, completed:3, expired:4 };
  const list = state.filter === 'all' ? state.tasks : state.tasks.filter(t => t.status === statusMap[state.filter]);
  if (!list.length) { el.innerHTML = '<div class="empty-state">No tasks match this filter</div>'; return; }
  el.innerHTML = list.map(t => `
    <div class="card">
      <div class="card-title">${esc(t.title)} ${t.on_chain_task_id ? `<span class="chain-badge">⛓ #${t.on_chain_task_id}</span>` : '<span class="chain-badge chain-badge-off">DB only</span>'}</div>
      <div class="card-meta">
        <span>${esc(t.skill_required)}</span>
        <span>by ${fAddr(t.poster)}</span>
        <span>${t.bid_count} bid${t.bid_count!==1?'s':''}</span>
        <span>deadline block ${t.deadline}</span>
      </div>
      <div class="card-desc">${esc(t.description)}</div>
      <div class="card-footer">
        <div class="amounts">
          <span>${fUSDCx(t.reward_amount)} USDCx</span>
          <span>${fSBTC(t.required_stake)} sBTC stake</span>
        </div>
        <span class="status status-${fStatus(t.status)}">${fStatus(t.status)}</span>
      </div>
      ${taskActions(t)}
    </div>`).join('');
  requestAnimationFrame(observeCards);
}

// ─── Render — Bids ────────────────────────────────────────────────
function renderBids() {
  const el = document.getElementById('bid-list');
  const cnt = document.getElementById('bid-count');
  const active = state.bids.filter(b => b.status === 0);
  if (cnt) cnt.textContent = active.length;
  if (!state.bids.length) { el.innerHTML = '<div class="empty-state">No bids yet</div>'; return; }
  el.innerHTML = state.bids.map(b => {
    const task = state.tasks.find(t => t.id === b.task_id);
    const label = { 0:'Pending', 1:'Accepted' }[b.status] ?? 'Unknown';
    return `<div class="card">
      <div class="card-title">Bid on: ${esc(task?.title ?? 'Task #' + b.task_id)}</div>
      <div class="card-meta">
        <span>${fAddr(b.bidder)}</span>
        <span>${fUSDCx(b.bid_price)} price</span>
        <span>${fSBTC(b.stake_amount)} staked</span>
        <span>${label}</span>
      </div>
    </div>`;
  }).join('');
}

// ─── Render — Molbots ─────────────────────────────────────────────
function renderMolbots() {
  const el = document.getElementById('molbot-list');
  if (!state.molbots.length) { el.innerHTML = '<div class="empty-state">No molbots registered</div>'; return; }
  el.innerHTML = state.molbots.map((m, i) => {
    const repPct = (m.reputation_score / 1000 * 100).toFixed(0);
    const cls    = m.reputation_score >= 700 ? 'rep-high' : m.reputation_score >= 400 ? 'rep-mid' : 'rep-low';
    const addrUrl = `${EXPLORER}/address/${m.address}?chain=testnet`;
    const isMe    = state.walletAddress && m.address === state.walletAddress;
    return `<div class="card">
      <div class="card-title">
        <span class="molbot-rank">#${i+1}</span>
        ${esc(m.name || fAddr(m.address))}
        ${isMe ? '<span class="chain-badge cap-ok">you</span>' : ''}
      </div>
      <div class="card-meta">
        <span class="skill-pill">${esc(m.skill_type)}</span>
        <a class="addr-link" href="${addrUrl}" target="_blank" rel="noopener">${fAddr(m.address)}</a>
      </div>
      <div class="rep-bar"><div class="rep-fill ${cls}" style="width:${repPct}%"></div></div>
      <div class="molbot-stats">
        <div class="mstat"><span class="mstat-val">${m.reputation_score}</span><span class="mstat-lbl">rep</span></div>
        <div class="mstat"><span class="mstat-val">${m.total_tasks_completed}</span><span class="mstat-lbl">done</span></div>
        <div class="mstat"><span class="mstat-val">${m.total_tasks_failed}</span><span class="mstat-lbl">failed</span></div>
        <div class="mstat"><span class="mstat-val">${fUSDCx(m.total_earned)}</span><span class="mstat-lbl">earned</span></div>
        <div class="mstat"><span class="mstat-val">${fSBTC(m.total_staked)}</span><span class="mstat-lbl">staked</span></div>
        <div class="mstat"><span class="mstat-val">${fSBTC(m.total_slashed)}</span><span class="mstat-lbl">slashed</span></div>
      </div>
    </div>`;
  }).join('');
  requestAnimationFrame(observeCards);
}

// ─── Render — Payments ────────────────────────────────────────────
function renderPayments() {
  const el = document.getElementById('payment-list');
  const cnt = document.getElementById('payment-count');
  if (cnt) cnt.textContent = state.payments.length;
  if (!state.payments.length) { el.innerHTML = '<div class="empty-state">No payments yet</div>'; return; }
  el.innerHTML = state.payments.map(p => {
    const isSbtc    = p.token === 'sBTC' || p.token === 'sbtc';
    const amt       = isSbtc ? fSBTC(p.amount) + ' sBTC' : fUSDCx(p.amount) + ' USDCx';
    const tagClass  = { escrow:'tag-escrow', reward:'tag-reward', release:'tag-release', slash:'tag-slash' }[p.tx_type] ?? 'tag-escrow';
    const fromLabel = p.from_address.startsWith('contract:') ? p.from_address : fAddr(p.from_address);
    const toLabel   = p.to_address.startsWith('contract:')   ? p.to_address   : fAddr(p.to_address);
    const task      = state.tasks.find(t => t.id === p.task_id);
    const taskLabel = task ? esc(task.title.slice(0, 28)) : `Task #${p.task_id}`;
    const ts        = p.timestamp ? new Date(p.timestamp + 'Z').toLocaleTimeString() : '';
    return `<div class="card">
      <div class="card-footer" style="align-items:flex-start">
        <div>
          <div style="font-size:16px;font-weight:700;color:var(--hi);margin-bottom:4px">${amt}</div>
          <div class="row-meta">${fromLabel} → ${toLabel}</div>
          <div class="row-meta" style="color:var(--dim)">${taskLabel}${ts ? ' · ' + ts : ''}</div>
        </div>
        <span class="token-tag ${tagClass}">${p.tx_type}</span>
      </div>
    </div>`;
  }).join('');
}

// ─── Activity: on-chain tx feed ───────────────────────────────────
const TX_LABEL = {
  'post-task-with-stx': { label: 'Post Task',       color: 'var(--hi)' },
  'bid-with-stx':       { label: 'Place Bid',       color: 'var(--blue)' },
  'accept-bid':         { label: 'Accept Bid',      color: 'var(--yellow)' },
  'submit-work':        { label: 'Submit Work',     color: 'var(--yellow)' },
  'confirm-delivery':   { label: 'Confirm',         color: 'var(--green)' },
  'slash-expired':      { label: 'Slash',           color: 'var(--red)' },
  'register-molbot':    { label: 'Register Molbot', color: 'var(--muted)' },
  'claim-tokens':       { label: 'Faucet',          color: 'var(--yellow)' },
  'mint':               { label: 'Mint',            color: 'var(--dim)' },
};

let _activityCache = [];

async function loadActivity(force = false) {
  if (!force && _activityCache.length && state.activeView !== 'activity') return;
  try {
    // Fetch last 20 txs for the deployer + wallet address
    const addrs = [DEPLOYER_ADDR];
    if (state.walletAddress && state.walletAddress !== DEPLOYER_ADDR) addrs.push(state.walletAddress);
    const results = await Promise.all(
      addrs.map(a =>
        fetch(`https://api.testnet.hiro.so/extended/v1/address/${a}/transactions?limit=20`)
          .then(r => r.ok ? r.json() : { results: [] })
          .then(d => d.results ?? [])
      )
    );
    // Merge, deduplicate by tx_id, sort newest first
    const seen = new Set();
    const all = results.flat().filter(tx => {
      if (seen.has(tx.tx_id)) return false;
      seen.add(tx.tx_id);
      return true;
    }).sort((a, b) => b.burn_block_time - a.burn_block_time).slice(0, 30);
    _activityCache = all;
    if (state.activeView === 'activity') renderActivity();
  } catch {}
}

function renderActivity() {
  const el = document.getElementById('activity-list');
  if (!el) return;
  if (!_activityCache.length) { el.innerHTML = '<div class="empty-state">No activity yet</div>'; return; }
  el.innerHTML = _activityCache.map(tx => {
    const fn    = tx.contract_call?.function_name ?? tx.tx_type ?? '';
    const meta  = TX_LABEL[fn] ?? { label: fn || tx.tx_type, color: 'var(--muted)' };
    const ok    = tx.tx_status === 'success';
    const ts    = tx.burn_block_time ? new Date(tx.burn_block_time * 1000).toLocaleTimeString() : '';
    const short = tx.tx_id.slice(0, 10) + '…' + tx.tx_id.slice(-6);
    const url   = `${EXPLORER}/txid/${tx.tx_id}?chain=testnet`;
    const sender = tx.sender_address ? fAddr(tx.sender_address) : '';
    return `<div class="card act-card ${ok ? '' : 'act-failed'}">
      <div class="act-row">
        <span class="act-label" style="color:${ok ? meta.color : 'var(--red)'}">${meta.label}</span>
        <span class="act-status ${ok ? 'act-ok' : 'act-err'}">${ok ? '✓' : '✗'}</span>
      </div>
      <div class="act-meta">
        <span>${sender}</span>
        ${ts ? `<span>${ts}</span>` : ''}
        <a class="act-txlink" href="${url}" target="_blank" rel="noopener">${short} ↗</a>
      </div>
    </div>`;
  }).join('');
}

// ─── Render — Stats ───────────────────────────────────────────────
function renderStats() {
  const s = state.stats;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('sb-tasks',   s.total_tasks   || 0);
  set('sb-active',  s.active_tasks  || 0);
  set('sb-volume',  fUSDCx(s.total_volume || 0));
  set('sb-staked',  fSBTC(s.total_staked  || 0));
  set('sb-molbots', s.total_molbots || 0);
  set('stat-block', s.current_block || '—');
  updateFooterStatus();
}

// ─── View switching ───────────────────────────────────────────────
function switchView(name) {
  log('nav', `switchView: ${state.activeView} → ${name}`);
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active-view'));
  document.querySelectorAll('.nav-btn[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  const el = document.getElementById('view-' + name);
  if (el) el.classList.add('active-view');
  state.activeView = name;
  // Trigger activity load immediately when switching to that view
  if (name === 'activity') { _lastActivityFetch = 0; loadActivity(true); }
}

// ─── Wallet gate: auto-open wallet modal, then re-run action ──────
// Returns true if wallet is already connected, false + opens modal if not.
// Pass a callback to re-trigger after connect.
function requireWallet(cb) {
  if (state.walletAddress) return true;
  log('action', 'requireWallet: no wallet — triggering connect flow');
  state._pendingAction = cb;
  handleConnectClick(); // async, fires wallet popup
  return false;
}

// ─── Sidebar toggle ───────────────────────────────────────────────
let sidebarOpen = true;
function toggleSidebar() {
  sidebarOpen = !sidebarOpen;
  document.getElementById('sidebar').classList.toggle('hidden', !sidebarOpen);
  document.getElementById('app-main').classList.toggle('full', !sidebarOpen);
  const bar = document.getElementById('balance-bar');
  if (bar) bar.classList.toggle('sidebar-hidden', !sidebarOpen);
}

// ─── Event handlers ───────────────────────────────────────────────
function setupEventHandlers() {
  // Sidebar
  document.getElementById('btn-sidebar-toggle').addEventListener('click', toggleSidebar);

  // Activity refresh
  document.getElementById('btn-refresh-activity')?.addEventListener('click', () => {
    _lastActivityFetch = 0; loadActivity(true);
  });

  // View nav
  document.querySelectorAll('.nav-btn[data-view]').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  // Connect Wallet — single click, no modal
  document.getElementById('btn-connect-wallet').addEventListener('click', handleConnectClick);

  // Wallet fallback panel close
  document.getElementById('wallet-fallback-close')?.addEventListener('click', hideWalletFallback);

  // Manual address entry in fallback panel
  document.getElementById('btn-manual-addr').addEventListener('click', () => {
    const raw = document.getElementById('manual-addr-input').value.trim();
    if (!raw || (!raw.startsWith('ST') && !raw.startsWith('SP'))) {
      const el = document.getElementById('wallet-error');
      if (el) { el.textContent = 'Enter a valid Stacks address (starts with ST or SP)'; el.style.display = 'block'; }
      return;
    }
    finishWalletConnect(raw, 'manual');
    hideWalletFallback();
  });
  document.getElementById('manual-addr-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-manual-addr').click();
  });

  // Post Task modal
  document.getElementById('btn-post-task').addEventListener('click', () => {
    document.getElementById('modal-post-task').style.display = 'flex';
  });
  document.getElementById('modal-close').addEventListener('click', () => {
    document.getElementById('modal-post-task').style.display = 'none';
  });
  // No click-outside-to-close for post task — prevents accidental form loss

  // Escape closes any open modal
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    ['modal-post-task','modal-place-bid','modal-submit-work','modal-register-molbot'].forEach(id => {
      const el = document.getElementById(id);
      if (el && el.style.display !== 'none') {
        log('action', `Escape: closed ${id}`);
        el.style.display = 'none';
      }
    });
  });

  // Post Task → calls router.post-task-with-stx on-chain
  document.getElementById('form-post-task').addEventListener('submit', async e => {
    e.preventDefault();
    if (!requireWallet(() => document.getElementById('modal-post-task').style.display = 'flex')) return;
    const title    = document.getElementById('task-title').value.trim();
    const desc     = document.getElementById('task-description').value.trim();
    const skill    = document.getElementById('task-skill').value;
    const reward   = Math.round(parseFloat(document.getElementById('task-reward').value) * 1_000_000);
    const stake    = Math.round(parseFloat(document.getElementById('task-stake').value) * 100_000_000);
    const deadline = state.stats.current_block
      ? state.stats.current_block + parseInt(document.getElementById('task-deadline').value)
      : parseInt(document.getElementById('task-deadline').value);
    log('action', `post_task: title="${title}" skill=${skill} reward=${reward/1e6}`);
    track('task_post_attempt', { skill, reward_usdcx: reward/1e6 });
    try {
      const deadlineBlocks = parseInt(document.getElementById('task-deadline').value);
      const data = await callContract({
        contract: 'router',
        fn: 'post-task-with-stx',
        args: ({ u, s }) => [
          s(title.slice(0, 64)),
          s(desc.slice(0, 256)),
          s(skill.slice(0, 32)),
          u(reward),
          u(stake),
          u(deadline),
        ],
      });
      // Close modal immediately so user sees the board
      document.getElementById('modal-post-task').style.display = 'none';
      document.getElementById('form-post-task').reset();

      // Optimistic DB write — shows task in list right away
      let dbTaskId = null;
      try {
        const dbTask = await api('/api/tasks', {
          method: 'POST',
          headers: buildPaymentHeaders(),
          body: JSON.stringify({
            title, description: desc, skill_required: skill,
            reward_amount: reward, required_stake: stake,
            deadline_blocks: deadlineBlocks, poster: state.walletAddress,
          }),
        });
        dbTaskId = dbTask?.id ?? null;
        loadAll(); // show optimistic task immediately
      } catch {}

      if (data?.txId) waitAndSync(data.txId, 'Post task', 'post_task', dbTaskId);
      else loadAll();
    } catch (err) {
      if (err.message !== 'Transaction cancelled') {
        log('error', `post_task failed: ${err.message}`);
        track('task_post_fail', { error: String(err) });
        toast('Post failed: ' + err.message, 'error');
      }
    }
  });

  // Task action buttons (delegated)
  document.getElementById('task-list').addEventListener('click', async e => {
    const btn = e.target.closest('button[data-task-id]');
    if (!btn) return;
    const tid = btn.dataset.taskId;

    if (btn.classList.contains('btn-bid')) {
      openBidModal(tid, btn.dataset.stake, btn.dataset.onChain || '');
    }
    if (btn.classList.contains('btn-submit-work')) {
      openSubmitWorkModal(tid);
    }
    if (btn.classList.contains('btn-accept-bid')) {
      if (!requireWallet()) return;
      btn.disabled = true;
      try {
        const bidId = parseInt(btn.dataset.bidId);
        const data = await callContract({
          contract: 'registry', fn: 'accept-bid',
          args: ({ u }) => [u(bidId)],
        });
        if (data?.txId) waitAndSync(data.txId, 'Accept bid');
        else { toast('Bid accepted', 'success'); loadAll(); }
      } catch (err) {
        if (err.message !== 'Transaction cancelled') toast('Accept failed: ' + err.message, 'error');
        btn.disabled = false;
      }
    }
    if (btn.classList.contains('btn-confirm')) {
      if (!requireWallet()) return;
      btn.disabled = true;
      try {
        const data = await callContract({
          contract: 'registry', fn: 'confirm-delivery',
          args: ({ u }) => [u(parseInt(tid))],
        });
        if (data?.txId) waitAndSync(data.txId, 'Confirm delivery');
        else { toast('Delivery confirmed', 'success'); loadAll(); }
      } catch (err) {
        if (err.message !== 'Transaction cancelled') toast('Confirm failed: ' + err.message, 'error');
        btn.disabled = false;
      }
    }
    if (btn.classList.contains('btn-slash')) {
      if (!requireWallet()) return;
      btn.disabled = true;
      try {
        const data = await callContract({
          contract: 'registry', fn: 'slash-expired',
          args: ({ u }) => [u(parseInt(tid))],
        });
        if (data?.txId) waitAndSync(data.txId, 'Slash expired');
        else { toast('Slashed', 'warn'); loadAll(); }
      } catch (err) {
        if (err.message !== 'Transaction cancelled') toast('Slash failed: ' + err.message, 'error');
        btn.disabled = false;
      }
    }
  });

  // Bid modal
  document.getElementById('modal-bid-close').addEventListener('click', () => {
    document.getElementById('modal-place-bid').style.display = 'none';
  });

  // Place Bid → calls router.bid-with-stx on-chain (mints sBTC + places bid)
  document.getElementById('form-place-bid').addEventListener('submit', async e => {
    e.preventDefault();
    const onChainId = document.getElementById('bid-on-chain-id').value;
    if (!onChainId) {
      toast('This task has no on-chain record. Post a new task via the contract first.', 'error');
      return;
    }
    if (!requireWallet(() => openBidModal(
      document.getElementById('bid-task-id').value,
      document.getElementById('bid-stake-amount').value,
      onChainId
    ))) return;
    const tid   = parseInt(onChainId);  // use on-chain ID for contract call
    const stake = parseInt(document.getElementById('bid-stake-amount').value);
    const price = Math.round(parseFloat(document.getElementById('bid-price').value) * 1_000_000);
    track('bid_attempt', { task_id: tid, on_chain_id: tid });
    try {
      const data = await callContract({
        contract: 'router', fn: 'bid-with-stx',
        args: ({ u }) => [u(tid), u(price), u(stake)],
      });
      document.getElementById('modal-place-bid').style.display = 'none';
      document.getElementById('form-place-bid').reset();
      if (data?.txId) waitAndSync(data.txId, 'Place bid');
      else { toast('Bid placed', 'success'); loadAll(); }
    } catch (err) {
      if (err.message !== 'Transaction cancelled') {
        track('bid_fail', { error: String(err) });
        toast('Bid failed: ' + err.message, 'error');
      }
    }
  });

  // Submit work modal
  document.getElementById('modal-submit-close').addEventListener('click', () => {
    document.getElementById('modal-submit-work').style.display = 'none';
  });

  // Submit Work → calls registry.submit-work on-chain
  document.getElementById('form-submit-work').addEventListener('submit', async e => {
    e.preventDefault();
    if (!requireWallet(() => openSubmitWorkModal(document.getElementById('submit-task-id').value))) return;
    const tid   = parseInt(document.getElementById('submit-task-id').value);
    const proof = document.getElementById('submit-proof').value.trim();
    track('submit_work_attempt', { task_id: tid });
    // Convert proof string to 32-byte buffer (sha256 hex or padded ASCII)
    let proofBuf;
    try {
      // If hex: decode directly. Otherwise UTF-8 encode + pad to 32 bytes.
      const sc = window.StacksConnect;
      const hex = proof.replace(/^0x/, '');
      if (/^[0-9a-fA-F]{64}$/.test(hex)) {
        proofBuf = sc.bufferCV(Buffer.from(hex, 'hex'));
      } else {
        const bytes = new TextEncoder().encode(proof.slice(0, 32));
        const padded = new Uint8Array(32);
        padded.set(bytes);
        proofBuf = sc.bufferCV(padded);
      }
    } catch { proofBuf = window.StacksConnect.bufferCV(new Uint8Array(32)); }
    try {
      const data = await callContract({
        contract: 'registry', fn: 'submit-work',
        args: ({ u }) => [u(tid), proofBuf],
      });
      document.getElementById('modal-submit-work').style.display = 'none';
      document.getElementById('form-submit-work').reset();
      if (data?.txId) waitAndSync(data.txId, 'Submit work');
      else { toast('Work submitted', 'success'); loadAll(); }
    } catch (err) {
      if (err.message !== 'Transaction cancelled') {
        track('submit_work_fail', { task_id: tid, error: String(err) });
        toast('Submit failed: ' + err.message, 'error');
      }
    }
  });

  // Register molbot
  // Faucet → server-side gasless mint (no wallet approval needed)
  document.getElementById('btn-faucet').addEventListener('click', async () => {
    if (!requireWallet()) return;
    const btn = document.getElementById('btn-faucet');
    btn.disabled = true;
    btn.textContent = 'Minting…';
    track('faucet_click', { address: state.walletAddress });
    try {
      const result = await api('/api/faucet', {
        method: 'POST',
        body: JSON.stringify({ address: state.walletAddress }),
      });
      toast(`Faucet: 1 sBTC + 100 USDCx minted to your address`, 'success');
      log('chain', `faucet sbtc=${result.sbtc_txid} usdcx=${result.usdcx_txid}`);
      setTimeout(() => fetchBalance(state.walletAddress), 4000); // refresh after broadcast
    } catch (err) {
      toast('Faucet error: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '⛽ Faucet';
    }
  });

  document.getElementById('btn-register-molbot').addEventListener('click', () => {
    document.getElementById('reg-address').value = state.walletAddress || '';
    document.getElementById('modal-register-molbot').style.display = 'flex';
  });
  document.getElementById('modal-reg-close').addEventListener('click', () => {
    document.getElementById('modal-register-molbot').style.display = 'none';
  });
  document.getElementById('modal-register-molbot').addEventListener('click', e => {

  });
  // Register Molbot → calls registry.register-molbot on-chain
  document.getElementById('form-register-molbot').addEventListener('submit', async e => {
    e.preventDefault();
    if (!requireWallet(() => {
      document.getElementById('reg-address').value = state.walletAddress || '';
      document.getElementById('modal-register-molbot').style.display = 'flex';
    })) return;
    const skill_type = document.getElementById('reg-skill').value;
    const name       = document.getElementById('reg-name').value.trim();
    try {
      const data = await callContract({
        contract: 'registry', fn: 'register-molbot',
        args: ({ s }) => [s(skill_type.slice(0, 32))],
      });
      document.getElementById('modal-register-molbot').style.display = 'none';
      document.getElementById('form-register-molbot').reset();
      // Optimistic DB write so molbot appears immediately
      api('/api/molbots', {
        method: 'POST',
        body: JSON.stringify({ address: state.walletAddress, name, skill_type }),
      }).then(() => loadAll()).catch(() => loadAll());
      if (data?.txId) waitAndSync(data.txId, 'Register molbot');
      else toast('Molbot registered', 'success');
    } catch (err) {
      if (err.message !== 'Transaction cancelled')
        toast('Registration failed: ' + err.message, 'error');
    }
  });

  // Task filters
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.filter = btn.dataset.filter;
      track('filter_change', { filter: state.filter });
      renderTasks();
    });
  });

  // Global error capture
  window.onerror = (msg, src) => {
    // Already set at top of file; just track real errors here
    const m = String(msg); const s = String(src);
    if (s.includes('chrome-extension') || s.includes('moz-extension')) return true;
    if (m.includes('redefine property') || m.includes('Cannot redefine') || m.includes('ethereum')) return true;
    track('js_error', { message: m, source: s });
  };
  window.onunhandledrejection = e => track('js_rejection', { reason: String(e.reason) });
}

function openBidModal(taskId, stake, onChainId) {
  document.getElementById('bid-task-id').value = taskId;
  document.getElementById('bid-stake-amount').value = stake;
  document.getElementById('bid-stake-display').value = fSBTC(stake) + ' sBTC';
  document.getElementById('bid-on-chain-id').value = onChainId ?? '';
  const warn = document.getElementById('bid-onchain-warn');
  if (warn) warn.style.display = onChainId ? 'none' : 'block';
  document.getElementById('modal-place-bid').style.display = 'flex';
}

function openSubmitWorkModal(taskId) {
  document.getElementById('submit-task-id').value = taskId;
  document.getElementById('submit-task-display').value = `Task #${taskId}`;
  document.getElementById('submit-proof').value = '';
  document.getElementById('modal-submit-work').style.display = 'flex';
}

// ─── Init ─────────────────────────────────────────────────────────
async function init() {
  log('init', '════════ TaskBid dashboard init ════════');
  log('init', `session_id: ${SESSION_ID}`);
  log('init', `userAgent: ${navigator.userAgent}`);
  log('init', `url: ${location.href}`);

  // Wallet detection at load time
  const { hasLeather, hasXverse } = detectWallets();

  // Silent reconnect from localStorage (zero clicks)
  const restored = trySilentReconnect();
  if (!restored) log('wallet', 'no saved wallet — will prompt on demand');

  // Listen for postMessage from /connect popup
  window.addEventListener('message', e => {
    const d = e.data?.taskbid_wallet;
    if (!d?.stxAddress) return;
    log('wallet', `postMessage received: addr=${d.stxAddress} via ${d.provider}`);
    finishWalletConnect(d.stxAddress, d.provider);
  });

  setupEventHandlers();
  log('init', 'event handlers bound');

  track('page_load', { has_leather: hasLeather, has_xverse: hasXverse });
  await refreshRuntimeMode();
  log('init', `runtime mode: demoMode=${state.demoMode}`);

  log('init', 'initial loadAll() starting…');
  perfStart('initial_load');
  await loadAll();
  log('perf', `initial loadAll() done in ${perfEnd('initial_load')}ms`);
  log('init', `state after load: tasks=${state.tasks.length} bids=${state.bids.length} molbots=${state.molbots.length} payments=${state.payments.length}`);

  updateFooterStatus();

  // Poll every 1 s — completion-chained so requests never overlap
  async function pollLoop() {
    await loadAll();
    setTimeout(pollLoop, 1000);
  }
  setTimeout(pollLoop, 1000);
  log('poll', 'polling every 1 s (completion-chained)');

  // Live Stacks block height — independent of DB stats
  startBlockHeightPoller();

  log('init', '════════ init complete ════════');
  log('init', 'console helpers: taskbidDump() · taskbidClicks() · taskbidPattern()');

  // Pattern snapshot every 60s
  setInterval(() => {
    log('pattern', `── 60s snapshot ── interactions=${_ux.interactions.length} clicks=${_ux.clicks.length} scrolls=${_ux.scrolls.length} maxDepth=${_ux.maxScrollPct}%`);
    const dead = _ux.clicks.filter(c => !c.interactive).length;
    if (dead > 0) log('pattern', `dead clicks so far: ${dead} / ${_ux.clicks.length} (${Math.round(dead/_ux.clicks.length*100)}%)`);
    enqueue('pattern_snapshot', 'pattern', {
      interactions:      _ux.interactions.length,
      clicks:            _ux.clicks.length,
      dead_clicks:       dead,
      scroll_events:     _ux.scrolls.length,
      max_scroll_pct:    _ux.maxScrollPct,
      first_interact_ms: _ux.firstInteract,
    });
  }, 60000);

  const _start = Date.now();
  window.addEventListener('beforeunload', () => {
    const s = Math.round((Date.now()-_start)/1000);
    log('action', `page_unload after ${s}s — flushing queue (${_queue.length} pending)`);
    enqueue('page_unload', 'action', { duration_s: s });
    flushQueue(true); // sendBeacon so it survives page close
  });
}

document.addEventListener('DOMContentLoaded', init);
