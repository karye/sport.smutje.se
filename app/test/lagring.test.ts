import { beforeAll, describe, expect, test } from "bun:test";
import { rensa } from "./hjalpare.ts";
import { db } from "../src/db.ts";
import { antalIHamtaresFlode, sparaHandelser } from "../src/lagring.ts";
import { tillUtc } from "../src/tid.ts";
import type { Handelse } from "../src/typer.ts";

const FEED = "test-lagring";

function handelse(uid: string, timme: number, status: Handelse["ics_status"] = "CONFIRMED"): Handelse {
  const start = tillUtc(2026, 11, 10, timme, 0);
  return {
    feed_id: FEED,
    uid,
    fingerprint: `fp-${uid}`,
    titel: `Träning ${uid}`,
    lag: "F2016",
    sport_titel: null,
    beskrivning: "Samling: 17:45",
    plats_text: "Kärrtorps IP",
    plats_id: null,
    start_ms: start,
    slut_ms: start + 90 * 60_000,
    heldag: false,
    ics_status: status,
    samling_ms: start - 15 * 60_000,
    samling_kalla: "regex",
    motstandare: null,
    hemmamatch: null,
    flerdygn: false,
  };
}

const rad = (uid: string) =>
  db
    .query<{ senast_sedd: number; forst_sedd: number; missing_since: number | null; ics_status: string }, [string, string]>(
      "SELECT senast_sedd, forst_sedd, missing_since, ics_status FROM events WHERE feed_id = ? AND uid = ?"
    )
    .get(FEED, uid);

beforeAll(() => {
  rensa(db);
  db.run(
    "INSERT INTO feeds (id, child, sport, club, label, color, url) VALUES (?, 'Barn 1', 'bandy', 'SBBK', 'Test', '#1d4ed8', 'https://example.test/cal.ics')",
    [FEED]
  );
});

describe("lagringen", () => {
  test("första hämtningen skapar rader", () => {
    expect(sparaHandelser(FEED, [handelse("a", 18), handelse("b", 20)], 1000)).toEqual({
      nya: 2,
      uppdaterade: 0,
      borta: 0,
      installda: 0,
    });
    expect(antalIHamtaresFlode(FEED)).toBe(2);
  });

  test("andra hämtningen uppdaterar men behåller forst_sedd", () => {
    const först = rad("a");
    expect(sparaHandelser(FEED, [handelse("a", 18), handelse("b", 20)], 2000).uppdaterade).toBe(2);
    const efter = rad("a");
    expect(efter?.forst_sedd).toBe(först?.forst_sedd);
    expect(efter?.senast_sedd).toBe(2000);
  });

  test("en händelse som försvinner markeras men raderas inte", () => {
    const resultat = sparaHandelser(FEED, [handelse("a", 18)], 3000);
    expect(resultat.borta).toBe(1);
    expect(resultat.installda).toBe(0);
    expect(rad("b")?.missing_since).toBe(3000);
    expect(rad("b")?.ics_status).toBe("CONFIRMED");
  });

  test("först vid andra uteblivna hämtningen blir den inställd", () => {
    const resultat = sparaHandelser(FEED, [handelse("a", 18)], 4000);
    expect(resultat.installda).toBe(1);
    expect(rad("b")?.ics_status).toBe("CANCELLED");
  });

  test("en händelse som kommer tillbaka återställs", () => {
    sparaHandelser(FEED, [handelse("a", 18), handelse("b", 20)], 5000);
    expect(rad("b")?.missing_since).toBeNull();
    expect(rad("b")?.ics_status).toBe("CONFIRMED");
  });

  test("en överstyrning överlever att flödet skrivs om", () => {
    db.run(
      "INSERT INTO overrides (feed_id, uid, dold, ansvarig_typ, updated_at) VALUES (?, 'a', 1, 'samakning', ?)",
      [FEED, 6000]
    );
    sparaHandelser(FEED, [handelse("a", 18), handelse("b", 20)], 7000);
    const rad2 = db
      .query<{ dold: number; ansvarig_typ: string }, [string, string]>(
        "SELECT dold, ansvarig_typ FROM overrides WHERE feed_id = ? AND uid = ?"
      )
      .get(FEED, "a");
    expect(rad2).toEqual({ dold: 1, ansvarig_typ: "samakning" });
  });

  test("en inställd händelse i flödet behåller sin status", () => {
    sparaHandelser(FEED, [handelse("a", 18, "CANCELLED"), handelse("b", 20)], 8000);
    expect(rad("a")?.ics_status).toBe("CANCELLED");
  });
});
