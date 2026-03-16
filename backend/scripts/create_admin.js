// expedicao-pro/backend/scripts/create_admin.js
// Rode UMA VEZ para criar o primeiro usuário admin:
//   node scripts/create_admin.js
//
// Depois use a tela /admin-usuarios para gerenciar os demais.

'use strict';

require('dotenv').config();
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');
const admin   = require('firebase-admin');
const readline = require('readline');

const SERVICE_ACCOUNT_PATH =
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
  path.join(__dirname, '..', 'keys', 'firebase-service-account.json');

if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  console.error('Firebase service account não encontrado em:', SERVICE_ACCOUNT_PATH);
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'))) });
const db = admin.firestore();

const TOKEN_SECRET = process.env.TOKEN_SECRET || 'expedicao-pro-secret-mude-isso';

function hashPassword(password) {
  return crypto.createHmac('sha256', TOKEN_SECRET).update(password).digest('hex');
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function ask(q) { return new Promise(r => rl.question(q, r)); }

async function main() {
  console.log('\n🚀 Expedição Pro — Criar usuário admin\n');

  // Verifica se já existe admin
  const existing = await db.collection('users').where('role', '==', 'admin').limit(1).get();
  if (!existing.empty) {
    console.log('⚠️  Já existe um usuário admin:', existing.docs[0].data().username);
    const continuar = await ask('Deseja criar outro admin mesmo assim? (s/N): ');
    if (continuar.toLowerCase() !== 's') { rl.close(); process.exit(0); }
  }

  const username = (await ask('Nome de usuário (ex: admin): ')).trim().toLowerCase();
  if (!username) { console.log('Usuário inválido.'); rl.close(); process.exit(1); }

  const password = (await ask('Senha (mín 6 caracteres): ')).trim();
  if (password.length < 6) { console.log('Senha muito curta.'); rl.close(); process.exit(1); }

  const role = (await ask('Nível (admin/operator) [admin]: ')).trim().toLowerCase() || 'admin';

  await db.collection('users').add({
    username,
    passwordHash: hashPassword(password),
    role: ['admin','operator'].includes(role) ? role : 'admin',
    active: true,
    createdAtMs: Date.now()
  });

  console.log(`\n✅ Usuário "${username}" (${role}) criado com sucesso!`);
  console.log('Agora acesse: http://localhost:8080/login\n');
  rl.close();
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
