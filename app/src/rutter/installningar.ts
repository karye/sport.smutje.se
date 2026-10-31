/**
 * Inställningarna: flöden, lagmappning och platser.
 *
 * Allt som går att ändra i appen ska gå att ändra här, inte bara i ett kommandoradsverktyg.
 * Rutterna är tunna — de validerar, skriver och svarar — medan `Mer → Inställningar` blir det
 * gränssnitt som anropar dem.
 *
 * Skrivningar kräver förälder, samma ursprung och JSON, precis som `/api/refresh`.
 */
import { Elysia } from "elysia";
import { db } from "../db.ts";
import { lasPlatser } from "../hamtare.ts";
import { lagFor } from "../lagmappning.ts";
import { hittaPlats } from "../platser.ts";
import { inloggad, krävsApi, krävsForalder, krävsJson, sammaUrsprung } from "../skydd.ts";
import { tolkaFlode } from "../tolk.ts";
import type { Anvandare } from "../typer.ts";

interface NyttFlode {
  url?: unknown;
  etikett?: unknown;
  klubb?: unknown;
  sport?: unknown;
  barnLista?: unknown;
  filterMonster?: unknown;
  farg?: unknown;
}

interface FlodeRad {
  id: string;
  child: string;
  sport: string;
  club: string;
  label: string;
  color: string;
  url: string;
  aktiv: number;
  samling_monster: string | null;
  filter_monster: string | null;
  last_fetch_at: number | null;
  last_status: string | null;
  last_error: string | null;
  fel_i_rad: number;
  antal?: number;
}

/**
 * Adressen kan innehålla en hemlig nyckel (Sportadmins UUID fungerar som en nyckel). Därför visas
 * aldrig hela adressen. Men bara värden räckte inte: tre Sportadmin-flöden såg likadana ut.
 * Nu visas värden plus början av nyckeln, nog för att skilja dem åt och för litet för att använda.
 */
const värd = (url: string): string => {
  try {
    const u = new URL(url);

    // Sportadmin: ett långt UUID i queryn. Åtta tecken räcker för att skilja flödena åt.
    const id = u.searchParams.get("id");
    if (id) return `${u.host}${u.pathname}?id=${id.slice(0, 8)}…`;

    // SvenskaLag: en kort sifferkod i sökvägen. Tre tecken, aldrig hela.
    const sista = u.pathname.split("/").filter(Boolean).at(-1) ?? "";
    return `${u.host}/${sista.slice(0, 3)}…`;
  } catch {
    return "ogiltig adress";
  }
};

const SKRIVFEL = (): Response => Response.json({ fel: "Ogiltig förfrågan" }, { status: 403 });

/**
 * Gemensam grind för allt som ändrar något.
 *
 * `medKropp: false` för DELETE, som saknar body: kravet på JSON-typ ska bara gälla anrop som bär
 * data. Ursprunget kontrolleras alltid.
 */
function fårSkriva(request: Request, medKropp = true): Anvandare | Response {
  const anvandare = inloggad(request);
  if (!anvandare) return krävsApi();
  if (anvandare.roll !== "foralder") return krävsForalder();
  if (!sammaUrsprung(request)) return SKRIVFEL();
  if (medKropp && !krävsJson(request)) return SKRIVFEL();
  return anvandare;
}

const somText = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export const installningsRutter = new Elysia()
  /* ---------------------------------------------------------------- barn och vuxna */

  /**
   * Barnen som data. `okanda` är namn som används i flöden eller lagmappning men saknas här —
   * de kommer av ett stavfel, och då ska de synas i stället för att bli ett tyst tredje barn.
   */
  .get("/api/barn", ({ request }) => {
    if (!inloggad(request)) return krävsApi();

    const barn = db
      .query<{ namn: string; farg: string; sortering: number; antal: number }, []>(
        `SELECT b.namn, b.farg, b.sortering,
                (SELECT COUNT(*) FROM events e
                 LEFT JOIN lag l ON l.kode = e.lag
                 WHERE l.barn = b.namn
                    OR (l.barn IS NULL AND EXISTS (
                          SELECT 1 FROM feed_barn fb WHERE fb.feed_id = e.feed_id AND fb.barn = b.namn
                       ))) AS antal
         FROM barn b ORDER BY b.sortering, b.namn`
      )
      .all();

    const kanda = new Set(barn.map((b) => b.namn));
    const använda = new Set<string>();
    // Kolumnen måste aliases till n, annars heter egenskapen barn respektive child och r.n blir undefined.
    for (const r of db.query<{ n: string }, []>("SELECT DISTINCT barn AS n FROM lag").all()) använda.add(r.n);
    for (const r of db.query<{ n: string }, []>("SELECT DISTINCT child AS n FROM feeds").all()) använda.add(r.n);
    for (const r of db.query<{ n: string }, []>("SELECT DISTINCT barn AS n FROM feed_barn").all()) använda.add(r.n);
    const okanda = [...använda].filter((n) => !kanda.has(n)).sort();

    return { barn, okanda };
  })

  .post("/api/barn", async ({ request }) => {
    const grind = fårSkriva(request);
    if (grind instanceof Response) return grind;

    const kropp = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const namn = somText(kropp?.namn);
    const farg = somText(kropp?.farg) ?? "#1d4ed8";
    if (!namn) return Response.json({ fel: "namn krävs" }, { status: 400 });

    db.run(
      `INSERT INTO barn (namn, farg, sortering) VALUES (?, ?, ?)
       ON CONFLICT(namn) DO UPDATE SET farg = excluded.farg, sortering = excluded.sortering`,
      [namn, farg, Number.isFinite(Number(kropp?.sortering)) ? Number(kropp?.sortering) : 0]
    );
    return { ok: true, namn };
  })

  .delete("/api/barn/:namn", ({ request, params }) => {
    const grind = fårSkriva(request, false);
    if (grind instanceof Response) return grind;

    const namn = decodeURIComponent(params.namn);
    // feed_barn är den koppling som faktiskt styr vilka barn ett flöde gäller. Utan den här raden
    // gick det att radera ett barn som låg som andra barn på ett delat flöde.
    const används =
      (db.query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM lag WHERE barn = ?").get(namn)?.n ?? 0) +
      (db.query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM feeds WHERE child = ?").get(namn)?.n ?? 0) +
      (db.query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM feed_barn WHERE barn = ?").get(namn)?.n ?? 0);

    if (används > 0) return Response.json({ fel: `${namn} används av ${används} flöden eller lag` }, { status: 409 });

    db.run("DELETE FROM barn WHERE namn = ?", [namn]);
    return { ok: true };
  })

  /**
   * De vuxna. Namnen kommer från Google-profilen vid inloggning och är alltså redan data, inte kod
   * — det enda som är fast är rollen, och den sätts av allowlistan i `.env`.
   */
  .get("/api/vuxna", ({ request }) => {
    if (!inloggad(request)) return krävsApi();
    return db
      .query<{ id: number; namn: string; epost: string; senast: string | null }, []>(
        "SELECT id, display_name AS namn, email AS epost, last_seen_at AS senast FROM users WHERE roll = 'foralder' ORDER BY display_name"
      )
      .all();
  })

  /* ---------------------------------------------------------------- sporter */

  .get("/api/sport", ({ request }) => {
    if (!inloggad(request)) return krävsApi();

    return db
      .query<{ namn: string; farg: string; antal: number }, []>(
        `SELECT s.namn, s.farg,
                (SELECT COUNT(*) FROM events e
                 LEFT JOIN lag l ON l.kode = e.lag
                 LEFT JOIN feeds f ON f.id = e.feed_id
                 WHERE COALESCE(e.sport_titel, l.sport, f.sport) = s.namn) AS antal
         FROM sport s ORDER BY s.namn`
      )
      .all();
  })

  .post("/api/sport", async ({ request }) => {
    const grind = fårSkriva(request);
    if (grind instanceof Response) return grind;

    const kropp = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const namn = somText(kropp?.namn)?.toLowerCase();
    const farg = somText(kropp?.farg);
    if (!namn || !farg) return Response.json({ fel: "namn och farg krävs" }, { status: 400 });

    db.run(
      `INSERT INTO sport (namn, farg) VALUES (?, ?)
       ON CONFLICT(namn) DO UPDATE SET farg = excluded.farg`,
      [namn, farg]
    );

    return { ok: true, namn };
  })

  /* ---------------------------------------------------------------- flöden */

  .get("/api/feeds", ({ request }) => {
    if (!inloggad(request)) return krävsApi();

    const rader = db
      .query<FlodeRad, []>(
        `SELECT f.id, f.child, f.sport, f.club, f.label, f.color, f.url, f.aktiv,
                f.samling_monster, f.filter_monster, f.last_fetch_at, f.last_status, f.last_error, f.fel_i_rad,
                (SELECT COUNT(*) FROM events e WHERE e.feed_id = f.id) AS antal
         FROM feeds f ORDER BY f.id`
      )
      .all();

    const kopplingar = new Map<string, string[]>();
    for (const r of db.query<{ feed_id: string; barn: string }, []>("SELECT feed_id, barn FROM feed_barn").all()) {
      const lista = kopplingar.get(r.feed_id) ?? [];
      lista.push(r.barn);
      kopplingar.set(r.feed_id, lista);
    }

    return rader.map((f) => ({
      id: f.id,
      barn: f.child,
      barnLista: kopplingar.get(f.id) ?? [f.child],
      sport: f.sport,
      klubb: f.club,
      etikett: f.label,
      farg: f.color,
      aktiv: f.aktiv === 1,
      samlingMonster: f.samling_monster,
      filterMonster: f.filter_monster,
      vard: värd(f.url),
      antal: f.antal ?? 0,
      senastHamtad: f.last_fetch_at,
      status: f.last_status,
      fel: f.last_error,
      felIRad: f.fel_i_rad,
    }));
  })

  .patch("/api/feeds/:id", async ({ request, params }) => {
    const grind = fårSkriva(request);
    if (grind instanceof Response) return grind;

    const kropp = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!kropp) return Response.json({ fel: "Ogiltig JSON" }, { status: 400 });

    const finns = db.query<{ id: string }, [string]>("SELECT id FROM feeds WHERE id = ?").get(params.id);
    if (!finns) return Response.json({ fel: "Flödet finns inte" }, { status: 404 });

    // Bara de fält som skickades rörs. Att skriva null i ett fält som inte nämndes gav
    // "NOT NULL constraint failed: feeds.sport" — ett fel som såg ut som en serverkrasch.
    const uppdateringar: [string, string | number | null][] = [];

    const textFält: [string, string][] = [
      ["barn", "child"],
      ["sport", "sport"],
      ["klubb", "club"],
      ["etikett", "label"],
      ["farg", "color"],
    ];
    for (const [nyckel, kolumn] of textFält) {
      if (!(nyckel in kropp)) continue;
      const värde = somText(kropp[nyckel]);
      if (!värde) return Response.json({ fel: `${nyckel} får inte vara tomt` }, { status: 400 });
      uppdateringar.push([kolumn, värde]);
    }

    // Flödets barn är en lista: en föreningskalender kan gälla syskon i samma lag.
    if ("barnLista" in kropp) {
      if (!Array.isArray(kropp.barnLista) || kropp.barnLista.some((b) => typeof b !== "string")) {
        return Response.json({ fel: "barnLista måste vara en lista med namn" }, { status: 400 });
      }
      const namn = (kropp.barnLista as string[]).map((b) => b.trim()).filter(Boolean);
      if (namn.length === 0) return Response.json({ fel: "Minst ett barn krävs" }, { status: 400 });

      db.run("DELETE FROM feed_barn WHERE feed_id = ?", [params.id]);
      for (const b of namn) db.run("INSERT OR IGNORE INTO feed_barn (feed_id, barn) VALUES (?, ?)", [params.id, b]);
      // Reserven för händelser utan lagkod blir det första namnet.
      uppdateringar.push(["child", namn[0] ?? ""]);
    }

    // Enskilt barn (den gamla formen) ska också uppdatera kopplingen, annars pekar flödet på ett
    // barn som inte längre står i listan.
    if ("barn" in kropp && !("barnLista" in kropp)) {
      const b = somText(kropp.barn);
      if (b) {
        db.run("DELETE FROM feed_barn WHERE feed_id = ?", [params.id]);
        db.run("INSERT OR IGNORE INTO feed_barn (feed_id, barn) VALUES (?, ?)", [params.id, b]);
      }
    }

    // En sport som inte finns i registret får en neutral färg i stället för ingen prick alls.
    const sportNamn = somText(kropp.sport)?.toLowerCase();
    if (sportNamn) {
      db.run("INSERT OR IGNORE INTO sport (namn, farg) VALUES (?, ?)", [sportNamn, "#64748b"]);
    }

    if ("samlingMonster" in kropp) uppdateringar.push(["samling_monster", somText(kropp.samlingMonster)]);
    if ("filterMonster" in kropp) uppdateringar.push(["filter_monster", somText(kropp.filterMonster)]);
    if ("aktiv" in kropp) {
      if (typeof kropp.aktiv !== "boolean") return Response.json({ fel: "aktiv måste vara boolean" }, { status: 400 });
      uppdateringar.push(["aktiv", kropp.aktiv ? 1 : 0]);
    }

    for (const [kolumn, värde] of uppdateringar) {
      db.run(`UPDATE feeds SET ${kolumn} = ? WHERE id = ?`, [värde, params.id]);
    }

    // Ny adress: https krävs, webcal byts, och den provas innan den sparas.
    const nyUrl = somText(kropp.url);
    if (nyUrl) {
      const url = nyUrl.replace(/^webcal:\/\//i, "https://");
      if (!/^https:\/\//i.test(url)) return Response.json({ fel: "Adressen måste vara https" }, { status: 400 });

      const prov = await prova(url, params.id);
      if (!prov.ok) return Response.json({ fel: prov.fel }, { status: 400 });

      db.run("UPDATE feeds SET url = ?, etag = NULL, last_modified = NULL WHERE id = ?", [url, params.id]);
    }

    return { ok: true };
  })

  /**
   * Lägger till ett flöde. Adressen provas först, så att en felstavad adress aldrig sparas som
   * ett tomt flöde. `id` görs om till något läsbart av etiketten.
   */
  .post("/api/feeds", async ({ request }) => {
    const grind = fårSkriva(request);
    if (grind instanceof Response) return grind;

    const kropp = (await request.json().catch(() => null)) as NyttFlode | null;
    const rå = somText(kropp?.url)?.replace(/^webcal:\/\//i, "https://");
    if (!rå || !/^https:\/\//i.test(rå)) return Response.json({ fel: "Adressen måste vara https eller webcal" }, { status: 400 });

    const etikett = somText(kropp?.etikett) ?? "Nytt flöde";
    const sport = somText(kropp?.sport) ?? "okänd";
    const klubb = somText(kropp?.klubb) ?? "okänd";
    const filterMonster = somText(kropp?.filterMonster);

    const barn = Array.isArray(kropp?.barnLista)
      ? (kropp.barnLista as string[]).map((b) => b.trim()).filter(Boolean)
      : [];
    if (barn.length === 0) return Response.json({ fel: "Minst ett barn krävs" }, { status: 400 });

    const prov = await prova(rå, "prov", filterMonster);
    if (!prov.ok) return Response.json({ fel: prov.fel }, { status: 400 });

    const id = etikett
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40);
    if (!id) return Response.json({ fel: "Etiketten ger inget id" }, { status: 400 });
    if (db.query<{ id: string }, [string]>("SELECT id FROM feeds WHERE id = ?").get(id)) {
      return Response.json({ fel: `Flödet "${id}" finns redan` }, { status: 409 });
    }

    db.run(
      `INSERT INTO feeds (id, child, sport, club, label, color, url, aktiv, filter_monster)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [id, barn[0] ?? "Familjen", sport, klubb, etikett, somText(kropp?.farg) ?? "#64748b", rå, filterMonster]
    );
    for (const b of barn) db.run("INSERT OR IGNORE INTO feed_barn (feed_id, barn) VALUES (?, ?)", [id, b]);
    db.run("INSERT OR IGNORE INTO sport (namn, farg) VALUES (?, ?)", [sport, "#64748b"]);

    return { ok: true, id, antal: prov.antal, filtrerade: prov.antalFiltrerade };
  })

  /** Provhämtar en adress utan att spara något: svarar antal händelser och första datum. */
  .post("/api/feeds/testa", async ({ request }) => {
    const grind = fårSkriva(request);
    if (grind instanceof Response) return grind;

    const kropp = (await request.json().catch(() => null)) as { url?: unknown; filterMonster?: unknown } | null;
    const url = somText(kropp?.url)?.replace(/^webcal:\/\//i, "https://");
    if (!url || !/^https:\/\//i.test(url)) return Response.json({ fel: "Adressen måste vara https" }, { status: 400 });

    const prov = await prova(url, "prov", somText(kropp?.filterMonster));
    return prov.ok
      ? { ok: true, antal: prov.antal, filtrerade: prov.antalFiltrerade, första: prov.första, namn: prov.namn }
      : Response.json({ fel: prov.fel }, { status: 400 });
  })

  /* ---------------------------------------------------------------- lag */

  .get("/api/lag", ({ request }) => {
    if (!inloggad(request)) return krävsApi();

    // Antalet händelser per lagkod gör listan begriplig: en kod utan händelser är antingen ny
    // eller felstavad, och det syns bara om siffran står där.
    const lag = db
      .query<{ kode: string; barn: string; sport: string; farg: string | null; klubb: string | null; monster: string | null; antal: number }, []>(
        `SELECT l.kode, l.barn, l.sport, l.farg, l.klubb, l.monster,
                (SELECT COUNT(*) FROM events e WHERE e.lag = l.kode) AS antal
         FROM lag l ORDER BY l.kode`
      )
      .all();

    const utanLag = db
      .query<{ n: number }, []>("SELECT COUNT(*) AS n FROM events WHERE lag IS NULL")
      .get();

    return { lag, utanLag: utanLag?.n ?? 0 };
  })

  .post("/api/lag", async ({ request }) => {
    const grind = fårSkriva(request);
    if (grind instanceof Response) return grind;

    const kropp = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const kode = somText(kropp?.kode)?.toUpperCase();
    const barn = somText(kropp?.barn);
    const sport = somText(kropp?.sport);
    const klubb = somText(kropp?.klubb);

    // Klubben hör till laget. Utan den kan passet inte visa någon förening alls, och då är
    // mappningen halvfärdig — hellre ett tydligt fel här än tysta kort utan förening.
    if (!kode || !sport || !klubb) {
      return Response.json({ fel: "kode, sport och klubb krävs" }, { status: 400 });
    }

    db.run(
      `INSERT INTO lag (kode, barn, sport, farg, klubb, monster) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(kode) DO UPDATE SET barn = excluded.barn, sport = excluded.sport,
         farg = excluded.farg, klubb = excluded.klubb, monster = excluded.monster`,
      // barn = null betyder "ärv källans barn", som för en gemensam lagkalender.
      [kode, barn, sport, somText(kropp?.farg), klubb, somText(kropp?.monster)]
    );

    // Reglerna kan ha ändrats, alltså måste händelserna kopplas om — annars slår en ny regel
    // igenom först vid nästa hämtning, och det ser ut som att inställningen inte tog.
    const ändrade = kopplaLagOm();
    return { ok: true, kode, ändrade };
  })

  .delete("/api/lag/:kode", ({ request, params }) => {
    const grind = fårSkriva(request, false);
    if (grind instanceof Response) return grind;
    db.run("DELETE FROM lag WHERE kode = ?", [params.kode.toUpperCase()]);
    kopplaLagOm();
    return { ok: true };
  })

  /* ---------------------------------------------------------------- platser */

  .get("/api/platser", ({ request }) => {
    if (!inloggad(request)) return krävsApi();
    const rader = db
      .query<{ id: number; namn: string; adress: string | null; lat: number | null; lon: number | null; antal: number }, []>(
        `SELECT p.id, p.namn, p.adress, p.lat, p.lon,
                (SELECT COUNT(*) FROM events e WHERE e.plats_id = p.id) AS antal
         FROM platser p ORDER BY p.namn`
      )
      .all();

    // Platser som flödena använder men registret saknar. Det är de som ska fyllas i.
    const okanda = db
      .query<{ plats_text: string; antal: number }, []>(
        `SELECT plats_text, COUNT(*) AS antal FROM events
         WHERE plats_id IS NULL AND plats_text IS NOT NULL
         GROUP BY plats_text ORDER BY antal DESC`
      )
      .all();

    return { platser: rader, okanda };
  })

  .post("/api/platser", async ({ request }) => {
    const grind = fårSkriva(request);
    if (grind instanceof Response) return grind;

    const kropp = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const namn = somText(kropp?.namn);
    const lat = Number(kropp?.lat);
    const lon = Number(kropp?.lon);
    if (!namn || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      return Response.json({ fel: "namn, lat och lon krävs" }, { status: 400 });
    }

    const normaliserat = hittaPlats(namn, [])?.normaliserat ?? normalisera(namn);
    db.run(
      `INSERT INTO platser (namn, normaliserat, adress, lat, lon) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(normaliserat) DO UPDATE SET namn = excluded.namn, adress = excluded.adress,
         lat = excluded.lat, lon = excluded.lon`,
      [namn, normaliserat, somText(kropp?.adress), lat, lon]
    );

    kopplaOm();
    return { ok: true, normaliserat };
  })

  .patch("/api/platser/:id", async ({ request, params }) => {
    const grind = fårSkriva(request);
    if (grind instanceof Response) return grind;

    const kropp = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!kropp) return Response.json({ fel: "Ogiltig JSON" }, { status: 400 });

    const id = Number(params.id);
    if (!Number.isInteger(id)) return Response.json({ fel: "Ogiltigt id" }, { status: 400 });

    if (typeof kropp.lat === "number" && typeof kropp.lon === "number") {
      db.run("UPDATE platser SET lat = ?, lon = ? WHERE id = ?", [kropp.lat, kropp.lon, id]);
    }
    if (typeof kropp.adress === "string" || kropp.adress === null) {
      db.run("UPDATE platser SET adress = ? WHERE id = ?", [kropp.adress, id]);
    }
    if (typeof kropp.namn === "string" && kropp.namn.trim()) {
      db.run("UPDATE platser SET namn = ? WHERE id = ?", [kropp.namn.trim(), id]);
    }

    return { ok: true };
  });

/* ------------------------------------------------------------------ hjälpare */

function normalisera(namn: string): string {
  // Samma regel som platser.ts, men utan att importera hela matchningen hit.
  return namn
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(plan|planen|hallen|hall|idrottsplats|idrottshall|arena|arenan|ip|bk|if|ff|fc|sk|hk|aik|ais)\b/g, " ")
    .replace(/[0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Kopplar om händelsernas lagkod mot lagmappningen, utan att hämta flödena igen.
 * Samma princip som för platserna: tolkningen gjorde jobbet en gång, men reglerna kan ändras.
 */
export function kopplaLagOm(): number {
  const regler = db.query<{ kode: string; monster: string | null }, []>("SELECT kode, monster FROM lag").all();
  const händelser = db
    .query<{ feed_id: string; uid: string; titel: string; lag: string | null }, []>(
      "SELECT feed_id, uid, titel, lag FROM events"
    )
    .all();

  let ändrade = 0;
  const kör = db.transaction(() => {
    for (const h of händelser) {
      const ny = lagFor(h.titel, regler);
      if (ny !== h.lag) {
        db.run("UPDATE events SET lag = ? WHERE feed_id = ? AND uid = ?", [ny, h.feed_id, h.uid]);
        ändrade++;
      }
    }
  });
  kör();
  return ändrade;
}

/** Kopplar om alla händelser mot platsregistret. Körs när en plats lagts till eller ändrats. */
export function kopplaOm(): number {
  const platser = lasPlatser();
  const händelser = db
    .query<{ feed_id: string; uid: string; plats_text: string | null; plats_id: number | null }, []>(
      "SELECT feed_id, uid, plats_text, plats_id FROM events WHERE plats_text IS NOT NULL"
    )
    .all();

  let ändrade = 0;
  const kör = db.transaction(() => {
    for (const h of händelser) {
      const plats = hittaPlats(h.plats_text, platser);
      if ((plats?.id ?? null) !== h.plats_id) {
        db.run("UPDATE events SET plats_id = ? WHERE feed_id = ? AND uid = ?", [plats?.id ?? null, h.feed_id, h.uid]);
        ändrade++;
      }
    }
  });
  kör();
  return ändrade;
}

interface Prov {
  ok: boolean;
  fel?: string;
  antal?: number;
  antalFiltrerade?: number;
  första?: number;
  namn?: string | null;
}

/** Hämtar och tolkar en adress utan att spara. Svarar med antal och första datum. */
async function prova(url: string, feedId: string, filterMonster?: string | null): Promise<Prov> {
  try {
    const svar = await fetch(url, {
      headers: { "User-Agent": "sport.smutje.se/1.0 (+familjekalender)" },
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
    });
    if (!svar.ok) return { ok: false, fel: `Adressen svarade ${svar.status}` };

    const text = await svar.text();
    if (text.length > 5 * 1024 * 1024) return { ok: false, fel: "Svaret är större än 5 MB" };

    const nu = Date.now();
    const resultat = tolkaFlode(
      text,
      { id: feedId, label: feedId, samling_monster: null, filter_monster: filterMonster ?? null },
      { fran: nu - 30 * 86_400_000, till: nu + 400 * 86_400_000 },
      lasPlatser()
    );

    if (resultat.handelser.length === 0) {
      return {
        ok: false,
        fel: filterMonster
          ? `Filtret "${filterMonster}" matchade inga av ${resultat.antalFiltrerade} händelser. Prova ett vidare filter.`
          : "Inga händelser i fönstret. En SvenskaLag-adress med .ics på slutet svarar Borttaget och noll händelser.",
      };
    }

    const namn = /X-WR-CALNAME[^:]*:(.*)/i.exec(text)?.[1]?.trim() ?? null;
    return {
      ok: true,
      antal: resultat.handelser.length,
      antalFiltrerade: resultat.antalFiltrerade,
      första: resultat.handelser[0]?.start_ms,
      namn,
    };
  } catch (fel) {
    return { ok: false, fel: fel instanceof Error ? fel.message : String(fel) };
  }
}
