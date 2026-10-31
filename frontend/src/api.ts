/**
 * API-klienten. En plats som vet hur appen pratar med servern.
 *
 * Allt är same-origin med cookie, alltså ingen token i klienten. Ett 401 betyder att sessionen
 * gått ut, och då lämnas användaren tillbaka till inloggningssidan som servern ritar.
 */

export type Roll = "foralder" | "barn";

export interface Ansvarig {
  typ: "ingen" | "person" | "samakning" | "egen";
  user_id: number | null;
}

export interface Krock {
  typ: "tid" | "transport";
  mot: string[];
  glappMin: number;
  restidMin: number | null;
  olost: boolean;
  sammaBarn: boolean;
}

export interface Handelse {
  id: string;
  titel: string;
  lag: string | null;
  /** Ett pass kan gälla flera barn, till exempel syskon i samma lag. */
  barn: string[];
  sport: string;
  /** Sportens egen färg, som liten prick. Barnets färg är fortfarande listen på kortet. */
  sportFarg: string | null;
  /** Föreningen, från laget. Null när laget saknar klubb — då visas ingen, aldrig en gissning. */
  klubb: string | null;
  farg: string;
  start: number;
  slut: number;
  heldag: boolean;
  flerdygn: boolean;
  plats: string | null;
  platsKand: boolean;
  /** Alla inblandade barns färger. Fler än en när syskon delar pass. */
  fargLista: string[];
  /** Sant när flödet gäller flera barn och titeln saknar lagkod — passet räknas inte som krock. */
  omappad: boolean;
  samling: number | null;
  samlingKalla: string | null;
  motstandare: string | null;
  /** Bara på pass-sidan; listan skickar null för att hålla svaret litet. */
  beskrivning: string | null;
  status: string;
  dold: boolean;
  ansvarig: Ansvarig;
  ansvarigNamn: string | null;
  anteckning: string | null;
  /** Vem som senast ändrade något på passet, och när. */
  uppdateradAv: string | null;
  uppdaterad: number | null;
  krock: Krock | null;
}

export interface Händelsesvar {
  fran: number;
  till: number;
  handelser: Handelse[];
}

export interface Barn {
  namn: string;
  farg: string;
  sortering: number;
  antal: number;
}

export interface Vuxen {
  id: number;
  namn: string;
  epost: string;
  senast: string | null;
}

export interface Flode {
  id: string;
  barn: string;
  barnLista: string[];
  sport: string;
  /** Föreningen, från laget. Null när laget saknar klubb — då visas ingen, aldrig en gissning. */
  klubb: string | null;
  etikett: string;
  farg: string;
  aktiv: boolean;
  samlingMonster: string | null;
  /** Filter mot titel, beskrivning och kategori. Null = allt sparas. */
  filterMonster: string | null;
  vard: string;
  antal: number;
  senastHamtad: number | null;
  status: string | null;
  fel: string | null;
  felIRad: number;
}

export interface Sport {
  namn: string;
  farg: string;
  antal: number;
}

export interface Lag {
  kode: string;
  barn: string;
  sport: string;
  farg: string | null;
  /** Klubben för just den här lagkoden. Sportadmins flöde kan innehålla flera föreningar. */
  klubb: string | null;
  /** Titelregel för pass som saknar lagkod. */
  monster: string | null;
  antal: number;
}

export interface Plats {
  id: number;
  namn: string;
  adress: string | null;
  lat: number | null;
  lon: number | null;
  antal: number;
}

export interface OkandPlats {
  plats_text: string;
  antal: number;
}

export class ApiFel extends Error {
  readonly status: number;

  constructor(status: number, meddelande: string) {
    super(meddelande);
    this.status = status;
  }
}

async function hämta<T>(väg: string, init?: RequestInit): Promise<T> {
  const svar = await fetch(väg, {
    credentials: "same-origin",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });

  if (svar.status === 401) {
    // Sessionen är borta. Servern visar inloggningssidan på rotadressen.
    window.location.href = "/";
    throw new ApiFel(401, "Inte inloggad");
  }

  if (svar.status === 304) return null as T;

  if (!svar.ok) {
    const kropp = (await svar.json().catch(() => null)) as { fel?: string } | null;
    throw new ApiFel(svar.status, kropp?.fel ?? `Servern svarade ${svar.status}`);
  }

  return (await svar.json()) as T;
}

/* ------------------------------------------------------------------ händelser */

export const hämtaHändelser = (fran: number, till: number): Promise<Händelsesvar> =>
  hämta(`/api/events?from=${fran}&to=${till}`);

/** Dolda pass har ingen plats i tiden och hämtas därför utan datumspann. */
export const hämtaDolda = (): Promise<Händelsesvar> => hämta("/api/events?dolda=1");

export interface Passsvar {
  handelse: Handelse;
  krockar: Handelse[];
}

export const hämtaPass = (feed: string, uid: string): Promise<Passsvar> =>
  hämta(`/api/pass/${encodeURIComponent(feed)}/${encodeURIComponent(uid)}`);

export interface Överstyrning {
  dold?: boolean;
  ansvarig?: Ansvarig;
  anteckning?: string | null;
  samling_ms?: number | null;
}

export const sparaÖverstyrning = (feed: string, uid: string, kropp: Överstyrning): Promise<unknown> =>
  hämta(`/api/overrides/${encodeURIComponent(feed)}/${encodeURIComponent(uid)}`, {
    method: "PATCH",
    body: JSON.stringify(kropp),
  });

export const kalenderlänk = (feed: string, uid: string): string =>
  `/api/pass/${encodeURIComponent(feed)}/${encodeURIComponent(uid)}.ics`;

/* ------------------------------------------------------------------ inställningar */

export const hämtaBarn = (): Promise<{ barn: Barn[]; okanda: string[] }> => hämta("/api/barn");

export const sparaBarn = (namn: string, farg: string): Promise<unknown> =>
  hämta("/api/barn", { method: "POST", body: JSON.stringify({ namn, farg }) });

export const taBortBarn = (namn: string): Promise<unknown> =>
  hämta(`/api/barn/${encodeURIComponent(namn)}`, { method: "DELETE" });

export const hämtaVuxna = (): Promise<Vuxen[]> => hämta("/api/vuxna");

export const hämtaFloden = (): Promise<Flode[]> => hämta("/api/feeds");

export const sparaFlode = (id: string, kropp: Record<string, unknown>): Promise<unknown> =>
  hämta(`/api/feeds/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(kropp) });

export const uppdateraFloden = (): Promise<{ ok: boolean }> =>
  hämta("/api/refresh", { method: "POST", body: "{}" });

export const testaFlode = (
  url: string,
  filterMonster?: string | null
): Promise<{ ok: boolean; antal: number; filtrerade?: number; första: number | null; namn: string | null }> =>
  hämta("/api/feeds/testa", { method: "POST", body: JSON.stringify({ url, filterMonster }) });

export interface NyttFlode {
  url: string;
  etikett: string;
  /** Föreningen, från laget. Null när laget saknar klubb — då visas ingen, aldrig en gissning. */
  klubb: string | null;
  sport: string;
  barnLista: string[];
  filterMonster?: string | null;
  farg?: string;
}

export const skapaFlode = (flode: NyttFlode): Promise<{ ok: boolean; id: string; antal: number }> =>
  hämta("/api/feeds", { method: "POST", body: JSON.stringify(flode) });

export const hämtaSporter = (): Promise<Sport[]> => hämta("/api/sport");

export const sparaSport = (namn: string, farg: string): Promise<unknown> =>
  hämta("/api/sport", { method: "POST", body: JSON.stringify({ namn, farg }) });

export const hämtaLag = (): Promise<{ lag: Lag[]; utanLag: number }> => hämta("/api/lag");

export const sparaLag = (
  kode: string,
  /** Tom sträng = ärv källans barn. */
  barn: string,
  sport: string,
  farg: string | null,
  klubb: string | null,
  monster: string | null
): Promise<unknown> =>
  hämta("/api/lag", { method: "POST", body: JSON.stringify({ kode, barn, sport, farg, klubb, monster }) });

export const taBortLag = (kode: string): Promise<unknown> =>
  hämta(`/api/lag/${encodeURIComponent(kode)}`, { method: "DELETE" });

export const hämtaPlatser = (): Promise<{ platser: Plats[]; okanda: OkandPlats[] }> => hämta("/api/platser");

export const sparaPlats = (namn: string, lat: number, lon: number): Promise<unknown> =>
  hämta("/api/platser", { method: "POST", body: JSON.stringify({ namn, lat, lon }) });

export const ändraPlats = (id: number, kropp: Record<string, unknown>): Promise<unknown> =>
  hämta(`/api/platser/${id}`, { method: "PATCH", body: JSON.stringify(kropp) });

/** Begriplig text för ett fel, oavsett om det kom från API:t eller från nätet. */
export function apiFelText(e: unknown): string {
  if (e instanceof ApiFel) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

/** Delar upp händelsens id i flöde och uid, som rutten `/pass/<feed>/<uid>` behöver. */
export function delaId(id: string): { feed: string; uid: string } {
  const [feed, ...rest] = id.split("|");
  return { feed: feed ?? "", uid: rest.join("|") };
}
