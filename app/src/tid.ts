/**
 * Tidszon, ISO-veckor och svenska etiketter.
 *
 * Allt sparas som UTC-ms. Renderingen sker alltid i Europe/Stockholm. Ingen extern
 * tidszonsdatabas: `Intl` har redan rätt regler, och två konverteringar räcker.
 */

export const ZON = "Europe/Stockholm";

const DELAR = new Intl.DateTimeFormat("en-US", {
  timeZone: ZON,
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export interface Kalenderdelar {
  ar: number;
  manad: number;
  dag: number;
  timme: number;
  minut: number;
}

/** Lokala delar i Stockholm för en tidpunkt i UTC-ms. */
export function delar(ms: number): Kalenderdelar {
  const p = DELAR.formatToParts(new Date(ms));
  const tal = (typ: string): number => Number(p.find((x) => x.type === typ)?.value ?? 0);
  return {
    ar: tal("year"),
    manad: tal("month"),
    dag: tal("day"),
    // Intl ger 24:00 vid midnatt i vissa motorer.
    timme: tal("hour") % 24,
    minut: tal("minute"),
  };
}

/** Zonens förskjutning i ms vid en given tidpunkt. */
function zonsOffset(ms: number): number {
  const d = delar(ms);
  return Date.UTC(d.ar, d.manad - 1, d.dag, d.timme, d.minut) - ms;
}

/**
 * Stockholmstid → UTC-ms.
 *
 * Två steg, eftersom förskjutningen beror av den tidpunkt vi ännu inte känner. Andra steget
 * fångar övergången till och från sommartid.
 */
export function tillUtc(ar: number, manad: number, dag: number, timme: number, minut: number): number {
  const naiv = Date.UTC(ar, manad - 1, dag, timme, minut);
  const forsta = zonsOffset(naiv);
  const ms = naiv - forsta;
  const andra = zonsOffset(ms);
  return andra === forsta ? ms : naiv - andra;
}

/** Kalenderdagen som ett "dagtal" (midnatt UTC), för jämförelser oberoende av klockan. */
export function dagtal(ms: number): number {
  const d = delar(ms);
  return Date.UTC(d.ar, d.manad - 1, d.dag);
}

/** Måndagen i ISO-vecka 1 för ett år. */
export function vecka1Måndag(ar: number): number {
  const fjarde = Date.UTC(ar, 0, 4);
  const veckodag = new Date(fjarde).getUTCDay() || 7;
  return fjarde - (veckodag - 1) * 86400000;
}

/**
 * ISO-vecka och ISO-år. Vecka 1 är den vecka som innehåller första torsdagen, och veckan
 * börjar på måndag. Det är därför 2026-12-31 tillhör vecka 53 och 2027-01-01 vecka 53.
 */
export function isoVecka(ms: number): { ar: number; vecka: number } {
  const dag = dagtal(ms);
  const veckodag = new Date(dag).getUTCDay() || 7;
  const torsdag = dag + (4 - veckodag) * 86400000;
  const ar = new Date(torsdag).getUTCFullYear();
  return { ar, vecka: 1 + Math.round((torsdag - vecka1Måndag(ar)) / (7 * 86400000)) };
}

/** Intervallet för en ISO-vecka: måndag 00:00 till söndag 23:59:59.999, i UTC-ms. */
export function veckoIntervall(ar: number, vecka: number): { fran: number; till: number } {
  const måndagDag = vecka1Måndag(ar) + (vecka - 1) * 7 * 86400000;
  const m = new Date(måndagDag);
  const söndag = new Date(måndagDag + 6 * 86400000);
  const fran = tillUtc(m.getUTCFullYear(), m.getUTCMonth() + 1, m.getUTCDate(), 0, 0);
  const till = tillUtc(söndag.getUTCFullYear(), söndag.getUTCMonth() + 1, söndag.getUTCDate(), 23, 59) + 59999;
  return { fran, till };
}

/** Månadens intervall, för månadsvyn. `manad` är 1–12. */
export function manadsIntervall(ar: number, manad: number): { fran: number; till: number } {
  const sista = new Date(Date.UTC(ar, manad, 0)).getUTCDate();
  return { fran: tillUtc(ar, manad, 1, 0, 0), till: tillUtc(ar, manad, sista, 23, 59) + 59999 };
}

export const veckoEtikett = (vecka: number): string => `v.${vecka}`;

export const veckodagNamn = (ms: number): string =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: ZON, weekday: "long" }).format(new Date(ms));

export const datumEtikett = (ms: number): string =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: ZON, day: "numeric", month: "long" }).format(new Date(ms));

export const kortDatum = (ms: number): string =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: ZON, day: "numeric", month: "short" }).format(new Date(ms));

export const klockslag = (ms: number): string =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: ZON, hour: "2-digit", minute: "2-digit" }).format(new Date(ms));

export const manadsnamn = (ar: number, manad: number): string =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: ZON, month: "long" }).format(new Date(Date.UTC(ar, manad - 1, 15)));

/** Sant om två tidpunkter infaller på samma kalenderdag i Stockholm. */
export function sammaDag(a: number, b: number): boolean {
  return dagtal(a) === dagtal(b);
}
