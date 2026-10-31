/**
 * Delar källkoden i ett antal textfiler, för att klistras in i en annan AI.
 *
 *   bun run app/verktyg/dela.ts            tio delar i del/
 *   bun run app/verktyg/dela.ts --delar 6  valfritt antal
 *
 * Varje fil börjar med `==> sökväg <==` följt av innehållet, samma form som de utdrag som redan
 * använts. Delarna balanseras efter storlek, så att en del inte blir 90 % av allt.
 *
 * `.env` ingår aldrig: den innehåller OAuth-hemligheten och familjens adresser. Inte heller
 * bygget, databasen, beroendena eller de här utdragen själva.
 */
import { readdirSync, readFileSync, statSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, relative, extname } from "node:path";

const ROT = join(import.meta.dir, "..", "..");
const UT = join(ROT, "del");

const delarArg = process.argv.indexOf("--delar");
const ANTAL = delarArg > -1 ? Number(process.argv[delarArg + 1]) : 10;
if (!Number.isInteger(ANTAL) || ANTAL < 1 || ANTAL > 40) {
  console.error("--delar måste vara ett heltal 1–40.");
  process.exit(1);
}

/** Filer som aldrig delas: hemligheter, bygge, data och utdragen själva. */
const UTESLUTNA_KATALOGER = new Set([
  "node_modules",
  ".git",
  "public",
  "data",
  "del",
  "dist",
  "cache",
  "logs",
]);

const UTESLUTNA_FILER = new Set([".env", "bun.lock", "bun.lockb", ".DS_Store"]);

/** Textfiler värt att granska. Bilder och lås lämnas utanför. */
const TILLÅTNA = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".css",
  ".sql",
  ".json",
  ".md",
  ".sh",
  ".conf",
  ".html",
  ".webmanifest",
  ".service",
  ".ics",
]);

interface Fil {
  väg: string;
  text: string;
  byte: number;
}

function samla(katalog: string, ut: Fil[]): void {
  for (const namn of readdirSync(katalog).sort()) {
    const full = join(katalog, namn);
    const rel = relative(ROT, full);

    if (UTESLUTNA_FILER.has(namn)) continue;
    if (namn.startsWith("ts_") && namn.endsWith(".txt")) continue;

    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (UTESLUTNA_KATALOGER.has(namn)) continue;
      samla(full, ut);
      continue;
    }

    if (!TILLÅTNA.has(extname(namn))) continue;
    // En .env i en underkatalog är också en hemlighet.
    if (namn === ".env" || namn.startsWith(".env.") && namn !== ".env.example") continue;

    const text = readFileSync(full, "utf-8");
    ut.push({ väg: rel, text, byte: stat.size });
  }
}

const filer: Fil[] = [];
samla(ROT, filer);
filer.sort((a, b) => a.väg.localeCompare(b.väg, "sv"));

// Största filen först, ned i den del som är minst just nu. Det ger jämna delar utan att en
// enda stor fil tvingar fram en nästan tom sista del.
const högar: Fil[][] = Array.from({ length: ANTAL }, () => []);
const storlek = new Array<number>(ANTAL).fill(0);

for (const fil of [...filer].sort((a, b) => b.byte - a.byte)) {
  let minst = 0;
  for (let i = 1; i < ANTAL; i++) if (storlek[i]! < storlek[minst]!) minst = i;
  högar[minst]!.push(fil);
  storlek[minst] = storlek[minst]! + fil.byte + fil.väg.length + 10;
}

rmSync(UT, { recursive: true, force: true });
mkdirSync(UT, { recursive: true });

const bredd = String(ANTAL).length;
const rader: string[] = [];

for (const [i, hög] of högar.entries()) {
  if (hög.length === 0) continue;
  hög.sort((a, b) => a.väg.localeCompare(b.väg, "sv"));

  const namn = `del-${String(i + 1).padStart(bredd, "0")}.txt`;
  const innehåll = hög.map((f) => `==> ${f.väg} <==\n${f.text.trimEnd()}\n`).join("\n");
  writeFileSync(join(UT, namn), innehåll, "utf-8");

  rader.push(
    `  ${namn}  ${String(hög.length).padStart(2)} ${hög.length === 1 ? "fil " : "filer"}  ${(innehåll.length / 1024).toFixed(1).padStart(6)} kB`
  );
}

const totalt = högar.reduce((s, h) => s + h.length, 0);
const byte = storlek.reduce((s, b) => s + b, 0);

console.log(`\nDelade ${totalt} filer (${(byte / 1024).toFixed(0)} kB) i ${ANTAL} delar:\n`);
for (const rad of rader) console.log(rad);
console.log(`\nLigger i ${relative(ROT, UT)}/ — klistra in en del i taget.`);
console.log("Filen .env ingår aldrig.\n");
