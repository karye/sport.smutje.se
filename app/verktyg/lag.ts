/**
 * Lagkod → barn och sport.
 *
 *   bun run verktyg/lag.ts                          visa mappningen
 *   bun run verktyg/lag.ts --kode U2015 --barn Barn 1 --sport bandy --farg "#1d4ed8"
 *   bun run verktyg/lag.ts --ta-bort U2015
 *
 * Föreningens kalender är gemensam, så det är lagkoden i titeln som avgör vems passet är. Ett flöde
 * kan därför ge både barn och båda sporterna, vilket är precis vad SBBK:s kalender gör.
 */
import { db } from "../src/db.ts";

interface Lag {
  kode: string;
  barn: string;
  sport: string;
  farg: string | null;
}

const argv = process.argv.slice(2);
const flagga = (namn: string): string | undefined => {
  const i = argv.indexOf(`--${namn}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const taBort = flagga("ta-bort");
if (taBort) {
  db.run("DELETE FROM lag WHERE kode = ?", [taBort.toUpperCase()]);
  console.log(`Tog bort ${taBort.toUpperCase()}.`);
}

const kode = flagga("kode");
if (kode) {
  const barn = flagga("barn");
  const sport = flagga("sport");
  if (!barn || !sport) {
    console.error("--kode kräver --barn och --sport.");
    process.exit(1);
  }
  db.run(
    `INSERT INTO lag (kode, barn, sport, farg) VALUES (?, ?, ?, ?)
     ON CONFLICT(kode) DO UPDATE SET barn = excluded.barn, sport = excluded.sport, farg = excluded.farg`,
    [kode.toUpperCase(), barn, sport, flagga("farg") ?? null]
  );
  console.log(`Sparade ${kode.toUpperCase()} → ${barn} / ${sport}.`);
}

const rader = db.query<Lag, []>("SELECT kode, barn, sport, farg FROM lag ORDER BY kode").all();
if (rader.length === 0) {
  console.log("Ingen mappning ännu. Exempel:");
  console.log('  bun run verktyg/lag.ts --kode U2015 --barn Barn 1 --sport bandy --farg "#1d4ed8"');
  process.exit(0);
}

console.log("\nlagkod   barn    sport        färg");
console.log("-".repeat(46));
for (const r of rader) console.log(`${r.kode.padEnd(8)} ${r.barn.padEnd(7)} ${r.sport.padEnd(12)} ${r.farg ?? "—"}`);

const utan = db
  .query<{ lag: string | null; n: number }, []>(
    "SELECT lag, COUNT(*) AS n FROM events WHERE lag IS NULL GROUP BY lag"
  )
  .get();
console.log(`\nHändelser utan lagkod i flödet: ${utan?.n ?? 0}. De visas med flödets barn och sport.`);
