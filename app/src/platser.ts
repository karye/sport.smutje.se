/**
 * Platser och restid.
 *
 * Utan känd plats går restid inte att räkna, och utan restid går krockar mellan olika
 * anläggningar inte att räkna. Modellen är medvetet pessimistisk: fågelvägen gånger 1,4 vid
 * 30 km/h, avrundat uppåt till fem minuter. Ingen trafikdata, inget API, inga överraskningar.
 */
import type { Plats } from "./typer.ts";

export const VAGFAKTOR = 1.4;
export const AVSTRIDNING_MIN = 5;

/**
 * Medelfart i km/h, beroende på avstånd.
 *
 * En enda fart fungerar inte: 30 km/h är realistiskt mellan två hallar i Bromma och absurd för
 * en resa till Karlstad. Tre steg räcker — stadstrafik, förort till förort, och längre resa.
 * Siffrorna är medvetet försiktiga: hellre en varning i tid än en tyst miss.
 */
export function medelfartKmh(km: number): number {
  if (km <= 15) return 30;
  if (km <= 50) return 50;
  return 75;
}

/** Ord som beskriver del av anläggning, inte anläggningen. De skalas bort vid matchning. */
const DELAR = /\b(plan|planen|hallen|hall|idrottsplats|idrottshall|arena|arenan|ip|bk|if|ff|fc|sk|hk|aik|ais)\b/g;

/**
 * Normaliserar ett platsnamn för matchning: gemener, utan diakriter, utan delord och siffror.
 * `Brommahallen plan 2` och `Brommahallen` blir samma nyckel — det är hela poängen.
 */
export function normaliseraPlats(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(DELAR, " ")
    .replace(/[0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Hittar platsen i listan. Exakt träff först, sedan den mest specifika delsträngen, så att
 * `Kärrtorps IP` matchar `karrtorps` och `Äppelviksskolan idrottshall` matchar `appelviksskolan`.
 */
export function hittaPlats(text: string | null | undefined, platser: readonly Plats[]): Plats | null {
  if (!text) return null;
  const nyckel = normaliseraPlats(text);
  if (!nyckel) return null;

  for (const p of platser) if (p.normaliserat === nyckel) return p;

  let bästa: Plats | null = null;
  for (const p of platser) {
    if (!p.normaliserat) continue;
    if (!nyckel.includes(p.normaliserat) && !p.normaliserat.includes(nyckel)) continue;
    if (!bästa || p.normaliserat.length > bästa.normaliserat.length) bästa = p;
  }
  return bästa;
}

/** Fågelvägen i kilometer. */
export function avstandKm(a: Plats, b: Plats): number | null {
  if (a.lat == null || a.lon == null || b.lat == null || b.lon == null) return null;
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Restid i minuter, eller null när någon av platserna saknar koordinater.
 * Samma plats ger 0 — en förälder kan stå i samma hall.
 */
export function restidMinuter(a: Plats | null | undefined, b: Plats | null | undefined): number | null {
  if (!a || !b) return null;
  if (a.id === b.id) return 0;
  const km = avstandKm(a, b);
  if (km == null) return null;
  const minuter = ((km * VAGFAKTOR) / medelfartKmh(km)) * 60;
  return Math.ceil(minuter / AVSTRIDNING_MIN) * AVSTRIDNING_MIN;
}
