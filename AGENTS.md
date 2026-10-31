# AGENTS.md — sport.smutje.se

Familjekalender för Barn 1 och Barn 2s idrotter. Bun + SQLite bakom Apache. Planen i sin helhet ligger i
`README.md`; den här filen är kortversionen för den som ska röra koden.

## Arkitektur

- **Runtime:** Bun 1.4 (`/home/pi/.nvm/versions/node/v26.0.0/bin/bun`), kör TypeScript direkt.
- **HTTP:** Elysia. **Databas:** `bun:sqlite` i WAL-läge, `app/data/sport.sqlite`.
- **Flöden:** `.ics` från Sportadmin och SvenskaLag, hämtas var 15:e minut, tolkas med `node-ical`.
- **Frontend:** React 19 + Vite + Tailwind i `frontend/`, byggs till `app/public/`.
- **Drift:** systemd `sport.smutje.se.service`, Apache 443 → `127.0.0.1:3011`, certbot.

## Grundregler

1. **Föreningens data skrivs över, våra val gör det inte.** `events` ägs av hämtaren,
   `overrides` ägs av oss. De länkas via `(feed_id, uid)`.
2. **Hellre tyst än fel.** Saknas plats eller samling visas inget, aldrig en gissning.
3. **Krockar räknas på servern.** Aldrig i klienten — samma logik i tre vyer blir tre svar.
4. **Inga hemligheter i git.** Flödesadresser, konton och nycklar ligger i `.env` eller databasen.
   `README.md` visar formen, aldrig värdena.
5. **Ingen webbläsarautomatisering.** Verifiera med `bun test`, `bun run typecheck`, `curl` och
   läsning av koden. Användaren tittar själv i sin webbläsare.

## Kommandon

```bash
cd app
bun install
bun run dev          # http://127.0.0.1:3011 med omstart, läser ../.env
bun run typecheck    # tsc --noEmit, strict
bun test             # 101 tester: tolken, krockar, ISO-veckor, inloggning, appskalet
bun run granska <url>  # granska ett verkligt flöde utan att skriva ut namn
```

Frontend:

```bash
cd frontend
bun install
bun run dev        # http://localhost:5173, /api och /auth proxas till 3011
bun run typecheck
bun run build      # → ../app/public, som Bun serverar
```

Driften kör tjänsten utan `--watch`, så en kodändring slår igenom först efter
`sudo systemctl restart sport.smutje.se`. Loggar: `journalctl -u sport.smutje.se -f`.

Miljön: `bun run dev` och `bun run start` läser `/var/www/sport.smutje.se/.env` med
`--env-file=../.env`. Testerna sätter sin egen miljö och rör aldrig den skarpa filen.

## Kartan

| Fil | Roll |
|---|---|
| `app/src/index.ts` | Sätter ihop appen, inga rutter själv |
| `app/src/db.ts` | SQLite, PRAGMA, schema, migreringar |
| `app/src/tolk.ts` | ICS → normaliserade händelser |
| `app/src/auth.ts` | Google OAuth, HMAC-signerad session, allowlist, roller |
| `app/src/skydd.ts` | `inloggad`, `krävsApi`, `krävsForalder`, `sammaUrsprung` |
| `app/src/cookies.ts` | Set-Cookie och Cookie-huvudet, en plats |
| `app/src/webb.ts` | Serversidans HTML: inloggningssida, fel, utloggning |
| `app/src/rutter/` | En fil per område: `inloggning.ts` |
| `app/src/samling.ts` | Samlingstid ur `DESCRIPTION`, per flöde |
| `app/src/platser.ts` | Platsnormalisering och restid |
| `app/src/krock.ts` | Krockberäkning, rena funktioner |
| `app/src/tid.ts` | Tidszon, ISO-veckor, svenska etiketter |
| `app/test/fixtures/` | Anonymiserade flöden och kantfall |
| `deploy/` | Vhostar, systemd-unit och `installera.sh`. Kräver `sudo`, ägs av root när det är installerat |

## Fällor som redan kostat tid

- `TZID` måste respekteras. Allt sparas som UTC-ms och renderas i `Europe/Stockholm`.
- ISO-vecka 1 är den vecka som innehåller första torsdagen. December och januari är där en
  hemmasnickrad räknare ger `v.0`.
- Utan `checkpoints`/`ETag` blir varje hämtning en full omläsning. Sportadmin svarar `304`.
- En händelse som försvinner ur flödet ska bli *inställd* efter två hämtningar, inte raderas.
- `node-ical` expanderar inte `RRULE` i `recurrences` — den innehåller bara flyttade instanser. Använd
  `event.rrule.between()`.
- UID:n innehåller `@sportadmin.se`, alltså en punkt. SPA-fallbacken får inte avgöra "är det en
  fil?" på punkten, då blir varje pass-sida 404.
- Sportadmin fyller i `Samling:` med samma tid som starten när ledaren inte angett någon. Den raden
  visas inte, och en samling mer än tre timmar före passet visas inte heller — det är ett datafel
  i inlämningen (skarpt fall: `Samling: 13:30` på en träning 17:30).
- Föreningens kalender är gemensam: en `.ics` kan innehålla flera lag och båda sporterna. Lagkoden i
  titeln avgör vems passet är, inte flödeskonfigurationen.
- **Noll tolkade händelser sparas aldrig.** SvenskaLag svarar 200 med `Borttaget` och noll händelser;
  utan skyddet ställs hela kalendern in efter två hämtningar.
- Ett `304` betyder att tolken inte körs. Har tolken ändrats krävs `--tvinga` för att nolla ETag.
- Non-ASCII i `User-Agent` ger `400`/`502` från Sportadmins Kestrel. Håll huvuden ASCII.
- SvenskaLag: `Samling: <plats>, kl HH:MM` — platsen står mellan ordet och tiden, upp till 60 tecken.
  Och `cal.svenskalag.se/<id>.ics` ger `Borttaget` med noll händelser; rätt adress är utan `.ics`.
