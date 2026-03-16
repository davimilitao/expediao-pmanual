// expedicao-pro/backend/auth.js
// Sistema de login simples com JWT manual (sem dependência extra)
// Usuários ficam no Firestore: colecao "users"
// { username, passwordHash, role: 'admin'|'operator', active: true }

'use strict';

const crypto = require('crypto');

// ── Token simples: base64(header).base64(payload).base64(hmac) ──
// Não é JWT padrão mas funciona igual para este uso
const TOKEN_SECRET = process.env.TOKEN_SECRET || 'expedicao-pro-secret-mude-isso';
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000; // 8 horas

function signToken(payload) {
  const header  = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url');
  const body    = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig     = crypto.createHmac('sha256', TOKEN_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyToken(token) {
  try {
    const [header, body, sig] = (token || '').split('.');
    if (!header || !body || !sig) return null;
    const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(`${header}.${body}`).digest('base64url');
    if (sig !== expected) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function hashPassword(password) {
  return crypto.createHmac('sha256', TOKEN_SECRET).update(password).digest('hex');
}

// ── Middleware de autenticação ──
function requireAuth(roles = []) {
  return (req, res, next) => {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : req.cookies?.expedicao_token;

    const payload = verifyToken(token);
    if (!payload) return res.status(401).json({ error: 'não autenticado' });
    if (roles.length && !roles.includes(payload.role)) return res.status(403).json({ error: 'sem permissão' });

    req.user = payload;
    next();
  };
}

// ── Rotas de auth ──
function setupAuthRoutes(app, db) {
  // POST /auth/login
  app.post('/auth/login', async (req, res) => {
    try {
      const username = (req.body.username || '').trim().toLowerCase();
      const password = req.body.password || '';

      if (!username || !password) return res.status(400).json({ error: 'usuário e senha obrigatórios' });

      const snap = await db.collection('users').where('username', '==', username).limit(1).get();

      if (snap.empty) return res.status(401).json({ error: 'Usuário ou senha incorretos.' });

      const user = snap.docs[0].data();
      if (!user.active) return res.status(401).json({ error: 'Usuário inativo.' });

      const hash = hashPassword(password);
      if (hash !== user.passwordHash) return res.status(401).json({ error: 'Usuário ou senha incorretos.' });

      const payload = {
        uid: snap.docs[0].id,
        username: user.username,
        role: user.role || 'operator',
        exp: Date.now() + TOKEN_TTL_MS
      };

      const token = signToken(payload);
      res.json({ ok: true, token, username: user.username, role: user.role });
    } catch (e) {
      console.error('[/auth/login]', e);
      res.status(500).json({ error: 'erro interno' });
    }
  });

  // POST /auth/logout
  app.post('/auth/logout', (req, res) => {
    res.json({ ok: true });
  });

  // GET /auth/me — verifica token
  app.get('/auth/me', (req, res) => {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const payload = verifyToken(token);
    if (!payload) return res.status(401).json({ error: 'não autenticado' });
    res.json({ ok: true, username: payload.username, role: payload.role });
  });

  // POST /auth/setup — cria o primeiro usuário admin (só funciona se não houver nenhum admin)
  app.post('/auth/setup', async (req, res) => {
    try {
      const existing = await db.collection('users').where('role', '==', 'admin').limit(1).get();
      if (!existing.empty) return res.status(403).json({ error: 'setup já foi realizado' });

      const username  = (req.body.username || '').trim().toLowerCase();
      const password  = req.body.password || '';
      if (!username || password.length < 6) return res.status(400).json({ error: 'usuário e senha (mín 6 chars) obrigatórios' });

      await db.collection('users').add({
        username,
        passwordHash: hashPassword(password),
        role: 'admin',
        active: true,
        createdAtMs: Date.now()
      });

      res.json({ ok: true, message: `Admin "${username}" criado com sucesso!` });
    } catch (e) {
      console.error('[/auth/setup]', e);
      res.status(500).json({ error: 'erro interno' });
    }
  });

  // POST /auth/users — admin cria novo usuário (requer auth admin)
  app.post('/auth/users', requireAuth(['admin']), async (req, res) => {
    try {
      const username = (req.body.username || '').trim().toLowerCase();
      const password = req.body.password || '';
      const role     = ['admin', 'operator'].includes(req.body.role) ? req.body.role : 'operator';

      if (!username || password.length < 6) return res.status(400).json({ error: 'dados inválidos' });

      const exists = await db.collection('users').where('username', '==', username).limit(1).get();
      if (!exists.empty) return res.status(409).json({ error: 'usuário já existe' });

      await db.collection('users').add({
        username,
        passwordHash: hashPassword(password),
        role,
        active: true,
        createdAtMs: Date.now()
      });

      res.json({ ok: true, message: `Usuário "${username}" criado.` });
    } catch (e) {
      res.status(500).json({ error: 'erro interno' });
    }
  });

  // GET /auth/users — lista usuários (admin)
  app.get('/auth/users', requireAuth(['admin']), async (req, res) => {
    try {
      const snap = await db.collection('users').get();
      const users = snap.docs.map(d => ({
        id: d.id,
        username: d.data().username,
        role: d.data().role,
        active: d.data().active
      }));
      res.json({ users });
    } catch (e) {
      res.status(500).json({ error: 'erro interno' });
    }
  });

  // PATCH /auth/users/:id — ativa/desativa ou troca senha
  app.patch('/auth/users/:id', requireAuth(['admin']), async (req, res) => {
    try {
      const ref   = db.collection('users').doc(req.params.id);
      const patch = {};
      if (typeof req.body.active === 'boolean') patch.active = req.body.active;
      if (req.body.password && req.body.password.length >= 6) patch.passwordHash = hashPassword(req.body.password);
      await ref.set(patch, { merge: true });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: 'erro interno' });
    }
  });
}

module.exports = { setupAuthRoutes, requireAuth, verifyToken, hashPassword };
