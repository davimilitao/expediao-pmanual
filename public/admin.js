// expedicao-pro/public/admin.js
'use strict';

const API_BASE = '';
let selectedSku = null;
let searchTimer = null;

function api(path, opts = {}) {
  const finalPath = path.startsWith('/') ? path : `/${path}`;
  return fetch(finalPath, {
    ...opts,
    headers: {
      ...(opts.headers || {})
    }
  }).then(async (res) => {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  });
}

const searchInput = document.getElementById('searchInput');
const resultsBox = document.getElementById('resultsBox');
const productDetail = document.getElementById('productDetail');

searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = searchInput.value.trim();
  if (q.length < 3) {
    resultsBox.innerHTML = `<div class="mutedSmall">Digite pelo menos 3 letras...</div>`;
    return;
  }
  searchTimer = setTimeout(() => searchProducts(q), 250);
});

async function searchProducts(q) {
  try {
    const res = await api(`/admin/products/search?q=${encodeURIComponent(q)}`);
    const items = res.items || [];

    if (!items.length) {
      resultsBox.innerHTML = `<div class="mutedSmall">Nenhum resultado</div>`;
      return;
    }

    resultsBox.innerHTML = '';
    items.forEach((p) => {
      const div = document.createElement('div');
      div.className = 'adminResultItem';

      const name = escapeHtml(p.name || '');
      const sku = escapeHtml(p.sku || '');

      div.innerHTML = `<strong>${sku}</strong><br/><span class="mutedSmall">${name}</span>`;
      div.addEventListener('click', () => loadProduct(p.sku));

      resultsBox.appendChild(div);
    });
  } catch (e) {
    resultsBox.innerHTML = `<div class="mutedSmall">Erro: ${escapeHtml(e.message)}</div>`;
  }
}

async function loadProduct(sku) {
  selectedSku = sku;
  const res = await api(`/admin/products/${encodeURIComponent(sku)}`);
  renderProduct(res.item);
}

function escapeHtml(str) {
  return (str ?? '').toString().replace(/[&<>"']/g, (m) => {
    return (
      {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
      }[m] || m
    );
  });
}

function renderProduct(p) {
  const name = escapeHtml(p.name || '');
  const sku = escapeHtml(p.sku || '');
  const ean = escapeHtml(p.ean || '-');

  const customBin = escapeHtml(p.override?.customBinName || '');
  const notes = escapeHtml(p.override?.notes || '');

  const stockPhotos = Array.isArray(p.override?.stockPhotos) ? p.override.stockPhotos : [];
  const boxPhotos = Array.isArray(p.override?.boxPhotos) ? p.override.boxPhotos : [];
  const binPhoto = p.override?.binPhoto || '';

  productDetail.innerHTML = `
    <div class="adminHeader">
      <h2>${name}</h2>
      <div class="mutedSmall">
        SKU: <span class="pillSmall">${sku}</span>
        EAN: <span class="pillSmall">${ean}</span>
      </div>
    </div>

    <div class="adminSection" id="sec-bin">
      <h3>📍 Localização Estoque</h3>
      <div class="fieldRow">
        <input type="text" id="customBinInput" value="${customBin}" placeholder="Ex: Rua A - Prateleira 2" />
        <button class="btn" id="btnSaveBin">Salvar</button>
      </div>

      <div id="binPhotoBox" style="margin-top:8px;"></div>

      <div style="margin-top:10px;">
        <input type="file" id="binUpload" accept="image/*" />
        <button class="btn secondary" id="btnUploadBin">Upload Foto Local</button>
      </div>
    </div>

    <div class="adminSection" id="sec-stock">
      <h3>📦 Fotos Produto (estoque real)</h3>
      <div class="photoGrid" id="stockGrid"></div>

      <div style="margin-top:10px;">
        <input type="file" id="stockUpload" accept="image/*" />
        <button class="btn secondary" id="btnUploadStock">Upload Foto Produto</button>
      </div>
    </div>

    <div class="adminSection" id="sec-box">
      <h3>📦 Fotos Caixa</h3>
      <div class="photoGrid" id="boxGrid"></div>

      <div style="margin-top:10px;">
        <input type="file" id="boxUpload" accept="image/*" />
        <button class="btn secondary" id="btnUploadBox">Upload Foto Caixa</button>
      </div>
    </div>

    <div class="adminSection" id="sec-notes">
      <h3>📝 Observações Internas</h3>
      <div class="fieldRow">
        <textarea id="notesInput" rows="3" placeholder="Informações importantes para separação...">${notes}</textarea>
      </div>
      <button class="btn" id="btnSaveNotes">Salvar Observações</button>
    </div>
  `;

  // Render imagens (sem inline handlers)
  const stockGrid = document.getElementById('stockGrid');
  stockGrid.innerHTML = stockPhotos.length
    ? stockPhotos.map((url) => `<img src="${url}" alt="">`).join('')
    : `<div class="mutedSmall">Sem fotos de produto ainda.</div>`;

  const boxGrid = document.getElementById('boxGrid');
  boxGrid.innerHTML = boxPhotos.length
    ? boxPhotos.map((url) => `<img src="${url}" alt="">`).join('')
    : `<div class="mutedSmall">Sem fotos de caixa ainda.</div>`;

  const binPhotoBoxEl = document.getElementById('binPhotoBox');
  binPhotoBoxEl.innerHTML = binPhoto
    ? `<img src="${binPhoto}" alt="" style="width:160px;height:160px;object-fit:cover;border-radius:8px;border:1px solid #ddd;">`
    : `<div class="mutedSmall">Sem foto de localização.</div>`;

  // Bind actions (CSP-safe)
  document.getElementById('btnSaveBin').addEventListener('click', saveBin);
  document.getElementById('btnSaveNotes').addEventListener('click', saveNotes);

  document.getElementById('btnUploadBin').addEventListener('click', () => uploadImage('bin'));
  document.getElementById('btnUploadStock').addEventListener('click', () => uploadImage('stock'));
  document.getElementById('btnUploadBox').addEventListener('click', () => uploadImage('box'));
}

async function saveBin() {
  if (!selectedSku) return;
  const customBinName = document.getElementById('customBinInput').value;

  await api(`/admin/products/${encodeURIComponent(selectedSku)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customBinName })
  });

  await loadProduct(selectedSku);
}

async function saveNotes() {
  if (!selectedSku) return;
  const notes = document.getElementById('notesInput').value;

  await api(`/admin/products/${encodeURIComponent(selectedSku)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes })
  });

  await loadProduct(selectedSku);
}

async function uploadImage(kind) {
  if (!selectedSku) return;

  const inputId = kind === 'bin' ? 'binUpload' : kind === 'box' ? 'boxUpload' : 'stockUpload';
  const fileInput = document.getElementById(inputId);

  if (!fileInput.files || !fileInput.files.length) {
    alert('Selecione um arquivo primeiro.');
    return;
  }

  const formData = new FormData();
  formData.append('file', fileInput.files[0]);
  formData.append('kind', kind);

  const res = await fetch(`/admin/products/${encodeURIComponent(selectedSku)}/upload`, {
    method: 'POST',
    body: formData
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Upload falhou (${res.status})`);
  }

  // limpa input para permitir re-upload do mesmo arquivo
  fileInput.value = '';
  await loadProduct(selectedSku);
}