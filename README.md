# sport.smutje.se — familjekalender för barnens idrotter

En egen webbapp som samlar inbjudningarna från Sportadmin och SvenskaLag (SBBK, Södra Ängby,
Hammarby, scouterna) och visar dem som **en** överblick: vad som händer, när, var, vem som
skjutsar — utan att de vanliga kalendrarna fylls av pass som inte gäller.

Familjen: **Förälder 1** och **Förälder 2** (föräldrar), **Barn 1** och **Barn 2** (barn).

Dokumentet är en plan, inte en beskrivning av byggd kod. Ingenting är skrivet ännu.

---

## 1. Rekommendation i korthet

Bygg appen. Grundidén är rätt, och skälet är starkare än "det blir många händelser":

- **Flödena är dumma.** `.ics` från Sportadmin och SvenskaLag innehåller allt laget har, inte det
  ditt barn är kallat till. Egna filter kan bara läggas ovanpå, alltså i egen server.
- **Flödena är långsamma.** Google Kalender hämtar en extern `.ics` med timmars mellanrum. En
  inställd träning klockan 14 syns kvar klockan 18. Vår server kan polla var 15:e minut.
- **Flödena krockar.** Två barn, fyra sporter, flera lag per sport. Krockar och skjutsning går
  inte att se i en vanlig kalender, för där finns ingen plats för "vem hämtar".

Kärnan i appen är därför inte kalendern utan **krockmodellen** (avsnitt 8): ett pass upptar tid från
samlingen, inte från avspark, och två pass kan krocka även när de inte överlappar, om avståndet
mellan platserna är längre än glappet. Det är den beräkningen som gör appen värd att bygga.

---

## 2. Kritisk genomgång av underlagen

Två förslag har legat till grund: en skiss med `Cloudflare Access`, `Preact` och årsvy, och en
klickbar prototyp med vecko- och månadsvy, krockpaneler och serverkod i gränssnittet. Det här är
vad som behålls och vad som ändras.

### 2.1 Från första skissen

| Påstående | Bedömning |
|---|---|
| Egen server löser det faktiska problemet (filter + snabbare uppdatering) | **Rätt.** Det är hela motiveringen. |
| Skippa årskalendern | **Rätt.** Se avsnitt 4 — månadsvyn tar över uppgiften. |
| Google Kalender synkar `.ics` långsamt | **Rätt**, och skälet att polla själva. Det slår tillbaka på exporten: en `.ics` *från* oss är också långsam i Google. Se avsnitt 11. |
| Lägg inloggningen i Cloudflare Access | **Avråds.** Vi har redan fungerande Google-inloggning i `prov.smutje.se`. Cloudflare lägger en tredje part framför barnens namn och scheman, kräver eget konto och DNS-kontroll, och gör felsökning till ett tvåsystemsproblem. |
| Använd `ical.js` eller `@pipobscure/ical` | **Byt till `node-ical`**, beprövat i `class.smutje.se`. |
| Preact/Svelte + Tailwind | **Byt till React 19 + Vite + Tailwind + shadcn**, samma som `class.smutje.se/frontend`, som redan har vecko- och kalendervyer för schema. |
| Svep åt vänster = "deltar ej" | **Avråds.** Krockar med iOS bakåtgest och saknar affordans. |
| Regexa fram samlingstid ur `DESCRIPTION` | **Rätt idé, fel metod som den står.** Mönstret måste vara per flöde, och utan träff ska kortet visa *inget* i stället för en gissning. |
| `event_overrides` med `is_hidden` + `assigned_parent` | **Rätt, men ofullständigt.** Behöver `updated_by`, `updated_at` och typer för samåkning/egen transport. |
| `setInterval` var 15:e minut | **Rätt**, men med ETag, timeout, storleksgräns, backoff och en synlig felflagga. Tysta fel är värre än högljudda. |
| Caddy + Cloudflare | **Systemd + Apache + certbot.** Apache kör redan 25 vhosts med Let's Encrypt. |

### 2.2 Från prototypen

| I prototypen | Bedömning |
|---|---|
| Vecka som förvald startvy | **Behålls.** Invändningen var att man på tisdag morgon vill se dagens pass — men veckovyn visar samling, plats, krock och skjutsarknapp per dag. Det *är* agendan. Alltså en vy, inte två, med kravet att veckan öppnar på **idag**. |
| `Aktuell vecka` / `Nästa vecka` + `<` `>` | **Behålls, med tredje tillståndet:** när man bläddrat bort byts knapparna mot en enda `Tillbaka till aktuell vecka`. Den vecka man står i är märkt, inte klickbar. |
| Månadskalender med `v.` i marginalen | **Behålls, och ersätter säsongsvyn.** En månadsgrid får plats på 390 px; 12 månadsband behövdes bara för att en årsmatris inte gör det. Flerdygnshändelser (cup, läger) får en egen rad ovanför rutnätet, eftersom en grid aldrig kan visa något som spänner över dagar. |
| Detaljvy vid klick på pass | **Behålls som egen sida `/pass/<id>`**, inte som ark eller query-parameter. Se avsnitt 4.4. |
| `Ansvarig` som cykelknapp | **Avråds.** Fem val i en cykel är upp till fyra tryck, och ett feltryck syns inte. Knappen visar nuvarande värde och öppnar arket. |
| `Förälder A` / `Förälder B` | **Behålls inte som etiketter.** Namnen kommer från Google-kontot vid inloggning; i det här dokumentet skrivs de som *Förälder 1* och *Förälder 2*, eftersom repot är publikt. |
| Egen `Veckokrockar`-flik | **Stryks.** Krockarna syns i tidsaxeln och som triangel i månaden. Tre flikar i bottennavet slår fem. |
| Serverkod i en flik i appen | **Stryks.** I demon är den scaffolding. I den riktiga appen blir koden i bundlen en andra, tyst divergerande sanning. Koden hör i git; README dokumenterar den. |
| `Skicka till Google Kalender` i MVP | **Skjuts fram.** Kräver känsligt scope, tokenlagring och refresh-flöde. En `.ics`-nedladdning per pass ger samma nytta utan nyckel. Se avsnitt 11. |
| Realistisk testdata från båda leverantörerna | **Behålls och skärps.** Fixtures ska innehålla det fula: inställt pass, dubblett, saknad plats, saknad samling, flyttad engångsföreteelse. Se avsnitt 13. |
| `Egen transport` som logistikval | **Behålls**, och dessutom som regel: det **löser** krocken. |

### 2.3 Vad båda förslagen saknade

1. **Restid.** Krockar räknas på `[samling − restid, slut]`, inte på matchtiden. Se avsnitt 8.
2. **Dubbletter mellan flöden.** Samma match kan ligga i både barnets och lagets flöde.
3. **Inställda pass.** `STATUS:CANCELLED` och — vanligare — händelser som bara försvinner ur flödet.
   De ska visas överstrukna som *inställda*, inte spårlöst försvinna.
4. **Tidszoner.** `TZID` måste respekteras. `schoolsoft.ics` på maskinen anger `Europe/Berlin`;
   det råkar ge samma klocka som Stockholm i dag, men det är en bugg som ska fångas, inte ärvas.
5. **ISO-veckor vid årsskiftet.** December och januari är exakt där en hemmasnickrad veckoräknare
   ger `v.0` eller fel år.
6. **Export.** En ren `.ics` per person med bara de pass hen skjutsar på.
7. **Ett gemensamt skrivläge.** "Vem skjutsar" är meningslöst om det bara syns på den ena
   förälderns telefon.

---

## 3. Vad appen ska göra, i klartext

- Hämta alla flöden var 15:e minut, normalisera dem och spara i SQLite.
- Visa **vecka** (startvy, två lägen), **månad** och en **pass-sida** — filtrerbart per barn, sport
  och klubb.
- Visa **samlingstid**, **plats**, **motståndare** och **krock** där uppgifterna finns, och tiga
  där de inte finns.
- Låta Förälder 1 och Förälder 2 **markera deltar ej**, **tilldela skjutsning** och **skriva en anteckning** —
  delat mellan dem, med namn och tidsstämpel.
- Vara en **PWA** på hemskärmen: helskärm, snabb start, läsbar offline.
- Kunna **lägga ett enskilt pass i telefonens kalender** med ett tryck, och senare prenumerera på
  en ren kalender per person.

Och uttryckligen inte: chat, betalningar, lagindelningar, statistik, medlemsregister.

---

## 4. Vyerna

### 4.1 Vecka — startvyn

Frågan den svarar på: *vad händer i veckan, och vem gör vad?*

```
┌──────────────────────────────────────┐
│ sport.smutje.se            Förälder 1  ⚙︎ │  header, 52 px
│ ‹  Aktuell vecka · Nästa vecka  ›  v.45│  veckonavigering
│ [Alla] [Barn 1] [Barn 2] · [Bandy] [Innebandy]│ chips
├──────────────────────────────────────┤
│  Idag · onsdag 29 oktober            │
│  ┌────────────────────────────────┐  │
│  │▌15:30–17:00  Träning P14       │  │
│  │  SBBK · Brommahallen plan 2    │  │
│  │  Samling 15:15   [Förälder 2]    ⋯  │  │
│  └────────────────────────────────┘  │
│  Imorgon · torsdag 30 oktober        │
│  ┌────────────────────────────────┐  │
│  │▌18:00–19:30  Match mot Hif     │  │
│  │  Södra Ängby · Vällingby       │  │
│  │  ⚠ Krock med Barn 2 18:15     ⋯  │  │
│  └────────────────────────────────┘  │
├──────────────────────────────────────┤
│   Vecka        Månad         Mer     │  bottennav, 3 flikar
└──────────────────────────────────────┘
```

- **Öppnar på idag.** Dagar före idag är ihopfällda till en rad (`3 pass tidigare i veckan`) som
  går att fälla ut. Veckan är sju dagar, men frågan den besvarar börjar i nuet.
- **Veckonavigering** med tre tillstånd: `Aktuell vecka` · `Nästa vecka` · `‹ ›` för fritt bläddrande.
  När man bläddrat bort från innevarande vecka ersätts de två första av en enda
  `Tillbaka till aktuell vecka`. Ordet är **aktuell**, inte *denna*, i hela gränssnittet.
- **Två lägen**, växlade med en segmentkontroll:
  - **7-dagarsöversikt** (standard): kort per dag, som ovan. Fungerar på 360 px.
  - **Tidsaxel**: **veckodagarna horisontellt, tiden lodrätt** — den form en vecka faktiskt har.
    Sju kolumner med dagnav som ligger utanför scrollen, tidsgutter till vänster, 06–23, och en
    nutidslinje i dagens kolumn. Samlingen ritas som ett tunt streck strax ovanför blocket, eftersom
    den ligger före passets start och blocket klipper sin egen yta. Visas **först från 640 px**;
    under det visar segmentknappen bara översikten. En matris som kläms in på 360 px blir oläslig,
    och en oläslig matris är värre än ingen.
- **Chips** högst upp: `Alla` + Barn 1 + Barn 2 + ett per sport. Flera val samtidigt. Valet är en visningsinställning
  och sparas i webbläsaren; det som hör till familjen ligger i databasen.
- **Kortet** bär allt som behövs för att bestämma något: tid, titel, `klubb · plats`, samling,
  ansvarig, krock, inställt. Inlineknapparna `Ansvarig` och `⋯` ligger på kortet; resten av
  åtgärderna i arket (avsnitt 12.3).
- **Idag** står med ordet `Idag`, inte bara med färg. Färg är det första som försvinner i solljus.

### 4.2 Månad

Frågan den svarar på: *när är det cup, läger och sammandrag — och hur ser månaden ut?*

```
┌──────────────────────────────────────┐
│ ‹   oktober 2026   ›                 │
│  Cup: SBBK höstcup 14–15 nov         │  flerdygnsrad
├───┬──┬──┬──┬──┬──┬──┬──┐             │
│ v. │M │T │O │T │F │L │S │             │  ISO-vecka i marginalen
│44 │  │  │  │▌ │  │▌ │▌ │             │  färglist per pass
│45 │▌ │⚠ │  │  │  │  │  │             │  ⚠ = olöst krock
│46 │  │  │  │  │  │  │  │             │
├───┴──┴──┴──┴──┴──┴──┴──┘             │
│  Onsdag 29 oktober                   │  vald dag, korten under
│  ┌────────────────────────────────┐  │
│  │▌15:30–17:00  Träning P14    ⋯  │  │
│  └────────────────────────────────┘  │
├──────────────────────────────────────┤
│   Vecka        Månad         Mer     │
└──────────────────────────────────────┘
```

- **Mån–sön**, ISO-vecka i vänstermarginalen, `v.` som prefix.
- **Varningstriangeln räknar bara olösta krockar.** En triangel som tänds även efter att Förälder 2 tagit
  Barn 2:s pass blir permanent brus och slutar betyda något. Se avsnitt 8.4.
- **Klick på dag** visar dagens kort under rutnätet. **Klick på pass** går till `/pass/<id>`.
- **Rutnätet stegar kalenderdagar, inte 24 timmar.** Övergången till vintertid ger ett dygn på 25
  timmar; att addera 86 400 000 ms från lokal midnatt gav då 23:00 kvällen innan, samma datum två
  gånger och alla följande dagar i fel kolumn. Det finns ett test i `app/test/tid-klient.test.ts`.
- **Flerdygnsraden** ovanför rutnätet listar cup och läger, alltså det rutnätet inte kan visa.
- Veckonummer, månadsnamn och veckodagar via `Intl` med `sv-SE`. Inga hårdkodade listor.

### 4.3 Mer — och varför allt är data

**Ingenting om familjen hårdkodas.** Namnen på barnen, deras färger, lagmappningen, flödesadresserna
och platserna ligger i SQLite och redigeras i `Mer → Inställningar`. Skälet är praktiskt: en ny
säsong, ett lagbyte i Sportadmin eller en nytt `webcal://`-id hade annars krävt inloggning på
servern och en kodändring.

| Tabell | Innehåll | Redigeras i |
|---|---|---|
| `barn` | namn, färg, sortering | Inställningar → Barn & familj |
| `users` | de vuxna, från Google-profilen vid inloggning | Inloggningen, inte i appen |
| `feeds` | adress, klubb, sport, barn, färg, samlingsmönster, **filter** | Inställningar → Flöden |
| `lag` | lagkod → barn, sport, **klubb**, färg, titelregel | Inställningar → Lag |
| `platser` | namn, adress, koordinater | Inställningar → Platser |

De vuxna är redan data: `display_name` och `email` kommer från Google vid varje inloggning, och
rollen sätts av `ALLOWED_EMAILS`. Där finns inget att hårdkoda och inget att underhålla.

Fyra saker som hör hit och som är beslut, inte detaljer:

- **`webcal://` skrivs om till `https://`** när adressen sparas, i både verktyget och API:t.
- **Ett filter per flöde.** `feeds.filter_monster` matchas mot titel, beskrivning **och** kategori.
  Behövs när flödet är hela föreningens kalender: Blackebergs scoutkår har tre händelser, och
  Skutorna står bara i beskrivningen på en av dem — ett titelfilter hade gett noll träffar.
  Ett filter som matchar noll är inte ett tomt flöde: inget sparas, men inget ställs in heller.
- **Ny adress provas innan den sparas** (`POST /api/feeds/testa`) och svarar
  `36 händelser, första 12 mars`. En felstavad adress ger annars ett tyst tomt flöde.
- **Adressen returneras aldrig i klartext** till klienten, bara som värdnamn, eftersom den kan
  innehålla en hemlig nyckel.
- **`localStorage` används inte.** Det var prototypens lösning, och den betyder att varje enhet har
  sin egen sanning: Förälder 1 och Förälder 2 skulle se olika lagmappning. Allt sparas i databasen, en gång.

Inställningar, flödesstatus, export, dolda pass (`Deltar ej`), utloggning.

**Dolda pass har egen vy** (`/dolda`), för utan den går ett "deltar ej" inte att ångra — och då är
knappen farlig. `GET /api/events?dolda=1` svarar med dem utan datumspann, eftersom de inte har
någon naturlig plats i tiden.

**Två knappar för kalendern.** `Ladda ner kalenderfil` ger en `.ics` med samlingen som egen rad.
`Lägg i Google Kalender` öppnar Googles mall med samlingen som **starttid** och passets start i
beskrivningen — annars hade kalenderposten börjat vid avspark och samlingen försvunnit.

**Två filter utöver chipsen:** `⚑ Saknar ansvarig` visar bara pass där ingen tagit skjuts, och
veckohuvudet räknar **olösta** krockar (`⚠ 3 olösta`), inte alla. Tre flikar i bottennavet
ger större träffytor än fem, och en flik som heter `Mer` behöver inte förklaras i en parentes.

Inställningsvyn innehåller: flödeslista med hälsostatus (senast hämtad, fel, antal händelser),
barnens färger, `Ansvarig`-namnen, och adressen till exportflödet. När en ny `.ics`-adress sparas
hämtar servern den **direkt** och svarar `12 händelser, första 14 nov` — annars ger en felskrivning
ett tyst tomt flöde.

Flödesadresserna kan innehålla hemliga nycklar: de visas maskerade, returneras aldrig i klartext
till klienten och loggas aldrig.

### 4.4 Pass-sidan — `/pass/<feed>/<uid>`

Egen sida, inte ark och inte query-parameter, eftersom den ska kunna skickas till den andra
föräldern: *"titta, Barn 1:s match"*. Sidan visar titel, tid, samling med källa, plats med adress,
motståndare, hela beskrivningen från föreningen, ansvarig, anteckning, krock mot vilka pass, samt
åtgärderna: `Deltar ej`, `Ansvarig`, `Lägg i kalendern`, `Öppna i Sportadmin`, `Rätta samlingstid`.

Tre tekniska krav:

1. **Servern svarar med appskalet på alla rutter utan filändelse**, alltså även `/pass/...`.
   Rutten ägs av klienten (history-API), så sidan byts utan omladdning och veckans skrolläge
   bevaras. Ett hårdt omladdat `/pass/...` fungerar också, men då från toppen.
2. **Tillbaka** använder `history.back()` när det finns historik, annars `/vecka`. Android-back ska
   stänga sidan, inte lämna appen.
3. **Finns passet inte** (inställt och bortstädat, eller fel id) visas en tydlig sida med väg
   tillbaka — inte en tom panel.

---

## 5. Arkitektur

Samma form som `prov.smutje.se`, närmast grannen: Bun kör TypeScript direkt, ingen byggnad på
serversidan, SQLite i WAL-läge, Elysia (redan i bruk i två projekt på maskinen) och statiska filer
från `public/`.

```
                 ┌──────────────────────────────────────────────┐
  Sportadmin ───▶│  hämtare (var 15:e minut, ETag, backoff)      │
  SvenskaLag ───▶│      │                                       │
  Scout ────────▶│      ▼                                       │
                 │  tolkare: node-ical → normaliserade events   │
                 │      │  (TZID, RRULE, CANCEL, samling, sport) │
                 │      ▼                                       │
                 │  krockmodell: samling + restid + platser     │
                 │      │                                       │
                 │      ▼                                       │
                 │  SQLite: feeds · events · platser            │
                 │          overrides · users · fetch_runs      │
                 │      │                                       │
                 │      ▼                                       │
                 │  API /api/*  ── Elysia, bakom Google-inlogg.  │
                 └──────┬───────────────────────────────────────┘
                        │  JSON + appskal + statiska filer
                        ▼
              React 19 + Vite + Tailwind + PWA
              (manifest, service worker, hemskärm)
                        ▲
                        │  Apache 443 (proxy 127.0.0.1:3011)
                 webbläsare / mobil
```

### 5.1 Teknikval och varför

| Del | Val | Skäl |
|---|---|---|
| Runtime | Bun 1.4 | Installerat (`/home/pi/.nvm/versions/node/v26.0.0/bin/bun`), kör TS utan byggsteg. |
| HTTP | Elysia | Redan i bruk i `prov.smutje.se` och `bun.smutje.se`. |
| Databas | `bun:sqlite` | Noll konfiguration, WAL, `busy_timeout`, `foreign_keys`. Mönstret finns i `prov.smutje.se/app/src/db.ts`. |
| ICS | `node-ical` | Beprövat i `class.smutje.se`, hanterar `TZID`, `RRULE`, `EXDATE`, `RECURRENCE-ID`. |
| Schemaläggning | `setInterval` + `/api/refresh` | Enklare än cron, och gör manuell uppdatering gratis. |
| Frontend | React 19 + Vite 8 + Tailwind 3.4 + shadcn/ui | `class.smutje.se/frontend` har exakt detta, med vecko- och kalendervy för schema. |
| Proxy | Apache 2 + certbot | 25 vhosts kör redan så. |
| Process | systemd-unit, `User=pi` | Samma som `batar.service` och `prov.smutje.se.service`. |
| Port | **3011** | 3000–3005, 3010, 5001, 8082 är upptagna. |

Podman används inte. `bun.smutje.se` behöver container för att byggas om vid deploy; den här appen
har ett byggsteg för frontend och startar på millisekunder. Systemd ger färre lager att felsöka.

### 5.2 Filstruktur

```
/var/www/sport.smutje.se/
├── README.md                    ← den här planen
├── .env                         (gitignorerad)
├── .env.example
├── .gitignore
├── app/
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts             sätter ihop appen, inga rutter själv
│   │   ├── db.ts                SQLite, PRAGMA, schema
│   │   ├── schema.sql
│   │   ├── auth.ts              Google OAuth, HMAC-cookie, allowlist, roller
│   │   ├── cookies.ts           serialize/parse, samma som prov
│   │   ├── skal.ts              appskal för SPA-rutter, sida(), omdirigera()
│   │   ├── hamtare.ts           hämtning av flöden, ETag, backoff
│   │   ├── tolk.ts              ICS → normaliserade event
│   │   ├── samling.ts           samlingstid ur DESCRIPTION, per flöde
│   │   ├── platser.ts           normalisering, lat/lon, restid
│   │   ├── krock.ts             krockberäkning (rena funktioner)
│   │   ├── vecka.ts             ISO-vecka, intervall, sv-SE-etiketter
│   │   ├── dedupe.ts            fingerprint och sammanslagning
│   │   ├── icsExport.ts         enskilt pass + prenumeration
│   │   ├── rutter/
│   │   │   ├── inloggning.ts
│   │   │   ├── handelser.ts     /api/events, /api/overrides
│   │   │   ├── floden.ts        /api/feeds (admin)
│   │   │   └── export.ts        .ics-nedladdning och prenumeration
│   │   └── typer.ts
│   ├── test/                    fixtures + tester (bun test)
│   ├── seed.ts                  demdatabas med Barn 1 och Barn 2
│   └── data/
│       ├── sport.sqlite         (gitignorerad)
│       └── raw/                 senaste råa ICS per flöde, för felsökning
├── frontend/
│   ├── package.json, vite.config.ts, index.html, tailwind.config.js
│   ├── public/                  manifest.webmanifest, sw.js, ikon.svg
│   └── src/
│       ├── main.tsx             mount + service worker
│       ├── App.tsx              history-API-router, skal, chips, ansvarigarket
│       ├── api.ts               alla anrop, en plats
│       ├── tid.ts               ISO-veckor och svenska etiketter på klientsidan
│       ├── useHändelser.ts      hämtning per intervall + fönsterbredd
│       ├── komponenter.tsx      Kort, Ark, Chips, Fält, Väljare
│       ├── vyer/Vecka.tsx       översikt och tidsaxel
│       ├── vyer/Manad.tsx       månadsgrid med ISO-veckor
│       ├── vyer/Pass.tsx        /pass/<feed>/<uid>
│       ├── vyer/Installningar.tsx  flöden, lag, barn & familj, platser
│       └── stil.css             Tailwind + designtokens
└── deploy/
    ├── sport.smutje.se.service
    └── sport.smutje.se.conf     (Apache, 80 + 443)
```

---

## 6. Inloggning, roller och åtkomst

Appen är privat. Den som finns i `ALLOWED_EMAILS` kommer in, och rollen avgör vad hen får göra.

```
ALLOWED_EMAILS=<foralder1s adress>:foralder,<foralder2s adress>:foralder
```

De verkliga adresserna står i `/var/www/sport.smutje.se/.env` (rättigheter `600`, gitignorerad) och
upprepas aldrig här. Skälet är inte hemlighetsmakeri utan att `README.md` hamnar i git: e-postadresser
i ett publikt repo är personuppgifter som dessutom ger spammål. `.env.example` visar samma nycklar
med tomma värden, vilket är samma mönster som `prov.smutje.se/app/.env.example`.

| Roll | Får | Ser |
|---|---|---|
| `foralder` | allt: skjutsansvar, deltar ej, anteckning, samlingstid, inställningar, flödesstatus | allt |
| `barn` | läsa | allt utom inställningar och export |

Barnens inloggning är **valfri**. Många skolkonton blockerar tredjepartsappar, och då fungerar
appen ändå: barnen lånar en förälders telefon eller tittar över axeln. Rollen finns för att det ska
vara billigt att lägga till dem senare, inte för att det behövs i dag.

Mönstret kopieras från `prov.smutje.se/app/src/auth.ts`, som ärvt det från `class.smutje.se` och
redan är felsökt:

1. **`/auth/login`** skapar en slumpad `state`-nonce i en signerad cookie (10 min) och skickar
   vidare till Google med `openid email profile`.
2. **`/auth/callback`** kontrollerar att `state` matchar cookien (CSRF), byter koden mot en token
   och hämtar profilen.
3. **Allowlist.** E-postadressen måste finnas i `ALLOWED_EMAILS`, annars 403-sida med förklaring.
   Rollen sätts vid första inloggningen och skrivs inte över när listan ändras.
4. **Sessionen är statslös:** `HMAC-SHA256` över `{uid, exp}` med `SESSION_SECRET` (minst 32
   tecken), `HttpOnly; Secure; SameSite=Lax`. Ingen sessionstabell, ingen hemlighet i cookien.
5. **Giltighet 90 dagar.** En familjekalender på hemskärmen ska inte logga ut, och cookien sitter
   på en enhet som redan är upplåst.
6. **Skrivningar** kräver förutom `SameSite=Lax` även `Origin`-kontroll,
   `Content-Type: application/json` och rollen `foralder`.

`redirect_uri` läses **alltid** från miljön (`REDIRECT_URI=https://sport.smutje.se/auth/callback`),
aldrig ur `Host`- eller `X-Forwarded-Host`-huvudet. Det är den vanligaste öppna omdirigeringen i
hemmasnickrade OAuth-flöden.

I Google Cloud Console: OAuth-klient av typen *Web application*, en auktoriserad
omdirigeringsadress. Inga känsliga scopes i MVP, alltså ingen verifieringsprocess.

**Publiceringsstatus: Testing.** Båda kontona är personliga `gmail.com`, inte Workspace, så
inloggningen kan inte begränsas till en domän — allowlistan är enda grinden, vilket är precis vad vi
bygger. Appen kan därför stå kvar i Testing-läge med de två adresserna som testanvändare: ingen
verifieringskö, ingen granskning, och inga varningar för någon annan eftersom ingen annan släpps in.
Att lämna det läget är den detalj som annars kostar veckor i Googles kö utan att ge något.

Testlägets sju dagars giltighet för refresh-tokens rör oss inte: vi lagrar inga tokens. Sessionen är
en signerad cookie, och den lever 90 dagar oavsett vad Google tycker om appens publiceringsstatus.

### 6.1 Så ser det ut när det kör

Byggt och verifierat 2026-10-29:

| Steg | Beteende |
|---|---|
| `/` utan kaka | Inloggningssidan, ritad av servern. Ingen del av appen syns före inloggning. |
| `/auth/login` | `302` till `accounts.google.com` med `state`-kaka (10 min, `HttpOnly`) och `prompt=select_account`, så att fel Google-konto på delad enhet går att välja bort. |
| `/auth/callback` | `state` jämförs med kakan. Fel eller utgången → `403` med förklaring. Adress utanför listan → `403` "Adressen är inte tillåten". |
| Lyckad inloggning | Sessionskaka i 90 dagar, `state`-kakan rensas, omdirigering till `/`. |
| `/api/*` utan kaka | `401` med JSON, aldrig en HTML-sida. |
| `/` med kaka | Hälsning med namn och roll, och en utloggningslänk. |
| `/api/halsa` | Bakom inloggning. Beslutet: ingen del av appen läses utan konto. |
| `REDIRECT_URI` | Under bygget `http://localhost:3011/auth/callback`, eftersom vhost och certifikat inte finns ännu. Google tillåter loopback utan https. Byt till driftsadressen när `deploy/` är installerad — båda adresserna kan stå registrerade samtidigt. |

**OAuth-klienten är återanvänd.** Den skapades 2024-12-20 för `elysia.smutje.se`, som är nedlagd,
och används nu av den här appen. Den har `https://sport.smutje.se` som *Authorized JavaScript
origin* och `https://sport.smutje.se/auth/callback` som *Authorized redirect URI*. En tidigare klient
i samma projekt (`…-cbdrk498…`) skapades för sport men togs aldrig i bruk: den saknade
omdirigeringsadress och hade en hemlighet som inte matchade. Den kan raderas i konsolen.

Två detaljer som inte är kosmetiska: Googles visningsnamn escapas innan det hamnar i HTML, och
miljön läses när funktionerna anropas — en halvfärdig `.env` ger då en begriplig sida som räknar upp
vad som saknas, i stället för att processen dör i en import.

---

## 7. Datamodell

Två saker styr modellen: **flödesdata ägs av föreningen** och skrivs över vid varje hämtning, och
**våra egna val ägs av oss** och får aldrig skrivas över. De ligger i skilda tabeller, länkade via
händelsens `UID`.

```sql
CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  google_id     TEXT NOT NULL UNIQUE,
  email         TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  roll          TEXT NOT NULL DEFAULT 'barn',   -- 'foralder' | 'barn'
  skapad_at     TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at  TEXT
);

-- Ett flöde = en lagkalender hos en förening, kopplad till ett barn.
CREATE TABLE feeds (
  id              TEXT PRIMARY KEY,          -- 'sbbk-p14', 'saif-ib-p12'
  child           TEXT NOT NULL,             -- 'Barn 1', 'Barn 2'
  sport           TEXT NOT NULL,             -- 'bandy', 'innebandy', 'fotboll', 'scout'
  club            TEXT NOT NULL,             -- 'SBBK', 'Södra Ängby', 'Hammarby'
  label           TEXT NOT NULL,             -- 'SBBK P14 bandy'
  color           TEXT NOT NULL,             -- '#1d4ed8'
  url             TEXT NOT NULL,             -- https:// (webcal:// byts vid insättning)
  aktiv           INTEGER NOT NULL DEFAULT 1,
  samling_monster TEXT,                      -- egen regex, null = standard
  etag            TEXT,
  last_modified   TEXT,
  last_fetch_at   INTEGER,                   -- epoch ms
  last_status     TEXT,                      -- 'ok' | 'fel' | 'oförändrad'
  last_error      TEXT,
  fel_i_rad       INTEGER NOT NULL DEFAULT 0,
  UNIQUE (child, club, sport, label)
);

-- Kända platser. Utan dem går restid inte att räkna, och utan restid går krock inte att räkna.
CREATE TABLE platser (
  id            INTEGER PRIMARY KEY,
  namn          TEXT NOT NULL,               -- 'Brommahallen'
  normaliserat  TEXT NOT NULL UNIQUE,        -- 'brommahallen'
  adress        TEXT,
  lat           REAL,
  lon           REAL,
  kommentar     TEXT
);

CREATE TABLE events (
  uid            TEXT NOT NULL,              -- flödets UID, oförändrat
  feed_id        TEXT NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
  fingerprint    TEXT NOT NULL,              -- för dedupe över flöden
  titel          TEXT NOT NULL,
  beskrivning    TEXT,
  plats_text     TEXT,                       -- råtext ur LOCATION
  plats_id       INTEGER REFERENCES platser(id),
  start_ms       INTEGER NOT NULL,           -- UTC
  slut_ms        INTEGER NOT NULL,
  heldag         INTEGER NOT NULL DEFAULT 0,
  ics_status     TEXT,                       -- CONFIRMED | TENTATIVE | CANCELLED
  samling_ms     INTEGER,                    -- null = okänt
  samling_kalla  TEXT,                       -- 'regex' | 'manuell' | null
  motstandare    TEXT,
  hemmamatch     INTEGER,
  ar_flerdygn    INTEGER NOT NULL DEFAULT 0,
  missing_since  INTEGER,                    -- satt när UID:t försvunnit ur flödet
  forst_sedd     INTEGER NOT NULL,
  senast_sedd    INTEGER NOT NULL,
  PRIMARY KEY (feed_id, uid)
);

CREATE INDEX events_start ON events(start_ms);
CREATE INDEX events_fp ON events(fingerprint);

-- Våra egna val. Nycklas mot UID, inte mot rad-id, så att de överlever nästa hämtning.
CREATE TABLE overrides (
  feed_id          TEXT NOT NULL,
  uid              TEXT NOT NULL,
  dold             INTEGER NOT NULL DEFAULT 0,   -- 'Deltar ej'
  ansvarig_typ     TEXT NOT NULL DEFAULT 'ingen',-- 'ingen'|'person'|'samakning'|'egen'
  ansvarig_user_id INTEGER REFERENCES users(id),
  anteckning       TEXT,
  samling_ms       INTEGER,                      -- manuell rättning av samlingen
  updated_by       INTEGER REFERENCES users(id),
  updated_at       INTEGER NOT NULL,
  PRIMARY KEY (feed_id, uid)
);

-- Historik för felsökning: varje hämtning, även de som misslyckades.
CREATE TABLE fetch_runs (
  id         INTEGER PRIMARY KEY,
  feed_id    TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ms         INTEGER NOT NULL,
  status     TEXT NOT NULL,
  antal      INTEGER,
  fel        TEXT
);
```

Fyra detaljer som inte är kosmetiska:

- **`missing_since` i stället för `DELETE`.** En händelse som försvinner ur flödet markeras, och
  först efter två hämtningar i rad sätts `ics_status = 'CANCELLED'`. Då ser ni *inställt* i stället
  för att passet bara är borta — vilket är den vanligaste verkliga händelsen i ungdomsidrott.
- **`overrides` överlever allt.** En tränare som byter tid eller plan ändrar oftast inte `UID`. När
  `UID` ändras tappas överstyrningen, och det är rätt: det är en ny händelse. Det ska stå i
  gränssnittet.
- **`ansvarig_typ` + `ansvarig_user_id`** i stället för en namnsträng: då följer namnet med om
  Förälder 2 byter visningsnamn, och `samakning`/`egen` är egna tillstånd, inte varianter av "ingen".
- **`fingerprint`** = `hash(normaliserad titel + start_ms + slut_ms + normaliserad plats)`. Samma
  match i två flöden ger samma fingerprint och visas **en** gång, med båda barnens chip.

---

## 8. Krockmodellen

Det här är appens kärna, och den enda delen som måste vara rätt innan gränssnittet byggs.

### 8.1 Intervallet är samling till slut, inte avspark till slut

Ett pass upptar familjens tid från **samlingen**, och resan dit ligger före den. Alltså:

```
upptagen från = COALESCE(samling_ms, start_ms) − restid_till_platsen
upptagen till = slut_ms
```

Barn 1 har samling 09:15 på Kärrtorps IP, match 10:00. Barn 2 har samling 09:30 på
Äppelviksskolan, matchstart 10:15. Matcherna startar med 15 minuters mellanrum och överlappar nästan inte alls — men
Kärrtorp till Äppelviken ger **30 minuter** i modellen (10,2 km fågelväg × 1,4 vid 30 km/h, avrundat
uppåt). Det är en krock **även om matcherna inte överlappade**,
och en modell som bara jämför `start_ms`–`slut_ms` hade missat den.

Saknas samlingen används `start_ms`, och kortet visar då ingen samlingstid. Att anta "15 minuter
innan" är en gissning som leder till att man kommer för sent.

### 8.2 Platser och restid

- `plats_text` normaliseras: gemener, `plan 2`, `hallen`, `IP`, `BK` och skiljetecken skalas bort.
  Träffar det en rad i `platser` sätts `plats_id`; annars lämnas det tomt och platsen köas i
  inställningsvyn som `Ny plats — ange adress`.
- **Restid** mellan två kända platser: haversine × 1,4 (väg i stället för fågelväg), avrundat
  **uppåt** till närmaste 5 minuter. Farten trappas efter avstånd: **30 km/h** upp till 15 km
  (stadstrafik, korsningar, parkering), **50 km/h** upp till 50 km, **75 km/h** däröver. En enda
  fart fungerar inte — 30 km/h mellan två hallar i Bromma är rimligt, 30 km/h till Karlstad ger elva
  timmar i stället för fyra och en halv. Ingen trafikdata, inget API.
- **Samma plats:** restid 0, och två pass på samma ställe är **ingen** krock även om tiderna
  överlappar. En förälder kan stå i samma hall.
- **Okänd plats:** `restid = null`. Då beräknas ingen transportkrock, och kortet visar `plats
  saknas`. Hellre tyst än fel när någon ska hinna lämna.

### 8.3 Tre utfall

| Utfall | Villkor | Visning |
|---|---|---|
| `tidskrock` | intervallen överlappar, olika platser | `⚠ Krock med Barn 2 18:15` |
| `transportkrock` | glappet är mindre än restiden | `⚠ 15 min mellan, 25 min resa` |
| `ingen krock` | samma plats, eller glapp ≥ restid | inget |

Krocken räknas **på servern** och skickas färdig med varje händelse. Att räkna i klienten är den
sortens logik som blir olika i tre vyer.

### 8.4 Vad som räknas som olöst

En krock är **olöst** tills logistiken skiljer passen åt:

| Pass A | Pass B | Krocken är |
|---|---|---|
| ingen ansvarig | ingen ansvarig | olöst |
| Förälder 1 | Förälder 2 | löst |
| Förälder 1 | Förälder 1 | olöst |
| `Samåkning` | vad som helst | löst |
| `Egen transport` | vad som helst | löst |

Bara **olösta** krockar tänder varningstriangeln i månaden. En triangel som lyser även efter att
någon tagit ansvar blir permanent brus och slutar betyda något.

Krockar mellan två pass för **samma barn** (samma barn i två sporter samtidigt) räknas som
`tidskrock` — barnet kan inte vara på två ställen — men badge-texten blir `⚠ Dubbelbokat`.

---

## 9. Hämtning och tolkning

### 9.1 Hämtaren

- `setInterval` var 15:e minut, plus 0–60 s jitter så att alla flöden inte slår samtidigt.
- Sekventiellt med 3 s mellanrum: sex flöden är inget att stressa, och föreningarnas servrar ska
  inte belastas.
- `< 15 s` timeout, `< 5 MB` storlek, `User-Agent: sport.smutje.se/1.0 (+kontaktadress)`.
  Adress- och storlekskontrollen återanvänds från `class.smutje.se/backend/src/utils/urlGuard.ts`
  (SSRF-skydd: inga privata adresser, inga redirects, hård gräns).
- `If-None-Match` / `If-Modified-Since` när servern gett `ETag` / `Last-Modified`. `304` → noll
  arbete, vilket är det vanliga fallet.
- Vid fel: `fel_i_rad` räknas upp, backoff 15 → 30 → 60 → 120 minuter, och flödet flaggas i
  gränssnittet när `last_fetch_at` är äldre än 24 timmar (`SBBK-flödet har inte svarat sedan igår
  21:10`). Tysta fel är värre än högljudda.
- Den råa texten sparas per flöde i `data/raw/<feed>.ics` (bara senaste). Utan den går ett
  tolkningsfel inte att återskapa när föreningen hunnit ändra flödet.
- Manuell uppdatering: `POST /api/refresh`, med 60 s spärr.

### 9.2 Tolkaren

Med `node-ical`, och de fall som bevisligen dyker upp:

| Fall | Hantering |
|---|---|
| Radbrytning i fält (RFC 5545 §3.1) | `node-ical` vecklar upp. Testas med fixture. |
| `TZID` | Spara **UTC ms** + zonenamn, rendera alltid i `Europe/Stockholm`. Okänd `TZID` → logga och använd Stockholm, aldrig tyst UTC. |
| `VALUE=DATE` (heldag) | `heldag = 1`, `slut_ms` sätts till dagens slut. |
| `RRULE` | Expandera bara inom fönstret `[nu − 30 d, nu + 400 d]`. Utan gräns kan en veckoserie bli tusentals rader. `EXDATE` respekteras. |
| `RECURRENCE-ID` | Ersätter den expanderade instansen med samma `UID` + tid. |
| `STATUS:CANCELLED`, `METHOD:CANCEL` | `ics_status = 'CANCELLED'`; kortet visas överstruket. |
| `SUMMARY` som `Träning P14`, `Match mot Hammarby IF` | `motstandare` via regex per flöde; `hemmamatch` avgörs av om platsen matchar hemmahallen. |
| SvenskaLag: `DESCRIPTION:Samling: Kärrtorps IP, kl 16:00` | Platsen står **mellan** ordet och tiden. Mönstret måste tillåta upp till 60 tecken där, och ett andra mönster ankrat på `kl` för att kunna hoppa över ett datum före tiden. |
| SvenskaLag: `cal.svenskalag.se/<id>.ics` | Svarar `200` med `X-WR-CALNAME:Borttaget` och **noll händelser**. Rätt adress är `cal.svenskalag.se/<id>` utan ändelse. |
| Dubbletter mellan flöden | `fingerprint`, avsnitt 7. |
| Felkodat (UTF-8 vs Latin-1) | Läs som UTF-8, fall tillbaka på `windows-1252` om `�` förekommer. |

Sporten kommer från flödeskonfigurationen, inte från `SUMMARY`: texten innehåller oftast lagets namn
och ibland inget alls.

### 9.3 En adress, flera lag

Föreningens kalender är **gemensam**. Det skakande flödet från SBBK innehöll fyra lagkoder och båda
sporterna i samma `.ics`:

| Lagkod | Händelser | Sport i titeln |
|---|---|---|
| `F2013` | 36 | 21 utan sportord (bandy), 15 `Extra Träning innebandy` |
| `F2016` | 23 | — |
| `U2015` | 11 | — |
| utan kod | 16 | `Träning - SBBK Flickor`, `Tävling - SBBK Flickor` |

Alltså kan **ett flöde ge flera barn och flera sporter**, och en händelse hör inte hemma i flödet
utan i laget. Modellen är därför:

- `lag(kode, barn, sport, klubb, monster)` mappar lagkoden till barn, sport och **förening**.
  `barn` får vara tomt, vilket betyder "ärv källans barn" — rätt för en gemensam lagkalender.
- `events.lag` plockas ur titeln med `lagUrTitel()`, som känner igen `F2016`, `P2015` och `U2015`.
- `events.sport_titel` sätts när titeln själv anger sporten (`sportUrTitel()`), och vinner över
  lagets standard. Det är den enda rimliga vägen när samma lagkod har både bandy och innebandy.
- Upplösningen blir `sport_titel → lag.sport → flödes.sport`, `lag.barn → feed_barn`, och
  `lag.klubb → källans klubb endast om källan har högst en klubb`. Sportadmins flöde har två
  (Södra Ängby IF och SBBK), alltså ärvs ingen klubb där — pass utan lagkod visas utan förening.
- API:t tar `?barn=Barn 1,Barn 2` och filtrerar på den upplösta barnkoden.

Ett flöde vars titlar saknar lagkod faller tillbaka på flödets barn och sport. Det ska synas i
inställningarna vilka händelser som saknar lag, inte gissas.

### 9.4 Ett tomt flöde är ett fel, inte en tom kalender

SvenskaLag svarar `200` med `X-WR-CALNAME;VALUE=TEXT:Borttaget` och noll händelser — både för en
kalender som tagits bort och för en giltig kalenderadress med `.ics` påklistrat. Utan skydd skulle lagringen tolka det som att *alla* händelser försvunnit, och
efter två hämtningar ställa in hela kalendern. Därför: **noll tolkade händelser sparas aldrig**, och
hämtningen räknas som misslyckad med orsaken i `last_error`.

### 9.5 Samlingstid — konfigurerbart, inte gissat

1. Varje flöde har ett eget mönster i `feeds.samling_monster` (null = standard).
2. Standardmönstret letar efter `samling` följt av en tid (`14:45`, `14.45`) eller ett intervall
   (`samling 45 min innan`), och räknar i så fall bakåt från `start_ms`.
3. Utan träff sätts `samling_ms = NULL`, och kortet visar **inget**.
   Samma sak om tiden ligger **mer än tre timmar före** passet: en samling fyra timmar innan är
   ett datafel i inlämningen, inte en samling, och den skulle dessutom blockera fyra timmar i
   krockmodellen. Skarpt fall: `Samling: 13:30` på en träning som börjar 17:30.
4. Vid osäkerhet kan samlingen rättas manuellt (`overrides.samling_ms`), och då står det
   `Samling 09:15 (rättad)` så att det syns att uppgiften inte är föreningens.

### 9.5 Fältet heter `olost`, inte `lost`

Krocken bar först fältet `lost`, som går att läsa som engelska *förlorad* men betydde svenska
*olöst* — och `ärLost()` returnerade `true` när krocken **kvarstod**. Beteendet var konsekvent inne i
koden, men namnet gick att läsa baklänges, och exemplet i det här dokumentet påstod `false` för en
krock som i själva verket var olöst. Nu heter fältet `olost` och funktionen `ärOlöst()`, med
innebörden skriven i kommentaren: `true` betyder att ingen logistik skiljer passen åt.

### 9.6 Vad det skarpa flödet visade — mätt 2026-10-29

Ett riktigt Sportadmin-flöde (bandy, P16) hämtades och kördes genom `bun run granska`. Siffrorna
styrde tre beslut i koden:

| Mätning | Resultat | Följd |
|---|---|---|
| Händelser | 86, spann 29 sep – 30 dec | Bara framåt. Ingen historik att städa. |
| `TZID` | `Europe/Stockholm` på alla | Ingen `Europe/Berlin`-fälla i det här flödet. |
| `DESCRIPTION` med `Samling: HH:MM` | 75 av 86 | Regexen fungerar som standardmönster. |
| …varav samlingen **lika med starttiden** | 13 | `likaStart` → visas inte. Kortet visar redan starttiden, och en rad som upprepar den är brus. |
| Kvar med riktig samling | 62 (72 %) | Resten får `samling_ms = NULL`. |
| `LOCATION` satt | 86 av 86 | Restid går att räkna för alla pass — när platserna har koordinater. |
| `RRULE` | 0 | Serier förekommer inte i det här flödet, men stöds (se nedan). |
| `STATUS:CANCELLED` | 0 | Inställda pass dyker inte upp här, men måste hanteras när de gör det. |

Två fällor som bara syntes mot verklig data:

1. **`node-ical` expanderar inte `RRULE` i `recurrences`.** Den egenskapen innehåller bara de
   instanser som flyttats med `RECURRENCE-ID`. En serie läst så blir **en enda** händelse. Rätt väg
   är `event.rrule.between(från, till, true)`, och den flyttade instansen slås upp på sin
   ursprungliga förekomsttid. Instansens uid blir `bas#förekomsttid`, alltså den ursprungliga tiden
   och inte den flyttade — annars tappar en flyttad träning sitt skjutsansvar.
2. **UID innehåller en punkt** (`16000001-2742@sportadmin.se`). En SPA-fallback som avgör "är det
   en fil?" på en punkt i sista segmentet svarar 404 på varje pass-sida. Regeln är i stället: en
   fil med känd ändelse som inte finns är 404, allt annat är appskalet. Det finns ett test.

Flödet anger **15 okända platser** som behöver koordinater innan restid och krockar fungerar mot
riktig data: `angby ip`, `brotorpshallen`, `grimstahallen`, `gubbangens`, `kampetorpshallen`,
`karlstad`, `klubbhuset`, `laroverkets bp solna`, `riddersvikshallen hasselby`, `spanga`,
`stora mossen`, `torsviks`, `trakvistavallen ekero`, `ulvsunda c`, `viksjovallen`.

`granska` visar samma sak för varje nytt flöde, och skriver aldrig ut namn om man inte ber om det
med `--namn`.

---

## 10. API

Allt utom `/auth/*`, `/manifest.webmanifest`, ikoner och `/sw.js` kräver inloggning. Svar i JSON,
fel som `{ "fel": "..." }` med rätt statuskod.

| Rutt | Metod | Roll | Funktion |
|---|---|---|---|
| `/auth/login` | GET | — | Omdirigering till Google med state-cookie |
| `/auth/callback` | GET | — | Kodbyte, allowlist, sessionscookie |
| `/auth/logout` | GET | alla | Rensar cookie |
| `/api/events` | GET | alla | `?from=&to=&children=&sports=&feeds=&includeHidden=` |
| `/api/events/:feed/:uid` | GET | alla | Ett pass, för `/pass`-sidan |
| `/api/overrides/:feed/:uid` | PATCH | förälder | `dold`, `ansvarig`, `anteckning`, `samling_ms` |
| `/api/feeds` | GET | alla | Flöden med hälsostatus |
| `/api/feeds/:id` | PATCH | förälder | `aktiv`, `color`, `samling_monster`, `url` |
| `/api/feeds/:id/test` | POST | förälder | Hämta och tolka en adress **utan** att spara; svarar `12 händelser, första 14 nov` |
| `/api/platser` | GET/PATCH | förälder | Normalisering, adress, koordinater |
| `/api/refresh` | POST | förälder | Hämta nu, 60 s spärr |
| `/api/pass/:feed/:uid.ics` | GET | alla | `.ics` för ett enskilt pass, som nedladdning |
| `/api/export/:token.ics` | GET | token | Ren prenumerationskalender per person |
| `/api/halsa` | GET | — | `{ ok, feeds: [{id, last_fetch_at, last_status}] }` |

`/api/events` gör `LEFT JOIN overrides`, beräknar krockar för intervallet och returnerar färdiga
kort:

```json
{
  "id": "sbbk-p14|match-88213",
  "titel": "Match mot Hammarby IF",
  "sport": "bandy",
  "barn": ["Barn 1"],
  "klubb": "SBBK",
  "farg": "#1d4ed8",
  "start": "2026-11-14T09:00:00.000Z",
  "slut": "2026-11-14T11:00:00.000Z",
  "plats": "Kärrtorps IP",
  "samling": "2026-11-14T08:15:00.000Z",
  "samlingKalla": "regex",
  "motstandare": "Hammarby IF",
  "status": "CONFIRMED",
  "dold": false,
  "ansvarig": { "typ": "person", "namn": "Förälder 2" },
  "anteckning": "termos + svarta shorts",
  "krock": {
    "typ": "transport",
    "mot": ["saif-ib-p12|sammandrag-4411"],
    "restidMin": 30,
    "glappMin": 15,
    "olost": true
  },
  "floden": ["sbbk-p14"]
}
```

Svaret ETag-märks och cachas i klienten per intervall. Veckovyn hämtar en vecka, månadsvyn en
månad. Budget: under ~80 kB gzip för en månad med sex flöden, annars blir första laddningen på 4G
seg.

---

## 11. Från pass till kalender

Två vägar, i den ordningen:

**Nu: `.ics` för ett enskilt pass.** `Lägg i kalendern` hämtar
`/api/pass/:feed/:uid.ics` med `Content-Disposition: attachment`. Filen innehåller passet, och när
samlingen är känd läggs den som en andra `VEVENT` med `RELATED-TO`, så att både `Samling 09:15` och
`Match 10:00` hamnar som egna rader i telefonens kalender. Ett tryck, ingen Google-nyckel, ingen
token att läcka, fungerar offline.

**Senare: Google Calendar API.** `Skicka till min kalender` med `calendar.events` ger omedelbar
insättning, till skillnad från en prenumeration (Google hämtar `.ics` långsamt — det gäller även
vårt eget). Scopet är känsligt hos Google men fungerar för eget bruk med testkonton. Det byggs i
fas 9, efter att allt annat står still.

**Prenumeration per person:** `/api/export/<token>.ics` ger ett flöde med bara de pass personen
skjutsar på eller inte tackat nej till. Länken läggs in i Google Kalender som vanlig prenumeration,
och är det som gör de vanliga kalendrarna användbara igen. Token är `HMAC(person_id)` och kan
återkallas genom att `EXPORT_SECRET` roteras.

---

## 12. Gränssnittet

### 12.1 Principer

1. **Mobilen först, tummen först.** Allt interaktivt ligger i nedre halvan eller i bottennav.
   Minsta träffyta 44 × 44 px, `env(safe-area-inset-bottom)` respekteras.
2. **En vy, ett svar.** Veckan svarar på "vad gör vi nu", månaden på "när är cupen", passet på
   "berätta allt om det här".
3. **Tid är viktigast.** Tiden står först på varje kort, i `tabular-nums` så att kolumnen linjerar.
4. **Färg betyder barn, inte sport.** Ett barn kan ha fyra sporter. Klubben står som text.
5. **Inget gömt.** En gest är ingen knapp. Alla val finns i en meny som syns.
6. **Text under 12 px förekommer inte.** Samma golv som i `class.smutje.se/DESIGN.md`.
7. **Hellre tyst än fel.** Saknas plats eller samling visas inget, aldrig en gissning.

### 12.2 Skalet

Header 52 px (namn, inloggad person, kugghjul), innehåll, bottennav med tre flikar. Chips under
headern i vecko- och månadsvyn. Ingen sökruta i MVP; chipsen räcker.

Kortet:

```
┌────────────────────────────────────┐
│▌15:30–17:00  Träning P14           │  ▌ = barnets färg, 4 px
│  SBBK · Brommahallen plan 2        │
│  Samling 15:15   [Förälder 2]       ⋯   │
└────────────────────────────────────┘
```

`[Förälder 2]` är `Ansvarig`-knappen: den visar nuvarande värde och öppnar arket. Ett tryck, inte upp
till fyra. `⋯` öppnar samma ark.

Kortet i sin helhet går till `/pass/<id>`, men **inlineknapparna måste vinna över kortets
klickyta** (`stopPropagation`), annars stjäl navigationen tryck från kontrollerna. Det är den
vanligaste buggen i kortbaserade mobilgränssnitt.

### 12.3 Arket

Från botten, inte modal i mitten: *Deltar ej* (växla), *Ansvarig* (Ingen · Förälder 1 · Förälder 2 ·
Samåkning · Egen transport), *Anteckning*, *Lägg i kalendern*, *Öppna i Sportadmin*, *Rätta
samlingstid*, *Visa passet*.

Ansvarigändringen skrivs direkt och visar `Förälder 2 ändrade för 2 min sedan`, så att den andra
föräldern ser att valet är fattat och av vem.

### 12.4 Designtokens

Återanvänds från `class.smutje.se/frontend/tailwind.config.ts` (HSL-variabler i `:root`) i stället
för nya hexvärden:

| Roll | Värde |
|---|---|
| `--background` / `--foreground` | 0 0% 100% / 222 47% 11% |
| `--page` | 210 20% 98% (sidbakgrund, skiljer korten) |
| `--muted-foreground` | 215 16% 47% (sekundärtext, lägsta godkända kontrast) |
| `--border` | 214 32% 91% |
| `--primary` | 221 83% 53% |
| `--destructive` | 0 72% 51% (inställt, krock) |
| Barn 1 | `#1d4ed8` |
| Barn 2 | `#b45309` |

Färgerna är valda för kontrast mot vitt, inte för att vara vackra, och de ska klara 4,5:1 mot
`--page`.

Typografi: systemstack (`-apple-system, Segoe UI, Roboto…`) så att appen känns inbyggd och startar
utan fontnedladdning. Rollerna `titel 15/600`, `tid 15/700 tabular-nums`, `brödtext 14/400`,
`meta 12/500`. Mörkt läge via `prefers-color-scheme` i fas 6 — tokens finns redan, så det är
billigt, men det får inte fördröja MVP.

### 12.5 PWA

- `manifest.webmanifest`: `display: standalone`, `theme_color`, `background_color`, ikoner
  192/512 + maskable, `start_url: /`, `scope: /`.
- `sw.js`: cachar appskalet med versionsnyckel; API-svar cachas *network-first* med fallback till
  senaste svaret, så att veckan går att läsa i tunnelbanan.
- Ingen aggressiv cache för `/api/*`: en inställd träning får aldrig ligga kvar som aktuell bara
  för att den finns i cachen. Cachade svar märks med tidsstämpel i statusraden
  (`Offline – visar data från 14:40`).
- iOS kräver "Lägg till på hemskärmen" för helskärm och för web push (16.4+).

---

## 13. Testdata och demoläge

Gränssnittet ska kunna byggas, granskas och jämföras innan de riktiga flödena finns.

- **Fixtures** i `app/test/fixtures/`: sparade, anonymiserade svar från Sportadmin och SvenskaLag,
  ett per leverantör, plus påhittade varianter. De ska innehålla det fula:
  - ett inställt pass (`STATUS:CANCELLED`)
  - ett pass som bara försvunnit ur flödet (testas som frånvaro mellan två körningar)
  - en dubblett mellan barnets flöde och lagets
  - ett pass utan `LOCATION`
  - ett pass utan samling i texten
  - en `RECURRENCE-ID`-flyttad träning
  - en vecka som spänner över ett årsskifte (ISO-vecka 1)
- **`bun run seed`** fyller en demdatabas med två flöden, Barn 1 och Barn 2, tre veckor framåt och
  en krock på lördagen (Barn 1:s match på Kärrtorps IP 10:00, samling 09:15; Barn 2:s sammandrag i
  Äppelviksskolan 10:15, samling 09:30). Samma data används i testerna, så att gränssnittet och
  krockmodellen aldrig kan glida ifrån varandra.
- **Mock-växel i `api.ts`**: `VITE_MOCK=1` serverar fixtures i stället för `/api/*`, med samma
  JSON-form. Prototypfasen bygger alltså den **riktiga** frontend, inte en slit-och-släng-demo.
- Seed-datan är påhittad men formad efter leverantörernas fält. När de riktiga flödena kopplas in i
  fas 5 ska `seed` kunna köras mot en tom databas utan att något i gränssnittet ändras.

---

## 14. Säkerhet och personuppgifter

- Barnens namn, scheman och skjutsansvar är personuppgifter. De stannar på egen server i hemmet,
  utan tredjepartsanalys, utan externa typsnitt och utan CDN.
- All trafik över HTTPS (certbot), HTTP omdirigeras.
- Hemligheter bara i gitignorerad `.env`: `SESSION_SECRET`, `GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET`, `REDIRECT_URI`, `ALLOWED_EMAILS`, `EXPORT_SECRET`, `PORT`.
- Loggar innehåller flödes-id och statuskoder, aldrig hela URL:er med tokens eller barnens namn.
- Flödesadresserna kan innehålla en hemlig nyckel. De ligger i databasen, returneras aldrig till
  klienten och visas maskerade i inställningarna.
- Apache sätter säkerhetsrubriker:

```apache
Header always set X-Content-Type-Options "nosniff"
Header always set Referrer-Policy "strict-origin-when-cross-origin"
Header always set X-Frame-Options "DENY"
Header always set Permissions-Policy "geolocation=(), microphone=(), camera=()"
Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains"
Header always set Content-Security-Policy "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'"
```

`style-src 'unsafe-inline'` behövs för Reacts inline-stilar. Går det att undvika med ett bygge utan
inline-stilar ska det göras; annars dokumenteras undantaget i den här filen.

---

## 15. Drift

### 15.1 Systemd

`/etc/systemd/system/sport.smutje.se.service` — samma form som `batar.service`:

```ini
[Unit]
Description=Familjekalender sport.smutje.se (Bun)
After=network.target

[Service]
User=pi
Group=pi
WorkingDirectory=/var/www/sport.smutje.se/app
EnvironmentFile=/var/www/sport.smutje.se/.env
ExecStart=/home/pi/.nvm/versions/node/v26.0.0/bin/bun run src/index.ts
Restart=always
RestartSec=3
PrivateTmp=true
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

### 15.2 Förberett i `deploy/`

Driftkonfigurationen ligger i git men installeras av root: `sport.smutje.se.conf` (80),
`sport.smutje.se-le-ssl.conf` (443), `sport.smutje.se.service` och ett idempotent
`installera.sh` som gör allt och kontrollerar varje steg. **Installerat 2026-10-29**, och
`deploy/README.md` beskriver både kommandona och vad som redan är gjort.

Två val som skiljer sig från `bun.smutje.se` och `prov.smutje.se`:

- **`certbot certonly --webroot`, inte `certbot --apache`.** Apache-plugin skriver om vhosten vid
  varje förnyelse, och då kan säkerhetsrubrikerna och proxyinställningarna försvinna tyst. Med
  webroot ägs `-le-ssl.conf` av oss, och `Alias` + `ProxyPass … !` ser till att utmaningen når fram
  förbi proxyn.
- **Tjänsten kör utan `--watch`.** Under utveckling körs `bun run dev` för hand, på 3011 eller en
  annan port.

### 15.3 Apache

`sport.smutje.se.conf` (port 80: ACME + omdirigering) och `sport.smutje.se-le-ssl.conf` (443).
Formen kopieras från `prov.smutje.se`, som redan har rätt tre detaljer: `ProxyPreserveHost`,
`RequestHeader set X-Forwarded-Proto "https"` **i 80-filen** så att den överlever en ny
certbot-körning, och `<Location /.well-known/acme-challenge/>` efter proxyn.

```apache
<VirtualHost *:443>
    ServerName sport.smutje.se

    ProxyPreserveHost On
    ProxyTimeout 120
    ProxyPass / http://127.0.0.1:3011/
    ProxyPassReverse / http://127.0.0.1:3011/

    RequestHeader set X-Forwarded-Proto "https"

    <Location /.well-known/acme-challenge/>
        Require all granted
    </Location>

    # säkerhetsrubriker enligt avsnitt 14

    ErrorLog ${APACHE_LOG_DIR}/sport.smutje.se-error.log
    CustomLog ${APACHE_LOG_DIR}/sport.smutje.se-access.log combined

    SSLCertificateFile /etc/letsencrypt/live/sport.smutje.se/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/sport.smutje.se/privkey.pem
    Include /etc/letsencrypt/options-ssl-apache.conf
</VirtualHost>
```

`mod_proxy`, `mod_proxy_http`, `mod_headers`, `mod_rewrite`, `mod_ssl` är redan aktiverade. DNS för
`sport.smutje.se` pekar redan på 84.217.99.67; vhost och certifikat saknas.

### 15.4 Certifikat

```bash
sudo certbot --apache -d sport.smutje.se
sudo apache2ctl configtest && sudo systemctl reload apache2
sudo certbot renew --dry-run
```

### 15.5 Deploy

```bash
cd /var/www/sport.smutje.se/frontend && bun install && bun run build   # → app/public/
cd ../app && bun run typecheck && bun test
sudo systemctl restart sport.smutje.se
curl -s -o /dev/null -w "%{http_code}\n" https://sport.smutje.se/vecka
```

Ingen containerombyggnad. Frontendbygget hamnar i `app/public/`, som Bun serverar statiskt med
`no-cache` för `index.html` och lång cache för hashade tillgångar. Under utveckling körs
`bun run dev` i `frontend/` på port 5173, med `/api` och `/auth` proxade till tjänsten på 3011.

### 15.6 Backup

- Nattlig `VACUUM INTO '/var/www/sport.smutje.se/data/backup/sport-YYYY-MM-DD.sqlite'` (atomiskt
  även med WAL), 14 dagar kvar.
- `data/raw/*.ics` veckovis — små filer som gör tolkningsfel återskapbara.
- Återställningen provas **en gång** innan appen tas i bruk: kopiera filen, starta om, kontrollera
  att veckan visar samma sak.
- Koden i git med `.gitignore` för `.env`, `data/`, `node_modules/`, `public/`.

### 15.7 Övervakning

`/api/halsa` svarar med flödenas status. En kontroll larmar om något flöde inte hämtats på 24
timmar. Utan den upptäcks felet genom att en träning saknas — och då är det för sent.

---

## 16. Test och verifiering

Ingen webbläsarautomatisering (Chromium/Playwright) används. Verifieringen sker i tre lager, plus
att du tittar själv:

1. **`bun test`** i `app/`:
   - tolken mot fixtures: heldag, `TZID`, `RRULE` + `EXDATE`, `RECURRENCE-ID`, `CANCELLED`,
     radbrytning, Latin-1-fallback.
   - samlingsregex mot verkliga beskrivningstexter, inklusive de som **inte** ska ge träff.
   - ISO-vecka vid årsskiftet: `v.1`, `v.53`, veckans start på måndag, och att
     `Aktuell vecka`/`Nästa vecka` ger rätt intervall i december och januari.
   - krockmodellen: överlapp, angränsande, glapp mindre än restid, samma plats, okänd plats,
     samma barn, olika barn, och de fem fallen i avsnitt 8.4.
   - restid: haversine mot kända avstånd, avrundning uppåt till 5 minuter.
   - `fingerprint` och dedupe över två flöden.
   - sammanslagning `events` + `overrides`, inklusive att en försvunnen händelse blir *inställd*.
   - sessionscookie: signering, manipulerad cookie, utgången cookie, fel `state`, roll utan
     skrivrätt, en adress utanför allowlist, och att Googles visningsnamn escapas.
   - appskalet: att `/pass/...` med punkt i uid ger appskalet och inte 404, att `/api/*` utan kaka
     ger `401` och inte en HTML-sida, och att `/auth/login` skickar rätt `redirect_uri` och
     `state`-kaka. Körs med `app.handle()` — samma anrop som proxyn gör, ingen webbläsare.
2. **`bun run typecheck`** — `tsc --noEmit`, `strict`, noll fel.
3. **Rökprov mot körande server** med `curl` för varje rutt, inklusive 401 utan cookie, 403 med
   e-post utanför allowlist, 403 när `barn` försöker skriva, och att `/pass/...` svarar med
   appskalet. En ny rutt ska anropas en gång, inte bara typkontrolleras — typkontrollen ser inte
   SQL, och det misstaget har kostat mest arbete i grannprojekten.
4. **Du tittar själv** i din webbläsare och på din telefon: 360 px, tumträffar, hemskärm, offline,
   tidsaxelns brytpunkt vid 640 px, att `Ansvarig` inte stjäl klick från kortet, och att back
   stänger `/pass`-sidan.

---

## 17. Genomförande i faser

Varje fas är användbar eller verifierbar när den är klar.

| Fas | Innehåll | Klart när | Tid |
|---|---|---|---|
| **0** | ~~Samla flödesadresserna, verifiera format, spara fixtures~~ **Klar 2026-10-29:** Sportadmin-flödet hämtat och granskat, anonymiserade fixtures med kantfall skrivna, `.env` med konton och nycklar, `.gitignore`, `AGENTS.md`, `package.json`, `tsconfig` | `bun run granska` mot det skarpa flödet visar 86 av 86 händelser | 0,5 d |
| **1** | ~~Appskal, databas med schema, `/api/halsa`~~ **Klar:** Elysia, SQLite i WAL, SPA-fallback med test som fångar punkt-fällan, Google-inloggning med `state`, allowlist, roller och 90 dagars sessionskaka. `/api/halsa` bakom inloggning | `curl` ger `302` till Google med rätt `redirect_uri`, `401` utan kaka, `403` vid fel `state` | 1 d |
| **2** | ~~Tolken, samlingen, `tid.ts`, `platser.ts`, `krock.ts`~~ **Klar:** tolken, samlingen, platserna, restiden, krockfallen och ISO-veckorna, med tester. Kvar: hämtaren med ETag och backoff, `missing_since`, dedupe mot databasen | `bun test` grönt | 1,5 d |
| **3** | API: händelser med intervall och ETag, överstyrningar med roller, flödesstatus, `/pass`-rutt | `curl` ger rätt JSON för en vecka och en månad | 0,5 d |
| **4** | ~~Frontend mot mock~~ **Klar, men mot riktigt API i stället för mock:** router, skal, vecka med båda lägena, månad med grid och veckonummer, `/pass`-sida, ansvarigark, chips, inställningar med flöden/lag/barn/platser. Bygget är 261 kB (79 kB gzip) | `https://sport.smutje.se/vecka` visar riktiga pass; tidsaxeln syns först från 640 px | 2,5 d |
| **5** | Koppla på riktigt API, logistikval med namn, inställningsvy med flödestest, platshantering | Båda föräldrarna ser samma val efter omladdning på olika enheter | 1,5 d |
| **6** | PWA: manifest, service worker, offline, tomma lägen, statusrad, mörkt läge | Appen startar från hemskärmen i helskärm och visar cachad vecka offline | 1 d |
| **7** | ~~Drift: systemd, Apache, certbot, säkerhetsrubriker~~ **Klar 2026-10-29:** `deploy/` med vhostar, unit och `installera.sh`. Certifikat till 2027-01-27, förnyelse provad med `renew --dry-run`. Kvar: nattlig backup med återställningsprov | `https://sport.smutje.se` svarar 200/401/200 efter omstart av tjänsten | 0,5 d |
| **8** | `.ics` per pass med samling, prenumeration per person, "öppna i Sportadmin" | Ett pass hamnar i telefonens kalender med två rader, samling och match | 0,5 d |
| **9** | *Senare, om det känns värt det:* Google Calendar API, web push, barnens egna konton | — | — |

Summa till och med fas 8: **cirka 9 arbetsdagar**, varav hälften tolkning, krockmodell och
gränssnitt.

---

## 18. Risker

| Risk | Sannolikhet | Effekt | Motmedel |
|---|---|---|---|
| Flödesadresserna roterar (token byts) | Medel | Tyst tomt flöde | Hälsokontroll + flagga i gränssnittet efter 24 h |
| `UID` innehåller tidsstämpel och ändras varje hämtning | Låg–medel | Dubbletter, tappade överstyrningar | Upptäcks i fas 2; då blir nyckeln `feed_id + fingerprint` |
| Platserna stavas olika i flödena | Hög | Ingen restid, ingen krock | Normalisering + manuell platskoppling i inställningarna, med kön `Ny plats` |
| Samlingstiden står inte i `DESCRIPTION` | Hög | Kortet visar ingen samling | Manuell rättning; ingen gissning |
| Restidsuppskattningen är för optimistisk | Medel | Man kommer för sent | Haversine × 1,4 vid 30 km/h och avrundning **uppåt** |
| Tidsaxeln blir oläslig på mobil | Medel | Värdelös vy | Kravet från 640 px, testat i fas 4 |
| Skolans kontopolicy blockerar barnens inloggning | Medel | Barnen kan inte logga in | Rollen är valfri; appen fungerar på föräldrarnas enheter |
| Google hämtar vår export långsamt | Hög | "Skicka till kalender" känns trög | `.ics`-nedladdning i MVP, API i fas 9 |
| Appen blir "ännu en kalender" som ingen öppnar | Låg | Projektet dör | Veckan är startvy, PWA på hemskärmen, export till vanliga kalendern |

---

## 19. Beslut

| Fråga | Beslut |
|---|---|
| Skriva in hela ändringslistan i planen | Ja, hela listan |
| Tidsaxeln i veckovyn | Endast från 640 px; mobilen får 7-dagarsöversikten. Veckodagarna horisontellt, tiden lodrätt |
| Pass-detaljens adress | Egen sida `/pass/<feed>/<uid>`, inte ark eller query-parameter |
| Ansvarigs namn | Förälder 1 och Förälder 2 |
| Inloggning | Båda föräldrarna har egna Google-konton; barnens inloggning är valfri och ger läsläge |
| Konton | Två `foralder`: Förälder 1 och Förälder 2. Adresserna ligger i `.env`, aldrig i den här filen |
| Barnens konton | Inga tills vidare. Rollen `barn` finns i modellen men används inte ännu |
| OAuth-publicering | Testing-läge med de två kontona som testanvändare, inte Publicerad |
| `/api/halsa` | Bakom inloggning. Övervakning sker med en kaka, inte med en öppen rutt |
| Sessionskaka | 90 dagar, `HttpOnly; Secure; SameSite=Lax`, signerad med `SESSION_SECRET` |
| Drift | Apache-vhost 80/443 + certbot (`certonly --webroot`), systemd `sport.smutje.se.service`, port 3011 |
| Google-kontoval | `prompt=select_account`, så att delad enhet kan byta konto |
| Startvy | Vecka, som öppnar på idag |
| Månadsvy i stället för säsongsvy | Ja, med flerdygnsrad ovanför rutnätet |
| Bottennav | Tre flikar: Vecka · Månad · Mer |
| Kalenderknapp i MVP | `.ics`-nedladdning per pass; Google Calendar API i fas 9 |
| Serverkod i gränssnittet | Nej. Koden ligger i git och dokumenteras här |

---

## 20. Vad som inte byggs

- Ingen årsmatris. Månadsvyn täcker behovet, flerdygnsraden tar cuperna.
- Ingen egen kalender där vi lägger in saker manuellt, förutom en anteckning på ett pass.
- Ingen chatt, inga kommentarstrådar, ingen närvarorapportering till föreningarna.
- Ingen tvåvägssynk mot Sportadmin eller SvenskaLag. De äger sina data; vi läser dem.
- Ingen serverkod i appens gränssnitt.
- Ingen Cloudflare, ingen extern databas, ingen analys, inga kakor utöver sessionscookien.
