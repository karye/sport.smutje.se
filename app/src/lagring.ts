/**
 * Lagringen: normaliserade händelser in i `events`.
 *
 * Tre regler styr allt här:
 *
 *   1. `events` ägs av hämtaren och skrivs över varje gång. `overrides` ägs av oss och rörs aldrig.
 *   2. En händelse som försvinner ur flödet raderas inte. Den får `missing_since`, och först vid
 *      nästa hämtning som också saknar den blir den `CANCELLED`. Då syns *inställt* i stället för
 *      att passet bara är borta — vilket är den vanligaste verkliga händelsen i ungdomsidrott.
 *   3. `forst_sedd` sätts en gång och skrivs aldrig över. Den svarar på "när dök passet upp".
 */
import { db } from "./db.ts";
import type { Handelse } from "./typer.ts";

export interface LagringsResultat {
  nya: number;
  uppdaterade: number;
  borta: number;
  installda: number;
}

interface Rad {
  uid: string;
  senast_sedd: number;
  missing_since: number | null;
  ics_status: string;
}

const UPSERT = `
INSERT INTO events (
  feed_id, uid, fingerprint, titel, lag, sport_titel, beskrivning, plats_text, plats_id,
  start_ms, slut_ms, heldag, ics_status, samling_ms, samling_kalla,
  motstandare, hemmamatch, flerdygn, missing_since, forst_sedd, senast_sedd
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
ON CONFLICT(feed_id, uid) DO UPDATE SET
  fingerprint   = excluded.fingerprint,
  titel         = excluded.titel,
  lag           = excluded.lag,
  sport_titel   = excluded.sport_titel,
  beskrivning   = excluded.beskrivning,
  plats_text    = excluded.plats_text,
  plats_id      = excluded.plats_id,
  start_ms      = excluded.start_ms,
  slut_ms       = excluded.slut_ms,
  heldag        = excluded.heldag,
  ics_status    = excluded.ics_status,
  samling_ms    = excluded.samling_ms,
  samling_kalla = excluded.samling_kalla,
  motstandare   = excluded.motstandare,
  hemmamatch    = excluded.hemmamatch,
  flerdygn      = excluded.flerdygn,
  missing_since = NULL,
  senast_sedd   = excluded.senast_sedd
`;

export function sparaHandelser(
  feedId: string,
  handelser: readonly Handelse[],
  nu: number = Date.now()
): LagringsResultat {
  const befintliga = new Map<string, Rad>(
    db
      .query<Rad, [string]>(
        "SELECT uid, senast_sedd, missing_since, ics_status FROM events WHERE feed_id = ?"
      )
      .all(feedId)
      .map((r) => [r.uid, r])
  );

  const inkommande = new Set(handelser.map((h) => h.uid));
  let nya = 0;
  let uppdaterade = 0;
  let borta = 0;
  let installda = 0;

  const kör = db.transaction(() => {
    for (const h of handelser) {
      if (befintliga.has(h.uid)) uppdaterade++;
      else nya++;

      db.run(UPSERT, [
        h.feed_id,
        h.uid,
        h.fingerprint,
        h.titel,
        h.lag,
        h.sport_titel,
        h.beskrivning,
        h.plats_text,
        h.plats_id,
        h.start_ms,
        h.slut_ms,
        h.heldag ? 1 : 0,
        h.ics_status,
        h.samling_ms,
        h.samling_kalla,
        h.motstandare,
        h.hemmamatch == null ? null : h.hemmamatch ? 1 : 0,
        h.flerdygn ? 1 : 0,
        nu,
        nu,
      ]);
    }

    for (const [uid, rad] of befintliga) {
      if (inkommande.has(uid)) continue;
      borta++;

      if (rad.missing_since == null) {
        // Första gången den saknas: markera, men behåll status.
        db.run("UPDATE events SET missing_since = ? WHERE feed_id = ? AND uid = ?", [nu, feedId, uid]);
        continue;
      }

      // Andra gången i rad: nu är den inställd. Senast sedd är äldre än markeringen, alltså har
      // minst en full hämtning passerat utan att händelsen kommit tillbaka.
      if (rad.senast_sedd < rad.missing_since && rad.ics_status !== "CANCELLED") {
        db.run("UPDATE events SET ics_status = 'CANCELLED' WHERE feed_id = ? AND uid = ?", [feedId, uid]);
        installda++;
      }
    }
  });

  kör();

  return { nya, uppdaterade, borta, installda };
}

/** Antal händelser i flödet, för hälsostatusen. */
export function antalIHamtaresFlode(feedId: string): number {
  const rad = db
    .query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM events WHERE feed_id = ?")
    .get(feedId);
  return rad?.n ?? 0;
}
