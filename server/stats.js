'use strict';

const dt = require('./datetime');

/**
 * ساخت سری‌های آماری روزانه / هفتگی / ماهانه از روی زمان ثبت یوزرنیم‌ها.
 * هفته از «شنبه» شروع می‌شود و ماه‌ها شمسی هستند.
 */

const DAYS = 30;
const WEEKS = 12;
const MONTHS = 12;

/** شروع هفته (شنبه) برای یک تاریخ میلادی yyyy-mm-dd */
function weekStart(ymd) {
  const dow = dt.weekdayOf(ymd); // 0=یکشنبه ... 6=شنبه
  return dt.addDays(ymd, -((dow + 1) % 7));
}

function buildSeries(entries, tz) {
  const dayCount = new Map();
  const weekCount = new Map();
  const monthCount = new Map();

  for (const e of entries) {
    const p = dt.localParts(e.createdAt, tz);
    if (!p) continue;
    dayCount.set(p.ymd, (dayCount.get(p.ymd) || 0) + 1);
    const ws = weekStart(p.ymd);
    weekCount.set(ws, (weekCount.get(ws) || 0) + 1);
    const mk = dt.jalaliMonthKey(p.ymd);
    monthCount.set(mk, (monthCount.get(mk) || 0) + 1);
  }

  const today = dt.localParts(new Date(), tz).ymd;

  // روزانه: ۳۰ روز اخیر
  const daily = [];
  for (let i = DAYS - 1; i >= 0; i -= 1) {
    const key = dt.addDays(today, -i);
    daily.push({
      key,
      label: dt.jalaliLabel(key, false),
      sub: dt.weekdayLabel(key),
      full: dt.jalaliLabel(key),
      count: dayCount.get(key) || 0,
    });
  }

  // هفتگی: ۱۲ هفتهٔ اخیر
  const weekly = [];
  const curWeek = weekStart(today);
  for (let i = WEEKS - 1; i >= 0; i -= 1) {
    const key = dt.addDays(curWeek, -i * 7);
    const end = dt.addDays(key, 6);
    weekly.push({
      key,
      label: dt.jalaliLabel(key, false),
      sub: 'تا ' + dt.jalaliLabel(end, false),
      full: `${dt.jalaliLabel(key)} تا ${dt.jalaliLabel(end)}`,
      count: weekCount.get(key) || 0,
    });
  }

  // ماهانه: ۱۲ ماه شمسی اخیر
  const monthly = [];
  let mk = dt.jalaliMonthKey(today);
  const monthKeys = [];
  for (let i = 0; i < MONTHS; i += 1) {
    monthKeys.push(mk);
    mk = dt.prevJalaliMonth(mk);
  }
  monthKeys.reverse();
  for (const key of monthKeys) {
    const label = dt.jalaliMonthLabel(key);
    monthly.push({
      key,
      label: label.split(' ')[0],
      sub: label.split(' ')[1] || '',
      full: label,
      count: monthCount.get(key) || 0,
    });
  }

  return { daily, weekly, monthly, today, dayCount, weekCount, monthCount };
}

/** آمار کامل داشبورد */
function dashboard(db, opts = {}) {
  const tz = db.settings.timezone || 'Asia/Tehran';
  const groupId = opts.groupId && opts.groupId !== 'all' ? opts.groupId : null;

  const entries = groupId
    ? db.entries.filter((e) => e.groupId === groupId)
    : db.entries.slice();

  const s = buildSeries(entries, tz);

  const today = s.today;
  const thisWeek = weekStart(today);
  const thisMonth = dt.jalaliMonthKey(today);
  const yesterday = dt.addDays(today, -1);

  // برترین اعضای تیم
  const byUser = new Map();
  for (const e of entries) {
    const k = e.addedBy || 'unknown';
    const cur = byUser.get(k) || { userId: k, name: e.addedByName || 'نامشخص', count: 0, negative: 0 };
    cur.count += 1;
    if ((e.score || 0) < 0) cur.negative += 1;
    byUser.set(k, cur);
  }
  const topUsers = [...byUser.values()].sort((a, b) => b.count - a.count).slice(0, 12);

  // پراکندگی بین گروه‌ها
  const byGroup = db.groups
    .map((g) => {
      const list = db.entries.filter((e) => e.groupId === g.id);
      return {
        id: g.id,
        title: g.title,
        count: list.length,
        negative: list.filter((e) => (e.score || 0) < 0).length,
      };
    })
    .sort((a, b) => b.count - a.count);

  const negative = entries.filter((e) => (e.score || 0) < 0).length;

  return {
    range: { daily: s.daily, weekly: s.weekly, monthly: s.monthly },
    totals: {
      entries: entries.length,
      groups: groupId ? 1 : db.groups.length,
      users: db.users.filter((u) => u.active !== false).length,
      today: s.dayCount.get(today) || 0,
      yesterday: s.dayCount.get(yesterday) || 0,
      thisWeek: s.weekCount.get(thisWeek) || 0,
      thisMonth: s.monthCount.get(thisMonth) || 0,
      negative,
      clean: entries.length - negative,
    },
    topUsers,
    byGroup,
    todayLabel: dt.jalaliLabel(today),
  };
}

module.exports = { dashboard, buildSeries, weekStart };
