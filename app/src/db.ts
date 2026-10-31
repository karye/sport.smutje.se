/**
 * Databasen: bun:sqlite i WAL-läge.
 *
 * Samma mönster som prov.smutje.se. Tre PRAGMA är inte kosmetiska:
 *   WAL          läsare blockeras inte av skrivare
 *   busy_timeout en samtidig skrivning väntar i stället för att kasta
 *   foreign_keys SQLite har dem avstängda som standard
 */
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

export const DATA_DIR: string = process.env.DATA_DIR ?? join(import.meta.dir, "..", "data");
export const DB_PATH: string = process.env.DB_PATH ?? join(DATA_DIR, "sport.sqlite");

// Skyddsnät: en testkörning som glömt sätta DB_PATH ska inte migrera den skarpa databasen.
if (process.argv.includes("test") && !process.env.DB_PATH) {
  throw new Error("Testerna körs utan DB_PATH. Sätt DB_PATH överst i testfilen.");
}

mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(DB_PATH, { create: true });

db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA busy_timeout = 5000");
db.exec("PRAGMA foreign_keys = ON");
db.exec(await Bun.file(join(import.meta.dir, "schema.sql")).text());

/* ------------------------------------------------------------------ migreringar */

/**
 * Kolumner som tillkommit efter att databasen skapades. SQLite kan lägga till kolumner men inte
 * ta bort dem, så det här räcker: kör en gång, hoppa över om kolumnen redan finns.
 */
function saknadKolumn(tabell: string, kolumn: string): boolean {
  return !db
    .query<{ name: string }, []>(`PRAGMA table_info(${tabell})`)
    .all()
    .some((k) => k.name === kolumn);
}

function läggTill(tabell: string, kolumn: string, typ: string): void {
  if (saknadKolumn(tabell, kolumn)) db.exec(`ALTER TABLE ${tabell} ADD COLUMN ${kolumn} ${typ}`);
}

// Sporterna: en gång, med färger som går att skilja även med nedsatt färgseende.
// Rött är reserverat för inställt och olösta krockar, alltså används det inte här.
const SPORTFÄRGER: [string, string][] = [
  ["bandy", "#0e7490"],
  ["innebandy", "#7c3aed"],
  ["fotboll", "#15803d"],
  ["scout", "#57534e"],
  ["handboll", "#be185d"],
  ["basket", "#4338ca"],
  // Reservfärg för pass vars flöde saknar sport. Utan den blev pricken en tom ring.
  ["okänd", "#94a3b8"],
];
// Infogas varje start med INSERT OR IGNORE: nya standardfärger dyker upp, men en färg som
// användaren ändrat skrivs aldrig över.
for (const [namn, farg] of SPORTFÄRGER) {
  db.run("INSERT OR IGNORE INTO sport (namn, farg) VALUES (?, ?)", [namn, farg]);
}

// Migrering 0: ett flöde kunde bara gälla ett barn. Nu kan det gälla flera.
db.exec(`INSERT OR IGNORE INTO feed_barn (feed_id, barn) SELECT id, child FROM feeds WHERE child IS NOT NULL`);

// Migrering 1: föreningens kalender är gemensam, alltså hör laget till händelsen och inte till flödet.
läggTill("events", "lag", "TEXT");
// Migrering 2: en förening kan ha flera klubbar i samma flöde — Sportadmins samlingsflöde
// innehåller allt familjen är med i. Klubben hör därför till lagkoden.
läggTill("lag", "klubb", "TEXT");
// Migrering 3: lag som saknar kod i titeln ("SBBK Flickor") behöver en egen regel.
läggTill("lag", "monster", "TEXT");
/**
 * Migrering 5: klubben hör till laget, inte till flödet — och ett lag kan gälla källans barn.
 *
 * Sportadmins flöde innehåller två klubbar (Södra Ängby IF och SBBK). Att ärva klubben från
 * flödet gav SBBK på Södra Ängbys pass. `barn` måste samtidigt kunna vara NULL, eftersom en
 * gemensam kalender (Hammarbys Flickor Mellan) gäller flera barn — då ärvs de från feed_barn.
 *
 * SQLite kan inte lossa NOT NULL på en kolumn, alltså byggs tabellen om.
 */
function migreraLagKlubb(): void {
  const kolumner = db.query<{ name: string; notnull: number }, []>("PRAGMA table_info(lag)").all();
  const barnÄrObligatorisk = kolumner.some((k) => k.name === "barn" && k.notnull === 1);
  if (!barnÄrObligatorisk) return;

  db.exec(`
    CREATE TABLE lag_ny (
      kode    TEXT PRIMARY KEY,
      barn    TEXT,
      sport   TEXT NOT NULL,
      farg    TEXT,
      klubb   TEXT,
      kommentar TEXT,
      monster TEXT
    );
    INSERT INTO lag_ny (kode, barn, sport, farg, klubb, kommentar, monster)
      SELECT kode, barn, sport, farg, klubb, kommentar, monster FROM lag;
    DROP TABLE lag;
    ALTER TABLE lag_ny RENAME TO lag;
  `);
}
migreraLagKlubb();

// Migrering 4: ett flöde kan vara hela föreningens kalender. Då behövs ett filter per flöde.
läggTill("feeds", "filter_monster", "TEXT");
läggTill("events", "sport_titel", "TEXT");
