'use strict';

(function () {
  const API_BASE = '/api/admin';

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function formatDate(ts) {
    if (!ts) return '-';
    return new Date(ts).toLocaleString('pt-BR');
  }

  let currentUser = null;
  let userPermissions = [];
  let currentPage = 1;

  function toast(msg) {
    const el = document.getElementById('admin-toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 3500);
  }

  async function apiFetch(path, opts) {
    opts = opts || {};
    const headers = Object.assign({ 'X-Requested-With': 'xmlhttprequest', 'Content-Type': 'application/json' }, opts.headers || {});
    if (opts.body && typeof opts.body !== 'string') opts.body = JSON.stringify(opts.body);
    const res = await fetch(path, Object.assign({}, opts, { headers }));
    let data = null;
    try { data = await res.json(); } catch (_) {}
    return { ok: res.ok, status: res.status, data };
  }

  async function getMe() {
    try {
      const res = await fetch('/api/me', { headers: { 'X-Requested-With': 'xmlhttprequest' } });
      if (res.status === 401) return null;
      const j = await res.json();
      if (!j.authenticated) return null;
      currentUser = j.user;
      userPermissions = j.permissions || [];
      return j.user;
    } catch (_) { return null; }
  }

  function hasPermission(perm) {
    if (!currentUser) return false;
    return userPermissions.includes(perm);
  }

  function showSection(name) {
    document.querySelectorAll('.admin-page').forEach(function (s) { s.hidden = true; });
    const target = document.getElementById('page-' + name);
    if (target) target.hidden = false;
    document.querySelectorAll('.admin-nav').forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('data-page') === name);
    });
    const titles = {
      dashboard: 'Dashboard', users: 'Usuários', reports: 'Denúncias', bans: 'Banimentos',
      contacts: 'Contatos', purchases: 'Compras', emails: 'Emails', sessions: 'Sessões',
      administrators: 'Administradores', roles: 'Cargos e Permissões', 'audit-logs': 'Logs', settings: 'Configurações'
    };
    const titleEl = document.getElementById('page-title');
    if (titleEl) titleEl.textContent = titles[name] || 'Painel';
    loadSection(name);
  }

  function setupNav() {
    document.querySelectorAll('.admin-nav').forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        const page = a.getAttribute('data-page');
        if (page) showSection(page);
      });
    });
  }

  function updateSidebar() {
    const map = {
      'page-dashboard': 'dashboard.view', 'page-users': 'users.view', 'page-reports': 'reports.view',
      'page-bans': 'bans.view', 'page-contacts': 'contacts.view', 'page-purchases': 'purchases.view',
      'page-emails': 'email_logs.view', 'page-sessions': 'sessions.view', 'page-administrators': 'admins.view',
      'page-roles': 'roles.view', 'page-audit-logs': 'audit_logs.view', 'page-settings': 'settings.view'
    };
    Object.keys(map).forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.hidden = !hasPermission(map[id]);
    });
    document.querySelectorAll('.admin-nav').forEach(function (a) {
      const page = a.getAttribute('data-page');
      const permMap = {
        dashboard: 'dashboard.view', users: 'users.view', reports: 'reports.view',
        bans: 'bans.view', contacts: 'contacts.view', purchases: 'purchases.view',
        emails: 'email_logs.view', sessions: 'sessions.view', administrators: 'admins.view',
        roles: 'roles.view', 'audit-logs': 'audit_logs.view', settings: 'settings.view'
      };
      if (page && permMap[page]) a.style.display = hasPermission(permMap[page]) ? '' : 'none';
    });
  }

  function renderPagination(containerId, total, page, limit, callback) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    let html = '<button ' + (page <= 1 ? 'disabled' : '') + ' data-page="' + (page - 1) + '">‹ Anterior</button>';
    html += '<span class="page-info">Página ' + page + ' de ' + totalPages + '</span>';
    html += '<button ' + (page >= totalPages ? 'disabled' : '') + ' data-page="' + (page + 1) + '">Próxima ›</button>';
    container.innerHTML = html;
    container.querySelectorAll('button[data-page]').forEach(function (btn) {
      btn.addEventListener('click', function () { callback(parseInt(btn.getAttribute('data-page'), 10)); });
    });
  }

  function openModal(title, bodyHtml, actionsHtml) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = bodyHtml;
    document.getElementById('modal-actions').innerHTML = actionsHtml || '';
    document.getElementById('modal-overlay').classList.add('open');
  }

  function closeModal() {
    document.getElementById('modal-overlay').classList.remove('open');
  }

  async function loadDashboard() {
    const statsEl = document.getElementById('dashboard-stats');
    const logsEl = document.getElementById('dashboard-logs');
    if (!statsEl || !logsEl) return;
    try {
      const r = await apiFetch(API_BASE + '/dashboard');
      if (!r.ok) { statsEl.innerHTML = '<p>Erro.</p>'; return; }
      const d = r.data;
      const cards = [
        { label: 'Usuários', value: d.totalUsers || 0 },
        { label: 'Ativos (30d)', value: d.activeUsers || 0 },
        { label: 'Banidos', value: d.bannedUsers || 0 },
        { label: 'Denúncias abertas', value: d.openReports || 0 },
        { label: 'Em análise', value: d.analyzingReports || 0 },
        { label: 'Resolvidas', value: d.resolvedReports || 0 },
        { label: 'Administradores', value: d.adminCount || 0 },
        { label: 'Compras recentes', value: d.recentPurchases || 0 },
        { label: 'Novos usuários (7d)', value: d.newUsers || 0 }
      ];
      statsEl.innerHTML = cards.map(function (c) {
        return '<div class="stat-card"><div class="stat-value">' + c.value + '</div><div class="stat-label">' + c.label + '</div></div>';
      }).join('');
      const logs = d.recentLogs || [];
      if (!logs.length) { logsEl.innerHTML = '<p class="empty-state">Nenhum log recente.</p>'; return; }
      logsEl.innerHTML = '<div style="overflow-x:auto;"><table class="admin-table"><thead><tr><th>Ação</th><th>Detalhes</th><th>Data</th></tr></thead><tbody>' +
        logs.map(function (l) {
          return '<tr><td>' + escapeHtml(l.action) + '</td><td>' + escapeHtml(l.details || '-') + '</td><td>' + formatDate(l.createdAt) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    } catch (e) {
      console.error(e);
      statsEl.innerHTML = '<p>Erro.</p>';
    }
  }

  async function loadUsers(page) {
    page = page || 1;
    currentPage = page;
    const q = document.getElementById('users-search').value.trim();
    const filter = document.getElementById('users-filter').value;
    const r = await apiFetch(API_BASE + '/users?q=' + encodeURIComponent(q) + '&filter=' + encodeURIComponent(filter) + '&page=' + page + '&limit=20');
    if (!r.ok) { toast('Erro ao carregar usuários.'); return; }
    const tbody = document.getElementById('users-table-body');
    const users = r.data.users || [];
    if (!users.length) { tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">Nenhum usuário encontrado.</td></tr>'; }
    else {
      tbody.innerHTML = users.map(function (u) {
        const badgeClass = u.status === 'banido' ? 'badge-banned' : 'badge-active';
        const rolesBadge = (u.roles || []).map(function (role) {
          const cls = role === 'Admin Master' ? 'badge-master' : (role === 'Admin' ? 'badge-admin' : (role === 'Funcionario' ? 'badge-employee' : 'badge-admin'));
          return '<span class="badge ' + cls + '">' + escapeHtml(role) + '</span>';
        }).join(' ');
        var emailCell = u.emailMasked
          ? '<span id="email-' + u.id + '">' + escapeHtml(u.email) + '</span> <button class="admin-btn" style="padding:4px 8px;font-size:7px;" data-action="reveal-email" data-user="' + u.id + '">&#x1F441;</button>'
          : escapeHtml(u.email);
        return '<tr>' +
          '<td>' + escapeHtml(u.id) + '</td>' +
          '<td>' + escapeHtml(u.username) + '</td>' +
          '<td>' + emailCell + '</td>' +
          '<td><span class="badge ' + badgeClass + '">' + u.status + '</span></td>' +
          '<td>' + rolesBadge + '</td>' +
          '<td>' + formatDate(u.createdAt) + '</td>' +
          '<td class="actions"><button class="admin-btn" data-action="view-user" data-user="' + u.id + '">Ver</button></td>' +
          '</tr>';
      }).join('');
    }
    renderPagination('users-pagination', r.data.total, r.data.page, r.data.limit, function (p) { loadUsers(p); });
  }

  async function loadReports(page) {
    page = page || 1;
    currentPage = page;
    const status = document.getElementById('reports-status').value;
    const category = document.getElementById('reports-category').value;
    const priority = document.getElementById('reports-priority').value;
    const q = document.getElementById('reports-search').value.trim();
    const r = await apiFetch(API_BASE + '/reports?status=' + encodeURIComponent(status) + '&category=' + encodeURIComponent(category) + '&priority=' + encodeURIComponent(priority) + '&q=' + encodeURIComponent(q) + '&page=' + page + '&limit=20');
    if (!r.ok) { toast('Erro ao carregar denúncias.'); return; }
    const tbody = document.getElementById('reports-table-body');
    const reports = r.data.reports || [];
    if (!reports.length) { tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;">Nenhuma denúncia encontrada.</td></tr>'; }
    else {
      const statusMap = { open: 'Aberta', analyzing: 'Em análise', resolved: 'Resolvida', rejected: 'Rejeitada', archived: 'Arquivada' };
      const priorityMap = { low: 'Baixa', medium: 'Média', high: 'Alta' };
      tbody.innerHTML = reports.map(function (rep) {
        const reported = (rep.reportedUsers || []).map(function (u) { return escapeHtml(u.username); }).join(', ') || '-';
        return '<tr>' +
          '<td>' + escapeHtml(rep.id) + '</td>' +
          '<td>' + (rep.reporter ? escapeHtml(rep.reporter.username) : '-') + '</td>' +
          '<td>' + reported + '</td>' +
          '<td>' + escapeHtml(rep.category || '-') + '</td>' +
          '<td><span class="badge badge-' + rep.status + '">' + (statusMap[rep.status] || rep.status) + '</span></td>' +
          '<td>' + (priorityMap[rep.priority] || rep.priority) + '</td>' +
          '<td>' + formatDate(rep.createdAt) + '</td>' +
          '<td class="actions"><button class="admin-btn" data-action="view-report" data-id="' + rep.id + '">Ver</button></td>' +
          '</tr>';
      }).join('');
    }
    renderPagination('reports-pagination', r.data.total, r.data.page, r.data.limit, function (p) { loadReports(p); });
  }

  async function loadBans() {
    const r = await apiFetch(API_BASE + '/bans');
    if (!r.ok) { toast('Erro ao carregar banimentos.'); return; }
    const tbody = document.getElementById('bans-table-body');
    const bans = r.data.bans || [];
    if (!bans.length) { tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;">Nenhum banimento encontrado.</td></tr>'; }
    else {
      const typeMap = { temporary: 'Temporário', permanent: 'Permanente' };
      const statusMap = { active: 'Ativo', removed: 'Removido', expired: 'Expirado' };
      tbody.innerHTML = bans.map(function (b) {
        const badgeClass = b.status === 'active' ? 'badge-active' : 'badge-archived';
        const typeBadge = b.type === 'permanent' ? 'badge-permanent' : 'badge-temporary';
        return '<tr>' +
          '<td>' + escapeHtml(b.id) + '</td>' +
          '<td>' + escapeHtml(b.username || '-') + '</td>' +
          '<td>' + escapeHtml(b.reason || '-') + '</td>' +
          '<td><span class="badge ' + typeBadge + '">' + (typeMap[b.type] || b.type) + '</span></td>' +
          '<td>' + escapeHtml(b.duration || '-') + '</td>' +
          '<td>' + formatDate(b.startDate) + '</td>' +
          '<td>' + (b.endDate ? formatDate(b.endDate) : 'Permanente') + '</td>' +
          '<td><span class="badge ' + badgeClass + '">' + (statusMap[b.status] || b.status) + '</span></td>' +
          '<td class="actions">' + (b.status === 'active' ? '<button class="admin-btn success" data-action="unban" data-id="' + b.id + '">Desbanir</button>' : '-') + '</td>' +
          '</tr>';
      }).join('');
    }
  }

  async function loadContacts() {
    const r = await apiFetch(API_BASE + '/contacts');
    if (!r.ok) { toast('Erro ao carregar contatos.'); return; }
    const tbody = document.getElementById('contacts-table-body');
    const contacts = r.data.contacts || [];
    if (!contacts.length) { tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">Nenhum contato encontrado.</td></tr>'; }
    else {
      const statusMap = { new: 'Novo', read: 'Lido', replied: 'Respondido', closed: 'Fechado' };
      tbody.innerHTML = contacts.map(function (c) {
        const badgeClass = c.status === 'new' ? 'badge-open' : (c.status === 'closed' ? 'badge-resolved' : 'badge-analyzing');
        return '<tr>' +
          '<td>' + escapeHtml(c.id) + '</td>' +
          '<td>' + escapeHtml(c.name) + '</td>' +
          '<td>' + escapeHtml(c.email) + '</td>' +
          '<td>' + escapeHtml(c.subject || '-') + '</td>' +
          '<td><span class="badge ' + badgeClass + '">' + (statusMap[c.status] || c.status) + '</span></td>' +
          '<td>' + formatDate(c.createdAt) + '</td>' +
          '<td class="actions"><button class="admin-btn" data-action="contact-status" data-id="' + c.id + '" data-status="read">Ler</button> <button class="admin-btn success" data-action="contact-status" data-id="' + c.id + '" data-status="closed">Fechar</button></td></tr>';
      }).join('');
    }
  }

  async function loadPurchases() {
    const r = await apiFetch(API_BASE + '/purchases');
    if (!r.ok) { toast('Erro ao carregar compras.'); return; }
    const tbody = document.getElementById('purchases-table-body');
    const purchases = r.data.purchases || [];
    if (!purchases.length) { tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">Nenhuma compra encontrada.</td></tr>'; }
    else {
      const statusMap = { pending: 'Pendente', completed: 'Concluída', failed: 'Falha', refunded: 'Reembolsada' };
      tbody.innerHTML = purchases.map(function (p) {
        return '<tr><td>' + escapeHtml(p.id) + '</td><td>' + escapeHtml(p.username || '-') + '</td><td>' + escapeHtml(p.product) + '</td><td>R$ ' + Number(p.value).toFixed(2) + '</td><td>' + (statusMap[p.status] || p.status) + '</td><td>' + escapeHtml(p.transactionId || '-') + '</td><td>' + formatDate(p.createdAt) + '</td></tr>';
      }).join('');
    }
  }

  async function loadEmails() {
    const r = await apiFetch(API_BASE + '/emails');
    if (!r.ok) { toast('Erro ao carregar emails.'); return; }
    const tbody = document.getElementById('emails-table-body');
    const emails = r.data.emails || [];
    if (!emails.length) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Nenhum email encontrado.</td></tr>'; }
    else {
      tbody.innerHTML = emails.map(function (e) {
        return '<tr><td>' + escapeHtml(e.id) + '</td><td>' + escapeHtml(e.userId) + '</td><td>' + escapeHtml(e.toEmail) + '</td><td>' + escapeHtml(e.subject) + '</td><td>' + escapeHtml(e.status) + '</td><td>' + formatDate(e.createdAt) + '</td></tr>';
      }).join('');
    }
  }

  async function loadSessions() {
    const q = document.getElementById('sessions-search').value.trim();
    const url = q ? API_BASE + '/sessions?q=' + encodeURIComponent(q) : API_BASE + '/sessions';
    const r = await apiFetch(url);
    if (!r.ok) { toast('Erro ao carregar sessões.'); return; }
    const tbody = document.getElementById('sessions-table-body');
    const sessions = r.data.sessions || [];
    if (!sessions.length) { tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;">Nenhuma sessão encontrada.</td></tr>'; }
    else {
      tbody.innerHTML = sessions.map(function (s) {
        return '<tr><td>' + escapeHtml(s.id) + '</td><td>' + escapeHtml(s.username || '-') + '</td><td>' + escapeHtml(s.device || '-') + '</td><td>' + escapeHtml(s.ip || '-') + '</td><td>' + escapeHtml(s.location || '-') + '</td><td>' + formatDate(s.createdAt) + '</td><td>' + formatDate(s.lastSeen) + '</td><td class="actions"><button class="admin-btn danger" data-action="revoke-session" data-id="' + s.id + '">Revogar</button></td></tr>';
      }).join('');
    }
  }

  async function loadAdministrators() {
    const q = document.getElementById('admins-search').value.trim();
    const url = q ? API_BASE + '/administrators?q=' + encodeURIComponent(q) : API_BASE + '/administrators';
    const r = await apiFetch(url);
    if (!r.ok) { toast('Erro ao carregar administradores.'); return; }
    const tbody = document.getElementById('admins-table-body');
    const admins = r.data.administrators || [];
    if (!admins.length) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Nenhum administrador encontrado.</td></tr>'; }
    else {
      const roleMap = { 'Admin Master': 'badge-master', 'Admin': 'badge-admin', 'Funcionario': 'badge-employee' };
      tbody.innerHTML = admins.map(function (a) {
        const badgeClass = roleMap[a.role] || 'badge-admin';
        var adminEmailCell = a.emailMasked
          ? '<span id="admin-email-' + a.id + '">' + escapeHtml(a.email) + '</span> <button class="admin-btn" style="padding:4px 8px;font-size:7px;" data-action="reveal-email" data-user="' + a.id + '">&#x1F441;</button>'
          : escapeHtml(a.email);
        return '<tr>' +
          '<td>' + escapeHtml(a.id) + '</td>' +
          '<td>' + escapeHtml(a.username) + '</td>' +
          '<td>' + adminEmailCell + '</td>' +
          '<td><span class="badge ' + badgeClass + '">' + escapeHtml(a.role) + '</span></td>' +
          '<td>' + formatDate(a.createdAt) + '</td>' +
          '<td class="actions">' + (a.role !== 'Admin Master' ? '<button class="admin-btn danger" data-action="remove-admin" data-user="' + a.id + '">Remover</button>' : '-') + '</td></tr>';
      }).join('');
    }
  }

  async function loadRoles() {
    const r = await apiFetch(API_BASE + '/roles');
    if (!r.ok) { toast('Erro ao carregar cargos.'); return; }
    const tbody = document.getElementById('roles-table-body');
    const roles = r.data.roles || [];
    if (!roles.length) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Nenhum cargo encontrado.</td></tr>'; }
    else {
      tbody.innerHTML = roles.map(function (role) {
        const isMaster = role.name === 'Admin Master';
        return '<tr><td>' + escapeHtml(role.id) + '</td><td>' + escapeHtml(role.name) + '</td><td>' + escapeHtml(role.description || '-') + '</td><td>' + (role.isProtected ? 'Sim' : 'Não') + '</td><td><button class="admin-btn" data-action="view-role-perms" data-id="' + role.id + '">Ver permissões</button></td><td class="actions">' + (isMaster ? '-' : '<button class="admin-btn" data-action="edit-role" data-id="' + role.id + '">Editar</button> <button class="admin-btn danger" data-action="delete-role" data-id="' + role.id + '">Excluir</button>') + '</td></tr>';
      }).join('');
    }
  }

  async function loadAuditLogs(page) {
    page = page || 1;
    currentPage = page;
    const r = await apiFetch(API_BASE + '/audit-logs?page=' + page + '&limit=20');
    if (!r.ok) { toast('Erro ao carregar logs.'); return; }
    const tbody = document.getElementById('audit-logs-table-body');
    const logs = r.data.logs || [];
    if (!logs.length) { tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">Nenhum log encontrado.</td></tr>'; }
    else {
      tbody.innerHTML = logs.map(function (l) {
        return '<tr><td>' + escapeHtml(l.id) + '</td><td>' + escapeHtml(l.adminId || '-') + '</td><td>' + escapeHtml(l.action) + '</td><td>' + escapeHtml(l.targetUserId || '-') + '</td><td>' + escapeHtml(l.details || '-') + '</td><td>' + escapeHtml(l.ip || '-') + '</td><td>' + formatDate(l.createdAt) + '</td></tr>';
      }).join('');
    }
    renderPagination('audit-logs-pagination', r.data.total, r.data.page, r.data.limit, function (p) { loadAuditLogs(p); });
  }

  async function loadSettings() {
    const el = document.getElementById('settings-content');
    if (!el) return;
    const r = await apiFetch(API_BASE + '/settings');
    if (!r.ok) { el.innerHTML = '<p>Erro.</p>'; return; }
    const s = r.data.settings || {};
    el.innerHTML = '<div class="hud">' +
      '<div class="hud-row"><span class="hud-label">Google Login:</span><span class="hud-value">' + (s.googleEnabled ? 'Ativado' : 'Desativado') + '</span></div>' +
      '<div class="hud-row"><span class="hud-label">Max upload:</span><span class="hud-value">' + (s.maxUploadSize || '50MB') + '</span></div>' +
      '</div>';
  }

  async function loadSection(name) {
    if (name === 'dashboard') loadDashboard();
    else if (name === 'users') loadUsers(1);
    else if (name === 'reports') loadReports(1);
    else if (name === 'bans') loadBans();
    else if (name === 'contacts') loadContacts();
    else if (name === 'purchases') loadPurchases();
    else if (name === 'emails') loadEmails();
    else if (name === 'sessions') loadSessions();
    else if (name === 'administrators') loadAdministrators();
    else if (name === 'roles') loadRoles();
    else if (name === 'audit-logs') loadAuditLogs(1);
    else if (name === 'settings') loadSettings();
  }

  async function init() {
    const data = await getMe();
    if (!data) { window.location.href = '/login.html?next=/admin.html'; return; }
    const isAdmin = data.roles.includes('Admin Master') || data.roles.includes('Admin') || data.roles.includes('Funcionario');
    if (!isAdmin) { window.location.href = '/login.html?next=/admin.html'; return; }
    const chip = document.getElementById('admin-user-chip');
    if (chip) { chip.textContent = '@' + data.user.username; chip.style.display = ''; }
    setupNav();
    updateSidebar();
    showSection('dashboard');
    await loadDashboard();

    document.getElementById('modal-overlay').addEventListener('click', function (e) {
      if (e.target === document.getElementById('modal-overlay')) closeModal();
    });

    document.addEventListener('click', async function (e) {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const action = btn.getAttribute('data-action');
      const id = btn.getAttribute('data-id');
      const userId = btn.getAttribute('data-user');
      const status = btn.getAttribute('data-status');

      if (action === 'view-user') await viewUser(userId);
      else if (action === 'view-report') await viewReport(id);
      else if (action === 'view-role-perms') await viewRolePerms(id);
      else if (action === 'edit-role') await editRole(id);
      else if (action === 'delete-role') await deleteRole(id);
      else if (action === 'reveal-email') await revealEmail(userId);
      else if (action === 'reset-password') await resetPassword(userId);
      else if (action === 'ban-user') await banUser(userId);
      else if (action === 'unban-user') await banUser(userId);
      else if (action === 'unban') await unban(id);
      else if (action === 'revoke-session') await revokeSession(id);
      else if (action === 'remove-admin') await removeAdmin(userId);
      else if (action === 'assign-report') await assignReport(id);
      else if (action === 'change-report-status') await changeReportStatus(id);
      else if (action === 'delete-report') await deleteReport(id);
      else if (action === 'contact-status') await updateContactStatus(id, status);
      else if (action === 'create-admin') await createAdmin();
      else if (action === 'create-role') await createRole();
      else if (action === 'create-ban') await createBan();
      else if (action === 'revoke-all-sessions') await revokeAllSessions();
    });

    document.getElementById('users-search-btn').addEventListener('click', function () { loadUsers(1); });
    document.getElementById('reports-search-btn').addEventListener('click', function () { loadReports(1); });
    document.getElementById('bans-search-btn').addEventListener('click', loadBans);
    document.getElementById('sessions-search-btn').addEventListener('click', loadSessions);
    document.getElementById('admins-search-btn').addEventListener('click', loadAdministrators);
    document.getElementById('ban-create-btn').addEventListener('click', createBan);
    document.getElementById('admin-create-btn').addEventListener('click', createAdmin);
    document.getElementById('role-create-btn').addEventListener('click', createRole);
    document.getElementById('sessions-revoke-all-btn').addEventListener('click', revokeAllSessions);
  }

  async function revealEmail(userId) {
    const r = await apiFetch(API_BASE + '/users/' + userId + '/reveal-email', { method: 'POST' });
    if (r.ok) {
      const el1 = document.getElementById('email-' + userId);
      const el2 = document.getElementById('admin-email-' + userId);
      if (el1) el1.textContent = r.data.email || '***';
      if (el2) el2.textContent = r.data.email || '***';
      toast('Email revelado.');
    } else { toast('Sem permissão.'); }
  }

  async function resetPassword(userId) {
    const newPass = prompt('Nova senha (mínimo 8 caracteres):');
    if (!newPass || newPass.length < 8) { toast('Senha inválida.'); return; }
    const r = await apiFetch(API_BASE + '/users/' + userId + '/password', { method: 'POST', body: { action: 'reset', newPassword: newPass } });
    if (r.ok) { toast('Senha redefinida.'); }
    else { toast('Erro: ' + (r.data.error || 'falhou')); }
  }

  async function banUser(userId) {
    const reason = prompt('Motivo do banimento:');
    if (!reason) return;
    const type = confirm('Banimento permanente? (Cancelar para temporário)') ? 'permanent' : 'temporary';
    const duration = type === 'temporary' ? prompt('Duração (ex: 30 dias, 2 horas):') : '';
    const r = await apiFetch(API_BASE + '/bans', { method: 'POST', body: { identifier: userId, reason: reason, type: type, duration: duration || '' } });
    if (r.ok) { toast('Usuário banido.'); closeModal(); loadBans(); }
    else { toast('Erro: ' + (r.data.error || 'falhou')); }
  }

  async function unban(banId) {
    if (!confirm('Deseja realmente desbanir este usuário?')) return;
    const r = await apiFetch(API_BASE + '/bans/' + banId + '/unban', { method: 'POST' });
    if (r.ok) { toast('Banimento removido.'); loadBans(); }
    else { toast('Erro: ' + (r.data.error || 'falhou')); }
  }

  async function revokeSession(sessionId) {
    if (!confirm('Revogar esta sessão?')) return;
    const r = await apiFetch(API_BASE + '/sessions/' + sessionId + '/revoke', { method: 'POST' });
    if (r.ok) { toast('Sessão revogada.'); loadSessions(); }
    else { toast('Erro: ' + (r.data.error || 'falhou')); }
  }

  async function revokeAllSessions() {
    if (!confirm('Revogar TODAS as sessões?')) return;
    const r = await apiFetch(API_BASE + '/sessions/revoke-all', { method: 'POST', body: {} });
    if (r.ok) { toast('Todas as sessões foram revogadas.'); loadSessions(); }
    else { toast('Erro: ' + (r.data.error || 'falhou')); }
  }

  async function assignReport(reportId) {
    const r = await apiFetch(API_BASE + '/reports/' + reportId + '/assign', { method: 'POST', body: {} });
    if (r.ok) { toast('Denúncia assumida.'); closeModal(); loadReports(currentPage); }
    else { toast('Erro: ' + (r.data.error || 'falhou')); }
  }

  async function changeReportStatus(reportId) {
    const status = document.getElementById('report-status-change').value;
    const note = document.getElementById('report-note').value;
    const r = await apiFetch(API_BASE + '/reports/' + reportId + '/status', { method: 'POST', body: { status: status, note: note } });
    if (r.ok) { toast('Status alterado.'); closeModal(); loadReports(currentPage); }
    else { toast('Erro: ' + (r.data.error || 'falhou')); }
  }

  async function deleteReport(reportId) {
    if (!confirm('Excluir esta denúncia permanentemente?')) return;
    const r = await apiFetch(API_BASE + '/reports/' + reportId, { method: 'DELETE' });
    if (r.ok) { toast('Denúncia excluída.'); closeModal(); loadReports(currentPage); }
    else { toast('Erro: ' + (r.data.error || 'falhou')); }
  }

  async function removeAdmin(userId) {
    if (!confirm('Remover cargo administrativo deste usuário?')) return;
    const r = await apiFetch(API_BASE + '/administrators/' + userId, { method: 'DELETE' });
    if (r.ok) { toast('Cargo removido.'); loadAdministrators(); }
    else { toast('Erro: ' + (r.data.error || 'falhou')); }
  }

  async function updateContactStatus(contactId, status) {
    const r = await apiFetch(API_BASE + '/contacts/' + contactId, { method: 'POST', body: { status: status } });
    if (r.ok) { toast('Contato atualizado.'); loadContacts(); }
    else { toast('Erro: ' + (r.data.error || 'falhou')); }
  }

  async function createAdmin() {
    const username = prompt('Username do usuário para tornar admin:');
    if (!username) return;
    const role = prompt('Cargo (Admin ou Funcionario):', 'Admin');
    const r = await apiFetch(API_BASE + '/administrators', { method: 'POST', body: { userId: username, role: role } });
    if (r.ok) { toast('Usuário tornado administrador.'); loadAdministrators(); }
    else { toast('Erro: ' + (r.data.error || 'falhou')); }
  }

  async function createRole() {
    const name = prompt('Nome do cargo:');
    if (!name) return;
    const description = prompt('Descrição:', '');
    const r = await apiFetch(API_BASE + '/roles', { method: 'POST', body: { name: name, description: description } });
    if (r.ok) { toast('Cargo criado.'); loadRoles(); }
    else { toast('Erro: ' + (r.data.error || 'falhou')); }
  }

  async function createBan() {
    const identifier = prompt('Username ou ID do usuário:');
    if (!identifier) return;
    const reason = prompt('Motivo do banimento:');
    if (!reason) return;
    const type = confirm('Banimento permanente? (Cancelar para temporário)') ? 'permanent' : 'temporary';
    const duration = type === 'temporary' ? prompt('Duração (ex: 30 dias, 2 horas):') : '';
    const r = await apiFetch(API_BASE + '/bans', { method: 'POST', body: { identifier: identifier, reason: reason, type: type, duration: duration || '' } });
    if (r.ok) { toast('Usuário banido.'); loadBans(); }
    else { toast('Erro: ' + (r.data.error || 'falhou')); }
  }

  async function viewRolePerms(roleId) {
    const r = await apiFetch(API_BASE + '/roles');
    if (!r.ok) { toast('Erro.'); return; }
    const perms = (r.data.permissions || []).map(function (p) {
      return '<label style="display:block;margin:6px 0;"><input type="checkbox" disabled> ' + escapeHtml(p.name) + ' <span style="opacity:0.6;">(' + escapeHtml(p.category || '-') + ')</span></label>';
    }).join('');
    openModal('Permissões', '<div style="max-height:60vh;overflow-y:auto;">' + perms + '</div>', '<button class="admin-btn" onclick="window._closeModal()">Fechar</button>');
  }

  async function editRole(roleId) {
    const r = await apiFetch(API_BASE + '/roles');
    if (!r.ok) { toast('Erro.'); return; }
    const allPerms = r.data.permissions || [];
    const permsHtml = allPerms.map(function (p) {
      return '<label style="display:block;margin:6px 0;"><input type="checkbox" value="' + escapeHtml(p.id) + '"> ' + escapeHtml(p.name) + ' <span style="opacity:0.6;">(' + escapeHtml(p.category || '-') + ')</span></label>';
    }).join('');
    const body = '<input type="text" id="edit-role-name" class="admin-input" placeholder="Nome" style="width:100%;margin-bottom:10px;">' +
      '<input type="text" id="edit-role-desc" class="admin-input" placeholder="Descrição" style="width:100%;margin-bottom:10px;">' +
      '<div style="max-height:50vh;overflow-y:auto;margin-top:10px;"><strong>Permissões:</strong><br>' + permsHtml + '</div>';
    const actions = '<button class="admin-btn primary" id="save-role-btn" data-id="' + roleId + '">Salvar</button> <button class="admin-btn" onclick="window._closeModal()">Cancelar</button>';
    openModal('Editar cargo', body, actions);
    document.getElementById('save-role-btn').addEventListener('click', async function () {
      const name = document.getElementById('edit-role-name').value.trim();
      const desc = document.getElementById('edit-role-desc').value.trim();
      const permIds = Array.from(document.querySelectorAll('#modal-body input[type="checkbox"]:checked')).map(function (cb) { return cb.value; });
      const res = await apiFetch(API_BASE + '/roles/' + roleId, { method: 'PUT', body: { name: name, description: desc, permissionIds: permIds } });
      if (res.ok) { toast('Cargo atualizado.'); closeModal(); loadRoles(); }
      else { toast('Erro: ' + (res.data.error || 'falhou')); }
    });
  }

  async function deleteRole(roleId) {
    if (!confirm('Excluir este cargo? Usuários serão transferidos automaticamente.')) return;
    const r = await apiFetch(API_BASE + '/roles/' + roleId, { method: 'DELETE' });
    if (r.ok) { toast('Cargo excluído.'); loadRoles(); }
    else { toast('Erro: ' + (r.data.error || 'falhou')); }
  }

  async function viewUser(userId) {
    const r = await apiFetch(API_BASE + '/users/' + userId);
    if (!r.ok) { toast('Erro ao carregar usuário.'); return; }
    const u = r.data.user;
    const statusMap = { active: 'Ativo', banido: 'Banido' };
    let html = '<div style="overflow-y:auto;max-height:70vh;">';
    html += '<h3>Informações Básicas</h3>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:8px;margin-bottom:18px;">';
    html += '<p><strong>ID:</strong><br>' + escapeHtml(u.id) + '</p>';
    html += '<p><strong>Username:</strong><br>' + escapeHtml(u.username) + '</p>';
    html += '<p><strong>Email:</strong><br>' + (u.emailMasked ? escapeHtml(u.email) : escapeHtml(u.email)) + '</p>';
    html += '<p><strong>Criado:</strong><br>' + formatDate(u.createdAt) + '</p>';
    html += '<p><strong>Status:</strong><br><span class="badge ' + (u.status === 'banido' ? 'badge-banned' : 'badge-active') + '">' + statusMap[u.status] + '</span></p>';
    html += '</div>';
    if (u.roles && u.roles.length > 0) {
      html += '<h3>Cargos</h3>';
      html += '<p style="font-size:8px;">' + u.roles.map(r => '<span class="badge badge-admin">' + escapeHtml(r) + '</span>').join(' ') + '</p>';
    }
    if (u.ban && u.ban.id) {
      html += '<h3>Banimento Ativo</h3>';
      html += '<p style="font-size:8px;"><strong>Motivo:</strong> ' + escapeHtml(u.ban.reason || '-') + '<br>';
      html += '<strong>Tipo:</strong> ' + (u.ban.type === 'permanent' ? 'Permanente' : 'Temporário') + '<br>';
      html += '<strong>Início:</strong> ' + formatDate(u.ban.startDate) + '<br>';
      html += '<strong>Término:</strong> ' + (u.ban.endDate ? formatDate(u.ban.endDate) : 'Permanente') + '</p>';
    }
    if (u.purchases && u.purchases.length > 0) {
      html += '<h3>Compras Recentes</h3>';
      html += '<table class="admin-table" style="font-size:7px;"><thead><tr><th>Produto</th><th>Valor</th><th>Data</th></tr></thead><tbody>';
      for (const p of u.purchases.slice(0, 10)) {
        html += '<tr><td>' + escapeHtml(p.product) + '</td><td>R$ ' + Number(p.value).toFixed(2) + '</td><td>' + formatDate(p.createdAt) + '</td></tr>';
      }
      html += '</tbody></table>';
    }
    if (u.sessions && u.sessions.length > 0) {
      html += '<h3>Sessões Ativas</h3>';
      html += '<table class="admin-table" style="font-size:7px;"><thead><tr><th>Dispositivo</th><th>IP</th><th>Localização</th></tr></thead><tbody>';
      for (const s of u.sessions.slice(0, 5)) {
        html += '<tr><td>' + escapeHtml(s.device || '-') + '</td><td>' + escapeHtml(s.ip || '-') + '</td><td>' + escapeHtml(s.location || '-') + '</td></tr>';
      }
      html += '</tbody></table>';
    }
    html += '</div>';
    let actions = '<button class="admin-btn warning" data-action="ban-user" data-user="' + u.id + '">Banir usuário</button>';
    if (u.status === 'banido') {
      actions += ' <button class="admin-btn success" data-action="unban-user" data-user="' + u.id + '">Desbanir</button>';
    }
    actions += ' <button class="admin-btn" onclick="window._closeModal()">Fechar</button>';
    openModal('Detalhes do Usuário', html, actions);
  }

  async function viewReport(reportId) {
    const r = await apiFetch(API_BASE + '/reports/' + reportId);
    if (!r.ok) { toast('Erro ao carregar denúncia.'); return; }
    const rep = r.data.report;
    const statusMap = { open: 'Aberta', analyzing: 'Em análise', resolved: 'Resolvida', rejected: 'Rejeitada', archived: 'Arquivada' };
    const priorityMap = { low: 'Baixa', medium: 'Média', high: 'Alta' };
    let html = '<div style="overflow-y:auto;max-height:70vh;font-size:8px;">';
    html += '<h3>Informações da Denúncia</h3>';
    html += '<p><strong>ID:</strong> ' + escapeHtml(rep.id) + '</p>';
    html += '<p><strong>Denunciante:</strong> ' + (rep.reporter ? escapeHtml(rep.reporter.username) : '-') + '</p>';
    html += '<p><strong>Denunciados:</strong> ' + (rep.reportedUsers && rep.reportedUsers.length > 0 ? rep.reportedUsers.map(u => escapeHtml(u.username)).join(', ') : '-') + '</p>';
    html += '<p><strong>Categoria:</strong> ' + escapeHtml(rep.category || '-') + '</p>';
    html += '<p><strong>Status:</strong> <span class="badge badge-' + rep.status + '">' + (statusMap[rep.status] || rep.status) + '</span></p>';
    html += '<p><strong>Prioridade:</strong> ' + (priorityMap[rep.priority] || rep.priority) + '</p>';
    html += '<p><strong>Criada:</strong> ' + formatDate(rep.createdAt) + '</p>';
    html += '<h3>Descrição</h3>';
    html += '<p style="line-height:1.6;white-space:pre-wrap;">' + escapeHtml(rep.description || '-') + '</p>';
    if (rep.attachments && rep.attachments.length > 0) {
      html += '<h3>Anexos</h3>';
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;">';
      for (const att of rep.attachments) {
        const isImage = att.mimeType && att.mimeType.startsWith('image/');
        html += '<div style="border:1px solid rgba(0,255,234,0.3);border-radius:6px;padding:8px;">';
        if (isImage) {
          html += '<img src="/api/admin/uploads/' + escapeHtml(att.filename) + '" style="max-width:100%;max-height:150px;border-radius:4px;">';
        } else {
          html += '<p style="margin:0;">📎 ' + escapeHtml(att.originalName) + '<br><small>' + (att.size / 1024).toFixed(1) + ' KB</small></p>';
        }
        html += '</div>';
      }
      html += '</div>';
    }
    html += '</div>';
    const allowed = ['open', 'analyzing', 'resolved', 'rejected', 'archived'];
    const statusOptions = allowed.map(s => '<option value="' + s + '"' + (s === rep.status ? ' selected' : '') + '>' + (statusMap[s] || s) + '</option>').join('');
    let actions = '<div style="margin-bottom:10px;">';
    actions += '<label style="font-size:8px;display:block;margin-bottom:6px;">Novo Status:</label>';
    actions += '<select id="report-status-change" class="admin-select" style="width:100%;margin-bottom:10px;">' + statusOptions + '</select>';
    actions += '<textarea id="report-note" class="admin-textarea" placeholder="Observação interna..." style="width:100%;min-height:60px;margin-bottom:10px;"></textarea>';
    actions += '</div>';
    actions += '<button class="admin-btn primary" data-action="change-report-status" data-id="' + rep.id + '">Atualizar Status</button>';
    if (rep.status !== 'archived') actions += ' <button class="admin-btn danger" data-action="delete-report" data-id="' + rep.id + '">Excluir</button>';
    actions += ' <button class="admin-btn" onclick="window._closeModal()">Fechar</button>';
    openModal('Detalhes da Denúncia', html, actions);
  }

  window._closeModal = closeModal;

  document.addEventListener('DOMContentLoaded', init);
})();
