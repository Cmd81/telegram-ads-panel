'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const store = require('./store');
const { rid, nowIso, token, safeEqual, fail } = require('./util');

const SESSION_FILE = path.join(store.DATA_DIR, 'sessions.json');
const SESSION_TTL_MS = Number(process.env.SESSION_DAYS || 30) * 24 * 60 * 60 * 1000;
const COOKIE_NAME = 'chads_sid';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

// ---------------------------------------------------------------------------
// رمز عبور
// ---------------------------------------------------------------------------

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
  try {
    const [alg, N, r, p, saltB64, hashB64] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const actual = crypto.scryptSync(password, salt, expected.length, {
      N: Number(N), r: Number(r), p: Number(p),
    });
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** بررسی حداقلی قدرت رمز */
function checkPasswordStrength(password) {
  if (typeof password !== 'string' || password.length < 8) {
    return 'رمز عبور باید حداقل ۸ کاراکتر باشد.';
  }
  if (password.length > 200) return 'رمز عبور بیش از حد طولانی است.';
  if (/^\d+$/.test(password)) return 'رمز عبور نباید فقط عدد باشد.';
  const weak = ['password', '12345678', 'admin123', 'qwertyui', 'iloveyou'];
  if (weak.includes(password.toLowerCase())) return 'این رمز عبور بسیار ساده است.';
  return null;
}

// ---------------------------------------------------------------------------
// نشست‌ها
// ---------------------------------------------------------------------------

/** token -> { userId, csrf, createdAt, lastSeen, ip, ua } */
const sessions = new Map();
let sessionTimer = null;

function loadSessions() {
  try {
    if (!fs.existsSync(SESSION_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    const now = Date.now();
    for (const [tok, s] of Object.entries(raw)) {
      if (now - new Date(s.lastSeen).getTime() < SESSION_TTL_MS) sessions.set(tok, s);
    }
  } catch {
    /* نشست‌های خراب = همه دوباره لاگین می‌کنند، مشکلی نیست */
  }
}

function persistSessions() {
  if (sessionTimer) return;
  sessionTimer = setTimeout(() => {
    sessionTimer = null;
    try {
      fs.mkdirSync(store.DATA_DIR, { recursive: true });
      fs.writeFileSync(SESSION_FILE, JSON.stringify(Object.fromEntries(sessions)), {
        encoding: 'utf8', mode: 0o600,
      });
    } catch (err) {
      console.error('[auth] خطا در ذخیرهٔ نشست‌ها:', err.message);
    }
  }, 2000);
  if (sessionTimer.unref) sessionTimer.unref();
}

function createSession(user, ip, ua) {
  const tok = token(32);
  sessions.set(tok, {
    userId: user.id,
    csrf: token(24),
    createdAt: nowIso(),
    lastSeen: nowIso(),
    ip: String(ip || '').slice(0, 60),
    ua: String(ua || '').slice(0, 200),
  });
  persistSessions();
  return tok;
}

function destroySession(tok) {
  if (tok && sessions.delete(tok)) persistSessions();
}

function destroyUserSessions(userId) {
  let changed = false;
  for (const [tok, s] of sessions) {
    if (s.userId === userId) { sessions.delete(tok); changed = true; }
  }
  if (changed) persistSessions();
}

function listUserSessions(userId) {
  return [...sessions.values()].filter((s) => s.userId === userId);
}

function sweepSessions() {
  const now = Date.now();
  let changed = false;
  for (const [tok, s] of sessions) {
    if (now - new Date(s.lastSeen).getTime() >= SESSION_TTL_MS) { sessions.delete(tok); changed = true; }
  }
  if (changed) persistSessions();
}

function getSession(tok) {
  if (!tok) return null;
  const s = sessions.get(tok);
  if (!s) return null;
  if (Date.now() - new Date(s.lastSeen).getTime() >= SESSION_TTL_MS) {
    sessions.delete(tok);
    persistSessions();
    return null;
  }
  const last = new Date(s.lastSeen).getTime();
  if (Date.now() - last > 5 * 60 * 1000) {
    s.lastSeen = nowIso();
    persistSessions();
  }
  return s;
}

// ---------------------------------------------------------------------------
// محدودسازی تلاش ورود
// ---------------------------------------------------------------------------

const attempts = new Map(); // key -> { count, first, blockedUntil }
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 15 * 60 * 1000;
const BLOCK_MS = 15 * 60 * 1000;

function loginBlocked(key) {
  const a = attempts.get(key);
  if (!a) return 0;
  if (a.blockedUntil && a.blockedUntil > Date.now()) {
    return Math.ceil((a.blockedUntil - Date.now()) / 1000);
  }
  return 0;
}

function noteLoginFailure(key) {
  const now = Date.now();
  let a = attempts.get(key);
  if (!a || now - a.first > WINDOW_MS) a = { count: 0, first: now, blockedUntil: 0 };
  a.count += 1;
  if (a.count >= MAX_ATTEMPTS) a.blockedUntil = now + BLOCK_MS;
  attempts.set(key, a);
  if (attempts.size > 5000) attempts.clear();
}

function noteLoginSuccess(key) {
  attempts.delete(key);
}

// ---------------------------------------------------------------------------
// کاربران
// ---------------------------------------------------------------------------

function findUserByUsername(username) {
  const u = String(username || '').trim().toLowerCase();
  return store.get().users.find((x) => x.username.toLowerCase() === u) || null;
}

function findUserById(id) {
  return store.get().users.find((x) => x.id === id) || null;
}

function createUser({ username, name, password, role }) {
  const db = store.get();
  const user = {
    id: rid('u'),
    username: String(username).trim(),
    name: String(name || username).trim(),
    role: role === 'admin' ? 'admin' : 'user',
    passwordHash: hashPassword(password),
    active: true,
    createdAt: nowIso(),
    lastLoginAt: null,
    mustChangePassword: false,
  };
  db.users.push(user);
  store.save();
  return user;
}

/** ساخت مدیر اولیه در اولین اجرا (از متغیرهای محیطی) */
function ensureBootstrapAdmin() {
  const db = store.get();
  if (db.users.length > 0) return null;

  const username = process.env.ADMIN_USER || 'admin';
  const password = process.env.ADMIN_PASSWORD || token(12);
  const name = process.env.ADMIN_NAME || 'مدیر کل';
  const generated = !process.env.ADMIN_PASSWORD;

  const user = createUser({ username, name, password, role: 'admin' });
  if (generated) {
    user.mustChangePassword = true;
    store.save();
    console.log('\n' + '='.repeat(62));
    console.log('  حساب مدیر ساخته شد');
    console.log(`  نام کاربری : ${username}`);
    console.log(`  رمز عبور   : ${password}`);
    console.log('  (این رمز فقط همین یک‌بار نمایش داده می‌شود)');
    console.log('='.repeat(62) + '\n');
  } else {
    console.log(`[auth] حساب مدیر «${username}» ساخته شد.`);
  }
  return user;
}

/** نمای امن کاربر برای ارسال به کلاینت */
function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    name: u.name,
    role: u.role,
    active: u.active !== false,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt || null,
    mustChangePassword: !!u.mustChangePassword,
    restored: !!u.restored,
  };
}

function requireAuth(ctx) {
  if (!ctx.user) fail(401, 'برای این کار باید وارد حساب شوید.', 'unauthenticated');
  return ctx.user;
}

function requireAdmin(ctx) {
  requireAuth(ctx);
  if (ctx.user.role !== 'admin') fail(403, 'این بخش فقط برای مدیر کل در دسترس است.', 'forbidden');
  return ctx.user;
}

module.exports = {
  COOKIE_NAME, SESSION_TTL_MS,
  hashPassword, verifyPassword, checkPasswordStrength,
  loadSessions, createSession, destroySession, destroyUserSessions,
  listUserSessions, getSession, sweepSessions,
  loginBlocked, noteLoginFailure, noteLoginSuccess,
  findUserByUsername, findUserById, createUser, ensureBootstrapAdmin,
  publicUser, requireAuth, requireAdmin,
};
