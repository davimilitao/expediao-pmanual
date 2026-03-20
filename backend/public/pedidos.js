'use strict';

const TERMINAL_KEY = 'expedicao_pro_terminal_id';
const REFRESH_MS   = 8000;

function getTerminalId() {
  let id = localStorage.getItem(TERMINAL_KEY);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(TERMINAL_KEY, id); }
  return id;
}
const terminalId = getTerminalId();

// ── STATE ──
const S = {
  orders: { pending: [], picked: [], packed: [] },
  tab: 'pending',
  selId: null,
  selOrder: null,
};

// ✅ HELPER: Resolve o link da imagem
function getImgUrl(url) {
  if (!url || url.includes('placeholder.png')) return '/assets/placeholder.png';
  if (url.startsWith('http') || url.startsWith('/assets')) return url;
  return `/uploads/${url}`;
}

// ✅ HELPER: Conversor numérico seguro
function n(val) {
  if (val === undefined || val === null || val === '') return 0;
  const num = parseFloat(val);
  return isNaN(num) ? 0 : num;
}

// ── API ──
async function api(path, opts = {}) {
  const token = localStorage.getItem('expedicao_token') || '';
  const res = await fetch(path, {
    ...opts,
    headers: {
      'content-type': 'application/json',
      'x-terminal-id': terminalId,
      'authorization': `Bearer ${token}`,
      ...(opts.headers || {})
    }
  });
  const d = await res.json().catch(() => ({}));
  if (res.status === 401) { window.location.href = '/login'; return; }
  if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
  return d;
}

// ── UTILS ──
function esc(s) {
  return (s ?? '').toString().replace(/[&<>"']/g, m =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'})[m]);
}
function fmtTime(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'});
}
function sort(arr) {
  arr.sort((a,b) => {
    if (!!a.isPriority !== !!b.isPriority) return b.isPriority ? 1 : -1;
    return Number(b.createdAtMs||0) - Number(a.createdAtMs||0);
  });
}

// ── FEEDBACK (Toast, Beep, Flash) ──
let _tt = null;
function toast(msg, type='info') {
  const el = document.getElementById('toast');
  if(!el) return;
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(_tt);
  _tt = setTimeout(() => el.classList.remove('show'), 2600);
}

function beep(ok=true) {
  try {
    const ctx = new (window.AudioContext||window.webkitAudioContext)();
    if (ok) {
      [1046, 1318].forEach((freq, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = freq; g.gain.value = 0.07;
        o.connect(g); g.connect(ctx.destination);
        o.start(ctx.currentTime + i*0.11);
        o.stop(ctx.currentTime + i*0.11 + 0.08);
      });
    } else {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'square'; o.frequency.value = 220; g.gain.value = 0.07;
      o.connect(g); g.connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + 0.2);
    }
    setTimeout(() => ctx.close().catch(()=>{}), 600);
  } catch {}
}

function flash(ok=true) {
  const el = document.getElementById('scanFlash');
  if(!el) return;
  el.className = `scan-flash ${ok ? 'ok-flash':'err-flash'}`;
  el.style.opacity = '1';
  setTimeout(() => { el.style.opacity = '0'; }, 140);
}

// ── REFRESH ──
async function refreshAll() {
  try {
    const [p, pi, pk] = await Promise.all([
      api('/orders/list?status=pending&limit=60'),
      api('/orders/list?status=picked&limit=60'),
      api('/orders/list?status=packed&limit=60'),
    ]);
    if (!p || !pi || !pk) return;
    
    // Guardamos o total conferido atualmente antes de sobrescrever
    let oldChecked = 0;
    if (S.selOrder) {
      oldChecked = (S.selOrder.items || []).reduce((a,it)=>a+n(it.checkedQty),0);
    }

    S.orders.pending = p.items  || [];
    S.orders.picked  = pi.items || [];
    S.orders.packed  = pk.items || [];
    sort(S.orders.pending); sort(S.orders.picked); sort(S.orders.packed);

    updateCounters();
    renderList();

    if (S.selId) {
      const found = [...S.orders.pending, ...S.orders.picked, ...S.orders.packed].find(x => x.id === S.selId);
      if (found) { 
        const newChecked = (found.items || []).reduce((a,it)=>a+n(it.checkedQty),0);
        // Só sobrescreve se o servidor mandou uma versão com mais (ou igual) itens bipados que a tela local
        if (newChecked >= oldChecked) {
           S.selOrder = found; 
        }
        renderOrderView(); 
      }
    }
  } catch(e) { console.error(e); }
}

function updateCounters() {
  const set = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = n; };
  set('tc-p', S.orders.pending.length);
  set('tc-i', S.orders.picked.length);
  set('tc-k', S.orders.packed.length);
}

function switchTab(status) {
  S.tab = status;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.status === status));
  renderList();
}
window.switchTab = switchTab;

function mkBadge(m) {
  if (m === 'MERCADO_LIVRE') return `<span class="oc-badge badge-ml">ML</span>`;
  if (m === 'SHOPEE')        return `<span class="oc-badge badge-shop">SHOPEE</span>`;
  return `<span class="oc-badge badge-other">${esc(m)}</span>`;
}

// ── RENDER LIST ──
function renderList() {
  const filter = (document.getElementById('filterInput').value || '').toLowerCase().trim();
  const orders = S.orders[S.tab] || [];
  const list   = document.getElementById('orderList');
  list.innerHTML = '';

  const items = filter
    ? orders.filter(o => (o.id||'').toLowerCase().includes(filter) || (o.clienteNome||'').toLowerCase().includes(filter))
    : orders;

  for (const o of items) {
    const its = Array.isArray(o.items) ? o.items : [];
    
    const total   = its.reduce((a, it) => a + n(it.qty), 0);
    const checked = its.reduce((a, it) => {
        const val = it.checkedQty !== undefined ? it.checkedQty : it.checked;
        return a + n(val);
    }, 0);
    const pct = total > 0 ? Math.round((checked / total) * 100) : 0;

    const thumbs = its.slice(0, 4).map(it => {
      return `<img class="oc-thumb" src="${getImgUrl(it.image)}" onerror="this.src='/assets/placeholder.png'">`;
    });

    const card = document.createElement('div');
    card.className = `order-card${o.id === S.selId ? ' active' : ''}${o.isPriority ? ' priority' : ''}`;
    card.innerHTML = `
      <div class="oc-top">
        <div class="oc-id">${o.isPriority ? '🔥 ' : ''}${esc(o.id)}</div>
        <div class="oc-badges">${mkBadge(o.marketplace)}</div>
      </div>
      <div class="oc-progress">
        <div class="oc-bar-wrap"><div class="oc-bar${pct >= 100 ? ' full' : ''}" style="width:${pct}%"></div></div>
        <div class="oc-ratio">${checked}/${total}</div>
      </div>
      <div class="oc-thumbs">${thumbs.join('')}</div>
      ${o.clienteNome ? `<div class="oc-time">👤 ${esc(o.clienteNome)}</div>` : ''}
      <div class="oc-time">🕐 ${fmtTime(o.createdAtMs)}</div>
    `;
    card.addEventListener('click', () => selectOrder(o));
    list.appendChild(card);
  }
}

// ── RENDER ORDER VIEW ──
function renderOrderView() {
  const o = S.selOrder;
  if (!o) return;

  document.getElementById('viewId').textContent = o.id;

  const its     = Array.isArray(o.items) ? o.items : [];
  const total   = its.reduce((a, it) => a + n(it.qty), 0);
  const checked = its.reduce((a, it) => {
      const val = it.checkedQty !== undefined ? it.checkedQty : it.checked;
      return a + n(val);
  }, 0);
  
  const pct   = total > 0 ? Math.round((checked / total) * 100) : 0;
  const allOk = total > 0 && checked >= total;

  const pfBar = document.getElementById('pfBar');
  pfBar.style.width = `${pct}%`;
  pfBar.style.backgroundColor = allOk ? '#28a745' : 'var(--accent-blue)';
  
  document.getElementById('pfPct').textContent = `${checked} / ${total}`;
  document.getElementById('btnPicked').disabled = !(o.status === 'pending' && allOk);
  document.getElementById('btnPacked').disabled = !(o.status === 'picked');

  const area = document.getElementById('itemsArea');
  area.innerHTML = '';

  for (const it of its) {
    const qReq = n(it.qty);
    const qDone = n(it.checkedQty !== undefined ? it.checkedQty : it.checked);
    const ok = qDone >= qReq;

    const row = document.createElement('div');
    row.className = `item-row${ok ? ' checked' : ''}`;
    row.innerHTML = `
      <div class="item-top">
        <div class="item-img-wrap">
          <img class="item-photo-img" src="${getImgUrl(it.image)}" onerror="this.src='/assets/placeholder.png'">
        </div>
        <div class="item-info">
          <div class="item-name">${esc(it.nameShort || it.name || '')}</div>
          <div class="item-tags">
            <span class="itag">SKU ${esc(it.sku)}</span>
            <span class="itag itag-bin">📍 ${esc(it.bin || '—')}</span>
          </div>
          <button class="btn-expand" data-sku="${esc(it.sku)}">Ver fotos do estoque ▾</button>
        </div>
        <div class="item-qty">
          <div class="qty-num${ok ? ' full' : ''}">${qDone}</div>
          <div class="qty-of">de ${qReq}</div>
          <button class="qty-btn${ok ? ' done' : ''}" data-sku="${esc(it.sku)}">${ok ? '✓' : '+'}</button>
        </div>
      </div>
      <div class="item-photos-panel hidden" id="panel-${it.sku}">
        <div class="photos-grid">
           <div class="photo-col"><img src="${getImgUrl(it.image)}" class="photo-big"></div>
           <div class="photo-col"><img src="${getImgUrl(it.binPhoto)}" class="photo-big" onerror="this.style.display='none'"></div>
        </div>
      </div>
    `;
    
    // Botão manual de soma
    row.querySelector('.qty-btn').addEventListener('click', () => onScan(it.sku));
    
    // Botão de expandir fotos
    row.querySelector('.btn-expand').addEventListener('click', (e) => {
      const p = document.getElementById(`panel-${it.sku}`);
      p.classList.toggle('hidden');
      e.target.textContent = p.classList.contains('hidden') ? 'Ver fotos do estoque ▾' : 'Fechar fotos ▴';
    });

    area.appendChild(row);
  }
}

async function selectOrder(o) {
  S.selId = o.id; S.selOrder = o;
  renderList();
  document.getElementById('noOrder').style.display = 'none';
  document.getElementById('orderView').style.display = 'flex';
  renderOrderView();
  api(`/orders/${encodeURIComponent(o.id)}/lock`, {method:'POST', body:'{}'}).catch(()=>{});
  focusScanner();
}

function focusScanner() { document.getElementById('scannerInput')?.focus(); }

let _buf = '', _bt = null;
window.addEventListener('keydown', e => {
  if (document.activeElement.id === 'filterInput') return;
  if (e.key === 'Enter') {
    const code = _buf.trim(); _buf = ''; clearTimeout(_bt);
    if (code) onScan(code);
    return;
  }
  if (e.key.length === 1) {
    _buf += e.key;
    clearTimeout(_bt);
    _bt = setTimeout(() => { _buf = ''; }, 500);
  }
});

async function onScan(code) {
  if (!S.selId) return;
  const sc = document.getElementById('scanStatus');
  sc.className = 'scanner-status busy'; sc.textContent = '● LENDO…';
  try {
    const r = await api(`/orders/${encodeURIComponent(S.selId)}/check`, {
      method:'POST', body: JSON.stringify({ code })
    });
    
    if (r && r.ok) {
      beep(true); flash(true);
      toast(`✓ ${r.sku} (${r.checkedQty}/${r.qty})`, 'ok');
      
      // 🔥 A MÁGICA AQUI: Atualiza o Javascript local imediatamente após o bipe!
      if (S.selOrder && S.selOrder.items) {
        const item = S.selOrder.items.find(it => it.sku === r.sku);
        if (item) item.checkedQty = r.checkedQty; // O backend mandou o valor novo no Toast, então colocamos na memória
      }
      
      // Atualiza também na lista lateral
      const orderList = S.orders.pending.find(o => o.id === S.selId);
      if (orderList && orderList.items) {
        const itemL = orderList.items.find(it => it.sku === r.sku);
        if (itemL) itemL.checkedQty = r.checkedQty;
      }

      // Redesenha a tela instantaneamente
      renderOrderView();
      renderList();
      
      // Pede para o servidor a lista nova de fundo, mas sem apagar a leitura que acabamos de colocar na tela
      refreshAll();
    } else {
      beep(false); flash(false);
      toast(r.error || 'Erro no scan', 'err');
    }
  } catch(e) { toast(e.message, 'err'); }
  finally { sc.className = 'scanner-status ready'; sc.textContent = '● PRONTO'; }
}

async function markPicked() {
  if (!S.selId) return;
  try {
    const r = await api(`/orders/${encodeURIComponent(S.selId)}/status`, {method:'POST', body:JSON.stringify({status:'picked'})});
    if (r.ok) { beep(true); toast('Pedido SEPARADO', 'ok'); await refreshAll(); }
  } catch(e) { toast(e.message, 'err'); }
}

async function markPacked() {
  if (!S.selId) return;
  try {
    const r = await api(`/orders/${encodeURIComponent(S.selId)}/status`, {method:'POST', body:JSON.stringify({status:'packed'})});
    if (r.ok) { beep(true); toast('Pedido EXPEDIDO', 'ok'); await refreshAll(); }
  } catch(e) { toast(e.message, 'err'); }
}

refreshAll();
setInterval(refreshAll, REFRESH_MS);
focusScanner();