'use strict';

function toast(msg, type = 'info') {
  const el = document.getElementById('toast');
  el.textContent = msg; el.className = `toast show ${type}`;
  setTimeout(() => el.classList.remove('show'), 3000);
}

function formatCurrency(val) {
  return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

async function carregarDespesas() {
  try {
    const res = await fetch('/api/despesas');
    const data = await res.json();
    
    if(data.error) throw new Error(data.error);

    const itens = data.items || [];
    renderizarLista(itens);
    calcularDashboard(itens);
  } catch (err) {
    document.getElementById('listaDespesas').innerHTML = `<tr><td colspan="5">Erro: ${err.message}</td></tr>`;
  }
}

function calcularDashboard(itens) {
  let total = 0, pago = 0, pendente = 0;
  
  // Aqui futuramente você pode aplicar filtro de mês, hoje estamos somando tudo retornado
  itens.forEach(it => {
    total += it.valor;
    if (it.situacao.includes('pago')) pago += it.valor;
    if (it.situacao.includes('pendente')) pendente += it.valor;
  });

  document.getElementById('dash-total').textContent = formatCurrency(total);
  document.getElementById('dash-pago').textContent = formatCurrency(pago);
  document.getElementById('dash-pendente').textContent = formatCurrency(pendente);
}

function renderizarLista(itens) {
  const tbody = document.getElementById('listaDespesas');
  if (itens.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Nenhuma despesa encontrada</td></tr>';
    return;
  }

  tbody.innerHTML = itens.map(it => {
    const classTag = it.situacao.includes('pago') ? 'tag-pago' : 'tag-pendente';
    return `
      <tr>
        <td style="color: var(--text-secondary);">${it.data}</td>
        <td style="font-weight: bold;">${it.nome}</td>
        <td>${it.local}</td>
        <td style="font-family: monospace; font-size: 14px;">${formatCurrency(it.valor)}</td>
        <td><span class="tag-status ${classTag}">${it.situacao}</span></td>
      </tr>
    `;
  }).join('');
}

async function adicionarDespesa(e) {
  e.preventDefault();
  const btn = document.getElementById('btnSalvar');
  btn.disabled = true;
  btn.textContent = 'Salvando...';

  const bodyData = {
    data: document.getElementById('add-data').value,
    nome: document.getElementById('add-nome').value,
    valor: `R$ ${document.getElementById('add-valor').value}`, // Formata visualmente para o Sheets
    local: document.getElementById('add-local').value,
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

    toast('Despesa adicionada com sucesso!', 'ok');
    
    // Limpa apenas o nome, valor e local para facilitar a próxima inserção
    document.getElementById('add-nome').value = '';
    document.getElementById('add-valor').value = '';
    document.getElementById('add-local').value = '';
    
    
    // Recarrega a lista
    carregarDespesas();
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Salvar na Planilha';
  }
}

// Inicia
carregarDespesas();