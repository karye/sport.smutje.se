/**
 * Hämtaren.
 *
 * Sportadmins flöde svarar med `ETag` och `Cache-Control: no-cache, must-revalidate`, alltså är
 * 304 det vanliga svaret och en hämtning kostar nästan ingenting. Tre saker skyddar mot det som
 * annars går tyst sönder:
 *
 *   timeout       15 s, så att en hängande anslutning inte blockerar nästa flöde
 *   storlekstak   5 MB, så att ett felaktigt svar inte äter minnet
 *   backoff       fel räknas upp, och ett flöde som svarat fel får vänta längre varje gång
 *
 * Varje körning skrivs till `fetch_runs`, även de som misslyckas. Utan den historiken går det inte
 * att svara på "har flödet någonsin fungerat".
 */
import { db } from "./db.ts";
import { sparaHandelser, type LagringsResultat } from "./lagring.ts";
import type { Lagregel } from "./lagmappning.ts";
import { tolkaFlode } from "./tolk.ts";
import type { Flode, Plats } from "./typer.ts";

export const MAX_BYTES = 5 * 1024 * 1024;
export const TIMEOUT_MS = 15_000;
export const INTERVALL_MIN = 15;
export const MAX_BACKOFF_MIN = 120;
export const USER_AGENT = "sport.smutje.se/1.0 (+familjekalender)";

export interface FlodeRad extends Flode {
  etag: string | null;
  last_modified: string | null;
  last_fetch_at: number | null;
  last_status: string | null;
  last_error: string | null;
  fel_i_rad: number;
}

export function lasFloden(baraAktiva = true): FlodeRad[] {
  const sql = `SELECT id, child, sport, club, label, color, url, aktiv, samling_monster, filter_monster,
                      etag, last_modified, last_fetch_at, last_status, last_error, fel_i_rad
               FROM feeds ${baraAktiva ? "WHERE aktiv = 1" : ""} ORDER BY id`;
  return db.query<FlodeRad, []>(sql).all();
}

export function lasLagregler(): Lagregel[] {
  return db
    .query<Lagregel, []>("SELECT kode, monster FROM lag WHERE monster IS NOT NULL AND monster <> ''")
    .all();
}

export function lasPlatser(): Plats[] {
  return db.query<Plats, []>("SELECT id, namn, normaliserat, lat, lon FROM platser").all();
}

/**
 * Hur länge ett flöde ska vila innan nästa försök, i minuter.
 * Friskt flöde: 15 minuter. Ett fel: fortfarande 15, sedan 30, 60 och som mest 120.
 */
export function vilaMinuter(felIRad: number): number {
  if (felIRad <= 1) return INTERVALL_MIN;
  return Math.min(INTERVALL_MIN * 2 ** (felIRad - 1), MAX_BACKOFF_MIN);
}

export function arDags(flode: FlodeRad, nu: number): boolean {
  if (flode.last_fetch_at == null) return true;
  return nu - flode.last_fetch_at >= vilaMinuter(flode.fel_i_rad) * 60_000;
}

export interface HamtarSvar {
  feed: string;
  status: "ok" | "oforandrad" | "fel" | "hoppad";
  ms: number;
  antal?: number;
  fel?: string;
  lagring?: LagringsResultat;
}

function skrivKorning(feedId: string, startat: number, ms: number, status: string, antal: number | null, fel: string | null): void {
  db.run(
    "INSERT INTO fetch_runs (feed_id, started_at, ms, status, antal, fel) VALUES (?, ?, ?, ?, ?, ?)",
    [feedId, startat, ms, status, antal, fel]
  );
}

/**
 * Hämtar ett flöde.
 *
 * `hamta` går att byta ut, så att testerna kan spela upp 304, 500 och ett riktigt svar utan att
 * röra nätet.
 */
export async function hamtaFlode(
  flode: FlodeRad,
  val: { nu?: number; hamta?: typeof fetch } = {}
): Promise<HamtarSvar> {
  const nu = val.nu ?? Date.now();
  const hamta = val.hamta ?? fetch;
  const startat = Date.now();

  const huvuden: Record<string, string> = { "User-Agent": USER_AGENT };
  if (flode.etag) huvuden["If-None-Match"] = flode.etag;
  if (flode.last_modified) huvuden["If-Modified-Since"] = flode.last_modified;

  const misslyckas = (fel: string, ms: number): HamtarSvar => {
    const kort = fel.slice(0, 200);
    db.run(
      `UPDATE feeds SET last_fetch_at = ?, last_status = 'fel', last_error = ?, fel_i_rad = fel_i_rad + 1
       WHERE id = ?`,
      [nu, kort, flode.id]
    );
    skrivKorning(flode.id, startat, ms, "fel", null, kort);
    return { feed: flode.id, status: "fel", ms, fel: kort };
  };

  try {
    const svar = await hamta(flode.url, {
      headers: huvuden,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "error",
    });

    const ms = Date.now() - startat;

    if (svar.status === 304) {
      db.run(
        "UPDATE feeds SET last_fetch_at = ?, last_status = 'oforandrad', last_error = NULL, fel_i_rad = 0 WHERE id = ?",
        [nu, flode.id]
      );
      skrivKorning(flode.id, startat, ms, "oforandrad", null, null);
      return { feed: flode.id, status: "oforandrad", ms };
    }

    if (!svar.ok) return misslyckas(`HTTP ${svar.status} ${svar.statusText}`, ms);

    const text = await svar.text();
    if (text.length > MAX_BYTES) return misslyckas(`Svaret är ${text.length} tecken, över taket`, ms);

    const förväntat = Number(svar.headers.get("x-sa-event-count") ?? "");
    const resultat = tolkaFlode(
      text,
      { id: flode.id, label: flode.label, samling_monster: flode.samling_monster, filter_monster: flode.filter_monster },
      { fran: nu - 30 * 86_400_000, till: nu + 400 * 86_400_000 },
      lasPlatser(),
      lasLagregler()
    );

    // Leverantörens eget antal är en billig rimlighetskontroll: noll tolkade händelser när
    // flödet påstår sig ha flera betyder att formatet ändrats, inte att laget lagt ner.
    if (Number.isFinite(förväntat) && förväntat > 0 && resultat.handelser.length === 0) {
      return misslyckas(`Flödet anger ${förväntat} händelser men ingen gick att tolka`, ms);
    }

    // Ett tomt flöde är farligt, inte tomt: lagringen skulle tolka varje tidigare händelse som
    // borttagen och ställa in hela kalendern efter två hämtningar. SvenskaLag svarar dessutom 200
    // med `X-WR-CALNAME:Borttaget` och noll händelser för en kalender som tagits bort.
    if (resultat.handelser.length === 0) {
      // Med ett filter är noll träffar inte samma sak som ett tomt flöde: kåren kan mycket väl ha
      // en kalender utan något för just den avdelningen. Då sparas inget, men inget ställs in.
      if (flode.filter_monster) {
        db.run(
          "UPDATE feeds SET last_fetch_at = ?, last_status = 'ok', last_error = ?, fel_i_rad = 0 WHERE id = ?",
          [nu, `Filtret matchade inga händelser (${resultat.antalFiltrerade} sållades bort)`, flode.id]
        );
        skrivKorning(flode.id, startat, ms, "ok", 0, null);
        return { feed: flode.id, status: "ok", ms, antal: 0 };
      }
      return misslyckas("Flödet innehåller inga händelser alls — sparas inte", ms);
    }

    const lagring = sparaHandelser(flode.id, resultat.handelser, nu);

    db.run(
      `UPDATE feeds SET last_fetch_at = ?, last_status = 'ok', last_error = NULL, fel_i_rad = 0,
                        etag = ?, last_modified = ? WHERE id = ?`,
      [nu, svar.headers.get("etag") ?? flode.etag, svar.headers.get("last-modified") ?? flode.last_modified, flode.id]
    );
    skrivKorning(flode.id, startat, ms, "ok", resultat.handelser.length, null);

    return { feed: flode.id, status: "ok", ms, antal: resultat.handelser.length, lagring };
  } catch (fel) {
    const ms = Date.now() - startat;
    const orsak = fel instanceof Error ? fel.message : String(fel);
    return misslyckas(orsak, ms);
  }
}

/**
 * Hämtar alla flöden som är mogna. Sekventiellt med tre sekunder mellan, så att föreningarnas
 * servrar inte belastas och så att en långsam klient inte kan starta sex anslutningar samtidigt.
 */
export async function hamtaAlla(val: { nu?: number; hamta?: typeof fetch } = {}): Promise<HamtarSvar[]> {
  const nu = val.nu ?? Date.now();
  const ut: HamtarSvar[] = [];
  const floden = lasFloden();

  for (const [i, flode] of floden.entries()) {
    if (!arDags(flode, nu)) {
      ut.push({ feed: flode.id, status: "hoppad", ms: 0 });
      continue;
    }
    if (i > 0) await Bun.sleep(3000);
    ut.push(await hamtaFlode(flode, val));
  }

  return ut;
}
