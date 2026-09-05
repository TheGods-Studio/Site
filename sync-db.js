'use strict';

require('dotenv').config();

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const ROOT = __dirname;
const SERVER = (process.env.SYNC_SERVER || '').replace(/\/+$/, '');
const TOKEN = process.env.DB_SYNC_TOKEN || '';
const DB_REPO_PATH = process.env.DB_REPO_PATH
  ? path.resolve(ROOT, process.env.DB_REPO_PATH)
  : path.join(ROOT, 'db', 'accounts.db');
const GIT_REMOTE = process.env.GIT_REMOTE || 'origin';
const GIT_BRANCH = process.env.GIT_BRANCH || '';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const INTERVAL_MS = 5 * 60 * 1000;
const LOG_FILE = path.join(ROOT, 'sync-db.log');
const FETCH_TIMEOUT_MS = 30000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

if (!SERVER || !TOKEN) {
  console.error('[sync-db] Defina SYNC_SERVER (ex: https://the-gods-studio.onrender.com) e DB_SYNC_TOKEN no .env ou ambiente.');
  process.exit(1);
}

function ts() {
  return new Date().toISOString();
}

async function log(level, msg) {
  const line = ts() + ' [' + level + '] ' + msg;
  console.log(line);
  try {
    await fsp.appendFile(LOG_FILE, line + '\n');
  } catch (_) {}
}

function hashOf(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function git(args, allowFail) {
  try {
    const res = await execFileAsync('git', args, { cwd: ROOT, timeout: 30000 });
    return (res.stdout || '') + (res.stderr || '');
  } catch (e) {
    if (allowFail) return (e.stdout || '') + (e.stderr || '');
    throw e;
  }
}

async function ensureGitIdentity() {
  try {
    if (!(await git(['config', 'user.name'], true)).trim()) {
      await git(['config', 'user.name', process.env.GIT_USER_NAME || 'DB Sync Bot']);
    }
  } catch (_) {}
  try {
    if (!(await git(['config', 'user.email'], true)).trim()) {
      await git(['config', 'user.email', process.env.GIT_USER_EMAIL || 'sync@thegods.studio']);
    }
  } catch (_) {}
}

async function getCurrentBranch() {
  try {
    const out = (await git(['branch', '--show-current'], true)).trim();
    if (out) return out;
    const fallback = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], true)).trim();
    if (fallback && fallback !== 'HEAD') return fallback;
  } catch (_) {}
  return '';
}

async function getAuthRemoteUrl() {
  if (!GITHUB_TOKEN) return GIT_REMOTE;
  try {
    const url = (await git(['remote', 'get-url', GIT_REMOTE], true)).trim();
    if (!url) return GIT_REMOTE;
    if (url.includes('://')) {
      return url.replace('://', '://x-access-token:' + GITHUB_TOKEN + '@');
    }
    if (url.startsWith('git@')) {
      return 'https://x-access-token:' + GITHUB_TOKEN + '@' + url.slice(4).replace(':', '/');
    }
    return GIT_REMOTE;
  } catch (_) {
    return GIT_REMOTE;
  }
}

async function pullFromServer() {
  const url = SERVER + '/api/db-backup?token=' + encodeURIComponent(TOKEN);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
  if (!res.ok) throw new Error('download HTTP ' + res.status + ' ' + res.statusText);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 100) {
    throw new Error('arquivo suspeito (' + buf.length + ' bytes) — banco vazio ou corrompido');
  }
  return buf;
}

async function syncOnce() {
  await log('info', 'Iniciando sincronizacao do banco de dados a partir de ' + SERVER + '...');

  let buf = null;
  let lastErr = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      buf = await pullFromServer();
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      await log('warn', 'Falha ao baixar o banco (tentativa ' + (attempt + 1) + '/' + MAX_RETRIES + '): ' + (e && e.message));
      if (attempt < MAX_RETRIES - 1) {
        await new Promise(function (r) { setTimeout(r, RETRY_DELAY_MS); });
      }
    }
  }
  if (!buf) {
    await log('error', 'Falha ao baixar o banco de dados apos ' + MAX_RETRIES + ' tentativas: ' + (lastErr && lastErr.message));
    return false;
  }

  const incomingHash = hashOf(buf);

  let existingHash = '(ausente)';
  try {
    existingHash = hashOf(await fsp.readFile(DB_REPO_PATH));
  } catch (_) {}

  if (existingHash === incomingHash) {
    await log('info', 'Banco inalterado (hash ' + incomingHash.slice(0, 16) + '). Nenhum commit necessario.');
    return false;
  }

  await fsp.mkdir(path.dirname(DB_REPO_PATH), { recursive: true });
  const tmp = DB_REPO_PATH + '.tmp';
  await fsp.writeFile(tmp, buf);
  await fsp.rename(tmp, DB_REPO_PATH);
  await log(
    'info',
    'Banco escrito em ' + DB_REPO_PATH + ' (' + buf.length + ' bytes, hash ' + incomingHash.slice(0, 16) + ', anterior ' + existingHash.slice(0, 16) + ')'
  );

  const branch = GIT_BRANCH || (await getCurrentBranch());
  await ensureGitIdentity();

  const authRemote = await getAuthRemoteUrl();
  try {
    await git(['fetch', authRemote, branch || '--all'], true);
  } catch (e) {
    await log('warn', 'git fetch falhou (continuando): ' + (e && e.message));
  }

  await git(['add', DB_REPO_PATH]);
  const status = await git(['status', '--porcelain'], true);
  if (!status.trim()) {
    await log('info', 'Git nao detectou alteracao (hash identico). Nenhum commit.');
    return false;
  }

  const msg = 'chore(sync): atualiza accounts.db — ' + ts();
  await git(['commit', '-m', msg]);
  await log('info', 'Commit criado: ' + msg);

  let pushed = false;
  for (let attempt = 0; attempt < 2 && !pushed; attempt++) {
    try {
      if (branch) {
        await git(['push', authRemote, branch]);
      } else {
        await git(['push', authRemote]);
      }
      pushed = true;
    } catch (e) {
      await log('warn', 'git push falhou (tentativa ' + (attempt + 1) + '): ' + (e && e.message));
      try {
        if (branch) await git(['pull', '--rebase', authRemote, branch], true);
      } catch (e2) {
        await log('warn', 'git pull --rebase falhou: ' + (e2 && e2.message));
      }
    }
  }

  if (pushed) {
    await log('info', 'Push concluido com sucesso para ' + GIT_REMOTE + '/' + (branch || '(branch atual)'));
  } else {
    await log('error', 'Nao foi possivel enviar (push) as alteracoes para o remoto.');
  }
  return true;
}

async function loop() {
  try {
    await syncOnce();
  } catch (e) {
    await log('error', 'Falha na sincronizacao: ' + (e && e.message ? e.message : e));
  }
  setTimeout(loop, INTERVAL_MS).unref?.();
}

log('info', 'sync-db iniciado. Origem: ' + SERVER + ' | Destino no repo: ' + DB_REPO_PATH + ' | Intervalo: 5 min');
loop();

