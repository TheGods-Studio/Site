const dashboardStats = [
  { label: 'Usuários', value: 4126 },
  { label: 'Ativos', value: 3712 },
  { label: 'Banidos', value: 138 },
  { label: 'Denúncias', value: 94 },
  { label: 'Pagamentos', value: 365 },
  { label: 'Novos 7d', value: 191 },
];

const users = [
  { id: 'usr-1001', name: 'luismetzker', email: 'luismetzker9@gmail.com', status: 'active', role: 'Master', created: '2026-01-15' },
  { id: 'usr-1002', name: 'nina', email: 'nina@thegods.studio', status: 'active', role: 'Admin', created: '2026-02-02' },
  { id: 'usr-1003', name: 'veigar', email: 'veigar@site.com', status: 'banned', role: 'Cliente', created: '2026-04-18' },
  { id: 'usr-1004', name: 'ayra', email: 'ayra@site.com', status: 'active', role: 'Funcionário', created: '2026-06-13' },
  { id: 'usr-1005', name: 'bruno', email: 'bruno@site.com', status: 'active', role: 'Cliente', created: '2026-06-25' },
];

const reports = [
  { id: 'rep-2101', reporter: 'nina', target: 'veigar', category: 'Ameaças', status: 'open', priority: 'Alta', created: '2026-08-10' },
  { id: 'rep-2102', reporter: 'ayra', target: 'bruno', category: 'Comportamento inadequado', status: 'analyzing', priority: 'Média', created: '2026-08-11' },
  { id: 'rep-2103', reporter: 'luismetzker', target: 'mira', category: 'Fraude', status: 'resolved', priority: 'Alta', created: '2026-08-12' },
];

const bans = [
  { id: 'ban-4001', user: 'veigar', reason: 'Ameaça e abuso', type: 'Permanente', status: 'active', start: '2026-08-07', end: 'Permanente' },
  { id: 'ban-4002', user: 'xavier', reason: 'Spam', type: 'Temporário', status: 'expired', start: '2026-07-25', end: '2026-08-02' },
];

const admins = [
  { id: 'adm-1', name: 'luismetzker', email: 'luismetzker9@gmail.com', role: 'Master' },
  { id: 'adm-2', name: 'nina', email: 'nina@thegods.studio', role: 'Admin' },
  { id: 'adm-3', name: 'ayra', email: 'ayra@site.com', role: 'Funcionário' },
];

function renderDashboard() {
  const statsGrid = document.getElementById('stats-grid');
  if (!statsGrid) return;
  statsGrid.innerHTML = dashboardStats.map((item) => `
    <div class="stat-box">
      <span class="stat-number">${item.value}</span>
      <span class="stat-label">${item.label}</span>
    </div>
  `).join('');
}

function renderTableRows(selector, items, type) {
  const el = document.querySelector(selector);
  if (!el) return;
  if (!items.length) {
    el.innerHTML = '<tr><td colspan="999" class="empty">Nenhum dado encontrado.</td></tr>';
    return;
  }

  if (type === 'users') {
    el.innerHTML = items.map((u) => `
      <tr>
        <td>${u.id}</td>
        <td>${u.name}</td>
        <td>${u.email}</td>
        <td><span class="badge ${u.status === 'active' ? 'status-active' : 'status-banned'}">${u.status === 'active' ? 'Ativo' : 'Banido'}</span></td>
        <td>${u.role}</td>
        <td>${u.created}</td>
        <td>
          <div class="inline-actions">
            <button class="btn" data-action="view-user" data-id="${u.id}">Ver</button>
            <button class="btn danger" data-action="ban-user" data-id="${u.id}">Banir</button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  if (type === 'reports') {
    el.innerHTML = items.map((r) => `
      <tr>
        <td>${r.id}</td>
        <td>${r.reporter}</td>
        <td>${r.target}</td>
        <td>${r.category}</td>
        <td><span class="badge status-${r.status}">${r.status}</span></td>
        <td>${r.priority}</td>
        <td>${r.created}</td>
        <td>
          <div class="inline-actions">
            <button class="btn" data-action="view-report" data-id="${r.id}">Detalhes</button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  if (type === 'bans') {
    el.innerHTML = items.map((b) => `
      <tr>
        <td>${b.id}</td>
        <td>${b.user}</td>
        <td>${b.reason}</td>
        <td>${b.type}</td>
        <td>${b.start}</td>
        <td>${b.end}</td>
        <td>${b.status}</td>
        <td>
          <div class="inline-actions">
            <button class="btn danger" data-action="remove-ban" data-id="${b.id}">Remover</button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  if (type === 'admins') {
    el.innerHTML = items.map((a) => `
      <tr>
        <td>${a.id}</td>
        <td>${a.name}</td>
        <td>${a.email}</td>
        <td>${a.role}</td>
        <td>
          <div class="inline-actions">
            <button class="btn" data-action="view-admin" data-id="${a.id}">Ver</button>
            <button class="btn danger" data-action="remove-admin" data-id="${a.id}">Remover</button>
          </div>
        </td>
      </tr>
    `).join('');
  }
}

function bindTableActions() {
  document.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const id = btn.dataset.id;

    if (action === 'view-user') {
      const item = users.find((entry) => entry.id === id);
      openModal('Usuário', `<p>Nome: ${item.name}</p><p>Email: ${item.email}</p><p>Status: ${item.status}</p><p>Cargo: ${item.role}</p>`);
    }

    if (action === 'view-report') {
      const item = reports.find((entry) => entry.id === id);
      openModal('Denúncia', `<p>ID: ${item.id}</p><p>Reportado por: ${item.reporter}</p><p>Alvo: ${item.target}</p><p>Categoria: ${item.category}</p><p>Prioridade: ${item.priority}</p><p>Status: ${item.status}</p>`);
    }

    if (action === 'remove-ban') {
      const index = bans.findIndex((entry) => entry.id === id);
      if (index >= 0) bans.splice(index, 1);
      renderTableRows('#bans-body', bans, 'bans');
    }

    if (action === 'ban-user') {
      openModal('Banir usuário', `<p>Confirma o banimento do usuário?</p><div class="modal-actions"><button class="btn danger" data-confirm-ban="${id}">Confirmar</button><button class="btn" data-close-modal="true">Cancelar</button></div>`);
    }

    if (action === 'remove-admin') {
      const idx = admins.findIndex((entry) => entry.id === id);
      if (idx >= 0) admins.splice(idx, 1);
      renderTableRows('#admins-body', admins, 'admins');
    }
  });

  document.addEventListener('click', (event) => {
    const confirmBtn = event.target.closest('[data-confirm-ban]');
    if (confirmBtn) {
      const id = confirmBtn.dataset.confirmBan;
      const target = users.find((entry) => entry.id === id);
      if (target) target.status = 'banned';
      closeModal();
      renderTableRows('#users-body', users, 'users');
    }

    const closeBtn = event.target.closest('[data-close-modal]');
    if (closeBtn) closeModal();
  });
}

function openModal(title, html) {
  const modal = document.getElementById('modal');
  const titleEl = document.getElementById('modal-title');
  const body = document.getElementById('modal-body');
  if (!modal || !titleEl || !body) return;
  titleEl.textContent = title;
  body.innerHTML = html;
  modal.classList.add('open');
}

function closeModal() {
  const modal = document.getElementById('modal');
  if (!modal) return;
  modal.classList.remove('open');
}

function setupFilters() {
  const search = document.getElementById('search-input');
  if (search) {
    search.addEventListener('input', () => {
      const q = search.value.toLowerCase();
      const filtered = users.filter((u) => `${u.name} ${u.email}`.toLowerCase().includes(q));
      renderTableRows('#users-body', filtered, 'users');
    });
  }

  const reportSearch = document.getElementById('report-search');
  if (reportSearch) {
    reportSearch.addEventListener('input', () => {
      const q = reportSearch.value.toLowerCase();
      const filtered = reports.filter((r) => `${r.reporter} ${r.target} ${r.category}`.toLowerCase().includes(q));
      renderTableRows('#reports-body', filtered, 'reports');
    });
  }

  const banSearch = document.getElementById('ban-search');
  if (banSearch) {
    banSearch.addEventListener('input', () => {
      const q = banSearch.value.toLowerCase();
      const filtered = bans.filter((b) => `${b.user} ${b.reason}`.toLowerCase().includes(q));
      renderTableRows('#bans-body', filtered, 'bans');
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  renderDashboard();
  renderTableRows('#users-body', users, 'users');
  renderTableRows('#reports-body', reports, 'reports');
  renderTableRows('#bans-body', bans, 'bans');
  renderTableRows('#admins-body', admins, 'admins');
  bindTableActions();
  setupFilters();

  const modalOverlay = document.getElementById('modal');
  if (modalOverlay) {
    modalOverlay.addEventListener('click', (event) => {
      if (event.target === modalOverlay) closeModal();
    });
  }

  const userBadge = document.getElementById('current-user');
  if (userBadge) userBadge.textContent = '@luismetzker';
});
