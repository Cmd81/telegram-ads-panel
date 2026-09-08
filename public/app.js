/* ==========================================================================
   داشبورد کانال‌های تبلیغاتی — اپلیکیشن تک‌صفحه‌ای
   ========================================================================== */
'use strict';

const S = {
  user: null,
  settings: {},
  csrf: null,
  route: { name: 'groups', params: {} },
  cache: {},
};

// ---------------------------------------------------------------------------
// ابزارها
// ---------------------------------------------------------------------------

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fa(n) {
  return String(n).replace(/[0-9]/g, (c) => '۰۱۲۳۴۵۶۷۸۹'[Number(c)]);
}

// ---------------------------------------------------------------------------
// آیکون‌ها (SVG درون‌خطی — با رنگ متن هماهنگ می‌شوند و در هر تمی خوانا هستند)
// ---------------------------------------------------------------------------

const ICONS = {
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/>'
    + '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  trash: '<path d="M3 6h18"/>'
    + '<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>'
    + '<path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'
    + '<path d="M10 11v6M14 11v6"/>',
  reset: '<polyline points="1 4 1 10 7 10"/>'
    + '<path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
  bot: '<rect x="4" y="8" width="16" height="12" rx="2"/>'
    + '<path d="M12 8V5"/><circle cx="12" cy="3" r="1.6"/>'
    + '<path d="M2 13v3M22 13v3"/>'
    + '<path d="M9 13.5v1M15 13.5v1"/>',
  channel: '<path d="M3 11v2a1 1 0 0 0 1 1h2l4 4V6L6 10H4a1 1 0 0 0-1 1z"/>'
    + '<path d="M15.5 8.8a4.5 4.5 0 0 1 0 6.4"/>'
    + '<path d="M18.6 5.7a9 9 0 0 1 0 12.6"/>',
  thumbDown: '<path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.7a2 2 0 0 0-2 1.7l-1.4 9A2 2 0 0 0 4.3 15z"/>'
    + '<path d="M17 2h2.7A2.3 2.3 0 0 1 22 4.3v6.4A2.3 2.3 0 0 1 19.7 13H17"/>',
  edit: '<path d="M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>'
    + '<polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>'
    + '<polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  warn: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>'
    + '<line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
};

/** svg(name) → رشتهٔ SVG آمادهٔ درج. cls برای کلاس اضافی. */
function svg(name, cls = '') {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true" focusable="false">${ICONS[name] || ''}</svg>`;
}

function initials(name) {
  const parts = String(name || '؟').trim().split(/\s+/);
  return (parts[0][0] || '؟') + (parts[1] ? parts[1][0] : '');
}

function toast(message, type = 'info', ms = 4200) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  $('#toasts').appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .25s, transform .25s';
    el.style.opacity = '0';
    el.style.transform = 'translateX(-16px)';
    setTimeout(() => el.remove(), 260);
  }, ms);
}

async function api(pathname, options = {}) {
  const opts = {
    method: options.method || 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
  };
  if (options.body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(options.body);
  }
  if (opts.method !== 'GET' && S.csrf) opts.headers['X-CSRF-Token'] = S.csrf;

  const res = await fetch(pathname, opts);
  let data = null;
  try { data = await res.json(); } catch { /* پاسخ بدون بدنه */ }

  if (!res.ok) {
    if (res.status === 401 && S.user) {
      S.user = null;
      render();
      throw new Error(data?.error || 'نشست منقضی شده است.');
    }
    const err = new Error(data?.error || `خطای ${res.status}`);
    err.code = data?.code;
    err.status = res.status;
    throw err;
  }
  return data;
}

function download(url) {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** کپی بی‌صدا (بدون توست) — برای دکمهٔ تک‌تک ردیف‌ها */
async function copyQuiet(value) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

/**
 * دکمهٔ کپی هر ردیف: بعد از کپی، آیکون به تیک تبدیل می‌شود و ردیف کوتاه
 * سبز می‌شود — تا موقع وارد کردن دونه‌دونه در پنل تبلیغات جای خود را گم نکنید.
 */
function bindCopyButtons(root) {
  $$('[data-copy]', root).forEach((btn) => {
    btn.onclick = async () => {
      if (!await copyQuiet(btn.dataset.copy)) {
        toast('مرورگر اجازهٔ کپی نداد.', 'error');
        return;
      }
      const row = btn.closest('tr');
      btn.classList.add('done');
      btn.innerHTML = svg('check');
      if (row) row.classList.add('just-copied');
      clearTimeout(btn._copyTimer);
      btn._copyTimer = setTimeout(() => {
        btn.classList.remove('done');
        btn.innerHTML = svg('copy');
        if (row) row.classList.remove('just-copied');
      }, 1400);
    };
  });
}

async function copyText(value, message = 'کپی شد.') {
  try {
    await navigator.clipboard.writeText(value);
    toast(message, 'success', 1800);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast(message, 'success', 1800); }
    catch { toast('مرورگر اجازهٔ کپی نداد.', 'error'); }
    ta.remove();
  }
}

// ---------------------------------------------------------------------------
// مودال
// ---------------------------------------------------------------------------

let modalCloser = null;

function closeModal() {
  $('#modal-root').innerHTML = '';
  if (modalCloser) { document.removeEventListener('keydown', modalCloser); modalCloser = null; }
}

/**
 * modal({ title, body, footer, wide, onMount })
 * footer دکمه‌ها را به صورت HTML می‌گیرد؛ data-close برای بستن.
 */
function modal({ title, body, footer = '', wide = false, onMount }) {
  closeModal();
  const root = $('#modal-root');
  root.innerHTML = `
    <div class="overlay" data-overlay>
      <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
        <div class="modal-head">
          <h3>${esc(title)}</h3>
          <button class="btn btn-ghost btn-icon" data-close aria-label="بستن">✕</button>
        </div>
        <div class="modal-body">${body}</div>
        ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
      </div>
    </div>`;

  root.addEventListener('click', (e) => {
    if (e.target.matches('[data-overlay]') || e.target.closest('[data-close]')) closeModal();
  });

  modalCloser = (e) => { if (e.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', modalCloser);

  const el = $('.modal', root);
  const firstInput = $('input, textarea, select', el);
  if (firstInput) setTimeout(() => firstInput.focus(), 60);
  if (onMount) onMount(el);
  return el;
}

function confirmModal({ title, message, confirmLabel = 'تأیید', danger = true, requireText, onConfirm }) {
  modal({
    title,
    body: `
      <p style="margin:0 0 14px;line-height:1.9">${message}</p>
      ${requireText ? `
        <div class="field">
          <label>برای تأیید، عبارت زیر را تایپ کنید:</label>
          <div class="alert alert-amber mono" style="margin-bottom:8px">${esc(requireText)}</div>
          <input type="text" id="confirm-text" autocomplete="off">
        </div>` : ''}`,
    footer: `
      <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="confirm-go">${esc(confirmLabel)}</button>
      <button class="btn btn-ghost" data-close>انصراف</button>`,
    onMount(el) {
      $('#confirm-go', el).onclick = async () => {
        if (requireText && $('#confirm-text', el).value.trim() !== requireText) {
          toast('عبارت وارد شده مطابقت ندارد.', 'error');
          return;
        }
        const btn = $('#confirm-go', el);
        btn.disabled = true;
        try { await onConfirm(); closeModal(); }
        catch (err) { toast(err.message, 'error'); btn.disabled = false; }
      };
    },
  });
}

// ---------------------------------------------------------------------------
// نمودار میله‌ای (SVG)
// ---------------------------------------------------------------------------

function barChart(series, opts = {}) {
  const W = 760;
  const H = opts.height || 230;
  const padTop = 24;
  const padBottom = 40;
  const padX = 12;
  const n = series.length || 1;
  const max = Math.max(1, ...series.map((d) => d.count));
  const slot = (W - padX * 2) / n;
  const barW = Math.max(6, Math.min(46, slot * 0.62));
  const plotH = H - padTop - padBottom;

  const labelStep = Math.ceil(n / (opts.maxLabels || 10));
  let out = '';

  // خطوط راهنما
  for (let i = 0; i <= 3; i += 1) {
    const y = padTop + (plotH / 3) * i;
    const value = Math.round(max - (max / 3) * i);
    out += `<line class="grid-line" x1="${padX}" y1="${y}" x2="${W - padX}" y2="${y}"/>`;
    out += `<text class="axis-label" x="${W - padX + 2}" y="${y + 3}" text-anchor="start">${esc(fa(value))}</text>`;
  }

  series.forEach((d, i) => {
    const x = padX + slot * i + (slot - barW) / 2;
    const hgt = d.count > 0 ? Math.max(3, (d.count / max) * plotH) : 2;
    const y = padTop + plotH - hgt;
    out += `<rect class="bar ${d.count === 0 ? 'zero' : ''}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" `
      + `width="${barW.toFixed(1)}" height="${hgt.toFixed(1)}" rx="3">`
      + `<title>${esc(d.full || d.label)} — ${esc(fa(d.count))} یوزرنیم</title></rect>`;
    if (d.count > 0 && n <= 16) {
      out += `<text class="bar-value" x="${(x + barW / 2).toFixed(1)}" y="${(y - 5).toFixed(1)}" `
        + `text-anchor="middle">${esc(fa(d.count))}</text>`;
    }
    if (i % labelStep === 0 || i === n - 1) {
      const cx = (x + barW / 2).toFixed(1);
      out += `<text class="axis-label" x="${cx}" y="${H - padBottom + 16}" text-anchor="middle">${esc(d.label)}</text>`;
      if (d.sub) {
        out += `<text class="axis-label" x="${cx}" y="${H - padBottom + 29}" text-anchor="middle" opacity=".7">${esc(d.sub)}</text>`;
      }
    }
  });

  out += `<line class="axis" x1="${padX}" y1="${padTop + plotH}" x2="${W - padX}" y2="${padTop + plotH}"/>`;

  return `<div class="chart chart-box"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img">${out}</svg></div>`;
}

function barList(items, valueKey = 'count', nameKey = 'name') {
  if (!items.length) return '<p class="faint center" style="padding:20px">داده‌ای نیست.</p>';
  const max = Math.max(1, ...items.map((i) => i[valueKey]));
  return `<div class="bar-list">${items.map((i) => `
    <div class="bar-row">
      <span class="name">${esc(i[nameKey])}</span>
      <span class="num">${esc(fa(i[valueKey]))}</span>
      <div class="track"><div class="fill" style="width:${(i[valueKey] / max) * 100}%"></div></div>
    </div>`).join('')}</div>`;
}

// ---------------------------------------------------------------------------
// مسیریابی
// ---------------------------------------------------------------------------

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [pathPart] = raw.split('?');
  const parts = pathPart.split('/').filter(Boolean);
  if (!parts.length) return { name: 'groups', params: {} };
  const [name, ...rest] = parts;
  return { name, params: { id: rest[0] } };
}

function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

window.addEventListener('hashchange', () => {
  S.route = parseHash();
  render();
});

// ---------------------------------------------------------------------------
// چیدمان کلی
// ---------------------------------------------------------------------------

const NAV = [
  { key: 'groups', label: 'گروه‌ها', icon: '📁' },
  { key: 'stats', label: 'آمار و نمودار', icon: '📊' },
  { key: 'search', label: 'جست‌وجو', icon: '🔍' },
  { key: 'users', label: 'کاربران', icon: '👥', admin: true },
  { key: 'settings', label: 'تنظیمات', icon: '⚙️', admin: true },
];

function layout(content) {
  const isAdmin = S.user.role === 'admin';
  const nav = NAV
    .filter((n) => !n.admin || isAdmin)
    // جست‌وجو وقتی کاربر اجازهٔ دیدن هیچ لیستی ندارد بی‌معنی است
    .filter((n) => n.key !== 'search' || S.settings.visibility !== 'none')
    .map((n) => `<a href="#/${n.key}" class="${S.route.name === n.key ? 'active' : ''}">${n.icon} ${n.label}</a>`)
    .join('');

  return `
    <header class="app-header">
      <div class="brand">
        <span class="logo">📣</span>
        <span>${esc(S.settings.siteName || 'داشبورد تبلیغات')}</span>
      </div>
      <nav class="nav">${nav}</nav>
      <div class="header-tools">
        <button class="btn btn-ghost btn-icon" id="theme-toggle" title="تغییر تم">🌓</button>
        <button class="user-chip" id="user-menu">
          <span class="avatar">${esc(initials(S.user.name))}</span>
          <span class="uname-text">${esc(S.user.name)}</span>
          ${isAdmin ? '<span class="badge badge-accent">مدیر</span>' : ''}
        </button>
      </div>
    </header>
    <main id="view">${content}</main>`;
}

function bindLayout() {
  const themeBtn = $('#theme-toggle');
  if (themeBtn) themeBtn.onclick = toggleTheme;

  const menu = $('#user-menu');
  if (menu) menu.onclick = openAccountMenu;
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('theme', next); } catch { /* حالت خصوصی */ }
}

function openAccountMenu() {
  modal({
    title: 'حساب کاربری',
    body: `
      <div class="flex" style="gap:14px;margin-bottom:18px">
        <span class="avatar" style="width:44px;height:44px;font-size:16px">${esc(initials(S.user.name))}</span>
        <div>
          <div style="font-weight:600;font-size:15px">${esc(S.user.name)}</div>
          <div class="faint mono" style="font-size:12.5px">${esc(S.user.username)}</div>
        </div>
        <span class="badge ${S.user.role === 'admin' ? 'badge-accent' : 'badge-gray'}" style="margin-right:auto">
          ${S.user.role === 'admin' ? 'مدیر کل' : 'کاربر عادی'}
        </span>
      </div>

      <div class="field">
        <label>نام نمایشی</label>
        <input type="text" id="acc-name" value="${esc(S.user.name)}" maxlength="80">
      </div>
      <button class="btn btn-sm" id="acc-save-name">ذخیرهٔ نام</button>

      <hr style="border:none;border-top:1px solid var(--border);margin:20px 0">

      <h4 style="margin:0 0 12px;font-size:14px">تغییر رمز عبور</h4>
      <div class="field">
        <label>رمز فعلی</label>
        <input type="password" id="acc-cur" autocomplete="current-password">
      </div>
      <div class="field">
        <label>رمز جدید</label>
        <input type="password" id="acc-new" autocomplete="new-password">
        <div class="hint">حداقل ۸ کاراکتر. پس از تغییر، از سایر دستگاه‌ها خارج می‌شوید.</div>
      </div>
      <button class="btn btn-primary btn-sm" id="acc-save-pass">تغییر رمز</button>`,
    footer: `<button class="btn btn-danger" id="acc-logout">خروج از حساب</button>
             <button class="btn btn-ghost" data-close>بستن</button>`,
    onMount(el) {
      $('#acc-save-name', el).onclick = async () => {
        try {
          const r = await api('/api/account/profile', { method: 'POST', body: { name: $('#acc-name', el).value } });
          S.user = r.user;
          toast('نام ذخیره شد.', 'success');
          closeModal();
          render();
        } catch (err) { toast(err.message, 'error'); }
      };

      $('#acc-save-pass', el).onclick = async () => {
        const btn = $('#acc-save-pass', el);
        btn.disabled = true;
        try {
          const r = await api('/api/account/password', {
            method: 'POST',
            body: { current: $('#acc-cur', el).value, next: $('#acc-new', el).value },
          });
          S.csrf = r.csrf;
          S.user.mustChangePassword = false;
          toast('رمز عبور تغییر کرد.', 'success');
          closeModal();
          render();
        } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
      };

      $('#acc-logout', el).onclick = async () => {
        await api('/api/logout', { method: 'POST' }).catch(() => {});
        S.user = null;
        S.csrf = null;
        closeModal();
        render();
      };
    },
  });
}

// ---------------------------------------------------------------------------
// صفحهٔ ورود
// ---------------------------------------------------------------------------

function viewLogin() {
  $('#root').innerHTML = `
    <div class="login-wrap">
      <form class="login-card" id="login-form">
        <div class="logo-big" style="font-size:24px">📣</div>
        <h1>${esc(S.settings.siteName || 'داشبورد کانال‌های تبلیغاتی')}</h1>
        <p class="sub">برای ادامه وارد حساب خود شوید</p>
        <div class="field">
          <label for="lg-user">نام کاربری</label>
          <input type="text" id="lg-user" class="ltr" autocomplete="username" autocapitalize="off" spellcheck="false" required>
        </div>
        <div class="field">
          <label for="lg-pass">رمز عبور</label>
          <input type="password" id="lg-pass" autocomplete="current-password" required>
        </div>
        <div id="lg-error" class="alert alert-red hidden"></div>
        <button type="submit" class="btn btn-primary" style="width:100%;margin-top:6px" id="lg-btn">ورود</button>
      </form>
    </div>`;

  $('#login-form').onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('#lg-btn');
    const errBox = $('#lg-error');
    errBox.classList.add('hidden');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';
    try {
      const r = await api('/api/login', {
        method: 'POST',
        body: { username: $('#lg-user').value, password: $('#lg-pass').value },
      });
      S.user = r.user;
      S.csrf = r.csrf;
      S.settings = r.settings;
      if (!location.hash) location.hash = '#/groups';
      S.route = parseHash();
      render();
      if (r.user.mustChangePassword) {
        setTimeout(() => {
          toast('لطفاً رمز عبور پیش‌فرض خود را تغییر دهید.', 'warn', 7000);
          openAccountMenu();
        }, 400);
      }
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = 'ورود';
      $('#lg-pass').value = '';
      $('#lg-pass').focus();
    }
  };
}

// ---------------------------------------------------------------------------
// صفحهٔ گروه‌ها
// ---------------------------------------------------------------------------

async function viewGroups() {
  const isAdmin = S.user.role === 'admin';
  const showArchived = S.cache.showArchived ? '1' : '0';
  const data = await api(`/api/groups?archived=${showArchived}`);
  S.cache.groups = data.groups;

  const cards = data.groups.map((g) => `
    <article class="group-card ${g.archived ? 'archived' : ''}" data-color="${esc(g.color)}" data-id="${esc(g.id)}">
      <div class="flex-between" style="align-items:flex-start">
        <h3>${esc(g.title)}</h3>
        ${g.archived ? '<span class="badge badge-gray">بایگانی</span>' : ''}
      </div>
      <p class="desc">${esc(g.description || 'بدون توضیحات')}</p>
      <div class="meta">
        <span title="کانال‌ها">${svg('channel', 'ico')} <b>${esc(fa(g.channelCount))}</b></span>
        <span title="ربات‌ها">${svg('bot', 'ico')} <b>${esc(fa(g.botCount))}</b></span>
        ${g.negativeCount ? `<span class="badge badge-red">${fa(g.negativeCount)} منفی</span>` : ''}
        ${!data.canViewEntries ? `<span>سهم من: <b>${esc(fa(g.myCount))}</b></span>` : ''}
        ${g.lastAddedLabel ? `<span style="margin-right:auto">آخرین: ${esc(g.lastAddedLabel.split(' ساعت')[0])}</span>` : ''}
      </div>
    </article>`).join('');

  const html = `
    <div class="page-head">
      <div>
        <h1 class="page-title">گروه‌های تبلیغاتی</h1>
        <p class="page-sub">
          ${esc(fa(data.groups.length))} گروه فعال ·
          مجموع ${esc(fa(data.groups.reduce((s, g) => s + g.entryCount, 0)))} یوزرنیم
        </p>
      </div>
      <div class="flex">
        <label class="switch" style="padding:0">
          <input type="checkbox" id="show-archived" ${S.cache.showArchived ? 'checked' : ''}>
          <span class="track"></span>
          <span class="switch-label">نمایش بایگانی</span>
        </label>
        ${isAdmin ? '<button class="btn btn-primary" id="new-group">➕ گروه جدید</button>' : ''}
      </div>
    </div>
    ${data.groups.length
      ? `<div class="grid grid-cards">${cards}</div>`
      : `<div class="empty">
           <div class="icon">📁</div>
           <h3>هنوز گروهی ساخته نشده است</h3>
           <p>${isAdmin ? 'برای شروع، اولین گروه تبلیغاتی را بسازید.' : 'منتظر بمانید تا مدیر گروه‌ها را ایجاد کند.'}</p>
           ${isAdmin ? '<button class="btn btn-primary" id="new-group-empty">➕ ساخت اولین گروه</button>' : ''}
         </div>`}`;

  $('#view').innerHTML = html;

  $$('.group-card').forEach((c) => {
    c.onclick = () => go(`#/group/${c.dataset.id}`);
  });
  $('#show-archived').onchange = (e) => {
    S.cache.showArchived = e.target.checked;
    render();
  };
  const nb = $('#new-group') || $('#new-group-empty');
  if (nb) nb.onclick = () => groupForm(null);
}

function groupForm(group) {
  const isNew = !group;
  const colors = [
    ['blue', 'آبی'], ['green', 'سبز'], ['amber', 'نارنجی'], ['red', 'قرمز'], ['purple', 'بنفش'],
  ];
  modal({
    title: isNew ? 'ساخت گروه جدید' : 'ویرایش گروه',
    wide: true,
    body: `
      <div class="field">
        <label>عنوان گروه *</label>
        <input type="text" id="g-title" maxlength="120" value="${esc(group?.title || '')}"
               placeholder="مثال: کانال‌های ارز دیجیتال">
      </div>
      <div class="field">
        <label>توضیحات</label>
        <textarea id="g-desc" maxlength="2000" rows="3"
                  placeholder="هدف این گروه، مخاطب هدف، یا هر نکته‌ای برای تیم">${esc(group?.description || '')}</textarea>
      </div>
      <div class="field">
        <label>متن تبلیغ این گروه</label>
        <textarea id="g-ad" maxlength="8000" rows="6"
                  placeholder="متنی که قرار است در Telegram Ads برای این گروه استفاده شود">${esc(group?.adText || '')}</textarea>
        <div class="hint">این متن برای اعضای تیم قابل کپی خواهد بود.</div>
      </div>
      <div class="field">
        <label>رنگ برچسب</label>
        <select id="g-color">
          ${colors.map(([v, l]) => `<option value="${v}" ${group?.color === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>`,
    footer: `<button class="btn btn-primary" id="g-save">${isNew ? 'ساخت گروه' : 'ذخیرهٔ تغییرات'}</button>
             <button class="btn btn-ghost" data-close>انصراف</button>`,
    onMount(el) {
      $('#g-save', el).onclick = async () => {
        const btn = $('#g-save', el);
        const body = {
          title: $('#g-title', el).value,
          description: $('#g-desc', el).value,
          adText: $('#g-ad', el).value,
          color: $('#g-color', el).value,
        };
        if (!body.title.trim()) { toast('عنوان گروه را وارد کنید.', 'error'); return; }
        btn.disabled = true;
        try {
          if (isNew) await api('/api/groups', { method: 'POST', body });
          else await api(`/api/groups/${group.id}`, { method: 'PATCH', body });
          toast(isNew ? 'گروه ساخته شد.' : 'تغییرات ذخیره شد.', 'success');
          closeModal();
          render();
        } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
      };
    },
  });
}

// ---------------------------------------------------------------------------
// صفحهٔ جزئیات گروه
// ---------------------------------------------------------------------------

async function viewGroup() {
  const id = S.route.params.id;
  const data = await api(`/api/groups/${encodeURIComponent(id)}`);
  const g = data.group;
  const isAdmin = S.user.role === 'admin';
  S.cache.group = data;
  S.cache.entries = data.entries;

  const threshold = S.settings.weakScoreThreshold ?? -2;

  $('#view').innerHTML = `
    <div class="page-head">
      <div style="min-width:0">
        <a href="#/groups" class="faint" style="font-size:12.5px">→ بازگشت به گروه‌ها</a>
        <h1 class="page-title" style="margin-top:6px">
          ${esc(g.title)}
          ${g.archived ? '<span class="badge badge-gray">بایگانی</span>' : ''}
        </h1>
        <p class="page-sub">${esc(g.description || 'بدون توضیحات')}</p>
      </div>
      <div class="flex">
        ${isAdmin ? `
          <button class="btn" id="edit-group">✏️ ویرایش</button>
          <button class="btn" id="archive-group">${g.archived ? '📤 خروج از بایگانی' : '📥 بایگانی'}</button>
          <button class="btn btn-danger" id="delete-group">${svg('trash')} حذف گروه</button>` : ''}
      </div>
    </div>

    <div class="grid grid-stats" style="margin-bottom:18px">
      <div class="stat"><div class="label">${svg('channel', 'ico')} کانال‌ها</div>
        <div class="value accent">${esc(fa(g.channelCount))}</div></div>
      <div class="stat"><div class="label">${svg('bot', 'ico')} ربات‌ها</div>
        <div class="value" style="color:var(--purple)">${esc(fa(g.botCount))}</div></div>
      <div class="stat"><div class="label">سالم</div><div class="value green">${esc(fa(g.entryCount - g.negativeCount))}</div></div>
      <div class="stat"><div class="label">دارای نمرهٔ منفی</div><div class="value red">${esc(fa(g.negativeCount))}</div></div>
      <div class="stat"><div class="label">ثبت‌شده توسط من</div><div class="value">${esc(fa(g.myCount))}</div></div>
    </div>

    ${g.canSeeAdText && g.adText ? `
      <div class="card">
        <div class="card-title">
          <span>📝 متن تبلیغ این گروه</span>
          <button class="btn btn-sm" id="copy-ad">کپی متن</button>
        </div>
        <div class="ad-text" id="ad-text-box">${esc(g.adText)}</div>
      </div>` : ''}

    ${!g.archived ? `
      <div class="card">
        <div class="card-title">➕ افزودن یوزرنیم</div>
        <div class="field">
          <textarea id="add-input" rows="4" class="ltr"
            placeholder="@channel_one&#10;https://t.me/channel_two&#10;channel_three"></textarea>
          <div class="hint">
            هر خط یک کانال. فرمت‌های <span class="mono">@name</span>،
            <span class="mono">t.me/name</span> و <span class="mono">name</span> پذیرفته می‌شوند.
            چسباندن لیست انبوه هم پشتیبانی می‌شود.
          </div>
        </div>
        <div class="field">
          <label>یادداشت (اختیاری — روی همهٔ موارد این ثبت اعمال می‌شود)</label>
          <input type="text" id="add-note" maxlength="200" placeholder="مثال: از جستجوی هشتگ ارز">
        </div>
        <div id="add-result"></div>
        <button class="btn btn-primary" id="add-go">افزودن به گروه</button>
      </div>` : '<div class="alert alert-amber">این گروه بایگانی شده و امکان افزودن یوزرنیم ندارد.</div>'}

    ${data.visibility === 'none' ? `
      <div class="card">
        <div class="card-title">📋 لیست یوزرنیم‌ها</div>
        <div class="empty" style="padding:34px 20px">
          <div class="icon">🔒</div>
          <h3>لیست برای شما نمایش داده نمی‌شود</h3>
          <p>
            شما می‌توانید یوزرنیم اضافه کنید، اما مشاهدهٔ لیست فقط برای مدیر است.<br>
            نگران تکراری بودن نباشید — هنگام افزودن، سیستم خودکار بررسی می‌کند.
          </p>
        </div>
      </div>` : `
    <div class="card">
      <div class="card-title">
        <span>📋 ${data.showingOnlyMine ? 'یوزرنیم‌های ثبت‌شده توسط من' : 'لیست یوزرنیم‌ها'}</span>
        <div class="flex">
          ${data.canViewEntries ? `
            <button class="btn btn-sm" id="export-txt">⬇ TXT</button>
            <button class="btn btn-sm" id="export-csv">⬇ CSV</button>
            <button class="btn btn-sm" id="copy-all">📋 کپی</button>` : ''}
        </div>
      </div>

      ${data.showingOnlyMine ? `
        <div class="alert alert-accent">
          مدیر مشاهدهٔ کل لیست را برای کاربران عادی محدود کرده؛ شما فقط ثبت‌های خودتان را می‌بینید.
          بررسی تکراری بودن همچنان روی کل گروه انجام می‌شود.
        </div>` : ''}

      <div class="tabs" id="type-tabs" style="margin-bottom:14px">
        <button data-t="channel">${svg('channel', 'ico')} کانال‌ها
          <span class="badge badge-gray" id="cnt-channel">۰</span></button>
        <button data-t="bot">${svg('bot', 'ico')} ربات‌ها
          <span class="badge badge-gray" id="cnt-bot">۰</span></button>
        <button data-t="all">همه <span class="badge badge-gray" id="cnt-all">۰</span></button>
      </div>

      <div class="toolbar">
        <div class="grow"><input type="search" id="filter" placeholder="جست‌وجو در یوزرنیم‌ها یا یادداشت‌ها..."></div>
        <select id="sort" style="width:auto">
          <option value="score">چیدمان: نمره (منفی‌ها آخر)</option>
          <option value="newest">جدیدترین</option>
          <option value="oldest">قدیمی‌ترین</option>
          <option value="alpha">الفبایی</option>
        </select>
        ${isAdmin ? '<button class="btn btn-sm btn-danger hidden" id="bulk-delete">حذف انتخاب‌شده‌ها</button>' : ''}
      </div>

      <div id="entries-table"></div>
    </div>`}`;

  // --- رویدادها ---
  if (isAdmin) {
    $('#edit-group').onclick = () => groupForm(g);
    $('#archive-group').onclick = async () => {
      await api(`/api/groups/${g.id}`, { method: 'PATCH', body: { archived: !g.archived } });
      toast(g.archived ? 'از بایگانی خارج شد.' : 'به بایگانی منتقل شد.', 'success');
      render();
    };
    $('#delete-group').onclick = () => {
      confirmModal({
        title: 'حذف گروه',
        message: `گروه «${esc(g.title)}» به همراه <b>${fa(g.entryCount)}</b> یوزرنیم برای همیشه حذف می‌شود. این کار برگشت‌پذیر نیست.`,
        confirmLabel: 'حذف قطعی',
        requireText: g.entryCount > 0 ? g.title : null,
        onConfirm: async () => {
          await api(`/api/groups/${g.id}`, { method: 'DELETE', body: { confirm: g.title } });
          toast('گروه حذف شد.', 'success');
          go('#/groups');
        },
      });
    };
  }

  const copyAd = $('#copy-ad');
  if (copyAd) copyAd.onclick = () => copyText(g.adText, 'متن تبلیغ کپی شد.');

  if (data.canViewEntries) {
    // خروجی همان تبی که باز است گرفته می‌شود
    const t = () => S.cache.entryType || 'channel';
    $('#export-txt').onclick = () => download(`/api/groups/${g.id}/export?format=txt&type=${t()}`);
    $('#export-csv').onclick = () => download(`/api/groups/${g.id}/export?format=csv&type=${t()}`);
    $('#copy-all').onclick = () => {
      const list = currentFiltered();
      copyText(list.map((e) => '@' + e.username).join('\n'),
        `${fa(list.length)} ${t() === 'bot' ? 'ربات' : t() === 'channel' ? 'کانال' : 'مورد'} کپی شد.`);
    };
  }

  const addGo = $('#add-go');
  if (addGo) {
    addGo.onclick = () => submitEntries(g.id, false);
    $('#add-input').addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') submitEntries(g.id, false);
    });
  }

  if (data.visibility !== 'none') {
    $('#filter').oninput = renderEntries;
    $('#sort').onchange = renderEntries;
    $$('#type-tabs button').forEach((b) => {
      b.onclick = () => { S.cache.entryType = b.dataset.t; renderEntries(); };
    });
    const bulk = $('#bulk-delete');
    if (bulk) bulk.onclick = () => bulkDelete(g);
    renderEntries();
  }
}

/** فقط فیلتر نوع (کانال / ربات / همه) — برای شمارش تب‌ها */
function byType(list, type) {
  if (type === 'bot') return list.filter((e) => e.isBot);
  if (type === 'channel') return list.filter((e) => !e.isBot);
  return list;
}

function currentFiltered() {
  const q = ($('#filter')?.value || '').trim().toLowerCase().replace(/^@/, '');
  const sort = $('#sort')?.value || 'score';
  let list = byType((S.cache.entries || []).slice(), S.cache.entryType || 'channel');

  if (q) {
    list = list.filter((e) => e.username.toLowerCase().includes(q)
      || (e.note || '').toLowerCase().includes(q)
      || (e.addedByName || '').toLowerCase().includes(q));
  }

  if (sort === 'newest') list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  else if (sort === 'oldest') list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  else if (sort === 'alpha') list.sort((a, b) => a.username.localeCompare(b.username));
  else list.sort((a, b) => b.score - a.score || a.createdAt.localeCompare(b.createdAt));

  return list;
}

function renderEntries() {
  const box = $('#entries-table');
  if (!box) return;
  const isAdmin = S.user.role === 'admin';
  const canVote = S.cache.group.canVote;
  const threshold = S.settings.weakScoreThreshold ?? -2;
  const all = S.cache.entries || [];
  const type = S.cache.entryType || 'channel';
  const list = currentFiltered();

  // شمارنده و حالت فعال تب‌ها
  const counts = { channel: byType(all, 'channel').length, bot: byType(all, 'bot').length, all: all.length };
  for (const t of ['channel', 'bot', 'all']) {
    const badge = $('#cnt-' + t);
    if (badge) badge.textContent = fa(counts[t]);
  }
  $$('#type-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.t === type));

  if (!list.length) {
    const label = type === 'bot' ? 'رباتی' : type === 'channel' ? 'کانالی' : 'موردی';
    box.innerHTML = `<div class="empty"><div class="icon">${type === 'bot' ? '🤖' : '📢'}</div>
      <h3>${esc(label)} یافت نشد</h3><p>${
        byType(all, type).length ? 'فیلتر جست‌وجو را تغییر دهید.'
        : `هنوز ${esc(label)} به این گروه اضافه نشده است.`}</p></div>`;
    return;
  }

  const rows = list.map((e, i) => `
    <tr data-id="${esc(e.id)}" class="${e.score <= threshold ? 'weak' : ''}">
      ${isAdmin ? `<td style="width:32px"><input type="checkbox" class="pick" data-id="${esc(e.id)}" style="width:auto"></td>` : ''}
      <td class="faint nowrap" style="width:40px">${esc(fa(i + 1))}</td>
      <td style="width:38px">
        <button class="icon-btn copy" data-copy="@${esc(e.username)}"
                title="کپی @${esc(e.username)}" aria-label="کپی یوزرنیم">${svg('copy')}</button>
      </td>
      <td>
        <a class="uname" href="${esc(e.link)}" target="_blank" rel="noopener noreferrer">@${esc(e.username)}</a>
        ${type === 'all' ? `<span class="badge ${e.isBot ? 'badge-purple' : 'badge-accent'}"
          style="margin-right:6px">${svg(e.isBot ? 'bot' : 'channel', 'ico')} ${e.isBot ? 'ربات' : 'کانال'}</span>` : ''}
        ${e.typeManual ? '<span class="badge badge-gray" title="نوع دستی تعیین شده">دستی</span>' : ''}
        ${e.note ? `<div class="faint" style="font-size:11.5px">${esc(e.note)}</div>` : ''}
      </td>
      <td style="width:86px">
        <button class="score-btn ${e.votedByMe ? 'voted' : ''} ${e.score < 0 ? 'negative' : ''}"
                data-vote="${esc(e.id)}" ${canVote ? '' : 'disabled'}
                title="${e.score < 0 ? `نمره: ${fa(e.score)} — ` : ''}${e.votedByMe ? 'برای پس گرفتن رأی خود کلیک کنید' : 'ثبت نمرهٔ منفی'}">
          ${svg('thumbDown', 'ico')} ${esc(fa(e.voteCount))}
        </button>
      </td>
      <td class="faint nowrap" style="width:130px">${esc(e.addedByName)}</td>
      <td class="faint nowrap" style="width:160px">${esc(e.createdAtLabel.replace(' ساعت', '،'))}</td>
      ${isAdmin ? `<td style="width:108px"><div class="row-actions">
        <button class="icon-btn swap" data-type="${esc(e.id)}"
                title="${e.isBot ? 'این کانال است، نه ربات' : 'این ربات است، نه کانال'}"
                aria-label="تغییر نوع">${svg(e.isBot ? 'channel' : 'bot')}</button>
        <button class="icon-btn" data-reset="${esc(e.id)}"
                title="صفر کردن نمره" aria-label="صفر کردن نمره">${svg('reset')}</button>
        <button class="icon-btn danger" data-del="${esc(e.id)}"
                title="حذف" aria-label="حذف">${svg('trash')}</button>
      </div></td>` : ''}
    </tr>`).join('');

  box.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr>
          ${isAdmin ? '<th><input type="checkbox" id="pick-all" style="width:auto"></th>' : ''}
          <th>#</th><th></th><th>یوزرنیم</th><th>نمره</th><th>ثبت‌کننده</th><th>تاریخ</th>
          ${isAdmin ? '<th></th>' : ''}
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  bindCopyButtons(box);

  $$('[data-vote]', box).forEach((btn) => {
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        const r = await api(`/api/entries/${btn.dataset.vote}/vote`, { method: 'POST' });
        const idx = S.cache.entries.findIndex((x) => x.id === r.entry.id);
        if (idx >= 0) S.cache.entries[idx] = r.entry;
        renderEntries();
      } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
    };
  });

  if (isAdmin) {
    $$('[data-del]', box).forEach((btn) => {
      btn.onclick = async () => {
        const entry = S.cache.entries.find((x) => x.id === btn.dataset.del);
        confirmModal({
          title: 'حذف یوزرنیم',
          message: `<span class="mono">@${esc(entry.username)}</span> از این گروه حذف شود؟`,
          confirmLabel: 'حذف',
          onConfirm: async () => {
            await api(`/api/entries/${entry.id}`, { method: 'DELETE' });
            S.cache.entries = S.cache.entries.filter((x) => x.id !== entry.id);
            toast('حذف شد.', 'success');
            renderEntries();
          },
        });
      };
    });

    $$('[data-type]', box).forEach((btn) => {
      btn.onclick = async () => {
        const entry = S.cache.entries.find((x) => x.id === btn.dataset.type);
        btn.disabled = true;
        try {
          const r = await api(`/api/entries/${entry.id}`, {
            method: 'PATCH',
            body: { type: entry.isBot ? 'channel' : 'bot' },
          });
          const idx = S.cache.entries.findIndex((x) => x.id === r.entry.id);
          if (idx >= 0) S.cache.entries[idx] = r.entry;
          toast(`@${r.entry.username} به «${r.entry.isBot ? 'ربات' : 'کانال'}» تغییر کرد.`, 'success', 2500);
          renderEntries();
        } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
      };
    });

    $$('[data-reset]', box).forEach((btn) => {
      btn.onclick = async () => {
        try {
          const r = await api(`/api/entries/${btn.dataset.reset}/reset-score`, { method: 'POST' });
          const idx = S.cache.entries.findIndex((x) => x.id === r.entry.id);
          if (idx >= 0) S.cache.entries[idx] = r.entry;
          toast('نمره صفر شد.', 'success');
          renderEntries();
        } catch (err) { toast(err.message, 'error'); }
      };
    });

    const all = $('#pick-all', box);
    const sync = () => {
      const picked = $$('.pick:checked', box).length;
      const bulkBtn = $('#bulk-delete');
      if (bulkBtn) {
        bulkBtn.classList.toggle('hidden', picked === 0);
        bulkBtn.textContent = `حذف ${fa(picked)} مورد انتخاب‌شده`;
      }
      $$('.pick', box).forEach((c) => c.closest('tr').classList.toggle('selected', c.checked));
    };
    all.onchange = () => { $$('.pick', box).forEach((c) => { c.checked = all.checked; }); sync(); };
    $$('.pick', box).forEach((c) => { c.onchange = sync; });
  }
}

async function bulkDelete(group) {
  const ids = $$('.pick:checked').map((c) => c.dataset.id);
  if (!ids.length) return;
  confirmModal({
    title: 'حذف گروهی',
    message: `<b>${fa(ids.length)}</b> یوزرنیم انتخاب‌شده برای همیشه حذف شوند؟`,
    confirmLabel: 'حذف همه',
    onConfirm: async () => {
      const r = await api(`/api/groups/${group.id}/entries/bulk-delete`, { method: 'POST', body: { ids } });
      toast(`${fa(r.removed)} مورد حذف شد.`, 'success');
      render();
    },
  });
}

async function submitEntries(groupId, allowCrossGroup) {
  const input = $('#add-input');
  const note = $('#add-note');
  const btn = $('#add-go');
  const box = $('#add-result');
  const value = input.value.trim();

  if (!value) { toast('چیزی برای افزودن وارد نشده است.', 'error'); return; }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';
  try {
    const r = await api(`/api/groups/${groupId}/entries`, {
      method: 'POST',
      body: { usernames: value, note: note.value, allowCrossGroup },
    });

    let html = '';
    if (r.added.length) {
      const parts = [];
      if (r.addedChannels) parts.push(`<b>${fa(r.addedChannels)}</b> کانال 📢`);
      if (r.addedBots) parts.push(`<b>${fa(r.addedBots)}</b> ربات 🤖`);
      html += `<div class="alert alert-green">✅ ${parts.join(' و ')} اضافه شد.</div>`;
    }
    if (r.duplicates.length) {
      html += `<div class="alert alert-amber">
        ⚠️ <b>${fa(r.duplicates.length)}</b> مورد از قبل در همین گروه بود:
        <div class="result-list">${r.duplicates.map((d) => `
          <div><span class="mono">@${esc(d.username)}</span>
          <span class="faint">${esc(d.addedByName)} · ${esc(d.at)}</span></div>`).join('')}</div>
      </div>`;
    }
    if (r.crossGroup.length) {
      html += `<div class="alert alert-accent">
        ℹ️ <b>${fa(r.crossGroup.length)}</b> مورد در گروه دیگری ثبت شده و اضافه نشد:
        <div class="result-list">${r.crossGroup.map((d) => `
          <div><span class="mono">@${esc(d.username)}</span>
          <span class="faint">در «${esc(d.groupTitle)}»</span></div>`).join('')}</div>
        <button class="btn btn-sm mt" id="force-add">به هر حال اضافه کن</button>
      </div>`;
    }
    if (r.dupInInput.length) {
      html += `<div class="alert alert-amber">🔁 <b>${fa(r.dupInInput.length)}</b> مورد تکراری داخل خودِ ورودی نادیده گرفته شد.</div>`;
    }
    if (r.invalid.length) {
      html += `<div class="alert alert-red">
        ❌ <b>${fa(r.invalid.length)}</b> خط قابل تشخیص نبود:
        <div class="result-list">${r.invalid.map((d) => `<div><span class="mono">${esc(d)}</span></div>`).join('')}</div>
      </div>`;
    }
    box.innerHTML = html;

    if (r.crossGroup.length) {
      $('#force-add').onclick = () => {
        input.value = r.crossGroup.map((d) => '@' + d.username).join('\n');
        submitEntries(groupId, true);
      };
    }

    if (r.added.length) {
      // فقط موارد پذیرفته‌نشده در کادر باقی می‌مانند
      const leftovers = [...r.crossGroup.map((d) => '@' + d.username), ...r.invalid];
      input.value = leftovers.join('\n');
      const data = await api(`/api/groups/${groupId}`);
      S.cache.group = data;
      S.cache.entries = data.entries;
      if (data.visibility !== 'none') renderEntries();
      const gg = data.group;
      const stats = [gg.channelCount, gg.botCount, gg.entryCount - gg.negativeCount,
        gg.negativeCount, gg.myCount];
      $$('.stat .value').forEach((el, i) => { if (stats[i] !== undefined) el.textContent = fa(stats[i]); });
      toast(`${fa(r.added.length)} مورد اضافه شد.`, 'success');
    }
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'افزودن به گروه';
  }
}

// ---------------------------------------------------------------------------
// صفحهٔ آمار
// ---------------------------------------------------------------------------

async function viewStats() {
  const groupId = S.cache.statsGroup || 'all';
  const period = S.cache.statsPeriod || 'daily';
  const data = await api(`/api/stats?groupId=${encodeURIComponent(groupId)}`);
  const groups = S.cache.groups || (await api('/api/groups')).groups;
  S.cache.groups = groups;

  const t = data.totals;
  const periods = [['daily', 'روزانه'], ['weekly', 'هفتگی'], ['monthly', 'ماهانه']];
  const titles = { daily: '۳۰ روز گذشته', weekly: '۱۲ هفتهٔ گذشته', monthly: '۱۲ ماه گذشته' };

  $('#view').innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">آمار فعالیت</h1>
        <p class="page-sub">امروز ${esc(data.todayLabel)}</p>
      </div>
      <select id="stats-group" style="width:auto;min-width:200px">
        <option value="all">همهٔ گروه‌ها</option>
        ${groups.map((g) => `<option value="${esc(g.id)}" ${groupId === g.id ? 'selected' : ''}>${esc(g.title)}</option>`).join('')}
      </select>
    </div>

    <div class="grid grid-stats" style="margin-bottom:18px">
      <div class="stat"><div class="label">امروز</div><div class="value accent">${esc(fa(t.today))}</div>
        <div class="foot">دیروز: ${esc(fa(t.yesterday))}</div></div>
      <div class="stat"><div class="label">این هفته</div><div class="value">${esc(fa(t.thisWeek))}</div>
        <div class="foot">از شنبه تاکنون</div></div>
      <div class="stat"><div class="label">این ماه</div><div class="value">${esc(fa(t.thisMonth))}</div>
        <div class="foot">ماه شمسی جاری</div></div>
      <div class="stat"><div class="label">مجموع</div><div class="value">${esc(fa(t.entries))}</div>
        <div class="foot">در ${esc(fa(t.groups))} گروه</div></div>
      <div class="stat"><div class="label">سالم</div><div class="value green">${esc(fa(t.clean))}</div></div>
      <div class="stat"><div class="label">نمرهٔ منفی</div><div class="value red">${esc(fa(t.negative))}</div></div>
    </div>

    <div class="card">
      <div class="card-title">
        <span>📈 روند ثبت یوزرنیم — ${esc(titles[period])}</span>
        <div class="tabs" id="period-tabs">
          ${periods.map(([k, l]) => `<button data-p="${k}" class="${period === k ? 'active' : ''}">${l}</button>`).join('')}
        </div>
      </div>
      ${barChart(data.range[period], { maxLabels: period === 'daily' ? 10 : 12 })}
    </div>

    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr));margin-top:16px">
      <div class="card" style="margin-top:0">
        <div class="card-title">🏆 فعال‌ترین اعضای تیم</div>
        ${barList(data.topUsers)}
      </div>
      <div class="card" style="margin-top:0">
        <div class="card-title">📁 پراکندگی بین گروه‌ها</div>
        ${barList(data.byGroup, 'count', 'title')}
      </div>
    </div>`;

  $('#stats-group').onchange = (e) => { S.cache.statsGroup = e.target.value; render(); };
  $$('#period-tabs button').forEach((b) => {
    b.onclick = () => { S.cache.statsPeriod = b.dataset.p; render(); };
  });
}

// ---------------------------------------------------------------------------
// صفحهٔ جست‌وجو
// ---------------------------------------------------------------------------

async function viewSearch() {
  $('#view').innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">جست‌وجوی سراسری</h1>
        <p class="page-sub">بررسی کنید یک کانال قبلاً در کدام گروه ثبت شده است</p>
      </div>
    </div>
    <div class="card">
      <div class="field mb0">
        <input type="search" id="q" placeholder="حداقل ۲ حرف از یوزرنیم کانال..." class="ltr" autocomplete="off">
      </div>
    </div>
    <div id="search-results" style="margin-top:16px"></div>`;

  const box = $('#search-results');
  let timer = null;

  $('#q').oninput = (e) => {
    clearTimeout(timer);
    const q = e.target.value.trim();
    if (q.length < 2) { box.innerHTML = ''; return; }
    timer = setTimeout(async () => {
      box.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
      try {
        const r = await api(`/api/search?q=${encodeURIComponent(q)}`);
        if (r.blocked) {
          box.innerHTML = `<div class="empty"><div class="icon">🔒</div>
            <h3>جست‌وجو برای شما در دسترس نیست</h3>
            <p>مدیر مشاهدهٔ لیست‌ها را محدود کرده است.<br>
            تکراری بودن هنگام افزودن به گروه خودکار بررسی می‌شود.</p></div>`;
          return;
        }
        if (!r.results.length) {
          box.innerHTML = `<div class="empty"><div class="icon">🔍</div>
            <h3>یافت نشد</h3><p>هیچ کانال یا رباتی با این نام ثبت نشده است.</p></div>`;
          return;
        }
        box.innerHTML = `<div class="table-wrap"><table>
          <thead><tr><th></th><th>یوزرنیم</th><th>نوع</th><th>گروه</th><th>نمره</th><th>ثبت‌کننده</th><th>تاریخ</th></tr></thead>
          <tbody>${r.results.map((e) => `
            <tr class="${e.score < 0 ? 'weak' : ''}">
              <td style="width:38px"><button class="icon-btn copy" data-copy="@${esc(e.username)}"
                title="کپی @${esc(e.username)}" aria-label="کپی">${svg('copy')}</button></td>
              <td><a class="uname" href="${esc(e.link)}" target="_blank" rel="noopener noreferrer">@${esc(e.username)}</a></td>
              <td><span class="badge ${e.isBot ? 'badge-purple' : 'badge-accent'}">
                ${svg(e.isBot ? 'bot' : 'channel', 'ico')} ${e.isBot ? 'ربات' : 'کانال'}</span></td>
              <td>${esc(e.groupTitle)}</td>
              <td>${e.score < 0 ? `<span class="badge badge-red">${svg('thumbDown', 'ico')} ${esc(fa(e.voteCount))}</span>` : '<span class="faint">۰</span>'}</td>
              <td class="faint">${esc(e.addedByName)}</td>
              <td class="faint nowrap">${esc(e.createdAtLabel.split(' ساعت')[0])}</td>
            </tr>`).join('')}</tbody></table></div>`;
        bindCopyButtons(box);
      } catch (err) { box.innerHTML = `<div class="alert alert-red">${esc(err.message)}</div>`; }
    }, 280);
  };

  $('#q').focus();
}

// ---------------------------------------------------------------------------
// صفحهٔ کاربران (مدیر)
// ---------------------------------------------------------------------------

async function viewUsers() {
  const { users } = await api('/api/users');

  $('#view').innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">کاربران</h1>
        <p class="page-sub">${esc(fa(users.length))} حساب · ${esc(fa(users.filter((u) => u.role === 'admin').length))} مدیر</p>
      </div>
      <button class="btn btn-primary" id="new-user">➕ کاربر جدید</button>
    </div>

    <div class="table-wrap"><table>
      <thead><tr>
        <th>کاربر</th><th>نقش</th><th>وضعیت</th><th>ثبت‌ها</th><th>آخرین ورود</th><th></th>
      </tr></thead>
      <tbody>${users.map((u) => `
        <tr>
          <td>
            <div class="flex" style="gap:10px">
              <span class="avatar">${esc(initials(u.name))}</span>
              <div>
                <div style="font-weight:500">${esc(u.name)}</div>
                <div class="faint mono" style="font-size:11.5px">${esc(u.username)}</div>
              </div>
            </div>
          </td>
          <td><span class="badge ${u.role === 'admin' ? 'badge-accent' : 'badge-gray'}">
            ${u.role === 'admin' ? 'مدیر کل' : 'کاربر'}</span></td>
          <td>
            <span class="badge ${u.active ? 'badge-green' : 'badge-red'}">${u.active ? 'فعال' : 'غیرفعال'}</span>
            ${u.restored ? '<span class="badge badge-amber" title="از فایل پشتیبان بازگردانی شده — رمز بگذارید و فعالش کنید">نیازمند رمز</span>'
              : (u.mustChangePassword ? '<span class="badge badge-amber">رمز موقت</span>' : '')}
          </td>
          <td><b>${esc(fa(u.entryCount))}</b></td>
          <td class="faint nowrap" style="font-size:12px">${esc(u.lastLoginLabel)}</td>
          <td><div class="row-actions">
            <button class="icon-btn" data-edit="${esc(u.id)}" title="ویرایش" aria-label="ویرایش">${svg('edit')}</button>
            ${u.id !== S.user.id ? `<button class="icon-btn danger" data-del="${esc(u.id)}" title="حذف" aria-label="حذف">${svg('trash')}</button>` : ''}
          </div></td>
        </tr>`).join('')}</tbody>
    </table></div>`;

  $('#new-user').onclick = () => userForm(null);
  $$('[data-edit]').forEach((b) => {
    b.onclick = () => userForm(users.find((u) => u.id === b.dataset.edit));
  });
  $$('[data-del]').forEach((b) => {
    b.onclick = () => {
      const u = users.find((x) => x.id === b.dataset.del);
      confirmModal({
        title: 'حذف کاربر',
        message: `حساب «${esc(u.name)}» حذف شود؟ یوزرنیم‌هایی که ثبت کرده حفظ می‌شوند.`,
        confirmLabel: 'حذف کاربر',
        onConfirm: async () => {
          await api(`/api/users/${u.id}`, { method: 'DELETE' });
          toast('کاربر حذف شد.', 'success');
          render();
        },
      });
    };
  });
}

function userForm(user) {
  const isNew = !user;
  modal({
    title: isNew ? 'افزودن کاربر' : `ویرایش «${user.name}»`,
    body: `
      <div class="field">
        <label>نام کاربری *</label>
        <input type="text" id="u-username" class="ltr" maxlength="40" value="${esc(user?.username || '')}"
               ${isNew ? '' : 'disabled'} autocomplete="off" placeholder="ali_rezaei">
        ${isNew ? '<div class="hint">فقط حروف انگلیسی، عدد و . _ -</div>' : ''}
      </div>
      <div class="field">
        <label>نام نمایشی</label>
        <input type="text" id="u-name" maxlength="80" value="${esc(user?.name || '')}" placeholder="علی رضایی">
      </div>
      <div class="field">
        <label>${isNew ? 'رمز عبور *' : 'رمز جدید (خالی بگذارید تا تغییر نکند)'}</label>
        <input type="password" id="u-pass" autocomplete="new-password">
        <div class="hint">حداقل ۸ کاراکتر. کاربر با رمز موقت وارد می‌شود و باید آن را تغییر دهد.</div>
      </div>
      <div class="field">
        <label>نقش</label>
        <select id="u-role">
          <option value="user" ${user?.role !== 'admin' ? 'selected' : ''}>کاربر عادی — فقط دیدن گروه‌ها و افزودن یوزرنیم</option>
          <option value="admin" ${user?.role === 'admin' ? 'selected' : ''}>مدیر کل — دسترسی کامل</option>
        </select>
      </div>
      ${isNew ? '' : `
        <label class="switch">
          <input type="checkbox" id="u-active" ${user.active ? 'checked' : ''}>
          <span class="track"></span>
          <span><span class="switch-label">حساب فعال باشد</span>
          <span class="switch-desc">غیرفعال کردن، کاربر را فوراً از همهٔ دستگاه‌ها خارج می‌کند.</span></span>
        </label>`}`,
    footer: `<button class="btn btn-primary" id="u-save">${isNew ? 'ساخت کاربر' : 'ذخیره'}</button>
             <button class="btn btn-ghost" data-close>انصراف</button>`,
    onMount(el) {
      $('#u-save', el).onclick = async () => {
        const btn = $('#u-save', el);
        btn.disabled = true;
        try {
          if (isNew) {
            await api('/api/users', {
              method: 'POST',
              body: {
                username: $('#u-username', el).value,
                name: $('#u-name', el).value,
                password: $('#u-pass', el).value,
                role: $('#u-role', el).value,
              },
            });
            toast('کاربر ساخته شد.', 'success');
          } else {
            const body = {
              name: $('#u-name', el).value,
              role: $('#u-role', el).value,
              active: $('#u-active', el).checked,
            };
            const pass = $('#u-pass', el).value;
            if (pass) body.password = pass;
            await api(`/api/users/${user.id}`, { method: 'PATCH', body });
            toast('تغییرات ذخیره شد.', 'success');
          }
          closeModal();
          render();
        } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
      };
    },
  });
}

// ---------------------------------------------------------------------------
// صفحهٔ تنظیمات (مدیر)
// ---------------------------------------------------------------------------

async function viewSettings() {
  const { settings } = await api('/api/settings');
  const { logs } = await api('/api/logs?limit=80');

  const sw = (id, label, desc, checked) => `
    <label class="switch">
      <input type="checkbox" id="${id}" ${checked ? 'checked' : ''}>
      <span class="track"></span>
      <span><span class="switch-label">${label}</span><br><span class="switch-desc">${desc}</span></span>
    </label>`;

  $('#view').innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">تنظیمات</h1>
        <p class="page-sub">پیکربندی داشبورد و دسترسی‌ها</p>
      </div>
    </div>

    <div class="card">
      <div class="card-title">عمومی</div>
      <div class="field">
        <label>نام داشبورد</label>
        <input type="text" id="s-name" maxlength="80" value="${esc(settings.siteName)}">
      </div>
      <div class="field">
        <label>منطقهٔ زمانی</label>
        <select id="s-tz">
          ${['Asia/Tehran', 'Asia/Dubai', 'Europe/Istanbul', 'Europe/London', 'UTC']
            .map((z) => `<option value="${z}" ${settings.timezone === z ? 'selected' : ''}>${z}</option>`).join('')}
        </select>
        <div class="hint">مبنای محاسبهٔ روز، هفته و ماه در نمودارها.</div>
      </div>
      <div class="field">
        <label>آستانهٔ «مشکوک» بر اساس نمرهٔ منفی</label>
        <input type="number" id="s-threshold" min="-50" max="0" value="${esc(settings.weakScoreThreshold)}">
        <div class="hint">
          یوزرنیم‌هایی با نمرهٔ برابر یا کمتر از این عدد قرمز می‌شوند و به‌طور پیش‌فرض از خروجی TXT/CSV حذف می‌شوند.
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">دسترسی کاربران عادی</div>
      <div class="field">
        <label>کاربر عادی چقدر از لیست را ببیند؟</label>
        <select id="s-visibility">
          <option value="all" ${settings.usersEntryVisibility === 'all' ? 'selected' : ''}>
            کل لیست گروه — همه چیز را می‌بیند
          </option>
          <option value="own" ${settings.usersEntryVisibility === 'own' ? 'selected' : ''}>
            فقط ثبت‌های خودش
          </option>
          <option value="none" ${settings.usersEntryVisibility === 'none' ? 'selected' : ''}>
            هیچ‌چیز — فقط می‌تواند اضافه کند
          </option>
        </select>
        <div class="hint">
          در هر سه حالت، <b>بررسی تکراری روی کل گروه</b> انجام می‌شود؛ پس دادهٔ تکراری وارد نمی‌شود.
          گزینهٔ «هیچ‌چیز» جست‌وجوی سراسری و خروجی گرفتن را هم برای کاربر عادی می‌بندد.
        </div>
      </div>
      ${sw('s-vote', 'ثبت نمرهٔ منفی برای یوزرنیم‌ها',
        'هر کاربر برای هر یوزرنیم فقط یک نمرهٔ منفی می‌تواند بدهد و می‌تواند آن را پس بگیرد.',
        settings.usersCanVote)}
      ${sw('s-ad', 'مشاهدهٔ متن تبلیغ گروه',
        'برای کپی کردن متن آماده توسط اعضای تیم.',
        settings.usersCanSeeAdText)}
      ${sw('s-cross', 'هشدار تکراری بودن در سایر گروه‌ها',
        'اگر کانالی در گروه دیگری ثبت شده باشد، قبل از افزودن هشدار داده می‌شود.',
        settings.warnCrossGroupDuplicate)}
      <button class="btn btn-primary mt" id="s-save">ذخیرهٔ تنظیمات</button>
    </div>

    <div class="card">
      <div class="card-title">پشتیبان‌گیری و بازگردانی</div>
      <p class="muted" style="margin-top:0">
        سرور هر روز یک نسخهٔ پشتیبان خودکار می‌سازد. برای گرفتن نسخهٔ کامل داده‌ها دکمهٔ زیر را بزنید.
      </p>
      <button class="btn" id="s-backup">${svg('download')} دانلود نسخهٔ پشتیبان</button>

      <hr style="border:none;border-top:1px solid var(--border);margin:20px 0">

      <h4 style="margin:0 0 8px;font-size:14px">بازگردانی از فایل پشتیبان</h4>
      <p class="muted" style="margin-top:0">
        فایل JSON که قبلاً دانلود کرده‌اید را انتخاب کنید. قبل از هر تغییر،
        یک نسخهٔ پشتیبان خودکار از وضعیت فعلی ساخته می‌شود.
      </p>
      <input type="file" id="s-restore-file" accept=".json,application/json"
             style="padding:8px;background:var(--bg-soft);border:1px dashed var(--border);
                    border-radius:var(--radius-sm);width:100%;cursor:pointer">
      <div id="s-restore-info" style="margin-top:12px"></div>
    </div>

    <div class="card">
      <div class="card-title">تاریخچهٔ فعالیت</div>
      <div class="table-wrap" style="max-height:420px;overflow-y:auto">
        <table><thead><tr><th>زمان</th><th>کاربر</th><th>رویداد</th></tr></thead>
        <tbody>${logs.map((l) => `
          <tr><td class="faint nowrap" style="font-size:12px">${esc(l.atLabel)}</td>
          <td>${esc(l.userName)}</td><td>${esc(l.detail)}</td></tr>`).join('')}</tbody>
        </table>
      </div>
    </div>`;

  $('#s-save').onclick = async () => {
    const btn = $('#s-save');
    btn.disabled = true;
    try {
      const r = await api('/api/settings', {
        method: 'PATCH',
        body: {
          siteName: $('#s-name').value,
          timezone: $('#s-tz').value,
          weakScoreThreshold: Number($('#s-threshold').value),
          usersEntryVisibility: $('#s-visibility').value,
          usersCanVote: $('#s-vote').checked,
          usersCanSeeAdText: $('#s-ad').checked,
          warnCrossGroupDuplicate: $('#s-cross').checked,
        },
      });
      S.settings = { ...S.settings, siteName: r.settings.siteName, weakScoreThreshold: r.settings.weakScoreThreshold };
      toast('تنظیمات ذخیره شد.', 'success');
      render();
    } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
  };

  $('#s-backup').onclick = () => download('/api/backup');
  $('#s-restore-file').onchange = (e) => previewRestore(e.target.files[0]);
}

/** خواندن فایل انتخاب‌شده، نمایش خلاصه و گرفتن تأیید قبل از بازگردانی */
async function previewRestore(file) {
  const box = $('#s-restore-info');
  if (!file) { box.innerHTML = ''; return; }

  box.innerHTML = '<div class="loading" style="padding:20px"><span class="spinner"></span></div>';

  let data;
  try {
    const raw = await file.text();
    data = JSON.parse(raw);
  } catch {
    box.innerHTML = `<div class="alert alert-red">${svg('warn', 'ico')}
      فایل قابل خواندن نیست — مطمئن شوید همان فایل JSON دانلودشده است.</div>`;
    return;
  }

  if (!data || !Array.isArray(data.groups) || !Array.isArray(data.entries)) {
    box.innerHTML = `<div class="alert alert-red">${svg('warn', 'ico')}
      ساختار فایل درست نیست: کلیدهای <span class="mono">groups</span> و
      <span class="mono">entries</span> پیدا نشد.</div>`;
    return;
  }

  const when = data.backupMeta?.createdAt
    ? new Date(data.backupMeta.createdAt).toLocaleString('fa-IR')
    : null;
  const userCount = Array.isArray(data.users) ? data.users.length : 0;

  box.innerHTML = `
    <div class="alert alert-accent" style="margin-bottom:14px">
      <b>${esc(file.name)}</b> خوانده شد.
      ${when ? `<br>تاریخ ساخت بکاپ: ${esc(when)}` : ''}
      <div class="result-list" style="margin-top:8px">
        <div><span>گروه‌ها</span><b>${esc(fa(data.groups.length))}</b></div>
        <div><span>یوزرنیم‌ها</span><b>${esc(fa(data.entries.length))}</b></div>
        <div><span>کاربران</span><b>${esc(fa(userCount))}</b></div>
      </div>
    </div>

    <div class="field">
      <label>روش بازگردانی</label>
      <select id="rs-mode">
        <option value="merge">ادغام — فقط موارد جدید اضافه شوند (چیزی حذف نمی‌شود)</option>
        <option value="replace">جایگزینی کامل — همهٔ گروه‌ها و یوزرنیم‌های فعلی با فایل عوض شوند</option>
      </select>
    </div>

    <label class="switch">
      <input type="checkbox" id="rs-settings">
      <span class="track"></span>
      <span><span class="switch-label">بازگردانی تنظیمات</span><br>
      <span class="switch-desc">نام داشبورد، منطقهٔ زمانی و سطح دسترسی کاربران</span></span>
    </label>

    ${userCount ? `
      <label class="switch">
        <input type="checkbox" id="rs-users">
        <span class="track"></span>
        <span><span class="switch-label">بازگردانی کاربران</span><br>
        <span class="switch-desc">
          فایل پشتیبان رمز عبور ندارد. کاربرانی که الان وجود ندارند
          <b>غیرفعال و بدون رمز</b> ساخته می‌شوند تا خودتان رمزشان را بگذارید.
          حساب‌های فعلی هرگز تغییر نمی‌کنند.
        </span></span>
      </label>` : ''}

    <div id="rs-warning"></div>
    <button class="btn btn-primary mt" id="rs-go">${svg('upload')} بازگردانی</button>`;

  const modeSel = $('#rs-mode');
  const warnBox = $('#rs-warning');
  const showWarning = () => {
    warnBox.innerHTML = modeSel.value === 'replace'
      ? `<div class="alert alert-red mt">${svg('warn', 'ico')}
           <b>هشدار:</b> همهٔ گروه‌ها و یوزرنیم‌های فعلی حذف و با محتوای فایل جایگزین می‌شوند.
           (یک نسخهٔ پشتیبان خودکار قبلش ساخته می‌شود.)</div>`
      : '';
  };
  modeSel.onchange = showWarning;
  showWarning();

  $('#rs-go').onclick = () => {
    const mode = modeSel.value;
    const body = {
      data,
      mode,
      includeSettings: $('#rs-settings').checked,
      includeUsers: $('#rs-users') ? $('#rs-users').checked : false,
    };

    const run = async () => {
      const r = await api('/api/restore', { method: 'POST', body });
      const lines = [
        `گروه‌های اضافه‌شده: <b>${fa(r.addedGroups)}</b>`,
        `یوزرنیم‌های اضافه‌شده: <b>${fa(r.addedEntries)}</b>`,
      ];
      if (r.skippedEntries) lines.push(`تکراری و رد شده: <b>${fa(r.skippedEntries)}</b>`);
      if (r.addedUsers) lines.push(`کاربران اضافه‌شده (غیرفعال): <b>${fa(r.addedUsers)}</b>`);
      if (r.ignoredEntries) lines.push(`رکورد ناقص و نادیده‌گرفته‌شده: <b>${fa(r.ignoredEntries)}</b>`);
      lines.push(`وضعیت نهایی: <b>${fa(r.after.groups)}</b> گروه و <b>${fa(r.after.entries)}</b> یوزرنیم`);

      toast('بازگردانی انجام شد.', 'success');
      $('#s-restore-info').innerHTML =
        `<div class="alert alert-green">✅ بازگردانی کامل شد.<br>${lines.join('<br>')}</div>`;
      $('#s-restore-file').value = '';
      S.cache.groups = null;
    };

    if (mode === 'replace') {
      confirmModal({
        title: 'جایگزینی کامل داده‌ها',
        message: 'همهٔ گروه‌ها و یوزرنیم‌های فعلی حذف و با محتوای فایل جایگزین می‌شوند.'
          + '<br>برای تأیید، عبارت زیر را تایپ کنید.',
        confirmLabel: 'جایگزین کن',
        requireText: 'جایگزینی',
        onConfirm: run,
      });
    } else {
      run().catch((err) => toast(err.message, 'error'));
    }
  };
}

// ---------------------------------------------------------------------------
// رندر اصلی
// ---------------------------------------------------------------------------

const VIEWS = {
  groups: viewGroups,
  group: viewGroup,
  stats: viewStats,
  search: viewSearch,
  users: viewUsers,
  settings: viewSettings,
};

async function render() {
  if (!S.user) { viewLogin(); return; }

  const name = VIEWS[S.route.name] ? S.route.name : 'groups';
  const isAdminOnly = ['users', 'settings'].includes(name);
  if (isAdminOnly && S.user.role !== 'admin') {
    go('#/groups');
    return;
  }

  $('#root').innerHTML = layout('<div class="loading"><span class="spinner"></span></div>');
  bindLayout();

  try {
    await VIEWS[name]();
  } catch (err) {
    if (!S.user) return;
    $('#view').innerHTML = `
      <div class="empty">
        <div class="icon">⚠️</div>
        <h3>مشکلی پیش آمد</h3>
        <p>${esc(err.message)}</p>
        <button class="btn" onclick="location.reload()">تلاش دوباره</button>
      </div>`;
  }
}

// ---------------------------------------------------------------------------
// راه‌اندازی
// ---------------------------------------------------------------------------

(async function boot() {
  try {
    const saved = localStorage.getItem('theme');
    if (saved) document.documentElement.dataset.theme = saved;
  } catch { /* حالت خصوصی */ }

  S.route = parseHash();
  try {
    const r = await api('/api/me');
    S.user = r.user;
    S.csrf = r.csrf;
    S.settings = r.settings;
    if (r.settings.siteName) document.title = r.settings.siteName;
  } catch { /* بدون نشست */ }

  render();
}());
