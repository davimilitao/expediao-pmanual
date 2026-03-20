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
function fmtDate(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleDateString('pt-BR', {day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'});
}
function sort(arr) {
  arr.sort((a,b) => {
    if (!!a.isPriority !== !!b.isPriority) return b.isPriority ? 1 : -1;
    return Number(b.createdAtMs||0) - Number(a.createdAtMs||0);
  });
}

// ── CLOCK ──
function tick() { document.getElementById('clock').textContent = new Date().toLocaleTimeString('pt-BR'); }
setInterval(tick, 1000); tick();

// ── TOAST ──
let _tt = null;
function toast(msg, type='info') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(_tt);
  _tt = setTimeout(() => el.classList.remove('show'), 2600);
}

// ── BEEP ──
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

// ── FLASH ──
function flash(ok=true) {
  const el = document.getElementById('scanFlash');
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
    S.orders.pending = p.items  || [];
    S.orders.picked  = pi.items || [];
    S.orders.packed  = pk.items || [];
    sort(S.orders.pending); sort(S.orders.picked); sort(S.orders.packed);

    updateCounters();
    renderList();

    if (S.selId) {
      const found = [...S.orders.pending, ...S.orders.picked, ...S.orders.packed].find(x => x.id === S.selId);
      if (found) {
        S.selOrder = found;
        // Só faz render completo se não tem scan em andamento
        // (evita flicker e perda de estado durante bipagem rápida)
        renderOrderView();
      }
    }
  } catch(e) { toast(`Erro ao atualizar: ${e.message}`, 'err'); }
}

async function refreshSelected() { await refreshAll(); }

// ── COUNTERS ──
function updateCounters() {
  const set = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = n; };
  set('cntP', S.orders.pending.length);
  set('cntI',  S.orders.picked.length);
  set('cntK',  S.orders.packed.length);
  set('tc-p', S.orders.pending.length);
  set('tc-i',  S.orders.picked.length);
  set('tc-k',  S.orders.packed.length);
}

// ── TABS ──
function switchTab(status) {
  S.tab = status;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.status === status));
  renderList();
}
window.switchTab = switchTab;

// ── BADGES ──
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

  if (!items.length) {
    list.innerHTML = `<div style="color:var(--muted2);font-size:13px;padding:20px;text-align:center;">Nenhum pedido</div>`;
    return;
  }

  for (const o of items) {
    const its     = Array.isArray(o.items) ? o.items : [];
    const total   = its.reduce((a,it) => a + Number(it.qty||0), 0);
    const checked = its.reduce((a,it) => a + Number(it.checkedQty||0), 0);
    const pct     = total > 0 ? Math.round((checked/total)*100) : 0;

    // thumbs — usa a foto enriquecida
    const thumbs = its.slice(0,4).map(it => {
      const src = it.image || '/assets/placeholder.png';
      return `<img class="oc-thumb" src="${esc(src)}" onerror="this.src='/assets/placeholder.png'" alt="">`;
    });
    if (its.length > 4) thumbs.push(`<div class="oc-thumb-more">+${its.length-4}</div>`);

    const card = document.createElement('div');
    card.className = `order-card${o.id===S.selId?' active':''}${o.isPriority?' priority':''}`;
    card.innerHTML = `
      <div class="oc-top">
        <div class="oc-id">${o.isPriority?'🔥 ':''}${esc(o.id)}</div>
        <div class="oc-badges">
          ${o.isPriority ? '<span class="oc-badge badge-flex">FLEX</span>' : ''}
          ${mkBadge(o.marketplace)}
        </div>
      </div>
      <div class="oc-progress">
        <div class="oc-bar-wrap"><div class="oc-bar${pct>=100?' full':''}" style="width:${pct}%"></div></div>
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
window.renderList = renderList;

// ── SELECT ORDER ──
async function selectOrder(o) {
  S.selId    = o.id;
  S.selOrder = o;
  renderList();
  document.getElementById('noOrder').style.display = 'none';
  const ov = document.getElementById('orderView');
  ov.style.display = 'flex';
  renderOrderView();
  try { await api(`/orders/${encodeURIComponent(o.id)}/lock`, {method:'POST', body:'{}'}); } catch {}
  focusScanner();
}

// ── RENDER ORDER VIEW ──
function renderOrderView() {
  const o = S.selOrder;
  if (!o) return;

  document.getElementById('viewId').textContent = o.id;

  const statusTag = {
    pending: '<span class="tag tag-pending">A Separar</span>',
    picked:  '<span class="tag tag-picked">Separado</span>',
    packed:  '<span class="tag tag-packed">Expedido</span>'
  }[o.status] || '';

  document.getElementById('viewMeta').innerHTML = `
    ${statusTag}
    ${mkBadge(o.marketplace)}
    ${o.isPriority ? '<span class="tag" style="background:rgba(255,230,0,.15);color:var(--ml);border:1px solid rgba(255,230,0,.3);">🔥 FLEX</span>' : ''}
    ${o.clienteNome ? `<span style="font-size:12px;color:var(--muted);">👤 ${esc(o.clienteNome)}</span>` : ''}
  `;

  const its     = Array.isArray(o.items) ? o.items : [];
  const total   = its.reduce((a,it) => a + Number(it.qty||0), 0);
  const checked = its.reduce((a,it) => a + Number(it.checkedQty||0), 0);
  const pct     = total > 0 ? Math.round((checked/total)*100) : 0;
  const allOk   = total > 0 && checked >= total;

  document.getElementById('pfBar').style.width  = `${pct}%`;
  document.getElementById('pfPct').textContent  = `${checked} / ${total}`;
  document.getElementById('btnPicked').disabled = !(o.status === 'pending' && allOk);
  document.getElementById('btnPacked').disabled = !(o.status === 'picked');

  const area = document.getElementById('itemsArea');
  area.innerHTML = '';

  if (!its.length) {
    area.innerHTML = `<div style="color:var(--muted2);text-align:center;padding:40px;">Sem itens neste pedido.</div>`;
    return;
  }

  for (const it of its) {
    const qty = Number(it.qty||0);
    const chk = Number(it.checkedQty||0);
    const ok  = chk >= qty;

    const mainPhoto   = it.image || '/assets/placeholder.png';
    const stockPhotos = Array.isArray(it.stockPhotos) ? it.stockPhotos : [];
    const boxPhotos   = Array.isArray(it.boxPhotos)   ? it.boxPhotos   : [];
    const binPhoto    = it.binPhoto || null;
    const binDate     = it.binPhotoUpdatedAt ? fmtDate(it.binPhotoUpdatedAt) : null;
    const binLabel    = it.customBin || it.bin || '';

    // Monta galeria de 3 fotos para o painel expansível
    const hasPhotos = stockPhotos.length > 0 || boxPhotos.length > 0 || binPhoto;

    const row = document.createElement('div');
    row.className = `item-row${ok?' checked':''}`;

    row.innerHTML = `
      <!-- LINHA PRINCIPAL (sempre visível) -->
      <div class="item-top">

        <div class="item-img-wrap" title="Clique para ver fotos">
          <img class="item-photo-img" src="${esc(mainPhoto)}" onerror="this.src='/assets/placeholder.png'" alt="">
          ${hasPhotos ? '<div class="photo-hint">📷</div>' : ''}
        </div>

        <div class="item-info">
          <div class="item-name">${esc(it.nameShort || it.name || '')}</div>
          <div class="item-tags">
            <span class="itag">SKU ${esc(it.sku||'')}</span>
            <span class="itag">EAN ${esc(it.ean||'—')}</span>
            ${binLabel ? `<span class="itag itag-bin">📍 ${esc(binLabel)}</span>` : ''}
            ${it.eanBox ? `<span class="itag">EAN cx: ${esc(it.eanBox)}</span>` : ''}
          </div>
          ${it.notes ? `<div class="item-notes">⚠️ ${esc(it.notes)}</div>` : ''}
          ${hasPhotos ? `<button class="btn-expand" data-sku="${esc(it.sku)}">Ver fotos do estoque ▾</button>` : ''}
        </div>

        <div class="item-qty">
          <div class="qty-num${ok?' full':''}">${chk}</div>
          <div class="qty-of">de ${qty}</div>
          <button class="qty-btn${ok?' done':''}" data-sku="${esc(it.sku)}" ${ok?'disabled':''}>
            ${ok ? '✓' : '+'}
          </button>
        </div>

      </div>

      <!-- PAINEL EXPANSÍVEL (3 fotos) -->
      <div class="item-photos-panel hidden" id="panel-${esc(it.sku)}">

        <div class="photos-grid">

          <div class="photo-col">
            <div class="photo-label">📦 Produto</div>
            ${stockPhotos.length > 0
              ? `<img src="${esc(stockPhotos[0])}" onerror="this.src='/assets/placeholder.png'" alt="" class="photo-big">`
              : `<div class="photo-empty">Sem foto<br><span>Cadastre no Admin</span></div>`
            }
          </div>

          <div class="photo-col">
            <div class="photo-label">🎁 Embalado</div>
            ${boxPhotos.length > 0
              ? `<img src="${esc(boxPhotos[0])}" onerror="this.src='/assets/placeholder.png'" alt="" class="photo-big">`
              : `<div class="photo-empty">Sem foto<br><span>Cadastre no Admin</span></div>`
            }
          </div>

          <div class="photo-col">
            <div class="photo-label">📍 Prateleira${binDate ? `<span class="photo-date">${esc(binDate)}</span>` : ''}</div>
            ${binPhoto
              ? `<img src="${esc(binPhoto)}" onerror="this.src='/assets/placeholder.png'" alt="" class="photo-big">`
              : `<div class="photo-empty">Sem foto<br><span>Cadastre no Admin</span></div>`
            }
          </div>

        </div>

        ${binLabel ? `<div class="bin-label-big">📍 Localização: <strong>${esc(binLabel)}</strong></div>` : ''}

      </div>
    `;

    // bind botão manual
    row.querySelector('.qty-btn').addEventListener('click', e => onScan(e.currentTarget.dataset.sku));

    // bind expand
    const expandBtn = row.querySelector('.btn-expand');
    if (expandBtn) {
      expandBtn.addEventListener('click', () => {
        const panel = document.getElementById(`panel-${it.sku}`);
        const isOpen = !panel.classList.contains('hidden');
        panel.classList.toggle('hidden', isOpen);
        expandBtn.textContent = isOpen ? 'Ver fotos do estoque ▾' : 'Fechar fotos ▴';
      });
    }

    // clique na foto também expande
    row.querySelector('.item-img-wrap').addEventListener('click', () => {
      if (!hasPhotos) return;
      const panel = document.getElementById(`panel-${it.sku}`);
      const isOpen = !panel.classList.contains('hidden');
      panel.classList.toggle('hidden', isOpen);
      if (expandBtn) expandBtn.textContent = isOpen ? 'Ver fotos do estoque ▾' : 'Fechar fotos ▴';
    });

    area.appendChild(row);
  }
}

// ── SCANNER ──
function focusScanner() { document.getElementById('scannerInput')?.focus(); }

let _buf = '', _bt = null;
window.addEventListener('keydown', e => {
  const active = document.activeElement;
  if (active && active.id === 'filterInput') return;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA') && active.id !== 'scannerInput') return;

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
  if (!S.selId) { toast('Selecione um pedido primeiro', 'info'); beep(false); return; }

  const sc = document.getElementById('scanStatus');
  sc.className = 'scanner-status busy font-mono';
  sc.textContent = '● LENDO…';

  try {
    const r = await api(`/orders/${encodeURIComponent(S.selId)}/check`, {
      method:'POST', body: JSON.stringify({ code })
    });

    if (r && r.ok) {
      // Garantir que checkedQty e qty são sempre números
      const chk = Number(r.checkedQty);
      const qty = Number(r.qty);

      beep(true); flash(true);
      toast(`✓ ${r.sku}  (${chk}/${qty})`, 'ok');

      // Atualiza estado local imediatamente (sem esperar Firestore)
      if (S.selOrder && Array.isArray(S.selOrder.items)) {
        const it = S.selOrder.items.find(x => x.sku === r.sku);
        if (it) it.checkedQty = chk;
        renderOrderViewLocal();
      }

      // Refresh em background sem bloquear o scanner
      refreshAll().catch(() => {});

    } else if (r) {
      beep(false); flash(false);
      const msgs = {
        item_not_found:           `⚠ Código não encontrado: ${code}`,
        already_fully_checked:    'Item já conferido por completo',
        locked_by_other_terminal: 'Pedido em uso em outro terminal',
        not_all_items_checked:    'Confira todos os itens antes de confirmar',
      };
      toast(msgs[r.error] || r.error || 'Erro desconhecido', 'err');
    }
  } catch(e) {
    beep(false); flash(false);
    toast(`Erro: ${e.message}`, 'err');
  } finally {
    // Garante que o scanStatus SEMPRE volta para PRONTO, mesmo em erros
    sc.className = 'scanner-status ready font-mono';
    sc.textContent = '● PRONTO';
    focusScanner();
  }
}

// ── ATUALIZAÇÃO LOCAL DOS CONTADORES (sem recriar os items) ─────────────────
// Atualiza apenas pfBar, pfPct, btnPicked e o item específico que foi bipado.
// NÃO recria toda a lista — preserva painéis de fotos abertos e scroll.
function renderOrderViewLocal() {
  const o = S.selOrder;
  if (!o) return;

  const its     = Array.isArray(o.items) ? o.items : [];
  const total   = its.reduce((a, it) => a + Number(it.qty   || 0), 0);
  const checked = its.reduce((a, it) => a + Number(it.checkedQty || 0), 0);
  const pct     = total > 0 ? Math.round((checked / total) * 100) : 0;
  const allOk   = total > 0 && checked >= total;

  // Atualiza barra de progresso
  const pfBar = document.getElementById('pfBar');
  const pfPct = document.getElementById('pfPct');
  if (pfBar) pfBar.style.width = `${pct}%`;
  if (pfPct) pfPct.textContent = `${checked} / ${total}`;

  // Atualiza botão Confirmar
  const btnPicked = document.getElementById('btnPicked');
  if (btnPicked) btnPicked.disabled = !(o.status === 'pending' && allOk);

  // Atualiza visualmente cada item individualmente (sem recriar o DOM)
  for (const it of its) {
    const qty = Number(it.qty     || 0);
    const chk = Number(it.checkedQty || 0);
    const ok  = chk >= qty;

    // Encontra o row pelo SKU (cada row tem o qty-btn com data-sku)
    const btn = document.querySelector(`.qty-btn[data-sku="${CSS.escape(it.sku)}"]`);
    if (!btn) continue;
    const row = btn.closest('.item-row');
    if (!row) continue;

    // Atualiza o número exibido
    const qtyNum = row.querySelector('.qty-num');
    if (qtyNum) {
      qtyNum.textContent = chk;
      qtyNum.className   = `qty-num${ok ? ' full' : ''}`;
    }

    // Atualiza o botão +/✓
    btn.textContent = ok ? '✓' : '+';
    btn.disabled    = ok;
    btn.className   = `qty-btn${ok ? ' done' : ''}`;

    // Atualiza a borda/fundo do row
    row.classList.toggle('checked', ok);
  }
}

// ── AÇÕES ──
async function markPicked() {
  if (!S.selId) return;
  try {
    const r = await api(`/orders/${encodeURIComponent(S.selId)}/status`, {method:'POST', body:JSON.stringify({status:'picked'})});
    if (r && r.ok) { beep(true); toast('Pedido SEPARADO ✓', 'ok'); await refreshAll(); }
    else if (r) toast(r.error||'Falha', 'err');
  } catch(e) { toast(e.message, 'err'); }
}

async function markPacked() {
  if (!S.selId) return;
  try {
    const r = await api(`/orders/${encodeURIComponent(S.selId)}/status`, {method:'POST', body:JSON.stringify({status:'packed'})});
    if (r && r.ok) { beep(true); toast('Pedido EXPEDIDO 🚚', 'ok'); await refreshAll(); }
    else if (r) toast(r.error||'Falha', 'err');
  } catch(e) { toast(e.message, 'err'); }
}

window.refreshAll      = refreshAll;
window.refreshSelected = refreshSelected;
window.markPicked      = markPicked;
window.markPacked      = markPacked;

// ── INIT ──
refreshAll();
setInterval(refreshAll, REFRESH_MS);
focusScanner();
