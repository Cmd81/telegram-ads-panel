#!/usr/bin/env bash
# ============================================================================
#  نصب‌کنندهٔ داشبورد کانال‌های تبلیغاتی روی اوبونتو
#
#  اجرا از روی مخزن کلون‌شده:
#      sudo bash install.sh
#
#  اجرا به صورت مستقیم (مخزن خصوصی):
#      curl -fsSL -H "Authorization: token GH_TOKEN" \
#        https://raw.githubusercontent.com/OWNER/REPO/main/install.sh \
#        | sudo GITHUB_TOKEN=GH_TOKEN GITHUB_REPO=OWNER/REPO bash
#
#  حالت غیرتعاملی:
#      sudo DOMAIN=ads.example.com EMAIL=me@example.com \
#           ADMIN_USER=admin ADMIN_PASSWORD='...' NON_INTERACTIVE=1 bash install.sh
# ============================================================================

set -euo pipefail

APP_NAME="channel-ads"
APP_DIR="/opt/${APP_NAME}"
DATA_DIR="${APP_DIR}/data"
RUNTIME_DIR="${APP_DIR}/runtime"
SERVICE_USER="chads"
SERVICE_FILE="/etc/systemd/system/${APP_NAME}.service"
ENV_FILE="${APP_DIR}/app.env"
NODE_VERSION="20.18.1"
MIN_NODE_MAJOR=18

# ---------------------------------------------------------------------------
# ظاهر خروجی
# ---------------------------------------------------------------------------
if [ -t 1 ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'
  YELLOW=$'\033[33m'; BLUE=$'\033[34m'; RESET=$'\033[0m'
else
  BOLD=""; DIM=""; RED=""; GREEN=""; YELLOW=""; BLUE=""; RESET=""
fi

step()  { echo; echo "${BLUE}${BOLD}▸ $*${RESET}"; }
ok()    { echo "  ${GREEN}✓${RESET} $*"; }
warn()  { echo "  ${YELLOW}!${RESET} $*"; }
info()  { echo "  ${DIM}$*${RESET}"; }
die()   { echo; echo "${RED}${BOLD}✗ خطا:${RESET} $*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# بررسی‌های اولیه
# ---------------------------------------------------------------------------

[ "$(id -u)" -eq 0 ] || die "این اسکریپت باید با sudo یا کاربر root اجرا شود."

if ! grep -qiE 'ubuntu|debian' /etc/os-release 2>/dev/null; then
  warn "این اسکریپت برای اوبونتو/دبیان نوشته شده است. ادامه با احتیاط."
fi

command -v systemctl >/dev/null 2>&1 || die "systemd روی این سیستم پیدا نشد."

NON_INTERACTIVE="${NON_INTERACTIVE:-0}"
if [ ! -t 0 ] && [ "$NON_INTERACTIVE" != "1" ]; then
  # ورودی از لوله می‌آید (curl | bash) ولی هنوز می‌توانیم از ترمینال بخوانیم
  if [ -r /dev/tty ]; then exec 0</dev/tty; else NON_INTERACTIVE=1; fi
fi

ask() { # ask <متغیر> <پرسش> <پیش‌فرض>
  local __var="$1" __prompt="$2" __default="${3:-}" __answer=""
  local __current="${!__var:-}"
  if [ -n "$__current" ]; then echo "$__current"; return; fi
  if [ "$NON_INTERACTIVE" = "1" ]; then echo "$__default"; return; fi
  if [ -n "$__default" ]; then
    read -r -p "  $__prompt [$__default]: " __answer </dev/tty
  else
    read -r -p "  $__prompt: " __answer </dev/tty
  fi
  echo "${__answer:-$__default}"
}

ask_secret() {
  local __prompt="$1" __answer=""
  read -r -s -p "  $__prompt: " __answer </dev/tty
  echo >&2
  echo "$__answer"
}

echo
echo "${BOLD}════════════════════════════════════════════════════════════${RESET}"
echo "${BOLD}   نصب داشبورد کانال‌های تبلیغاتی${RESET}"
echo "${BOLD}════════════════════════════════════════════════════════════${RESET}"

# ---------------------------------------------------------------------------
# ۱) دریافت اطلاعات
# ---------------------------------------------------------------------------
step "پیکربندی"

DOMAIN="$(ask DOMAIN 'دامنه (مثال: ads.example.com) — خالی = فقط روی IP و پورت' '')"
DOMAIN="$(echo "$DOMAIN" | tr -d '[:space:]' | tr 'A-Z' 'a-z' | sed -E 's#^https?://##; s#/.*$##')"

USE_TLS=0
if [ -n "$DOMAIN" ]; then
  if ! echo "$DOMAIN" | grep -qE '^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$'; then
    die "دامنهٔ «$DOMAIN» معتبر به نظر نمی‌رسد."
  fi
  EMAIL="$(ask EMAIL 'ایمیل برای گواهی SSL رایگان (خالی = بدون SSL)' '')"
  [ -n "$EMAIL" ] && USE_TLS=1
  ok "دامنه: ${DOMAIN}$([ $USE_TLS -eq 1 ] && echo ' (با SSL)' || echo ' (بدون SSL)')"
else
  info "بدون دامنه نصب می‌شود؛ از طریق http://IP:PORT در دسترس خواهد بود."
fi

PORT="$(ask PORT 'پورت داخلی برنامه' '8787')"
echo "$PORT" | grep -qE '^[0-9]+$' || die "پورت باید عدد باشد."

if [ -n "$DOMAIN" ]; then BIND_HOST="127.0.0.1"; else BIND_HOST="0.0.0.0"; fi

ADMIN_USER="$(ask ADMIN_USER 'نام کاربری مدیر' 'admin')"

if [ -z "${ADMIN_PASSWORD:-}" ] && [ "$NON_INTERACTIVE" != "1" ]; then
  while true; do
    ADMIN_PASSWORD="$(ask_secret 'رمز عبور مدیر (حداقل ۸ کاراکتر، خالی = ساخت خودکار)')"
    [ -z "$ADMIN_PASSWORD" ] && break
    if [ "${#ADMIN_PASSWORD}" -lt 8 ]; then
      warn "رمز باید حداقل ۸ کاراکتر باشد."
      continue
    fi
    CONFIRM="$(ask_secret 'تکرار رمز عبور')"
    [ "$ADMIN_PASSWORD" = "$CONFIRM" ] && break
    warn "رمزها یکسان نیستند؛ دوباره تلاش کنید."
  done
fi

# ---------------------------------------------------------------------------
# ۲) بررسی تداخل با سرویس‌های موجود
# ---------------------------------------------------------------------------
step "بررسی وضعیت سرور"

if ss -ltn 2>/dev/null | grep -qE "[:.]${PORT}\b"; then
  die "پورت ${PORT} در حال استفاده است. با متغیر PORT پورت دیگری انتخاب کنید."
fi
ok "پورت ${PORT} آزاد است"

WEB_SERVER="none"
if [ -n "$DOMAIN" ]; then
  if command -v nginx >/dev/null 2>&1; then
    WEB_SERVER="nginx"
    ok "nginx از قبل نصب است — فقط یک فایل تنظیمات جدید اضافه می‌شود"
  elif command -v caddy >/dev/null 2>&1; then
    WEB_SERVER="caddy"
    warn "Caddy نصب است. تنظیمات آماده در پایان چاپ می‌شود تا خودتان اضافه کنید."
  elif command -v apache2 >/dev/null 2>&1; then
    WEB_SERVER="apache"
    warn "Apache نصب است. تنظیمات آماده در پایان چاپ می‌شود تا خودتان اضافه کنید."
  else
    WEB_SERVER="nginx-install"
    info "هیچ وب‌سروری نصب نیست؛ nginx نصب خواهد شد."
  fi
fi

# ---------------------------------------------------------------------------
# ۳) آماده‌سازی Node.js
# ---------------------------------------------------------------------------
step "آماده‌سازی Node.js"

NODE_BIN=""
if command -v node >/dev/null 2>&1; then
  CURRENT_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "$CURRENT_MAJOR" -ge "$MIN_NODE_MAJOR" ] 2>/dev/null; then
    NODE_BIN="$(command -v node)"
    ok "از Node.js موجود سیستم استفاده می‌شود ($(node -v))"
  else
    info "Node.js نسخهٔ $(node -v) قدیمی است؛ نسخهٔ اختصاصی دانلود می‌شود."
  fi
fi

if [ -z "$NODE_BIN" ]; then
  # نصب ایزوله: باینری داخل پوشهٔ برنامه، بدون دست زدن به بسته‌های سیستم
  ARCH="$(uname -m)"
  case "$ARCH" in
    x86_64|amd64) NODE_ARCH="x64" ;;
    aarch64|arm64) NODE_ARCH="arm64" ;;
    *) die "معماری «$ARCH» پشتیبانی نمی‌شود. لطفاً Node.js ${MIN_NODE_MAJOR}+ را دستی نصب کنید." ;;
  esac

  TARBALL="node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz"
  URL="https://nodejs.org/dist/v${NODE_VERSION}/${TARBALL}"
  info "دانلود Node.js v${NODE_VERSION} (${NODE_ARCH})..."

  command -v curl >/dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq curl; }
  command -v xz >/dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq xz-utils; }

  TMP_NODE="$(mktemp -d)"
  curl -fsSL --retry 3 -o "${TMP_NODE}/${TARBALL}" "$URL" \
    || die "دانلود Node.js ناموفق بود. اتصال اینترنت سرور را بررسی کنید."

  mkdir -p "$RUNTIME_DIR"
  tar -xJf "${TMP_NODE}/${TARBALL}" -C "$RUNTIME_DIR" --strip-components=1
  rm -rf "$TMP_NODE"
  NODE_BIN="${RUNTIME_DIR}/bin/node"
  "$NODE_BIN" -v >/dev/null || die "باینری Node.js کار نمی‌کند."
  ok "Node.js اختصاصی نصب شد ($("$NODE_BIN" -v)) — بسته‌های سیستم دست‌نخورده ماند"
fi

# ---------------------------------------------------------------------------
# ۴) دریافت کد برنامه
# ---------------------------------------------------------------------------
step "نصب فایل‌های برنامه"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || echo '')"
SOURCE_DIR=""

if [ -n "$SCRIPT_DIR" ] && [ -f "${SCRIPT_DIR}/server/index.js" ]; then
  SOURCE_DIR="$SCRIPT_DIR"
  info "کد از پوشهٔ محلی برداشته می‌شود: $SOURCE_DIR"
else
  # اجرای مستقیم از طریق curl → کلون از گیت‌هاب
  [ -n "${GITHUB_REPO:-}" ] || die "متغیر GITHUB_REPO تنظیم نشده است (مثال: OWNER/REPO)."
  command -v git >/dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq git; }

  CLONE_TMP="$(mktemp -d)"
  BRANCH="${GITHUB_BRANCH:-main}"
  if [ -n "${GITHUB_TOKEN:-}" ]; then
    CLONE_URL="https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPO}.git"
  else
    CLONE_URL="https://github.com/${GITHUB_REPO}.git"
  fi

  info "دریافت کد از گیت‌هاب (${GITHUB_REPO}، شاخهٔ ${BRANCH})..."
  git clone --depth 1 --branch "$BRANCH" "$CLONE_URL" "$CLONE_TMP" >/dev/null 2>&1 \
    || die "کلون مخزن ناموفق بود. مقدار GITHUB_REPO و GITHUB_TOKEN را بررسی کنید."
  SOURCE_DIR="$CLONE_TMP"
  ok "کد دریافت شد"
fi

[ -f "${SOURCE_DIR}/server/index.js" ] || die "فایل server/index.js در منبع پیدا نشد."

# کاربر سرویس
if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
  ok "کاربر سیستمی «${SERVICE_USER}» ساخته شد"
else
  ok "کاربر سیستمی «${SERVICE_USER}» از قبل وجود دارد"
fi

# بکاپ خودکار قبل از به‌روزرسانی
IS_UPDATE=0
if [ -f "${DATA_DIR}/db.json" ]; then
  IS_UPDATE=1
  BACKUP_PATH="${DATA_DIR}/backups/pre-install-$(date +%Y%m%d-%H%M%S).json"
  mkdir -p "${DATA_DIR}/backups"
  cp "${DATA_DIR}/db.json" "$BACKUP_PATH"
  ok "نصب قبلی پیدا شد — نسخهٔ پشتیبان: ${BACKUP_PATH}"
  systemctl stop "$APP_NAME" 2>/dev/null || true
fi

mkdir -p "$APP_DIR" "$DATA_DIR"

# فقط کد برنامه کپی می‌شود؛ پوشهٔ data هرگز دست نمی‌خورد
for item in server public package.json; do
  [ -e "${SOURCE_DIR}/${item}" ] || die "«${item}» در منبع پیدا نشد."
  rm -rf "${APP_DIR:?}/${item}"
  cp -r "${SOURCE_DIR}/${item}" "${APP_DIR}/"
done
for optional in scripts update.sh uninstall.sh README.md; do
  [ -e "${SOURCE_DIR}/${optional}" ] && cp -r "${SOURCE_DIR}/${optional}" "${APP_DIR}/" || true
done
ok "فایل‌های برنامه در ${APP_DIR} قرار گرفتند"

[ -n "${CLONE_TMP:-}" ] && rm -rf "$CLONE_TMP"

# ---------------------------------------------------------------------------
# ۵) فایل تنظیمات محیطی
# ---------------------------------------------------------------------------
step "تنظیمات محیطی"

if [ "$IS_UPDATE" = "1" ] && [ -f "$ENV_FILE" ]; then
  ok "فایل تنظیمات موجود حفظ شد (${ENV_FILE})"
else
  {
    echo "# تنظیمات داشبورد کانال‌های تبلیغاتی"
    echo "PORT=${PORT}"
    echo "HOST=${BIND_HOST}"
    echo "DATA_DIR=${DATA_DIR}"
    echo "NODE_ENV=production"
    echo "TRUST_PROXY=$([ -n "$DOMAIN" ] && echo 1 || echo 0)"
    echo "SECURE_COOKIE=${USE_TLS}"
    echo "SESSION_DAYS=30"
    [ -n "$ADMIN_USER" ] && echo "ADMIN_USER=${ADMIN_USER}"
    [ -n "${ADMIN_PASSWORD:-}" ] && echo "ADMIN_PASSWORD=${ADMIN_PASSWORD}"
  } > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  ok "فایل ${ENV_FILE} ساخته شد"
fi

chown -R "${SERVICE_USER}:${SERVICE_USER}" "$APP_DIR"
chmod 700 "$DATA_DIR"

# ---------------------------------------------------------------------------
# ۶) سرویس systemd
# ---------------------------------------------------------------------------
step "ساخت سرویس systemd"

cat > "$SERVICE_FILE" <<UNIT
[Unit]
Description=داشبورد کانال‌های تبلیغاتی (${APP_NAME})
Documentation=https://github.com/${GITHUB_REPO:-OWNER/REPO}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${ENV_FILE}
ExecStart=${NODE_BIN} ${APP_DIR}/server/index.js
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${APP_NAME}

# محدودسازی دسترسی سرویس به سیستم
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
ProtectClock=true
RestrictSUIDSGID=true
RestrictNamespaces=true
RestrictRealtime=true
LockPersonality=true
MemoryDenyWriteExecute=false
ReadWritePaths=${DATA_DIR}
CapabilityBoundingSet=
AmbientCapabilities=
SystemCallFilter=@system-service
SystemCallErrorNumber=EPERM

# سقف منابع
MemoryMax=512M
TasksMax=64

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable "$APP_NAME" >/dev/null 2>&1
systemctl restart "$APP_NAME"
ok "سرویس ${APP_NAME} فعال و اجرا شد"

# انتظار برای بالا آمدن
info "بررسی سلامت سرویس..."
HEALTHY=0
for _ in $(seq 1 20); do
  sleep 0.5
  if curl -fsS --max-time 2 "http://127.0.0.1:${PORT}/healthz" >/dev/null 2>&1; then
    HEALTHY=1; break
  fi
done

if [ "$HEALTHY" != "1" ]; then
  echo
  echo "${RED}سرویس بالا نیامد. آخرین لاگ‌ها:${RESET}"
  journalctl -u "$APP_NAME" -n 30 --no-pager || true
  die "نصب ناتمام ماند."
fi
ok "برنامه سالم پاسخ می‌دهد"

# رمز تولیدشدهٔ خودکار را از لاگ برداریم
GENERATED_PASSWORD=""
if [ -z "${ADMIN_PASSWORD:-}" ]; then
  # sed به جای grep -P: روی سرورهایی که locale آن‌ها UTF-8 نیست هم کار می‌کند
  GENERATED_PASSWORD="$(journalctl -u "$APP_NAME" --since '2 min ago' --no-pager 2>/dev/null \
    | sed -n 's/.*رمز عبور[[:space:]]*:[[:space:]]*\([^[:space:]][^[:space:]]*\).*/\1/p' \
    | tail -n 1 || true)"
fi

# حساب مدیر ساخته شد؛ دیگر نیازی نیست رمز به صورت متن ساده روی دیسک بماند
if grep -q '^ADMIN_PASSWORD=' "$ENV_FILE" 2>/dev/null; then
  sed -i '/^ADMIN_PASSWORD=/d' "$ENV_FILE"
  ok "رمز مدیر از فایل تنظیمات پاک شد (حساب از این پس با هش ذخیره می‌شود)"
fi

# ---------------------------------------------------------------------------
# ۷) وب‌سرور و دامنه
# ---------------------------------------------------------------------------
NGINX_CONF=""
if [ -n "$DOMAIN" ]; then
  step "پیکربندی دامنه"

  if [ "$WEB_SERVER" = "nginx-install" ]; then
    info "نصب nginx..."
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq nginx
    WEB_SERVER="nginx"
    ok "nginx نصب شد"
  fi

  if [ "$WEB_SERVER" = "nginx" ]; then
    NGINX_CONF="/etc/nginx/sites-available/${APP_NAME}"
    cat > "$NGINX_CONF" <<NGINX
# داشبورد کانال‌های تبلیغاتی — ${DOMAIN}
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    client_max_body_size 4M;
    access_log /var/log/nginx/${APP_NAME}.access.log;
    error_log  /var/log/nginx/${APP_NAME}.error.log;

    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Host  \$host;
        proxy_read_timeout 60s;
    }
}
NGINX

    mkdir -p /etc/nginx/sites-enabled
    ln -sf "$NGINX_CONF" "/etc/nginx/sites-enabled/${APP_NAME}"

    if nginx -t >/dev/null 2>&1; then
      systemctl reload nginx 2>/dev/null || systemctl restart nginx
      ok "nginx برای ${DOMAIN} تنظیم شد (سایر سایت‌ها دست‌نخورده)"
    else
      rm -f "/etc/nginx/sites-enabled/${APP_NAME}"
      nginx -t || true
      die "تنظیمات nginx معتبر نبود؛ تغییرات برگردانده شد."
    fi

    # گواهی SSL
    if [ "$USE_TLS" = "1" ]; then
      if ! command -v certbot >/dev/null 2>&1; then
        info "نصب certbot..."
        export DEBIAN_FRONTEND=noninteractive
        apt-get install -y -qq certbot python3-certbot-nginx || warn "نصب certbot ناموفق بود."
      fi
      if command -v certbot >/dev/null 2>&1; then
        info "دریافت گواهی SSL برای ${DOMAIN}..."
        if certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos \
             -m "$EMAIL" --redirect >/dev/null 2>&1; then
          ok "گواهی SSL نصب و تمدید خودکار فعال شد"
        else
          USE_TLS=0
          warn "دریافت گواهی ناموفق بود (معمولاً یعنی رکورد DNS دامنه هنوز به این سرور اشاره نمی‌کند)."
          warn "بعد از تنظیم DNS اجرا کنید:  sudo certbot --nginx -d ${DOMAIN}"
        fi
      fi
    fi
  fi

  # فایروال
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q '^Status: active'; then
    ufw allow 'Nginx Full' >/dev/null 2>&1 || ufw allow 80/tcp >/dev/null 2>&1 || true
    ok "قوانین فایروال برای وب اضافه شد"
  fi
else
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q '^Status: active'; then
    ufw allow "${PORT}/tcp" >/dev/null 2>&1 || true
    ok "پورت ${PORT} در فایروال باز شد"
  fi
fi

# ---------------------------------------------------------------------------
# ۸) جمع‌بندی
# ---------------------------------------------------------------------------
if [ -n "$DOMAIN" ]; then
  if [ "$USE_TLS" = "1" ]; then APP_URL="https://${DOMAIN}"; else APP_URL="http://${DOMAIN}"; fi
else
  SERVER_IP="$(curl -fsS --max-time 3 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
  APP_URL="http://${SERVER_IP}:${PORT}"
fi

echo
echo "${GREEN}${BOLD}════════════════════════════════════════════════════════════${RESET}"
echo "${GREEN}${BOLD}   ✓ نصب با موفقیت انجام شد${RESET}"
echo "${GREEN}${BOLD}════════════════════════════════════════════════════════════${RESET}"
echo
echo "  ${BOLD}آدرس داشبورد${RESET} : ${APP_URL}"
echo "  ${BOLD}نام کاربری${RESET}   : ${ADMIN_USER}"
if [ -n "${ADMIN_PASSWORD:-}" ]; then
  echo "  ${BOLD}رمز عبور${RESET}     : (همان که وارد کردید)"
elif [ -n "$GENERATED_PASSWORD" ]; then
  echo "  ${BOLD}رمز عبور${RESET}     : ${YELLOW}${GENERATED_PASSWORD}${RESET}"
  echo "  ${DIM}این رمز فقط همین یک‌بار نمایش داده می‌شود — همین حالا ذخیره‌اش کنید.${RESET}"
else
  echo "  ${BOLD}رمز عبور${RESET}     : در لاگ سرویس ببینید:"
  echo "                 ${DIM}sudo journalctl -u ${APP_NAME} | grep 'رمز عبور'${RESET}"
fi
echo
echo "  ${BOLD}مسیر داده‌ها${RESET} : ${DATA_DIR}/db.json"
echo "  ${BOLD}تنظیمات${RESET}      : ${ENV_FILE}"
echo
echo "  ${BOLD}دستورهای کاربردی:${RESET}"
echo "    وضعیت      ${DIM}sudo systemctl status ${APP_NAME}${RESET}"
echo "    لاگ زنده   ${DIM}sudo journalctl -u ${APP_NAME} -f${RESET}"
echo "    ری‌استارت  ${DIM}sudo systemctl restart ${APP_NAME}${RESET}"
echo "    به‌روزرسانی ${DIM}sudo bash ${APP_DIR}/update.sh${RESET}"
echo "    حذف کامل   ${DIM}sudo bash ${APP_DIR}/uninstall.sh${RESET}"

if [ -n "$DOMAIN" ] && [ "$USE_TLS" != "1" ]; then
  echo
  echo "  ${YELLOW}${BOLD}توجه:${RESET} سایت روی HTTP سرو می‌شود."
  echo "  ${DIM}مطمئن شوید رکورد A دامنهٔ ${DOMAIN} به IP این سرور اشاره می‌کند، سپس:${RESET}"
  echo "  ${DIM}sudo certbot --nginx -d ${DOMAIN}${RESET}"
fi

if [ "$WEB_SERVER" = "caddy" ]; then
  echo
  echo "  ${YELLOW}${BOLD}Caddy:${RESET} این بلوک را به Caddyfile اضافه و سرویس را reload کنید:"
  echo "${DIM}"
  echo "    ${DOMAIN} {"
  echo "        reverse_proxy 127.0.0.1:${PORT}"
  echo "    }"
  echo "${RESET}"
fi

if [ "$WEB_SERVER" = "apache" ]; then
  echo
  echo "  ${YELLOW}${BOLD}Apache:${RESET} یک VirtualHost با محتوای زیر بسازید:"
  echo "${DIM}"
  echo "    <VirtualHost *:80>"
  echo "        ServerName ${DOMAIN}"
  echo "        ProxyPreserveHost On"
  echo "        ProxyPass        / http://127.0.0.1:${PORT}/"
  echo "        ProxyPassReverse / http://127.0.0.1:${PORT}/"
  echo "        RequestHeader set X-Forwarded-Proto \"http\""
  echo "    </VirtualHost>"
  echo "${RESET}"
  echo "  ${DIM}سپس: sudo a2enmod proxy proxy_http headers && sudo systemctl reload apache2${RESET}"
fi

echo
