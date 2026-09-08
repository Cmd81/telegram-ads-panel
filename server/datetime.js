'use strict';

/**
 * تبدیل تاریخ میلادی/شمسی و قالب‌بندی فارسی.
 * الگوریتم تبدیل جلالی بر پایهٔ jalaali-js (MIT) پیاده‌سازی شده است تا
 * وابستگی به دادهٔ محلی ICU نداشته باشیم و روی هر بیلد نودی کار کند.
 */

const MONTHS_FA = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
];

const WEEKDAYS_FA = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];

const BREAKS = [
  -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181,
  1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178,
];

const div = (a, b) => ~~(a / b);
const mod = (a, b) => a - ~~(a / b) * b;

function jalCal(jy) {
  const bl = BREAKS.length;
  let leapJ = -14;
  let jp = BREAKS[0];
  let jm = 0;
  let jump = 0;
  if (jy < jp || jy >= BREAKS[bl - 1]) throw new RangeError('سال شمسی خارج از محدوده است: ' + jy);
  for (let i = 1; i < bl; i += 1) {
    jm = BREAKS[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(jy + 621, 4) - div((div(jy + 621, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy: jy + 621, march };
}

function g2d(gy, gm, gd) {
  let d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4)
    + div(153 * mod(gm + 9, 12) + 2, 5)
    + gd - 34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

function d2g(jdn) {
  let j = 4 * jdn + 139361631;
  j += div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

function d2j(jdn) {
  const gy = d2g(jdn).gy;
  let jy = gy - 621;
  const r = jalCal(jy);
  const jdn1f = g2d(gy, 3, r.march);
  let k = jdn - jdn1f;
  if (k >= 0) {
    if (k <= 185) return { jy, jm: 1 + div(k, 31), jd: mod(k, 31) + 1 };
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }
  return { jy, jm: 7 + div(k, 30), jd: mod(k, 30) + 1 };
}

function j2d(jy, jm, jd) {
  const r = jalCal(jy);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}

/** میلادی → شمسی */
function toJalali(gy, gm, gd) {
  return d2j(g2d(gy, gm, gd));
}

/** شمسی → میلادی */
function toGregorian(jy, jm, jd) {
  return d2g(j2d(jy, jm, jd));
}

// ---------------------------------------------------------------------------
// منطقهٔ زمانی
// ---------------------------------------------------------------------------

const fmtCache = new Map();

function partsFormatter(tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      // اگر منطقهٔ زمانی نامعتبر بود، به تهران برمی‌گردیم
      f = new Intl.DateTimeFormat('en-US', {
        timeZone: 'UTC', hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      });
    }
    fmtCache.set(tz, f);
  }
  return f;
}

/** اجزای تاریخ محلی (میلادی) در منطقهٔ زمانی داده‌شده */
function localParts(input, tz) {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return null;
  const parts = partsFormatter(tz).formatToParts(date);
  const get = (t) => Number(parts.find((p) => p.type === t)?.value || 0);
  let hour = get('hour');
  if (hour === 24) hour = 0;
  const y = get('year');
  const m = get('month');
  const d = get('day');
  return {
    y, m, d, hour, minute: get('minute'),
    ymd: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
  };
}

/** روز هفته برای yyyy-mm-dd میلادی: 0=یکشنبه ... 6=شنبه */
function weekdayOf(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** جمع/تفریق روز روی رشتهٔ yyyy-mm-dd */
function addDays(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + days);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

/** ارقام لاتین → فارسی */
function faNum(value) {
  return String(value).replace(/[0-9]/g, (c) => '۰۱۲۳۴۵۶۷۸۹'[Number(c)]);
}

/** yyyy-mm-dd میلادی → «۱۷ شهریور ۱۴۰۵» */
function jalaliLabel(ymd, withYear = true) {
  const [y, m, d] = ymd.split('-').map(Number);
  const j = toJalali(y, m, d);
  const base = `${faNum(j.jd)} ${MONTHS_FA[j.jm - 1]}`;
  return withYear ? `${base} ${faNum(j.jy)}` : base;
}

/** کلید ماه شمسی: «1405-06» */
function jalaliMonthKey(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const j = toJalali(y, m, d);
  return `${j.jy}-${String(j.jm).padStart(2, '0')}`;
}

function jalaliMonthLabel(key) {
  const [jy, jm] = key.split('-').map(Number);
  return `${MONTHS_FA[jm - 1]} ${faNum(jy)}`;
}

/** ماه شمسی قبلی */
function prevJalaliMonth(key) {
  let [jy, jm] = key.split('-').map(Number);
  jm -= 1;
  if (jm < 1) { jm = 12; jy -= 1; }
  return `${jy}-${String(jm).padStart(2, '0')}`;
}

/** تاریخ کامل فارسی: «۱۷ شهریور ۱۴۰۵ ساعت ۱۴:۳۲» */
function formatFull(iso, tz) {
  const p = localParts(iso, tz);
  if (!p) return '';
  const time = `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
  return `${jalaliLabel(p.ymd)} ساعت ${faNum(time)}`;
}

function formatShort(iso, tz) {
  const p = localParts(iso, tz);
  if (!p) return '';
  return jalaliLabel(p.ymd);
}

function weekdayLabel(ymd) {
  return WEEKDAYS_FA[weekdayOf(ymd)];
}

module.exports = {
  MONTHS_FA, WEEKDAYS_FA,
  toJalali, toGregorian,
  localParts, weekdayOf, addDays,
  faNum, jalaliLabel, jalaliMonthKey, jalaliMonthLabel, prevJalaliMonth,
  formatFull, formatShort, weekdayLabel,
};
