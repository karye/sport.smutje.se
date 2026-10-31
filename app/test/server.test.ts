import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { rensa, TEST_DB } from "./hjalpare.ts";

const FIXTURE = join(import.meta.dir, "fixtures", "sportadmin-barn1.ics");

/**
 * Rökprov mot appen utan att öppna en port: `handle` tar en Request och ger ett Response.
 * Ingen webbläsare, ingen Chromium — det här är samma anrop som proxyn gör.
 */
type App = { handle: (req: Request) => Promise<Response> };
let app: App;
let auth: typeof import("../src/auth.ts");
let db: typeof import("../src/db.ts").db;

const ORIGIN = "http://127.0.0.1:3011";

beforeAll(async () => {
  auth = await import("../src/auth.ts");
  db = (await import("../src/db.ts")).db;
  const mod = await import("../src/app.ts");
  app = mod.skapaApp() as unknown as App;
  rensa(db);
});

afterAll(() => {
  for (const fil of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) rmSync(fil, { force: true });
});

const hämta = (väg: string, cookie?: string, init?: RequestInit): Promise<Response> =>
  app.handle(
    new Request(`${ORIGIN}${väg}`, {
      ...init,
      headers: { ...(cookie ? { cookie } : {}), ...(init?.headers ?? {}) },
    })
  );

function sessionFör(epost: string, roll: "foralder" | "barn" = "foralder"): string {
  const anvandare = auth.upsertUser({ sub: `google-${epost}`, email: epost, name: "Test" }, roll);
  return `sport_session=${auth.issue({ uid: anvandare.id }, 60)}`;
}

describe("utan inloggning", () => {
  test("/api/halsa svarar 401", async () => {
    const svar = await hämta("/api/halsa");
    expect(svar.status).toBe(401);
    expect(await svar.json()).toEqual({ fel: "Inte inloggad" });
  });

  test("startsidan visar inloggningssidan", async () => {
    const svar = await hämta("/");
    expect(svar.status).toBe(200);
    expect(await svar.text()).toContain("Logga in med Google");
  });

  test("en pass-sida med punkt i uid ger inloggningssidan, inte 404", async () => {
    const svar = await hämta("/pass/sbbk-p16/16000001-2742@sportadmin.se");
    expect(svar.status).toBe(200);
    expect(svar.headers.get("content-type")).toContain("text/html");
  });

  test("en manipulerad cookie avvisas", async () => {
    expect((await hämta("/api/halsa", "sport_session=fejk.nytta")).status).toBe(401);
  });

  test("en kaka med giltig signatur men okänt id avvisas", async () => {
    expect((await hämta("/api/halsa", `sport_session=${auth.issue({ uid: 9999 }, 60)}`)).status).toBe(401);
  });
});

describe("inloggningsflödet", () => {
  test("/auth/login skickar vidare till Google med state-cookie", async () => {
    const svar = await hämta("/auth/login");
    expect(svar.status).toBe(302);

    const location = new URL(svar.headers.get("location") ?? "");
    expect(location.origin).toBe("https://accounts.google.com");
    expect(location.searchParams.get("redirect_uri")).toBe("https://sport.smutje.se/auth/callback");
    expect(location.searchParams.get("state")).toHaveLength(64);

    const kaka = svar.headers.get("set-cookie") ?? "";
    expect(kaka).toContain("sport_oauth_state=");
    expect(kaka).toContain("HttpOnly");
    expect(kaka).toContain("Max-Age=600");
  });

  test("callback utan state-cookie nekas", async () => {
    const svar = await hämta("/auth/callback?code=abc&state=abc");
    expect(svar.status).toBe(403);
    expect(await svar.text()).toContain("Ogiltig förfrågan");
  });

  test("callback där state inte matchar nekas", async () => {
    const stateKaka = `sport_oauth_state=${auth.issue({ state: "ratt" }, 600)}`;
    expect((await hämta("/auth/callback?code=abc&state=fel", stateKaka)).status).toBe(403);
  });

  test("callback utan kod men med rätt state ger 400", async () => {
    const stateKaka = `sport_oauth_state=${auth.issue({ state: "ratt" }, 600)}`;
    const svar = await hämta("/auth/callback?state=ratt", stateKaka);
    expect(svar.status).toBe(400);
    expect(await svar.text()).toContain("Ingen kod");
  });

  test("avslag från Google visas begripligt", async () => {
    const svar = await hämta("/auth/callback?error=access_denied");
    expect(svar.status).toBe(400);
    expect(await svar.text()).toContain("nekades");
  });

  test("utloggning sker med POST och rensar kakan", async () => {
    // En GET får inte logga ut: en förhämtad länk ska inte kunna logga ut någon.
    const påGet = await hämta("/auth/logout");
    expect(påGet.headers.get("set-cookie") ?? "").not.toContain("Max-Age=0");

    const svar = await hämta("/auth/logout", undefined, { method: "POST" });
    expect(svar.status).toBe(302);
    expect(svar.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});

describe("inloggad", () => {
  // Kakan skapas i beforeAll: den inre kroken kör efter den yttre, alltså efter att auth laddats.
  let kaka = "";
  beforeAll(() => {
    kaka = sessionFör("foralder1@example.com");
  });

  test("/api/halsa svarar med zonen", async () => {
    const svar = await hämta("/api/halsa", kaka);
    expect(svar.status).toBe(200);
    const kropp = (await svar.json()) as { ok: boolean; zon: string; floden: unknown[] };
    expect(kropp.ok).toBe(true);
    expect(kropp.zon).toBe("Europe/Stockholm");
    expect(Array.isArray(kropp.floden)).toBe(true);
  });

  test("startsidan ger appskalet, inte serverns hälsning", async () => {
    // Sedan frontend är byggd serveras `app/public/index.html` även på rotadressen. Serverns egen
    // hälsningssida finns kvar bara som reserv när bygget saknas.
    const svar = await hämta("/", kaka);
    expect(svar.status).toBe(200);
    const html = await svar.text();
    expect(html).toContain('<div id="rot">');
  });

  test("utloggning finns kvar som POST-rutt", async () => {
    const svar = await hämta("/auth/logout", undefined, { method: "POST" });
    expect(svar.status).toBe(302);
    expect(svar.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  test("rot och vecka ger appskalet", async () => {
    for (const väg of ["/", "/vecka", "/vecka/2026-45", "/manad/2026-11"]) {
      expect((await hämta(väg, kaka)).status).toBe(200);
    }
  });

  test("okänd api-rutt ger 404 som JSON", async () => {
    const svar = await hämta("/api/finnsinte", kaka);
    expect(svar.status).toBe(404);
    expect(await svar.json()).toEqual({ fel: "Finns inte" });
  });

  test("saknad fil med känd ändelse ger 404", async () => {
    expect((await hämta("/stil.css", kaka)).status).toBe(404);
  });
});

describe("manuell hämtning", () => {
  const kaka = () => sessionFör("foralder1@example.com");

  test("utan Origin avvisas den", async () => {
    const svar = await hämta("/api/refresh", kaka(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(svar.status).toBe(403);
  });

  test("utan JSON-typ avvisas den", async () => {
    const svar = await hämta("/api/refresh", kaka(), {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "text/plain" },
      body: "{}",
    });
    expect(svar.status).toBe(403);
  });

  test("rollen barn får inte hämta", async () => {
    const hjälte = auth.upsertUser({ sub: "google-barn1", email: "barn1@example.com", name: "Barn 1" }, "barn");
    const svar = await hämta("/api/refresh", `sport_session=${auth.issue({ uid: hjälte.id }, 60)}`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: "{}",
    });
    expect(svar.status).toBe(403);
  });

  test("förälder med rätt huvuden får hämta, och spärren slår till efter", async () => {
    const först = await hämta("/api/refresh", kaka(), {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: "{}",
    });
    expect(först.status).toBe(200);

    const andra = await hämta("/api/refresh", kaka(), {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: "{}",
    });
    expect(andra.status).toBe(429);
    expect(andra.headers.get("retry-after")).toBeTruthy();
  });
});

describe("api för händelser", () => {
  const kaka = () => sessionFör("foralder1@example.com");
  const FRAN = Date.UTC(2026, 10, 1);
  const TILL = Date.UTC(2026, 11, 1);

  beforeAll(async () => {
    const ics = await Bun.file(FIXTURE).text();
    db.run(
      "INSERT INTO feeds (id, child, sport, club, label, color, url) VALUES ('test-server', 'Barn 1', 'bandy', 'SBBK', 'Test', '#1d4ed8', 'https://example.test/cal.ics')"
    );

    const { tolkaFlode } = await import("../src/tolk.ts");
    const { sparaHandelser } = await import("../src/lagring.ts");
    const resultat = tolkaFlode(
      ics,
      { id: "test-server", label: "Test", samling_monster: null },
      { fran: FRAN, till: TILL }
    );
    sparaHandelser("test-server", resultat.handelser, Date.now());
  });

  test("kräver inloggning", async () => {
    expect((await hämta(`/api/events?from=${FRAN}&to=${TILL}`)).status).toBe(401);
  });

  test("returnerar passen i intervallet med krockfält", async () => {
    const svar = await hämta(`/api/events?from=${FRAN}&to=${TILL}`, kaka());
    expect(svar.status).toBe(200);
    expect(svar.headers.get("etag")).toBeTruthy();

    const kropp = (await svar.json()) as {
      handelser: { id: string; titel: string; samling: number | null; krock: unknown }[];
    };
    expect(kropp.handelser.length).toBeGreaterThan(0);
    const första = kropp.handelser[0];
    expect(första?.id).toContain("|");
    expect(första).toHaveProperty("krock");
  });

  test("samma ETag ger 304", async () => {
    const första = await hämta(`/api/events?from=${FRAN}&to=${TILL}`, kaka());
    const etag = första.headers.get("etag") ?? "";
    const andra = await hämta(`/api/events?from=${FRAN}&to=${TILL}`, kaka(), {
      headers: { "if-none-match": etag },
    });
    expect(andra.status).toBe(304);
  });

  test("intervall över två månader avvisas", async () => {
    const svar = await hämta(`/api/events?from=${FRAN}&to=${TILL + 90 * 86_400_000}`, kaka());
    expect(svar.status).toBe(400);
  });

  test("utan parametrar används innevarande vecka", async () => {
    const svar = await hämta("/api/events", kaka());
    expect(svar.status).toBe(200);
    const kropp = (await svar.json()) as { fran: number; till: number };
    expect(kropp.till - kropp.fran).toBeLessThan(8 * 86_400_000);
  });
});

describe("inställningarna", () => {
  const kaka = () => sessionFör("foralder1@example.com");
  const skriv = (väg: string, metod: string, kropp: unknown) =>
    hämta(väg, kaka(), {
      method: metod,
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify(kropp),
    });

  test("flödeslistan visar värden men aldrig sökvägen", async () => {
    const svar = await hämta("/api/feeds", kaka());
    expect(svar.status).toBe(200);
    const rader = (await svar.json()) as { id: string; vard: string; antal: number }[];
    expect(rader.length).toBeGreaterThan(0);
    const rad = rader[0]!;
    expect(rad.vard).toContain("example.test");
    expect(JSON.stringify(rad)).not.toContain("cal.ics");
  });

  test("barn och sport går att ändra", async () => {
    const svar = await skriv("/api/feeds/test-server", "PATCH", { barn: "Barn 2", sport: "innebandy" });
    expect(svar.status).toBe(200);

    const rader = (await (await hämta("/api/feeds", kaka())).json()) as { id: string; barn: string; sport: string }[];
    const rad = rader.find((r) => r.id === "test-server");
    expect(rad?.barn).toBe("Barn 2");
    expect(rad?.sport).toBe("innebandy");
  });

  test("ogiltig adress avvisas innan den sparas", async () => {
    const svar = await skriv("/api/feeds/test-server", "PATCH", { url: "http://example.test/cal.ics" });
    expect(svar.status).toBe(400);
  });

  test("lagmappningen går att lägga till, lista och ta bort", async () => {
    // Utan klubb är mappningen halvfärdig: passet skulle visas utan förening.
    expect((await skriv("/api/lag", "POST", { kode: "u2015", barn: "Barn 1", sport: "bandy" })).status).toBe(400);

    expect(
      (await skriv("/api/lag", "POST", { kode: "u2015", barn: "Barn 1", sport: "bandy", klubb: "SBBK" })).status
    ).toBe(200);

    const svarLista = (await (await hämta("/api/lag", kaka())).json()) as {
      lag: { kode: string; barn: string; antal: number }[];
      utanLag: number;
    };
    expect(svarLista.lag.find((l) => l.kode === "U2015")?.barn).toBe("Barn 1");
    expect(svarLista.lag.find((l) => l.kode === "U2015")?.antal).toBe(0);
    expect(typeof svarLista.utanLag).toBe("number");

    expect((await hämta("/api/lag/U2015", kaka(), { method: "DELETE", headers: { origin: ORIGIN } })).status).toBe(200);
    const efter = (await (await hämta("/api/lag", kaka())).json()) as { lag: { kode: string }[] };
    expect(efter.lag.find((l) => l.kode === "U2015")).toBeUndefined();
  });

  test("barnlistan visar antal pass och vilka namn som saknas i registret", async () => {
    // Flödets barn är Barn 2 sedan tidigare i filen. Innan Barn 2 finns i barn-tabellen ska hon
    // rapporteras som okänd — det är så ett stavfel ska synas.
    const före = (await (await hämta("/api/barn", kaka())).json()) as { okanda: string[] };
    expect(före.okanda).toContain("Barn 2");

    expect((await skriv("/api/barn", "POST", { namn: "Barn 2", farg: "#b45309", sortering: 2 })).status).toBe(200);

    const efter = (await (await hämta("/api/barn", kaka())).json()) as {
      barn: { namn: string; farg: string; antal: number }[];
      okanda: string[];
    };
    expect(efter.okanda).not.toContain("Barn 2");
    const barn2 = efter.barn.find((b) => b.namn === "Barn 2");
    expect(barn2?.farg).toBe("#b45309");
    expect(barn2!.antal).toBeGreaterThan(0);
  });

  test("de vuxna kommer ur databasen, inte ur koden", async () => {
    const svar = await hämta("/api/vuxna", kaka());
    expect(svar.status).toBe(200);
    const lista = (await svar.json()) as { namn: string; epost: string }[];
    expect(lista.length).toBeGreaterThan(0);
    expect(lista[0]).toHaveProperty("epost");
  });

  test("ett barn som används går inte att ta bort, ett oanvänt går bra", async () => {
    const använd = await hämta(`/api/barn/${encodeURIComponent("Barn 2")}`, kaka(), {
      method: "DELETE",
      headers: { origin: ORIGIN },
    });
    expect(använd.status).toBe(409);

    await skriv("/api/barn", "POST", { namn: "Oanvänd" });
    const oanvänd = await hämta(`/api/barn/${encodeURIComponent("Oanvänd")}`, kaka(), {
      method: "DELETE",
      headers: { origin: ORIGIN },
    });
    expect(oanvänd.status).toBe(200);
  });

  test("platslistan visar vilka platser som saknas", async () => {
    const svar = await hämta("/api/platser", kaka());
    expect(svar.status).toBe(200);
    const kropp = (await svar.json()) as { platser: unknown[]; okanda: { plats_text: string; antal: number }[] };
    expect(Array.isArray(kropp.platser)).toBe(true);
    expect(kropp.okanda.length).toBeGreaterThan(0);
  });

  test("en ny plats kopplas om direkt mot händelserna", async () => {
    const svar = await skriv("/api/platser", "POST", { namn: "Kärrtorps IP", lat: 59.2833, lon: 18.1167 });
    expect(svar.status).toBe(200);

    const rader = (await (await hämta("/api/platser", kaka())).json()) as { platser: { namn: string; antal: number }[] };
    const plats = rader.platser.find((p) => p.namn === "Kärrtorps IP");
    expect(plats).toBeDefined();
    expect(plats!.antal).toBeGreaterThan(0);
  });

  test("skrivning kräver samma ursprung", async () => {
    const svar = await hämta("/api/lag", kaka(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kode: "X1", barn: "Barn 1", sport: "bandy" }),
    });
    expect(svar.status).toBe(403);
  });

  test("barn får inte skriva", async () => {
    const barn = auth.upsertUser({ sub: "google-barn2", email: "barn2@example.com", name: "Barn 2" }, "barn");
    const svar = await hämta("/api/lag", `sport_session=${auth.issue({ uid: barn.id }, 60)}`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ kode: "X2", barn: "Barn 1", sport: "bandy" }),
    });
    expect(svar.status).toBe(403);
  });
});

describe("överstyrningar och kalenderfil", () => {
  const kaka = () => sessionFör("foralder1@example.com");
  const skriv = (väg: string, kropp: unknown) =>
    hämta(väg, kaka(), {
      method: "PATCH",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify(kropp),
    });

  let uid = "";
  let förälderId = 0;

  beforeAll(() => {
    const rad = db
      .query<{ uid: string }, []>("SELECT uid FROM events WHERE feed_id = 'test-server' ORDER BY start_ms LIMIT 1")
      .get();
    uid = rad?.uid ?? "";
    förälderId =
      db.query<{ id: number }, [string]>("SELECT id FROM users WHERE email = ?").get("foralder1@example.com")?.id ?? 0;
  });

  test("deltar ej går att sätta och syns i listan", async () => {
    expect((await skriv(`/api/overrides/test-server/${encodeURIComponent(uid)}`, { dold: true })).status).toBe(200);

    const FRAN = Date.UTC(2026, 10, 1);
    const TILL = Date.UTC(2026, 11, 1);
    const kropp = (await (
      await hämta(`/api/events?from=${FRAN}&to=${TILL}`, kaka())
    ).json()) as { handelser: { id: string }[] };
    expect(kropp.handelser.some((h) => h.id === `test-server|${uid}`)).toBe(false);
  });

  test("ansvarig med okänd förälder avvisas", async () => {
    const svar = await skriv(`/api/overrides/test-server/${encodeURIComponent(uid)}`, {
      ansvarig: { typ: "person", user_id: 999999 },
    });
    expect(svar.status).toBe(400);
  });

  test("ansvarig sätts och följer med i svaret", async () => {
    const svar = await skriv(`/api/overrides/test-server/${encodeURIComponent(uid)}`, {
      ansvarig: { typ: "person", user_id: förälderId },
      anteckning: "termos + svarta shorts",
    });
    expect(svar.status).toBe(200);
    const kropp = (await svar.json()) as { override: { ansvarig: { typ: string }; anteckning: string } };
    expect(kropp.override.ansvarig.typ).toBe("person");
    expect(kropp.override.anteckning).toContain("termos");
  });

  test("passvyn skickar med vem som ändrade och när", async () => {
    const svar = await hämta(`/api/pass/test-server/${encodeURIComponent(uid)}`, kaka());
    expect(svar.status).toBe(200);
    const kropp = (await svar.json()) as {
      handelse: { uppdateradAv: string | null; uppdaterad: number | null; beskrivning: string | null };
      krockar: unknown[];
    };
    expect(kropp.handelse.uppdateradAv).toBe("Test");
    expect(kropp.handelse.uppdaterad).toBeGreaterThan(0);
    expect(Array.isArray(kropp.krockar)).toBe(true);
  });

  test("passet finns inte ger 404", async () => {
    expect((await skriv("/api/overrides/test-server/finnsinte", { dold: true })).status).toBe(404);
  });

  test("kalenderfilen innehåller passet och samlingen som egen rad", async () => {
    const svar = await hämta(`/api/pass/test-server/${encodeURIComponent(uid)}.ics`, kaka());
    expect(svar.status).toBe(200);
    expect(svar.headers.get("content-type")).toContain("text/calendar");
    expect(svar.headers.get("content-disposition")).toContain("attachment");

    const text = await svar.text();
    expect(text).toContain("BEGIN:VCALENDAR");
    expect(text.match(/BEGIN:VEVENT/g)?.length).toBe(2);
    expect(text).toContain("SUMMARY:Samling");
    expect(text).toContain("RELATED-TO");
  });
});

describe("säkerhet i den statiska filservern", () => {
  const kaka = () => sessionFör("foralder1@example.com");

  test("att klättra ut ur public/ avvisas", async () => {
    // Kodade snedstreck klarar sig förbi URL-normaliseringen, så avkodningen skapar "../".
    for (const väg of ["/..%2f..%2f.env", "/%2e%2e%2f%2e%2e%2fapp%2fdata%2fsport.sqlite"]) {
      const svar = await hämta(väg, kaka());
      expect(svar.status).toBe(403);
      const text = await svar.text();
      expect(text).not.toContain("SESSION_SECRET");
      expect(text).not.toContain("SQLite format");
    }
  });

  test("manifest och service worker nås utan inloggning", async () => {
    // Utan detta får webbläsaren loginsidans HTML i stället för manifestet vid installation.
    for (const väg of ["/manifest.webmanifest", "/sw.js", "/ikon.svg"]) {
      const svar = await hämta(väg);
      expect([200, 404]).toContain(svar.status);
      expect(svar.headers.get("content-type") ?? "").not.toContain("text/html");
    }
  });
});

describe("dubbletter mellan flöden", () => {
  const kaka = () => sessionFör("foralder1@example.com");
  const FRAN = Date.UTC(2026, 10, 1);
  const TILL = Date.UTC(2026, 11, 1);

  test("samma pass i två flöden blir ett kort med båda barnen och utan falsk krock", async () => {
    // Två flöden med var sitt barn, och samma pass i båda. Det är så en match kan dyka upp
    // två gånger: barnets eget flöde och lagets.
    db.run(
      "INSERT OR IGNORE INTO feeds (id, child, sport, club, label, color, url) VALUES ('test-dubb', 'Barn 1', 'bandy', 'SBBK', 'Dubb', '#1d4ed8', 'https://example.test/dubb.ics')"
    );
    db.run("DELETE FROM feed_barn WHERE feed_id IN ('test-dubb', 'test-server')");
    db.run("INSERT INTO feed_barn (feed_id, barn) VALUES ('test-dubb', 'Barn 1')");
    db.run("INSERT INTO feed_barn (feed_id, barn) VALUES ('test-server', 'Barn 2')");

    const { tolkaFlode } = await import("../src/tolk.ts");
    const { sparaHandelser } = await import("../src/lagring.ts");
    const ics = await Bun.file(FIXTURE).text();

    // Samma flöde två gånger: identiska rader, alltså samma fingerprint men olika feed_id.
    const resultat = tolkaFlode(
      ics,
      { id: "test-dubb", label: "Dubb", samling_monster: null },
      { fran: FRAN, till: TILL }
    );
    sparaHandelser("test-dubb", resultat.handelser, Date.now());

    const kropp = (await (
      await hämta(`/api/events?from=${FRAN}&to=${TILL}`, kaka())
    ).json()) as { handelser: { titel: string; barn: string[]; floden: string[]; krock: unknown }[] };

    const match = kropp.handelser.filter((h) => h.titel === "Match: SBBK P16 - Hammarby IF");
    expect(match).toHaveLength(1);
    expect([...(match[0]?.barn ?? [])].sort()).toEqual(["Barn 1", "Barn 2"]);
    expect([...(match[0]?.floden ?? [])].sort()).toEqual(["test-dubb", "test-server"]);
    // Kopian får inte krocka med sig själv.
    expect(match[0]?.krock).toBeNull();
  });
});

describe("klubben hör till laget", () => {
  const kaka = () => sessionFör("foralder1@example.com");
  const FRAN = Date.UTC(2026, 10, 1);
  const TILL = Date.UTC(2026, 11, 1);

  test("två klubbar i samma källa ger rätt förening per lag", async () => {
    // Källan har klubb "SBBK" sedan tidigare. Laget hör till Södra Ängby IF, och laget ska vinna.
    const { tolkaFlode } = await import("../src/tolk.ts");
    const { sparaHandelser } = await import("../src/lagring.ts");

    db.run(
      "INSERT OR REPLACE INTO lag (kode, barn, sport, klubb) VALUES ('F2016', 'Barn 2', 'fotboll', 'Södra Ängby IF')"
    );

    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:fotboll-1@x",
      "DTSTART;TZID=Europe/Stockholm:20261110T180000",
      "DTEND;TZID=Europe/Stockholm:20261110T193000",
      "SUMMARY:Träning - F2016 Gul",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");

    const r = tolkaFlode(
      ics,
      { id: "test-server", label: "Test", samling_monster: null },
      { fran: FRAN, till: TILL }
    );
    sparaHandelser("test-server", r.handelser, Date.now());

    const kropp = (await (
      await hämta(`/api/events?from=${FRAN}&to=${TILL}`, kaka())
    ).json()) as { handelser: { titel: string; klubb: string | null; lag: string | null }[] };

    const fotboll = kropp.handelser.find((h) => h.titel === "Träning - F2016 Gul");
    expect(fotboll?.lag).toBe("F2016");
    expect(fotboll?.klubb).toBe("Södra Ängby IF");
  });

  test("när källan har två klubbar ärvs ingen av dem", async () => {
    // Samma källa får ett lag i den andra klubben, alltså två klubbar totalt. Då kan flödets
    // egen etikett inte längre användas som reserv — pass utan lagkod visas utan förening.
    const { tolkaFlode } = await import("../src/tolk.ts");
    const { sparaHandelser } = await import("../src/lagring.ts");

    db.run("INSERT OR REPLACE INTO lag (kode, barn, sport, klubb) VALUES ('U2015', 'Barn 1', 'bandy', 'SBBK')");

    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:bandy-1@x",
      "DTSTART;TZID=Europe/Stockholm:20261112T180000",
      "DTEND;TZID=Europe/Stockholm:20261112T193000",
      "SUMMARY:Träning - U2015",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:utan-lag@x",
      "DTSTART;TZID=Europe/Stockholm:20261113T180000",
      "DTEND;TZID=Europe/Stockholm:20261113T193000",
      "SUMMARY:Föreningsfest",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");

    const r = tolkaFlode(
      ics,
      { id: "test-server", label: "Test", samling_monster: null },
      { fran: FRAN, till: TILL }
    );
    sparaHandelser("test-server", r.handelser, Date.now());

    const kropp = (await (
      await hämta(`/api/events?from=${FRAN}&to=${TILL}`, kaka())
    ).json()) as { handelser: { titel: string; lag: string | null; klubb: string | null }[] };

    expect(kropp.handelser.find((h) => h.titel === "Träning - U2015")?.klubb).toBe("SBBK");
    expect(kropp.handelser.find((h) => h.titel === "Föreningsfest")?.klubb).toBeNull();
  });
});
