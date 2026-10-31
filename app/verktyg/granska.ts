/**
 * Granskar ett verkligt flöde innan det kopplas in.
 *
 *   bun run granska <flödesadress>            sammanställning, utan namn
 *   bun run granska <flödesadress> --namn     visar även de tio första titlarna
 *
 * Verktyget svarar på tre frågor som måste besvaras per flöde: hur många händelser, hur stor
 * andel har samling, och vilka platser är okända (de som ska ha koordinater).
 */
import { tolkaFlode } from "../src/tolk.ts";
import { klockslag, kortDatum, veckoEtikett, isoVecka } from "../src/tid.ts";

const url = process.argv[2];
const visaNamn = process.argv.includes("--namn");

if (!url) {
  console.error("Användning: bun run granska <flödesadress> [--namn]");
  process.exit(1);
}

const svar = await fetch(url, {
  headers: { "User-Agent": "sport.smutje.se/1.0 (granskning)" },
  signal: AbortSignal.timeout(15000),
  redirect: "error",
});

if (!svar.ok) {
  console.error(`Flödet svarade ${svar.status} ${svar.statusText}`);
  process.exit(1);
}

const text = await svar.text();
if (text.length > 5 * 1024 * 1024) {
  console.error("Flödet är större än 5 MB. Avbryter.");
  process.exit(1);
}

const nu = Date.now();
const resultat = tolkaFlode(
  text,
  { id: "granskning", label: "granskning", samling_monster: null },
  { fran: nu - 30 * 86400000, till: nu + 400 * 86400000 }
);

const antal = resultat.handelser.length;
const medSamling = resultat.handelser.filter((h) => h.samling_ms != null).length;
const medPlats = resultat.handelser.filter((h) => h.plats_text).length;
const medMotstandare = resultat.handelser.filter((h) => h.motstandare).length;
const heldag = resultat.handelser.filter((h) => h.heldag).length;
const flerdygn = resultat.handelser.filter((h) => h.flerdygn).length;
const procent = (n: number): string => (antal === 0 ? "0" : Math.round((n / antal) * 100) + " %");

console.log(`\nFlöde: ${url.replace(/id=.*/, "id=…")}`);
console.log(`Svar: ${svar.status} · ${(text.length / 1024).toFixed(0)} kB · etag=${svar.headers.get("etag") ?? "saknas"}`);
console.log(`Leverantörens eget antal: ${svar.headers.get("x-sa-event-count") ?? "anges inte"}`);
console.log(`Tolkade händelser i fönstret: ${antal}`);
console.log(`  med samlingstid: ${medSamling} (${procent(medSamling)})`);
console.log(`  samling i text men lika med starten: ${resultat.antalSamlingLikStart} (visas inte)`);
console.log(`  med plats:       ${medPlats} (${procent(medPlats)})`);
console.log(`  med motståndare: ${medMotstandare}`);
console.log(`  heldag: ${heldag} · flerdygn: ${flerdygn} · inställda: ${resultat.antalInstallda}`);
console.log(`  återkommande serier: ${resultat.antalAterkommande}`);

if (resultat.okandaPlatser.length > 0) {
  console.log(`\nOkända platser (${resultat.okandaPlatser.length}) — dessa ska ha koordinater i platser:`);
  for (const p of resultat.okandaPlatser) console.log(`  ${p}`);
}

const perVecka = new Map<string, number>();
for (const h of resultat.handelser) {
  const { ar, vecka } = isoVecka(h.start_ms);
  const nyckel = `${ar} ${veckoEtikett(vecka)}`;
  perVecka.set(nyckel, (perVecka.get(nyckel) ?? 0) + 1);
}
console.log("\nPer vecka:");
for (const [nyckel, n] of [...perVecka].sort()) console.log(`  ${nyckel}: ${"▮".repeat(n)} ${n}`);

const första = resultat.handelser[0];
const sista = resultat.handelser[antal - 1];
if (första && sista) {
  console.log(`\nSpann: ${kortDatum(första.start_ms)} ${klockslag(första.start_ms)} – ${kortDatum(sista.start_ms)}`);
}

if (resultat.varningar.length > 0) {
  console.log(`\nVarningar (${resultat.varningar.length}):`);
  for (const v of resultat.varningar.slice(0, 10)) console.log(`  ${v}`);
}

if (visaNamn) {
  console.log("\nTio första titlarna:");
  for (const h of resultat.handelser.slice(0, 10)) {
    const samling = h.samling_ms == null ? "ingen samling" : `samling ${klockslag(h.samling_ms)}`;
    console.log(`  ${kortDatum(h.start_ms)} ${klockslag(h.start_ms)}  ${h.titel}  (${samling})`);
  }
}
console.log();
