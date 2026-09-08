'use strict';

const store = require('./store');
const auth = require('./auth');
const tg = require('./telegram');
const stats = require('./stats');
const dt = require('./datetime');
const { rid, nowIso, str, text, int, bool, fail } = require('./util');

// ---------------------------------------------------------------------------
// کمکی‌ها
// ---------------------------------------------------------------------------

function db() { return store.get(); }
function tz() { return db().settings.timezone || 'Asia/Tehran'; }

function groupById(id) {
  const g = db().groups.find((x) => x.id === id);
  if (!g) fail(404, 'گروه پیدا نشد.', 'group_not_found');
  return g;
}

function entryById(id) {
  const e = db().entries.find((x) => x.id === id);
  if (!e) fail(404, 'یوزرنیم پیدا نشد.', 'entry_not_found');
  return e;
}

function groupEntries(groupId) {
  return db().entries.filter((e) => e.groupId === groupId);
}

/**
 * نوع ورودی: تشخیص خودکار از روی پسوند bot، مگر اینکه مدیر دستی تعیین کرده باشد.
 * (هر ربات تلگرام به bot ختم می‌شود، ولی هر نام bot-داری ربات نیست — مثل news_robot)
 */
function entryIsBot(e) {
  if (e.type === 'bot') return true;
  if (e.type === 'channel') return false;
  return tg.isBot(e.username);
}

/** چیدمان: نمرهٔ بالاتر اول، نمرهٔ منفی ته لیست */
function sortEntries(list, mode = 'score') {
  const arr = list.slice();
  if (mode === 'newest') arr.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  else if (mode === 'oldest') arr.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  else if (mode === 'alpha') arr.sort((a, b) => a.username.localeCompare(b.username));
  else {
    // پیش‌فرض: نمرهٔ منفی به انتهای لیست می‌رود، بقیه به ترتیب قدیمی‌تر
    arr.sort((a, b) => (b.score || 0) - (a.score || 0) || a.createdAt.localeCompare(b.createdAt));
  }
  return arr;
}

function publicEntry(e, ctx) {
  const isAdmin = ctx.user && ctx.user.role === 'admin';
  return {
    id: e.id,
    groupId: e.groupId,
    username: e.display,
    key: e.username,
    isBot: entryIsBot(e),
    typeManual: e.type === 'bot' || e.type === 'channel',
    link: `https://t.me/${e.display}`,
    note: e.note || '',
    score: e.score || 0,
    voteCount: (e.voters || []).length,
    votedByMe: (e.voters || []).some((v) => v.userId === (ctx.user && ctx.user.id)),
    voters: isAdmin ? (e.voters || []).map((v) => ({ name: v.userName, at: dt.formatFull(v.at, tz()) })) : undefined,
    addedBy: e.addedBy,
    addedByName: e.addedByName || '',
    createdAt: e.createdAt,
    createdAtLabel: dt.formatFull(e.createdAt, tz()),
  };
}

function publicGroup(g, ctx) {
  const list = groupEntries(g.id);
  const settings = db().settings;
  const isAdmin = ctx.user && ctx.user.role === 'admin';
  const lastAdded = list.reduce((acc, e) => (!acc || e.createdAt > acc ? e.createdAt : acc), null);
  return {
    id: g.id,
    title: g.title,
    description: g.description || '',
    adText: (isAdmin || settings.usersCanSeeAdText) ? (g.adText || '') : '',
    canSeeAdText: isAdmin || settings.usersCanSeeAdText,
    archived: !!g.archived,
    color: g.color || 'blue',
    entryCount: list.length,
    botCount: list.filter(entryIsBot).length,
    channelCount: list.filter((e) => !entryIsBot(e)).length,
    negativeCount: list.filter((e) => (e.score || 0) < 0).length,
    myCount: list.filter((e) => e.addedBy === (ctx.user && ctx.user.id)).length,
    lastAddedAt: lastAdded,
    lastAddedLabel: lastAdded ? dt.formatFull(lastAdded, tz()) : null,
    createdAt: g.createdAt,
    createdAtLabel: dt.formatFull(g.createdAt, tz()),
    createdByName: g.createdByName || '',
  };
}

/**
 * کاربر عادی چقدر از لیست را می‌بیند؟
 *   all  — کل لیست گروه
 *   own  — فقط ثبت‌های خودش
 *   none — هیچ‌چیز (فقط می‌تواند اضافه کند)
 * مدیر کل همیشه «all» است.
 */
function visibility(ctx) {
  if (!ctx.user) return 'none';
  if (ctx.user.role === 'admin') return 'all';
  const v = db().settings.usersEntryVisibility;
  return ['all', 'own', 'none'].includes(v) ? v : 'none';
}

function canViewEntries(ctx) {
  return visibility(ctx) === 'all';
}

function canVote(ctx) {
  if (!ctx.user) return false;
  if (ctx.user.role === 'admin') return true;
  // رأی دادن فقط وقتی معنی دارد که کاربر چیزی برای دیدن داشته باشد
  return visibility(ctx) !== 'none' && !!db().settings.usersCanVote;
}

// ---------------------------------------------------------------------------
// احراز هویت
// ---------------------------------------------------------------------------

const routes = [];

function route(method, pattern, handler, opts = {}) {
  const keys = [];
  const regex = new RegExp('^' + pattern.replace(/:([A-Za-z0-9_]+)/g, (_, k) => {
    keys.push(k);
    return '([^/]+)';
  }) + '$');
  routes.push({ method, regex, keys, handler, opts });
}

// --- ورود / خروج / وضعیت -----------------------------------------------------

route('POST', '/api/login', async (ctx) => {
  const username = str(ctx.body.username, 60);
  const password = String(ctx.body.password || '');
  const key = ctx.ip + '|' + username.toLowerCase();

  const wait = auth.loginBlocked(key);
  if (wait) {
    fail(429, `به دلیل تلاش‌های ناموفق، ${Math.ceil(wait / 60)} دقیقه صبر کنید.`, 'rate_limited');
  }
  if (!username || !password) fail(400, 'نام کاربری و رمز عبور را وارد کنید.', 'missing');

  const user = auth.findUserByUsername(username);
  const ok = user && user.active !== false && auth.verifyPassword(password, user.passwordHash);
  if (!ok) {
    auth.noteLoginFailure(key);
    if (user && user.active === false) fail(403, 'این حساب غیرفعال شده است.', 'inactive');
    fail(401, 'نام کاربری یا رمز عبور درست نیست.', 'bad_credentials');
  }

  auth.noteLoginSuccess(key);
  user.lastLoginAt = nowIso();
  store.save();

  const tok = auth.createSession(user, ctx.ip, ctx.ua);
  ctx.setSession(tok);
  const session = auth.getSession(tok);
  store.log(user, 'login', `ورود از ${ctx.ip}`);

  return { user: auth.publicUser(user), csrf: session.csrf, settings: clientSettings(user) };
}, { public: true, noCsrf: true });

route('POST', '/api/logout', async (ctx) => {
  if (ctx.sessionToken) auth.destroySession(ctx.sessionToken);
  ctx.clearSession();
  return { ok: true };
}, { public: true, noCsrf: true });

route('GET', '/api/me', async (ctx) => {
  if (!ctx.user) return { user: null, settings: clientSettings(null) };
  return {
    user: auth.publicUser(ctx.user),
    csrf: ctx.session.csrf,
    settings: clientSettings(ctx.user),
  };
}, { public: true });

function clientSettings(user) {
  const s = db().settings;
  const isAdmin = user && user.role === 'admin';
  const vis = isAdmin ? 'all' : (s.usersEntryVisibility || 'none');
  return {
    siteName: s.siteName,
    timezone: s.timezone,
    visibility: vis,
    canViewEntries: vis === 'all',
    canVote: isAdmin || (vis !== 'none' && s.usersCanVote),
    canSeeAdText: isAdmin || s.usersCanSeeAdText,
    weakScoreThreshold: s.weakScoreThreshold,
    warnCrossGroupDuplicate: s.warnCrossGroupDuplicate,
  };
}

route('POST', '/api/account/password', async (ctx) => {
  const user = auth.requireAuth(ctx);
  const current = String(ctx.body.current || '');
  const next = String(ctx.body.next || '');
  if (!auth.verifyPassword(current, user.passwordHash)) {
    fail(400, 'رمز عبور فعلی درست نیست.', 'bad_password');
  }
  const problem = auth.checkPasswordStrength(next);
  if (problem) fail(400, problem, 'weak_password');

  user.passwordHash = auth.hashPassword(next);
  user.mustChangePassword = false;
  store.save();
  store.log(user, 'password_change', 'تغییر رمز عبور توسط خود کاربر');

  // همهٔ نشست‌های قبلی باطل و یک نشست تازه برای همین مرورگر ساخته می‌شود
  auth.destroyUserSessions(user.id);
  const tok = auth.createSession(user, ctx.ip, ctx.ua);
  ctx.setSession(tok);
  return { ok: true, csrf: auth.getSession(tok).csrf };
});

route('POST', '/api/account/profile', async (ctx) => {
  const user = auth.requireAuth(ctx);
  const name = str(ctx.body.name, 80);
  if (!name) fail(400, 'نام نمایشی نمی‌تواند خالی باشد.', 'missing');
  user.name = name;
  store.save();
  return { user: auth.publicUser(user) };
});

// --- گروه‌ها -----------------------------------------------------------------

route('GET', '/api/groups', async (ctx) => {
  auth.requireAuth(ctx);
  const includeArchived = ctx.query.archived === '1';
  const list = db().groups
    .filter((g) => includeArchived || !g.archived)
    .map((g) => publicGroup(g, ctx))
    .sort((a, b) => Number(a.archived) - Number(b.archived)
      || (b.lastAddedAt || b.createdAt).localeCompare(a.lastAddedAt || a.createdAt));
  return { groups: list, canViewEntries: canViewEntries(ctx) };
});

route('POST', '/api/groups', async (ctx) => {
  const user = auth.requireAdmin(ctx);
  const title = str(ctx.body.title, 120);
  if (!title) fail(400, 'عنوان گروه را وارد کنید.', 'missing_title');
  if (db().groups.some((g) => g.title.toLowerCase() === title.toLowerCase())) {
    fail(409, 'گروهی با این عنوان از قبل وجود دارد.', 'duplicate_title');
  }
  const group = {
    id: rid('g'),
    title,
    description: text(ctx.body.description, 2000),
    adText: text(ctx.body.adText, 8000),
    color: str(ctx.body.color, 20) || 'blue',
    archived: false,
    createdAt: nowIso(),
    createdBy: user.id,
    createdByName: user.name,
  };
  db().groups.push(group);
  store.save();
  store.log(user, 'group_create', `ساخت گروه «${title}»`);
  return { group: publicGroup(group, ctx) };
});

route('GET', '/api/groups/:id', async (ctx) => {
  auth.requireAuth(ctx);
  const g = groupById(ctx.params.id);
  const vis = visibility(ctx);
  const all = groupEntries(g.id);

  // all → کل لیست، own → فقط ثبت‌های خودش، none → هیچ‌چیز
  let visible = [];
  if (vis === 'all') visible = all;
  else if (vis === 'own') visible = all.filter((e) => e.addedBy === ctx.user.id);

  return {
    group: publicGroup(g, ctx),
    visibility: vis,
    canViewEntries: vis === 'all',
    canVote: canVote(ctx),
    entries: sortEntries(visible).map((e) => publicEntry(e, ctx)),
    showingOnlyMine: vis === 'own',
  };
});

route('PATCH', '/api/groups/:id', async (ctx) => {
  const user = auth.requireAdmin(ctx);
  const g = groupById(ctx.params.id);
  const changes = [];

  if (ctx.body.title !== undefined) {
    const title = str(ctx.body.title, 120);
    if (!title) fail(400, 'عنوان گروه نمی‌تواند خالی باشد.', 'missing_title');
    if (db().groups.some((x) => x.id !== g.id && x.title.toLowerCase() === title.toLowerCase())) {
      fail(409, 'گروه دیگری با این عنوان وجود دارد.', 'duplicate_title');
    }
    if (title !== g.title) changes.push('عنوان');
    g.title = title;
  }
  if (ctx.body.description !== undefined) { g.description = text(ctx.body.description, 2000); changes.push('توضیحات'); }
  if (ctx.body.adText !== undefined) { g.adText = text(ctx.body.adText, 8000); changes.push('متن تبلیغ'); }
  if (ctx.body.color !== undefined) g.color = str(ctx.body.color, 20) || 'blue';
  if (ctx.body.archived !== undefined) {
    g.archived = bool(ctx.body.archived, false);
    changes.push(g.archived ? 'بایگانی' : 'خروج از بایگانی');
  }

  g.updatedAt = nowIso();
  store.save();
  store.log(user, 'group_update', `ویرایش گروه «${g.title}» (${changes.join('، ') || 'بدون تغییر'})`);
  return { group: publicGroup(g, ctx) };
});

route('DELETE', '/api/groups/:id', async (ctx) => {
  const user = auth.requireAdmin(ctx);
  const g = groupById(ctx.params.id);
  const d = db();
  const count = groupEntries(g.id).length;

  // حذف قطعی نیاز به تأیید صریح دارد
  if (count > 0 && str(ctx.body.confirm) !== g.title) {
    fail(400, `این گروه ${count} یوزرنیم دارد. برای حذف، عنوان گروه را دقیقاً تایپ کنید.`, 'confirm_required');
  }

  d.entries = d.entries.filter((e) => e.groupId !== g.id);
  d.groups = d.groups.filter((x) => x.id !== g.id);
  store.save();
  store.log(user, 'group_delete', `حذف گروه «${g.title}» همراه با ${dt.faNum(count)} یوزرنیم`);
  return { ok: true, removedEntries: count };
});

// --- یوزرنیم‌ها ---------------------------------------------------------------

route('POST', '/api/groups/:id/entries', async (ctx) => {
  const user = auth.requireAuth(ctx);
  const g = groupById(ctx.params.id);
  if (g.archived) fail(400, 'این گروه بایگانی شده و امکان افزودن ندارد.', 'archived');

  const parsed = tg.parseList(ctx.body.usernames);
  if (parsed.items.length === 0 && parsed.invalid.length === 0) {
    fail(400, 'هیچ یوزرنیمی وارد نشده است.', 'empty');
  }

  const note = str(ctx.body.note, 200);
  const allowCrossGroup = bool(ctx.body.allowCrossGroup, false);
  const d = db();

  const inGroup = new Map(groupEntries(g.id).map((e) => [e.username, e]));
  const elsewhere = new Map();
  for (const e of d.entries) {
    if (e.groupId !== g.id && !elsewhere.has(e.username)) elsewhere.set(e.username, e);
  }
  const groupTitle = new Map(d.groups.map((x) => [x.id, x.title]));

  const added = [];
  const duplicates = [];
  const crossGroup = [];

  for (const item of parsed.items) {
    const existing = inGroup.get(item.key);
    if (existing) {
      duplicates.push({
        username: item.display,
        addedByName: existing.addedByName || '',
        at: dt.formatShort(existing.createdAt, tz()),
      });
      continue;
    }

    const other = elsewhere.get(item.key);
    if (other && d.settings.warnCrossGroupDuplicate && !allowCrossGroup) {
      crossGroup.push({
        username: item.display,
        groupTitle: groupTitle.get(other.groupId) || 'گروه دیگر',
        addedByName: other.addedByName || '',
      });
      continue;
    }

    const entry = {
      id: rid('e'),
      groupId: g.id,
      username: item.key,
      display: item.display,
      note,
      score: 0,
      voters: [],
      addedBy: user.id,
      addedByName: user.name,
      createdAt: nowIso(),
      alsoIn: other ? (groupTitle.get(other.groupId) || null) : null,
    };
    d.entries.push(entry);
    inGroup.set(item.key, entry);
    added.push(publicEntry(entry, ctx));
  }

  const addedBots = added.filter((e) => e.isBot).length;
  const addedChannels = added.length - addedBots;

  if (added.length) {
    store.save();
    store.log(user, 'entry_add',
      `افزودن ${dt.faNum(added.length)} مورد به «${g.title}» `
      + `(${dt.faNum(addedChannels)} کانال، ${dt.faNum(addedBots)} ربات)`);
  }

  return {
    added,
    addedBots,
    addedChannels,
    duplicates,
    crossGroup,
    invalid: parsed.invalid,
    dupInInput: parsed.dupInInput,
    group: publicGroup(g, ctx),
  };
});

route('POST', '/api/entries/:id/vote', async (ctx) => {
  const user = auth.requireAuth(ctx);
  if (!canVote(ctx)) fail(403, 'اجازهٔ ثبت نمرهٔ منفی را ندارید.', 'forbidden');

  const e = entryById(ctx.params.id);
  if (!Array.isArray(e.voters)) e.voters = [];

  const idx = e.voters.findIndex((v) => v.userId === user.id);
  let action;
  if (idx >= 0) {
    e.voters.splice(idx, 1);
    action = 'removed';
  } else {
    e.voters.push({ userId: user.id, userName: user.name, at: nowIso() });
    action = 'added';
  }
  e.score = -e.voters.length;
  store.save();

  return { entry: publicEntry(e, ctx), action };
});

route('POST', '/api/entries/:id/reset-score', async (ctx) => {
  const user = auth.requireAdmin(ctx);
  const e = entryById(ctx.params.id);
  e.voters = [];
  e.score = 0;
  store.save();
  store.log(user, 'score_reset', `صفر کردن نمرهٔ @${e.display}`);
  return { entry: publicEntry(e, ctx) };
});

route('PATCH', '/api/entries/:id', async (ctx) => {
  const user = auth.requireAuth(ctx);
  const e = entryById(ctx.params.id);
  // یادداشت را مدیر یا ثبت‌کنندهٔ خودش می‌تواند ویرایش کند
  if (user.role !== 'admin' && e.addedBy !== user.id) {
    fail(403, 'فقط مدیر یا ثبت‌کنندهٔ یوزرنیم می‌تواند یادداشت را تغییر دهد.', 'forbidden');
  }
  if (ctx.body.note !== undefined) e.note = str(ctx.body.note, 200);

  // تصحیح دستی نوع (کانال/ربات) فقط از سوی مدیر — 'auto' به تشخیص خودکار برمی‌گردد
  if (ctx.body.type !== undefined) {
    if (user.role !== 'admin') fail(403, 'تغییر نوع فقط توسط مدیر ممکن است.', 'forbidden');
    const t = str(ctx.body.type, 10);
    if (t === 'auto' || t === '') delete e.type;
    else if (t === 'bot' || t === 'channel') e.type = t;
    else fail(400, 'نوع نامعتبر است.', 'bad_type');
    store.log(user, 'entry_type', `تعیین نوع @${e.display} به «${t === 'bot' ? 'ربات' : t === 'channel' ? 'کانال' : 'خودکار'}»`);
  }

  store.save();
  return { entry: publicEntry(e, ctx) };
});

route('DELETE', '/api/entries/:id', async (ctx) => {
  const user = auth.requireAdmin(ctx);
  const e = entryById(ctx.params.id);
  const d = db();
  d.entries = d.entries.filter((x) => x.id !== e.id);
  store.save();
  store.log(user, 'entry_delete', `حذف @${e.display}`);
  return { ok: true };
});

route('POST', '/api/groups/:id/entries/bulk-delete', async (ctx) => {
  const user = auth.requireAdmin(ctx);
  const g = groupById(ctx.params.id);
  const ids = Array.isArray(ctx.body.ids) ? ctx.body.ids.map(String) : [];
  if (!ids.length) fail(400, 'موردی انتخاب نشده است.', 'empty');

  const d = db();
  const before = d.entries.length;
  const idSet = new Set(ids);
  d.entries = d.entries.filter((e) => !(e.groupId === g.id && idSet.has(e.id)));
  const removed = before - d.entries.length;
  store.save();
  store.log(user, 'entry_bulk_delete', `حذف ${dt.faNum(removed)} یوزرنیم از «${g.title}»`);
  return { ok: true, removed };
});

route('POST', '/api/groups/:id/move', async (ctx) => {
  const user = auth.requireAdmin(ctx);
  const from = groupById(ctx.params.id);
  const to = groupById(str(ctx.body.targetGroupId, 60));
  const ids = new Set(Array.isArray(ctx.body.ids) ? ctx.body.ids.map(String) : []);
  if (!ids.size) fail(400, 'موردی انتخاب نشده است.', 'empty');
  if (from.id === to.id) fail(400, 'گروه مبدأ و مقصد یکسان است.', 'same_group');

  const existing = new Set(groupEntries(to.id).map((e) => e.username));
  let moved = 0;
  let skipped = 0;
  for (const e of db().entries) {
    if (e.groupId !== from.id || !ids.has(e.id)) continue;
    if (existing.has(e.username)) { skipped += 1; continue; }
    e.groupId = to.id;
    existing.add(e.username);
    moved += 1;
  }
  store.save();
  store.log(user, 'entry_move', `انتقال ${dt.faNum(moved)} یوزرنیم از «${from.title}» به «${to.title}»`);
  return { ok: true, moved, skipped };
});

// --- جست‌وجوی سراسری ---------------------------------------------------------

route('GET', '/api/search', async (ctx) => {
  auth.requireAuth(ctx);
  const q = str(ctx.query.q, 100).toLowerCase().replace(/^@/, '');
  if (q.length < 2) return { results: [] };

  const vis = visibility(ctx);
  // کاربری که اجازهٔ دیدن هیچ لیستی را ندارد، از راه جست‌وجو هم چیزی نمی‌بیند
  if (vis === 'none') return { results: [], blocked: true };

  const titles = new Map(db().groups.map((g) => [g.id, g.title]));
  const results = db().entries
    .filter((e) => e.username.includes(q))
    .filter((e) => vis === 'all' || e.addedBy === ctx.user.id)
    .slice(0, 50)
    .map((e) => ({ ...publicEntry(e, ctx), groupTitle: titles.get(e.groupId) || '' }));

  return { results };
});

/** بررسی سریع تکراری بودن، بدون ثبت (برای بازخورد لحظه‌ای فرم) */
route('GET', '/api/groups/:id/check', async (ctx) => {
  auth.requireAuth(ctx);
  const g = groupById(ctx.params.id);
  const parsed = tg.parseOne(str(ctx.query.username, 100));
  if (!parsed) return { valid: false };

  const inThis = groupEntries(g.id).find((e) => e.username === parsed.key);
  const other = db().entries.find((e) => e.groupId !== g.id && e.username === parsed.key);
  const titles = new Map(db().groups.map((x) => [x.id, x.title]));

  return {
    valid: true,
    username: parsed.display,
    duplicate: !!inThis,
    duplicateBy: inThis ? (inThis.addedByName || '') : null,
    inOtherGroup: other ? (titles.get(other.groupId) || 'گروه دیگر') : null,
  };
});

// --- خروجی گرفتن -------------------------------------------------------------

route('GET', '/api/groups/:id/export', async (ctx) => {
  auth.requireAuth(ctx);
  if (!canViewEntries(ctx)) fail(403, 'اجازهٔ خروجی گرفتن از این لیست را ندارید.', 'forbidden');
  const g = groupById(ctx.params.id);
  const format = str(ctx.query.format, 10) || 'txt';
  const includeWeak = ctx.query.includeWeak === '1';
  const kind = str(ctx.query.type, 10) || 'all'; // all | channel | bot
  const threshold = db().settings.weakScoreThreshold;

  let list = sortEntries(groupEntries(g.id));
  if (!includeWeak) list = list.filter((e) => (e.score || 0) > threshold);
  if (kind === 'bot') list = list.filter(entryIsBot);
  else if (kind === 'channel') list = list.filter((e) => !entryIsBot(e));

  const suffix = kind === 'bot' ? '-bots' : (kind === 'channel' ? '-channels' : '');
  const safeName = (g.title.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 40) || 'group') + suffix;

  if (format === 'csv') {
    const rows = [['username', 'link', 'score', 'note', 'added_by', 'added_at']];
    for (const e of list) {
      rows.push([
        e.display, `https://t.me/${e.display}`, String(e.score || 0),
        e.note || '', e.addedByName || '', dt.formatFull(e.createdAt, tz()),
      ]);
    }
    const csv = '﻿' + rows
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\r\n');
    ctx.raw(200, csv, 'text/csv; charset=utf-8', `${safeName}.csv`);
    return null;
  }

  const body = list.map((e) => '@' + e.display).join('\n');
  ctx.raw(200, body, 'text/plain; charset=utf-8', `${safeName}.txt`);
  return null;
});

// --- آمار --------------------------------------------------------------------

route('GET', '/api/stats', async (ctx) => {
  auth.requireAuth(ctx);
  const groupId = str(ctx.query.groupId, 60) || 'all';
  const data = stats.dashboard(db(), { groupId });
  // کاربر عادی نباید ترکیب کل تیم را ببیند مگر مشاهدهٔ لیست‌ها باز باشد
  if (visibility(ctx) !== 'all') {
    data.topUsers = data.topUsers.filter((u) => u.userId === ctx.user.id);
  }
  return data;
});

// --- کاربران (مدیر) ----------------------------------------------------------

route('GET', '/api/users', async (ctx) => {
  auth.requireAdmin(ctx);
  const counts = new Map();
  for (const e of db().entries) counts.set(e.addedBy, (counts.get(e.addedBy) || 0) + 1);
  const users = db().users.map((u) => ({
    ...auth.publicUser(u),
    entryCount: counts.get(u.id) || 0,
    createdAtLabel: dt.formatShort(u.createdAt, tz()),
    lastLoginLabel: u.lastLoginAt ? dt.formatFull(u.lastLoginAt, tz()) : 'هرگز',
    sessionCount: auth.listUserSessions(u.id).length,
  }));
  return { users };
});

route('POST', '/api/users', async (ctx) => {
  const admin = auth.requireAdmin(ctx);
  const username = str(ctx.body.username, 40);
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(username)) {
    fail(400, 'نام کاربری باید ۳ تا ۴۰ کاراکتر انگلیسی، عدد یا . _ - باشد.', 'bad_username');
  }
  if (auth.findUserByUsername(username)) fail(409, 'این نام کاربری قبلاً ثبت شده است.', 'duplicate');

  const password = String(ctx.body.password || '');
  const problem = auth.checkPasswordStrength(password);
  if (problem) fail(400, problem, 'weak_password');

  const user = auth.createUser({
    username,
    name: str(ctx.body.name, 80) || username,
    password,
    role: ctx.body.role === 'admin' ? 'admin' : 'user',
  });
  user.mustChangePassword = bool(ctx.body.mustChangePassword, true);
  store.save();
  store.log(admin, 'user_create', `ساخت کاربر «${username}» با نقش ${user.role}`);
  return { user: auth.publicUser(user) };
});

route('PATCH', '/api/users/:id', async (ctx) => {
  const admin = auth.requireAdmin(ctx);
  const user = auth.findUserById(ctx.params.id);
  if (!user) fail(404, 'کاربر پیدا نشد.', 'not_found');

  const admins = db().users.filter((u) => u.role === 'admin' && u.active !== false);
  const isLastAdmin = user.role === 'admin' && admins.length <= 1 && user.active !== false;

  if (ctx.body.name !== undefined) user.name = str(ctx.body.name, 80) || user.username;

  if (ctx.body.role !== undefined) {
    const role = ctx.body.role === 'admin' ? 'admin' : 'user';
    if (isLastAdmin && role !== 'admin') fail(400, 'باید حداقل یک مدیر فعال باقی بماند.', 'last_admin');
    user.role = role;
  }

  if (ctx.body.active !== undefined) {
    const active = bool(ctx.body.active, true);
    if (isLastAdmin && !active) fail(400, 'باید حداقل یک مدیر فعال باقی بماند.', 'last_admin');
    if (user.id === admin.id && !active) fail(400, 'نمی‌توانید حساب خودتان را غیرفعال کنید.', 'self');
    user.active = active;
    if (!active) auth.destroyUserSessions(user.id);
  }

  if (ctx.body.password) {
    const problem = auth.checkPasswordStrength(String(ctx.body.password));
    if (problem) fail(400, problem, 'weak_password');
    user.passwordHash = auth.hashPassword(String(ctx.body.password));
    user.mustChangePassword = true;
    auth.destroyUserSessions(user.id);
    store.log(admin, 'user_password_reset', `بازنشانی رمز «${user.username}»`);
  }

  store.save();
  store.log(admin, 'user_update', `ویرایش کاربر «${user.username}»`);
  return { user: auth.publicUser(user) };
});

route('DELETE', '/api/users/:id', async (ctx) => {
  const admin = auth.requireAdmin(ctx);
  const user = auth.findUserById(ctx.params.id);
  if (!user) fail(404, 'کاربر پیدا نشد.', 'not_found');
  if (user.id === admin.id) fail(400, 'نمی‌توانید حساب خودتان را حذف کنید.', 'self');

  const admins = db().users.filter((u) => u.role === 'admin' && u.active !== false);
  if (user.role === 'admin' && admins.length <= 1) {
    fail(400, 'باید حداقل یک مدیر فعال باقی بماند.', 'last_admin');
  }

  const d = db();
  d.users = d.users.filter((u) => u.id !== user.id);
  auth.destroyUserSessions(user.id);
  // یوزرنیم‌های ثبت‌شده حفظ می‌شوند، فقط نام ثبت‌کننده علامت می‌خورد
  for (const e of d.entries) {
    if (e.addedBy === user.id) e.addedByName = (e.addedByName || user.name) + ' (حذف‌شده)';
  }
  store.save();
  store.log(admin, 'user_delete', `حذف کاربر «${user.username}»`);
  return { ok: true };
});

// --- تنظیمات و تاریخچه (مدیر) ------------------------------------------------

route('GET', '/api/settings', async (ctx) => {
  auth.requireAdmin(ctx);
  return { settings: db().settings };
});

route('PATCH', '/api/settings', async (ctx) => {
  const admin = auth.requireAdmin(ctx);
  const s = db().settings;
  const b = ctx.body;

  if (b.siteName !== undefined) s.siteName = str(b.siteName, 80) || s.siteName;
  if (b.timezone !== undefined) {
    const tzv = str(b.timezone, 60);
    try { new Intl.DateTimeFormat('en-US', { timeZone: tzv }); s.timezone = tzv; }
    catch { fail(400, 'منطقهٔ زمانی نامعتبر است.', 'bad_timezone'); }
  }
  if (b.usersEntryVisibility !== undefined) {
    const v = str(b.usersEntryVisibility, 10);
    if (!['all', 'own', 'none'].includes(v)) fail(400, 'مقدار دسترسی نامعتبر است.', 'bad_visibility');
    s.usersEntryVisibility = v;
  }
  if (b.usersCanVote !== undefined) s.usersCanVote = bool(b.usersCanVote, true);
  if (b.usersCanSeeAdText !== undefined) s.usersCanSeeAdText = bool(b.usersCanSeeAdText, true);
  if (b.warnCrossGroupDuplicate !== undefined) s.warnCrossGroupDuplicate = bool(b.warnCrossGroupDuplicate, true);
  if (b.weakScoreThreshold !== undefined) s.weakScoreThreshold = int(b.weakScoreThreshold, -2, -50, 0);

  store.save();
  store.log(admin, 'settings_update', 'به‌روزرسانی تنظیمات');
  return { settings: s };
});

route('GET', '/api/logs', async (ctx) => {
  auth.requireAdmin(ctx);
  const limit = int(ctx.query.limit, 200, 1, 1000);
  const logs = db().logs.slice(-limit).reverse().map((l) => ({
    ...l, atLabel: dt.formatFull(l.at, tz()),
  }));
  return { logs };
});

route('GET', '/api/backup', async (ctx) => {
  auth.requireAdmin(ctx);
  const snapshot = JSON.parse(JSON.stringify(db()));
  for (const u of snapshot.users) delete u.passwordHash;
  const stamp = new Date().toISOString().slice(0, 10);
  ctx.raw(200, JSON.stringify(snapshot, null, 2), 'application/json; charset=utf-8', `backup-${stamp}.json`);
  return null;
});

module.exports = { routes, clientSettings };
