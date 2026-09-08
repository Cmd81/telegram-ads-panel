#!/usr/bin/env bash
# ============================================================================
#  نصب ناظر خودکار بلوک nginx
#
#  یک واحد systemd.path می‌سازد که فایل تنظیمات nginx را زیر نظر می‌گیرد؛
#  به محض تغییر (مثلاً بعد از استقرار پروژهٔ دیگری روی همان سرور)، بلوک
#  داشبورد را دوباره اضافه و nginx را بازخوانی می‌کند.
#
#  نصب:
#      sudo NGINX_CONF=/opt/fragme/docker/nginx.conf \
#           DOMAIN=ads.example.com \
#           UPSTREAM=172.17.0.1:8787 \
#           NGINX_CONTAINER=fragme-nginx \
#           bash ensure-vhost-install.sh
#
#  حذف:
#      sudo bash ensure-vhost-install.sh --uninstall
# ============================================================================

set -euo pipefail

APP_DIR="/opt/channel-ads"
UNIT="channel-ads-vhost"
VHOST_ENV="${APP_DIR}/vhost.env"
SCRIPT="${APP_DIR}/scripts/ensure-vhost.sh"

if [ -t 1 ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'
  YELLOW=$'\033[33m'; RESET=$'\033[0m'
else
  BOLD=""; DIM=""; RED=""; GREEN=""; YELLOW=""; RESET=""
fi
ok()   { echo "  ${GREEN}✓${RESET} $*"; }
warn() { echo "  ${YELLOW}!${RESET} $*"; }
die()  { echo "${RED}✗ $*${RESET}" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "این اسکریپت باید با sudo اجرا شود."

# ---------------------------------------------------------------------------
# حذف
# ---------------------------------------------------------------------------
if [ "${1:-}" = "--uninstall" ]; then
  systemctl disable --now "${UNIT}.path" 2>/dev/null || true
  rm -f "/etc/systemd/system/${UNIT}.path" "/etc/systemd/system/${UNIT}.service"
  systemctl daemon-reload
  ok "ناظر حذف شد. (بلوک فعلی nginx دست‌نخورده ماند)"
  echo "  ${DIM}فایل تنظیمات ${VHOST_ENV} باقی ماند؛ اگر لازم نیست دستی پاکش کنید.${RESET}"
  exit 0
fi

# ---------------------------------------------------------------------------
# نصب
# ---------------------------------------------------------------------------
: "${NGINX_CONF:?متغیر NGINX_CONF لازم است (مسیر فایل تنظیمات nginx)}"
: "${DOMAIN:?متغیر DOMAIN لازم است}"
: "${UPSTREAM:?متغیر UPSTREAM لازم است (مثال: 172.17.0.1:8787)}"
NGINX_CONTAINER="${NGINX_CONTAINER:-}"
CERT_DIR="${CERT_DIR:-/etc/letsencrypt/live/${DOMAIN}}"

[ -f "$NGINX_CONF" ] || die "فایل ${NGINX_CONF} پیدا نشد."
[ -f "$SCRIPT" ] || die "اسکریپت ${SCRIPT} پیدا نشد."

cat > "$VHOST_ENV" <<ENV
# تنظیمات ناظر بلوک nginx داشبورد — ساخته‌شده توسط ensure-vhost-install.sh
NGINX_CONF=${NGINX_CONF}
DOMAIN=${DOMAIN}
UPSTREAM=${UPSTREAM}
NGINX_CONTAINER=${NGINX_CONTAINER}
CERT_DIR=${CERT_DIR}
ENV
chmod 600 "$VHOST_ENV"
chmod +x "$SCRIPT"
ok "تنظیمات در ${VHOST_ENV} ذخیره شد"

cat > "/etc/systemd/system/${UNIT}.service" <<UNITFILE
[Unit]
Description=برگرداندن بلوک nginx داشبورد کانال‌های تبلیغاتی
After=docker.service

[Service]
Type=oneshot
# کمی صبر تا استقرارِ در جریان کارش تمام شود و فایل نهایی بنشیند
ExecStartPre=/bin/sleep 5
ExecStart=/bin/bash ${SCRIPT}
StandardOutput=journal
StandardError=journal
UNITFILE

cat > "/etc/systemd/system/${UNIT}.path" <<PATHFILE
[Unit]
Description=زیر نظر گرفتن تنظیمات nginx برای بلوک داشبورد

[Path]
PathModified=${NGINX_CONF}
Unit=${UNIT}.service

[Install]
WantedBy=multi-user.target
PATHFILE

systemctl daemon-reload
systemctl enable --now "${UNIT}.path" >/dev/null 2>&1
ok "ناظر systemd فعال شد"

# یک بار همین حالا اجرا کن تا وضعیت فعلی درست شود
bash "$SCRIPT" || warn "اجرای اولیه موفق نبود؛ لاگ را ببینید."

echo
echo "${GREEN}${BOLD}✓ ناظر نصب شد.${RESET}"
echo "  ${DIM}زیر نظر : ${NGINX_CONF}${RESET}"
echo "  ${DIM}دامنه   : ${DOMAIN} → ${UPSTREAM}${RESET}"
echo
echo "  وضعیت    ${DIM}systemctl status ${UNIT}.path${RESET}"
echo "  لاگ      ${DIM}journalctl -u ${UNIT}.service -n 20${RESET}"
echo "  اجرا دستی ${DIM}sudo bash ${SCRIPT}${RESET}"
echo "  حذف      ${DIM}sudo bash ${APP_DIR}/scripts/ensure-vhost-install.sh --uninstall${RESET}"
echo
