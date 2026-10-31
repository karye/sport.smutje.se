import { beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { rensa } from "./hjalpare.ts";
import { db } from "../src/db.ts";
import {
  arDags,
  hamtaAlla,
  hamtaFlode,
  lasFloden,
  vilaMinuter,
  type FlodeRad,
} from "../src/hamtare.ts";
import { tillUtc } from "../src/tid.ts";

const FEED = "test-hamtare";
const FIXTURE = join(import.meta.dir, "fixtures", "sportadmin-barn1.ics");

let ics = "";

beforeAll(async () => {
  rensa(db);
  ics = await Bun.file(FIXTURE).text();
  db.run(
    "INSERT INTO feeds (id, child, sport, club, label, color, url) VALUES (?, 'Barn 1', 'bandy', 'SBBK', 'Test', '#1d4ed8', 'https://example.test/cal.ics')",
    [FEED]
  );
});

const flode = (): FlodeRad => {
  const f = lasFloden().find((x) => x.id === FEED);
  if (!f) throw new Error("flödet saknas");
  return f;
};

/** Låtsas-svar utan nät. Fångar vilka huvuden hämtaren skickade. */
function svar(
  status: number,
  kropp: string | null,
  huvuden: Record<string, string> = {}
): { hamta: typeof fetch; sedda: { alla: Record<string, string> } } {
  const sedda = { alla: {} as Record<string, string> };
  const hamta = (async (_url: string | URL | Request, init?: RequestInit) => {
    sedda.alla = (init?.headers ?? {}) as Record<string, string>;
    return new Response(kropp, { status, headers: huvuden });
  }) as unknown as typeof fetch;
  return { hamta, sedda };
}

describe("hämtaren", () => {
  test("ett riktigt svar tolkas och sparas", async () => {
    const { hamta } = svar(200, ics, { etag: '"e04a934fe94cfe5d"', "x-sa-event-count": "11" });
    const ut = await hamtaFlode(flode(), { nu: tillUtc(2026, 10, 29, 12, 0), hamta });

    expect(ut.status).toBe("ok");
    expect(ut.antal).toBe(11);
    expect(ut.lagring?.nya).toBe(11);
    expect(flode().last_status).toBe("ok");
    expect(flode().etag).toBe('"e04a934fe94cfe5d"');
    expect(flode().fel_i_rad).toBe(0);
  });

  test("304 kostar ingenting och räknas som oförändrad", async () => {
    const { hamta } = svar(304, null);
    const ut = await hamtaFlode(flode(), { nu: tillUtc(2026, 10, 29, 13, 0), hamta });
    expect(ut.status).toBe("oforandrad");
    expect(flode().last_status).toBe("oforandrad");
  });

  test("ETag skickas med som If-None-Match", async () => {
    const { hamta, sedda } = svar(304, null);
    await hamtaFlode(flode(), { hamta });
    expect(sedda.alla["If-None-Match"]).toBe('"e04a934fe94cfe5d"');
    expect(String(sedda.alla["User-Agent"])).toContain("sport.smutje.se");
  });

  test("ett serverfel räknas upp och sparas med orsak", async () => {
    const { hamta } = svar(500, "nej");
    const ut = await hamtaFlode(flode(), { nu: tillUtc(2026, 10, 29, 14, 0), hamta });
    expect(ut.status).toBe("fel");
    expect(ut.fel).toContain("500");
    expect(flode().fel_i_rad).toBe(1);
    expect(flode().last_status).toBe("fel");
    expect(flode().last_error).toContain("500");
  });

  test("ett nätverksfel fångas i stället för att kasta", async () => {
    const hamta = (async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    }) as unknown as typeof fetch;
    const ut = await hamtaFlode(flode(), { hamta });
    expect(ut.status).toBe("fel");
    expect(ut.fel).toContain("ENOTFOUND");
    expect(flode().fel_i_rad).toBe(2);
  });

  test("flöde som påstår sig ha händelser men inte kan tolkas är ett fel", async () => {
    const tom = "BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR\n";
    const { hamta } = svar(200, tom, { "x-sa-event-count": "42" });
    const ut = await hamtaFlode(flode(), { hamta });
    expect(ut.status).toBe("fel");
    expect(ut.fel).toContain("42");
  });

  test("varje körning hamnar i fetch_runs", () => {
    const rader = db
      .query<{ status: string; n: number }, [string]>(
        "SELECT status, COUNT(*) AS n FROM fetch_runs WHERE feed_id = ? GROUP BY status"
      )
      .all(FEED);
    const statusar = Object.fromEntries(rader.map((r) => [r.status, r.n]));
    expect(statusar["ok"]).toBeGreaterThanOrEqual(1);
    expect(statusar["oforandrad"]).toBeGreaterThanOrEqual(1);
    expect(statusar["fel"]).toBeGreaterThanOrEqual(1);
  });
});

describe("skydd mot tomt flöde", () => {
  test("noll händelser sparas inte och ställer inte in något", async () => {
    const före = db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM events").get()?.n ?? 0;
    const tomt = "BEGIN:VCALENDAR\nVERSION:2.0\nX-WR-CALNAME;VALUE=TEXT:Borttaget\nEND:VCALENDAR\n";
    const { hamta } = svar(200, tomt);
    const ut = await hamtaFlode(flode(), { hamta });

    expect(ut.status).toBe("fel");
    expect(ut.fel).toContain("inga händelser");
    const efter = db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM events").get()?.n ?? 0;
    expect(efter).toBe(före);
  });
});

describe("backoff", () => {
  test("trappan 15, 15, 30, 60, 120", () => {
    expect(vilaMinuter(0)).toBe(15);
    expect(vilaMinuter(1)).toBe(15);
    expect(vilaMinuter(2)).toBe(30);
    expect(vilaMinuter(3)).toBe(60);
    expect(vilaMinuter(4)).toBe(120);
    expect(vilaMinuter(9)).toBe(120);
  });

  test("arDags respekterar både intervall och backoff", () => {
    const nu = tillUtc(2026, 10, 29, 12, 0);
    const bas = { ...flode(), fel_i_rad: 0 };

    expect(arDags({ ...bas, last_fetch_at: null }, nu)).toBe(true);
    expect(arDags({ ...bas, last_fetch_at: nu - 14 * 60_000 }, nu)).toBe(false);
    expect(arDags({ ...bas, last_fetch_at: nu - 16 * 60_000 }, nu)).toBe(true);

    // Efter två fel ska flödet vila 30 minuter, alltså inte hämtas efter 20.
    expect(arDags({ ...bas, fel_i_rad: 2, last_fetch_at: nu - 20 * 60_000 }, nu)).toBe(false);
    expect(arDags({ ...bas, fel_i_rad: 2, last_fetch_at: nu - 31 * 60_000 }, nu)).toBe(true);
  });
});

describe("hamtaAlla", () => {
  test("hoppar över flöden som nyligen hämtats", async () => {
    // Föregående tester lämnade flödet hämtat "nyss" i backoff.
    const ut = await hamtaAlla({ hamta: (async () => new Response(null, { status: 304 })) as unknown as typeof fetch });
    expect(ut.every((s) => s.status === "hoppad")).toBe(true);
  });
});
