# deploy

Filerna som kräver `sudo` att installera. Katalogen är den enda platsen där driftkonfigurationen
ligger i git; den skarpa kopian ägs av root.

**Installerat 2026-10-29.** Allt nedan är gjort på maskinen: vhost på 80 och 443, certifikat från
Let's Encrypt (giltigt till 2027-01-27), tjänsten `sport.smutje.se.service` aktiverad vid boot, och
förnyelsen provad med `certbot renew --dry-run` (simulering lyckades). Filerna här är sanningen om
installationen behöver göras om — till exempel på en ny maskin.

```bash
sudo bash /var/www/sport.smutje.se/deploy/installera.sh
```

Skriptet är idempotent, kontrollerar varje steg före nästa, och stannar innan det startar om Apache
om konfigurationen är fel. Det frigör port 3011 från en eventuell `bun run dev`, dödar även
`--watch`-föräldern (annars startar den om barnet direkt) och avslutar med att starta om tjänsten
och kontrollera fyra statuskoder över https.

## 1. Vhosten

```bash
sudo cp /var/www/sport.smutje.se/deploy/sport.smutje.se.conf /etc/apache2/sites-available/
sudo a2ensite sport.smutje.se
sudo apache2ctl configtest && sudo systemctl reload apache2
```

Nu svarar `http://sport.smutje.se` med appens inloggningssida (port 80 proxar till 3011 innan
omdirigeringen till https).

## 2. Certifikatet

```bash
sudo certbot certonly --webroot -w /var/www/html -d sport.smutje.se
```

`certonly --webroot` och inte `--apache`: apache-plugin skriver om vhosten vid varje förnyelse, och
då kan säkerhetsrubrikerna försvinna tyst. Utmaningen serveras av `Alias`-raden i port 80-filen.

## 3. HTTPS-vhosten

```bash
sudo cp /var/www/sport.smutje.se/deploy/sport.smutje.se-le-ssl.conf /etc/apache2/sites-available/
sudo apache2ctl configtest && sudo systemctl reload apache2
sudo certbot renew --dry-run
```

## 4. Tjänsten — som användar-unit

Bun-apparna på maskinen (`be.smutje.se`, `classroom-app`, `bun.smutje.se`) kör som **användar-units**,
inte system-units. Det är därför de kan startas om utan sudo, och den här appen följer samma mönster.

```bash
bash /var/www/sport.smutje.se/deploy/ta-bort-systemd.sh
```

Skriptet stoppar den gamla system-uniten (enda sudo-steget), installerar uniten i
`~/.config/systemd/user/`, aktiverar den och kontrollerar att adressen svarar.

`linger` är påslaget för `pi`, alltså startar användarens systemd vid boot utan inloggning — appen
kommer upp av sig själv precis som förut.

Vardagskommandon, utan sudo:

```bash
systemctl --user restart sport.smutje.se
systemctl --user status sport.smutje.se
journalctl --user -u sport.smutje.se -f
```

En system-unit kräver root eftersom `systemctl` frågar PID 1 över D-Bus. Det handlar inte om
filrättigheter: filerna ägs av `pi` och processen kör som `pi` hela tiden.

Stoppa en eventuell `bun run dev` som ligger på 3011 först, annars krockar porten:

```bash
ss -ltnp | grep 3011        # visa pid
kill <pid>                  # eller: sudo systemctl stop sport.smutje.se om det är tjänsten
```

Tjänsten kör **utan** `--watch`. Efter en kodändring:

```bash
sudo systemctl restart sport.smutje.se
```

Under utveckling kan `bun run dev` köras för hand på en annan port i stället
(`PORT=3012 bun run dev`), så att tjänsten på 3011 får vara i fred.

## 5. Omdirigeringsadressen

`REDIRECT_URI=https://sport.smutje.se/auth/callback` i `.env`. Ingen localhost-genväg används.
Adressen måste vara **exakt** den som är registrerad i Google Cloud Console, annars svarar Google
`redirect_uri_mismatch` — och det felet syns först efter ett godkänt konto, inte före.

## 6. Kontroll efter installation


```bash
curl -sI https://sport.smutje.se/ | head -5          # 200, text/html
curl -s  https://sport.smutje.se/api/halsa           # {"fel":"Inte inloggad"} med 401
sudo systemctl restart sport.smutje.se && curl -s -o /dev/null -w "%{http_code}\n" https://sport.smutje.se/
```

Den sista raden är den som avgör om tjänsten överlever en omstart, vilket är hela poängen med
systemd i stället för en bakgrundsprocess.
