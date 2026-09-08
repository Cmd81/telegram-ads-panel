'use strict';

/**
 * ساخت دادهٔ نمونه برای تست محلی رابط کاربری.
 * اجرا:  node scripts/seed-demo.js
 * هشدار: فقط روی دیتابیس خالی یا محیط تست استفاده شود.
 */

const path = require('path');

process.env.DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data-demo');

const store = require('../server/store');
const auth = require('../server/auth');
const { rid } = require('../server/util');

// این اسکریپت فقط برای توسعهٔ محلی است و نباید روی نصب واقعی اجرا شود
if (/[/\\]opt[/\\]channel-ads/.test(store.DATA_DIR)) {
  console.error('این اسکریپت روی نصب واقعی سرور اجرا نمی‌شود.');
  console.error(`مسیر داده: ${store.DATA_DIR}`);
  process.exit(1);
}

store.load();
const db = store.get();

if (db.groups.length > 0) {
  console.log('دیتابیس از قبل داده دارد؛ کاری انجام نشد.');
  process.exit(0);
}

// کاربران
const admin = db.users.length
  ? db.users[0]
  : auth.createUser({ username: 'admin', name: 'مدیر کل', password: 'Admin!2024pass', role: 'admin' });

const team = ['سارا محمدی', 'رضا احمدی', 'مریم کریمی'].map((name, i) => {
  const u = auth.findUserByUsername(`user${i + 1}`);
  return u || auth.createUser({
    username: `user${i + 1}`, name, password: 'Team!2024pass', role: 'user',
  });
});
const everyone = [admin, ...team];

// گروه‌ها
const groupSpecs = [
  ['کانال‌های ارز دیجیتال', 'کانال‌های فارسی حوزهٔ کریپتو و ترید — مخاطب: ۱۸ تا ۳۵ سال', 'green',
    '💎 صرافی امن، کارمزد صفر\nثبت‌نام با کد تخفیف: ADS۱۴۰۵\n👈 @sample_exchange'],
  ['کانال‌های خبری و سیاسی', 'کانال‌های پرمخاطب خبری برای کمپین برندینگ', 'blue',
    '📰 اخبار لحظه‌ای، بدون سانسور\nهمین حالا عضو شوید 👇'],
  ['کانال‌های سرگرمی و فیلم', 'کانال‌های دانلود فیلم و سریال', 'purple',
    '🎬 تماشای آنلاین بدون محدودیت\nاشتراک یک‌ماهه رایگان'],
  ['کانال‌های ورزشی', 'فوتبال، والیبال و اخبار لیگ‌ها', 'amber', ''],
  ['کانال‌های آموزشی', 'کنکور، زبان و مهارت‌های شغلی', 'red', ''],
];

const groups = groupSpecs.map(([title, description, color, adText]) => {
  const g = {
    id: rid('g'), title, description, adText, color, archived: false,
    createdAt: new Date(Date.now() - 90 * 86400000).toISOString(),
    createdBy: admin.id, createdByName: admin.name,
  };
  db.groups.push(g);
  return g;
});

// یوزرنیم‌ها با تاریخ‌های پراکنده در ۹۰ روز گذشته
const prefixes = ['crypto', 'news', 'movie', 'sport', 'edu', 'daily', 'iran', 'tehran', 'fast', 'top',
  'best', 'pro', 'gold', 'digi', 'bit', 'live', 'hot', 'star', 'mega', 'super'];
const suffixes = ['channel', 'news', 'club', 'tv', 'official', 'plus', 'hub', 'zone', 'group',
  'media', 'today', 'now', 'point', 'line', 'world'];

let made = 0;
const used = new Set();

for (const g of groups) {
  const count = 30 + Math.floor(Math.random() * 60);
  for (let i = 0; i < count; i += 1) {
    const name = `${prefixes[Math.floor(Math.random() * prefixes.length)]}_`
      + `${suffixes[Math.floor(Math.random() * suffixes.length)]}_${Math.floor(Math.random() * 900) + 100}`;
    if (used.has(name)) continue;
    used.add(name);

    const who = everyone[Math.floor(Math.random() * everyone.length)];
    // بیشتر ثبت‌ها مربوط به روزهای اخیر باشد تا نمودار طبیعی به نظر برسد
    const daysAgo = Math.floor(Math.pow(Math.random(), 1.8) * 88);
    const when = new Date(Date.now() - daysAgo * 86400000 - Math.random() * 80000000);

    const voters = [];
    if (Math.random() < 0.18) {
      const voterCount = 1 + Math.floor(Math.random() * 2);
      for (let v = 0; v < voterCount && v < everyone.length; v += 1) {
        const voter = everyone[(Math.floor(Math.random() * everyone.length) + v) % everyone.length];
        if (!voters.some((x) => x.userId === voter.id)) {
          voters.push({ userId: voter.id, userName: voter.name, at: new Date().toISOString() });
        }
      }
    }

    db.entries.push({
      id: rid('e'),
      groupId: g.id,
      username: name,
      display: name,
      note: Math.random() < 0.2 ? 'از جستجوی هشتگ' : '',
      score: -voters.length,
      voters,
      addedBy: who.id,
      addedByName: who.name,
      createdAt: when.toISOString(),
      alsoIn: null,
    });
    made += 1;
  }
}

store.flush();
console.log(`✅ ${groups.length} گروه و ${made} یوزرنیم ساخته شد.`);
console.log(`   مسیر داده: ${store.DATA_DIR}`);
console.log('   مدیر : admin / Admin!2024pass');
console.log('   کاربر: user1 / Team!2024pass');
