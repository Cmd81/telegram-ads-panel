#!/usr/bin/env bash
# ============================================================================
#  تست خشک (dry-run) اسکریپت نصب
#
#  دستورهای سیستمی (systemctl، apt-get، nginx، certbot و ...) با نسخهٔ جعلی
#  جایگزین می‌شوند تا منطق اسکریپت بدون تغییر واقعی سیستم بررسی شود.
#
#  اجرا:  bash scripts/test-install.sh
# ============================================================================

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SANDBOX="$(mktemp -d)"
STUB_BIN="${SANDBOX}/bin"
FAKE_ROOT="${SANDBOX}/root"
LOG="${SANDBOX}/calls.log"

mkdir -p "$STUB_BIN" "${FAKE_ROOT}/etc/systemd/system" \
         "${FAKE_ROOT}/etc/nginx/sites-available" "${FAKE_ROOT}/etc/nginx/sites-enabled" \
         "${FAKE_ROOT}/opt"

pass=0; fail=0
check() {
  if [ "$2" = "0" ] || [ "$2" = "true" ]; then pass=$((pass+1)); echo "  ✅ $1"
  else fail=$((fail+1)); echo "  ❌ $1${3:+ → $3}"; fi
}
has() { grep -qF "$2" "$1" 2>/dev/null && echo true || echo false; }

# ---------------------------------------------------------------------------
# ساخت دستورهای جعلی
# ---------------------------------------------------------------------------
stub() {
  local name="$1"; shift
  cat > "${STUB_BIN}/${name}" <<STUB
#!/usr/bin/env bash
echo "${name} \$*" >> "${LOG}"
$*
STUB
  chmod +x "${STUB_BIN}/${name}"
}

stub id          'if [ "$1" = "-u" ]; then echo 0; else echo "uid=0(root)"; fi'
stub systemctl   'case "$1" in list-unit-files) echo "";; status) exit 3;; esac; exit 0'
stub useradd     'exit 0'
stub userdel     'exit 0'
stub chown       'exit 0'
stub apt-get     'exit 0'
stub ss          'echo "LISTEN 0 511 *:22 *:*"'
stub journalctl  'echo "  رمز عبور   : GeneratedPass123"'
stub ufw         'echo "Status: inactive"'
stub nginx       'exit 0'
stub certbot     'exit 0'

# node: هم -v و هم -p را مثل نود واقعی پاسخ می‌دهد
cat > "${STUB_BIN}/node" <<'STUB'
#!/usr/bin/env bash
case "${1:-}" in
  -v|--version) echo "v20.18.1" ;;
  -p|-e)        echo "20" ;;          # process.versions.node.split(".")[0]
  *)            exit 0 ;;
esac
STUB
chmod +x "${STUB_BIN}/node"

# curl: healthz باید موفق باشد، بقیه شکست بخورند
cat > "${STUB_BIN}/curl" <<'STUB'
#!/usr/bin/env bash
for a in "$@"; do
  case "$a" in
    *healthz) exit 0 ;;
    *ipify*)  echo "203.0.113.45"; exit 0 ;;
  esac
done
exit 1
STUB
chmod +x "${STUB_BIN}/curl"

# ---------------------------------------------------------------------------
# نسخهٔ آزمایشی اسکریپت با مسیرهای داخل جعبهٔ شنی
# ---------------------------------------------------------------------------
# اسکریپت آزمایشی باید داخل ریشهٔ مخزن باشد تا کد منبع را کنار خودش پیدا کند
TEST_SCRIPT="${REPO_ROOT}/.install-dryrun.tmp.sh"
trap 'rm -f "$TEST_SCRIPT"' EXIT
sed -e "s#^APP_DIR=\"/opt/#APP_DIR=\"${FAKE_ROOT}/opt/#" \
    -e "s#^SERVICE_FILE=\"/etc/systemd#SERVICE_FILE=\"${FAKE_ROOT}/etc/systemd#" \
    -e "s#/etc/nginx/sites-available#${FAKE_ROOT}/etc/nginx/sites-available#g" \
    -e "s#/etc/nginx/sites-enabled#${FAKE_ROOT}/etc/nginx/sites-enabled#g" \
    -e "s#/etc/os-release#${SANDBOX}/os-release#g" \
    "${REPO_ROOT}/install.sh" > "$TEST_SCRIPT"

echo 'ID=ubuntu'          >  "${SANDBOX}/os-release"
echo 'VERSION_ID="24.04"' >> "${SANDBOX}/os-release"

run_install() {
  # از env استفاده می‌کنیم چون انتساب متغیر از طریق "$@" در زمان تجزیه اعمال نمی‌شود
  ( cd "$REPO_ROOT" && env PATH="${STUB_BIN}:${PATH}" NON_INTERACTIVE=1 "$@" \
    bash "$TEST_SCRIPT" ) > "${SANDBOX}/out.txt" 2>&1
  echo $?
}

APP="${FAKE_ROOT}/opt/channel-ads"

# ===========================================================================
echo
echo "════ سناریو ۱: نصب با دامنه و SSL ════"
: > "$LOG"
rc=$(run_install DOMAIN=ads.example.com EMAIL=me@example.com \
                 ADMIN_USER=boss ADMIN_PASSWORD='SuperSecret!2024' PORT=8787)

check "اسکریپت بدون خطا تمام شد" "$rc" "$(tail -5 "${SANDBOX}/out.txt")"
check "فایل‌های برنامه کپی شدند" "$([ -f "${APP}/server/index.js" ] && echo 0 || echo 1)"
check "رابط کاربری کپی شد" "$([ -f "${APP}/public/app.js" ] && echo 0 || echo 1)"
check "پوشهٔ data ساخته شد" "$([ -d "${APP}/data" ] && echo 0 || echo 1)"
check "پوشهٔ data خالی و بدون کد است" "$([ ! -e "${APP}/data/server" ] && echo 0 || echo 1)"

ENVF="${APP}/app.env"
check "فایل app.env ساخته شد" "$([ -f "$ENVF" ] && echo 0 || echo 1)"
check "پورت درست ثبت شد" "$(has "$ENVF" 'PORT=8787')"
check "با دامنه فقط روی لوکال گوش می‌دهد" "$(has "$ENVF" 'HOST=127.0.0.1')"
check "TRUST_PROXY فعال است" "$(has "$ENVF" 'TRUST_PROXY=1')"
check "کوکی امن فعال است" "$(has "$ENVF" 'SECURE_COOKIE=1')"
check "رمز مدیر پس از نصب پاک شد" "$([ "$(has "$ENVF" 'ADMIN_PASSWORD')" = false ] && echo 0 || echo 1)"

UNIT="${FAKE_ROOT}/etc/systemd/system/channel-ads.service"
check "یونیت systemd ساخته شد" "$([ -f "$UNIT" ] && echo 0 || echo 1)"
check "با کاربر غیر روت اجرا می‌شود" "$(has "$UNIT" 'User=chads')"
check "ری‌استارت خودکار فعال است" "$(has "$UNIT" 'Restart=always')"
check "دسترسی نوشتن فقط به data" "$(has "$UNIT" "ReadWritePaths=${APP}/data")"
check "سخت‌سازی امنیتی اعمال شد" "$(has "$UNIT" 'ProtectSystem=strict')"
check "بدون افزایش سطح دسترسی" "$(has "$UNIT" 'NoNewPrivileges=true')"

NGX="${FAKE_ROOT}/etc/nginx/sites-available/channel-ads"
check "تنظیمات nginx ساخته شد" "$([ -f "$NGX" ] && echo 0 || echo 1)"
check "دامنه در تنظیمات nginx هست" "$(has "$NGX" 'server_name ads.example.com;')"
check "پروکسی به پورت درست" "$(has "$NGX" 'proxy_pass http://127.0.0.1:8787;')"
check "هدر X-Forwarded-Proto ارسال می‌شود" "$(has "$NGX" 'X-Forwarded-Proto $scheme')"
check "متغیرهای nginx فرار داده شده‌اند (\$host نه مقدار خالی)" "$(has "$NGX" 'Host              $host')"
check "لینک sites-enabled ساخته شد" "$([ -e "${FAKE_ROOT}/etc/nginx/sites-enabled/channel-ads" ] && echo 0 || echo 1)"
check "certbot صدا زده شد" "$(has "$LOG" 'certbot --nginx -d ads.example.com')"
check "nginx تست و ریلود شد" "$(has "$LOG" 'systemctl reload nginx')"
check "سرویس enable شد" "$(has "$LOG" 'systemctl enable channel-ads')"
check "آدرس https اعلام شد" "$(has "${SANDBOX}/out.txt" 'https://ads.example.com')"

# ===========================================================================
echo
echo "════ سناریو ۲: نصب بدون دامنه (فقط IP) ════"
rm -rf "${FAKE_ROOT}/opt/channel-ads" "$UNIT" "$NGX" "${FAKE_ROOT}/etc/nginx/sites-enabled/channel-ads"
: > "$LOG"
rc=$(run_install ADMIN_USER=admin PORT=9000)

check "نصب بدون دامنه موفق بود" "$rc" "$(tail -5 "${SANDBOX}/out.txt")"
check "روی همهٔ اینترفیس‌ها گوش می‌دهد" "$(has "$ENVF" 'HOST=0.0.0.0')"
check "کوکی امن غیرفعال است (بدون SSL)" "$(has "$ENVF" 'SECURE_COOKIE=0')"
check "TRUST_PROXY خاموش است" "$(has "$ENVF" 'TRUST_PROXY=0')"
check "nginx دست نخورد" "$([ ! -f "$NGX" ] && echo 0 || echo 1)"
check "آدرس IP:PORT اعلام شد" "$(has "${SANDBOX}/out.txt" '203.0.113.45:9000')"
check "رمز خودکار از لاگ استخراج شد" "$(has "${SANDBOX}/out.txt" 'GeneratedPass123')"

# ===========================================================================
echo
echo "════ سناریو ۳: نصب مجدد روی نصب موجود (به‌روزرسانی) ════"
echo '{"version":1,"groups":[{"id":"g_keep","title":"دادهٔ مهم"}],"entries":[],"users":[],"logs":[],"settings":{}}' \
  > "${APP}/data/db.json"
echo "MARKER=custom" >> "$ENVF"
: > "$LOG"
rc=$(run_install DOMAIN=ads2.example.com ADMIN_USER=admin PORT=9000)

check "نصب مجدد موفق بود" "$rc" "$(tail -5 "${SANDBOX}/out.txt")"
check "دادهٔ قبلی حفظ شد" "$(has "${APP}/data/db.json" 'دادهٔ مهم')"
check "بکاپ خودکار ساخته شد" "$(ls "${APP}/data/backups/" 2>/dev/null | grep -q pre-install && echo true || echo false)"
check "app.env سفارشی دست‌نخورده ماند" "$(has "$ENVF" 'MARKER=custom')"
check "سرویس قبل از کپی متوقف شد" "$(has "$LOG" 'systemctl stop channel-ads')"

# ===========================================================================
echo
echo "════ سناریو ۴: رد کردن ورودی نامعتبر ════"
rc=$(run_install DOMAIN='not a domain!' ADMIN_USER=admin)
check "دامنهٔ نامعتبر رد می‌شود" "$([ "$rc" != "0" ] && echo 0 || echo 1)" "کد خروج: $rc"

cat > "${STUB_BIN}/ss" <<'STUB'
#!/usr/bin/env bash
echo "LISTEN 0 511 127.0.0.1:8787 *:*"
STUB
chmod +x "${STUB_BIN}/ss"
rc=$(run_install ADMIN_USER=admin PORT=8787)
check "پورت اشغال تشخیص داده می‌شود" "$([ "$rc" != "0" ] && echo 0 || echo 1)" "کد خروج: $rc"
check "پیام خطای پورت واضح است" "$(has "${SANDBOX}/out.txt" 'در حال استفاده است')"

# ===========================================================================
echo
echo "────────────────────────────────────────────"
echo "  موفق: ${pass}   ناموفق: ${fail}"
echo "────────────────────────────────────────────"
[ "$fail" -gt 0 ] && echo "خروجی آخرین اجرا: ${SANDBOX}/out.txt" && exit 1
rm -rf "$SANDBOX"
exit 0
