#!/usr/bin/env bash
# ============================================================================
#  به‌روزرسانی داشبورد کانال‌های تبلیغاتی
#  اجرا:  sudo bash /opt/channel-ads/update.sh
#
#  کد جدید را از گیت‌هاب می‌گیرد و جایگزین می‌کند.
#  پوشهٔ data/ و فایل app.env هرگز دست نمی‌خورند.
# ============================================================================

set -euo pipefail

APP_NAME="channel-ads"
APP_DIR="/opt/${APP_NAME}"
DATA_DIR="${APP_DIR}/data"
ENV_FILE="${APP_DIR}/app.env"
SERVICE_USER="chads"

if [ -t 1 ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'
  YELLOW=$'\033[33m'; BLUE=$'\033[34m'; RESET=$'\033[0m'
else
  BOLD=""; DIM=""; RED=""; GREEN=""; YELLOW=""; RESET=""; BLUE=""
fi

step() { echo; echo "${BLUE}${BOLD}▸ $*${RESET}"; }
ok()   { echo "  ${GREEN}✓${RESET} $*"; }
warn() { echo "  ${YELLOW}!${RESET} $*"; }
die()  { echo; echo "${RED}${BOLD}✗ خطا:${RESET} $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "این اسکریپت باید با sudo اجرا شود."
[ -d "$APP_DIR" ] || die "نصبی در ${APP_DIR} پیدا نشد."

step "پشتیبان‌گیری قبل از به‌روزرسانی"
STAMP="$(date +%Y%m%d-%H%M%S)"
if [ -f "${DATA_DIR}/db.json" ]; then
  mkdir -p "${DATA_DIR}/backups"
  cp "${DATA_DIR}/db.json" "${DATA_DIR}/backups/pre-update-${STAMP}.json"
  ok "نسخهٔ پشتیبان: ${DATA_DIR}/backups/pre-update-${STAMP}.json"
else
  warn "فایل دیتابیس پیدا نشد (نصب تازه؟)"
fi

# کد قبلی را نگه می‌داریم تا در صورت خطا برگردیم
ROLLBACK_DIR="$(mktemp -d)"
for item in server public package.json; do
  [ -e "${APP_DIR}/${item}" ] && cp -r "${APP_DIR}/${item}" "${ROLLBACK_DIR}/"
done

restore() {
  warn "بازگرداندن نسخهٔ قبلی..."
  for item in server public package.json; do
    if [ -e "${ROLLBACK_DIR}/${item}" ]; then
      rm -rf "${APP_DIR:?}/${item}"
      cp -r "${ROLLBACK_DIR}/${item}" "${APP_DIR}/"
    fi
  done
  chown -R "${SERVICE_USER}:${SERVICE_USER}" "$APP_DIR"
  systemctl restart "$APP_NAME" || true
  rm -rf "$ROLLBACK_DIR"
}

step "دریافت کد جدید"

# منبع: پوشهٔ محلی کنار اسکریپت، یا کلون از گیت‌هاب
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
SOURCE_DIR=""
CLONE_TMP=""

if [ -n "${GITHUB_REPO:-}" ]; then
  command -v git >/dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq git; }
  CLONE_TMP="$(mktemp -d)"
  BRANCH="${GITHUB_BRANCH:-main}"
  if [ -n "${GITHUB_TOKEN:-}" ]; then
    CLONE_URL="https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPO}.git"
  else
    CLONE_URL="https://github.com/${GITHUB_REPO}.git"
  fi
  git clone --depth 1 --branch "$BRANCH" "$CLONE_URL" "$CLONE_TMP" >/dev/null 2>&1 \
    || { rm -rf "$ROLLBACK_DIR" "$CLONE_TMP"; die "کلون مخزن ناموفق بود."; }
  SOURCE_DIR="$CLONE_TMP"
  ok "کد از گیت‌هاب دریافت شد (${GITHUB_REPO})"
elif [ -f "${SCRIPT_DIR}/server/index.js" ] && [ "$SCRIPT_DIR" != "$APP_DIR" ]; then
  SOURCE_DIR="$SCRIPT_DIR"
  ok "کد از ${SCRIPT_DIR} برداشته شد"
else
  rm -rf "$ROLLBACK_DIR"
  die "منبع کد مشخص نیست. یا GITHUB_REPO را تنظیم کنید، یا این اسکریپت را از داخل مخزن کلون‌شده اجرا کنید."
fi

[ -f "${SOURCE_DIR}/server/index.js" ] || { rm -rf "$ROLLBACK_DIR" "$CLONE_TMP"; die "منبع ناقص است."; }

step "جایگزینی فایل‌ها"
systemctl stop "$APP_NAME" 2>/dev/null || true

for item in server public package.json; do
  rm -rf "${APP_DIR:?}/${item}"
  cp -r "${SOURCE_DIR}/${item}" "${APP_DIR}/"
done
for optional in scripts update.sh uninstall.sh README.md install.sh; do
  [ -e "${SOURCE_DIR}/${optional}" ] && cp -r "${SOURCE_DIR}/${optional}" "${APP_DIR}/" || true
done

chown -R "${SERVICE_USER}:${SERVICE_USER}" "$APP_DIR"
chmod 700 "$DATA_DIR"
[ -f "$ENV_FILE" ] && chmod 600 "$ENV_FILE"
ok "فایل‌ها جایگزین شدند (data/ و app.env دست‌نخورده)"

[ -n "$CLONE_TMP" ] && rm -rf "$CLONE_TMP"

step "راه‌اندازی مجدد"
systemctl start "$APP_NAME"

PORT="$(sed -n 's/^PORT=//p' "$ENV_FILE" 2>/dev/null | tail -n 1)"
PORT="${PORT:-8787}"

# آدرس تست سلامت باید همان چیزی باشد که برنامه روی آن گوش می‌دهد،
# نه همیشه 127.0.0.1 (مثلاً وقتی پشت داکر روی 172.17.0.1 اجرا می‌شود)
HEALTH_HOST="$(sed -n 's/^HOST=//p' "$ENV_FILE" 2>/dev/null | tail -n 1)"
HEALTH_HOST="${HEALTH_HOST:-127.0.0.1}"
[ "$HEALTH_HOST" = "0.0.0.0" ] && HEALTH_HOST="127.0.0.1"
[ "$HEALTH_HOST" = "::" ] && HEALTH_HOST="127.0.0.1"
HEALTHY=0
for _ in $(seq 1 20); do
  sleep 0.5
  if curl -fsS --max-time 2 "http://${HEALTH_HOST}:${PORT}/healthz" >/dev/null 2>&1; then
    HEALTHY=1; break
  fi
done

if [ "$HEALTHY" != "1" ]; then
  echo
  echo "${RED}نسخهٔ جدید بالا نیامد. لاگ:${RESET}"
  journalctl -u "$APP_NAME" -n 30 --no-pager || true
  restore
  die "به‌روزرسانی برگردانده شد؛ نسخهٔ قبلی دوباره فعال است."
fi

rm -rf "$ROLLBACK_DIR"
echo
echo "${GREEN}${BOLD}✓ به‌روزرسانی با موفقیت انجام شد.${RESET}"
echo "  ${DIM}sudo journalctl -u ${APP_NAME} -f${RESET}"
echo
