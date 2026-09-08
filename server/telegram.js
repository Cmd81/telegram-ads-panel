'use strict';

/**
 * تشخیص و نرمال‌سازی یوزرنیم کانال تلگرام.
 * ورودی‌های پذیرفته‌شده:
 *   channelname | @channelname | t.me/channelname | https://t.me/channelname
 *   telegram.me/channelname | telegram.dog/channelname | t.me/s/channelname
 */

const USERNAME_RE = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;
const LINK_RE = /(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\/(?:s\/)?([A-Za-z][A-Za-z0-9_]{3,31})/gi;
const AT_RE = /@([A-Za-z][A-Za-z0-9_]{3,31})/g;

/** تک یوزرنیم را می‌سنجد؛ در صورت معتبر بودن {display,key} برمی‌گرداند */
function parseOne(raw) {
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  if (!s) return null;

  s = s.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  s = s.replace(/^(?:t\.me|telegram\.me|telegram\.dog)\/(?:s\/)?/i, '');
  s = s.replace(/^@+/, '');
  s = s.split(/[?#/\s]/)[0];

  if (!s) return null;
  // لینک‌های دعوت خصوصی (+AbCd / joinchat) قابل استفاده در تلگرام ادز نیستند
  if (s.startsWith('+') || /^joinchat$/i.test(s)) return null;
  if (!USERNAME_RE.test(s)) return null;

  return { display: s, key: s.toLowerCase() };
}

/**
 * استخراج یوزرنیم‌ها از یک متن چندخطی.
 * هر خط جداگانه بررسی می‌شود تا کلمات معمولی به اشتباه یوزرنیم شمرده نشوند:
 *   ۱) اگر خط لینک t.me داشت → همهٔ لینک‌ها
 *   ۲) وگرنه اگر @ داشت → همهٔ @نام‌ها
 *   ۳) وگرنه اگر کل خط یک یوزرنیم معتبر بود → همان
 *   ۴) وگرنه خط به عنوان نامعتبر گزارش می‌شود
 */
function parseList(input) {
  const lines = String(input || '').split(/\r?\n/);
  const items = [];
  const invalid = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const found = [];
    LINK_RE.lastIndex = 0;
    let m;
    while ((m = LINK_RE.exec(trimmed)) !== null) found.push(m[1]);

    if (found.length === 0) {
      AT_RE.lastIndex = 0;
      while ((m = AT_RE.exec(trimmed)) !== null) found.push(m[1]);
    }

    if (found.length === 0 && USERNAME_RE.test(trimmed)) found.push(trimmed);

    if (found.length === 0) {
      invalid.push(trimmed.slice(0, 100));
      continue;
    }

    for (const f of found) {
      const p = parseOne(f);
      if (p) items.push(p);
      else invalid.push(f.slice(0, 100));
    }
  }

  // حذف تکراری‌های داخل خودِ ورودی
  const seen = new Set();
  const unique = [];
  const dupInInput = [];
  for (const it of items) {
    if (seen.has(it.key)) { dupInInput.push(it.display); continue; }
    seen.add(it.key);
    unique.push(it);
  }

  return { items: unique, invalid, dupInInput };
}

module.exports = { parseOne, parseList, USERNAME_RE };
