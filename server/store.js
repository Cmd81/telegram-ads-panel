'use strict';

const fs = require('fs');
const path = require('path');
const { nowIso } = require('./util');

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');

const DB_FILE = path.join(DATA_DIR, 'db.json');
const TMP_FILE = path.join(DATA_DIR, 'db.json.tmp');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const KEEP_BACKUPS = 21;

const DEFAULT_SETTINGS = {
  siteName: 'داشبورد کانال‌های تبلیغاتی',
  timezone: 'Asia/Tehran',
  // کاربر عادی چقدر از لیست را ببیند؟  all | own | none
  usersEntryVisibility: 'all',
  // کاربران عادی بتوانند نمرهٔ منفی بدهند؟
  usersCanVote: true,
  // کاربران عادی متن تبلیغ گروه را ببینند؟
  usersCanSeeAdText: true,
  // اگر یوزرنیم در گروه دیگری ثبت شده باشد هشدار داده شود
  warnCrossGroupDuplicate: true,
  // آستانهٔ نمرهٔ منفی برای علامت‌گذاری «مشکوک»
  weakScoreThreshold: -2,
};

function emptyDb() {
  return {
    version: 1,
    createdAt: nowIso(),
    settings: { ...DEFAULT_SETTINGS },
    users: [],
    groups: [],
    entries: [],
    logs: [],
  };
}

let db = null;
let saveTimer = null;
let writing = false;
let dirtyWhileWriting = false;

function ensureDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

/** تکمیل فیلدهای جاافتاده بعد از به‌روزرسانی نسخه */
function migrate(raw) {
  const base = emptyDb();
  const out = { ...base, ...raw };
  out.settings = { ...DEFAULT_SETTINGS, ...(raw.settings || {}) };

  // مهاجرت از تنظیم دوحالتهٔ قدیمی به سه‌حالتهٔ جدید.
  // «خاموش» قبلاً یعنی «فقط ثبت‌های خودش»؛ حالا به «هیچ‌چیز» نگاشت می‌شود.
  if (out.settings.usersCanViewEntries !== undefined) {
    if (raw.settings && raw.settings.usersEntryVisibility === undefined) {
      out.settings.usersEntryVisibility = out.settings.usersCanViewEntries ? 'all' : 'none';
    }
    delete out.settings.usersCanViewEntries;
  }
  if (!['all', 'own', 'none'].includes(out.settings.usersEntryVisibility)) {
    out.settings.usersEntryVisibility = 'all';
  }
  out.users = Array.isArray(raw.users) ? raw.users : [];
  out.groups = Array.isArray(raw.groups) ? raw.groups : [];
  out.entries = Array.isArray(raw.entries) ? raw.entries : [];
  out.logs = Array.isArray(raw.logs) ? raw.logs : [];

  for (const e of out.entries) {
    if (!Array.isArray(e.voters)) e.voters = [];
    e.score = -e.voters.length;
    if (typeof e.note !== 'string') e.note = '';
  }
  for (const g of out.groups) {
    if (typeof g.adText !== 'string') g.adText = '';
    if (typeof g.description !== 'string') g.description = '';
    if (typeof g.archived !== 'boolean') g.archived = false;
  }
  return out;
}

function load() {
  ensureDirs();
  if (!fs.existsSync(DB_FILE)) {
    db = emptyDb();
    writeNow();
    return db;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    db = migrate(raw);
  } catch (err) {
    // فایل خراب است: کنارش می‌گذاریم و از آخرین بکاپ سالم بازیابی می‌کنیم
    const broken = path.join(BACKUP_DIR, `corrupt-${Date.now()}.json`);
    try { fs.copyFileSync(DB_FILE, broken); } catch { /* ignore */ }
    const recovered = recoverFromBackup();
    if (recovered) {
      db = recovered;
      console.error(`[store] فایل دیتابیس خراب بود؛ از بکاپ بازیابی شد. نسخهٔ خراب: ${broken}`);
    } else {
      db = emptyDb();
      console.error(`[store] فایل دیتابیس خراب بود و بکاپی یافت نشد؛ دیتابیس خالی ساخته شد. نسخهٔ خراب: ${broken}`);
    }
    writeNow();
  }
  return db;
}

function recoverFromBackup() {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith('db-') && f.endsWith('.json'))
      .sort()
      .reverse();
    for (const f of files) {
      try {
        return migrate(JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, f), 'utf8')));
      } catch { /* بکاپ بعدی */ }
    }
  } catch { /* ignore */ }
  return null;
}

function writeNow() {
  if (!db) return;
  ensureDirs();
  const json = JSON.stringify(db, null, 2);
  const fd = fs.openSync(TMP_FILE, 'w');
  try {
    fs.writeFileSync(fd, json, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(TMP_FILE, DB_FILE);
  rotateBackup(json);
}

let lastBackupDay = '';
function rotateBackup(json) {
  const day = new Date().toISOString().slice(0, 10);
  if (day === lastBackupDay) return;
  lastBackupDay = day;
  try {
    fs.writeFileSync(path.join(BACKUP_DIR, `db-${day}.json`), json, 'utf8');
    const files = fs.readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith('db-') && f.endsWith('.json'))
      .sort();
    while (files.length > KEEP_BACKUPS) {
      const old = files.shift();
      fs.unlinkSync(path.join(BACKUP_DIR, old));
    }
  } catch (err) {
    console.error('[store] خطا در ساخت بکاپ:', err.message);
  }
}

/** ذخیرهٔ تأخیری (چند تغییر پشت‌سرهم = یک نوشتن) */
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (writing) { dirtyWhileWriting = true; return; }
    writing = true;
    try {
      writeNow();
    } catch (err) {
      console.error('[store] خطا در ذخیرهٔ دیتابیس:', err.message);
    } finally {
      writing = false;
      if (dirtyWhileWriting) { dirtyWhileWriting = false; save(); }
    }
  }, 150);
  if (saveTimer.unref) saveTimer.unref();
}

/**
 * بکاپ فوری و نام‌گذاری‌شده از وضعیت فعلی (قبل از عملیات خطرناک مثل بازگردانی).
 * برخلاف بکاپ روزانه، این یکی همیشه نوشته می‌شود و پاک نمی‌شود.
 */
function snapshot(label = 'manual') {
  if (!db) return null;
  ensureDirs();
  const safe = String(label).replace(/[^a-z0-9-]/gi, '') || 'manual';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(BACKUP_DIR, `${safe}-${stamp}.json`);
  try {
    fs.writeFileSync(file, JSON.stringify(db, null, 2), 'utf8');
    return file;
  } catch (err) {
    console.error('[store] خطا در ساخت بکاپ فوری:', err.message);
    return null;
  }
}

/** ذخیرهٔ فوری (هنگام خاموش شدن سرویس) */
function flush() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  try { writeNow(); } catch (err) { console.error('[store] flush:', err.message); }
}

function get() {
  if (!db) load();
  return db;
}

/** ثبت رویداد در تاریخچهٔ مدیریتی (سقف ۳۰۰۰ رکورد) */
function log(actor, action, detail) {
  const d = get();
  d.logs.push({
    at: nowIso(),
    userId: actor ? actor.id : null,
    userName: actor ? actor.name || actor.username : 'سیستم',
    action,
    detail: String(detail || '').slice(0, 300),
  });
  if (d.logs.length > 3000) d.logs.splice(0, d.logs.length - 3000);
  save();
}

module.exports = {
  DATA_DIR, DB_FILE, BACKUP_DIR, DEFAULT_SETTINGS,
  load, get, save, flush, log, snapshot,
};
