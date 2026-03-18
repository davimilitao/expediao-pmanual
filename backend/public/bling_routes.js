// ================================================================
// BLING MODULE — colar no server.js ANTES de "// ---------------- Errors"
// ================================================================

const BLING_CLIENT_ID     = process.env.BLING_CLIENT_ID     || '';
const BLING_CLIENT_SECRET = process.env.BLING_CLIENT_SECRET || '';
const BLING_REDIRECT_URI  = process.env.BLING_REDIRECT_URI  || '';
const BLING_TOKEN_URL     = 'https://www.bling.com.br/Api/v3/oauth/token';
const BLING_AUTH_URL      = 'https://www.bling.com.br/Api/v3/oauth/authorize';
const BLING_API_BASE      = 'https://www.bling.com.br/Api/v3';

// ── TOKEN HELPERS ─────────────────────────────────────────────────
async function blingGetToken() {
  const doc = await db.collection('bling_tokens').doc('main').get();
  return doc.exists ? doc.data() : null;
}
async function blingSaveToken(d) {
  await db.collection('bling_tokens').doc('main').set({
    accessToken:  d.access_token,
    refreshToken: d.refresh_token,
    expiresAt:    Date.now() + (d.expires_in || 21600) * 1000,
    updatedAtMs:  Date.now(),
  }, { merge: true });
}
async function blingRefreshToken(refreshToken) {
  const creds = Buffer.from(`${BLING_CLIENT_ID}:${BLING_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(BLING_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': `Basic ${creds}` },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }).toString(),
  });
  if (!res.ok) throw new Error(`Bling refresh failed: ${res.status}`);
  return res.json();
}
async function blingEnsureToken() {
  let tok = await blingGetToken();
  if (!tok) throw new Error('bling_not_authorized');
  if (Date.now() > tok.expiresAt - 300_000) {
    const refreshed = await blingRefreshToken(tok.refreshToken);
    await blingSaveToken(refreshed);
    tok = await blingGetToken();
  }
  return tok.accessToken;
}
async function blingFetch(path) {
  const token = await blingEnsureToken();
  const res = await fetch(`${BLING_API_BASE}${path}`, {
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
  });
  if (res.status === 401) throw new Error('bling_not_authorized');
  const text = await res.text();
  if (!res.ok) throw new Error(`Bling ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

// Detecta marketplace pelo campo loja ou padrão do nome do cliente
function detectarMkt(nf) {
  const loja = (nf.loja?.descricao || nf.loja?.nome || nf.origem?.descricao || '').toLowerCase();
  const nome = (nf.contato?.nome || '').toLowerCase();
  if (loja.includes('mercado') || loja.includes('meli') || loja.includes('mlb')) return 'MERCADO_LIVRE';
  if (loja.includes('shopee')) return 'SHOPEE';
  // Padrão ML: "Nome Sobrenome (usuario.ml)" — parênteses sem espaço no usuário
  if (nome.match(/\([a-z0-9._-]+\)$/)) return 'MERCADO_LIVRE';
  return 'OUTROS';
}

// ── PÁGINA ────────────────────────────────────────────────────────
app.get('/bling', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'bling.html')));

// ── STATUS ────────────────────────────────────────────────────────
app.get('/bling/status', async (req, res) => {
  const tok = await blingGetToken();
  if (!tok) return res.json({ authorized: false });
  res.json({ authorized: true, expired: Date.now() > tok.expiresAt, updatedAtMs: tok.updatedAtMs });
});

// ── INICIAR OAUTH ─────────────────────────────────────────────────
app.get('/bling/auth', (req, res) => {
  if (!BLING_CLIENT_ID) return res.status(500).json({ error: 'BLING_CLIENT_ID não configurado' });
  const p = new URLSearchParams({ response_type: 'code', client_id: BLING_CLIENT_ID, redirect_uri: BLING_REDIRECT_URI, state: 'expedicao_pro' });
  res.redirect(`${BLING_AUTH_URL}?${p}`);
});

// ── CALLBACK OAUTH ────────────────────────────────────────────────
app.get('/bling/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) return res.redirect('/bling?error=auth_denied');
  try {
    const creds = Buffer.from(`${BLING_CLIENT_ID}:${BLING_CLIENT_SECRET}`).toString('base64');
    const tokenRes = await fetch(BLING_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': `Basic ${creds}` },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: BLING_REDIRECT_URI }).toString(),
    });
    if (!tokenRes.ok) { console.error('[bling/callback]', await tokenRes.text()); return res.redirect('/bling?error=token_failed'); }
    await blingSaveToken(await tokenRes.json());
    res.redirect('/bling?success=1');
  } catch(e) { console.error('[bling/callback]', e); res.redirect('/bling?error=callback_error'); }
});

// ── DESCONECTAR ───────────────────────────────────────────────────
app.post('/bling/disconnect', async (req, res) => {
  await db.collection('bling_tokens').doc('main').delete();
  res.json({ ok: true });
});

// ── LISTAR NFs DO DIA ─────────────────────────────────────────────
// GET /bling/pedidos?data=2026-03-18
// Retorna resumo das NFs — itens são carregados sob demanda via /bling/pedidos/:id
app.get('/bling/pedidos', async (req, res, next) => {
  try {
    const data   = req.query.data || new Date().toISOString().split('T')[0];
    const pagina = Number(req.query.pagina || 1);

    // situacao=100 = Autorizada | 101 = Cancelada | omitir para todas
    const params = new URLSearchParams({
      dataEmissaoInicial: data,
      dataEmissaoFinal:   data,
      pagina,
      limite: 100,
    });

    const resp  = await blingFetch(`/nfe?${params}`);
    const notas = resp.data || [];

    const items = notas.map(n => ({
      id:          n.id,
      numero:      n.numero,
      numeroPedido: null,           // carregado sob demanda
      dataEmissao: n.dataEmissao,
      situacao:    n.situacao?.descricao || '',
      cliente:     { nome: n.contato?.nome || '' },
      marketplace: detectarMkt(n),
      valorTotal:  n.valorTotal || 0,
      itens:       [],              // carregados sob demanda
      detalhado:   false,
    }));

    res.json({ items, total: items.length, data });
  } catch(err) {
    if (err.message === 'bling_not_authorized') return res.status(401).json({ error: 'bling_not_authorized' });
    console.error('[GET /bling/pedidos]', err);
    next(err);
  }
});

// ── DETALHES DE UMA NF (com itens) ───────────────────────────────
// GET /bling/pedidos/:id
app.get('/bling/pedidos/:id', async (req, res, next) => {
  try {
    const resp = await blingFetch(`/nfe/${req.params.id}`);
    const n    = resp.data || resp;

    const item = {
      id:           n.id,
      numero:       n.numero,
      numeroPedido: n.numeroPedidoLoja || n.numeroPedido || null,
      dataEmissao:  n.dataEmissao,
      situacao:     n.situacao?.descricao || '',
      cliente:      { nome: n.contato?.nome || '', email: n.contato?.email || '' },
      marketplace:  detectarMkt(n),
      valorTotal:   n.valorTotal || n.totalProdutos || 0,
      detalhado:    true,
      itens: (n.itens || []).map(it => ({
        // Bling v3 NF: campos diretos no item
        sku:   safeTrim(it.codigo || it.produto?.codigo || ''),
        nome:  safeTrim(it.descricao || it.produto?.descricao || ''),
        qty:   Number(it.quantidade ?? it.qty ?? 1),
        preco: Number(it.valor ?? it.valorUnitario ?? 0),
      })),
    };

    res.json({ item });
  } catch(err) {
    if (err.message === 'bling_not_authorized') return res.status(401).json({ error: 'bling_not_authorized' });
    console.error('[GET /bling/pedidos/:id]', err);
    next(err);
  }
});


// ── DEBUG: ver resposta bruta da API do Bling ────────────────────
// GET /bling/debug/nfe/:id  — remover em produção após diagnóstico
app.get('/bling/debug/nfe/:id', async (req, res, next) => {
  try {
    const raw = await blingFetch(`/nfe/${req.params.id}`);
    res.json(raw); // retorna tudo como veio do Bling
  } catch(err) {
    next(err);
  }
});

// ── CLONAR NF → CRIAR PEDIDO ─────────────────────────────────────
app.post('/bling/clonar', async (req, res, next) => {
  try {
    const { blingNfId, marketplace, itens, clienteNome, numeroPedido } = req.body;

    if (!itens || !itens.length) return res.status(400).json({ error: 'Nenhum item enviado. Abra os itens da NF antes de clonar.' });

    // Separar itens com e sem SKU
    const itensComSku = itens.filter(it => safeTrim(it.sku));
    const itensSemSku = itens.filter(it => !safeTrim(it.sku));

    if (!itensComSku.length) return res.status(400).json({
      error: 'Nenhum item com SKU encontrado. Verifique se os produtos têm código cadastrado no Bling.',
      itensSemSku: itensSemSku.map(it => it.nome),
    });

    // Buscar produtos no Firestore
    const skus      = itensComSku.map(it => safeTrim(it.sku));
    const prodRefs  = skus.map(sku => db.collection('products').doc(sku));
    const prodSnaps = await db.getAll(...prodRefs);
    const prodMap   = new Map();
    for (const s of prodSnaps) if (s.exists) prodMap.set(s.id, s.data());

    const cart         = [];
    const skusFaltando = [];

    for (const it of itensComSku) {
      const sku = safeTrim(it.sku);
      const p   = prodMap.get(sku);
      if (!p) { skusFaltando.push(sku); continue; }
      cart.push({
        sku,
        nameShort:  (p.name || it.nome || sku).slice(0, 48),
        qty:        Number(it.qty || 1),
        ean:        p.ean    || '',
        eanBox:     p.eanBox || '',
        bin:        p.bin    || '',
        image:      './assets/placeholder.png',
        images:     p.images || [],
        checkedQty: 0,
      });
    }

    if (!cart.length) return res.status(400).json({
      error: 'Nenhum produto encontrado no sistema para os SKUs desta NF.',
      skusFaltando,
    });

    // Criar pedido
    const terminalId  = safeTrim(req.header('x-terminal-id')) || `bling_clone`;
    const createdAtMs = nowMs();
    const day         = yyyymmdd();
    const counterRef  = db.collection('meta').doc(`counters_${day}`);

    const result = await db.runTransaction(async tx => {
      const cSnap   = await tx.get(counterRef);
      const seq     = (cSnap.exists ? Number(cSnap.data().seq || 0) : 0) + 1;
      const orderId = `ORD_${day}_${padSeq(seq, ORDER_SEQ_PAD)}`;
      tx.set(counterRef, { docType: 'counter', day, seq, updatedAtMs: createdAtMs }, { merge: true });
      tx.set(db.collection('orders').doc(orderId), {
        docType:       'order',
        source:        'bling',
        blingNfId:     blingNfId   || null,
        numeroPedido:  numeroPedido || null,
        marketplace:   marketplace || 'OUTROS',
        status:        'pending',
        clienteNome:   safeTrim(clienteNome) || '',
        isPriority:    false,
        items:         cart,
        allowConfirmOnlyIfAllChecked: true,
        createdAtMs,
        updatedAtMs:   createdAtMs,
        lockedBy:      terminalId,
        lockedAt:      createdAtMs,
        skusFaltando:  skusFaltando.length ? skusFaltando : null,
      });
      return { orderId };
    });

    res.json({ ok: true, orderId: result.orderId, skusFaltando, itensSemSku: itensSemSku.map(it=>it.nome), cartCount: cart.length });
  } catch(err) {
    console.error('[POST /bling/clonar]', err);
    next(err);
  }
});
