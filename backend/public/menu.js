// menu.js — Expedição Pro v2.0
// Tooltip rico no hover collapsed | Mobile drawer | Temas por perfil
'use strict';

(function () {

  // ══════════════════════════════════════════════════════
  // DEFINIÇÃO DE MÓDULOS
  // Cada módulo tem: id, label, icon, href, section, roles
  // roles define quais perfis têm acesso por padrão
  // ══════════════════════════════════════════════════════
  const ALL_MODULES = [
    // OPERAÇÃO
    { id: 'pedidos',   label: 'Pedidos do Dia',  icon: '📦', href: '/pedidos',   section: 'Operação',  roles: ['operacao','admin'] },
    { id: 'manual',    label: 'Criar Pedido',    icon: '✏️',  href: '/manual',    section: 'Operação',  roles: ['operacao','admin'] },
    { id: 'bling',     label: 'Pedidos Bling',   icon: '⬡',  href: '/bling',     section: 'Operação',  roles: ['operacao','admin'] },
    // CATÁLOGO
    { id: 'admin',     label: 'Produtos Admin',  icon: '🖼️',  href: '/admin',     section: 'Catálogo',  roles: ['catalogo','admin'] },
    { id: 'catalogo',  label: 'Catálogo',        icon: '📋',  href: '/catalogo',  section: 'Catálogo',  roles: ['catalogo','vendas','admin'] },
    { id: 'embalagens',label: 'Embalagens',      icon: '🎁',  href: '/embalagens',section: 'Catálogo',  roles: ['catalogo','operacao','admin'] },
    // GESTÃO
    { id: 'financas',  label: 'Finanças',        icon: '💰',  href: '/financas',  section: 'Gestão',    roles: ['financeiro','admin'] },
    { id: 'compras',   label: 'Compras',         icon: '🛒',  href: '/compras',   section: 'Gestão',    roles: ['catalogo','financeiro','admin'] },
    { id: 'importar',  label: 'Importar CSV',    icon: '⬆️',  href: '/importar',  section: 'Gestão',    roles: ['admin'] },
    // SISTEMA
    { id: 'index',     label: 'Painel Geral',    icon: '⚡',  href: '/',          section: 'Sistema',   roles: ['operacao','financeiro','catalogo','vendas','admin'] },
    { id: 'config',    label: 'Configurações',   icon: '⚙️',  href: '/config',    section: 'Sistema',   roles: ['admin'] },
  ];

  // Temas disponíveis
  const THEMES = {
    dark:  { label: 'Dark Navy',         icon: '🌙' },
    light: { label: 'Light Profissional',icon: '☀️' },
    hc:    { label: 'Alto Contraste',    icon: '🔆' },
    ml:    { label: 'Tema ML',           icon: '⬡'  },
  };

  // Perfis padrão (fallback se Firestore não tiver nada)
  const DEFAULT_PROFILES = {
    admin:      { label: 'Super Admin', name: 'Davi',    avatar: 'DA', tema: 'dark'  },
    operacao:   { label: 'Operação',    name: 'Sueli',   avatar: 'SU', tema: 'dark'  },
    financeiro: { label: 'Financeiro',  name: 'Jéssica', avatar: 'JE', tema: 'dark'  },
    catalogo:   { label: 'Catálogo',    name: 'Daniel',  avatar: 'DN', tema: 'dark'  },
    vendas:     { label: 'Vendas',      name: 'Vendas',  avatar: 'VE', tema: 'light' },
  };

  // ══════════════════════════════════════════════════════
  // ESTADO
  // ══════════════════════════════════════════════════════
  const SK_COLLAPSED = 'erp_sidebar_collapsed';
  const SK_ASSUMED   = 'erp_assumed_profile';
  const SK_THEME     = 'erp_theme';

  function getRealRole() {
    try { return JSON.parse(localStorage.getItem('expedicao_user') || '{}').role || 'admin'; }
    catch { return 'admin'; }
  }

  function getRole() {
    return sessionStorage.getItem(SK_ASSUMED) || getRealRole();
  }

  function getCurrentPage() {
    const p = window.location.pathname;
    if (p === '/' || p === '/index.html') return 'index';
    return p.replace(/^\//, '').replace(/\.html$/, '');
  }

  // ══════════════════════════════════════════════════════
  // TEMA
  // ══════════════════════════════════════════════════════
  function applyTheme(theme) {
    const valid = Object.keys(THEMES);
    const t = valid.includes(theme) ? theme : 'dark';
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem(SK_THEME, t);
  }

  function loadTheme() {
    // Prioridade: localStorage (override manual) > padrão do perfil
    const saved = localStorage.getItem(SK_THEME);
    if (saved) { applyTheme(saved); return; }
    const role    = getRole();
    const profile = DEFAULT_PROFILES[role] || DEFAULT_PROFILES.admin;
    applyTheme(profile.tema || 'dark');
  }

  // ══════════════════════════════════════════════════════
  // MÓDULOS VISÍVEIS PARA O ROLE
  // Respeita customizações do Firestore se disponíveis
  // ══════════════════════════════════════════════════════
  function getVisibleModules(role, customModules) {
    if (customModules && Array.isArray(customModules)) {
      // Retorna módulos na ordem definida na configuração
      return ALL_MODULES.filter(m => customModules.includes(m.id));
    }
    return ALL_MODULES.filter(m => m.roles.includes(role));
  }

  // ══════════════════════════════════════════════════════
  // BUILD SIDEBAR
  // ══════════════════════════════════════════════════════
  function buildSidebar(customModules) {
    const role      = getRole();
    const realRole  = getRealRole();
    const assumed   = sessionStorage.getItem(SK_ASSUMED);
    const profile   = DEFAULT_PROFILES[role] || DEFAULT_PROFILES.admin;
    const page      = getCurrentPage();
    const collapsed = localStorage.getItem(SK_COLLAPSED) === 'true';

    const visibleModules = getVisibleModules(role, customModules);

    // Agrupar por seção
    const sections = {};
    for (const m of visibleModules) {
      if (!sections[m.section]) sections[m.section] = [];
      sections[m.section].push(m);
    }

    // Build nav HTML
    let navHtml = '';
    const sectionKeys = Object.keys(sections);
    for (let si = 0; si < sectionKeys.length; si++) {
      const sec   = sectionKeys[si];
      const items = sections[sec];

      navHtml += `<div class="nav-section-label">${sec}</div>`;

      for (const item of items) {
        const active = page === item.id;
        // Tooltip rico: ícone + label + seção
        const tooltipHtml = `
          <span class="nav-tooltip">
            <span class="nav-tooltip-icon">${item.icon}</span>
            <span>
              <span class="nav-tooltip-label">${item.label}</span>
              <span class="nav-tooltip-section">${item.section}</span>
            </span>
          </span>`;

        navHtml += `
          <a href="${item.href}"
             class="nav-item${active ? ' active' : ''}"
             aria-label="${item.label}"
             aria-current="${active ? 'page' : 'false'}">
            <span class="nav-item-icon" aria-hidden="true">${item.icon}</span>
            <span class="nav-item-label">${item.label}</span>
            ${tooltipHtml}
          </a>`;
      }

      // Divisor entre seções (exceto última)
      if (si < sectionKeys.length - 1) {
        navHtml += '<div class="nav-divider" role="separator"></div>';
      }
    }

    // Assume profile (só admin real)
    let assumeHtml = '';
    if (realRole === 'admin') {
      assumeHtml = `
        <div class="assume-profile">
          <select id="assumeProfileSelect" aria-label="Assumir perfil de usuário">
            <option value="">👁️ Assumir Perfil</option>
            <option value="operacao"   ${assumed==='operacao'   ?'selected':''}>👷 Sueli — Operação</option>
            <option value="financeiro" ${assumed==='financeiro' ?'selected':''}>💼 Jéssica — Financeiro</option>
            <option value="catalogo"   ${assumed==='catalogo'   ?'selected':''}>📦 Daniel — Catálogo</option>
          </select>
        </div>`;
    }

    return `
      <aside class="erp-sidebar${collapsed ? ' collapsed' : ''}"
             id="erp-sidebar"
             role="navigation"
             aria-label="Menu principal">

        <div class="sidebar-brand" aria-label="Expedição Pro">
          <div class="sidebar-brand-icon" aria-hidden="true">E</div>
          <div class="sidebar-brand-text">
            <div class="sidebar-brand-name">Expedição Pro</div>
            <div class="sidebar-brand-sub">Universo Compra Certa</div>
          </div>
        </div>

        <button class="sidebar-toggle"
                id="sidebarToggle"
                aria-label="${collapsed ? 'Expandir menu' : 'Recolher menu'}"
                title="${collapsed ? 'Expandir menu' : 'Recolher menu'}">
          ${collapsed ? '›' : '‹'}
        </button>

        <nav class="sidebar-nav" aria-label="Módulos">
          ${navHtml}
        </nav>

        <div class="sidebar-user">
          <div class="sidebar-user-card" id="userCardBtn"
               title="Clique direito para sair"
               role="button" tabindex="0">
            <div class="user-avatar" aria-hidden="true">${profile.avatar}</div>
            <div class="user-info">
              <div class="user-name">${profile.name}</div>
              <div class="user-role">${assumed ? '👁️ ' : ''}${profile.label}</div>
            </div>
          </div>
          ${assumeHtml}
        </div>

      </aside>
      <div class="sidebar-overlay" id="sidebarOverlay" role="presentation"></div>`;
  }

  // ══════════════════════════════════════════════════════
  // MOBILE TOPBAR
  // ══════════════════════════════════════════════════════
  function injectMobileTopbar() {
    if (document.querySelector('.mobile-topbar')) return;

    const page   = getCurrentPage();
    const module = ALL_MODULES.find(i => i.id === page);
    const title  = module ? `${module.icon} ${module.label}` : '⚡ Expedição Pro';

    const topbar = document.createElement('div');
    topbar.className   = 'mobile-topbar';
    topbar.setAttribute('role', 'banner');
    topbar.innerHTML = `
      <button class="mobile-menu-btn" id="mobileMenuBtn" aria-label="Abrir menu" aria-expanded="false">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <line x1="2" y1="4" x2="16" y2="4"/>
          <line x1="2" y1="9" x2="16" y2="9"/>
          <line x1="2" y1="14" x2="16" y2="14"/>
        </svg>
      </button>
      <span class="mobile-topbar-brand">${title}</span>`;

    const main = document.querySelector('.erp-main');
    if (main) main.parentNode.insertBefore(topbar, main);
  }

  // ══════════════════════════════════════════════════════
  // EVENTOS
  // ══════════════════════════════════════════════════════
  function bindEvents() {
    const sidebar = document.getElementById('erp-sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const toggle  = document.getElementById('sidebarToggle');

    // ── Desktop: toggle collapsed ──────────────────────
    if (toggle && sidebar) {
      toggle.addEventListener('click', () => {
        const c = sidebar.classList.toggle('collapsed');
        toggle.textContent = c ? '›' : '‹';
        toggle.setAttribute('aria-label', c ? 'Expandir menu' : 'Recolher menu');
        localStorage.setItem(SK_COLLAPSED, c);
      });
    }

    // ── Desktop: tooltip position fix ─────────────────
    // O tooltip usa position:fixed mas precisa da posição real do item
    if (sidebar) {
      sidebar.addEventListener('mouseover', e => {
        const item = e.target.closest('.nav-item');
        if (!item || !sidebar.classList.contains('collapsed')) return;
        const tooltip = item.querySelector('.nav-tooltip');
        if (!tooltip) return;
        const rect = item.getBoundingClientRect();
        tooltip.style.top  = `${rect.top + rect.height / 2}px`;
      });
    }

    // ── Mobile: abrir/fechar drawer ───────────────────
    function openMobile() {
      sidebar?.classList.add('mobile-open');
      overlay?.classList.add('show');
      const btn = document.getElementById('mobileMenuBtn');
      btn?.setAttribute('aria-expanded', 'true');
      document.body.style.overflow = 'hidden'; // evita scroll do fundo
    }
    function closeMobile() {
      sidebar?.classList.remove('mobile-open');
      overlay?.classList.remove('show');
      const btn = document.getElementById('mobileMenuBtn');
      btn?.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
    }

    document.addEventListener('click', e => {
      const mBtn = document.getElementById('mobileMenuBtn');
      if (mBtn && (e.target === mBtn || mBtn.contains(e.target))) {
        sidebar?.classList.contains('mobile-open') ? closeMobile() : openMobile();
        return;
      }
      if (e.target === overlay) closeMobile();
    });

    // Swipe para fechar no mobile
    let touchStartX = 0;
    sidebar?.addEventListener('touchstart', e => {
      touchStartX = e.touches[0].clientX;
    }, { passive: true });
    sidebar?.addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - touchStartX;
      if (dx < -60) closeMobile(); // swipe left
    }, { passive: true });

    // ESC fecha mobile
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeMobile();
    });

    // Fecha ao navegar (links do menu no mobile)
    sidebar?.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        if (window.innerWidth <= 768) closeMobile();
      });
    });

    // ── Assume profile ─────────────────────────────────
    const sel = document.getElementById('assumeProfileSelect');
    if (sel) {
      sel.addEventListener('change', e => {
        const val = e.target.value;
        if (val) sessionStorage.setItem(SK_ASSUMED, val);
        else     sessionStorage.removeItem(SK_ASSUMED);
        localStorage.removeItem(SK_THEME); // reset tema ao mudar perfil
        window.location.reload();
      });
    }

    // ── Logout (clique direito no avatar) ─────────────
    const card = document.getElementById('userCardBtn');
    if (card) {
      card.addEventListener('contextmenu', e => {
        e.preventDefault();
        if (confirm('Sair do sistema?')) {
          localStorage.removeItem('expedicao_token');
          localStorage.removeItem('expedicao_user');
          localStorage.removeItem(SK_THEME);
          sessionStorage.removeItem(SK_ASSUMED);
          window.location.href = '/login';
        }
      });
      // Também sair com clique longo no mobile
      let longPressTimer;
      card.addEventListener('touchstart', () => {
        longPressTimer = setTimeout(() => {
          if (confirm('Sair do sistema?')) {
            localStorage.removeItem('expedicao_token');
            localStorage.removeItem('expedicao_user');
            window.location.href = '/login';
          }
        }, 800);
      }, { passive: true });
      card.addEventListener('touchend', () => clearTimeout(longPressTimer), { passive: true });
    }
  }

  // ══════════════════════════════════════════════════════
  // INJECT
  // ══════════════════════════════════════════════════════
  async function inject() {
    const placeholder = document.getElementById('sidebar-placeholder');
    if (!placeholder) return;

    // Aplica tema antes de renderizar (evita flash)
    loadTheme();

    // Tenta carregar módulos customizados do Firestore
    let customModules = null;
    try {
      const role  = getRole();
      const token = localStorage.getItem('expedicao_token') || '';
      const res   = await fetch(`/api/perfis/${role}`, {
        headers: { authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.modulos?.length) customModules = data.modulos;
        // Tema do perfil no Firestore tem prioridade se não houver override manual
        if (data?.tema && !localStorage.getItem(SK_THEME)) {
          applyTheme(data.tema);
        }
      }
    } catch {
      // Sem Firestore customizado — usa padrão
    }

    placeholder.outerHTML = buildSidebar(customModules);
    bindEvents();
    injectMobileTopbar();
  }

  // ══════════════════════════════════════════════════════
  // API PÚBLICA (usada por outras telas)
  // ══════════════════════════════════════════════════════
  window.ERPMenu = {
    applyTheme,
    getRole,
    getRealRole,
    THEMES,
    ALL_MODULES,
  };

  // ── INIT ──────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }

})();
