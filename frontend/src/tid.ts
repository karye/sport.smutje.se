/**
 * Tid och veckor i klienten.
 *
 * Servern äger sanningen om tidszonen; hit kommer bara epoch-ms. Det som behövs lokalt är
 * formatering och ISO-veckans gränser för navigeringen. Reglerna är desamma som i
 * `app/src/tid.ts`, och det är avsiktligt en liten dubblering: att importera serverns modul i
 * bundlen hade dragit in SQLite och hela tolkningen i klienten.
 */

export const ZON = "Europe/Stockholm";

const DATUM = new Intl.DateTimeFormat("sv-SE", { timeZone: ZON });
const VECKODAG = new Intl.DateTimeFormat("sv-SE", { timeZone: ZON, weekday: "long" });
const VECKODAG_KORT = new Intl.DateTimeFormat("sv-SE", { timeZone: ZON, weekday: "short" });
const TID = new Intl.DateTimeFormat("sv-SE", { timeZone: ZON, hour: "2-digit", minute: "2-digit" });
const MÅNAD = new Intl.DateTimeFormat("sv-SE", { timeZone: ZON, month: "long", year: "numeric" });

const delarAv = (ms: number) => {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: ZON,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(ms));
  const tal = (typ: string): number => Number(p.find((x) => x.type === typ)?.value ?? 0);
  return { år: tal("year"), månad: tal("month"), dag: tal("day"), timme: tal("hour") % 24, minut: tal("minute") };
};

export const klockslag = (ms: number): string => TID.format(new Date(ms));

/**
 * Dagens siffra i månaden, läst i Stockholm.
 *
 * `new Date(ms).getUTCDate()` ger föregående dag så fort lokal midnatt ligger på 22:00 UTC dagen
 * innan — alltså hela vinterhalvåret. Det gjorde att månadsrutnätet visade 30 där det stod 1.
 */
export const dagINumma = (ms: number): number =>
  Number(new Intl.DateTimeFormat("sv-SE", { timeZone: ZON, day: "numeric" }).format(new Date(ms)));

/** Månadens siffra 1–12, läst i Stockholm. */
export const månadINumma = (ms: number): number =>
  Number(new Intl.DateTimeFormat("sv-SE", { timeZone: ZON, month: "numeric" }).format(new Date(ms)));

/** Timme och minut som decimaltal, för att placera ett block i en tidsaxel. */
export function timmeFraktion(ms: number): number {
  const d = delarAv(ms);
  return d.timme + d.minut / 60;
}

export const veckodag = (ms: number): string => VECKODAG.format(new Date(ms));

export const veckodagKort = (ms: number): string => VECKODAG_KORT.format(new Date(ms)).replace(".", "");

export const datum = (ms: number): string =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: ZON, day: "numeric", month: "long" }).format(new Date(ms));

export const månadOchÅr = (ms: number): string => MÅNAD.format(new Date(ms));

/** Kalenderdagen som nyckel, tillexempel 2026-11-14. Används för att gruppera per dag. */
export const dagNyckel = (ms: number): string => DATUM.format(new Date(ms));

/** "Idag", "Imorgon" eller "lördag 14 november". */
export function dagEtikett(ms: number, nu = Date.now()): string {
  const d = dagNyckel(ms);
  if (d === dagNyckel(nu)) return "Idag";
  if (d === dagNyckel(nu + 86_400_000)) return "Imorgon";
  return `${veckodag(ms)} ${datum(ms)}`;
}

/* ------------------------------------------------------------------ ISO-veckor */

const dagtal = (ms: number): number => {
  const d = delarAv(ms);
  return Date.UTC(d.år, d.månad - 1, d.dag);
};

function vecka1Måndag(år: number): number {
  const fjärde = Date.UTC(år, 0, 4);
  const veckodag = new Date(fjärde).getUTCDay() || 7;
  return fjärde - (veckodag - 1) * 86_400_000;
}

export function isoVecka(ms: number): { år: number; vecka: number } {
  const dag = dagtal(ms);
  const vd = new Date(dag).getUTCDay() || 7;
  const torsdag = dag + (4 - vd) * 86_400_000;
  const år = new Date(torsdag).getUTCFullYear();
  return { år, vecka: 1 + Math.round((torsdag - vecka1Måndag(år)) / (7 * 86_400_000)) };
}

/** Veckans sju dagar, som epoch-ms vid lokal midnatt. */
export function veckansDagar(år: number, vecka: number): number[] {
  const måndag = vecka1Måndag(år) + (vecka - 1) * 7 * 86_400_000;
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(måndag + i * 86_400_000);
    return lokalMidnatt(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  });
}

/** Lokal midnatt i Stockholm som UTC-ms, utan tidszonsbibliotek. */
export function lokalMidnatt(år: number, månad: number, dag: number): number {
  const naiv = Date.UTC(år, månad - 1, dag, 0, 0);
  const offset = (ms: number): number => {
    const d = delarAv(ms);
    return Date.UTC(d.år, d.månad - 1, d.dag, d.timme, d.minut) - ms;
  };
  const första = offset(naiv);
  const ms = naiv - första;
  const andra = offset(ms);
  return andra === första ? ms : naiv - andra;
}

export function veckoSpann(år: number, vecka: number): { fran: number; till: number } {
  const dagar = veckansDagar(år, vecka);
  return { fran: dagar[0] ?? 0, till: (dagar[6] ?? 0) + 86_400_000 - 1 };
}

/** Månadsgridden: från måndagen i veckan som innehåller den 1:a till söndagen efter sista dagen. */
export function månadsSpann(år: number, månad: number): { fran: number; till: number; dagar: number[] } {
  const sistaDag = new Date(Date.UTC(år, månad, 0)).getUTCDate();
  const förstaDagtal = Date.UTC(år, månad - 1, 1);
  const sistaDagtal = Date.UTC(år, månad - 1, sistaDag);

  const förstaVeckodag = new Date(förstaDagtal).getUTCDay() || 7;
  const sistaVeckodag = new Date(sistaDagtal).getUTCDay() || 7;
  const start = förstaDagtal - (förstaVeckodag - 1) * 86_400_000;
  const slut = sistaDagtal + (7 - sistaVeckodag) * 86_400_000;

  // Stega i kalenderdagar via UTC och räkna om varje dag till lokal midnatt. Att addera 24 timmar
  // till en lokal midnatt gick fel i övergången till vintertid: dygnet är 25 timmar, nästa ruta
  // hamnade på 23:00 kvällen innan, och samma datum kom två gånger i rutnätet.
  const dagar: number[] = [];
  for (let d = start; d <= slut; d += 86_400_000) {
    const dt = new Date(d);
    dagar.push(lokalMidnatt(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()));
  }

  const dagenEfter = new Date(slut + 86_400_000);

  return {
    fran: dagar[0] ?? 0,
    till: lokalMidnatt(dagenEfter.getUTCFullYear(), dagenEfter.getUTCMonth() + 1, dagenEfter.getUTCDate()) - 1,
    dagar,
  };
}

/** "för 2 min sedan", "igår", "för 3 dagar sedan". Används för att visa vem som ändrade vad. */
export function sedan(ms: number, nu = Date.now()): string {
  const minuter = Math.round((nu - ms) / 60_000);
  if (minuter < 1) return "nyss";
  if (minuter < 60) return `för ${minuter} min sedan`;
  const timmar = Math.round(minuter / 60);
  if (timmar < 24) return `för ${timmar} tim sedan`;
  const dagar = Math.round(timmar / 24);
  return dagar === 1 ? "igår" : `för ${dagar} dagar sedan`;
}

export const ärSammaDag = (a: number, b: number): boolean => dagNyckel(a) === dagNyckel(b);

/**
 * "2026-11-14" + "09:15" → epoch-ms i Stockholm.
 *
 * Två steg, som på servern: förskjutningen beror av den tidpunkt vi ännu inte känner, så den
 * räknas om en gång. Utan det blir en rättad samlingstid fel när webbläsaren står i annan zon.
 */
export function tillStockholmMs(dag: string, tid: string): number | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dag);
  const t = /^(\d{1,2})[:.](\d{2})$/.exec(tid.trim());
  if (!d?.[1] || !d[2] || !d[3] || !t?.[1] || !t[2]) return null;

  const timme = Number(t[1]);
  const minut = Number(t[2]);
  if (timme > 23 || minut > 59) return null;

  const naiv = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), timme, minut);
  const offset = (ms: number): number => {
    const delar = new Intl.DateTimeFormat("en-US", {
      timeZone: ZON,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(new Date(ms));
    const tal = (typ: string): number => Number(delar.find((x) => x.type === typ)?.value ?? 0);
    return Date.UTC(tal("year"), tal("month") - 1, tal("day"), tal("hour") % 24, tal("minute")) - ms;
  };

  const första = offset(naiv);
  const ms = naiv - första;
  const andra = offset(ms);
  return andra === första ? ms : naiv - andra;
}

/** Google Kalenders tidsstämpel: 20261114T091500, alltså lokal tid utan zon. */
export function kalenderstämpel(ms: number): string {
  const d = delarAv(ms);
  const två = (n: number) => String(n).padStart(2, "0");
  return `${d.år}${två(d.månad)}${två(d.dag)}T${två(d.timme)}${två(d.minut)}00`;
}

export function månadFrånParam(param: string | undefined): { år: number; månad: number } {
  const träff = /^(\d{4})-(\d{1,2})$/.exec(param ?? "");
  if (träff?.[1] && träff[2]) return { år: Number(träff[1]), månad: Number(träff[2]) };
  const nu = delarAv(Date.now());
  return { år: nu.år, månad: nu.månad };
}
