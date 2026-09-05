// Admin Panel - Main Script (Bugfixed Version)
// Conecta com o backend e gerencia o painel administrativo

const API_BASE = '/api/admin';
let currentUser = null;
let currentPage = {
    users: 1,
    reports: 1,
    'audit-logs': 1
};

// HTML Escape function - SECURITY: Previne XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Toast notifications
function toast(msg, type = 'info') {
    const div = document.createElement('div');
    div.className = `admin-toast ${type}`;
    div.textContent = msg;
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 3500);
}

// API Fetch com tratamento de erro e CSRF
async function apiFetch(path, opts = {}) {
    try {
        const res = await fetch(path, {
            headers: { 'X-Requested-With': 'xmlhttprequest' },
            ...opts
        });
        const data = await res.json();
        if (!res.ok) {
            return { ok: false, error: data.error || 'Erro na requisição' };
        }
        return { ok: true, data: data };
    } catch (err) {
        console.error(err);
        return { ok: false, error: err.message };
    }
}

// Check auth
async function checkAuth() {
    try {
        const result = await apiFetch('/api/me');
        if (!result.ok || !result.data || !result.data.authenticated) {
            window.location.href = '/login.html?next=/admin';
            return false;
        }
        currentUser = result.data.user;
        const isAdmin = result.data.roles && (result.data.roles.includes('Admin Master') || result.data.roles.includes('Admin'));
        if (!isAdmin) {
            window.location.href = '/';
            return false;
        }
        const userEl = document.getElementById('current-user');
        if (userEl) {
            userEl.textContent = '@' + escapeHtml(currentUser.username || 'admin');
        }
        return true;
    } catch (err) {
        window.location.href = '/login.html?next=/admin';
        return false;
    }
}

// Logout
async function logout() {
    try {
        const result = await apiFetch('/api/logout', { method: 'POST' });
        if (result.ok) {
            window.location.href = '/';
        } else {
            toast(result.error, 'error');
        }
    } catch (err) {
        toast('Erro ao fazer logout', 'error');
    }
}

// Navigation
function switchSection(sectionId) {
    // Hide all sections
    document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.admin-nav-item').forEach(n => n.classList.remove('active'));
    
    // Show selected section
    const section = document.getElementById(sectionId + '-section');
    if (section) {
        section.classList.add('active');
    }
    
    const navItem = document.querySelector(`[data-section="${sectionId}"]`);
    if (navItem) {
        navItem.classList.add('active');
    }
    
    // Update title
    const titles = {
        dashboard: 'Dashboard',
        users: 'Gerenciar Usuários',
        reports: 'Gerenciar Denúncias',
        bans: 'Gerenciar Banimentos',
        administrators: 'Gerenciar Administradores',
        'audit-logs': 'Logs de Auditoria',
        settings: 'Configurações'
    };
    const titleEl = document.getElementById('page-title');
    if (titleEl) {
        titleEl.textContent = titles[sectionId] || 'Painel';
    }
    
    // Load data
    loadSectionData(sectionId);
}

// Load section data
async function loadSectionData(sectionId) {
    try {
        if (sectionId === 'dashboard') await loadDashboard();
        if (sectionId === 'users') await loadUsers();
        if (sectionId === 'reports') await loadReports();
        if (sectionId === 'bans') await loadBans();
        if (sectionId === 'administrators') await loadAdministrators();
        if (sectionId === 'audit-logs') await loadAuditLogs();
        if (sectionId === 'settings') await loadSettings();
    } catch (err) {
        toast('Erro ao carregar dados: ' + (err.message || 'Erro desconhecido'), 'error');
    }
}

// ============ DASHBOARD ============
async function loadDashboard() {
    try {
        const result = await apiFetch(API_BASE + '/dashboard');
        if (!result.ok) {
            toast(result.error, 'error');
            return;
        }
        const data = result.data;
        
        const stats = [
            { label: 'Usuários', value: data.totalUsers || 0 },
            { label: 'Ativos', value: data.activeUsers || 0 },
            { label: 'Banidos', value: data.bannedUsers || 0 },
            { label: 'Denúncias', value: (data.openReports || 0) + (data.analyzingReports || 0) + (data.resolvedReports || 0) },
            { label: 'Admins', value: data.adminCount || 0 },
            { label: 'Vendas', value: data.recentPurchases || 0 }
        ];
        
        const statsContainer = document.getElementById('dashboard-stats');
        if (statsContainer) {
            statsContainer.innerHTML = '';
            stats.forEach(s => {
                const div = document.createElement('div');
                div.className = 'admin-stat';
                div.textContent = '';
                const valueDiv = document.createElement('div');
                valueDiv.className = 'value';
                valueDiv.textContent = String(s.value);
                const labelDiv = document.createElement('div');
                labelDiv.className = 'label';
                labelDiv.textContent = s.label;
                div.appendChild(valueDiv);
                div.appendChild(labelDiv);
                statsContainer.appendChild(div);
            });
        }
        
        // Recent logs
        const logsContainer = document.getElementById('recent-logs');
        if (logsContainer) {
            logsContainer.innerHTML = '';
            
            if (data.recentLogs && Array.isArray(data.recentLogs) && data.recentLogs.length > 0) {
                data.recentLogs.forEach(log => {
                    const tr = document.createElement('tr');
                    const cells = [
                        log.action || '-',
                        log.targetUserId ? log.targetUserId.substring(0, 8) : '-',
                        log.details || '-',
                        new Date(log.createdAt).toLocaleDateString('pt-BR')
                    ];
                    cells.forEach(cell => {
                        const td = document.createElement('td');
                        td.textContent = escapeHtml(cell);
                        tr.appendChild(td);
                    });
                    logsContainer.appendChild(tr);
                });
            } else {
                const tr = document.createElement('tr');
                const td = document.createElement('td');
                td.colSpan = 4;
                td.textContent = 'Nenhuma atividade';
                tr.appendChild(td);
                logsContainer.appendChild(tr);
            }
        }
    } catch (err) {
        toast(err.message || 'Erro desconhecido', 'error');
    }
}

// ============ USERS ============
async function loadUsers(page = 1) {
    try {
        currentPage.users = page;
        const q = (document.getElementById('users-search')?.value || '').trim();
        const filter = (document.getElementById('users-filter')?.value || '').trim();
        
        const result = await apiFetch(`${API_BASE}/users?q=${encodeURIComponent(q)}&filter=${encodeURIComponent(filter)}&page=${page}&limit=20`);
        if (!result.ok) {
            toast(result.error, 'error');
            return;
        }
        
        const data = result.data;
        const tbody = document.getElementById('users-table');
        if (!tbody) return;
        
        tbody.innerHTML = '';
        
        if (data.users && Array.isArray(data.users) && data.users.length > 0) {
            data.users.forEach(u => {
                const tr = document.createElement('tr');
                const cells = [
                    u.username || '-',
                    (u.emailMasked ? u.email : u.email) || '-',
                    u.roles?.join(', ') || 'Usuário',
                    new Date(u.createdAt).toLocaleDateString('pt-BR')
                ];
                cells.forEach(cell => {
                    const td = document.createElement('td');
                    td.textContent = escapeHtml(cell);
                    tr.appendChild(td);
                });
                
                // Status badge
                const statusTd = document.createElement('td');
                const badge = document.createElement('span');
                badge.className = `admin-badge ${u.status === 'banido' ? 'banned' : 'active'}`;
                badge.textContent = u.status === 'banido' ? 'Banido' : 'Ativo';
                statusTd.appendChild(badge);
                tr.insertBefore(statusTd, tr.children[2]);
                
                // Actions
                const actionTd = document.createElement('td');
                const viewBtn = document.createElement('button');
                viewBtn.className = 'admin-btn';
                viewBtn.textContent = 'Ver';
                viewBtn.dataset.action = 'view-user';
                viewBtn.dataset.userId = u.id;
                actionTd.appendChild(viewBtn);
                
                const banBtn = document.createElement('button');
                banBtn.className = 'admin-btn warning';
                banBtn.textContent = 'Banir';
                banBtn.dataset.action = 'ban-user';
                banBtn.dataset.userId = u.id;
                actionTd.appendChild(banBtn);
                
                tr.appendChild(actionTd);
                tbody.appendChild(tr);
            });
        } else {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = 6;
            td.textContent = 'Nenhum usuário encontrado';
            tr.appendChild(td);
            tbody.appendChild(tr);
        }
        
        // Pagination
        const paginationContainer = document.getElementById('users-pagination');
        if (paginationContainer) {
            paginationContainer.innerHTML = '';
            const pageCount = Math.ceil((data.total || 0) / 20);
            
            for (let i = 1; i <= pageCount; i++) {
                const btn = document.createElement('button');
                btn.textContent = i;
                if (i === page) btn.classList.add('active');
                btn.addEventListener('click', () => loadUsers(i));
                paginationContainer.appendChild(btn);
            }
        }
    } catch (err) {
        toast(err.message || 'Erro desconhecido', 'error');
    }
}

async function viewUser(userId) {
    try {
        const result = await apiFetch(`${API_BASE}/users/${encodeURIComponent(userId || '')}`);
        if (!result.ok) {
            toast(result.error, 'error');
            return;
        }
        
        const u = result.data.user;
        const modalBody = document.getElementById('modal-body');
        
        if (modalBody) {
            modalBody.innerHTML = '';
            
            const info = [
                ['Usuário', u.username || '-'],
                ['Email', u.emailMasked ? u.email : (u.email || '-')],
                ['Status', u.status === 'banido' ? 'Banido' : 'Ativo'],
                ['Cargos', (u.roles || []).join(', ') || 'Usuário'],
                ['Criado', new Date(u.createdAt).toLocaleDateString('pt-BR')]
            ];
            
            info.forEach(([label, value]) => {
                const p = document.createElement('p');
                const strong = document.createElement('strong');
                strong.textContent = label + ':';
                p.appendChild(strong);
                p.appendChild(document.createTextNode(' ' + escapeHtml(value)));
                modalBody.appendChild(p);
            });
            
            if (u.ban) {
                const p = document.createElement('p');
                const strong = document.createElement('strong');
                strong.textContent = 'Banimento:';
                p.appendChild(strong);
                modalBody.appendChild(p);
                
                const banInfo = [
                    ['Motivo', u.ban.reason || '-'],
                    ['Tipo', u.ban.type || '-'],
                    ['Fim', u.ban.endDate ? new Date(u.ban.endDate).toLocaleDateString('pt-BR') : 'Permanente']
                ];
                
                banInfo.forEach(([label, value]) => {
                    const p = document.createElement('p');
                    p.textContent = label + ': ' + escapeHtml(value);
                    modalBody.appendChild(p);
                });
            }
        }
        
        const modalActions = document.getElementById('modal-actions');
        if (modalActions) {
            modalActions.innerHTML = '';
            
            const closeBtn = document.createElement('button');
            closeBtn.className = 'admin-btn';
            closeBtn.textContent = 'Fechar';
            closeBtn.addEventListener('click', closeModal);
            modalActions.appendChild(closeBtn);
            
            const banBtn = document.createElement('button');
            banBtn.className = 'admin-btn danger';
            banBtn.textContent = 'Banir';
            banBtn.addEventListener('click', () => banUserModal(u.id));
            modalActions.appendChild(banBtn);
        }
        
        openModal('Usuário: ' + escapeHtml(u.username || 'Desconhecido'));
    } catch (err) {
        toast(err.message || 'Erro desconhecido', 'error');
    }
}

async function banUserModal(userId) {
    const identifier = prompt('Email ou usuário para banir:');
    if (!identifier || !identifier.trim()) return;
    
    const reason = prompt('Motivo do banimento:');
    if (!reason || !reason.trim()) return;
    
    const type = prompt('Tipo (temporary/permanent):', 'temporary');
    if (!type || !type.trim()) return;
    
    let duration = '';
    if (type.trim() === 'temporary') {
        duration = prompt('Duração (ex: 7 days, 1 month):');
        if (!duration || !duration.trim()) return;
    }
    
    try {
        const result = await apiFetch(API_BASE + '/bans', {
            method: 'POST',
            body: JSON.stringify({ identifier: identifier.trim(), reason: reason.trim(), type: type.trim(), duration: duration.trim() }),
            headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'xmlhttprequest' }
        });
        
        if (result.ok) {
            toast('Usuário banido com sucesso', 'success');
            closeModal();
            loadUsers();
            loadBans();
        } else {
            toast(result.error, 'error');
        }
    } catch (err) {
        toast(err.message || 'Erro desconhecido', 'error');
    }
}

// ============ REPORTS ============
async function loadReports(page = 1) {
    try {
        currentPage.reports = page;
        const q = (document.getElementById('reports-search')?.value || '').trim();
        const status = (document.getElementById('reports-filter')?.value || '').trim();
        
        const result = await apiFetch(`${API_BASE}/reports?q=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}&page=${page}&limit=20`);
        if (!result.ok) {
            toast(result.error, 'error');
            return;
        }
        
        const data = result.data;
        const tbody = document.getElementById('reports-table');
        if (!tbody) return;
        
        tbody.innerHTML = '';
        
        if (data.reports && Array.isArray(data.reports) && data.reports.length > 0) {
            data.reports.forEach(r => {
                const tr = document.createElement('tr');
                const cells = [
                    r.id ? r.id.substring(0, 8) : '-',
                    r.reporter ? r.reporter.username : 'Desconhecido',
                    r.category || '-',
                    r.priority || '-',
                    new Date(r.createdAt).toLocaleDateString('pt-BR')
                ];
                cells.forEach(cell => {
                    const td = document.createElement('td');
                    td.textContent = escapeHtml(cell);
                    tr.appendChild(td);
                });
                
                // Status badge
                const statusTd = document.createElement('td');
                const badge = document.createElement('span');
                badge.className = `admin-badge ${r.status || 'open'}`;
                badge.textContent = escapeHtml(r.status || 'open');
                statusTd.appendChild(badge);
                tr.insertBefore(statusTd, tr.children[3]);
                
                // Actions
                const actionTd = document.createElement('td');
                const viewBtn = document.createElement('button');
                viewBtn.className = 'admin-btn';
                viewBtn.textContent = 'Ver';
                viewBtn.dataset.action = 'view-report';
                viewBtn.dataset.reportId = r.id;
                actionTd.appendChild(viewBtn);
                tr.appendChild(actionTd);
                
                tbody.appendChild(tr);
            });
        } else {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = 7;
            td.textContent = 'Nenhuma denúncia encontrada';
            tr.appendChild(td);
            tbody.appendChild(tr);
        }
        
        // Pagination
        const paginationContainer = document.getElementById('reports-pagination');
        if (paginationContainer) {
            paginationContainer.innerHTML = '';
            const pageCount = Math.ceil((data.total || 0) / 20);
            
            for (let i = 1; i <= pageCount; i++) {
                const btn = document.createElement('button');
                btn.textContent = i;
                if (i === page) btn.classList.add('active');
                btn.addEventListener('click', () => loadReports(i));
                paginationContainer.appendChild(btn);
            }
        }
    } catch (err) {
        toast(err.message || 'Erro desconhecido', 'error');
    }
}

async function viewReport(reportId) {
    try {
        const result = await apiFetch(`${API_BASE}/reports/${encodeURIComponent(reportId || '')}`);
        if (!result.ok) {
            toast(result.error, 'error');
            return;
        }
        
        const r = result.data.report;
        const modalBody = document.getElementById('modal-body');
        
        if (modalBody) {
            modalBody.innerHTML = '';
            
            const info = [
                ['ID', r.id || '-'],
                ['Reportante', r.reporter ? r.reporter.username : 'Desconhecido'],
                ['Alvo', r.reportedUsers?.map(u => u.username).join(', ') || 'N/A'],
                ['Categoria', r.category || '-'],
                ['Descrição', r.description || '-'],
                ['Status', r.status || '-'],
                ['Prioridade', r.priority || '-'],
                ['Data', new Date(r.createdAt).toLocaleDateString('pt-BR')]
            ];
            
            info.forEach(([label, value]) => {
                const p = document.createElement('p');
                const strong = document.createElement('strong');
                strong.textContent = label + ':';
                p.appendChild(strong);
                p.appendChild(document.createTextNode(' ' + escapeHtml(value)));
                modalBody.appendChild(p);
            });
        }
        
        const modalActions = document.getElementById('modal-actions');
        if (modalActions) {
            modalActions.innerHTML = '';
            
            const closeBtn = document.createElement('button');
            closeBtn.className = 'admin-btn';
            closeBtn.textContent = 'Fechar';
            closeBtn.addEventListener('click', closeModal);
            modalActions.appendChild(closeBtn);
            
            if (r.status !== 'resolved') {
                const analyzeBtn = document.createElement('button');
                analyzeBtn.className = 'admin-btn warning';
                analyzeBtn.textContent = 'Analisar';
                analyzeBtn.addEventListener('click', () => changeReportStatus(r.id, 'analyzing'));
                modalActions.appendChild(analyzeBtn);
                
                const resolveBtn = document.createElement('button');
                resolveBtn.className = 'admin-btn success';
                resolveBtn.textContent = 'Resolver';
                resolveBtn.addEventListener('click', () => changeReportStatus(r.id, 'resolved'));
                modalActions.appendChild(resolveBtn);
            }
        }
        
        openModal('Denúncia: ' + escapeHtml(r.id ? r.id.substring(0, 8) : 'Desconhecida'));
    } catch (err) {
        toast(err.message || 'Erro desconhecido', 'error');
    }
}

async function changeReportStatus(reportId, status) {
    try {
        const note = prompt('Nota (opcional):');
        const result = await apiFetch(`${API_BASE}/reports/${encodeURIComponent(reportId || '')}/status`, {
            method: 'POST',
            body: JSON.stringify({ status, note: note || '' }),
            headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'xmlhttprequest' }
        });
        
        if (result.ok) {
            toast('Status alterado com sucesso', 'success');
            closeModal();
            loadReports();
        } else {
            toast(result.error, 'error');
        }
    } catch (err) {
        toast(err.message || 'Erro desconhecido', 'error');
    }
}

// ============ BANS ============
async function loadBans() {
    try {
        const result = await apiFetch(API_BASE + '/bans');
        if (!result.ok) {
            toast(result.error, 'error');
            return;
        }
        
        const data = result.data;
        const tbody = document.getElementById('bans-table');
        if (!tbody) return;
        
        tbody.innerHTML = '';
        
        if (data.bans && Array.isArray(data.bans) && data.bans.length > 0) {
            data.bans.forEach(b => {
                const tr = document.createElement('tr');
                const cells = [
                    b.username || '-',
                    b.reason || '-',
                    b.type || '-',
                    b.endDate ? new Date(b.endDate).toLocaleDateString('pt-BR') : 'Permanente'
                ];
                cells.forEach(cell => {
                    const td = document.createElement('td');
                    td.textContent = escapeHtml(cell);
                    tr.appendChild(td);
                });
                
                // Status badge
                const statusTd = document.createElement('td');
                const badge = document.createElement('span');
                badge.className = `admin-badge ${b.status || 'active'}`;
                badge.textContent = escapeHtml(b.status || 'active');
                statusTd.appendChild(badge);
                tr.appendChild(statusTd);
                
                // Actions
                const actionTd = document.createElement('td');
                const unbanBtn = document.createElement('button');
                unbanBtn.className = 'admin-btn danger';
                unbanBtn.textContent = 'Desbanir';
                unbanBtn.dataset.action = 'unban';
                unbanBtn.dataset.banId = b.id;
                actionTd.appendChild(unbanBtn);
                tr.appendChild(actionTd);
                
                tbody.appendChild(tr);
            });
        } else {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = 6;
            td.textContent = 'Nenhum banimento';
            tr.appendChild(td);
            tbody.appendChild(tr);
        }
    } catch (err) {
        toast(err.message || 'Erro desconhecido', 'error');
    }
}

async function unbanUser(banId) {
    if (!confirm('Desbanir este usuário?')) return;
    
    try {
        const result = await apiFetch(`${API_BASE}/bans/${encodeURIComponent(banId || '')}/unban`, {
            method: 'POST',
            body: '{}',
            headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'xmlhttprequest' }
        });
        
        if (result.ok) {
            toast('Usuário desbanido com sucesso', 'success');
            loadBans();
        } else {
            toast(result.error, 'error');
        }
    } catch (err) {
        toast(err.message || 'Erro desconhecido', 'error');
    }
}

// ============ ADMINISTRATORS ============
async function loadAdministrators() {
    try {
        const result = await apiFetch(API_BASE + '/administrators');
        if (!result.ok) {
            toast(result.error, 'error');
            return;
        }
        
        const data = result.data;
        const tbody = document.getElementById('administrators-table');
        if (!tbody) return;
        
        tbody.innerHTML = '';
        
        if (data.administrators && Array.isArray(data.administrators) && data.administrators.length > 0) {
            data.administrators.forEach(a => {
                const tr = document.createElement('tr');
                const cells = [
                    a.username || '-',
                    a.emailMasked ? a.email : (a.email || '-'),
                    a.role || '-',
                    new Date(a.createdAt).toLocaleDateString('pt-BR')
                ];
                cells.forEach(cell => {
                    const td = document.createElement('td');
                    td.textContent = escapeHtml(cell);
                    tr.appendChild(td);
                });
                
                // Actions
                const actionTd = document.createElement('td');
                const removeBtn = document.createElement('button');
                removeBtn.className = 'admin-btn danger';
                removeBtn.textContent = 'Remover';
                removeBtn.dataset.action = 'remove-admin';
                removeBtn.dataset.userId = a.id;
                actionTd.appendChild(removeBtn);
                tr.appendChild(actionTd);
                
                tbody.appendChild(tr);
            });
        } else {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = 5;
            td.textContent = 'Nenhum administrador';
            tr.appendChild(td);
            tbody.appendChild(tr);
        }
    } catch (err) {
        toast(err.message || 'Erro desconhecido', 'error');
    }
}

async function removeAdmin(userId) {
    if (!confirm('Remover acesso de administrador?')) return;
    
    try {
        const result = await apiFetch(`${API_BASE}/administrators/${encodeURIComponent(userId || '')}`, {
            method: 'DELETE',
            headers: { 'X-Requested-With': 'xmlhttprequest' }
        });
        
        if (result.ok) {
            toast('Admin removido com sucesso', 'success');
            loadAdministrators();
        } else {
            toast(result.error, 'error');
        }
    } catch (err) {
        toast(err.message || 'Erro desconhecido', 'error');
    }
}

// ============ AUDIT LOGS ============
async function loadAuditLogs(page = 1) {
    try {
        currentPage['audit-logs'] = page;
        const result = await apiFetch(`${API_BASE}/audit-logs?page=${page}&limit=20`);
        if (!result.ok) {
            toast(result.error, 'error');
            return;
        }
        
        const data = result.data;
        const tbody = document.getElementById('audit-logs-table');
        if (!tbody) return;
        
        tbody.innerHTML = '';
        
        if (data.logs && Array.isArray(data.logs) && data.logs.length > 0) {
            data.logs.forEach(log => {
                const tr = document.createElement('tr');
                const cells = [
                    log.action || '-',
                    log.adminId ? log.adminId.substring(0, 8) : '-',
                    log.targetUserId ? log.targetUserId.substring(0, 8) : '-',
                    log.details || '-',
                    log.ip || '-',
                    new Date(log.createdAt).toLocaleDateString('pt-BR')
                ];
                cells.forEach(cell => {
                    const td = document.createElement('td');
                    td.textContent = escapeHtml(cell);
                    tr.appendChild(td);
                });
                tbody.appendChild(tr);
            });
        } else {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = 6;
            td.textContent = 'Nenhum log';
            tr.appendChild(td);
            tbody.appendChild(tr);
        }
        
        // Pagination
        const paginationContainer = document.getElementById('audit-logs-pagination');
        if (paginationContainer) {
            paginationContainer.innerHTML = '';
            const pageCount = Math.ceil((data.total || 0) / 20);
            
            for (let i = 1; i <= pageCount; i++) {
                const btn = document.createElement('button');
                btn.textContent = i;
                if (i === page) btn.classList.add('active');
                btn.addEventListener('click', () => loadAuditLogs(i));
                paginationContainer.appendChild(btn);
            }
        }
    } catch (err) {
        toast(err.message || 'Erro desconhecido', 'error');
    }
}

// ============ SETTINGS ============
async function loadSettings() {
    try {
        const result = await apiFetch(API_BASE + '/settings');
        if (!result.ok) {
            toast(result.error, 'error');
            return;
        }
        
        const data = result.data;
        const googleEl = document.getElementById('settings-google');
        if (googleEl) {
            googleEl.value = (data.settings && data.settings.googleEnabled) ? 'Ativado' : 'Desativado';
        }
    } catch (err) {
        toast(err.message || 'Erro desconhecido', 'error');
    }
}

// ============ MODAL ============
function openModal(title) {
    const titleEl = document.getElementById('modal-title');
    const modal = document.getElementById('admin-modal');
    
    if (titleEl) {
        titleEl.textContent = title;
    }
    if (modal) {
        modal.classList.add('open');
    }
}

function closeModal() {
    const modal = document.getElementById('admin-modal');
    if (modal) {
        modal.classList.remove('open');
    }
}

// ============ EVENT DELEGATION ============
document.addEventListener('click', function(e) {
    // View user
    if (e.target.closest('[data-action="view-user"]')) {
        const userId = e.target.closest('[data-action="view-user"]').dataset.userId;
        if (userId) viewUser(userId);
    }
    
    // Ban user
    if (e.target.closest('[data-action="ban-user"]')) {
        const userId = e.target.closest('[data-action="ban-user"]').dataset.userId;
        if (userId) banUserModal(userId);
    }
    
    // View report
    if (e.target.closest('[data-action="view-report"]')) {
        const reportId = e.target.closest('[data-action="view-report"]').dataset.reportId;
        if (reportId) viewReport(reportId);
    }
    
    // Unban
    if (e.target.closest('[data-action="unban"]')) {
        const banId = e.target.closest('[data-action="unban"]').dataset.banId;
        if (banId) unbanUser(banId);
    }
    
    // Remove admin
    if (e.target.closest('[data-action="remove-admin"]')) {
        const userId = e.target.closest('[data-action="remove-admin"]').dataset.userId;
        if (userId) removeAdmin(userId);
    }
});

// ============ INITIALIZATION ============
document.addEventListener('DOMContentLoaded', async () => {
    // Check auth
    const authenticated = await checkAuth();
    if (!authenticated) return;
    
    // Navigation
    document.querySelectorAll('.admin-nav-item').forEach(btn => {
        btn.addEventListener('click', (e) => {
            switchSection(e.target.dataset.section);
        });
    });
    
    // Search
    const searchUsersBtn = document.getElementById('search-users-btn');
    if (searchUsersBtn) {
        searchUsersBtn.addEventListener('click', () => loadUsers(1));
    }
    
    const searchReportsBtn = document.getElementById('search-reports-btn');
    if (searchReportsBtn) {
        searchReportsBtn.addEventListener('click', () => loadReports(1));
    }
    
    const usersSearch = document.getElementById('users-search');
    if (usersSearch) {
        usersSearch.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') loadUsers(1);
        });
    }
    
    const reportsSearch = document.getElementById('reports-search');
    if (reportsSearch) {
        reportsSearch.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') loadReports(1);
        });
    }
    
    // Logout
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', logout);
    }
    
    // New ban
    const newBanBtn = document.getElementById('new-ban-btn');
    if (newBanBtn) {
        newBanBtn.addEventListener('click', () => {
            const identifier = prompt('Email ou usuário para banir:');
            if (identifier && identifier.trim()) banUserModal(identifier);
        });
    }
    
    // Modal close
    const modal = document.getElementById('admin-modal');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target.id === 'admin-modal') closeModal();
        });
    }
    
    // Load dashboard
    loadDashboard();
});
