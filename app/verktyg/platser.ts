/**
 * Slår upp flödets okända platser i OpenStreetMap och visar förslag.
 *
 *   bun run verktyg/platser.ts                 visa förslag, spara inget
 *   bun run verktyg/platser.ts --spara         spara de förslag som fick en träff
 *   bun run verktyg/platser.ts --flode <id>    välj flöde
 *
 * Bara anläggningsnamnen skickas till Nominatim, aldrig något om barnen. Ett anrop i sekunden,
 * enligt deras villkor, och en ärlig User-Agent med kontaktväg.
 */
import { db } from "../src/db.ts";
import { lasFloden, lasPlatser, type FlodeRad } from "../src/hamtare.ts";
import { hittaPlats, normaliseraPlats } from "../src/platser.ts";
import { tolkaFlode } from "../src/tolk.ts";
import { tillUtc } from "../src/tid.ts";
import type { Plats } from "../src/typer.ts";

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
// ASCII bara: non-ASCII i User-Agent ger 400/502 hos Sportadmin (Kestrel).
const UA = "sport.smutje.se/1.0 (+familjekalender)";

const argv = process.argv.slice(2);
const spara = argv.includes("--spara");

/**
 * --satt "Klubbhuset=59.3519,17.9122" lägger in en plats exakt. Används för namn som inte går att
 * slå upp: "Klubbhuset" kan ligga var som helst, och en gissning är värre än ingen restid alls.
 */
const satta = argv.includes("--satt") ? argv[argv.indexOf("--satt") + 1] : undefined;
const flodeIndex = argv.indexOf("--flode");
const valtId = flodeIndex >= 0 ? argv[flodeIndex + 1] : undefined;

/**
 * --koppla-om kopplar om alla sparade händelser mot platsregistret, utan att hämta flödena igen.
 * Behövs varje gång en plats läggs till: `events.plats_id` sätts vid tolkningen, inte vid läsning.
 */
if (argv.includes("--koppla-om")) {
  const platser = lasPlatser();
  const händelser = db
    .query<{ feed_id: string; uid: string; plats_text: string | null; plats_id: number | null }, []>(
      "SELECT feed_id, uid, plats_text, plats_id FROM events WHERE plats_text IS NOT NULL"
    )
    .all();

  let ändrade = 0;
  const kör = db.transaction(() => {
    for (const h of händelser) {
      const plats = hittaPlats(h.plats_text, platser);
      if ((plats?.id ?? null) !== h.plats_id) {
        db.run("UPDATE events SET plats_id = ? WHERE feed_id = ? AND uid = ?", [
          plats?.id ?? null,
          h.feed_id,
          h.uid,
        ]);
        ändrade++;
      }
    }
  });
  kör();

  const utan = db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM events WHERE plats_id IS NULL").get()?.n ?? 0;
  const alla = db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM events").get()?.n ?? 0;
  console.log(`Kopplade om ${händelser.length} händelser, ${ändrade} ändrades.`);
  console.log(`Utan känd plats: ${utan} av ${alla}. Kända platser: ${platser.length}.`);
  process.exit(0);
}

if (satta) {
  const [namn, koord] = satta.split("=");
  const delar = (koord ?? "").split(",");
  const lat = Number(delar[0]);
  const lon = Number(delar[1]);
  if (!namn || delar.length !== 2 || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    console.error('Format: --satt "Klubbhuset=59.3519,17.9122"');
    process.exit(1);
  }
  db.run(
    `INSERT INTO platser (namn, normaliserat, lat, lon) VALUES (?, ?, ?, ?)
     ON CONFLICT(normaliserat) DO UPDATE SET lat = excluded.lat, lon = excluded.lon`,
    [namn, normaliseraPlats(namn) || namn, lat, lon]
  );
  console.log(`Sparade ${namn} på ${lat}, ${lon}. Kända platser: ${lasPlatser().length}.`);
  process.exit(0);
}

const floden = lasFloden();
const flode: FlodeRad | undefined = valtId ? floden.find((f) => f.id === valtId) : floden[0];

if (!flode) {
  console.error("Inget flöde i databasen. Lägg till ett med verktyg/lagg-till-flode.ts.");
  process.exit(1);
}

const svar = await fetch(flode.url, {
  headers: { "User-Agent": UA },
  signal: AbortSignal.timeout(15_000),
  redirect: "error",
});
if (!svar.ok) {
  console.error(`Flödet svarade ${svar.status}`);
  process.exit(1);
}

const nu = Date.now();
const kända = lasPlatser();
const resultat = tolkaFlode(
  await svar.text(),
  { id: flode.id, label: flode.label, samling_monster: flode.samling_monster },
  { fran: nu - 30 * 86_400_000, till: nu + 400 * 86_400_000 },
  kända
);

if (resultat.okandaPlatser.length === 0) {
  console.log(`Alla ${kända.length} platser i flödet är redan kända.`);
  process.exit(0);
}

interface Förslag {
  namn: string;
  normaliserat: string;
  träff: { lat: number; lon: number; visning: string; nära: boolean; km: number } | null;
}

/** Stockholmstrakten. Första försöket söker bara här, så att "viksjovallen" inte blir en sjö i Dalarna. */
const HEM = { lat: 59.35193, lon: 17.91217 };
const VYBOX = "17.55,59.10,18.35,59.50";

function kmFrånHem(lat: number, lon: number): number {
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (lat - HEM.lat) * rad;
  const dLon = (lon - HEM.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(HEM.lat * rad) * Math.cos(lat * rad) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
}

async function slåUpp(namn: string, baraHemma: boolean): Promise<Förslag["träff"]> {
  const url = new URL(NOMINATIM);
  url.searchParams.set("q", namn);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "5");
  url.searchParams.set("countrycodes", "se");
  url.searchParams.set("accept-language", "sv");
  if (baraHemma) {
    url.searchParams.set("viewbox", VYBOX);
    url.searchParams.set("bounded", "1");
  }

  const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15_000) });
  const data = (await r.json()) as { lat?: string; lon?: string; display_name?: string }[];

  // Av flera kandidater väljs den som ligger närmast hemmet. "Ängby IP" finns både i Bromma och i
  // Täby kyrkby, och den som ligger 18 km bort är fel svar på frågan var barnen spelar.
  const kandidater = data
    .filter((d) => d.lat && d.lon)
    .map((d) => {
      const lat = Number(Number(d.lat).toFixed(5));
      const lon = Number(Number(d.lon).toFixed(5));
      return {
        lat,
        lon,
        visning: (d.display_name ?? "").split(",").slice(0, 2).join(",").trim(),
        nära: baraHemma,
        km: kmFrånHem(lat, lon),
      };
    })
    .sort((a, b) => a.km - b.km);

  return kandidater[0] ?? null;
}

const förslag: Förslag[] = [];

/**
 * Sökord att prova, i ordning. Flödet skriver "Ängby IP2", "Stora mossen 1" och
 * "Riddersvikshallen, Hässelby" — siffror och efterled förstör uppslaget.
 */
function sökord(namn: string): string[] {
  const utanKomma = namn.split(",")[0]?.trim() ?? namn;
  const utanSiffra = utanKomma.replace(/\s+\d+$/, "").replace(/([\p{L}])\d+$/u, "$1").trim();
  // Normaliserad stavning hjälper för "Ängby IP2", där OSM hittar rätt först utan prickar.
  const variant = new Set<string>([utanKomma, utanSiffra, normaliseraPlats(utanSiffra)]);
  const ord = utanSiffra.split(/\s+/);
  if (ord.length > 2) variant.add(ord.slice(0, -1).join(" "));
  return [...variant].filter(Boolean);
}

for (const [i, namn] of resultat.okandaPlatser.entries()) {
  if (i > 0) await Bun.sleep(1100);

  let träff: Förslag["träff"] = null;
  const ord = sökord(namn);

  try {
    // Först i Stockholmstrakten med alla stavningsvarianter, sedan fritt. Ett bortamatch i
    // Karlstad ska hittas, men "Viksjövallen" ska inte bli en sjö i Dalarna.
    for (const [j, sök] of ord.entries()) {
      if (j > 0) await Bun.sleep(1100);
      träff = await slåUpp(sök, true);
      if (träff) break;
    }
    if (!träff) {
      await Bun.sleep(1100);
      träff = await slåUpp(ord[ord.length - 1] ?? namn, false);
    }
  } catch (fel) {
    console.error(`  uppslag misslyckades för ${namn}: ${fel instanceof Error ? fel.message : fel}`);
  }

  förslag.push({ namn, normaliserat: normaliseraPlats(namn) || namn, träff });
  console.log(`  ${namn} → ${träff ? `${träff.visning} (${träff.km} km)` : "ingen träff"}`);
}

console.log(`\nOkända platser i ${flode.id}: ${förslag.length}\n`);
console.log("namn".padEnd(28), "förslag".padEnd(34), "km från Ängby IP", "lat, lon");
console.log("-".repeat(104));
for (const f of förslag) {
  const vänster = f.namn.padEnd(26);
  if (!f.träff) {
    console.log(vänster, "— ingen träff —");
    continue;
  }
  const koord = `${f.träff.lat}, ${f.träff.lon}`;
  const km = `${f.träff.km}${f.träff.nära ? "" : "  (utanför Stockholm)"}`;
  console.log(vänster, f.träff.visning.slice(0, 34).padEnd(34), km.padEnd(16), koord);
}

const utanTräff = förslag.filter((f) => !f.träff);
if (utanTräff.length > 0) {
  console.log(`\nUtan träff: ${utanTräff.map((f) => f.namn).join(", ")}`);
}

if (!spara) {
  console.log("\nInget sparat. Kör om med --spara för att lägga in förslagen, eller rätta dem först.");
  process.exit(0);
}

const infoga = db.prepare(
  "INSERT INTO platser (namn, normaliserat, lat, lon) VALUES (?, ?, ?, ?) ON CONFLICT(normaliserat) DO UPDATE SET lat = excluded.lat, lon = excluded.lon"
);

let antal = 0;
const kör = db.transaction(() => {
  for (const f of förslag) {
    if (!f.träff) continue;
    infoga.run(f.namn, f.normaliserat, f.träff.lat, f.träff.lon);
    antal++;
  }
});
kör();

const efter: Plats[] = lasPlatser();
console.log(`\nSparade ${antal}. Kända platser nu: ${efter.length}.`);
console.log("Kontrollera gärna koordinaterna på en karta innan de används för restid.");
