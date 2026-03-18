// ================================================================
// BLING MODULE — adicionar ao server.js ANTES de "// ---------------- Errors"
//
// Variáveis de ambiente necessárias:
//   BLING_CLIENT_ID
//   BLING_CLIENT_SECRET
//   BLING_REDIRECT_URI  (ex: https://seuapp.railway.app/bling/callback)
//
// Firestore collection: bling_tokens
//   doc "main" = { accessToken, refreshToken, expiresAt, updatedAtMs }
// ================================================================

// ── CONFIGURAÇÃO ──────────────────────────────────────────────────
const BLING_CLIENT_ID     = process.env.BLING_CLIENT_ID     || '';
const BLING_CLIENT_SECRET = process.env.BLING_CLIENT_SECRET || '';
const BLING_REDIRECT_URI  = process.env.BLING_REDIRECT_URI  || '';
const BLING_AUTH_URL      = 'https://www.bling.com.br/Api/v3/oauth/authorize';
const BLING_TOKEN_URL     = 'https://www.bling.com.br/Api/v3/oauth/token';
const BLING_API_BASE      = 'https://www.bling.com.br/Api/v3';

// ── HELPERS TOKEN ─────────────────────────────────────────────────
async function blingGetToken() {
  const doc = await db.collection('bling_tokens').doc('main').get();
  if (!doc.exists) return null;
  return doc.data();
}

async function blingSaveToken(data) {
  await db.collection('bling_tokens').doc('main').set({
    accessToken:  data.access_token,
    refreshToken: data.refresh_token,
    expiresAt:    Date.now() + (data.expires_in || 21600) * 1000,
    updatedAtMs:  Date.now(),
  }, { merge: true });
}

async function blingRefreshToken(refreshToken) {
  const body = new URLSearchParams({
    grant_type:    'refresh_token',
    refresh_token: refreshToken,
  });
  const creds = Buffer.from(`${BLING_CLIENT_ID}:${BLING_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(BLING_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/x-www-form-urlencoded',
      'Authorization': `Basic ${creds}`,
    },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`Bling refresh failed: ${res.status}`);
  return res.json();
}

async function blingEnsureToken() {
  let tok = await blingGetToken();
  if (!tok) throw new Error('bling_not_authorized');

  // Refresh se faltar menos de 5 minutos para expirar
  if (Date.now() > tok.expiresAt - 300_000) {
    const refreshed = await blingRefreshToken(tok.refreshToken);
    await blingSaveToken(refreshed);
    tok = await blingGetToken();
  }
  return tok.accessToken;
}

async function blingGet(path) {
  const token = await blingEnsureToken();
  const res = await fetch(`${BLING_API_BASE}${path}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (res.status === 401) throw new Error('bling_not_authorized');
  if (!res.ok) throw new Error(`Bling API error: ${res.status}`);
  return res.json();
}

// ── ROTA: página HTML da tela Bling ──────────────────────────────
app.get('/bling', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'bling.html')));

// ── ROTA: status de autorização ───────────────────────────────────
app.get('/bling/status', async (req, res) => {
  const tok = await blingGetToken();
  if (!tok) return res.json({ authorized: false });
  const expired = Date.now() > tok.expiresAt;
  res.json({ authorized: true, expired, updatedAtMs: tok.updatedAtMs });
});

// ── ROTA: iniciar OAuth (redireciona para Bling) ──────────────────
app.get('/bling/auth', (req, res) => {
  if (!BLING_CLIENT_ID) return res.status(500).json({ error: 'BLING_CLIENT_ID não configurado' });
  const params = new URLSearchParams({
    response_type: 'code',
    client_id:     BLING_CLIENT_ID,
    redirect_uri:  BLING_REDIRECT_URI,
    state:         'expedicao_pro',
  });
  res.redirect(`${BLING_AUTH_URL}?${params}`);
});

// ── ROTA: callback OAuth ──────────────────────────────────────────
app.get('/bling/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) {
    return res.redirect('/bling?error=auth_denied');
  }
  try {
    const creds = Buffer.from(`${BLING_CLIENT_ID}:${BLING_CLIENT_SECRET}`).toString('base64');
    const body  = new URLSearchParams({
      grant_type:   'authorization_code',
      code:          code,
      redirect_uri:  BLING_REDIRECT_URI,
    });
    const tokenRes = await fetch(BLING_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/x-www-form-urlencoded',
        'Authorization': `Basic ${creds}`,
      },
      body: body.toString(),
    });
    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      console.error('[bling/callback] token error:', err);
      return res.redirect('/bling?error=token_failed');
    }
    const tokenData = await tokenRes.json();
    await blingSaveToken(tokenData);
    res.redirect('/bling?success=1');
  } catch(err) {
    console.error('[bling/callback]', err);
    res.redirect('/bling?error=callback_error');
  }
});

// ── ROTA: desconectar Bling ───────────────────────────────────────
app.post('/bling/disconnect', async (req, res) => {
  await db.collection('bling_tokens').doc('main').delete();
  res.json({ ok: true });
});

// ── ROTA: listar pedidos/NFs de saída do dia ──────────────────────
// GET /bling/pedidos?data=2026-03-18&pagina=1
app.get('/bling/pedidos', async (req, res, next) => {
  try {
    const hoje = req.query.data || new Date().toISOString().split('T')[0];
    const pagina = Number(req.query.pagina || 1);

    // Busca pedidos de venda (situação = Em aberto, Atendido, Em andamento)
    const params = new URLSearchParams({
      dataInicial:   hoje,
      dataFinal:     hoje,
      pagina:        pagina,
      limite:        100,
      idsSituacoes:  '9,15,12', // 9=Em aberto, 12=Em andamento, 15=Atendido (ajuste conforme seu Bling)
    });

    const data = await blingGet(`/nfe?${params}`);
    const pedidos = data.data || [];

    // Enriquecer cada pedido com info de itens
    const enriched = pedidos.map(p => ({
      id:            p.id,
      numero:        p.numero,
      numeroPedido:  p.numeroPedido || p.numero, // número do marketplace
      dataEmissao:   p.data,
      situacao:      p.situacao?.nome || '',
      cliente: {
        nome:  p.contato?.nome || '',
        email: p.contato?.email || '',
      },
      marketplace:   detectarMarketplace(p),
      valorTotal:    p.totalProdutos || 0,
      itens: (p.itens || []).map(it => ({
        sku:      it.codigo || it.produto?.codigo || '',
        nome:     it.descricao || it.produto?.descricao || '',
        qty:      Number(it.quantidade || 1),
        preco:    Number(it.valor || 0),
      })),
    }));

    res.json({ items: enriched, total: enriched.length, pagina, data: hoje });
  } catch(err) {
    if (err.message === 'bling_not_authorized') {
      return res.status(401).json({ error: 'bling_not_authorized' });
    }
    console.error('[GET /bling/pedidos]', err);
    next(err);
  }
});

// ── ROTA: detalhes de um pedido Bling ────────────────────────────
app.get('/bling/pedidos/:id', async (req, res, next) => {
  try {
    const data = await blingGet(`/nfe/${req.params.id}`);
    res.json({ item: data.data || data });
  } catch(err) {
    if (err.message === 'bling_not_authorized') return res.status(401).json({ error: 'bling_not_authorized' });
    next(err);
  }
});

// ── ROTA: clonar pedido Bling → criar no sistema ─────────────────
app.post('/bling/clonar', async (req, res, next) => {
  try {
    const { blingPedidoId, marketplace, itens, clienteNome, numeroPedido } = req.body;

    if (!itens || !itens.length) return res.status(400).json({ error: 'itens obrigatórios' });
    if (!marketplace) return res.status(400).json({ error: 'marketplace obrigatório' });

    // Verificar SKUs no Firestore e montar cart
    const skus = itens.map(it => it.sku).filter(Boolean);
    if (!skus.length) return res.status(400).json({ error: 'nenhum SKU encontrado nos itens' });

    const prodRefs  = skus.map(sku => db.collection('products').doc(sku));
    const prodSnaps = await db.getAll(...prodRefs);
    const prodMap   = new Map();
    for (const s of prodSnaps) if (s.exists) prodMap.set(s.id, s.data());

    const cart = [];
    const skusFaltando = [];
    for (const it of itens) {
      const p = prodMap.get(it.sku);
      if (!p) { skusFaltando.push(it.sku); continue; }
      cart.push({
        sku:       p.sku,
        nameShort: p.name?.slice(0, 48) || it.nome || it.sku,
        qty:       Number(it.qty || 1),
        ean:       p.ean || '',
        eanBox:    p.eanBox || '',
        bin:       p.bin || '',
        image:     './assets/placeholder.png',
        images:    p.images || [],
        checkedQty: 0,
      });
    }

    if (!cart.length) {
      return res.status(400).json({
        error: 'Nenhum item encontrado no sistema. Verifique os SKUs.',
        skusFaltando,
      });
    }

    // Criar pedido (mesmo flow do /orders/manual)
    const terminalId  = safeTrim(req.header('x-terminal-id')) || `bling_${uuidv4().slice(0,8)}`;
    const createdAtMs = nowMs();
    const day         = yyyymmdd();
    const counterRef  = db.collection('meta').doc(`counters_${day}`);

    const result = await db.runTransaction(async tx => {
      const counterSnap = await tx.get(counterRef);
      const prev        = counterSnap.exists ? Number(counterSnap.data().seq || 0) : 0;
      const nextSeq     = prev + 1;
      const orderId     = `ORD_${day}_${padSeq(nextSeq, ORDER_SEQ_PAD)}`;
      const orderRef    = db.collection('orders').doc(orderId);

      tx.set(counterRef, { docType:'counter', day, seq:nextSeq, updatedAtMs:createdAtMs }, { merge:true });
      tx.set(orderRef, {
        docType:      'order',
        source:       'bling',
        blingPedidoId: blingPedidoId || null,
        numeroPedido:  numeroPedido || null,
        marketplace:   marketplace,
        status:        'pending',
        clienteNome:   clienteNome || '',
        isPriority:    false,
        items:         cart,
        allowConfirmOnlyIfAllChecked: true,
        createdAtMs,
        updatedAtMs:  createdAtMs,
        lockedBy:     terminalId,
        lockedAt:     createdAtMs,
        skusFaltando: skusFaltando.length ? skusFaltando : null,
      });
      return { orderId };
    });

    res.json({
      ok:          true,
      orderId:     result.orderId,
      skusFaltando,
      cartCount:   cart.length,
    });
  } catch(err) {
    console.error('[POST /bling/clonar]', err);
    next(err);
  }
});

// ── HELPER: detectar marketplace pelo campo loja/integração/número ──
function detectarMarketplace(p) {
  // NFs do Bling têm campo loja ou o nome do cliente traz o user do marketplace
  const loja  = (p.loja?.descricao || p.loja?.nome || p.canal?.nome || p.origem?.descricao || '').toLowerCase();
  const nome  = (p.contato?.nome || '').toLowerCase();
  const num   = String(p.numeroPedidoLoja || p.numeroPedido || p.numero || '');

  // Mercado Livre: usuário ML entre parênteses geralmente não tem espaço
  // ou número de pedido com 12+ dígitos
  if (loja.includes('mercado') || loja.includes('meli') || loja.includes('mlb')) return 'MERCADO_LIVRE';
  if (loja.includes('shopee')) return 'SHOPEE';

  // Fallback pelo número do pedido no marketplace
  if (num.length >= 11 && /^\d+$/.test(num)) return 'MERCADO_LIVRE'; // IDs ML são longos
  if (nome.match(/\([a-z0-9._]+\)$/)) return 'MERCADO_LIVRE'; // padrão "Nome (usuario)"

  return 'OUTROS';
}
