/**
 * Lägger till eller uppdaterar ett flöde.
 *
 *   bun run verktyg/lagg-till-flode.ts \
 *     --id sbbk-p16-bandy --barn Barn 1 --sport bandy --klubb SBBK \
 *     --etikett "SBBK bandy P16" --farg "#1d4ed8" --url "https://…"
 *
 * Adressen skickas på kommandoraden och hamnar bara i databasen, aldrig i git. Den kan innehålla
 * en hemlig nyckel, och `GET /api/feeds` returnerar den aldrig till klienten.
 */
import { db } from "../src/db.ts";
import { hamtaFlode, lasFloden, lasPlatser } from "../src/hamtare.ts";

const flaggor = new Map<string, string>();
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (!arg?.startsWith("--")) continue;
  const namn = arg.slice(2);
  const varde = argv[i + 1];
  if (varde && !varde.startsWith("--")) {
    flaggor.set(namn, varde);
    i++;
  } else {
    flaggor.set(namn, "1");
  }
}

const kräv = (namn: string): string => {
  const v = flaggor.get(namn);
  if (!v) {
    console.error(`Saknar --${namn}. Se kommentaren överst i filen.`);
    process.exit(1);
  }
  return v;
};

const id = kräv("id");
const url = kräv("url").replace(/^webcal:\/\//i, "https://");

if (!/^https:\/\//i.test(url)) {
  console.error("Adressen måste vara https:// (webcal:// byts automatiskt).");
  process.exit(1);
}

db.run(
  `INSERT INTO feeds (id, child, sport, club, label, color, url, aktiv, samling_monster)
   VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
   ON CONFLICT(id) DO UPDATE SET
     child = excluded.child, sport = excluded.sport, club = excluded.club,
     label = excluded.label, color = excluded.color, url = excluded.url,
     samling_monster = excluded.samling_monster`,
  [
    id,
    kräv("barn"),
    kräv("sport"),
    kräv("klubb"),
    kräv("etikett"),
    flaggor.get("farg") ?? "#1d4ed8",
    url,
    flaggor.get("mall") ?? null,
  ]
);

// Flödets barn: en lista, eftersom en föreningskalender kan gälla syskon i samma lag.
const barnLista = (flaggor.get("barn") ?? "").split(",").map((b) => b.trim()).filter(Boolean);
db.run("DELETE FROM feed_barn WHERE feed_id = ?", [id]);
for (const b of barnLista) db.run("INSERT OR IGNORE INTO feed_barn (feed_id, barn) VALUES (?, ?)", [id, b]);

const flode = lasFloden().find((f) => f.id === id);
if (!flode) {
  console.error("Flödet kunde inte läsas tillbaka.");
  process.exit(1);
}

console.log(`Flöde ${id} sparat. Kända platser i databasen: ${lasPlatser().length}.`);

// --tvinga kastar ETag så att flödet tolkas om. Behövs när tolken ändrats: annars svarar
// Sportadmin 304 och de nya fälten fylls aldrig i.
if (flaggor.has("tvinga")) {
  db.run("UPDATE feeds SET etag = NULL, last_modified = NULL WHERE id = ?", [id]);
  // Objektet lästes före uppdateringen, alltså måste det också nollas här — annars skickas det
  // gamla ETag-värdet med och svaret blir 304 ändå.
  flode.etag = null;
  flode.last_modified = null;
  console.log("ETag nollställd, flödet hämtas om i sin helhet.");
}

const svar = await hamtaFlode(flode);
if (svar.status === "oforandrad") {
  console.log("Flödet svarade 304 — oförändrat sedan förra hämtningen. Använd --tvinga för att tolka om.");
} else if (svar.status === "ok") {
  console.log(`Första hämtningen: ${svar.antal} händelser på ${svar.ms} ms.`);
  const l = svar.lagring;
  if (l) console.log(`  nya ${l.nya} · uppdaterade ${l.uppdaterade} · borta ${l.borta} · inställda ${l.installda}`);
} else {
  console.error(`Hämtningen misslyckades: ${svar.fel ?? svar.status}`);
  process.exit(1);
}
