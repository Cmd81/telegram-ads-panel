'use strict';

const crypto = require('crypto');

/** شناسه یکتای کوتاه با پیشوند، مثل: g_9f3a1c... */
function rid(prefix) {
  return prefix + '_' + crypto.randomBytes(8).toString('hex');
}

function nowIso() {
  return new Date().toISOString();
}

/** رشتهٔ امن: حذف نال‌بایت، تریم و محدود کردن طول */
function str(value, max = 500) {
  if (typeof value !== 'string') return '';
  return value.replace(/\0/g, '').trim().slice(0, max);
}

/** متن چندخطی امن (برای توضیحات و متن تبلیغ) */
function text(value, max = 8000) {
  if (typeof value !== 'string') return '';
  return value.replace(/\0/g, '').replace(/\r\n/g, '\n').trim().slice(0, max);
}

function int(value, dflt = 0, min = -Infinity, max = Infinity) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}

function bool(value, dflt = false) {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 1 || value === '1') return true;
  if (value === 'false' || value === 0 || value === '0') return false;
  return dflt;
}

/** مقایسهٔ زمان‌ثابت برای توکن‌ها */
function safeEqual(a, b) {
  const ba = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function token(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** خطای HTTP با پیام فارسی */
class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || null;
  }
}

function fail(status, message, code) {
  throw new HttpError(status, message, code);
}

module.exports = { rid, nowIso, str, text, int, bool, safeEqual, token, HttpError, fail };
