'use strict';

/**
 * تست دود (smoke test) — کل چرخهٔ کاری را روی یک دیتابیس موقت اجرا می‌کند.
 * اجرا:  node scripts/smoke-test.js
 */

const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'chads-test-'));
process.env.DATA_DIR = TMP;
process.env.ADMIN_USER = 'admin';
process.env.ADMIN_PASSWORD = 'AdminPass!2024';
process.env.PORT = '0';
process.env.HOST = '127.0.0.1';
process.env.TRUST_PROXY = '0';

const { server, start } = require('../server/index.js');

let passed = 0;
let failed = 0;

function check(label, condition, extra) {
  if (condition) { passed += 1; console.log(`  ✅ ${label}`); }
  else { failed += 1; console.log(`  ❌ ${label}${extra ? ' → ' + JSON.stringify(extra) : ''}`); }
}

function section(name) { console.log(`\n▸ ${name}`); }

/** درخواست HTTP خام — برای تست مسیرهایی که fetch آن‌ها را نرمال‌سازی می‌کند */
function rawRequest(port, pathname) {
  return new Promise((resolve, reject) => {
    const socket = require('net').connect(port, '127.0.0.1', () => {
      socket.write(`GET ${pathname} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`);
    });
    let buf = '';
    socket.setTimeout(5000, () => { socket.destroy(); reject(new Error('timeout')); });
    socket.on('data', (d) => { buf += d; });
    socket.on('end', () => resolve(buf));
    socket.on('error', reject);
  });
}

/** کلاینت ساده با نگهداری کوکی و CSRF */
function makeClient(base) {
  const state = { cookie: null, csrf: null };
  return {
    state,
    async call(method, pathname, body) {
      const headers = { Accept: 'application/json' };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (state.cookie) headers.Cookie = state.cookie;
      if (state.csrf && method !== 'GET') headers['X-CSRF-Token'] = state.csrf;

      const res = await fetch(base + pathname, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) state.cookie = setCookie.split(';')[0];

      const type = res.headers.get('content-type') || '';
      const data = type.includes('json') ? await res.json() : await res.text();
      if (data && data.csrf) state.csrf = data.csrf;
      return { status: res.status, data, headers: res.headers };
    },
    get(p) { return this.call('GET', p); },
    post(p, b) { return this.call('POST', p, b === undefined ? {} : b); },
    patch(p, b) { return this.call('PATCH', p, b); },
    del(p, b) { return this.call('DELETE', p, b === undefined ? {} : b); },
  };
}

async function run() {
  start();
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  console.log(`سرور آزمایشی: ${base}`);
  console.log(`پوشهٔ داده: ${TMP}`);

  const admin = makeClient(base);
  const user = makeClient(base);

  // ---- ورود ----
  section('احراز هویت');
  let r = await admin.get('/api/me');
  check('کاربر مهمان دسترسی ندارد', r.data.user === null);

  r = await admin.post('/api/login', { username: 'admin', password: 'غلط' });
  check('رمز اشتباه رد می‌شود', r.status === 401, r.data);

  r = await admin.post('/api/login', { username: 'admin', password: 'AdminPass!2024' });
  check('ورود مدیر موفق است', r.status === 200 && r.data.user.role === 'admin', r.data);
  check('توکن CSRF صادر شد', !!admin.state.csrf);

  r = await admin.get('/api/groups');
  check('نشست حفظ می‌شود', r.status === 200, r.data);

  // ---- ساخت کاربر عادی ----
  section('مدیریت کاربران');
  r = await admin.post('/api/users', {
    username: 'reza', name: 'رضا احمدی', password: 'TeamPass!2024', role: 'user',
  });
  check('ساخت کاربر عادی', r.status === 200 && r.data.user.role === 'user', r.data);

  r = await admin.post('/api/users', { username: 'reza', name: 'تکراری', password: 'TeamPass!2024' });
  check('نام کاربری تکراری رد می‌شود', r.status === 409, r.data);

  r = await admin.post('/api/users', { username: 'weak1', name: 'ضعیف', password: '123' });
  check('رمز ضعیف رد می‌شود', r.status === 400, r.data);

  r = await user.post('/api/login', { username: 'reza', password: 'TeamPass!2024' });
  check('ورود کاربر عادی', r.status === 200 && r.data.user.role === 'user', r.data);

  // ---- گروه‌ها ----
  section('گروه‌ها');
  r = await user.post('/api/groups', { title: 'تلاش غیرمجاز' });
  check('کاربر عادی نمی‌تواند گروه بسازد', r.status === 403, r.data);

  r = await admin.post('/api/groups', {
    title: 'کانال‌های ارز دیجیتال',
    description: 'کانال‌های فارسی حوزهٔ کریپتو',
    adText: 'سرمایه‌گذاری هوشمند با ما 🚀',
    color: 'green',
  });
  check('مدیر گروه می‌سازد', r.status === 200, r.data);
  const g1 = r.data.group.id;

  r = await admin.post('/api/groups', { title: 'کانال‌های ورزشی', description: 'اخبار فوتبال' });
  const g2 = r.data.group.id;
  check('گروه دوم ساخته شد', r.status === 200);

  r = await admin.post('/api/groups', { title: 'کانال‌های ارز دیجیتال' });
  check('عنوان تکراری گروه رد می‌شود', r.status === 409, r.data);

  // ---- افزودن یوزرنیم ----
  section('افزودن یوزرنیم');
  r = await user.post(`/api/groups/${g1}/entries`, {
    usernames: '@crypto_alpha\nhttps://t.me/crypto_beta\ncrypto_gamma\n@crypto_alpha\nمتن نامعتبر\n@ab',
    note: 'از جستجوی هشتگ',
  });
  check('۳ یوزرنیم اضافه شد', r.data.added.length === 3, r.data.added.map((e) => e.username));
  check('تکراری داخل ورودی تشخیص داده شد', r.data.dupInInput.length === 1, r.data.dupInInput);
  check('خطوط نامعتبر گزارش شدند', r.data.invalid.length === 2, r.data.invalid);

  r = await user.post(`/api/groups/${g1}/entries`, { usernames: '@crypto_alpha' });
  check('تکراری در همان گروه رد می‌شود', r.data.added.length === 0 && r.data.duplicates.length === 1, r.data);
  check('اطلاعات ثبت‌کنندهٔ قبلی برگشت', r.data.duplicates[0].addedByName === 'رضا احمدی', r.data.duplicates[0]);

  r = await user.post(`/api/groups/${g2}/entries`, { usernames: '@crypto_alpha' });
  check('هشدار تکراری بین‌گروهی', r.data.added.length === 0 && r.data.crossGroup.length === 1, r.data);

  r = await user.post(`/api/groups/${g2}/entries`, { usernames: '@crypto_alpha', allowCrossGroup: true });
  check('با تأیید صریح اضافه می‌شود', r.data.added.length === 1, r.data);

  r = await user.get(`/api/groups/${g1}/check?username=crypto_beta`);
  check('بررسی لحظه‌ای تکراری', r.data.duplicate === true, r.data);

  r = await user.get(`/api/groups/${g1}/check?username=@brand_new_one`);
  check('بررسی لحظه‌ای یوزرنیم جدید', r.data.valid && !r.data.duplicate, r.data);

  // ---- تفکیک کانال و ربات ----
  section('تشخیص خودکار ربات');
  const gBots = (await admin.post('/api/groups', { title: 'گروه ربات‌ها' })).data.group.id;

  r = await admin.post(`/api/groups/${gBots}/entries`, {
    usernames: '@my_shop_bot\n@news_channel\n@AwesomeBOT\n@daily_digest\n@support_bot',
  });
  check('۵ مورد اضافه شد', r.data.added.length === 5, r.data.added.length);
  check('۳ ربات تشخیص داده شد', r.data.addedBots === 3, r.data.addedBots);
  check('۲ کانال تشخیص داده شد', r.data.addedChannels === 2, r.data.addedChannels);
  check('تشخیص به حروف بزرگ/کوچک حساس نیست',
    r.data.added.find((e) => e.username === 'AwesomeBOT').isBot === true);
  check('کانال معمولی ربات شمرده نمی‌شود',
    r.data.added.find((e) => e.username === 'news_channel').isBot === false);

  r = await admin.get(`/api/groups/${gBots}`);
  check('شمارش ربات در گروه درست است', r.data.group.botCount === 3, r.data.group);
  check('شمارش کانال در گروه درست است', r.data.group.channelCount === 2, r.data.group);
  check('جمع کانال و ربات = کل', r.data.group.botCount + r.data.group.channelCount === r.data.group.entryCount);

  // تصحیح دستی: کانالی که به bot ختم می‌شود
  r = await admin.post(`/api/groups/${gBots}/entries`, { usernames: '@news_robot' });
  const robot = r.data.added[0];
  check('news_robot خودکار ربات تشخیص داده می‌شود', robot.isBot === true, robot);

  r = await admin.patch(`/api/entries/${robot.id}`, { type: 'channel' });
  check('مدیر می‌تواند نوع را به کانال تغییر دهد', r.data.entry.isBot === false, r.data.entry);
  check('تغییر دستی علامت‌گذاری می‌شود', r.data.entry.typeManual === true, r.data.entry);

  r = await admin.get(`/api/groups/${gBots}`);
  check('شمارش پس از تصحیح دستی به‌روز شد', r.data.group.channelCount === 3, r.data.group);

  r = await admin.patch(`/api/entries/${robot.id}`, { type: 'auto' });
  check('بازگشت به تشخیص خودکار', r.data.entry.isBot === true && r.data.entry.typeManual === false, r.data.entry);

  r = await user.patch(`/api/entries/${robot.id}`, { type: 'channel' });
  check('کاربر عادی نمی‌تواند نوع را تغییر دهد', r.status === 403, r.data);

  r = await admin.patch(`/api/entries/${robot.id}`, { type: 'حرف بی‌ربط' });
  check('نوع نامعتبر رد می‌شود', r.status === 400, r.data);

  // خروجی تفکیک‌شده
  r = await admin.get(`/api/groups/${gBots}/export?format=txt&type=bot`);
  check('خروجی ربات‌ها فقط ربات دارد',
    r.data.split('\n').every((l) => /bot$/i.test(l)) && r.data.split('\n').length === 4, r.data);

  r = await admin.get(`/api/groups/${gBots}/export?format=txt&type=channel`);
  check('خروجی کانال‌ها هیچ رباتی ندارد',
    r.data.split('\n').every((l) => !/bot$/i.test(l)) && r.data.split('\n').length === 2, r.data);

  r = await admin.get(`/api/groups/${gBots}/export?format=txt&type=all`);
  check('خروجی همه شامل هر دو است', r.data.split('\n').length === 6, r.data);

  r = await admin.get(`/api/groups/${gBots}/export?format=txt&type=bot`);
  check('نام فایل خروجی ربات‌ها متمایز است',
    /bots/.test(r.headers.get('content-disposition') || ''), r.headers.get('content-disposition'));

  await admin.del(`/api/groups/${gBots}`, { confirm: 'گروه ربات‌ها' });

  // ---- نمرهٔ منفی ----
  section('نمرهٔ منفی و چیدمان');
  r = await user.get(`/api/groups/${g1}`);
  const entries = r.data.entries;
  const target = entries.find((e) => e.username === 'crypto_alpha');
  check('کاربر عادی لیست را می‌بیند (پیش‌فرض)', entries.length === 3);

  r = await user.post(`/api/entries/${target.id}/vote`);
  check('ثبت نمرهٔ منفی', r.data.entry.score === -1 && r.data.action === 'added', r.data.entry);

  r = await user.post(`/api/entries/${target.id}/vote`);
  check('رأی دوباره = پس گرفتن رأی', r.data.entry.score === 0 && r.data.action === 'removed', r.data.entry);

  await user.post(`/api/entries/${target.id}/vote`);
  r = await admin.post(`/api/entries/${target.id}/vote`);
  check('دو کاربر مختلف = نمرهٔ ۲-', r.data.entry.score === -2, r.data.entry);

  r = await admin.get(`/api/groups/${g1}`);
  check('یوزرنیم منفی به انتهای لیست رفت',
    r.data.entries[r.data.entries.length - 1].username === 'crypto_alpha',
    r.data.entries.map((e) => `${e.username}:${e.score}`));
  check('مدیر لیست رأی‌دهندگان را می‌بیند', Array.isArray(r.data.entries[2].voters), r.data.entries[2]);

  r = await admin.post(`/api/entries/${target.id}/reset-score`);
  check('مدیر نمره را صفر می‌کند', r.data.entry.score === 0, r.data.entry);

  // ---- محدودیت دسترسی ----
  section('کنترل دسترسی');
  r = await user.del(`/api/entries/${target.id}`);
  check('کاربر عادی نمی‌تواند حذف کند', r.status === 403, r.data);

  r = await user.get('/api/users');
  check('کاربر عادی به لیست کاربران دسترسی ندارد', r.status === 403);

  r = await user.get('/api/settings');
  check('کاربر عادی به تنظیمات دسترسی ندارد', r.status === 403);

  // --- حالت «فقط ثبت‌های خودش» ---
  r = await admin.patch('/api/settings', { usersEntryVisibility: 'own' });
  check('مدیر دسترسی را روی «فقط خودش» می‌گذارد', r.data.settings.usersEntryVisibility === 'own', r.data);

  r = await user.get(`/api/groups/${g1}`);
  check('کاربر فقط ثبت‌های خودش را می‌بیند', r.data.showingOnlyMine === true, r.data);
  check('تعداد نمایش‌داده‌شده = ثبت‌های خودش', r.data.entries.length === 3, r.data.entries.length);

  r = await user.get(`/api/groups/${g1}/export?format=txt`);
  check('خروجی گرفتن برای کاربر محدود بسته است', r.status === 403);

  // --- حالت «هیچ‌چیز» ---
  r = await admin.patch('/api/settings', { usersEntryVisibility: 'none' });
  check('مدیر دسترسی را کاملاً می‌بندد', r.data.settings.usersEntryVisibility === 'none', r.data);

  r = await user.get(`/api/groups/${g1}`);
  check('کاربر هیچ ورودی‌ای نمی‌بیند', r.data.entries.length === 0, r.data.entries.length);
  check('پرچم visibility برابر none است', r.data.visibility === 'none', r.data.visibility);
  check('حتی ثبت‌های خودش هم پنهان است', r.data.showingOnlyMine === false, r.data);
  check('شمارش گروه همچنان نمایش داده می‌شود', r.data.group.entryCount > 0, r.data.group.entryCount);

  r = await user.get('/api/search?q=crypto');
  check('جست‌وجوی سراسری هم بسته است', r.data.blocked === true && r.data.results.length === 0, r.data);

  r = await user.post(`/api/entries/${target.id}/vote`);
  check('رأی دادن هم بسته است', r.status === 403, r.data);

  r = await user.post(`/api/groups/${g1}/entries`, { usernames: '@crypto_beta' });
  check('بررسی تکراری حتی با لیست کاملاً بسته کار می‌کند', r.data.duplicates.length === 1, r.data);

  r = await user.post(`/api/groups/${g1}/entries`, { usernames: '@brand_new_when_blind' });
  check('کاربر همچنان می‌تواند اضافه کند', r.data.added.length === 1, r.data);
  await admin.del(`/api/entries/${r.data.added[0].id}`);

  r = await admin.patch('/api/settings', { usersEntryVisibility: 'invalid' });
  check('مقدار نامعتبر دسترسی رد می‌شود', r.status === 400, r.data);

  await admin.patch('/api/settings', { usersEntryVisibility: 'all' });

  // ---- CSRF ----
  section('امنیت');
  const noCsrf = makeClient(base);
  noCsrf.state.cookie = user.state.cookie;
  r = await noCsrf.post(`/api/groups/${g1}/entries`, { usernames: '@sneaky_one' });
  check('درخواست بدون توکن CSRF رد می‌شود', r.status === 403, r.data);

  const badOrigin = await fetch(`${base}/api/groups`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: admin.state.cookie,
      'X-CSRF-Token': admin.state.csrf,
      Origin: 'https://attacker.example',
    },
    body: JSON.stringify({ title: 'حملهٔ CSRF' }),
  });
  check('مبدأ بیگانه رد می‌شود', badOrigin.status === 403);

  // پیمایش مسیر با سوکت خام (fetch مسیر را قبل از ارسال نرمال‌سازی می‌کند)
  const traversals = [
    '/../server/store.js',
    '/%2e%2e/server/store.js',
    '/%2e%2e%2f%2e%2e%2fserver%2fstore.js',
    '/..%5cserver%5cstore.js',
    '/....//server/store.js',
    '/../data/db.json',
  ];
  const leaks = [];
  for (const p of traversals) {
    const raw = await rawRequest(server.address().port, p);
    if (/module\.exports|scrypt\$|passwordHash/.test(raw)) leaks.push(p);
  }
  check('پیمایش مسیر هیچ فایلی را لو نمی‌دهد', leaks.length === 0, leaks);

  // ---- خروجی ----
  section('خروجی گرفتن');
  r = await admin.get(`/api/groups/${g1}/export?format=txt`);
  check('خروجی TXT ساخته شد', r.status === 200 && r.data.includes('@crypto_'), String(r.data).slice(0, 60));
  check('هدر دانلود درست است', /attachment/.test(r.headers.get('content-disposition') || ''));

  r = await admin.get(`/api/groups/${g1}/export?format=csv`);
  check('خروجی CSV ساخته شد', r.status === 200 && r.data.includes('username'));

  // ---- آمار ----
  // تا اینجا ۴ ثبت انجام شده: ۳ مورد در گروه ۱ و ۱ مورد (تکراری بین‌گروهی) در گروه ۲
  section('آمار');
  r = await admin.get('/api/stats');
  check('سری روزانه ۳۰ نقطه دارد', r.data.range.daily.length === 30, r.data.range.daily.length);
  check('سری هفتگی ۱۲ نقطه دارد', r.data.range.weekly.length === 12);
  check('سری ماهانه ۱۲ نقطه دارد', r.data.range.monthly.length === 12);
  check('آمار امروز درست است', r.data.totals.today === 4, r.data.totals);
  check('مجموع ثبت‌ها درست است', r.data.totals.entries === 4, r.data.totals);
  check('مجموع سری روزانه = کل ثبت‌ها',
    r.data.range.daily.reduce((s, d) => s + d.count, 0) === r.data.totals.entries);
  check('برچسب‌های نمودار فارسی است', /[۰-۹]/.test(r.data.range.daily[29].label), r.data.range.daily[29]);
  check('برترین کاربران محاسبه شد', r.data.topUsers.length === 1 && r.data.topUsers[0].count === 4, r.data.topUsers);
  check('پراکندگی گروه‌ها درست است', r.data.byGroup.length === 2, r.data.byGroup);

  r = await admin.get(`/api/stats?groupId=${g1}`);
  check('فیلتر آمار بر اساس گروه', r.data.totals.entries === 3, r.data.totals);

  // ---- جست‌وجو ----
  section('جست‌وجو');
  r = await admin.get('/api/search?q=crypto');
  check('جست‌وجوی سراسری', r.data.results.length === 4, r.data.results.length);
  r = await admin.get('/api/search?q=c');
  check('جست‌وجوی خیلی کوتاه نتیجه نمی‌دهد', r.data.results.length === 0);

  // ---- انتقال و حذف گروهی ----
  section('عملیات گروهی');
  r = await admin.get(`/api/groups/${g1}`);
  // crypto_alpha از قبل در گروه ۲ هست، پس باید رد شود؛ crypto_beta باید منتقل شود
  const moveIds = r.data.entries
    .filter((e) => ['crypto_alpha', 'crypto_beta'].includes(e.username))
    .map((e) => e.id);
  r = await admin.post(`/api/groups/${g1}/move`, { targetGroupId: g2, ids: moveIds });
  check('انتقال بین گروه‌ها', r.data.moved === 1 && r.data.skipped === 1, r.data);

  r = await admin.get(`/api/groups/${g2}`);
  check('گروه مقصد ۲ مورد دارد', r.data.entries.length === 2, r.data.entries.map((e) => e.username));

  const delIds = r.data.entries.slice(0, 1).map((e) => e.id);
  r = await admin.post(`/api/groups/${g2}/entries/bulk-delete`, { ids: delIds });
  check('حذف گروهی', r.data.removed === 1, r.data);

  // ---- ویرایش و حذف گروه ----
  section('ویرایش و حذف گروه');
  r = await admin.patch(`/api/groups/${g1}`, { title: 'کریپتو (ویرایش‌شده)', adText: 'متن جدید' });
  check('ویرایش گروه', r.data.group.title === 'کریپتو (ویرایش‌شده)', r.data.group);

  r = await admin.patch(`/api/groups/${g1}`, { archived: true });
  check('بایگانی گروه', r.data.group.archived === true);

  r = await user.post(`/api/groups/${g1}/entries`, { usernames: '@after_archive' });
  check('افزودن به گروه بایگانی‌شده ممکن نیست', r.status === 400, r.data);

  await admin.patch(`/api/groups/${g1}`, { archived: false });

  const beforeDelete = (await admin.get('/api/stats')).data.totals.entries;
  const inG1 = (await admin.get(`/api/groups/${g1}`)).data.entries.length;

  r = await admin.del(`/api/groups/${g1}`, {});
  check('حذف گروهِ پر بدون تأیید رد می‌شود', r.status === 400, r.data);

  r = await admin.del(`/api/groups/${g1}`, { confirm: 'کریپتو (ویرایش‌شده)' });
  check('حذف با تأیید صحیح انجام می‌شود', r.status === 200 && r.data.removedEntries === inG1, r.data);

  r = await admin.get('/api/groups');
  check('گروه از لیست حذف شد', r.data.groups.length === 1);

  r = await admin.get('/api/stats');
  check('یوزرنیم‌های گروه حذف‌شده هم پاک شدند',
    r.data.totals.entries === beforeDelete - inG1, { beforeDelete, inG1, now: r.data.totals.entries });

  // ---- محافظت از آخرین مدیر ----
  section('محافظت از حساب مدیر');
  const meId = (await admin.get('/api/me')).data.user.id;
  r = await admin.patch(`/api/users/${meId}`, { role: 'user' });
  check('آخرین مدیر نمی‌تواند نقشش را پایین بیاورد', r.status === 400, r.data);

  r = await admin.del(`/api/users/${meId}`);
  check('حذف حساب خود ممکن نیست', r.status === 400, r.data);

  // ---- تغییر رمز ----
  section('تغییر رمز عبور');
  r = await user.post('/api/account/password', { current: 'اشتباه', next: 'NewTeamPass!24' });
  check('رمز فعلی اشتباه رد می‌شود', r.status === 400, r.data);

  r = await user.post('/api/account/password', { current: 'TeamPass!2024', next: 'NewTeamPass!24' });
  check('تغییر رمز موفق', r.status === 200, r.data);

  const relog = makeClient(base);
  r = await relog.post('/api/login', { username: 'reza', password: 'NewTeamPass!24' });
  check('ورود با رمز جدید', r.status === 200, r.data);

  r = await relog.post('/api/login', { username: 'reza', password: 'TeamPass!2024' });
  check('رمز قدیمی دیگر کار نمی‌کند', r.status === 401);

  // ---- ماندگاری ----
  section('ماندگاری داده');
  require('../server/store.js').flush();
  const live = (await admin.get('/api/stats')).data.totals;
  const raw = JSON.parse(fs.readFileSync(path.join(TMP, 'db.json'), 'utf8'));
  check('فایل db.json با محتوای زنده هم‌خوان است',
    raw.groups.length === live.groups && raw.entries.length === live.entries,
    { file: { groups: raw.groups.length, entries: raw.entries.length }, live });
  check('ساختار JSON کامل است',
    raw.version === 1 && raw.settings && Array.isArray(raw.logs));
  check('رمزها هش شده‌اند', raw.users.every((u) => u.passwordHash.startsWith('scrypt$')));
  check('رمز خام ذخیره نشده', !JSON.stringify(raw).includes('NewTeamPass'));
  check('بکاپ روزانه ساخته شد', fs.readdirSync(path.join(TMP, 'backups')).length >= 1);

  r = await admin.get('/api/backup');
  check('نسخهٔ پشتیبان بدون رمز است', !JSON.stringify(r.data).includes('scrypt$'));

  r = await admin.get('/api/logs');
  check('تاریخچهٔ فعالیت ثبت شده', r.data.logs.length > 5, r.data.logs.length);

  // ---- خروج ----
  section('خروج');
  r = await user.post('/api/logout');
  check('خروج موفق', r.status === 200);
  r = await user.get('/api/groups');
  check('پس از خروج دسترسی قطع می‌شود', r.status === 401);

  // ---- فایل‌های ثابت ----
  section('فایل‌های ثابت');
  let res = await fetch(`${base}/`);
  check('صفحهٔ اصلی سرو می‌شود', res.status === 200 && (await res.text()).includes('<div id="root">'));
  res = await fetch(`${base}/app.js`);
  check('app.js سرو می‌شود', res.status === 200);
  check('هدرهای امنیتی ست شده‌اند', res.headers.get('content-security-policy') !== null);
  res = await fetch(`${base}/healthz`);
  check('healthz پاسخ می‌دهد', res.status === 200);
  res = await fetch(`${base}/group/abc`);
  check('مسیر SPA به index برمی‌گردد', res.status === 200);

  // ---- جمع‌بندی ----
  console.log('\n' + '─'.repeat(52));
  console.log(`  موفق: ${passed}   ناموفق: ${failed}`);
  console.log('─'.repeat(52));

  server.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error('\n💥 تست با خطا متوقف شد:', err);
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(1);
});
