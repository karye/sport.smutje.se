#!/usr/bin/env bash
#
# Byter från system-unit till användar-unit, så att omstart inte kräver sudo.
#
#   bash /var/www/sport.smutje.se/deploy/ta-bort-systemd.sh
#
# sudo behövs bara för att stoppa och radera den gamla system-uniten. Resten körs som pi.

set -euo pipefail

NAMN=sport.smutje.se
ROT=/var/www/$NAMN

grön() { printf '\033[32m%s\033[0m\n' "$*"; }
steg() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
avbryt() { printf '\033[31mAvbryter: %s\033[0m\n' "$*" >&2; exit 1; }

[ -f "$ROT/deploy/$NAMN.service" ] || avbryt "saknar $ROT/deploy/$NAMN.service"

steg "1/4 Stoppar och inaktiverar system-uniten (kräver sudo)"
sudo systemctl disable --now "$NAMN"
sudo rm -f "/etc/systemd/system/$NAMN.service"
sudo systemctl daemon-reload
grön "  system-uniten är borta"

steg "2/4 Installerar användar-uniten"
mkdir -p "$HOME/.config/systemd/user"
install -m 644 "$ROT/deploy/$NAMN.service" "$HOME/.config/systemd/user/$NAMN.service"
systemctl --user daemon-reload
grön "  $HOME/.config/systemd/user/$NAMN.service"

steg "3/4 Startar"
systemctl --user enable "$NAMN" >/dev/null
systemctl --user restart "$NAMN"
sleep 2
systemctl --user is-active --quiet "$NAMN" || {
  journalctl --user -u "$NAMN" -n 20 --no-pager >&2
  avbryt "tjänsten startade inte"
}
grön "  igång — utan sudo"

steg "4/4 Kontrollerar"
KOD=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$NAMN/" || echo 000)
[ "$KOD" = "200" ] && grön "  https://$NAMN/ svarar 200" || printf '\033[31m  https://%s/ svarar %s\033[0m\n' "$NAMN" "$KOD"

printf '\nLoggar: journalctl --user -u %s -f\n' "$NAMN"
printf 'Starta om: systemctl --user restart %s\n' "$NAMN"
