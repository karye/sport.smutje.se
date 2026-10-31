#!/usr/bin/env bash
#
# Installerar sport.smutje.se som tjänst bakom Apache.
#
#   sudo bash /var/www/sport.smutje.se/deploy/installera.sh
#
# Skriptet är idempotent: det går att köra om, och det hoppar över steg som redan är gjorda.
# Det rör inga andra vhosts. Varje steg kontrolleras innan nästa börjar, så att ett fel i
# Apache-konfigurationen stoppar före en omstart i stället för efter.
#
# Variabelnamnen är ASCII. Skalnamn får inte innehålla Å, Ä eller Ö — bash läser dem som kommandon.

set -euo pipefail

DOMAN="sport.smutje.se"
ROT="/var/www/${DOMAN}"
KONF="${ROT}/deploy"
PORT=3011
TJANST="${DOMAN}.service"

gron()  { printf '\033[32m%s\033[0m\n' "$*"; }
gul()   { printf '\033[33m%s\033[0m\n' "$*"; }
röd()   { printf '\033[31m%s\033[0m\n' "$*" >&2; }
steg()  { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
indrag() { sed 's/^/  /'; }

avbryt() { röd "Avbryter: $*"; exit 1; }

# ---------------------------------------------------------------- förutsättningar

[ "$(id -u)" -eq 0 ] || avbryt "kör som root: sudo bash $0"

for fil in "${KONF}/${DOMAN}.conf" "${KONF}/${DOMAN}-le-ssl.conf" "${KONF}/${TJANST}"; do
  [ -f "$fil" ] || avbryt "saknar $fil"
done

[ -f "${ROT}/.env" ] || avbryt "saknar ${ROT}/.env"

if ! grep -q '^REDIRECT_URI=https://sport.smutje.se/auth/callback' "${ROT}/.env"; then
  röd "Varning: REDIRECT_URI i .env pekar inte på https://${DOMAN}/auth/callback."
  röd "Google kräver exakt den adressen, annars blir det redirect_uri_mismatch."
  read -r -p "Fortsätt ändå? [j/N] " svar
  [[ "${svar:-}" =~ ^[jJyY]$ ]] || avbryt "avbrutet"
fi

steg "1/7 DNS"
IP=$(getent hosts "$DOMAN" | awk '{print $1; exit}')
[ -n "${IP:-}" ] || avbryt "${DOMAN} saknar DNS-post"
gron "  ${DOMAN} → ${IP}"

mkdir -p /var/www/html/.well-known/acme-challenge
chown -R www-data:www-data /var/www/html/.well-known 2>/dev/null || true

# ---------------------------------------------------------------- port 80

steg "2/7 Vhost på port 80"
install -m 644 "${KONF}/${DOMAN}.conf" "/etc/apache2/sites-available/${DOMAN}.conf"
a2ensite "${DOMAN}" >/dev/null
apache2ctl configtest 2>&1 | indrag
systemctl reload apache2
gron "  port 80 proxar till 127.0.0.1:${PORT}"

# ---------------------------------------------------------------- certifikat

steg "3/7 Certifikat"
if [ -f "/etc/letsencrypt/live/${DOMAN}/fullchain.pem" ]; then
  gul "  certifikat finns redan, hoppar över utfärdandet"
else
  certbot certonly --webroot -w /var/www/html -d "$DOMAN" --non-interactive --agree-tos \
    --keep-until-expiring 2>&1 | indrag \
    || avbryt "certbot misslyckades. Vanligaste orsaken: port 80 når inte fram utifrån, eller så svarar något annat före ACME-aliaset."
fi
[ -f "/etc/letsencrypt/live/${DOMAN}/fullchain.pem" ] || avbryt "certifikatet skapades inte"
gron "  /etc/letsencrypt/live/${DOMAN}/fullchain.pem"

# ---------------------------------------------------------------- port 443

steg "4/7 Vhost på port 443"
install -m 644 "${KONF}/${DOMAN}-le-ssl.conf" "/etc/apache2/sites-available/${DOMAN}-le-ssl.conf"
a2ensite "${DOMAN}-le-ssl" >/dev/null
apache2ctl configtest 2>&1 | indrag
systemctl reload apache2
gron "  https://${DOMAN}/ proxar till 127.0.0.1:${PORT}"

# ---------------------------------------------------------------- tjänsten

steg "5/7 Tjänsten"
install -m 644 "${KONF}/${TJANST}" "/etc/systemd/system/${TJANST}"
systemctl daemon-reload
systemctl enable "${TJANST}" >/dev/null
gron "  ${TJANST} aktiverad vid boot"

# ---------------------------------------------------------------- porten

steg "6/7 Frigör port ${PORT}"

porten_upptagen() { ss -ltn "( sport = :${PORT} )" | grep -q LISTEN; }

if porten_upptagen; then
  PID=$(ss -ltnp "( sport = :${PORT} )" | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2 || true)
  [ -n "${PID:-}" ] || avbryt "port ${PORT} är upptagen men processen går inte att identifiera"
  gul "  port ${PORT} hålls av pid ${PID} (troligen bun run dev). Stoppar den."

  # En --watch-förälder startar om barnet direkt, så hela kedjan måste bort.
  foralder=$(ps -o ppid= -p "$PID" | tr -d ' ')
  while [ -n "${foralder:-}" ] && [ "$foralder" != "1" ]; do
    if tr '\0' ' ' < "/proc/${foralder}/cmdline" 2>/dev/null | grep -q -- '--watch'; then
      kill "$foralder" 2>/dev/null || true
    fi
    foralder=$(ps -o ppid= -p "$foralder" 2>/dev/null | tr -d ' ' || true)
  done
  kill "$PID" 2>/dev/null || true

  for _ in 1 2 3 4 5 6 7 8 9 10; do
    porten_upptagen || break
    sleep 0.3
  done
fi

if porten_upptagen; then
  avbryt "port ${PORT} är fortfarande upptagen. Stoppa processen och kör om."
fi
gron "  port ${PORT} är ledig"

# ---------------------------------------------------------------- start och kontroll

steg "7/7 Start och kontroll"
systemctl restart "${TJANST}"
sleep 1.5

if ! systemctl is-active --quiet "${TJANST}"; then
  journalctl -u "${TJANST}" -n 25 --no-pager >&2 || true
  avbryt "tjänsten startade inte"
fi
gron "  tjänsten kör"

kontroll() {
  local vag="$1" vantat="$2" beskrivning="$3" kod
  kod=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://${DOMAN}${vag}" || echo 000)
  if [ "$kod" = "$vantat" ]; then
    gron "  ${beskrivning}: ${kod}"
  else
    röd "  ${beskrivning}: ${kod} (väntade ${vantat})"
    return 1
  fi
}

fel=0
kontroll "/" 200 "inloggningssidan" || fel=1
kontroll "/api/halsa" 401 "api utan kaka" || fel=1
kontroll "/pass/sbbk-p16/16000001-2742@sportadmin.se" 200 "pass-sidan" || fel=1

# Att tjänsten överlever en omstart är hela poängen med systemd.
systemctl restart "${TJANST}"
sleep 1.5
kontroll "/" 200 "efter omstart" || fel=1

printf '\n'
if [ "$fel" -eq 0 ]; then
  gron "Klart. Öppna https://${DOMAN}/ och logga in med Google."
else
  röd "Tjänsten kör, men någon kontroll föll. Se journalctl -u ${TJANST} -n 50"
fi

printf '\nLoggar:\n'
printf '  journalctl -u %s -f\n' "${TJANST}"
printf '  tail -f /var/log/apache2/%s-error.log\n' "${DOMAN}"
