'use strict';

require('dotenv').config();

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const Database = require('better-sqlite3');
const multer = require('multer');
const { sendEmail, MAIL_FROM } = require('./mailer');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DB_PATH = path.join(DATA_DIR, 'accounts.db');

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const SESSION_TTL = 1000 * 60 * 60 * 24 * 30;
const CAPTCHA_DIFFICULTY = 4;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_ENABLED = Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
const DB_SYNC_TOKEN = process.env.DB_SYNC_TOKEN || '';
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const MAX_UPLOAD_SIZE = 50 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm'];
const ALLOWED_UPLOAD_TYPES = ALLOWED_IMAGE_TYPES.concat(ALLOWED_VIDEO_TYPES);
const ADMIN_MASTER_EMAIL = 'luismetzker9@gmail.com';

const PROTECTED_PAGES = new Set(['/shop.html', '/shop', '/aplicativos.html', '/aplicativos', '/contato.html', '/contato', '/config.html', '/config']);

function isProtected(path) {
  if (!path) return false;
  if (PROTECTED_PAGES.has(path)) return true;
  if (PROTECTED_PAGES.has(path + '.html')) return true;
  return false;
}

function getSecret() {
  const fromEnv = process.env.SESSION_SECRET;
  if (fromEnv && fromEnv.length >= 16) return fromEnv;
  try {
    const existing = fs.readFileSync(path.join(ROOT, '.session-secret'), 'utf8').trim();
    if (existing) return existing;
  } catch (_) {}
  const generated = crypto.randomBytes(48).toString('base64url');
  try {
    fs.writeFileSync(path.join(ROOT, '.session-secret'), generated, { mode: 0o600 });
  } catch (_) {}
  return generated;
}
const SECRET = getSecret();

let db;
function initDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(
    'CREATE TABLE IF NOT EXISTS users (' +
      'id TEXT PRIMARY KEY, ' +
      'username TEXT UNIQUE NOT NULL, ' +
      'email TEXT UNIQUE NOT NULL, ' +
      'passwordHash TEXT NOT NULL, ' +
      'provider TEXT NOT NULL DEFAULT \'local\', ' +
      'googleSub TEXT, ' +
      'createdAt INTEGER NOT NULL)'
  );
  try {
    const jsonPath = path.join(DATA_DIR, 'users.json');
    if (fs.existsSync(jsonPath)) {
      const arr = JSON.parse(fs.readFileSync(jsonPath, 'utf8')).users || [];
      const ins = db.prepare(
        'INSERT OR IGNORE INTO users (id,username,email,passwordHash,provider,googleSub,createdAt) VALUES (?,?,?,?,?,?,?)'
      );
      const tx = db.transaction((us) => {
        for (const u of us) {
          if (u && u.username && u.email) {
            ins.run(
              u.id || crypto.randomBytes(12).toString('hex'),
              String(u.username).toLowerCase(),
              String(u.email).toLowerCase(),
              u.passwordHash || '',
              u.provider || 'local',
              u.googleSub || null,
              u.createdAt || Date.now()
            );
          }
        }
      });
      tx(arr);
      try { fs.renameSync(jsonPath, jsonPath + '.migrated'); } catch (_) {}
    }
  } catch (e) {
    console.error('Falha na migração do JSON:', e);
  }

  // Migrações de esquema (colunas novas em `users`)
  try {
    const cols = db.prepare('PRAGMA table_info(users)').all().map((r) => r.name);
    if (!cols.includes('emailVerified')) {
      db.prepare('ALTER TABLE users ADD COLUMN emailVerified INTEGER NOT NULL DEFAULT 0').run();
    }
    if (!cols.includes('twoFactorEnabled')) {
      db.prepare('ALTER TABLE users ADD COLUMN twoFactorEnabled INTEGER NOT NULL DEFAULT 0').run();
    }
    if (cols.includes('passwordPlain')) {
      try { db.prepare('ALTER TABLE users DROP COLUMN passwordPlain').run(); } catch (_) {}
    }
  } catch (e) {
    console.error('Falha na migração de colunas:', e);
  }

  db.exec(
    'CREATE TABLE IF NOT EXISTS sessions (' +
      'id TEXT PRIMARY KEY, ' +
      'userId TEXT NOT NULL, ' +
      'device TEXT, ' +
      'ip TEXT, ' +
      'location TEXT, ' +
      'createdAt INTEGER NOT NULL, ' +
      'lastSeen INTEGER NOT NULL)'
  );

  db.exec(
    'CREATE TABLE IF NOT EXISTS action_tokens (' +
      'token TEXT PRIMARY KEY, ' +
      'userId TEXT NOT NULL, ' +
      'type TEXT NOT NULL, ' +
      'data TEXT, ' +
      'createdAt INTEGER NOT NULL, ' +
      'expiresAt INTEGER NOT NULL)'
  );

  db.exec(
    'CREATE TABLE IF NOT EXISTS roles (' +
      'id TEXT PRIMARY KEY, ' +
      'name TEXT UNIQUE NOT NULL, ' +
      'description TEXT, ' +
      'isProtected INTEGER NOT NULL DEFAULT 0, ' +
      'createdAt INTEGER NOT NULL)'
  );

  db.exec(
    'CREATE TABLE IF NOT EXISTS permissions (' +
      'id TEXT PRIMARY KEY, ' +
      'name TEXT UNIQUE NOT NULL, ' +
      'description TEXT, ' +
      'category TEXT)'
  );

  db.exec(
    'CREATE TABLE IF NOT EXISTS role_permissions (' +
      'roleId TEXT NOT NULL, ' +
      'permissionId TEXT NOT NULL, ' +
      'PRIMARY KEY (roleId, permissionId))'
  );

  db.exec(
    'CREATE TABLE IF NOT EXISTS user_roles (' +
      'userId TEXT NOT NULL, ' +
      'roleId TEXT NOT NULL, ' +
      'PRIMARY KEY (userId, roleId))'
  );

  db.exec(
    'CREATE TABLE IF NOT EXISTS reports (' +
      'id TEXT PRIMARY KEY, ' +
      'reporterId TEXT NOT NULL, ' +
      'description TEXT, ' +
      'category TEXT, ' +
      'status TEXT NOT NULL DEFAULT \'open\', ' +
      'priority TEXT NOT NULL DEFAULT \'medium\', ' +
      'assignedTo TEXT, ' +
      'createdAt INTEGER NOT NULL, ' +
      'updatedAt INTEGER NOT NULL)'
  );

  db.exec(
    'CREATE TABLE IF NOT EXISTS report_reported_users (' +
      'reportId TEXT NOT NULL, ' +
      'userId TEXT NOT NULL, ' +
      'PRIMARY KEY (reportId, userId))'
  );

  db.exec(
    'CREATE TABLE IF NOT EXISTS report_attachments (' +
      'id TEXT PRIMARY KEY, ' +
      'reportId TEXT NOT NULL, ' +
      'filename TEXT NOT NULL, ' +
      'originalName TEXT NOT NULL, ' +
      'mimeType TEXT NOT NULL, ' +
      'size INTEGER NOT NULL, ' +
      'path TEXT NOT NULL, ' +
      'createdAt INTEGER NOT NULL)'
  );

  db.exec(
    'CREATE TABLE IF NOT EXISTS bans (' +
      'id TEXT PRIMARY KEY, ' +
      'userId TEXT NOT NULL, ' +
      'reason TEXT, ' +
      'adminId TEXT NOT NULL, ' +
      'type TEXT NOT NULL DEFAULT \'temporary\', ' +
      'duration TEXT, ' +
      'startDate INTEGER NOT NULL, ' +
      'endDate INTEGER, ' +
      'status TEXT NOT NULL DEFAULT \'active\', ' +
      'createdAt INTEGER NOT NULL)'
  );

  db.exec(
    'CREATE TABLE IF NOT EXISTS audit_logs (' +
      'id TEXT PRIMARY KEY, ' +
      'adminId TEXT NOT NULL, ' +
      'action TEXT NOT NULL, ' +
      'targetUserId TEXT, ' +
      'details TEXT, ' +
      'ip TEXT, ' +
      'createdAt INTEGER NOT NULL)'
  );

  db.exec(
    'CREATE TABLE IF NOT EXISTS purchases (' +
      'id TEXT PRIMARY KEY, ' +
      'userId TEXT NOT NULL, ' +
      'product TEXT NOT NULL, ' +
      'value REAL NOT NULL, ' +
      'status TEXT NOT NULL DEFAULT \'pending\', ' +
      'transactionId TEXT, ' +
      'createdAt INTEGER NOT NULL)'
  );

  db.exec(
    'CREATE TABLE IF NOT EXISTS email_logs (' +
      'id TEXT PRIMARY KEY, ' +
      'userId TEXT NOT NULL, ' +
      'toEmail TEXT NOT NULL, ' +
      'subject TEXT NOT NULL, ' +
      'status TEXT NOT NULL, ' +
      'createdAt INTEGER NOT NULL)'
  );

  db.exec(
    'CREATE TABLE IF NOT EXISTS security_events (' +
      'id TEXT PRIMARY KEY, ' +
      'userId TEXT, ' +
      'type TEXT NOT NULL, ' +
      'details TEXT, ' +
      'ip TEXT, ' +
      'createdAt INTEGER NOT NULL)'
  );

  db.exec(
    'CREATE TABLE IF NOT EXISTS contacts (' +
      'id TEXT PRIMARY KEY, ' +
      'name TEXT NOT NULL, ' +
      'email TEXT NOT NULL, ' +
      'subject TEXT, ' +
      'message TEXT NOT NULL, ' +
      'status TEXT NOT NULL DEFAULT \'new\', ' +
      'createdAt INTEGER NOT NULL)'
  );

  db.exec('CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_userId ON sessions(userId)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_bans_userId ON bans(userId)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_bans_status ON bans(status)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_audit_logs_createdAt ON audit_logs(createdAt)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_audit_logs_adminId ON audit_logs(adminId)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_purchases_userId ON purchases(userId)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_email_logs_userId ON email_logs(userId)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_security_events_userId ON security_events(userId)');

  try {
    const permCount = db.prepare('SELECT COUNT(*) AS c FROM permissions').get().c;
    if (permCount === 0) {
      const perms = [
        ['dashboard.view', 'Visualizar dashboard', 'Dashboard'],
        ['users.view', 'Visualizar usuários', 'Usuários'],
        ['users.search', 'Pesquisar usuários', 'Usuários'],
        ['users.view_email', 'Ver e-mail de usuários', 'Usuários'],
        ['users.view_sensitive', 'Ver dados sensíveis', 'Usuários'],
        ['users.view_security', 'Ver dados de segurança', 'Usuários'],
        ['users.view_ip', 'Ver IP de usuários', 'Usuários'],
        ['users.view_location', 'Ver localização de usuários', 'Usuários'],
        ['reports.view', 'Visualizar denúncias', 'Denúncias'],
        ['reports.manage', 'Gerenciar denúncias', 'Denúncias'],
        ['reports.delete', 'Excluir denúncias', 'Denúncias'],
        ['bans.create', 'Criar banimentos', 'Banimentos'],
        ['bans.view', 'Visualizar banimentos', 'Banimentos'],
        ['bans.remove', 'Remover banimentos', 'Banimentos'],
        ['contacts.view', 'Visualizar contatos', 'Contatos'],
        ['contacts.manage', 'Gerenciar contatos', 'Contatos'],
        ['purchases.view', 'Visualizar compras', 'Compras'],
        ['email_logs.view', 'Visualizar logs de e-mail', 'Emails'],
        ['sessions.view', 'Visualizar sessões', 'Sessões'],
        ['sessions.revoke', 'Revogar sessões', 'Sessões'],
        ['roles.view', 'Visualizar cargos', 'Cargos'],
        ['roles.create', 'Criar cargos', 'Cargos'],
        ['roles.edit', 'Editar cargos', 'Cargos'],
        ['roles.delete', 'Excluir cargos', 'Cargos'],
        ['admins.create', 'Criar administradores', 'Administradores'],
        ['admins.remove', 'Remover administradores', 'Administradores'],
        ['admins.edit', 'Editar administradores', 'Administradores'],
        ['audit_logs.view', 'Visualizar logs de auditoria', 'Logs'],
        ['settings.view', 'Visualizar configurações', 'Configurações'],
        ['settings.edit', 'Editar configurações', 'Configurações'],
      ];
      const insPerm = db.prepare('INSERT INTO permissions (id,name,description,category) VALUES (?,?,?,?)');
      const txPerm = db.transaction(() => {
        for (const [name, desc, cat] of perms) {
          insPerm.run(crypto.randomBytes(8).toString('hex'), name, desc, cat);
        }
      });
      txPerm();
    }

    const rolesCount = db.prepare('SELECT COUNT(*) AS c FROM roles').get().c;
    if (rolesCount === 0) {
      const masterRoleId = crypto.randomBytes(8).toString('hex');
      const adminRoleId = crypto.randomBytes(8).toString('hex');
      const employeeRoleId = crypto.randomBytes(8).toString('hex');
      db.prepare('INSERT INTO roles (id,name,description,isProtected,createdAt) VALUES (?,?,?,?,?)').run(masterRoleId, 'Admin Master', 'Acesso total ao sistema', 1, Date.now());
      db.prepare('INSERT INTO roles (id,name,description,isProtected,createdAt) VALUES (?,?,?,?,?)').run(adminRoleId, 'Admin', 'Administrador com permissões configuradas', 1, Date.now());
      db.prepare('INSERT INTO roles (id,name,description,isProtected,createdAt) VALUES (?,?,?,?,?)').run(employeeRoleId, 'Funcionario', 'Funcionário com permissões limitadas', 1, Date.now());

      const insRP = db.prepare('INSERT OR IGNORE INTO role_permissions (roleId, permissionId) VALUES (?,?)');
      const allPerms = db.prepare('SELECT id FROM permissions').all().map((r) => r.id);
      const txAll = db.transaction(() => {
        for (const pid of allPerms) {
          insRP.run(masterRoleId, pid);
        }
      });
      txAll();

      const adminPerms = db.prepare('SELECT id FROM permissions WHERE name IN (\'dashboard.view\',\'users.view\',\'users.search\',\'reports.view\',\'reports.manage\',\'bans.view\',\'bans.create\',\'contacts.view\',\'purchases.view\',\'sessions.view\',\'audit_logs.view\',\'settings.view\')').all().map((r) => r.id);
      const txAdmin = db.transaction(() => {
        for (const pid of adminPerms) {
          insRP.run(adminRoleId, pid);
        }
      });
      txAdmin();

      const employeePerms = db.prepare('SELECT id FROM permissions WHERE name IN (\'dashboard.view\',\'users.view\',\'contacts.view\',\'purchases.view\')').all().map((r) => r.id);
      const txEmp = db.transaction(() => {
        for (const pid of employeePerms) {
          insRP.run(employeeRoleId, pid);
        }
      });
      txEmp();
    } else {
      const masterRole = db.prepare('SELECT id FROM roles WHERE name = \'Admin Master\'').get();
      if (!masterRole) {
        const id = crypto.randomBytes(8).toString('hex');
        db.prepare('INSERT INTO roles (id,name,description,isProtected,createdAt) VALUES (?,?,?,?,?)').run(id, 'Admin Master', 'Acesso total ao sistema', 1, Date.now());
        const allPerms = db.prepare('SELECT id FROM permissions').all().map((r) => r.id);
        const insRP = db.prepare('INSERT OR IGNORE INTO role_permissions (roleId, permissionId) VALUES (?,?)');
        const tx = db.transaction(() => {
          for (const pid of allPerms) {
            insRP.run(id, pid);
          }
        });
        tx();
      }
      const adminRole = db.prepare('SELECT id FROM roles WHERE name = \'Admin\'').get();
      if (!adminRole) {
        const id = crypto.randomBytes(8).toString('hex');
        db.prepare('INSERT INTO roles (id,name,description,isProtected,createdAt) VALUES (?,?,?,?,?)').run(id, 'Admin', 'Administrador com permissões configuradas', 1, Date.now());
      }
      const employeeRole = db.prepare('SELECT id FROM roles WHERE name = \'Funcionario\'').get();
      if (!employeeRole) {
        const id = crypto.randomBytes(8).toString('hex');
        db.prepare('INSERT INTO roles (id,name,description,isProtected,createdAt) VALUES (?,?,?,?,?)').run(id, 'Funcionario', 'Funcionário com permissões limitadas', 1, Date.now());
      }
    }

    const masterUser = findByEmail(ADMIN_MASTER_EMAIL);
    if (masterUser) {
      const masterRole = db.prepare('SELECT id FROM roles WHERE name = \'Admin Master\'').get();
      if (masterRole) {
        db.prepare('INSERT OR IGNORE INTO user_roles (userId, roleId) VALUES (?,?)').run(masterUser.id, masterRole.id);
      }
    }
  } catch (e) {
    console.error('Falha ao semear dados admin:', e);
  }
}

function rowToUser(r) {
  if (!r) return null;
  return {
    id: r.id,
    username: r.username,
    email: r.email,
    passwordHash: r.passwordHash,
    provider: r.provider,
    googleSub: r.googleSub,
    createdAt: r.createdAt,
    emailVerified: Boolean(r.emailVerified),
    twoFactorEnabled: Boolean(r.twoFactorEnabled),
  };
}
function findUserById(id) {
  return rowToUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
}
function findByEmail(e) {
  return rowToUser(db.prepare('SELECT * FROM users WHERE email = ?').get(String(e).toLowerCase()));
}
function findByUsername(u) {
  return rowToUser(db.prepare('SELECT * FROM users WHERE username = ?').get(String(u).toLowerCase()));
}
function findByGoogle(sub) {
  return rowToUser(db.prepare('SELECT * FROM users WHERE googleSub = ?').get(sub));
}
function createUser(u) {
  db.prepare(
    'INSERT INTO users (id,username,email,passwordHash,provider,googleSub,createdAt) VALUES (?,?,?,?,?,?,?)'
  ).run(u.id, u.username.toLowerCase(), u.email.toLowerCase(), u.passwordHash, u.provider, u.googleSub || null, u.createdAt);
}
function updatePasswordHash(id, hash) {
  db.prepare('UPDATE users SET passwordHash = ? WHERE id = ?').run(hash, id);
}
function linkGoogle(id, sub) {
  db.prepare('UPDATE users SET googleSub = ? WHERE id = ?').run(sub, id);
}
function countUsers() {
  const row = db.prepare('SELECT COUNT(*) AS c FROM users').get();
  return row ? row.c : 0;
}

function initUploadDir() {
  try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (_) {}
}
const upload = multer({
  storage: multer.diskStorage({
    filename: function (req, file, cb) {
      const ext = path.extname(file.originalname || '').toLowerCase();
      const safeName = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_');
      cb(null, crypto.randomBytes(12).toString('hex') + '_' + Date.now() + ext);
    },
  }),
  limits: { fileSize: MAX_UPLOAD_SIZE },
  fileFilter: function (req, file, cb) {
    const allowed = ALLOWED_UPLOAD_TYPES;
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Tipo de arquivo não permitido.'), false);
    }
  },
});

function ensureMasterRole(userId) {
  if (!userId) return false;
  const user = findUserById(userId);
  if (!user || String(user.email).toLowerCase() !== ADMIN_MASTER_EMAIL.toLowerCase()) return false;
  const role = db.prepare('SELECT id FROM roles WHERE name = ?').get('Admin Master');
  if (!role) return false;
  db.prepare('INSERT OR IGNORE INTO user_roles (userId, roleId) VALUES (?, ?)').run(userId, role.id);
  return true;
}

function getUserRoles(userId) {
  if (userId) ensureMasterRole(userId);
  return db.prepare('SELECT r.id, r.name, r.isProtected FROM user_roles ur JOIN roles r ON r.id = ur.roleId WHERE ur.userId = ?').all(userId);
}

function getUserPermissions(userId) {
  if (userId) ensureMasterRole(userId);
  return db.prepare('SELECT DISTINCT p.name FROM user_roles ur JOIN role_permissions rp ON rp.roleId = ur.roleId JOIN permissions p ON p.id = rp.permissionId WHERE ur.userId = ?').all(userId).map((r) => r.name);
}

function hasPermission(userId, perm) {
  if (!userId) return false;
  const master = db.prepare('SELECT r.id FROM user_roles ur JOIN roles r ON r.id = ur.roleId WHERE ur.userId = ? AND r.name = \'Admin Master\'').get(userId);
  if (master) return true;
  const perms = getUserPermissions(userId);
  return perms.includes(perm);
}

function isAdminUser(userId) {
  if (!userId) return false;
  const adminRole = db.prepare('SELECT r.id FROM user_roles ur JOIN roles r ON r.id = ur.roleId WHERE ur.userId = ? AND r.name IN (\'Admin Master\', \'Admin\', \'Funcionario\')').get(userId);
  if (adminRole) return true;
  return hasPermission(userId, 'dashboard.view');
}

function maskEmail(email) {
  if (!email || typeof email !== 'string') return '***';
  const parts = email.split('@');
  if (parts.length !== 2) return '***';
  const name = parts[0];
  const domain = parts[1];
  if (name.length <= 2) return name[0] + '***@' + domain;
  return name[0] + '******' + name[name.length - 1] + '@' + domain;
}

function auditLog(adminId, action, targetUserId, details, ip) {
  try {
    db.prepare('INSERT INTO audit_logs (id, adminId, action, targetUserId, details, ip, createdAt) VALUES (?,?,?,?,?,?,?)').run(crypto.randomBytes(12).toString('hex'), adminId, action, targetUserId || null, details || null, ip || null, Date.now());
  } catch (_) {}
}

function isBanned(userId) {
  if (!userId) return false;
  const ban = db.prepare('SELECT * FROM bans WHERE userId = ? AND status = \'active\' AND (endDate IS NULL OR endDate > ?)').get(userId, Date.now());
  return !!ban;
}

function getActiveBan(userId) {
  if (!userId) return null;
  return db.prepare('SELECT * FROM bans WHERE userId = ? AND status = \'active\' AND (endDate IS NULL OR endDate > ?)').get(userId, Date.now()) || null;
}

function banCheckMiddleware(req, res, next) {
  const u = getUserFromReq(req);
  if (!u) return next();
  const ban = getActiveBan(u.id);
  if (ban) {
    const endDate = ban.endDate ? new Date(ban.endDate).toLocaleString('pt-BR') : 'Permanente';
    const html =
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Conta suspensa</title>' +
      '<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#000;color:#00ffea;font-family:Arial,sans-serif;padding:20px;text-align:center;}' +
      '.card{background:rgba(0,0,0,0.8);border:2px solid #00ffea;border-radius:12px;padding:40px;max-width:600px;}' +
      'h1{font-size:24px;margin-bottom:20px;}p{font-size:14px;line-height:1.8;color:#7fffe9;}' +
      '.reason{background:rgba(0,0,0,0.6);border:1px solid rgba(0,255,234,0.3);border-radius:8px;padding:16px;margin:20px 0;}' +
      '.end{color:#fff;font-weight:bold;margin-top:20px;}</style></head><body>' +
      '<div class="card"><h1>Conta Suspensa</h1>' +
      '<p>Sua conta foi suspensa por violação das regras.</p>' +
      '<div class="reason"><p><strong>Motivo:</strong> ' + escapeHtml(ban.reason || 'Não especificado') + '</p>' +
      '<p class="end"><strong>Término:</strong> ' + endDate + '</p></div>' +
      '<p>Se acredita que isso é um erro, entre em contato conosco.</p></div></body></html>';
    if (req.path.startsWith('/api') || req.get('accept')?.includes('application/json')) {
      return res.status(403).json({ error: 'Conta suspensa.', ban: { reason: ban.reason, endDate } });
    }
    return res.status(403).send(html);
  }
  next();
}

function requireAuth(req, res, next) {
  const u = getUserFromReq(req);
  if (!u) return res.status(401).json({ error: 'Não autenticado.' });
  req.user = u;
  next();
}

function requireAdmin(req, res, next) {
  const u = getUserFromReq(req);
  if (!u) return res.status(401).json({ error: 'Não autenticado.' });
  if (!isAdminUser(u.id)) return res.status(403).json({ error: 'Sem permissão para acessar o painel administrativo.' });
  req.user = u;
  next();
}

function requirePermission(perm) {
  return function (req, res, next) {
    const u = req.user || getUserFromReq(req);
    if (!u) return res.status(401).json({ error: 'Não autenticado.' });
    if (!isAdminUser(u.id)) return res.status(403).json({ error: 'Sem permissão para acessar o painel administrativo.' });
    if (!hasPermission(u.id, perm)) return res.status(403).json({ error: 'Sem permissão para esta ação.' });
    req.user = u;
    next();
  };
}

function sanitizeUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    emailVerified: Boolean(u.emailVerified),
    twoFactorEnabled: Boolean(u.twoFactorEnabled),
    provider: u.provider,
    createdAt: u.createdAt,
  };
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function deviceFromReq(req) {
  const ua = (req.get('user-agent') || '').toLowerCase();
  if (/iphone/.test(ua)) return 'iPhone';
  if (/ipad/.test(ua)) return 'iPad';
  if (/android/.test(ua)) return 'Android';
  if (/windows phone/.test(ua)) return 'Windows Phone';
  if (/windows/.test(ua)) return 'Windows';
  if (/macintosh|mac os x/.test(ua)) return 'Mac';
  if (/linux/.test(ua)) return 'Linux';
  if (/crawl|bot|spider/.test(ua)) return 'Bot';
  return 'Dispositivo desconhecido';
}

function approxLocation(ip) {
  if (!ip) return 'Local';
  if (ip === '::1' || ip === '127.0.0.1' || ip === '::ffff:127.0.0.1') return 'Rede local (aprox.)';
  if (
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    ip.startsWith('172.16.') ||
    ip.startsWith('172.17.') ||
    ip.startsWith('172.18.') ||
    ip.startsWith('172.19.') ||
    ip.startsWith('172.2') ||
    ip.startsWith('172.3')
  ) {
    return 'Rede local (aprox.)';
  }
  const parts = ip.split('.');
  if (parts.length === 4) return `IP ${parts[0]}.${parts[1]}.xx.xx (aprox.)`;
  return `IP ${ip} (aprox.)`;
}

function createSession(uid, device, ip) {
  const sid = crypto.randomBytes(24).toString('hex');
  const now = Date.now();
  db.prepare(
    'INSERT INTO sessions (id, userId, device, ip, location, createdAt, lastSeen) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(sid, uid, device || 'Desconhecido', ip || '', approxLocation(ip), now, now);
  return sid;
}

function deleteSession(sid) {
  if (!sid) return;
  try {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sid);
  } catch (_) {}
}

function createActionToken(userId, type, data, ttlMs) {
  const token = crypto.randomBytes(24).toString('hex');
  const now = Date.now();
  db.prepare(
    'INSERT INTO action_tokens (token, userId, type, data, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(token, userId, type, data ? JSON.stringify(data) : null, now, now + (ttlMs || 30 * 60 * 1000));
  return token;
}

function consumeActionToken(token) {
  if (!token || typeof token !== 'string') return null;
  const row = db.prepare('SELECT * FROM action_tokens WHERE token = ?').get(token);
  if (!row) return null;
  db.prepare('DELETE FROM action_tokens WHERE token = ?').run(token);
  if (row.expiresAt < Date.now()) return null;
  let data = null;
  if (row.data) {
    try {
      data = JSON.parse(row.data);
    } catch (_) {
      data = null;
    }
  }
  return { type: row.type, userId: row.userId, data };
}

function baseUrlFromReq(req) {
  return req.protocol + '://' + req.get('host');
}

async function sendMailOrFail(res, mailOptions) {
  try {
    const r = await sendEmail(mailOptions);
    if (!r.ok) {
      if (res && typeof res.status === 'function' && !res.headersSent) {
        res.status(502).json({ error: r.error || 'Não foi possível enviar o e-mail. Tente novamente mais tarde.' });
      }
      return r;
    }
    return r;
  } catch (e) {
    console.error('[mail] erro inesperado ao enviar:', e);
    if (res && typeof res.status === 'function' && !res.headersSent) {
      res.status(502).json({ error: 'Não foi possível enviar o e-mail. Tente novamente mais tarde.' });
    }
    return { ok: false, error: 'erro inesperado' };
  }
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, 64);
  return 'scrypt$' + salt.toString('hex') + '$' + derived.toString('hex');
}

function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || !stored.startsWith('scrypt$')) return false;
  const parts = stored.split('$');
  if (parts.length !== 3) return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  const derived = crypto.scryptSync(password, salt, 64);
  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}

function base64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function signSession(sid, uid) {
  const payload = base64url(
    JSON.stringify({ sid, uid, iat: Date.now(), exp: Date.now() + SESSION_TTL })
  );
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  return payload + '.' + sig;
}

function verifySession(token) {
  if (!token || typeof token !== 'string') return null;
  const idx = token.lastIndexOf('.');
  if (idx < 0) return null;
  const payload = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let data;
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch (_) {
    return null;
  }
  if (!data || typeof data.uid !== 'string' || !data.exp || data.exp < Date.now()) return null;
  return data;
}

const captchas = new Map();
function issueCaptcha() {
  const token = crypto.randomBytes(16).toString('hex');
  const challenge = crypto.randomBytes(16).toString('hex');
  captchas.set(token, { challenge, difficulty: CAPTCHA_DIFFICULTY, exp: Date.now() + 5 * 60 * 1000 });
  return { token, challenge, difficulty: CAPTCHA_DIFFICULTY };
}
function verifyCaptcha(token, nonce) {
  const c = captchas.get(token);
  if (!c) return false;
  if (c.exp < Date.now()) {
    captchas.delete(token);
    return false;
  }
  if (typeof nonce !== 'string' || !/^\d{1,12}$/.test(nonce)) return false;
  const h = crypto.createHash('sha256').update(c.challenge + ':' + nonce).digest('hex');
  const ok = h.startsWith('0'.repeat(c.difficulty));
  if (ok) captchas.delete(token);
  return ok;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of captchas) if (v.exp < now) captchas.delete(k);
}, 60 * 1000).unref();

// Auto-expire temporary bans
setInterval(() => {
  try {
    const now = Date.now();
    db.prepare('UPDATE bans SET status = \'expired\' WHERE status = \'active\' AND endDate IS NOT NULL AND endDate < ?').run(now);
  } catch (_) {}
}, 60 * 1000).unref();

const rateLimits = new Map();
function checkRateLimit(key, max, windowMs) {
  const now = Date.now();
  const rec = rateLimits.get(key);
  if (!rec || rec.reset < now) {
    rateLimits.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  rec.count++;
  return rec.count <= max;
}

const accountLocks = new Map();
function isLocked(key) {
  const until = accountLocks.get(key);
  return until && until > Date.now();
}
function lockAccount(key, ms) {
  accountLocks.set(key, Date.now() + ms);
}

function validUsername(u) {
  return typeof u === 'string' && /^[a-zA-Z0-9_]{3,20}$/.test(u);
}
function validEmail(e) {
  return typeof e === 'string' && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}
function validPassword(p) {
  return typeof p === 'string' && p.length >= 8 && p.length <= 128 && /[A-Za-z]/.test(p) && /\d/.test(p);
}

function userPublic(u) {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    provider: u.provider || 'local',
    emailVerified: Boolean(u.emailVerified),
    twoFactorEnabled: Boolean(u.twoFactorEnabled),
  };
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'"
  );
  next();
});

app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: false, limit: '64kb' }));

function antiCsrf(req, res, next) {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    if (req.get('x-requested-with') !== 'xmlhttprequest') {
      return res.status(403).json({ error: 'Requisição inválida.' });
    }
  }
  next();
}
app.use(antiCsrf);

function parseCookies(req) {
  const header = req.get('cookie');
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    try {
      out[k] = decodeURIComponent(v);
    } catch (_) {
      out[k] = v;
    }
  }
  return out;
}

function getUserFromReq(req) {
  const cookies = parseCookies(req);
  const data = verifySession(cookies.sid);
  if (!data || !data.sid) return null;
  const sess = db.prepare('SELECT * FROM sessions WHERE id = ?').get(data.sid);
  if (!sess) return null;
  if (Date.now() - sess.lastSeen > 60000) {
    try {
      db.prepare('UPDATE sessions SET lastSeen = ? WHERE id = ?').run(Date.now(), sess.id);
    } catch (_) {}
  }
  const user = findUserById(sess.userId);
  if (user) ensureMasterRole(user.id);
  return user || null;
}

function setSessionCookie(res, uid, req) {
  const sid = createSession(uid, deviceFromReq(req), req && req.ip);
  res.cookie('sid', signSession(sid, uid), {
    httpOnly: true,
    sameSite: 'lax',
    secure: NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL,
  });
}
function clearSessionCookie(res) {
  res.cookie('sid', '', { httpOnly: true, sameSite: 'lax', secure: NODE_ENV === 'production', path: '/', maxAge: 0 });
}

const api = express.Router();

api.get('/config', (req, res) => {
  res.json({ googleEnabled: GOOGLE_ENABLED });
});

api.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), db: DB_SYNC_TOKEN ? 'configured' : 'no-sync' });
});

api.get('/test-email', async (req, res) => {
  const { sendEmail } = require('./mailer');
  const r = await sendEmail({
    to: req.query.to || 'test@example.com',
    subject: 'Teste de e-mail - The Gods Studio',
    html: '<p>Este é um e-mail de teste.</p>',
  });
  res.json(r);
});

api.get('/captcha', (req, res) => {
  res.json(issueCaptcha());
});

api.get('/me', (req, res) => {
  const u = getUserFromReq(req);
  if (!u) return res.status(401).json({ authenticated: false });
  const roles = getUserRoles(u.id);
  const perms = getUserPermissions(u.id);
  res.json({ authenticated: true, user: userPublic(u), roles: roles.map((r) => r.name), permissions: perms });
});

api.post('/signup', (req, res) => {
  try {
    const ip = req.ip;
    if (!checkRateLimit('signup:' + ip, 10, 15 * 60 * 1000)) {
      return res.status(429).json({ error: 'Muitas tentativas. Tente novamente mais tarde.' });
    }
    const body = req.body || {};
    const honeypot = body.hp;
    if (typeof honeypot === 'string' && honeypot.length > 0) {
      return res.status(400).json({ error: 'Cadastro inválido.' });
    }
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const confirm = typeof body.confirm === 'string' ? body.confirm : '';

    if (!validUsername(username)) {
      return res.status(400).json({ error: 'Nome de usuário deve ter 3 a 20 caracteres (letras, números ou _).' });
    }
    if (!validEmail(email)) {
      return res.status(400).json({ error: 'Informe um e-mail válido.' });
    }
    if (!validPassword(password)) {
      return res.status(400).json({ error: 'A senha precisa ter ao menos 8 caracteres, com letras e números.' });
    }
    if (password !== confirm) {
      return res.status(400).json({ error: 'As senhas não coincidem.' });
    }
    if (findByUsername(username)) {
      return res.status(409).json({ error: 'Este nome de usuário já está em uso.' });
    }
    if (findByEmail(email)) {
      return res.status(409).json({ error: 'Este e-mail já está cadastrado.' });
    }

    const user = {
      id: crypto.randomBytes(12).toString('hex'),
      username: username.toLowerCase(),
      email,
      passwordHash: hashPassword(password),
      provider: 'local',
      createdAt: Date.now(),
    };
    createUser(user);
    setSessionCookie(res, user.id, req);
    return res.json({ ok: true, user: userPublic(user) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro interno. Tente novamente.' });
  }
});

  api.post('/login', async (req, res) => {
    try {
      const ip = req.ip;
      if (!checkRateLimit('login:' + ip, 20, 15 * 60 * 1000)) {
        return res.status(429).json({ error: 'Muitas tentativas. Tente novamente mais tarde.' });
      }
      const body = req.body || {};
      const honeypot = body.hp;
      if (typeof honeypot === 'string' && honeypot.length > 0) {
        return res.status(400).json({ error: 'Requisição inválida.' });
      }
      const identifier = typeof body.identifier === 'string' ? body.identifier.trim().toLowerCase() : '';
      const password = typeof body.password === 'string' ? body.password : '';

      if (!identifier || !password) {
        return res.status(400).json({ error: 'Informe e-mail/usuário e senha.' });
      }

      const user = findByEmail(identifier) || findByUsername(identifier);
      if (!user || user.provider !== 'local') {
        return res.status(401).json({ error: 'E-mail ou senha inválidos.' });
      }
      const ban = getActiveBan(user.id);
      if (ban) {
        const endDate = ban.endDate ? new Date(ban.endDate).toLocaleString('pt-BR') : 'Permanente';
        return res.status(403).json({ error: 'Conta suspensa. Motivo: ' + (ban.reason || 'Não especificado') + '. Término: ' + endDate });
      }
      const lockKey = 'acct:' + user.id;
    if (isLocked(lockKey)) {
      return res.status(429).json({ error: 'Conta temporariamente bloqueada por segurança. Tente mais tarde.' });
    }
    if (!verifyPassword(password, user.passwordHash)) {
      const fails = (accountLocks.get('fail:' + lockKey) || 0) + 1;
      if (fails >= 5) {
        accountLocks.set('fail:' + lockKey, 0);
        lockAccount(lockKey, 15 * 60 * 1000);
      } else {
        accountLocks.set('fail:' + lockKey, fails);
      }
      return res.status(401).json({ error: 'E-mail ou senha inválidos.' });
    }
    accountLocks.set('fail:' + lockKey, 0);

    if (user.twoFactorEnabled) {
      const token = createActionToken(user.id, 'two_factor', null, 15 * 60 * 1000);
      const link = baseUrlFromReq(req) + '/api/action/' + token;
      const r = await sendMailOrFail(res, {
        to: user.email,
        subject: 'Verificação de login - The Gods Studio',
        html: emailTwoFactorHtml(link),
      });
      if (!r.ok) return;
      return res.json({
        ok: true,
        twoFactor: true,
        message:
          'Enviamos um link de verificação para o seu e-mail. Abra-o para concluir o login com segurança.',
      });
    }

    setSessionCookie(res, user.id, req);
    return res.json({ ok: true, user: userPublic(user) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro interno. Tente novamente.' });
  }
});

api.post('/logout', (req, res) => {
  const cookies = parseCookies(req);
  const data = verifySession(cookies.sid);
  if (data && data.sid) deleteSession(data.sid);
  clearSessionCookie(res);
  res.json({ ok: true });
});

/* === TEMPLATES DE E-MAIL (tema The Gods Studio) === */
function emailShell(title, bodyHtml) {
  return (
    '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' +
    title +
    '</title></head>' +
    '<body style="margin:0;background:#021a1a;font-family:Arial,Helvetica,sans-serif;padding:24px;">' +
    '<div style="max-width:520px;margin:0 auto;background:rgba(0,0,0,0.6);border:2px solid #00ffea;border-radius:12px;padding:28px;color:#00ffea;">' +
    '<h1 style="font-size:20px;letter-spacing:1px;text-shadow:0 0 12px rgba(0,255,234,0.5);margin:0 0 18px;">' +
    title +
    '</h1>' +
    bodyHtml +
    '<p style="font-size:12px;color:#7fffe9;opacity:0.7;margin-top:24px;">The Gods Studio — se você não solicitou isso, ignore este e-mail.</p>' +
    '</div></body></html>'
  );
}
function emailButton(label, url) {
  return (
    '<a href="' +
    url +
    '" style="display:inline-block;margin:14px 0;padding:12px 22px;background:linear-gradient(135deg,#00ffea,#00c8b4);color:#000;text-decoration:none;border-radius:8px;font-weight:bold;">' +
    label +
    '</a>'
  );
}
function emailVerifyHtml(link) {
  return emailShell(
    'Confirme seu e-mail',
    '<p style="line-height:1.6;">Olá! Confirme que este e-mail pertence a você clicando no botão abaixo. Isso ativa a verificação da sua conta.</p>' +
      emailButton('Verificar e-mail', link) +
      '<p style="font-size:12px;word-break:break-all;color:#7fffe9;">Ou copie: ' +
      link +
      '</p>'
  );
}
function emailChangeEmailHtml(link) {
  return emailShell(
    'Confirmar troca de e-mail',
    '<p style="line-height:1.6;">Recebemos um pedido para alterar o e-mail da sua conta. Clique abaixo para autorizar a troca.</p>' +
      emailButton('Autorizar troca', link)
  );
}
function emailChangePasswordHtml(link) {
  return emailShell(
    'Confirmar troca de senha',
    '<p style="line-height:1.6;">Recebemos um pedido para alterar a senha da sua conta. Clique abaixo para autorizar a alteração.</p>' +
      emailButton('Autorizar alteração', link)
  );
}
function emailResetHtml(link) {
  return emailShell(
    'Redefinir senha',
    '<p style="line-height:1.6;">Recebemos um pedido para redefinir a senha da sua conta. Clique abaixo para criar uma nova senha.</p>' +
      emailButton('Redefinir senha', link)
  );
}
function emailTwoFactorHtml(link) {
  return emailShell(
    'Verificação de login',
    '<p style="line-height:1.6;">Alguém está tentando entrar na sua conta. Se foi você, confirme o login clicando abaixo.</p>' +
      emailButton('Confirmar login', link)
  );
}
function emailDisconnectHtml(link) {
  return emailShell(
    'Confirmar desconexão',
    '<p style="line-height:1.6;">Recebemos um pedido para desconectar um dispositivo da sua conta. Clique abaixo para confirmar (isso protege você contra acessos não autorizados).</p>' +
      emailButton('Confirmar desconexão', link)
  );
}
function emailDisconnectAllHtml(link) {
  return emailShell(
    'Confirmar desconexão de todos os dispositivos',
    '<p style="line-height:1.6;">Recebemos um pedido para desconectar TODOS os dispositivos da sua conta. Clique abaixo para confirmar.</p>' +
      emailButton('Desconectar todos', link)
  );
}

/* === ROTAS DE CONTA (protegidas) === */
const accountApi = express.Router();

accountApi.post('/request-verify-email', async (req, res) => {
  try {
    const u = getUserFromReq(req);
    if (!u) return res.status(401).json({ error: 'Não autenticado.' });
    if (u.emailVerified) return res.json({ ok: true, alreadyVerified: true });
    const token = createActionToken(u.id, 'verify_email', null, 60 * 60 * 1000);
    const link = baseUrlFromReq(req) + '/api/action/' + token;
    const r = await sendMailOrFail(res, { to: u.email, subject: 'Confirme seu e-mail - The Gods Studio', html: emailVerifyHtml(link) });
    if (!r.ok) return;
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno. Tente novamente.' });
  }
});

accountApi.post('/request-change-email', async (req, res) => {
  try {
    const u = getUserFromReq(req);
    if (!u) return res.status(401).json({ error: 'Não autenticado.' });
    const token = createActionToken(u.id, 'change_email', null, 30 * 60 * 1000);
    const link = baseUrlFromReq(req) + '/config.html?action=change_email&token=' + token;
    const r = await sendMailOrFail(res, { to: u.email, subject: 'Confirmar alteração de e-mail', html: emailChangeEmailHtml(link) });
    if (!r.ok) return;
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno. Tente novamente.' });
  }
});

accountApi.post('/change-email', async (req, res) => {
  try {
    const u = getUserFromReq(req);
    if (!u) return res.status(401).json({ error: 'Não autenticado.' });
    const body = req.body || {};
    const token = typeof body.token === 'string' ? body.token : '';
    const newEmail = typeof body.newEmail === 'string' ? body.newEmail.trim().toLowerCase() : '';
    const action = consumeActionToken(token);
    if (!action || action.type !== 'change_email' || action.userId !== u.id) {
      return res.status(400).json({ error: 'Link inválido ou expirado.' });
    }
    if (!validEmail(newEmail)) return res.status(400).json({ error: 'Informe um e-mail válido.' });
    const existing = findByEmail(newEmail);
    if (existing && existing.id !== u.id) return res.status(409).json({ error: 'Este e-mail já está em uso.' });
    db.prepare('UPDATE users SET email = ?, emailVerified = 0 WHERE id = ?').run(newEmail, u.id);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno. Tente novamente.' });
  }
});

accountApi.post('/request-change-password', async (req, res) => {
  try {
    const u = getUserFromReq(req);
    if (!u) return res.status(401).json({ error: 'Não autenticado.' });
    const token = createActionToken(u.id, 'change_password', null, 30 * 60 * 1000);
    const link = baseUrlFromReq(req) + '/config.html?action=change_password&token=' + token;
    const r = await sendMailOrFail(res, { to: u.email, subject: 'Confirmar alteração de senha', html: emailChangePasswordHtml(link) });
    if (!r.ok) return;
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno. Tente novamente.' });
  }
});

accountApi.post('/forgot-password', async (req, res) => {
  try {
    const body = req.body || {};
    let u = getUserFromReq(req);
    if (!u) {
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (!validEmail(email)) return res.status(400).json({ error: 'Informe um e-mail válido.' });
      u = findByEmail(email);
      if (!u) return res.status(404).json({ error: 'Nenhuma conta encontrada para este e-mail.' });
    }
    const token = createActionToken(u.id, 'reset_password', null, 30 * 60 * 1000);
    const link = baseUrlFromReq(req) + '/config.html?action=reset_password&token=' + token;
    const r = await sendMailOrFail(res, { to: u.email, subject: 'Redefinir senha - The Gods Studio', html: emailResetHtml(link) });
    if (!r.ok) return;
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno. Tente novamente.' });
  }
});

accountApi.post('/set-password', async (req, res) => {
  try {
    const u = getUserFromReq(req);
    if (!u) return res.status(401).json({ error: 'Não autenticado.' });
    const body = req.body || {};
    const token = typeof body.token === 'string' ? body.token : '';
    const next = typeof body.next === 'string' ? body.next : '';
    const action = consumeActionToken(token);
    if (!action || (action.type !== 'change_password' && action.type !== 'reset_password') || action.userId !== u.id) {
      return res.status(400).json({ error: 'Link inválido ou expirado.' });
    }
    if (!validPassword(next)) {
      return res.status(400).json({ error: 'A senha precisa ter ao menos 8 caracteres, com letras e números.' });
    }
    updatePasswordHash(u.id, hashPassword(next));
    const cookies = parseCookies(req);
    const cur = verifySession(cookies.sid);
    if (cur && cur.sid) {
      try {
        db.prepare('DELETE FROM sessions WHERE userId = ? AND id != ?').run(u.id, cur.sid);
      } catch (_) {}
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno. Tente novamente.' });
  }
});

accountApi.post('/change-username', async (req, res) => {
  try {
    const u = getUserFromReq(req);
    if (!u) return res.status(401).json({ error: 'Não autenticado.' });
    const body = req.body || {};
    const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
    if (!validUsername(username)) {
      return res.status(400).json({ error: 'Nome de usuário deve ter 3 a 20 caracteres (letras, números ou _).' });
    }
    const existing = findByUsername(username);
    if (existing && existing.id !== u.id) return res.status(409).json({ error: 'Este nome de usuário já está em uso.' });
    db.prepare('UPDATE users SET username = ? WHERE id = ?').run(username, u.id);
    res.json({ ok: true, username });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno. Tente novamente.' });
  }
});

accountApi.post('/set-two-factor', async (req, res) => {
  try {
    const u = getUserFromReq(req);
    if (!u) return res.status(401).json({ error: 'Não autenticado.' });
    const body = req.body || {};
    const enabled = Boolean(body.enabled);
    db.prepare('UPDATE users SET twoFactorEnabled = ? WHERE id = ?').run(enabled ? 1 : 0, u.id);
    res.json({ ok: true, twoFactorEnabled: enabled });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno. Tente novamente.' });
  }
});

accountApi.get('/sessions', (req, res) => {
  try {
    const u = getUserFromReq(req);
    if (!u) return res.status(401).json({ error: 'Não autenticado.' });
    const cookies = parseCookies(req);
    const data = verifySession(cookies.sid);
    const currentId = data ? data.sid : null;
    const rows = db
      .prepare('SELECT id, device, ip, location, createdAt, lastSeen FROM sessions WHERE userId = ? ORDER BY lastSeen DESC')
      .all(u.id);
    res.json({
      ok: true,
      sessions: rows.map((r) => Object.assign({}, r, { current: r.id === currentId })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno. Tente novamente.' });
  }
});

accountApi.post('/request-disconnect', async (req, res) => {
  try {
    const u = getUserFromReq(req);
    if (!u) return res.status(401).json({ error: 'Não autenticado.' });
    const body = req.body || {};
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
    const sess = db.prepare('SELECT * FROM sessions WHERE id = ? AND userId = ?').get(sessionId, u.id);
    if (!sess) return res.status(400).json({ error: 'Dispositivo não encontrado.' });
    const token = createActionToken(u.id, 'disconnect_device', { sessionId }, 30 * 60 * 1000);
    const link = baseUrlFromReq(req) + '/api/action/' + token;
    const r = await sendMailOrFail(res, { to: u.email, subject: 'Confirmar desconexão de dispositivo', html: emailDisconnectHtml(link) });
    if (!r.ok) return;
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno. Tente novamente.' });
  }
});

accountApi.post('/request-disconnect-all', async (req, res) => {
  try {
    const u = getUserFromReq(req);
    if (!u) return res.status(401).json({ error: 'Não autenticado.' });
    const token = createActionToken(u.id, 'disconnect_all', null, 30 * 60 * 1000);
    const link = baseUrlFromReq(req) + '/api/action/' + token;
    const r = await sendMailOrFail(res, {
      to: u.email,
      subject: 'Confirmar desconexão de todos os dispositivos',
      html: emailDisconnectAllHtml(link),
    });
    if (!r.ok) return;
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno. Tente novamente.' });
  }
});

api.use('/account', accountApi);

/* === ADMIN API === */
const adminApi = express.Router();

adminApi.use(requireAdmin);

function adminRateLimit(req, res, next) {
  const u = req.user || getUserFromReq(req);
  const key = 'admin:' + (u ? u.id : (req.ip || 'unknown'));
  if (!checkRateLimit(key, 200, 60 * 1000)) {
    return res.status(429).json({ error: 'Muitas requisições. Tente novamente mais tarde.' });
  }
  next();
}
adminApi.use(adminRateLimit);

adminApi.get('/dashboard', requirePermission('dashboard.view'), (req, res) => {
  try {
    const totalUsers = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
    const activeUsers = db.prepare('SELECT COUNT(*) AS c FROM sessions WHERE lastSeen > ?').get(Date.now() - 30 * 24 * 60 * 60 * 1000).c;
    const bannedUsers = db.prepare('SELECT COUNT(*) AS c FROM bans WHERE status = \'active\'').get().c;
    const openReports = db.prepare('SELECT COUNT(*) AS c FROM reports WHERE status = \'open\'').get().c;
    const analyzingReports = db.prepare('SELECT COUNT(*) AS c FROM reports WHERE status = \'analyzing\'').get().c;
    const resolvedReports = db.prepare('SELECT COUNT(*) AS c FROM reports WHERE status = \'resolved\'').get().c;
    const adminCount = db.prepare('SELECT COUNT(DISTINCT ur.userId) AS c FROM user_roles ur JOIN roles r ON r.id = ur.roleId WHERE r.name IN (\'Admin Master\', \'Admin\', \'Funcionario\')').get().c;
    const recentPurchases = db.prepare('SELECT COUNT(*) AS c FROM purchases WHERE createdAt > ?').get(Date.now() - 7 * 24 * 60 * 60 * 1000).c;
    const newUsers = db.prepare('SELECT COUNT(*) AS c FROM users WHERE createdAt > ?').get(Date.now() - 7 * 24 * 60 * 60 * 1000).c;
    const recentLogs = db.prepare('SELECT * FROM audit_logs ORDER BY createdAt DESC LIMIT 10').all();
    res.json({
      totalUsers, activeUsers, bannedUsers, openReports, analyzingReports, resolvedReports,
      adminCount, recentPurchases, newUsers, recentLogs: recentLogs.map((l) => Object.assign({}, l, { admin: null, targetUser: null })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

adminApi.get('/users', requirePermission('users.view'), (req, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const filter = typeof req.query.filter === 'string' ? req.query.filter : '';
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '20', 10)));
    const offset = (page - 1) * limit;

    let where = 'WHERE 1=1';
    const params = [];
    if (q) {
      where += ' AND (id LIKE ? OR username LIKE ? OR email LIKE ?)';
      params.push('%' + q + '%', '%' + q + '%', '%' + q + '%');
    }
    if (filter === 'active') where += ' AND id NOT IN (SELECT userId FROM bans WHERE status = \'active\' AND (endDate IS NULL OR endDate > ?))';
    if (filter === 'banned') where += ' AND id IN (SELECT userId FROM bans WHERE status = \'active\' AND (endDate IS NULL OR endDate > ?))';
    if (filter === 'admins') where += ' AND id IN (SELECT userId FROM user_roles WHERE roleId IN (SELECT id FROM roles WHERE name IN (\'Admin Master\', \'Admin\', \'Funcionario\')))';
    if (filter === 'employees') where += ' AND id IN (SELECT userId FROM user_roles WHERE roleId IN (SELECT id FROM roles WHERE name IN (\'Admin\', \'Funcionario\')))';
    if (filter === 'recent') where += ' AND createdAt > ?';
    if (filter === 'old') where += ' AND createdAt < ?';
    if (filter === 'active' || filter === 'banned') params.push(Date.now());

    const totalRow = db.prepare('SELECT COUNT(*) AS c FROM users ' + where).get(params);
    const rows = db.prepare('SELECT id, username, email, provider, emailVerified, twoFactorEnabled, createdAt FROM users ' + where + ' ORDER BY createdAt DESC LIMIT ? OFFSET ?').all(...params, limit, offset);

    const result = rows.map((u) => {
      const roles = getUserRoles(u.id).map((r) => r.name);
      const ban = db.prepare('SELECT * FROM bans WHERE userId = ? AND status = \'active\' AND (endDate IS NULL OR endDate > ?)').get(u.id, Date.now());
      const canViewEmail = hasPermission(req.user.id, 'users.view_email');
      return {
        id: u.id,
        username: u.username,
        email: canViewEmail ? u.email : maskEmail(u.email),
        emailMasked: !canViewEmail,
        status: ban ? 'banido' : 'ativo',
        roles,
        createdAt: u.createdAt,
        provider: u.provider,
      };
    });

    res.json({ ok: true, users: result, total: totalRow.c, page, limit });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

adminApi.get('/users/:id', requirePermission('users.view'), (req, res) => {
  try {
    const u = findUserById(req.params.id);
    if (!u) return res.status(404).json({ error: 'Usuário não encontrado.' });
    const roles = getUserRoles(u.id);
    const ban = db.prepare('SELECT * FROM bans WHERE userId = ? ORDER BY createdAt DESC').all(u.id);
    const purchases = db.prepare('SELECT * FROM purchases WHERE userId = ? ORDER BY createdAt DESC LIMIT 20').all(u.id);
    const emails = db.prepare('SELECT * FROM email_logs WHERE userId = ? ORDER BY createdAt DESC LIMIT 20').all(u.id);
    const sessions = db.prepare('SELECT * FROM sessions WHERE userId = ? ORDER BY lastSeen DESC LIMIT 20').all(u.id);
    const canViewEmail = hasPermission(req.user.id, 'users.view_email');
    const canViewIp = hasPermission(req.user.id, 'users.view_ip');
    const canViewLocation = hasPermission(req.user.id, 'users.view_location');

    const safeUser = {
      id: u.id,
      username: u.username,
      email: canViewEmail ? u.email : maskEmail(u.email),
      emailMasked: !canViewEmail,
      provider: u.provider,
      createdAt: u.createdAt,
      roles: roles.map((r) => r.name),
      ban: ban.length > 0 ? ban[ban.length - 1] : null,
      purchases,
      emails: emails.map((e) => Object.assign({}, e, { toEmail: canViewEmail ? e.toEmail : maskEmail(e.toEmail) })),
      sessions: sessions.map((s) => {
        const obj = Object.assign({}, s);
        if (!canViewIp) obj.ip = obj.ip ? '***.***.***.***' : '';
        if (!canViewLocation) obj.location = obj.location ? 'Localização oculta' : '';
        return obj;
      }),
    };

    auditLog(req.user.id, 'users.view', u.id, 'Visualizou dados do usuário ' + u.username, req.ip);
    res.json({ ok: true, user: safeUser });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

adminApi.post('/users/:id/reveal-email', requirePermission('users.view_email'), (req, res) => {
  try {
    const u = findUserById(req.params.id);
    if (!u) return res.status(404).json({ error: 'Usuário não encontrado.' });
    auditLog(req.user.id, 'users.view_email', u.id, 'Visualizou e-mail de ' + u.username, req.ip);
    res.json({ ok: true, email: u.email });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

adminApi.post('/users/:id/password', requirePermission('users.view_sensitive'), (req, res) => {
  try {
    const u = findUserById(req.params.id);
    if (!u) return res.status(404).json({ error: 'Usuário não encontrado.' });
    const body = req.body || {};
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

    if (newPassword) {
      if (newPassword.length < 8) return res.status(400).json({ error: 'Senha deve ter ao menos 8 caracteres.' });
      db.prepare('UPDATE users SET passwordHash = ? WHERE id = ?').run(hashPassword(newPassword), u.id);
      auditLog(req.user.id, 'users.reset_password', u.id, 'Redefiniu senha do usuário ' + u.username, req.ip);
      return res.json({ ok: true });
    }
    res.status(400).json({ error: 'Ação inválida.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

adminApi.get('/roles', requirePermission('roles.view'), (req, res) => {
  try {
    const roles = db.prepare('SELECT * FROM roles ORDER BY createdAt').all();
    res.json({ ok: true, roles });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

adminApi.post('/roles', requirePermission('roles.create'), (req, res) => {
  try {
    const body = req.body || {};
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    if (!name) return res.status(400).json({ error: 'Nome do cargo é obrigatório.' });
    const existing = db.prepare('SELECT id FROM roles WHERE name = ?').get(name);
    if (existing) return res.status(409).json({ error: 'Cargo já existe.' });
    const id = crypto.randomBytes(8).toString('hex');
    db.prepare('INSERT INTO roles (id,name,description,isProtected,createdAt) VALUES (?,?,?,?,?)').run(id, name, description || '', 0, Date.now());
    auditLog(req.user.id, 'roles.create', null, 'Criou cargo: ' + name, req.ip);
    res.json({ ok: true, id, name, description });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

adminApi.put('/roles/:id', requirePermission('roles.edit'), (req, res) => {
  try {
    const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(req.params.id);
    if (!role) return res.status(404).json({ error: 'Cargo não encontrado.' });
    if (role.isProtected && role.name === 'Admin Master') return res.status(403).json({ error: 'Não é permitido alterar o Admin Master.' });
    const body = req.body || {};
    const name = typeof body.name === 'string' ? body.name.trim() : role.name;
    const description = typeof body.description === 'string' ? body.description.trim() : role.description;
    db.prepare('UPDATE roles SET name = ?, description = ? WHERE id = ?').run(name, description, req.params.id);
    if (Array.isArray(body.permissionIds)) {
      db.prepare('DELETE FROM role_permissions WHERE roleId = ?').run(req.params.id);
      const ins = db.prepare('INSERT OR IGNORE INTO role_permissions (roleId, permissionId) VALUES (?,?)');
      const tx = db.transaction(() => {
        for (const pid of body.permissionIds) {
          ins.run(req.params.id, pid);
        }
      });
      tx();
    }
    auditLog(req.user.id, 'roles.edit', null, 'Editou cargo: ' + name, req.ip);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

adminApi.delete('/roles/:id', requirePermission('roles.delete'), (req, res) => {
  try {
    const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(req.params.id);
    if (!role) return res.status(404).json({ error: 'Cargo não encontrado.' });
    if (role.isProtected && role.name === 'Admin Master') return res.status(403).json({ error: 'Não é permitido excluir o Admin Master.' });
    const usersCount = db.prepare('SELECT COUNT(*) AS c FROM user_roles WHERE roleId = ?').get(req.params.id).c;
    if (usersCount > 0) {
      const targetRoleId = typeof req.query.transferTo === 'string' ? req.query.transferTo : null;
      if (!targetRoleId) {
        const other = db.prepare('SELECT id FROM roles WHERE id != ? AND name != \'Admin Master\' LIMIT 1').get(req.params.id);
        if (other) {
          db.prepare('UPDATE user_roles SET roleId = ? WHERE roleId = ?').run(other.id, req.params.id);
        } else {
          db.prepare('DELETE FROM user_roles WHERE roleId = ?').run(req.params.id);
        }
      } else {
        db.prepare('UPDATE user_roles SET roleId = ? WHERE roleId = ?').run(targetRoleId, req.params.id);
      }
    }
    db.prepare('DELETE FROM role_permissions WHERE roleId = ?').run(req.params.id);
    db.prepare('DELETE FROM roles WHERE id = ?').run(req.params.id);
    auditLog(req.user.id, 'roles.delete', null, 'Excluiu cargo: ' + role.name, req.ip);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

adminApi.get('/roles/:id/users', requirePermission('roles.view'), (req, res) => {
  try {
    const users = db.prepare('SELECT u.id, u.username, u.email FROM users u JOIN user_roles ur ON ur.userId = u.id WHERE ur.roleId = ?').all(req.params.id);
    res.json({ ok: true, users });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

adminApi.get('/reports', requirePermission('reports.view'), (req, res) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : '';
    const category = typeof req.query.category === 'string' ? req.query.category : '';
    const priority = typeof req.query.priority === 'string' ? req.query.priority : '';
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '20', 10)));
    const offset = (page - 1) * limit;

    let where = 'WHERE 1=1';
    const params = [];
    if (status) { where += ' AND status = ?'; params.push(status); }
    if (category) { where += ' AND category = ?'; params.push(category); }
    if (priority) { where += ' AND priority = ?'; params.push(priority); }
    if (q) {
      where += ' AND (id LIKE ? OR description LIKE ?)';
      params.push('%' + q + '%', '%' + q + '%');
    }

    const totalRow = db.prepare('SELECT COUNT(*) AS c FROM reports ' + where).get(params);
    const rows = db.prepare('SELECT * FROM reports ' + where + ' ORDER BY createdAt DESC LIMIT ? OFFSET ?').all(...params, limit, offset);

    const result = rows.map((r) => {
      const reportedUsers = db.prepare('SELECT u.id, u.username FROM users u JOIN report_reported_users rru ON rru.userId = u.id WHERE rru.reportId = ?').all(r.id);
      const attachments = db.prepare('SELECT * FROM report_attachments WHERE reportId = ?').all(r.id);
      const reporter = findUserById(r.reporterId);
      const assignee = r.assignedTo ? findUserById(r.assignedTo) : null;
      return {
        id: r.id,
        reporter: reporter ? { id: reporter.id, username: reporter.username } : null,
        reportedUsers: reportedUsers.map((u) => ({ id: u.id, username: u.username })),
        description: r.description,
        category: r.category,
        status: r.status,
        priority: r.priority,
        assignee: assignee ? { id: assignee.id, username: assignee.username } : null,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        attachments,
      };
    });

    res.json({ ok: true, reports: result, total: totalRow.c, page, limit });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

adminApi.get('/reports/:id', requirePermission('reports.view'), (req, res) => {
  try {
    const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
    if (!report) return res.status(404).json({ error: 'Denúncia não encontrada.' });
    const reportedUsers = db.prepare('SELECT u.id, u.username FROM users u JOIN report_reported_users rru ON rru.userId = u.id WHERE rru.reportId = ?').all(report.id);
    const attachments = db.prepare('SELECT * FROM report_attachments WHERE reportId = ?').all(report.id);
    const reporter = findUserById(report.reporterId);
    const assignee = report.assignedTo ? findUserById(report.assignedTo) : null;
    res.json({
      ok: true,
      report: Object.assign({}, report, {
        reporter,
        reportedUsers,
        attachments,
        assignee,
      }),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

adminApi.post('/reports/:id/assign', requirePermission('reports.manage'), (req, res) => {
  try {
    const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
    if (!report) return res.status(404).json({ error: 'Denúncia não encontrada.' });
    db.prepare('UPDATE reports SET assignedTo = ?, updatedAt = ? WHERE id = ?').run(req.user.id, Date.now(), req.params.id);
    auditLog(req.user.id, 'reports.assign', null, 'Assumiu denúncia ' + req.params.id, req.ip);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

adminApi.post('/reports/:id/status', requirePermission('reports.manage'), (req, res) => {
  try {
    const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
    if (!report) return res.status(404).json({ error: 'Denúncia não encontrada.' });
    const body = req.body || {};
    const status = typeof body.status === 'string' ? body.status : '';
    const note = typeof body.note === 'string' ? body.note : '';
    const allowed = ['open', 'analyzing', 'resolved', 'rejected', 'archived'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Status inválido.' });
    db.prepare('UPDATE reports SET status = ?, updatedAt = ? WHERE id = ?').run(status, Date.now(), req.params.id);
    if (note) {
      db.prepare('INSERT INTO audit_logs (id, adminId, action, targetUserId, details, ip, createdAt) VALUES (?,?,?,?,?,?,?)').run(crypto.randomBytes(12).toString('hex'), req.user.id, 'reports.note', report.reporterId, 'Denúncia ' + req.params.id + ': ' + note, req.ip, Date.now());
    }
    auditLog(req.user.id, 'reports.status_change', report.reporterId, 'Alterou status da denúncia ' + req.params.id + ' para ' + status, req.ip);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

adminApi.delete('/reports/:id', requirePermission('reports.delete'), (req, res) => {
  try {
    const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
    if (!report) return res.status(404).json({ error: 'Denúncia não encontrada.' });
    db.prepare('DELETE FROM report_attachments WHERE reportId = ?').run(req.params.id);
    db.prepare('DELETE FROM report_reported_users WHERE reportId = ?').run(req.params.id);
    db.prepare('DELETE FROM reports WHERE id = ?').run(req.params.id);
    auditLog(req.user.id, 'reports.delete', report.reporterId, 'Excluiu denúncia ' + req.params.id, req.ip);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

adminApi.get('/bans', requirePermission('bans.view'), (req, res) => {
  try {
    const rows = db.prepare('SELECT b.*, u.username FROM bans b JOIN users u ON u.id = b.userId ORDER BY b.createdAt DESC').all();
    res.json({ ok: true, bans: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

adminApi.post('/bans', requirePermission('bans.create'), (req, res) => {
  try {
    const body = req.body || {};
    const identifier = typeof body.identifier === 'string' ? body.identifier.trim() : '';
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    const type = typeof body.type === 'string' ? body.type : 'temporary';
    const duration = typeof body.duration === 'string' ? body.duration.trim() : '';

    if (!identifier || !reason) return res.status(400).json({ error: 'Usuário e motivo são obrigatórios.' });

    const user = findByEmail(identifier) || findByUsername(identifier);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

    const isMaster = db.prepare('SELECT r.id FROM user_roles ur JOIN roles r ON r.id = ur.roleId WHERE ur.userId = ? AND r.name = \'Admin Master\'').get(user.id);
    if (isMaster) return res.status(403).json({ error: 'Não é permitido banir o Admin Master.' });

    const existingBan = db.prepare('SELECT * FROM bans WHERE userId = ? AND status = \'active\' AND (endDate IS NULL OR endDate > ?)').get(user.id, Date.now());
    if (existingBan) return res.status(409).json({ error: 'Usuário já está banido.' });

    let endDate = null;
    if (type === 'temporary' && duration) {
      const match = duration.match(/^(\d+)\s*(second|minute|hour|day|month|year|segundo|minuto|hora|dia|mes|ano)s?$/i);
      if (match) {
        const value = parseInt(match[1], 10);
        const unit = match[2].toLowerCase();
        const msMap = { second: 1000, segundo: 1000, minute: 60000, minuto: 60000, hour: 3600000, hora: 3600000, day: 86400000, dia: 86400000, month: 2592000000, mes: 2592000000, year: 31536000000, ano: 31536000000 };
        endDate = Date.now() + value * (msMap[unit] || 0);
      }
    }

    const id = crypto.randomBytes(12).toString('hex');
    db.prepare('INSERT INTO bans (id, userId, reason, adminId, type, duration, startDate, endDate, status, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id, user.id, reason, req.user.id, type, duration || null, Date.now(), endDate, 'active', Date.now());

    db.prepare('DELETE FROM sessions WHERE userId = ?').run(user.id);
    db.prepare('INSERT INTO security_events (id, userId, type, details, ip, createdAt) VALUES (?,?,?,?,?,?)').run(crypto.randomBytes(8).toString('hex'), user.id, 'ban', 'Usuário banido: ' + reason, req.ip, Date.now());

    auditLog(req.user.id, 'bans.create', user.id, 'Baniu usuário ' + user.username + ': ' + reason, req.ip);
    res.json({ ok: true, id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

adminApi.post('/bans/:id/unban', requirePermission('bans.remove'), (req, res) => {
  try {
    const ban = db.prepare('SELECT * FROM bans WHERE id = ?').get(req.params.id);
    if (!ban) return res.status(404).json({ error: 'Banimento não encontrado.' });
    db.prepare('UPDATE bans SET status = \'removed\' WHERE id = ?').run(req.params.id);
    auditLog(req.user.id, 'bans.remove', ban.userId, 'Removeu banimento de ' + req.params.id, req.ip);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

adminApi.get('/contacts', requirePermission('contacts.view'), (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM contacts ORDER BY createdAt DESC').all();
    res.json({ ok: true, contacts: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

adminApi.post('/contacts/:id', requirePermission('contacts.manage'), (req, res) => {
  try {
    const body = req.body || {};
    const status = typeof body.status === 'string' ? body.status : '';
    const allowed = ['new', 'read', 'replied', 'closed'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Status inválido.' });
    db.prepare('UPDATE contacts SET status = ? WHERE id = ?').run(status, req.params.id);
    auditLog(req.user.id, 'contacts.manage', null, 'Alterou status do contato ' + req.params.id, req.ip);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

adminApi.get('/purchases', requirePermission('purchases.view'), (req, res) => {
  try {
    const rows = db.prepare('SELECT p.*, u.username FROM purchases p JOIN users u ON u.id = p.userId ORDER BY p.createdAt DESC LIMIT 100').all();
    res.json({ ok: true, purchases: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

adminApi.get('/emails', requirePermission('email_logs.view'), (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM email_logs ORDER BY createdAt DESC LIMIT 100').all();
    res.json({ ok: true, emails: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

adminApi.get('/sessions', requirePermission('sessions.view'), (req, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    let query = 'SELECT s.*, u.username FROM sessions s JOIN users u ON u.id = s.userId';
    const params = [];
    if (q) {
      query += ' WHERE u.id LIKE ? OR u.username LIKE ? OR s.id LIKE ?';
      params.push('%' + q + '%', '%' + q + '%', '%' + q + '%');
    }
    query += ' ORDER BY s.lastSeen DESC';
    const rows = db.prepare(query).all(...params);
    res.json({ ok: true, sessions: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

adminApi.post('/sessions/:id/revoke', requirePermission('sessions.revoke'), (req, res) => {
  try {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(req.params.id);
    auditLog(req.user.id, 'sessions.revoke', null, 'Revogou sessão ' + req.params.id, req.ip);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

adminApi.post('/sessions/revoke-all', requirePermission('sessions.revoke'), (req, res) => {
  try {
    const body = req.body || {};
    const userId = typeof body.userId === 'string' ? body.userId : null;
    if (userId) {
      db.prepare('DELETE FROM sessions WHERE userId = ?').run(userId);
      auditLog(req.user.id, 'sessions.revoke_all', userId, 'Revogou todas as sessões do usuário ' + userId, req.ip);
    } else {
      db.prepare('DELETE FROM sessions').run();
      auditLog(req.user.id, 'sessions.revoke_all', null, 'Revogou todas as sessões', req.ip);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

adminApi.get('/administrators', requirePermission('admins.view'), (req, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    let query = 'SELECT u.id, u.username, u.email, u.createdAt, r.name as role FROM users u JOIN user_roles ur ON ur.userId = u.id JOIN roles r ON r.id = ur.roleId WHERE r.name IN (\'Admin Master\', \'Admin\', \'Funcionario\')';
    const params = [];
    if (q) {
      query += ' AND (u.id LIKE ? OR u.username LIKE ? OR u.email LIKE ?)';
      params.push('%' + q + '%', '%' + q + '%', '%' + q + '%');
    }
    query += ' ORDER BY u.createdAt DESC';
    const rows = db.prepare(query).all(...params);
    const canViewEmail = hasPermission(req.user.id, 'users.view_email');
    res.json({ ok: true, administrators: rows.map((r) => Object.assign({}, r, { email: canViewEmail ? r.email : maskEmail(r.email), emailMasked: !canViewEmail })) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

adminApi.post('/administrators', requirePermission('admins.create'), (req, res) => {
  try {
    const body = req.body || {};
    const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
    const roleName = typeof body.role === 'string' ? body.role.trim() : 'Admin';
    if (!userId) return res.status(400).json({ error: 'Usuário é obrigatório.' });
    const user = findUserById(userId);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
    const role = db.prepare('SELECT id FROM roles WHERE name = ?').get(roleName);
    if (!role) return res.status(404).json({ error: 'Cargo não encontrado.' });
    if (roleName === 'Admin Master') return res.status(403).json({ error: 'Não é permitido criar Admin Master manualmente.' });
    db.prepare('INSERT OR IGNORE INTO user_roles (userId, roleId) VALUES (?,?)').run(user.id, role.id);
    auditLog(req.user.id, 'admins.create', user.id, 'Tornou ' + user.username + ' administrador (' + roleName + ')', req.ip);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

adminApi.delete('/administrators/:userId', requirePermission('admins.remove'), (req, res) => {
  try {
    const master = db.prepare('SELECT r.id FROM user_roles ur JOIN roles r ON r.id = ur.roleId WHERE ur.userId = ? AND r.name = \'Admin Master\'').get(req.params.userId);
    if (master) return res.status(403).json({ error: 'Não é permitido remover o Admin Master.' });
    db.prepare('DELETE FROM user_roles WHERE userId = ? AND roleId IN (SELECT id FROM roles WHERE name IN (\'Admin\', \'Funcionario\'))').run(req.params.userId);
    auditLog(req.user.id, 'admins.remove', req.params.userId, 'Removeu cargo administrativo de ' + req.params.userId, req.ip);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

adminApi.get('/audit-logs', requirePermission('audit_logs.view'), (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '20', 10)));
    const offset = (page - 1) * limit;
    const totalRow = db.prepare('SELECT COUNT(*) AS c FROM audit_logs').get();
    const rows = db.prepare('SELECT * FROM audit_logs ORDER BY createdAt DESC LIMIT ? OFFSET ?').all(limit, offset);
    res.json({ ok: true, logs: rows, total: totalRow.c, page, limit });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

adminApi.get('/settings', requirePermission('settings.view'), (req, res) => {
  try {
    res.json({ ok: true, settings: { googleEnabled: GOOGLE_ENABLED, maxUploadSize: '50MB' } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

adminApi.get('/permissions', requirePermission('roles.view'), (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM permissions ORDER BY category, name').all();
    res.json({ ok: true, permissions: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

adminApi.get('/me/permissions', requireAdmin, (req, res) => {
  try {
    const perms = getUserPermissions(req.user.id);
    res.json({ ok: true, permissions: perms });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

adminApi.post('/upload', requirePermission('reports.manage'), upload.array('files', 10), (req, res) => {
  try {
    if (!req.files || !req.files.length) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    const result = req.files.map((f) => ({
      filename: f.filename,
      originalName: f.originalname,
      mimeType: f.mimetype,
      size: f.size,
      path: '/api/admin/uploads/' + f.filename,
    }));
    res.json({ ok: true, files: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro no upload.' });
  }
});

adminApi.get('/uploads/:filename', requirePermission('reports.view'), (req, res) => {
  try {
    const filePath = path.join(UPLOAD_DIR, req.params.filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Arquivo não encontrado.' });
    res.sendFile(filePath);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

/* === PÚBLICO: DENÚNCIAS === */
const publicApi = express.Router();

publicApi.post('/reports', requireAuth, banCheckMiddleware, (req, res) => {
  try {
    const body = req.body || {};
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    const category = typeof body.category === 'string' ? body.category.trim() : '';
    if (!description || !category) return res.status(400).json({ error: 'Descrição e categoria são obrigatórias.' });
    const allowedCategories = ['Assédio', 'Ameaças', 'Fraude', 'Spam', 'Comportamento inadequado', 'Violação das regras', 'Conteúdo ilegal', 'Outro'];
    if (!allowedCategories.includes(category)) return res.status(400).json({ error: 'Categoria inválida.' });

    const reportedUserIds = Array.isArray(body.reportedUserIds) ? body.reportedUserIds.filter((id) => typeof id === 'string') : [];
    const id = crypto.randomBytes(12).toString('hex');
    db.prepare('INSERT INTO reports (id, reporterId, description, category, status, priority, assignedTo, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?)').run(id, req.user.id, description, category, 'open', 'medium', null, Date.now(), Date.now());
    if (reportedUserIds.length > 0) {
      const ins = db.prepare('INSERT OR IGNORE INTO report_reported_users (reportId, userId) VALUES (?,?)');
      const tx = db.transaction(() => {
        for (const uid of reportedUserIds) {
          ins.run(id, uid);
        }
      });
      tx();
    }
    if (Array.isArray(body.attachments) && body.attachments.length > 0) {
      const insAtt = db.prepare('INSERT INTO report_attachments (id, reportId, filename, originalName, mimeType, size, path, createdAt) VALUES (?,?,?,?,?,?,?,?)');
      const txAtt = db.transaction(() => {
        for (const att of body.attachments) {
          if (att && att.filename) {
            insAtt.run(crypto.randomBytes(8).toString('hex'), id, att.filename, att.originalName || att.filename, att.mimeType || 'application/octet-stream', att.size || 0, att.path || '', Date.now());
          }
        }
      });
      txAtt();
    }
    auditLog(req.user.id, 'reports.create', null, 'Criou denúncia ' + id, req.ip);
    res.json({ ok: true, id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

api.use('/admin', adminApi);
api.use('/public', publicApi);

/* === AÇÃO POR LINK DE E-MAIL (efeito colateral imediato) === */
api.get('/action/:token', async (req, res) => {
  try {
    const action = consumeActionToken(req.params.token);
    if (!action) return res.status(400).send('Link inválido ou expirado.');
    if (action.type === 'verify_email') {
      db.prepare('UPDATE users SET emailVerified = 1 WHERE id = ?').run(action.userId);
      return res.redirect('/config.html?verified=1');
    }
    if (action.type === 'two_factor') {
      const sid = createSession(action.userId, deviceFromReq(req), req.ip);
      res.cookie('sid', signSession(sid, action.userId), {
        httpOnly: true,
        sameSite: 'lax',
        secure: NODE_ENV === 'production',
        path: '/',
        maxAge: SESSION_TTL,
      });
      return res.redirect('/');
    }
    if (action.type === 'disconnect_device') {
      db.prepare('DELETE FROM sessions WHERE id = ? AND userId = ?').run(
        action.data && action.data.sessionId,
        action.userId
      );
      return res.redirect('/config.html?disconnected=1#security');
    }
    if (action.type === 'disconnect_all') {
      db.prepare('DELETE FROM sessions WHERE userId = ?').run(action.userId);
      clearSessionCookie(res);
      return res.redirect('/config.html?disconnected=1');
    }
    return res.status(400).send('Ação desconhecida.');
  } catch (err) {
    console.error(err);
    res.status(500).send('Erro interno.');
  }
});

if (GOOGLE_ENABLED) {
  api.get('/auth/google/start', (req, res) => {
    const state = crypto.randomBytes(16).toString('hex');
    res.cookie('oauth_state', signSession('oauth:' + state), {
      httpOnly: true,
      sameSite: 'lax',
      secure: NODE_ENV === 'production',
      path: '/',
      maxAge: 10 * 60 * 1000,
    });
    const redirectUri = `${req.protocol}://${req.get('host')}/api/auth/google/callback`;
    const url =
      'https://accounts.google.com/o/oauth2/v2/auth?' +
      new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid email profile',
        state,
        prompt: 'select_account',
      }).toString();
    res.redirect(url);
  });

  api.get('/auth/google/callback', async (req, res) => {
    try {
      const { code, state } = req.query;
      const cookies = parseCookies(req);
      const oauthCookie = verifySession(cookies.oauth_state);
      if (!oauthCookie || oauthCookie.uid !== 'oauth:' + state) {
        return res.status(403).send('Estado inválido.');
      }
      if (!code) return res.status(400).send('Código ausente.');
      const redirectUri = `${req.protocol}://${req.get('host')}/api/auth/google/callback`;
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }).toString(),
      });
      const tokenJson = await tokenRes.json();
      if (!tokenJson.access_token) return res.status(400).send('Falha na autenticação.');
      const infoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${tokenJson.access_token}` },
      });
      const profile = await infoRes.json();
      if (!profile.sub || !profile.email) return res.status(400).send('Dados incompletos.');

      let user = findByGoogle(profile.sub);
      if (!user) {
        user = findByEmail(String(profile.email).toLowerCase());
        if (user && !user.googleSub) {
          linkGoogle(user.id, profile.sub);
        } else if (!user) {
          user = {
            id: crypto.randomBytes(12).toString('hex'),
            username: String(profile.email).split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 20) || 'user',
            email: String(profile.email).toLowerCase(),
            passwordHash: '',
            provider: 'google',
            googleSub: profile.sub,
            createdAt: Date.now(),
          };
          createUser(user);
        }
      }
      const ban = getActiveBan(user.id);
      if (ban) {
        const endDate = ban.endDate ? new Date(ban.endDate).toLocaleString('pt-BR') : 'Permanente';
        return res.redirect('/banido.html?reason=' + encodeURIComponent(ban.reason || 'Não especificado') + '&end=' + encodeURIComponent(endDate));
      }
      if (user.twoFactorEnabled) {
        const token = createActionToken(user.id, 'two_factor', null, 15 * 60 * 1000);
        const link = req.protocol + '://' + req.get('host') + '/api/action/' + token;
        const r = await sendMailOrFail(null, {
          to: user.email,
          subject: 'Verificação de login - The Gods Studio',
          html: emailTwoFactorHtml(link),
        });
        if (!r.ok) return res.redirect('/login.html?error=email');
        return res.redirect('/login.html?twofa=1');
      }
      setSessionCookie(res, user.id, req);
      res.redirect('/');
    } catch (err) {
      console.error(err);
      res.status(500).send('Erro interno.');
    }
  });
}

app.use('/api', api);

if (DB_SYNC_TOKEN) {
  app.get('/api/db-info', (req, res) => {
    if (req.query.token !== DB_SYNC_TOKEN) return res.status(403).send('Forbidden');
    res.json({ users: countUsers() });
  });

  app.get('/api/db-backup', (req, res) => {
    if (req.query.token !== DB_SYNC_TOKEN) return res.status(403).send('Forbidden');
    try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch (_) {}
    if (!fs.existsSync(DB_PATH)) return res.status(404).send('No database');
    res.download(DB_PATH, 'accounts.db');
  });

  app.post('/api/db-backup', express.raw({ type: 'application/octet-stream', limit: '50mb' }), (req, res) => {
    if (req.query.token !== DB_SYNC_TOKEN) return res.status(403).send('Forbidden');
    if (!Buffer.isBuffer(req.body) || req.body.length < 100) return res.status(400).send('Invalid');
    try {
      try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch (_) {}
      fs.mkdirSync(path.join(DATA_DIR, 'backups'), { recursive: true });
      try { fs.copyFileSync(DB_PATH, path.join(DATA_DIR, 'backups', 'accounts-' + Date.now() + '.db')); } catch (_) {}
      try { db.close(); } catch (_) {}
      fs.writeFileSync(DB_PATH, req.body);
      initDb();
    } catch (e) {
      console.error('Falha ao restaurar db:', e);
      return res.status(500).send('Restore failed');
    }
    res.json({ ok: true });
  });

  app.post('/api/db-reset', express.text({ type: 'text/plain', limit: '1kb' }), (req, res) => {
    if (req.body !== DB_SYNC_TOKEN) return res.status(403).send('Forbidden');
    try {
      try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch (_) {}
      fs.mkdirSync(path.join(DATA_DIR, 'backups'), { recursive: true });
      try { fs.copyFileSync(DB_PATH, path.join(DATA_DIR, 'backups', 'accounts-' + Date.now() + '.db')); } catch (_) {}
      try { db.close(); } catch (_) {}
      if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
      initDb();
      console.log('[db] Banco resetado via /api/db-reset');
      res.json({ ok: true });
    } catch (e) {
      console.error('Falha ao resetar db:', e);
      return res.status(500).send('Reset failed');
    }
  });
}

app.get('/admin', (req, res) => {
  const u = getUserFromReq(req);
  if (!u) return res.redirect('/login.html?next=' + encodeURIComponent('/admin'));
  if (!isAdminUser(u.id)) return res.status(403).send('Acesso negado: você não possui acesso administrativo.');
  res.sendFile(path.join(PUBLIC_DIR, 'admin.html'));
});

app.use(banCheckMiddleware);

app.use((req, res, next) => {
  if (isProtected(req.path)) {
    const u = getUserFromReq(req);
    if (!u) return res.redirect('/login.html?next=' + encodeURIComponent(req.path));
  }
  if (req.path.startsWith('/admin')) {
    const u = getUserFromReq(req);
    if (!u) {
      if (req.path.endsWith('.html')) return res.redirect('/login.html?next=' + encodeURIComponent(req.path));
      return res.status(401).json({ error: 'Não autenticado.' });
    }
    if (!isAdminUser(u.id)) {
      if (req.path.endsWith('.html')) return res.status(403).send('Acesso negado: você não possui acesso administrativo.');
      return res.status(403).json({ error: 'Sem permissão para acessar o painel administrativo.' });
    }
  }
  next();
});

app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

app.use('/uploads', express.static(UPLOAD_DIR));

app.get('/denuncias.html', (req, res) => {
  const u = getUserFromReq(req);
  if (!u) return res.redirect('/login.html?next=' + encodeURIComponent('/denuncias.html'));
  res.sendFile(path.join(PUBLIC_DIR, 'denuncias.html'));
});

app.get('/banido.html', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'banido.html'));
});

app.use((req, res) => {
  res.status(404).send('Página não encontrada.');
});

initDb();
app.listen(PORT, () => {
  console.log(`The Gods Studio rodando em http://localhost:${PORT} (env: ${NODE_ENV})`);
  console.log(`Login com Google: ${GOOGLE_ENABLED ? 'ativado' : 'desativado'}`);
  console.log(`Backup do banco: ${DB_SYNC_TOKEN ? 'ativado (token definido)' : 'desativado'}`);
});

module.exports = app;
