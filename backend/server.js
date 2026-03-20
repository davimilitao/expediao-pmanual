// expedicao-pro/backend/server.js
'use strict';

require('dotenv').config();

const { setupAuthRoutes } = require('./auth');
const fs = require('fs');
const path = require('path');

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');

const admin = require('firebase-admin');

const { google } = require('googleapis');

function safeTrim(v) {
  return (v ?? '').toString().trim();
}

const PORT = Number(process.env.PORT || 8080);
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const LOCK_TTL_MS = Number(process.env.LOCK_TTL_MS || 20000);
const ORDER_SEQ_PAD = Number(process.env.ORDER_SEQ_PAD || 4);


// --- INÍCIO DA CORREÇÃO PARA FIREBASE ---
let serviceAccount;

if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  // Tenta ler primeiro da variável de ambiente (Ambiente de Produção/Railway)
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    console.log('[INFO] Firebase inicializado via Variável de Ambiente.');
  } catch (e) {
    console.error('[ERROR] Erro ao dar parse no JSON da variável FIREBASE_SERVICE_ACCOUNT_JSON.');
    process.exit(1);
  }
} else {
  // Caso não exista a variável, procura o arquivo (Ambiente de Desenvolvimento Local)
  const SERVICE_ACCOUNT_PATH =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
    path.join(__dirname, 'keys', 'firebase-service-account.json');

  if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    console.error(
      `\n[ERROR] Firebase service account JSON não encontrado em: ${SERVICE_ACCOUNT_PATH}\n` +
      `Para rodar local, crie o arquivo. Para rodar no Railway, verifique a variável FIREBASE_SERVICE_ACCOUNT_JSON.\n`
    );
    process.exit(1);
  }
  serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
  console.log('[INFO] Firebase inicializado via arquivo local.');
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
// --- FIM DA CORREÇÃO ---

const db = admin.firestore();


const app = express();
app.disable('x-powered-by');

app.use(helmet({
  contentSecurityPolicy: false
}));
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: '6mb' }));
app.use(morgan('tiny'));
setupAuthRoutes(app, db);

// ---------------- Static (public) ----------------
const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR));
app.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.get('/manual', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'manual.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
app.get('/pedidos', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'pedidos.html')));
app.get('/login', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'login.html')));
app.get('/embalagens', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'embalagens.html')));
app.get('/importar', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'importar.html')));
app.get('/catalogo', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'catalogo.html')));
app.get('/compras', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'compras.html')));
app.get('/financas', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'financas.html')));

// ✅ uploads locais (fotos reais do estoque)
const UPLOADS_DIR = path.join(PUBLIC_DIR, 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOADS_DIR));

// ✅ fallback: placeholder 1x1 transparente se faltar arquivo
app.get('/assets/placeholder.png', (req, res) => {
  const pngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7WnKcAAAAASUVORK5CYII=';
  const buf = Buffer.from(pngBase64, 'base64');
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.status(200).send(buf);
});

// ---------------- Helpers ----------------
function nowMs() {
  return Date.now();
}

function yyyymmdd(d = new Date()) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

function padSeq(n, size) {
  return String(n).padStart(size, '0');
}

function normalizeText(v) {
  return safeTrim(v).toLowerCase();
}

function getTerminalId(req) {
  return safeTrim(req.header('x-terminal-id')) || `anon_${uuidv4().slice(0, 8)}`;
}

function assertMarketplace(v) {
  const ok = ['MERCADO_LIVRE', 'SHOPEE', 'OUTROS'];
  if (!ok.includes(v)) {
    const e = new Error(`Invalid marketplace. Use one of: ${ok.join(' | ')}`);
    e.statusCode = 400;
    throw e;
  }
}

function assertStatus(v) {
  const ok = ['pending', 'picked', 'packed'];
  if (!ok.includes(v)) {
    const e = new Error(`Invalid status. Use one of: ${ok.join(' | ')}`);
    e.statusCode = 400;
    throw e;
  }
}

function isLockActive(orderData) {
  if (!orderData.lockedAt || !orderData.lockedBy) return false;
  const age = nowMs() - Number(orderData.lockedAt);
  return age >= 0 && age <= LOCK_TTL_MS;
}

function toNameShort(name) {
  const n = safeTrim(name);
  if (n.length <= 48) return n;
  return n.slice(0, 45) + '...';
}

// merge product + override (override vence)
function mergeProduct(product, override) {
  const p = product || {};
  const o = override || {};
  return {
    ...p,
    override: o,
    // imagem “operacional” preferida
    displayImage:
      (Array.isArray(o.stockPhotos) && o.stockPhotos[0]) ||
      (Array.isArray(p.images) && p.images[0]) ||
      p.image ||
      './assets/placeholder.png',
    // bin/loc preferido
    displayBin: o.customBinName || p.bin || ''
  };
}

function okFileExt(filename) {
  const f = (filename || '').toLowerCase();
  return f.endsWith('.png') || f.endsWith('.jpg') || f.endsWith('.jpeg') || f.endsWith('.webp');
}

// ---------------- Multer (upload de imagens) ----------------
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOADS_DIR);
  },
  filename: function (req, file, cb) {
    const sku = safeTrim(req.params.sku || 'unknown').replace(/[^\w\-]/g, '_');
    const kind = safeTrim(req.body.kind || req.query.kind || 'photo').replace(/[^\w\-]/g, '_');
    const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
    const ts = nowMs();
    cb(null, `${sku}__${kind}__${ts}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 6 * 1024 * 1024 } // 6MB
});

// ---------------- Core routes (já existentes) ----------------
app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'expedicao-pro-backend', ts: nowMs() });
});

app.get('/products/search', async (req, res, next) => {
  try {
    const qRaw = safeTrim(req.query.q);
    const q = normalizeText(qRaw);
    if (!q) return res.json({ items: [] });

    const items = [];
    const seen = new Set();

    // SKU docId
    if (qRaw && qRaw.length <= 64 && !qRaw.includes(' ')) {
      const skuDoc = await db.collection('products').doc(qRaw).get();
      if (skuDoc.exists) {
        const p = skuDoc.data();
        if (!seen.has(p.sku)) {
          seen.add(p.sku);
          items.push(p);
        }
      }
    }

    // EAN exato (produto ou caixa)
    if (qRaw && qRaw.length <= 64 && !qRaw.includes(' ')) {
      const byEanSnap = await db.collection('products').where('ean', '==', qRaw).limit(10).get();
      byEanSnap.forEach((doc) => {
        const p = doc.data();
        if (!seen.has(p.sku)) {
          seen.add(p.sku);
          items.push(p);
        }
      });

      const byEanBoxSnap = await db.collection('products').where('eanBox', '==', qRaw).limit(10).get();
      byEanBoxSnap.forEach((doc) => {
        const p = doc.data();
        if (!seen.has(p.sku)) {
          seen.add(p.sku);
          items.push(p);
        }
      });
    }

    // keyword (1º token) >= 3 letras
    const token = q.split(/\s+/).filter(Boolean)[0];
    if (token && token.length >= 3) {
      const kwSnap = await db.collection('products').where('nameKeywords', 'array-contains', token).limit(20).get();
      kwSnap.forEach((doc) => {
        const p = doc.data();
        if (!seen.has(p.sku)) {
          seen.add(p.sku);
          items.push(p);
        }
      });
    }

    items.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    res.json({ items: items.slice(0, 20) });
  } catch (err) {
    console.error('[/products/search] error:', err);
    next(err);
  }
});

// ✅ /orders/list mantendo orderBy (você já criou o índice)
app.get('/orders/list', async (req, res, next) => {
  try {
    const status = safeTrim(req.query.status) || 'pending';
    assertStatus(status);
    const limit = Math.min(Number(req.query.limit || 30), 80);

    const snap = await db
      .collection('orders')
      .where('status', '==', status)
      .orderBy('createdAtMs', 'desc')
      .limit(limit)
      .get();

    const orders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // Coleta todos os SKUs unicos dos pedidos
    const allSkus = new Set();
    for (const order of orders) {
      for (const it of (order.items || [])) {
        if (it.sku) allSkus.add(it.sku);
      }
    }

    // Busca overrides em lote (uma unica query no Firestore)
    const overrideMap = new Map();
    if (allSkus.size > 0) {
      const refs = Array.from(allSkus).map(sku => db.collection('product_overrides').doc(sku));
      const overrideSnaps = await db.getAll(...refs);
      for (const s of overrideSnaps) {
        if (s.exists) overrideMap.set(s.id, s.data());
      }
    }

    // Enriquece cada item com as fotos do override
    const enriched = orders.map(order => ({
      ...order,
      items: (order.items || []).map(it => {
        const ov = overrideMap.get(it.sku) || {};
        return {
          ...it,
          // Sanitiza qty e checkedQty — garante sempre number
          // (pedidos antigos podem ter FieldValue corrompido)
          qty:        Number(it.qty        ?? 0) || 0,
          checkedQty: Number(it.checkedQty ?? 0) || 0,
          image: (Array.isArray(ov.stockPhotos) && ov.stockPhotos[0])
            || (Array.isArray(it.images) && it.images[0])
            || it.image
            || '/assets/placeholder.png',
          stockPhotos:       Array.isArray(ov.stockPhotos) ? ov.stockPhotos : [],
          boxPhotos:         Array.isArray(ov.boxPhotos)   ? ov.boxPhotos   : [],
          binPhoto:          ov.binPhoto || null,
          binPhotoUpdatedAt: ov.updatedAtMs || null,
          customBin:         ov.customBinName || it.bin || '',
          notes:             ov.notes || it.notes || '',
        };
      })
    }));

    res.json({ items: enriched });
  } catch (err) {
    console.error('[/orders/list] error:', err);
    next(err);
  }
});



app.post('/orders/manual', async (req, res, next) => {
  try {
    const terminalId = getTerminalId(req);
    const marketplace = safeTrim(req.body.marketplace);
    assertMarketplace(marketplace);

    const clienteNome = safeTrim(req.body.clienteNome);
    const isPriority = Boolean(req.body.isPriority);

    const cart = Array.isArray(req.body.cart) ? req.body.cart : [];
    if (cart.length === 0) return res.status(400).json({ error: 'cart must have at least 1 item' });

    const cartClean = cart
      .map((it) => ({ sku: safeTrim(it.sku), qty: Number(it.qty || 0) }))
      .filter((it) => it.sku && Number.isFinite(it.qty) && it.qty > 0);

    if (cartClean.length === 0) return res.status(400).json({ error: 'cart items invalid' });

    const prodRefs = cartClean.map((it) => db.collection('products').doc(it.sku));
    const prodSnaps = await db.getAll(...prodRefs);

    const prodMap = new Map();
    for (const s of prodSnaps) if (s.exists) prodMap.set(s.id, s.data());

    const items = [];
    for (const it of cartClean) {
      const p = prodMap.get(it.sku);
      if (!p) return res.status(400).json({ error: `SKU not found in products: ${it.sku}` });

      items.push({
        sku: p.sku,
        nameShort: toNameShort(p.name),
        qty: it.qty,
        ean: p.ean || '',
        eanBox: p.eanBox || '',
        bin: p.bin || '',
        image: './assets/placeholder.png',
        images: p.images || [],
        checkedQty: 0
      });
    }

    const createdAtMs = nowMs();
    const day = yyyymmdd();
    const counterRef = db.collection('meta').doc(`counters_${day}`);

    const result = await db.runTransaction(async (tx) => {
      const counterSnap = await tx.get(counterRef);
      const prev = counterSnap.exists ? Number(counterSnap.data().seq || 0) : 0;
      const nextSeq = prev + 1;
      const orderId = `ORD_${day}_${padSeq(nextSeq, ORDER_SEQ_PAD)}`;
      const orderRef = db.collection('orders').doc(orderId);

      tx.set(counterRef, { docType: 'counter', day, seq: nextSeq, updatedAtMs: createdAtMs }, { merge: true });

      tx.set(orderRef, {
        docType: 'order',
        source: 'manual',
        marketplace,
        status: 'pending',
        clienteNome: clienteNome || '',
        isPriority,
        items,
        allowConfirmOnlyIfAllChecked: true,
        createdAtMs,
        updatedAtMs: createdAtMs,
        lockedBy: terminalId,
        lockedAt: createdAtMs
      });

      return { orderId };
    });

    res.json({ ok: true, orderId: result.orderId });
  } catch (err) {
    console.error('[/orders/manual] error:', err);
    next(err);
  }
});

app.post('/orders/:id/lock', async (req, res, next) => {
  try {
    const terminalId = getTerminalId(req);
    const orderId = safeTrim(req.params.id);
    if (!orderId) return res.status(400).json({ error: 'missing order id' });

    const orderRef = db.collection('orders').doc(orderId);
    const ts = nowMs();

    const out = await db.runTransaction(async (tx) => {
      const snap = await tx.get(orderRef);
      if (!snap.exists) {
        const e = new Error('order not found');
        e.statusCode = 404;
        throw e;
      }

      const d = snap.data();
      const lockActive = isLockActive(d);

      if (lockActive && d.lockedBy !== terminalId) {
        return { ok: false, locked: true, lockedBy: d.lockedBy, lockedAt: d.lockedAt, ttlMs: LOCK_TTL_MS };
      }

      tx.set(orderRef, { lockedBy: terminalId, lockedAt: ts, updatedAtMs: ts }, { merge: true });
      return { ok: true, locked: true, lockedBy: terminalId, lockedAt: ts, ttlMs: LOCK_TTL_MS };
    });

    res.json(out);
  } catch (err) {
    console.error('[/orders/:id/lock] error:', err);
    next(err);
  }
});

app.post('/orders/:id/status', async (req, res, next) => {
  try {
    const terminalId = getTerminalId(req);
    const orderId = safeTrim(req.params.id);
    const status = safeTrim(req.body.status);
    assertStatus(status);

    const orderRef = db.collection('orders').doc(orderId);
    const ts = nowMs();

    const out = await db.runTransaction(async (tx) => {
      const snap = await tx.get(orderRef);
      if (!snap.exists) {
        const e = new Error('order not found');
        e.statusCode = 404;
        throw e;
      }

      const d = snap.data();
      const lockActive = isLockActive(d);

      if (lockActive && d.lockedBy !== terminalId) {
        return { ok: false, error: 'locked_by_other_terminal', lockedBy: d.lockedBy, lockedAt: d.lockedAt };
      }

      tx.set(orderRef, { lockedBy: terminalId, lockedAt: ts }, { merge: true });

      if (d.status === 'pending' && status === 'picked') {
        const allow = d.allowConfirmOnlyIfAllChecked !== false;
        if (allow) {
          const items = Array.isArray(d.items) ? d.items : [];
          const allOk = items.every((it) => Number(it.checkedQty || 0) >= Number(it.qty || 0));
          if (!allOk) return { ok: false, error: 'not_all_items_checked' };
        }
      }

      tx.set(orderRef, { status, updatedAtMs: ts }, { merge: true });
      return { ok: true, status };
    });

    res.json(out);
  } catch (err) {
    console.error('[/orders/:id/status] error:', err);
    next(err);
  }
});

// --- ROTA DE CONFERÊNCIA ATÓMICA ---
app.post('/orders/:id/check', async (req, res, next) => {
  try {
    const terminalId = getTerminalId(req);
    const orderId = safeTrim(req.params.id);
    const code = safeTrim(req.body.code);

    if (!orderId || !code) return res.status(400).json({ error: 'missing_params' });

    const orderRef = db.collection('orders').doc(orderId);
    const ts = nowMs();

    const out = await db.runTransaction(async (tx) => {
      const snap = await tx.get(orderRef);
      if (!snap.exists) throw new Error('order_not_found');

      const d = snap.data();
      if (isLockActive(d) && d.lockedBy !== terminalId) {
        return { ok: false, error: 'locked_by_other_terminal' };
      }

      const items = Array.isArray(d.items) ? d.items : [];
      // Procura o item por SKU, EAN ou EAN da Embalagem
      const idx = items.findIndex(it => 
        safeTrim(it.sku) === code || safeTrim(it.ean) === code || safeTrim(it.eanBox) === code
      );

      if (idx < 0) return { ok: false, error: 'item_not_found' };

      const item = items[idx];
      if (Number(item.checkedQty || 0) >= Number(item.qty || 0)) {
        return { ok: false, error: 'already_fully_checked', sku: item.sku };
      }

      // Incrementa localmente e salva o array inteiro (Firestore não suporta
      // FieldValue.increment dentro de arrays — precisa ser valor simples)
      const prevChecked = Number(item.checkedQty || 0);
      const newChecked  = prevChecked + 1;
      const itemQty     = Number(item.qty || 0);

      const newItems = items.map((it, i) =>
        i === idx ? { ...it, checkedQty: newChecked } : it
      );

      tx.set(orderRef, {
        items:       newItems,
        lockedBy:    terminalId,
        lockedAt:    ts,
        updatedAtMs: ts,
      }, { merge: true });

      return {
        ok:         true,
        sku:        item.sku,
        checkedQty: newChecked,   // sempre number
        qty:        itemQty,      // sempre number
        allChecked: newChecked >= itemQty,
      };
    });

    res.json(out);
  } catch (err) {
    console.error('[CHECK ERROR]', err);
    next(err);
  }
});

// ---------------- Admin (product overlays) ----------------
/**
 * Overlay:
 *  product_overrides/{sku} = {
 *    customBinName?: string,
 *    stockPhotos?: string[],     // URLs locais: "/uploads/..."
 *    boxPhotos?: string[],       // opcional
 *    binPhoto?: string,          // opcional
 *    notes?: string,
 *    updatedAtMs
 *  }
 */

app.get('/admin/products/search', async (req, res, next) => {
  try {
    const qRaw = safeTrim(req.query.q);
    const q = normalizeText(qRaw);
    if (!q) return res.json({ items: [] });

    // reusa o mesmo search do products, mas retorna merged com override
    const base = await (async () => {
      const items = [];
      const seen = new Set();

      if (qRaw && qRaw.length <= 64 && !qRaw.includes(' ')) {
        const skuDoc = await db.collection('products').doc(qRaw).get();
        if (skuDoc.exists) {
          const p = skuDoc.data();
          if (!seen.has(p.sku)) {
            seen.add(p.sku);
            items.push(p);
          }
        }
      }

      if (qRaw && qRaw.length <= 64 && !qRaw.includes(' ')) {
        const byEanSnap = await db.collection('products').where('ean', '==', qRaw).limit(10).get();
        byEanSnap.forEach((doc) => {
          const p = doc.data();
          if (!seen.has(p.sku)) {
            seen.add(p.sku);
            items.push(p);
          }
        });

        const byEanBoxSnap = await db.collection('products').where('eanBox', '==', qRaw).limit(10).get();
        byEanBoxSnap.forEach((doc) => {
          const p = doc.data();
          if (!seen.has(p.sku)) {
            seen.add(p.sku);
            items.push(p);
          }
        });
      }

      const token = q.split(/\s+/).filter(Boolean)[0];
      if (token && token.length >= 3) {
        const kwSnap = await db.collection('products').where('nameKeywords', 'array-contains', token).limit(25).get();
        kwSnap.forEach((doc) => {
          const p = doc.data();
          if (!seen.has(p.sku)) {
            seen.add(p.sku);
            items.push(p);
          }
        });
      }

      items.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      return items.slice(0, 25);
    })();

    const overrideRefs = base.map((p) => db.collection('product_overrides').doc(p.sku));
    const overrideSnaps = overrideRefs.length ? await db.getAll(...overrideRefs) : [];
    const overrideMap = new Map();
    for (const s of overrideSnaps) if (s.exists) overrideMap.set(s.id, s.data());

    const merged = base.map((p) => mergeProduct(p, overrideMap.get(p.sku)));
    res.json({ items: merged });
  } catch (err) {
    console.error('[/admin/products/search] error:', err);
    next(err);
  }
});

app.get('/admin/products/:sku', async (req, res, next) => {
  try {
    const sku = safeTrim(req.params.sku);
    if (!sku) return res.status(400).json({ error: 'missing sku' });

    const prodSnap = await db.collection('products').doc(sku).get();
    if (!prodSnap.exists) return res.status(404).json({ error: 'product not found' });

    const ovSnap = await db.collection('product_overrides').doc(sku).get();
    const merged = mergeProduct(prodSnap.data(), ovSnap.exists ? ovSnap.data() : null);

    res.json({ item: merged });
  } catch (err) {
    console.error('[/admin/products/:sku] error:', err);
    next(err);
  }
});

app.patch('/admin/products/:sku', async (req, res, next) => {
  try {
    const sku = safeTrim(req.params.sku);
    if (!sku) return res.status(400).json({ error: 'missing sku' });

    const patch = req.body || {};

    // allowlist de campos editáveis
    const out = {
      updatedAtMs: nowMs()
    };

    if (typeof patch.customBinName === 'string') out.customBinName = safeTrim(patch.customBinName);

    if (typeof patch.notes === 'string') out.notes = patch.notes.toString();

    if (Array.isArray(patch.stockPhotos)) {
      out.stockPhotos = patch.stockPhotos.map((x) => safeTrim(x)).filter(Boolean).slice(0, 10);
    }

    if (Array.isArray(patch.boxPhotos)) {
      out.boxPhotos = patch.boxPhotos.map((x) => safeTrim(x)).filter(Boolean).slice(0, 10);
    }

    if (typeof patch.binPhoto === 'string') out.binPhoto = safeTrim(patch.binPhoto);

    await db.collection('product_overrides').doc(sku).set(out, { merge: true });

    const prodSnap = await db.collection('products').doc(sku).get();
    const ovSnap = await db.collection('product_overrides').doc(sku).get();

    const merged = mergeProduct(prodSnap.exists ? prodSnap.data() : null, ovSnap.exists ? ovSnap.data() : null);
    res.json({ ok: true, item: merged });
  } catch (err) {
    console.error('[/admin/products/:sku PATCH] error:', err);
    next(err);
  }
});

// Upload: kind=stock (produto), kind=box (caixa), kind=bin (local)
app.post('/admin/products/:sku/upload', upload.single('file'), async (req, res, next) => {
  try {
    const sku = safeTrim(req.params.sku);
    if (!sku) return res.status(400).json({ error: 'missing sku' });

    if (!req.file) return res.status(400).json({ error: 'missing file' });
    if (!okFileExt(req.file.originalname)) return res.status(400).json({ error: 'invalid file type' });

    const kind = safeTrim(req.body.kind || req.query.kind || 'stock');
    const url = `/uploads/${req.file.filename}`;

    const ref = db.collection('product_overrides').doc(sku);
    const snap = await ref.get();
    const prev = snap.exists ? snap.data() : {};

    const patch = { updatedAtMs: nowMs() };

    if (kind === 'bin') {
      patch.binPhoto = url;
    } else if (kind === 'box') {
      const prevArr = Array.isArray(prev.boxPhotos) ? prev.boxPhotos : [];
      patch.boxPhotos = [url, ...prevArr].slice(0, 10);
    } else {
      const prevArr = Array.isArray(prev.stockPhotos) ? prev.stockPhotos : [];
      patch.stockPhotos = [url, ...prevArr].slice(0, 10);
    }

    await ref.set(patch, { merge: true });

    const prodSnap = await db.collection('products').doc(sku).get();
    const ovSnap = await db.collection('product_overrides').doc(sku).get();
    const merged = mergeProduct(prodSnap.exists ? prodSnap.data() : null, ovSnap.exists ? ovSnap.data() : null);

    res.json({ ok: true, url, item: merged });
  } catch (err) {
    console.error('[/admin/products/:sku/upload] error:', err);
    next(err);
  }
});

// ================================================================
// ROTAS DE EMBALAGENS — adicionar no server.js
//
// Coleção Firestore: "embalagens"
// Documento: {
//   name, type, unit, width, height, depth,
//   stock, stockMin, cost, skus[], notes,
//   createdAtMs, updatedAtMs
// }
// ================================================================

// GET /embalagens/list
app.get('/embalagens/list', async (req, res, next) => {
  try {
    const snap = await db.collection('embalagens').orderBy('createdAtMs', 'desc').get();
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json({ items });
  } catch (err) {
    console.error('[/embalagens/list]', err);
    next(err);
  }
});

// POST /embalagens — criar
app.post('/embalagens', async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!safeTrim(b.name)) return res.status(400).json({ error: 'name obrigatório' });

    const doc = {
      name:       safeTrim(b.name),
      type:       ['saco','caixa','envelope','outro'].includes(b.type) ? b.type : 'saco',
      unit:       b.unit === 'mm' ? 'mm' : 'cm',
      width:      Number(b.width)    || 0,
      height:     Number(b.height)   || 0,
      depth:      Number(b.depth)    || 0,
      stock:      Number(b.stock)    || 0,
      stockMin:   Number(b.stockMin) || 0,
      cost:       Number(b.cost)     || 0,
      skus:       Array.isArray(b.skus) ? b.skus.map(s => safeTrim(s)).filter(Boolean) : [],
      notes:      safeTrim(b.notes),
      createdAtMs: nowMs(),
      updatedAtMs: nowMs(),
    };

    const ref = await db.collection('embalagens').add(doc);
    res.json({ ok: true, id: ref.id, item: { id: ref.id, ...doc } });
  } catch (err) {
    console.error('[POST /embalagens]', err);
    next(err);
  }
});

// PATCH /embalagens/:id — editar
app.patch('/embalagens/:id', async (req, res, next) => {
  try {
    const id = safeTrim(req.params.id);
    if (!id) return res.status(400).json({ error: 'missing id' });

    const b = req.body || {};
    const patch = { updatedAtMs: nowMs() };

    if (b.name !== undefined)     patch.name     = safeTrim(b.name);
    if (b.type !== undefined)     patch.type     = b.type;
    if (b.unit !== undefined)     patch.unit     = b.unit;
    if (b.width !== undefined)    patch.width    = Number(b.width)    || 0;
    if (b.height !== undefined)   patch.height   = Number(b.height)   || 0;
    if (b.depth !== undefined)    patch.depth    = Number(b.depth)    || 0;
    if (b.stock !== undefined)    patch.stock    = Number(b.stock)    || 0;
    if (b.stockMin !== undefined) patch.stockMin = Number(b.stockMin) || 0;
    if (b.cost !== undefined)     patch.cost     = Number(b.cost)     || 0;
    if (Array.isArray(b.skus))    patch.skus     = b.skus.map(s => safeTrim(s)).filter(Boolean);
    if (b.notes !== undefined)    patch.notes    = safeTrim(b.notes);

    await db.collection('embalagens').doc(id).set(patch, { merge: true });
    const snap = await db.collection('embalagens').doc(id).get();
    res.json({ ok: true, item: { id, ...snap.data() } });
  } catch (err) {
    console.error('[PATCH /embalagens/:id]', err);
    next(err);
  }
});

// DELETE /embalagens/:id
app.delete('/embalagens/:id', async (req, res, next) => {
  try {
    const id = safeTrim(req.params.id);
    if (!id) return res.status(400).json({ error: 'missing id' });
    await db.collection('embalagens').doc(id).delete();
    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /embalagens/:id]', err);
    next(err);
  }
});

// POST /embalagens/:id/stock — ajustar estoque (entrada, saída, definir)
app.post('/embalagens/:id/stock', async (req, res, next) => {
  try {
    const id  = safeTrim(req.params.id);
    const op  = safeTrim(req.body.op);   // 'add' | 'sub' | 'set'
    const qty = Number(req.body.qty) || 0;
    const reason = safeTrim(req.body.reason || '');

    if (!id) return res.status(400).json({ error: 'missing id' });
    if (!['add','sub','set'].includes(op)) return res.status(400).json({ error: 'op inválida' });
    if (qty <= 0) return res.status(400).json({ error: 'qty inválida' });

    const ref  = db.collection('embalagens').doc(id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: 'embalagem não encontrada' });

    const current = Number(snap.data().stock || 0);
    let newStock;
    if (op === 'add') newStock = current + qty;
    else if (op === 'sub') newStock = Math.max(0, current - qty);
    else newStock = qty; // set

    await ref.set({
      stock: newStock,
      updatedAtMs: nowMs(),
    }, { merge: true });

    // Registra log de movimentação
    await db.collection('embalagens_log').add({
      embalagemId: id,
      op, qty, reason,
      stockBefore: current,
      stockAfter:  newStock,
      createdAtMs: nowMs(),
    });

    res.json({ ok: true, stock: newStock });
  } catch (err) {
    console.error('[POST /embalagens/:id/stock]', err);
    next(err);
  }
});

// GET /embalagens/alerts — retorna embalagens com estoque baixo (para o dashboard)
app.get('/embalagens/alerts', async (req, res, next) => {
  try {
    const snap = await db.collection('embalagens').get();
    const alerts = [];
    snap.forEach(d => {
      const e = d.data();
      const s = Number(e.stock || 0);
      const m = Number(e.stockMin || 0);
      if (m > 0 && s <= m * 1.5) {
        alerts.push({
          id: d.id,
          name: e.name,
          stock: s,
          stockMin: m,
          level: s <= m ? 'critical' : 'warn',
        });
      }
    });
    res.json({ alerts });
  } catch (err) {
    console.error('[/embalagens/alerts]', err);
    next(err);
  }
});

// ================================================================
// ROTA DE IMPORTAÇÃO VIA BROWSER
// Adicione no server.js ANTES de "// ---------------- Errors"
// E adicione a rota da página junto com as outras estáticas:
//   app.get('/importar', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'importar.html')));
// ================================================================

// POST /import/products — recebe lote de produtos do browser e grava no Firestore
app.post('/import/products', async (req, res, next) => {
  try {
    const products = Array.isArray(req.body.products) ? req.body.products : [];
    if (!products.length) return res.status(400).json({ error: 'products vazio' });
    if (products.length > 100) return res.status(400).json({ error: 'máximo 100 por lote' });

    const updatedAtMs = nowMs();
    const batch = db.batch();

    for (const p of products) {
      const sku  = safeTrim(p.sku);
      const name = safeTrim(p.name);
      if (!sku || !name) continue;
      // Rejeita SKUs com CSS/HTML do campo Descrição Complementar do Bling
      if (sku.length > 60) continue;
      if (sku.includes(' ') || sku.includes(':') || sku.includes(';') || sku.includes('<') || sku.includes('>')) continue;

      function tokenize(v) {
        return safeTrim(v).toLowerCase()
          .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g,' ').trim()
          .split(' ').filter(t => t.length >= 2)
          .filter((v,i,a) => a.indexOf(v) === i).slice(0,30);
      }

      const doc = {
        sku, name,
        bin:    safeTrim(p.bin)    || '',
        ean:    safeTrim(p.ean)    || '',
        eanBox: safeTrim(p.eanBox) || '',
        image:  './assets/placeholder.png',
        images: Array.isArray(p.images) ? p.images.filter(u => typeof u === 'string' && u.startsWith('http')) : [],
        nameKeywords: tokenize(name),
        updatedAtMs,
        situacao: safeTrim(p.situacao) || '',
        marca:    safeTrim(p.marca)    || '',
      };

      // Campos numéricos — só grava se tiver valor
      const nums = ['weight','weightBruto','width','height','depth','stock','itensPorCaixa','preco','precoCusto'];
      for (const k of nums) {
        const v = Number(p[k]);
        if (p[k] !== null && p[k] !== undefined && !isNaN(v) && v > 0) doc[k] = v;
      }

      batch.set(db.collection('products').doc(sku), doc, { merge: true });
    }

    await batch.commit();
    res.json({ ok: true, count: products.length });
  } catch (err) {
    console.error('[POST /import/products]', err);
    next(err);
  }
});

// ================================================================
// ADICIONAR NO server.js ANTES de "// ---------------- Errors"
// Rota que retorna TODOS os produtos + overrides para o catálogo
// ================================================================

// GET /products/all — retorna todos os produtos com overrides (para o catálogo)
app.get('/products/all', async (req, res, next) => {
  try {
    // Busca todos os produtos
    const snap = await db.collection('products').orderBy('name').get();
    const products = snap.docs.map(d => ({ sku: d.id, ...d.data() }));

    // Busca todos os overrides em lote
    const overrideMap = new Map();
    if (products.length > 0) {
      const refs = products.map(p => db.collection('product_overrides').doc(p.sku));
      // Firestore getAll aceita até 500 docs
      const chunks = [];
      for (let i = 0; i < refs.length; i += 500) chunks.push(refs.slice(i, i + 500));
      for (const chunk of chunks) {
        const snaps = await db.getAll(...chunk);
        for (const s of snaps) if (s.exists) overrideMap.set(s.id, s.data());
      }
    }

    // Merge produto + override
    const items = products.map(p => {
      const ov = overrideMap.get(p.sku) || {};
      return {
        ...p,
        override: ov,
        displayImage:
          (Array.isArray(ov.stockPhotos) && ov.stockPhotos[0]) ||
          (Array.isArray(p.images) && p.images[0]) ||
          p.image ||
          '/assets/placeholder.png',
        displayBin: ov.customBinName || p.bin || '',
      };
    });

    res.json({ items, total: items.length });
  } catch (err) {
    console.error('[/products/all]', err);
    next(err);
  }
});
// ================================================================
// ROTA DE PEDIDOS DE COMPRA (REPOSIÇÃO)
// ================================================================
app.post('/api/compras', async (req, res, next) => {
  try {
    const { items, notas } = req.body;
    if (!items || !items.length) return res.status(400).json({ error: 'Lista vazia' });

    const ts = Date.now();
    const day = yyyymmdd(new Date(ts));
    const compraId = `COMP_${day}_${uuidv4().slice(0, 6).toUpperCase()}`;

    // 1. Salva o pedido de compra
    await db.collection('purchase_orders').doc(compraId).set({
      id: compraId,
      items,
      notas: notas || '',
      status: 'pending',
      createdAtMs: ts
    });

    // 2. Lógica de Alerta de Embalagens
    // Busca todas as embalagens para cruzar com os SKUs da lista de compras
    const embSnap = await db.collection('embalagens').get();
    const embalagens = embSnap.docs.map(d => d.data());
    
    const alertas = new Set();
    
    items.forEach(item => {
      // Procura se alguma embalagem tem esse SKU na sua lista
      const embRelacionada = embalagens.find(e => (e.skus || []).includes(item.sku));
      if (embRelacionada) {
        alertas.add(`⚠️ O SKU ${item.sku} usa a embalagem "${embRelacionada.name}". Verifique o estoque!`);
      }
    });

    res.json({ 
      ok: true, 
      compraId, 
      alertasEmbalagem: Array.from(alertas) 
    });
  } catch (err) {
    console.error('[/api/compras] erro:', err);
    next(err);
  }
});

// ================================================================
// ROTA DE FINANÇAS (INTEGRAÇÃO GOOGLE SHEETS)
// ================================================================

// Aproveitamos a mesma credencial que você já configurou para o Firebase!
const sheetsAuth = new google.auth.GoogleAuth({
  credentials: {
    client_email: serviceAccount.client_email,
    private_key: serviceAccount.private_key,
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth: sheetsAuth });

// Pegue o ID da planilha do seu .env (é aquele código gigante na URL do Google Sheets)
const SPREADSHEET_ID = process.env.SPREADSHEET_ID; 
const SHEET_NAME = 'Despesas'; // Nome exato da aba na sua planilha

// --- Rota GET: Ler despesas da planilha ---
app.get('/api/despesas', async (req, res, next) => {
  try {
    if (!SPREADSHEET_ID) return res.status(500).json({ error: 'SPREADSHEET_ID não configurado' });

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:E`, 
    });

    const rows = response.data.values || [];
    if (rows.length <= 1) return res.json({ items: [] });

    const data = rows.slice(1).map((r, index) => {
      const dataBruta = r[0] ? String(r[0]).trim() : '';
      let nomeBruto = r[1] ? String(r[1]).trim() : '';
      let descricaoBruta = r[2] ? String(r[2]).trim() : '';
      const valorBruto = r[3] ? String(r[3]) : '0';
      const situacaoBruta = r[4] ? String(r[4]).trim().toLowerCase() : 'pendente';

      // Proteção para os registros antigos: se a Categoria(B) estiver vazia, chama de 'Outros'
      if (!nomeBruto && descricaoBruta) {
        nomeBruto = 'Outros';
      }

      // Limpeza agressiva da Moeda
      let valorLimpo = valorBruto.replace(/[R$\s]/g, '');
      if (valorLimpo.includes(',') && valorLimpo.includes('.')) {
         valorLimpo = valorLimpo.replace(/\./g, '').replace(',', '.');
      } else {
         valorLimpo = valorLimpo.replace(',', '.');
      }
      const valorNumerico = parseFloat(valorLimpo) || 0;

      let timestamp = 0;
      if (dataBruta.includes('/')) {
        const parts = dataBruta.split('/');
        if (parts.length === 3) timestamp = new Date(`${parts[2]}-${parts[1]}-${parts[0]}T12:00:00`).getTime();
      } else {
        timestamp = new Date().getTime() - (index * 10000); // Mantém ordem dos antigos
      }

      return {
        id: index,
        data: dataBruta,
        timestamp: timestamp,
        nome: nomeBruto,
        descricao: descricaoBruta,
        valor: valorNumerico,
        situacao: situacaoBruta
      };
    });

    const despesasValidas = data.filter(d => d.nome !== '' || d.descricao !== '' || d.valor > 0);
    despesasValidas.sort((a, b) => b.timestamp - a.timestamp);

    return res.json({ items: despesasValidas });
  } catch (err) {
    console.error('[/api/despesas GET]', err);
    return next(err);
  }
});

// --- Rota POST: Adicionar nova despesa ---
app.post('/api/despesas', async (req, res, next) => {
  try {
    const { data, nome, descricao, valor, situacao } = req.body;
    
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:A`, // ANCORAGEM FORÇADA NA COLUNA A
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS', // FORÇA A CRIAÇÃO DE UMA LINHA NOVA E LIMPA
      requestBody: {
        values: [[ data, nome, descricao || '', valor, situacao ]] 
      }
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('[/api/despesas POST]', err);
    next(err);
  }
});

// ---------------- Errors ----------------
app.use((err, req, res, next) => {
  const status = err.statusCode || 500;
  res.status(status).json({ error: err.message || 'internal_error', status });
});

app.listen(PORT, () => {
  console.log(`[expedicao-pro] backend listening on :${PORT}`);
  console.log(`[expedicao-pro] CORS_ORIGIN=${CORS_ORIGIN}`);
  console.log(`[expedicao-pro] LOCK_TTL_MS=${LOCK_TTL_MS}`);
  console.log(`[expedicao-pro] serving public from: ${PUBLIC_DIR}`);
  console.log(`[expedicao-pro] serving uploads from: ${UPLOADS_DIR}`);
});