'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const store = require('./store');
const auth = require('./auth');
const { routes } = require('./api');
const { HttpError, safeEqual } = require('./util');

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const TRUST_PROXY = process.env.TRUST_PROXY !== '0';
const FORCE_SECURE_COOKIE = process.env.SECURE_COOKIE === '1';
const MAX_BODY = 12 * 1024 * 1024; // ۱۲ مگابایت — به اندازهٔ بازگردانی فایل پشتیبان بزرگ

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

// ---------------------------------------------------------------------------
// کمکی‌های HTTP
// ---------------------------------------------------------------------------

function clientIp(req) {
  if (TRUST_PROXY) {
    const fwd = req.headers['x-forwarded-for'];
    if (fwd) return String(fwd).split(',')[0].trim();
  }
  return req.socket.remoteAddress || '';
}

function isSecure(req) {
  if (FORCE_SECURE_COOKIE) return true;
  if (TRUST_PROXY && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https') return true;
  return !!req.socket.encrypted;
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'حجم درخواست بیش از حد مجاز است.', 'too_large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function securityHeaders(res, secure) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
    + "img-src 'self' data:; font-src 'self' data:; connect-src 'self'; "
    + "form-action 'self'; frame-ancestors 'none'; base-uri 'self'",
  );
  if (secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
}

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

// ---------------------------------------------------------------------------
// فایل‌های ثابت
// ---------------------------------------------------------------------------

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';

  const target = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^([/\\])+/, ''));
  if (!target.startsWith(PUBLIC_DIR + path.sep) && target !== path.join(PUBLIC_DIR, 'index.html')) {
    return sendJson(res, 403, { error: 'دسترسی مجاز نیست.' });
  }

  let stat;
  try {
    stat = fs.statSync(target);
    if (!stat.isFile()) throw new Error('not a file');
  } catch {
    // مسیرهای اپلیکیشن تک‌صفحه‌ای به index.html برمی‌گردند
    const indexFile = path.join(PUBLIC_DIR, 'index.html');
    try {
      const html = fs.readFileSync(indexFile);
      res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
      return res.end(html);
    } catch {
      return sendJson(res, 404, { error: 'یافت نشد.' });
    }
  }

  const ext = path.extname(target).toLowerCase();
  const type = MIME[ext];
  if (!type) return sendJson(res, 403, { error: 'نوع فایل مجاز نیست.' });

  const etag = `W/"${stat.size}-${Math.floor(stat.mtimeMs)}"`;
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag });
    return res.end();
  }

  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': stat.size,
    ETag: etag,
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300, must-revalidate',
  });
  fs.createReadStream(target).pipe(res);
  return undefined;
}

// ---------------------------------------------------------------------------
// چرخهٔ درخواست
// ---------------------------------------------------------------------------

async function handleApi(req, res, url) {
  const method = req.method.toUpperCase();
  const pathname = url.pathname;

  let match = null;
  let methodMismatch = false;
  for (const r of routes) {
    const m = r.regex.exec(pathname);
    if (!m) continue;
    if (r.method !== method) { methodMismatch = true; continue; }
    match = { route: r, m };
    break;
  }

  if (!match) {
    return sendJson(res, methodMismatch ? 405 : 404, { error: 'این آدرس وجود ندارد.' });
  }

  const cookies = parseCookies(req.headers.cookie);
  const sessionToken = cookies[auth.COOKIE_NAME] || null;
  const session = auth.getSession(sessionToken);
  const user = session ? auth.findUserById(session.userId) : null;
  const activeUser = user && user.active !== false ? user : null;
  if (session && !activeUser) auth.destroySession(sessionToken);

  const secure = isSecure(req);

  const ctx = {
    req,
    res,
    method,
    url,
    query: Object.fromEntries(url.searchParams),
    params: {},
    body: {},
    ip: clientIp(req),
    ua: req.headers['user-agent'] || '',
    sessionToken: activeUser ? sessionToken : null,
    session: activeUser ? session : null,
    user: activeUser,
    setSession(tok) {
      res.setHeader('Set-Cookie', [
        `${auth.COOKIE_NAME}=${tok}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(auth.SESSION_TTL_MS / 1000)}${secure ? '; Secure' : ''}`,
      ]);
    },
    clearSession() {
      res.setHeader('Set-Cookie', [
        `${auth.COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`,
      ]);
    },
    raw(status, body, type, filename) {
      const buf = Buffer.from(body, 'utf8');
      const headers = {
        'Content-Type': type,
        'Content-Length': buf.length,
        'Cache-Control': 'no-store',
      };
      if (filename) {
        headers['Content-Disposition'] = `attachment; filename="${filename.replace(/[^\w.-]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
      }
      res.writeHead(status, headers);
      res.end(buf);
      ctx.handled = true;
    },
    handled: false,
  };

  match.route.keys.forEach((k, i) => { ctx.params[k] = decodeURIComponent(match.m[i + 1]); });

  // بدنهٔ JSON
  if (method !== 'GET' && method !== 'HEAD') {
    const buf = await readBody(req);
    if (buf.length) {
      try {
        ctx.body = JSON.parse(buf.toString('utf8'));
        if (!ctx.body || typeof ctx.body !== 'object') ctx.body = {};
      } catch {
        return sendJson(res, 400, { error: 'قالب درخواست معتبر نیست.' });
      }
    }
  }

  const opts = match.route.opts || {};

  // احراز هویت
  if (!opts.public && !ctx.user) {
    return sendJson(res, 401, { error: 'نشست شما منقضی شده است. دوباره وارد شوید.', code: 'unauthenticated' });
  }

  // محافظت CSRF برای درخواست‌های تغییردهنده
  if (method !== 'GET' && method !== 'HEAD' && !opts.noCsrf) {
    const origin = req.headers.origin;
    if (origin) {
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      try {
        if (new URL(origin).host !== host) {
          return sendJson(res, 403, { error: 'مبدأ درخواست معتبر نیست.', code: 'bad_origin' });
        }
      } catch {
        return sendJson(res, 403, { error: 'مبدأ درخواست معتبر نیست.', code: 'bad_origin' });
      }
    }
    const sent = req.headers['x-csrf-token'];
    if (!ctx.session || !sent || !safeEqual(sent, ctx.session.csrf)) {
      return sendJson(res, 403, { error: 'توکن امنیتی نامعتبر است. صفحه را تازه کنید.', code: 'bad_csrf' });
    }
  }

  const result = await match.route.handler(ctx);
  if (ctx.handled || res.headersSent) return undefined;
  return sendJson(res, 200, result === undefined ? { ok: true } : result);
}

const server = http.createServer((req, res) => {
  const started = Date.now();
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch {
    return sendJson(res, 400, { error: 'آدرس نامعتبر است.' });
  }

  securityHeaders(res, isSecure(req));

  res.on('finish', () => {
    if (process.env.LOG_REQUESTS === '1') {
      console.log(`${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - started}ms`);
    }
  });

  if (url.pathname === '/healthz') {
    return sendJson(res, 200, { ok: true, uptime: Math.round(process.uptime()) });
  }

  if (url.pathname.startsWith('/api/')) {
    return handleApi(req, res, url).catch((err) => {
      if (res.headersSent) return;
      if (err instanceof HttpError) {
        return sendJson(res, err.status, { error: err.message, code: err.code });
      }
      console.error('[api]', err);
      return sendJson(res, 500, { error: 'خطای داخلی سرور رخ داد.' });
    });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendJson(res, 405, { error: 'روش مجاز نیست.' });
  }

  return serveStatic(req, res, url.pathname);
});

// ---------------------------------------------------------------------------
// راه‌اندازی
// ---------------------------------------------------------------------------

function start() {
  store.load();
  auth.loadSessions();
  auth.ensureBootstrapAdmin();

  const sweeper = setInterval(() => auth.sweepSessions(), 60 * 60 * 1000);
  if (sweeper.unref) sweeper.unref();

  server.listen(PORT, HOST, () => {
    console.log(`[channel-ads] در حال اجرا روی http://${HOST}:${PORT}`);
    console.log(`[channel-ads] مسیر داده‌ها: ${store.DATA_DIR}`);
  });

  const shutdown = (signal) => {
    console.log(`\n[channel-ads] دریافت ${signal}، در حال ذخیره و خاموش شدن...`);
    server.close(() => {
      store.flush();
      process.exit(0);
    });
    setTimeout(() => { store.flush(); process.exit(0); }, 5000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', (err) => {
    console.error('[fatal]', err);
    store.flush();
    process.exit(1);
  });
}

if (require.main === module) start();

module.exports = { server, start };
