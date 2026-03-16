// expedicao-pro/backend/scripts/import_products_csv.js
'use strict';

/**
 * Importa CSV exportado do Bling e faz upsert em:
 *  products/{sku}
 *
 * Campos importados:
 *  - sku, name, bin, ean, eanBox, images[]
 *  - weight (peso líquido kg), weightBruto (peso bruto kg)
 *  - width (largura cm), height (altura cm), depth (profundidade cm)
 *  - stock (estoque atual), itensPorCaixa
 *  - nameKeywords[] para busca full-text
 *
 * Uso:
 *  cd backend
 *  npm run import:products -- ../exports/bling_produtos.csv
 */

require('dotenv').config();

const fs   = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const admin = require('firebase-admin');

const SERVICE_ACCOUNT_PATH =
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
  path.join(__dirname, '..', 'keys', 'firebase-service-account.json');

if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  console.error(`[ERROR] Service account not found at ${SERVICE_ACCOUNT_PATH}`);
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(
    JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'))
  )
});

const db = admin.firestore();

function nowMs() { return Date.now(); }
function safeTrim(v) { return (v ?? '').toString().trim(); }
function normalizeText(v) { return safeTrim(v).toLowerCase(); }

function tokenizeName(name) {
  const n = normalizeText(name)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ').trim();
  if (!n) return [];
  const parts = n.split(' ').filter(Boolean);
  const tokens = parts.filter(t => t.length >= 2 || /^\d+$/.test(t));
  return Array.from(new Set(tokens)).slice(0, 30);
}

function pickField(row, candidates) {
  const keys = Object.keys(row);
  for (const c of candidates) {
    const cNorm = normalizeText(c).replace(/\s+/g, '');
    const found = keys.find(k => normalizeText(k).replace(/\s+/g, '') === cNorm);
    if (found) return safeTrim(row[found]);
  }
  return '';
}

// Converte "12,54" ou "12.54" para número float, retorna null se vazio/inválido
function parseNum(raw) {
  const s = safeTrim(raw).replace(',', '.');
  if (!s || s === '0' || s === '0.00') return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function parseImagesExternal(urlsRaw) {
  const raw = safeTrim(urlsRaw);
  if (!raw) return [];
  return raw.split('|')
    .map(s => safeTrim(s).replace(/\s/g, ''))
    .filter(u => /^https?:\/\//i.test(u))
    .slice(0, 10)
    .filter((v, i, a) => a.indexOf(v) === i); // dedup
}

function guessDelimiter(headerLine) {
  const counts = {
    ';': (headerLine.match(/;/g)  || []).length,
    ',': (headerLine.match(/,/g)  || []).length,
    '\t':(headerLine.match(/\t/g) || []).length,
  };
  const best = Object.entries(counts).sort((a,b)=>b[1]-a[1])[0];
  return best && best[1] > 0 ? best[0] : ';';
}

async function main() {
  const fileArg = process.argv[2];
  if (!fileArg) {
    console.error('Uso: node scripts/import_products_csv.js <arquivo.csv>');
    process.exit(1);
  }

  const csvPath = path.resolve(process.cwd(), fileArg);
  if (!fs.existsSync(csvPath)) {
    console.error(`[ERROR] CSV não encontrado: ${csvPath}`);
    process.exit(1);
  }

  const csvRaw  = fs.readFileSync(csvPath, 'utf8');
  const firstLine = csvRaw.split(/\r?\n/)[0] || '';
  const delim   = guessDelimiter(firstLine);

  console.log(`[import] arquivo  : ${csvPath}`);
  console.log(`[import] delimitador: "${delim}"`);

  const parseOpts = {
    columns: true, skip_empty_lines: true, bom: true,
    relax_column_count: true, delimiter: delim,
    quote: '"', escape: '"', relax_quotes: true, trim: true,
  };

  let records;
  try {
    records = parse(csvRaw, parseOpts);
  } catch {
    console.warn('[import] Tentando com ";"...');
    records = parse(csvRaw, { ...parseOpts, delimiter: ';' });
  }

  console.log(`[import] linhas lidas: ${records.length}`);

  // ── Mapeamento de colunas do Bling ──
  const FIELDS = {
    sku:          ['Código','Codigo','sku','SKU'],
    name:         ['Descrição','Descricao','name','Nome'],
    bin:          ['Localização','Localizacao','bin','Local'],
    ean:          ['GTIN/EAN','EAN','GTIN','Código de barras'],
    eanBox:       ['GTIN/EAN da Embalagem','EAN da Embalagem'],
    images:       ['URL Imagens Externas','URL de Imagens Externas','Imagens'],
    weight:       ['Peso líquido (Kg)','Peso liquido (Kg)','Peso Liquido','peso_liquido'],
    weightBruto:  ['Peso bruto (Kg)','Peso Bruto (Kg)','Peso Bruto'],
    width:        ['Largura do produto','Largura','largura'],
    height:       ['Altura do Produto','Altura do produto','Altura','altura'],
    depth:        ['Profundidade do produto','Profundidade','profundidade'],
    stock:        ['Estoque','estoque','Saldo em Estoque'],
    itensPorCaixa:['Itens p/ caixa','Itens por caixa','itensPorCaixa'],
    preco:        ['Preço','Preco','price'],
    precoCusto:   ['Preço de custo','Preco de custo'],
    situacao:     ['Situação','Situacao','status'],
    marca:        ['Marca','marca','brand'],
    tagsRaw:      ['Grupo de Tags/Tags','Tags','tags'],
    categoria:    ['Categoria do produto','Categoria'],
    grupo:        ['Grupo de produtos','Grupo','grupo'],
  };

  const updatedAtMs = nowMs();
  const ops = [];
  let valid = 0;
  let semDimensoes = 0;

  for (const row of records) {
    const sku  = pickField(row, FIELDS.sku);
    const name = pickField(row, FIELDS.name);
    if (!sku || !name) continue;

    valid++;

    const weight       = parseNum(pickField(row, FIELDS.weight));
    const weightBruto  = parseNum(pickField(row, FIELDS.weightBruto));
    const width        = parseNum(pickField(row, FIELDS.width));
    const height       = parseNum(pickField(row, FIELDS.height));
    const depth        = parseNum(pickField(row, FIELDS.depth));
    const stock        = parseNum(pickField(row, FIELDS.stock));
    const itensPorCaixa= parseNum(pickField(row, FIELDS.itensPorCaixa));
    const preco        = parseNum(pickField(row, FIELDS.preco));
    const precoCusto   = parseNum(pickField(row, FIELDS.precoCusto));

    if (!width && !height) semDimensoes++;

    const doc = {
      sku,
      name,
      bin:       pickField(row, FIELDS.bin)    || '',
      ean:       pickField(row, FIELDS.ean)    || '',
      eanBox:    pickField(row, FIELDS.eanBox) || '',
      image:     './assets/placeholder.png',
      images:    parseImagesExternal(pickField(row, FIELDS.images)),
      nameKeywords: tokenizeName(name),
      updatedAtMs,

      // ── Dimensões e peso (Bling) ──
      ...(weight        !== null && { weight }),
      ...(weightBruto   !== null && { weightBruto }),
      ...(width         !== null && { width }),
      ...(height        !== null && { height }),
      ...(depth         !== null && { depth }),
      ...(stock         !== null && { stock }),
      ...(itensPorCaixa !== null && { itensPorCaixa }),
      ...(preco         !== null && { preco }),
      ...(precoCusto    !== null && { precoCusto }),

      // ── Outros campos informativos ──
      situacao: pickField(row, FIELDS.situacao) || '',
      marca:    pickField(row, FIELDS.marca)    || '',
      tagsRaw:  pickField(row, FIELDS.tagsRaw)  || '',
      categoria:pickField(row, FIELDS.categoria) || '',
      grupo:    pickField(row, FIELDS.grupo)    || '',
    };

    ops.push({ sku, doc });
  }

  console.log(`[import] válidos       : ${valid}`);
  console.log(`[import] com dimensões : ${valid - semDimensoes}`);
  console.log(`[import] sem dimensões : ${semDimensoes}`);

  // ── Commit em batches de 400 ──
  const CHUNK = 400;
  let written = 0;

  for (let i = 0; i < ops.length; i += CHUNK) {
    const part  = ops.slice(i, i + CHUNK);
    const batch = db.batch();
    for (const it of part) {
      batch.set(db.collection('products').doc(it.sku), it.doc, { merge: true });
    }
    await batch.commit();
    written += part.length;
    console.log(`[import] gravados ${written}/${ops.length}`);
  }

  console.log('[import] ✅ concluído!');
  console.log('');
  console.log('Próximo passo: acesse http://localhost:8080/admin e busque um produto.');
  console.log('As dimensões agora aparecem no painel de Admin.');
}

main().catch(err => {
  console.error('[import] falhou:', err);
  process.exit(1);
});
