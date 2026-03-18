'use strict';

let todasDespesas = []; 
let filtroStatus = 'all'; 
let mesAtivo = '';        
let abasMeses = [];       

// Dicionário de meses (Isto é o que previne o "undefined")
const NOME_MES = { '01':'Janeiro', '02':'Fevereiro', '03':'Março', '04':'Abril', '05':'Maio', '06':'Junho', '07':'Julho', '08':'Agosto', '09':'Setembro', '10':'Outubro', '11':'Novembro', '12':'Dezembro' };

function toast(msg, type = 'info') {
  const el = document.getElementById('toast');
  el.textContent = msg; el.className = `toast show ${type}`;
  setTimeout(() => el.classList.remove('show'), 3000);
}

function formatCurrency(val) {
  const numero = Number(val) || 0;
  return numero.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// 1. CARREGAR DADOS DA API
async function carregarDespesas() {
  try {
    const res = await fetch('/api/despesas');
    const data = await res.json();
    if(data.error) throw new Error(data.error);

    todasDespesas = data.items || [];
    processarMeses(); 
  } catch (err) {
    document.getElementById('listaDespesas').innerHTML = `<tr><td colspan="5">Erro: ${err.message}</td></tr>`;
  }
}

// 2. PROCESSAR E CRIAR AS ABAS
function processarMeses() {
  const setMeses = new Set();
  const hoje = new Date();
  const anoAtual = hoje.getFullYear();
  const mesAtual = hoje.getMonth() + 1;

  todasDespesas.forEach(it => {
    let mesAno = 'Outros';
    
    if (it.data) {
      const partes = it.data.split('/');
      if (partes.length === 3) {
        const m = parseInt(partes[1], 10);
        const y = parseInt(partes[2], 10);
        
        // Verifica se é uma despesa do futuro
        if (y > anoAtual || (y === anoAtual && m > mesAtual)) {
          mesAno = 'Futuro';
        } else if (!isNaN(m) && !isNaN(y)) {
          // Mês atual ou passado
          mesAno = `${String(m).padStart(2, '0')}/${y}`;
        }
      }
    }
    
    it.mesAnoID = mesAno; 
    setMeses.add(mesAno);
  });

  // Ordena as abas: Futuro -> Presente -> Passado -> Outros
  abasMeses = Array.from(setMeses).sort((a, b) => {
    if (a === 'Futuro') return -1;
    if (b === 'Futuro') return 1;
    if (a === 'Outros') return 1;
    if (b === 'Outros') return -1;
    
    const [m1, y1] = a.split('/');
    const [m2, y2] = b.split('/');
    
    if (y1 !== y2) return y2 - y1;
    return m2 - m1;
  });

  // Define aba padrão
  const mesAtualStr = `${String(mesAtual).padStart(2, '0')}/${anoAtual}`;
  
  if (!mesAtivo || !abasMeses.includes(mesAtivo)) {
    if (abasMeses.includes(mesAtualStr)) {
      mesAtivo = mesAtualStr;
    } else {
      const mesesReais = abasMeses.filter(m => m !== 'Futuro' && m !== 'Outros');
      mesAtivo = mesesReais.length > 0 ? mesesReais[0] : (abasMeses.length > 0 ? abasMeses[0] : '');
    }
  }

  renderizarAbas();
  aplicarFiltros();
}

function renderizarAbas() {
  const container = document.getElementById('tabsContainer');
  if (abasMeses.length === 0) {
    container.innerHTML = `<button class="tab-btn active">Sem Lançamentos</button>`;
    return;
  }

  container.innerHTML = abasMeses.map(mesAno => {
    const isActive = (mesAno === mesAtivo) ? 'active' : '';
    let label = mesAno;
    
    if (mesAno === 'Futuro') {
      label = 'Lançamentos Futuros ⏳';
    } else if (mesAno !== 'Outros') {
      const partes = mesAno.split('/');
      if (partes.length === 2) {
        const m = partes[0];
        const y = partes[1];
        // O fallback "|| m" garante que nunca mais teremos undefined
        label = `${NOME_MES[m] || m} ${y}`; 
      }
    }
    
    return `<button class="tab-btn ${isActive}" onclick="setAba('${mesAno}')">${label}</button>`;
  }).join('');
}

function setAba(mesAno) {
  mesAtivo = mesAno;
  renderizarAbas();
  aplicarFiltros();
}

// 3. FILTROS SIMPLIFICADOS
function setFilter(status) {
  filtroStatus = status;
  document.querySelectorAll('.control-bar .filter-btn[data-filter]').forEach(b => {
    b.classList.toggle('active', b.dataset.filter === status);
  });
  aplicarFiltros();
}

function aplicarFiltros() {
  const despesasFiltradas = todasDespesas.filter(it => {
    const passStatus = filtroStatus === 'all' || it.situacao.includes(filtroStatus);
    const passMes = (it.mesAnoID === mesAtivo);
    return passStatus && passMes;
  });

  renderizarLista(despesasFiltradas);
  calcularDashboard(despesasFiltradas);
}

// 4. DASHBOARD
function calcularDashboard(itens) {
  let total = 0, pago = 0, pendente = 0;
  
  itens.forEach(it => {
    const val = Number(it.valor) || 0;
    total += val;
    if (it.situacao.includes('pago')) pago += val;
    if (it.situacao.includes('pendente')) pendente += val;
  });

  document.getElementById('dash-total').textContent = formatCurrency(total);
  document.getElementById('dash-pago').textContent = formatCurrency(pago);
  document.getElementById('dash-pendente').textContent = formatCurrency(pendente);
}

// 5. RENDERIZAÇÃO DA TABELA
function renderizarLista(itens) {
  const tbody = document.getElementById('listaDespesas');
  if (itens.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 40px; color: var(--text-secondary);">Nenhuma despesa para esta aba.</td></tr>';
    return;
  }

  tbody.innerHTML = itens.map(it => {
    const isPago = it.situacao.includes('pago');
    const classTag = isPago ? 's-pago' : 's-pendente';
    const labelStatus = isPago ? 'PAGO' : 'PENDENTE';
    
    return `
      <tr>
        <td class="td-date">${it.data}</td>
        <td class="td-cat">${it.nome}</td>
        <td class="td-desc">${it.descricao}</td>
        <td class="td-value">${formatCurrency(it.valor)}</td>
        <td><span class="status-badge ${classTag}">${labelStatus}</span></td>
      </tr>
    `;
  }).join('');
}

// 6. ADICIONAR NOVA DESPESA
async function adicionarDespesa(e) {
  e.preventDefault();
  const btn = document.getElementById('btnSalvar');
  btn.disabled = true;
  btn.textContent = 'Processando...';

  const bodyData = {
    data: document.getElementById('add-data').value,
    nome: document.getElementById('add-nome').value, 
    descricao: document.getElementById('add-descricao').value, 
    valor: document.getElementById('add-valor').value, 
    situacao: document.getElementById('add-situacao').value
  };

  try {
    const res = await fetch('/api/despesas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyData)
    });
    
    const data = await res.json();
    if (!data.ok) throw new Error('Falha ao salvar');

    toast('Despesa lançada na planilha!', 'ok');
    
    document.getElementById('add-descricao').value = '';
    document.getElementById('add-valor').value = '';
    
    carregarDespesas(); 
  } catch (err) {
    toast(`Erro: ${err.message}`, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = '+ Adicionar Despesa';
  }
}

// Inicia
carregarDespesas();