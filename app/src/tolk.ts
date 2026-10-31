/**
 * Tolken: iCalendar → normaliserade händelser.
 *
 * Byggd mot ett skarpt Sportadmin-flöde (86 händelser, 2026-10-29). Det flödet visade:
 *   DTSTART;TZID=Europe/Stockholm:20261103T180000   lokal tid med zon, inte UTC
 *   DESCRIPTION:Samling: 17:45                     75 av 86 har samlingen först i texten
 *   SUMMARY:Träning - P16 Bandy SBBK                laget i titeln, ingen sport
 *   SUMMARY:Match: SBBK P16 - Hammarby IF           motståndaren efter sista bindestrecket
 *   UID:15098835-2742@sportadmin.se                 stabil identifierare
 *   STATUS:CONFIRMED                                ingen RRULE där, men den kan komma
 *
 * Återkommande serier expanderas av `rrule`-objektet som node-ical lägger på händelsen, inte av
 * `recurrences` — den innehåller bara de instanser som flyttats med RECURRENCE-ID. Att lita på
 * `recurrences` ensam ger en serie som tyst består av en enda flyttad träning.
 */
import ical from "node-ical";
import { fingerprint } from "./dedupe.ts";
import { lagFor, type Lagregel } from "./lagmappning.ts";
import { hittaPlats } from "./platser.ts";
import { tolkaSamling } from "./samling.ts";
import { dagtal } from "./tid.ts";
import type { Flode, Handelse, IcsStatus, Plats } from "./typer.ts";

export interface TolkFonster {
  fran: number;
  till: number;
}

export interface TolkResultat {
  handelser: Handelse[];
  varningar: string[];
  /** Platsens egen text för platser som inte matchade registret. Ursprunglig stavning. */
  okandaPlatser: string[];
  antalInstallda: number;
  antalAterkommande: number;
  /** Händelser där texten anger en samling som är samma tid som starten. */
  antalSamlingLikStart: number;
  /** Händelser som sållades bort av flödets filter. */
  antalFiltrerade: number;
}

/** `rrule`-bibliotekets objekt, så mycket vi behöver av det. */
interface IcalRegel {
  between(a: Date, b: Date, inc: boolean): Date[];
}

/** node-ical:s komponenter är löst typade; vi beskriver bara det vi läser. */
interface IcalKomponent {
  type?: string;
  uid?: string;
  summary?: unknown;
  description?: unknown;
  location?: unknown;
  start?: Date;
  end?: Date;
  datetype?: string;
  status?: string;
  categories?: unknown;
  recurrenceid?: Date;
  recurrences?: Record<string, IcalKomponent>;
  exdate?: Record<string, Date>;
  rrule?: IcalRegel;
}

const somText = (v: unknown): string => {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && "val" in (v as Record<string, unknown>)) {
    return String((v as { val: unknown }).val ?? "");
  }
  return String(v);
};

const SPORTER = ["innebandy", "bandy", "fotboll", "handboll", "basket", "scout"] as const;

export { lagUrTitel } from "./lagmappning.ts";

/**
 * Sporten som titeln själv anger. Behövs för att föreningens kalender blandar bandy och innebandy
 * under samma lagkod: "Extra Träning innebandy - F2013" är innebandy, "Träning - F2013" bandy.
 */
export function sportUrTitel(titel: string): string | null {
  const t = titel.toLowerCase();
  for (const sport of SPORTER) if (t.includes(sport)) return sport;
  return null;
}

const somStatus = (v: string | undefined): IcsStatus => {
  const s = (v ?? "").toUpperCase();
  return s === "CANCELLED" || s === "TENTATIVE" ? s : "CONFIRMED";
};

/**
 * Motståndaren ur titeln, bara för matchhändelser.
 * `Match: SBBK P16 - Hammarby IF` → `Hammarby IF`. Sammandrag och träning ger null.
 */
export function motstandareUrTitel(titel: string): string | null {
  const t = titel.trim();
  if (!/^match\b/i.test(t)) return null;
  const delar = t.split(/\s[-–]\s/);
  const sista = delar.length > 1 ? delar[delar.length - 1]?.trim() : undefined;
  return sista && sista.length > 0 ? sista : null;
}

interface Instans {
  komponent: IcalKomponent;
  startMs: number;
  slutMs: number;
  uid: string;
}

/**
 * Händelsens instanser i fönstret.
 *
 * En serie får en instans per förekomst, med uid `bas#förekomsttid` — förekomsttiden och inte
 * den flyttade tiden, så att en flyttad träning behåller sitt uid och därmed sitt skjutsansvar.
 */
function instanserFor(komponent: IcalKomponent, fonster: TolkFonster): Instans[] {
  const start = komponent.start;
  if (!start || Number.isNaN(start.getTime())) return [];

  const bas = somText(komponent.uid).trim() || `utan-uid-${start.getTime()}`;
  const slut = komponent.end && !Number.isNaN(komponent.end.getTime()) ? komponent.end : start;

  if (!komponent.rrule) {
    return [{ komponent, startMs: start.getTime(), slutMs: slut.getTime(), uid: bas }];
  }

  const längd = slut.getTime() - start.getTime();

  const undantag = new Set<number>();
  for (const d of Object.values(komponent.exdate ?? {})) {
    if (d instanceof Date && !Number.isNaN(d.getTime())) undantag.add(d.getTime());
  }

  const flyttade = new Map<number, IcalKomponent>();
  for (const r of Object.values(komponent.recurrences ?? {})) {
    const id = r.recurrenceid;
    if (id instanceof Date && !Number.isNaN(id.getTime())) flyttade.set(id.getTime(), r);
  }

  let förekomster: Date[];
  try {
    förekomster = komponent.rrule.between(new Date(fonster.fran), new Date(fonster.till), true);
  } catch {
    return [];
  }

  return förekomster
    .filter((d) => !undantag.has(d.getTime()))
    .map((d) => {
      const flyttad = flyttade.get(d.getTime());
      if (flyttad?.start) {
        const s = flyttad.start.getTime();
        const sl = flyttad.end && !Number.isNaN(flyttad.end.getTime()) ? flyttad.end.getTime() : s + längd;
        return { komponent: flyttad, startMs: s, slutMs: sl, uid: `${bas}#${d.getTime()}` };
      }
      return { komponent, startMs: d.getTime(), slutMs: d.getTime() + längd, uid: `${bas}#${d.getTime()}` };
    });
}

/**
 * Tolkar ett flöde.
 *
 * `platser` används för att koppla platstexten till en känd anläggning. Tom lista är tillåtet:
 * då blir alla platser okända, vilket är precis vad `granska`-verktyget vill visa.
 */
export function tolkaFlode(
  icsText: string,
  flode: Pick<Flode, "id" | "label" | "samling_monster"> & { filter_monster?: string | null },
  fonster: TolkFonster,
  platser: readonly Plats[] = [],
  lagRegler: readonly Lagregel[] = []
): TolkResultat {
  const data = ical.sync.parseICS(icsText) as unknown as Record<string, IcalKomponent>;

  const handelser: Handelse[] = [];
  const varningar: string[] = [];
  const okanda = new Set<string>();
  let antalInstallda = 0;
  let antalAterkommande = 0;
  let antalSamlingLikStart = 0;
  let antalFiltrerade = 0;

  // Filtret matchas mot titel, beskrivning och kategori. Skutorna står till exempel bara i
  // beskrivningen i kårens kalender, aldrig i titeln.
  let filter: RegExp | null = null;
  if (flode.filter_monster) {
    try {
      filter = new RegExp(flode.filter_monster, "i");
    } catch {
      varningar.push(`Flödets filter "${flode.filter_monster}" är inte en giltig regex och används inte.`);
    }
  }

  for (const komponent of Object.values(data)) {
    if (komponent?.type !== "VEVENT") continue;

    // En instans som flyttats ligger som egen VEVENT med RECURRENCE-ID. Den läses via mästarens
    // `recurrences` och ska inte bli en egen händelse här.
    if (komponent.recurrenceid) continue;

    if (komponent.rrule) antalAterkommande++;

    for (const instans of instanserFor(komponent, fonster)) {
      const { startMs, slutMs } = instans;
      if (Number.isNaN(startMs) || Number.isNaN(slutMs)) {
        varningar.push(`Händelse utan giltig tid: ${somText(instans.komponent.summary).slice(0, 40)}`);
        continue;
      }

      // Fönstret: händelser som pågår in i fönstret tas med, även om de börjat före.
      if (slutMs < fonster.fran || startMs > fonster.till) continue;

      const k = instans.komponent;
      const titel = somText(k.summary).trim() || "(utan titel)";
      // Kod i titeln först, sedan lagets egen titelregel.
      const lagkod = lagFor(titel, lagRegler);
      const beskrivning = somText(k.description).trim() || null;
      const platsText = somText(k.location).trim() || null;
      const status = somStatus(k.status);
      if (status === "CANCELLED") antalInstallda++;

      if (filter) {
        const kategori = Array.isArray(k.categories)
          ? k.categories.join(" ")
          : somText(k.categories);
        const text = `${titel}\n${beskrivning ?? ""}\n${kategori}`;
        if (!filter.test(text)) {
          antalFiltrerade++;
          continue;
        }
      }

      const plats = hittaPlats(platsText, platser);
      if (platsText && !plats) okanda.add(platsText);

      const samling = tolkaSamling(beskrivning, startMs, flode.samling_monster);
      if (samling?.likaStart) antalSamlingLikStart++;

      handelser.push({
        feed_id: flode.id,
        uid: instans.uid,
        fingerprint: fingerprint(titel, startMs, slutMs, platsText),
        titel,
        lag: lagkod,
        sport_titel: sportUrTitel(titel),
        beskrivning,
        plats_text: platsText,
        plats_id: plats?.id ?? null,
        start_ms: startMs,
        slut_ms: slutMs,
        heldag: k.datetype === "date",
        ics_status: status,
        // En samling som är samma tid som starten visas inte: kortet visar redan starttiden.
        samling_ms: samling && !samling.likaStart ? samling.ms : null,
        samling_kalla: samling?.likaStart ? null : (samling?.kalla ?? null),
        motstandare: motstandareUrTitel(titel),
        hemmamatch: null,
        flerdygn: dagtal(startMs) !== dagtal(slutMs),
      });
    }
  }

  handelser.sort((a, b) => a.start_ms - b.start_ms);

  return {
    handelser,
    varningar,
    okandaPlatser: [...okanda].sort(),
    antalInstallda,
    antalAterkommande,
    antalSamlingLikStart,
    antalFiltrerade,
  };
}
