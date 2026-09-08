#!/usr/bin/env bash
# ============================================================================
#  حذف داشبورد کانال‌های تبلیغاتی
#  اجرا:  sudo bash /opt/channel-ads/uninstall.sh
#
#  به‌طور پیش‌فرض داده‌ها حفظ می‌شوند. برای حذف کامل داده‌ها:
#      sudo PURGE_DATA=1 bash uninstall.sh
# ============================================================================

set -euo pipefail

APP_NAME="channel-ads"
APP_DIR="/opt/${APP_NAME}"
DATA_DIR="${APP_DIR}/data"
SERVICE_FILE="/etc/systemd/system/${APP_NAME}.service"
SERVICE_USER="chads"

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

PURGE_DATA="${PURGE_DATA:-0}"

echo
echo "${BOLD}حذف ${APP_NAME}${RESET}"
if [ "$PURGE_DATA" = "1" ]; then
  echo "  ${RED}${BOLD}هشدار: تمام داده‌ها (گروه‌ها و یوزرنیم‌ها) پاک خواهند شد.${RESET}"
else
  echo "  ${DIM}داده‌ها در ${DATA_DIR} حفظ می‌شوند.${RESET}"
fi

if [ -t 0 ]; then
  read -r -p "  ادامه می‌دهید؟ (yes/no): " CONFIRM </dev/tty
  [ "$CONFIRM" = "yes" ] || { echo "  لغو شد."; exit 0; }
fi

echo

# ۱) توقف سرویس
if systemctl list-unit-files 2>/dev/null | grep -q "^${APP_NAME}.service"; then
  systemctl stop "$APP_NAME" 2>/dev/null || true
  systemctl disable "$APP_NAME" 2>/dev/null || true
  rm -f "$SERVICE_FILE"
  systemctl daemon-reload
  systemctl reset-failed 2>/dev/null || true
  ok "سرویس systemd حذف شد"
else
  warn "سرویس systemd پیدا نشد"
fi

# ۲) تنظیمات nginx (فقط فایل مربوط به همین برنامه)
REMOVED_NGINX=0
for f in "/etc/nginx/sites-enabled/${APP_NAME}" "/etc/nginx/sites-available/${APP_NAME}"; do
  [ -e "$f" ] && { rm -f "$f"; REMOVED_NGINX=1; }
done
if [ "$REMOVED_NGINX" = "1" ]; then
  if nginx -t >/dev/null 2>&1; then
    systemctl reload nginx 2>/dev/null || true
    ok "تنظیمات nginx حذف شد (سایر سایت‌ها دست‌نخورده)"
  else
    warn "تنظیمات nginx حذف شد اما تست nginx ناموفق بود؛ خودتان بررسی کنید."
  fi
fi

# ۳) نگهداری یا حذف داده‌ها
if [ "$PURGE_DATA" = "1" ]; then
  rm -rf "$APP_DIR"
  ok "پوشهٔ برنامه و تمام داده‌ها حذف شد"
else
  if [ -d "$DATA_DIR" ]; then
    KEEP="/root/${APP_NAME}-data-$(date +%Y%m%d-%H%M%S)"
    mv "$DATA_DIR" "$KEEP"
    ok "داده‌ها به ${KEEP} منتقل شدند"
  fi
  rm -rf "$APP_DIR"
  ok "فایل‌های برنامه حذف شدند"
fi

# ۴) کاربر سیستمی
if id "$SERVICE_USER" >/dev/null 2>&1; then
  userdel "$SERVICE_USER" 2>/dev/null && ok "کاربر سیستمی حذف شد" \
    || warn "کاربر ${SERVICE_USER} حذف نشد (احتمالاً پروسه‌ای در حال اجراست)"
fi

echo
echo "${GREEN}${BOLD}✓ حذف انجام شد.${RESET}"
if [ "$PURGE_DATA" != "1" ] && [ -n "${KEEP:-}" ]; then
  echo "  ${DIM}داده‌های شما در ${KEEP} باقی مانده است.${RESET}"
fi
echo "  ${DIM}توجه: Node.js و nginx سیستم دست‌نخورده باقی ماندند.${RESET}"
echo
