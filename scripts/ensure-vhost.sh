#!/usr/bin/env bash
# ============================================================================
#  تضمین وجود بلوک nginx داشبورد
#
#  کاربرد: وقتی داشبورد پشت nginx یک پروژهٔ دیگر (مثلاً داخل داکر) سرو می‌شود
#  و استقرار آن پروژه فایل تنظیمات nginx را بازتولید می‌کند، این اسکریپت
#  بلوک داشبورد را دوباره اضافه می‌کند.
#
#  اجرای دستی:
#      sudo bash /opt/channel-ads/scripts/ensure-vhost.sh
#
#  اجرای خودکار: با ensure-vhost-install.sh یک ناظر systemd نصب کنید که
#  به محض تغییر فایل nginx این اسکریپت را صدا بزند.
#
#  تنظیمات از /opt/channel-ads/vhost.env خوانده می‌شود.
# ============================================================================

set -uo pipefail

APP_DIR="/opt/channel-ads"
VHOST_ENV="${APP_DIR}/vhost.env"

[ -f "$VHOST_ENV" ] || { echo "vhost.env پیدا نشد: $VHOST_ENV" >&2; exit 1; }
# shellcheck disable=SC1090
. "$VHOST_ENV"

: "${NGINX_CONF:?NGINX_CONF تنظیم نشده}"
: "${DOMAIN:?DOMAIN تنظیم نشده}"
: "${UPSTREAM:?UPSTREAM تنظیم نشده}"          # مثال: 172.17.0.1:8787
: "${NGINX_CONTAINER:=}"                       # خالی = nginx روی خود سیستم
: "${CERT_DIR:=/etc/letsencrypt/live/${DOMAIN}}"

MARKER="# channel-ads-vhost: ${DOMAIN}"
LOG_TAG="channel-ads-vhost"

log() { echo "[$(date '+%F %T')] $*"; logger -t "$LOG_TAG" "$*" 2>/dev/null || true; }

# --- آیا اصلاً کاری لازم است؟ ---
[ -f "$NGINX_CONF" ] || { log "فایل nginx پیدا نشد: $NGINX_CONF"; exit 0; }
if grep -qF "$MARKER" "$NGINX_CONF"; then
  exit 0                       # بلوک سر جایش است
fi

log "بلوک داشبورد در ${NGINX_CONF} نیست — اضافه می‌شود."

# --- ابزار reload / test بسته به اینکه nginx کجاست ---
if [ -n "$NGINX_CONTAINER" ]; then
  nginx_test()   { docker exec "$NGINX_CONTAINER" nginx -t >/dev/null 2>&1; }
  nginx_reload() { docker exec "$NGINX_CONTAINER" nginx -s reload >/dev/null 2>&1; }
  docker inspect "$NGINX_CONTAINER" >/dev/null 2>&1 || {
    log "کانتینر ${NGINX_CONTAINER} در دسترس نیست؛ بعداً دوباره تلاش می‌شود."
    exit 0
  }
else
  nginx_test()   { nginx -t >/dev/null 2>&1; }
  nginx_reload() { systemctl reload nginx >/dev/null 2>&1; }
fi

# --- پشتیبان قبل از دست زدن به فایل کسی دیگر ---
BACKUP="${NGINX_CONF}.channel-ads-bak"
cp "$NGINX_CONF" "$BACKUP" 2>/dev/null || { log "پشتیبان‌گیری ناموفق؛ متوقف شد."; exit 1; }

# --- افزودن بلوک ---
cat >> "$NGINX_CONF" <<BLOCK

${MARKER}
# این بلوک توسط داشبورد کانال‌های تبلیغاتی مدیریت می‌شود و بعد از هر
# بازتولید تنظیمات nginx به‌طور خودکار برگردانده می‌شود.
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name ${DOMAIN};

    ssl_certificate     ${CERT_DIR}/fullchain.pem;
    ssl_certificate_key ${CERT_DIR}/privkey.pem;

    client_max_body_size 16M;

    location / {
        proxy_pass http://${UPSTREAM};
        proxy_http_version 1.1;
        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Host  \$host;
        proxy_read_timeout 60s;
    }
}
BLOCK

# --- اعتبارسنجی؛ در صورت خطا همه‌چیز برمی‌گردد ---
if nginx_test; then
  if nginx_reload; then
    log "بلوک ${DOMAIN} برگردانده شد و nginx بازخوانی شد."
    rm -f "$BACKUP"
    exit 0
  fi
  log "reload ناموفق بود — تنظیمات برگردانده شد."
else
  log "تنظیمات نامعتبر شد — برگردانده شد. (شاید گواهی ${CERT_DIR} موجود نیست)"
fi

cp "$BACKUP" "$NGINX_CONF"
rm -f "$BACKUP"
nginx_reload || true
exit 1
