/** Typer som delas mellan modulerna. Databaskolumner är ASCII; svenska står i kommentarerna. */

export type Roll = "foralder" | "barn";

export interface Anvandare {
  id: number;
  google_id: string;
  email: string;
  display_name: string;
  roll: Roll;
}

export interface Flode {
  id: string;
  child: string;
  sport: string;
  club: string;
  label: string;
  color: string;
  url: string;
  aktiv: boolean;
  samling_monster: string | null;
  /** Valfritt filter mot titel, beskrivning och kategori. Null = allt sparas. */
  filter_monster: string | null;
}

export interface Plats {
  id: number;
  namn: string;
  normaliserat: string;
  lat: number | null;
  lon: number | null;
}

export type IcsStatus = "CONFIRMED" | "TENTATIVE" | "CANCELLED";

/** En normaliserad händelse, redo att skrivas till events. */
export interface Handelse {
  feed_id: string;
  uid: string;
  fingerprint: string;
  titel: string;
  /** Lagkod ur titeln, till exempel U2015. Null när titeln saknar kod. */
  lag: string | null;
  /** Sport som nämns i titeln, till exempel innebandy. Null när titeln tiger. */
  sport_titel: string | null;
  beskrivning: string | null;
  plats_text: string | null;
  plats_id: number | null;
  start_ms: number;
  slut_ms: number;
  heldag: boolean;
  ics_status: IcsStatus;
  samling_ms: number | null;
  samling_kalla: "regex" | "minuter" | "manuell" | null;
  motstandare: string | null;
  hemmamatch: boolean | null;
  flerdygn: boolean;
}

export type AnsvarigTyp = "ingen" | "person" | "samakning" | "egen";

export interface Ansvarig {
  typ: AnsvarigTyp;
  user_id: number | null;
}

export interface Krock {
  typ: "tid" | "transport";
  mot: string[];
  /** Positivt = glapp i minuter, negativt = överlapp. */
  glappMin: number;
  restidMin: number | null;
  /** Sant när krocken ännu inte är löst av logistiken. Fältet hette `lost`, vilket lästes som
   *  engelska "förlorad" men betydde svenska "olöst". */
  olost: boolean;
  sammaBarn: boolean;
}

/** Det krockberäkningen behöver veta om ett pass. */
export interface KrockPass {
  id: string;
  /** Ett pass kan gälla flera barn, till exempel syskon i samma lag. */
  barn: string[];
  plats_id: number | null;
  samling_ms: number | null;
  start_ms: number;
  slut_ms: number;
  dold: boolean;
  installt: boolean;
  ansvarig: Ansvarig;
}
