// menu.js — Expedição Pro / Universo Compra Certa
// Injeta sidebar no #sidebar-placeholder — NÃO modifica body.innerHTML
'use strict';

(function () {

  // ── MÓDULOS ─────────────────────────────────────────────
  const MODULES = [
    {
      section: 'Operação',
      items: [
        { id: 'pedidos', label: 'Pedidos do Dia', icon: '📦', href: '/pedidos',   roles: ['operacao','admin'] },
        { id: 'manual',  label: 'Criar Pedido',   icon: '✏️',  href: '/manual',    roles: ['operacao','admin'] },
      ]
    },
    {
      section: 'Catálogo',
      items: [
        { id: 'admin',      label: 'Produtos Admin', icon: '🖼️',  href: '/admin',      roles: ['catalogo','admin'] },
        { id: 'catalogo',   label: 'Catálogo',       icon: '📋',  href: '/catalogo',   roles: ['catalogo','vendas','admin'] },
        { id: 'embalagens', label: 'Embalagens',     icon: '🎁',  href: '/embalagens', roles: ['catalogo','operacao','admin'] },
      ]
    },
    {
      section: 'Gestão',
      items: [
        { id: 'financas', label: 'Finanças',     icon: '💰', href: '/financas', roles: ['financeiro','admin'] },
        { id: 'importar', label: 'Importar CSV', icon: '⬆️', href: '/importar', roles: ['admin'] },
      ]
    },
    {
      section: 'Sistema',
      items: [
        { id: 'index', label: 'Painel Geral', icon: '⚡', href: '/', roles: ['operacao','financeiro','catalogo','vendas','admin'] },
      ]
    }
  ];

  const PROFILES = {
    admin:      { label: 'Super Admin', name: 'Davi',    avatar: 'DA' },
    operacao:   { label: 'Operação',    name: 'Sueli',   avatar: 'SU' },
    financeiro: { label: 'Financeiro',  name: 'Jéssica', avatar: 'JE' },
    catalogo:   { label: 'Catálogo',    name: 'Daniel',  avatar: 'DN' },
    vendas:     { label: 'Vendas',      name: 'Vendas',  avatar: 'VE' },
  };

  // ── ESTADO ───────────────────────────────────────────────
  const SK_COLLAPSED = 'erp_sidebar_collapsed';
  const SK_ASSUMED   = 'erp_assumed_profile';

  function getRealRole() {
    try { return JSON.parse(localStorage.getItem('expedicao_user') || '{}').role || 'admin'; }
    catch { return 'admin'; }
  }

  function getRole() {
    const assumed = sessionStorage.getItem(SK_ASSUMED);
    return assumed || getRealRole();
  }

  function getCurrentPage() {
    const p = window.location.pathname;
    if (p === '/' || p === '/index.html') return 'index';
    return p.replace(/^\//, '').replace(/\.html$/, '');
  }

  // ── BUILD SIDEBAR HTML ───────────────────────────────────
  function buildSidebar() {
    const role      = getRole();
    const realRole  = getRealRole();
    const assumed   = sessionStorage.getItem(SK_ASSUMED);
    const profile   = PROFILES[role] || PROFILES.admin;
    const page      = getCurrentPage();
    const collapsed = localStorage.getItem(SK_COLLAPSED) === 'true';

    // Nav items
    let navHtml = '';
    for (const group of MODULES) {
      const visible = group.items.filter(item => item.roles.includes(role));
      if (!visible.length) continue;
      navHtml += `<div class="nav-section-label">${group.section}</div>`;
      for (const item of visible) {
        const active = page === item.id;
        navHtml += `
          <a href="${item.href}" class="nav-item${active ? ' active' : ''}" data-tooltip="${item.label}">
            <span class="nav-item-icon">${item.icon}</span>
            <span class="nav-item-label">${item.label}</span>
          </a>`;
      }
      navHtml += '<div class="nav-divider"></div>';
    }

    // Assume profile — só admin real vê
    let assumeHtml = '';
    if (realRole === 'admin') {
      assumeHtml = `
        <div class="assume-profile">
          <select id="assumeProfileSelect">
            <option value="">👁️ Assumir Perfil</option>
            <option value="operacao"   ${assumed==='operacao'   ?'selected':''}>👷 Sueli — Operação</option>
            <option value="financeiro" ${assumed==='financeiro' ?'selected':''}>💼 Jéssica — Financeiro</option>
            <option value="catalogo"   ${assumed==='catalogo'   ?'selected':''}>📦 Daniel — Catálogo</option>
          </select>
        </div>`;
    }

    return `
      <aside class="erp-sidebar${collapsed ? ' collapsed' : ''}" id="erp-sidebar">
        <div class="sidebar-brand">
          <div class="sidebar-brand-icon">E</div>
          <div class="sidebar-brand-text">
            <div class="sidebar-brand-name">Expedição Pro</div>
            <div class="sidebar-brand-sub">Universo Compra Certa</div>
          </div>
        </div>
        <button class="sidebar-toggle" id="sidebarToggle">${collapsed ? '›' : '‹'}</button>
        <nav class="sidebar-nav">${navHtml}</nav>
        <div class="sidebar-user">
          <div class="sidebar-user-card" id="userCardBtn">
            <div class="user-avatar">${profile.avatar}</div>
            <div class="user-info">
              <div class="user-name">${profile.name}</div>
              <div class="user-role">${assumed ? '👁️ ' : ''}${profile.label}</div>
            </div>
          </div>
          ${assumeHtml}
        </div>
      </aside>
      <div class="sidebar-overlay" id="sidebarOverlay"></div>`;
  }

  // ── INJECT ───────────────────────────────────────────────
  function inject() {
    const placeholder = document.getElementById('sidebar-placeholder');
    if (!placeholder) return; // Segurança: se não tem placeholder, não faz nada

    placeholder.outerHTML = buildSidebar();
    bindEvents();
    injectMobileTopbar();
  }

  function injectMobileTopbar() {
    // Injeta topbar mobile apenas se não existir
    if (document.querySelector('.mobile-topbar')) return;
    const page = getCurrentPage();
    const module = MODULES.flatMap(g => g.items).find(i => i.id === page);
    const title = module ? `${module.icon} ${module.label}` : '⚡ Expedição Pro';
    const topbar = document.createElement('div');
    topbar.className = 'mobile-topbar';
    topbar.innerHTML = `
      <button class="mobile-menu-btn" id="mobileMenuBtn">☰</button>
      <span class="mobile-topbar-brand">${title}</span>`;
    // Insere antes do .erp-main
    const main = document.querySelector('.erp-main');
    if (main) main.parentNode.insertBefore(topbar, main);
  }

  // ── EVENTS ───────────────────────────────────────────────
  function bindEvents() {
    const sidebar = document.getElementById('erp-sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const toggle  = document.getElementById('sidebarToggle');

    // Desktop toggle
    if (toggle && sidebar) {
      toggle.addEventListener('click', () => {
        const c = sidebar.classList.toggle('collapsed');
        toggle.textContent = c ? '›' : '‹';
        localStorage.setItem('erp_sidebar_collapsed', c);
      });
    }

    // Mobile
    document.addEventListener('click', e => {
      const mBtn = document.getElementById('mobileMenuBtn');
      if (e.target === mBtn) {
        sidebar?.classList.toggle('mobile-open');
        overlay?.classList.toggle('show');
      }
      if (e.target === overlay) {
        sidebar?.classList.remove('mobile-open');
        overlay?.classList.remove('show');
      }
    });

    // Assume profile
    const sel = document.getElementById('assumeProfileSelect');
    if (sel) {
      sel.addEventListener('change', e => {
        const val = e.target.value;
        if (val) sessionStorage.setItem('erp_assumed_profile', val);
        else     sessionStorage.removeItem('erp_assumed_profile');
        window.location.reload();
      });
    }

    // Logout (clique direito no avatar)
    const card = document.getElementById('userCardBtn');
    if (card) {
      card.addEventListener('contextmenu', e => {
        e.preventDefault();
        if (confirm('Sair do sistema?')) {
          localStorage.removeItem('expedicao_token');
          localStorage.removeItem('expedicao_user');
          sessionStorage.removeItem('erp_assumed_profile');
          window.location.href = '/login';
        }
      });
    }
  }

  // ── INIT ─────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }

})();
