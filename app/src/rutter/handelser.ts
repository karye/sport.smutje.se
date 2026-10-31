/**
 * API:t för händelser.
 *
 * Krockarna räknas här, inte i klienten. Samma logik i tre vyer blir annars tre svar på samma
 * fråga, och den som tittar i månaden får ett annat besked än den som tittar i veckan.
 */
import { Elysia } from "elysia";
import { db } from "../db.ts";
import { beraknaKrockar } from "../krock.ts";
import { hamtaAlla, lasPlatser } from "../hamtare.ts";
import { inloggad, krävsApi, krävsForalder, krävsJson, sammaUrsprung } from "../skydd.ts";
import { klockslag, tillUtc } from "../tid.ts";
import { isoVecka, veckoIntervall } from "../tid.ts";
import type { Ansvarig, KrockPass } from "../typer.ts";

/** Ett svar får spänna över högst två månader. Skyddar mot ett intervall på tio år. */
const MAX_DAGAR = 62;
const REFRESH_SPARR_MS = 60_000;

let senasteRefresh = 0;

interface Rad {
  feed_id: string;
  uid: string;
  fingerprint: string;
  titel: string;
  lag: string | null;
  sport_titel: string | null;
  beskrivning: string | null;
  plats_text: string | null;
  plats_id: number | null;
  start_ms: number;
  slut_ms: number;
  heldag: number;
  ics_status: string;
  samling_ms: number | null;
  samling_kalla: string | null;
  motstandare: string | null;
  flerdygn: number;
  child: string;
  sport: string;
  club: string;
  color: string;
  lag_barn: string | null;
  lag_sport: string | null;
  lag_farg: string | null;
  lag_klubb: string | null;
  barn_farg: string | null;
  sport_farg: string | null;
  dold: number | null;
  ansvarig_typ: string | null;
  ansvarig_user_id: number | null;
  anteckning: string | null;
  samling_override: number | null;
  ansvarig_namn: string | null;
  uppdaterad_av: string | null;
  uppdaterad: number | null;
  missing_since: number | null;
}

const SQL = `
SELECT e.feed_id, e.uid, e.fingerprint, e.titel, e.lag, e.sport_titel, e.beskrivning, e.plats_text, e.plats_id,
       e.start_ms, e.slut_ms, e.heldag, e.ics_status, e.samling_ms, e.samling_kalla,
       e.motstandare, e.flerdygn, e.missing_since,
       f.child, f.sport, f.club, f.color,
       l.barn AS lag_barn, l.sport AS lag_sport, l.farg AS lag_farg, l.klubb AS lag_klubb,
       b.farg AS barn_farg,
       s.farg AS sport_farg,
       o.dold, o.ansvarig_typ, o.ansvarig_user_id, o.anteckning,
       o.samling_ms AS samling_override, u.display_name AS ansvarig_namn,
       uu.display_name AS uppdaterad_av, o.updated_at AS uppdaterad
FROM events e
JOIN feeds f ON f.id = e.feed_id
LEFT JOIN overrides o ON o.feed_id = e.feed_id AND o.uid = e.uid
LEFT JOIN users u ON u.id = o.ansvarig_user_id
LEFT JOIN users uu ON uu.id = o.updated_by
LEFT JOIN lag l ON l.kode = e.lag
LEFT JOIN barn b ON b.namn = COALESCE(l.barn, f.child)
LEFT JOIN sport s ON s.namn = COALESCE(e.sport_titel, l.sport, f.sport)
WHERE f.aktiv = 1 AND e.start_ms <= ? AND e.slut_ms >= ?
ORDER BY e.start_ms, e.feed_id
`;

/**
 * Standardintervallet är innevarande ISO-vecka. Att kräva `from`/`to` av klienten gör att
 * veckovyn och månadsvyn kan fråga olika, men defaulten ska vara meningsfull ändå.
 */
function intervall(url: URL): { fran: number; till: number } | { fel: string } {
  const från = url.searchParams.get("from");
  const till = url.searchParams.get("to");

  if (från && till) {
    const f = Number(från);
    const t = Number(till);
    if (!Number.isFinite(f) || !Number.isFinite(t)) return { fel: "from och to måste vara epoch-ms" };
    if (t <= f) return { fel: "to måste vara större än from" };
    if (t - f > MAX_DAGAR * 86_400_000) return { fel: `intervallet får vara högst ${MAX_DAGAR} dagar` };
    return { fran: f, till: t };
  }

  const { ar, vecka } = isoVecka(Date.now());
  return veckoIntervall(ar, vecka);
}

/**
 * Barnen ett pass gäller.
 *
 * Laget först: en lagkod hör till ett barn. Saknas koden gäller passet alla barn som flödet är
 * kopplat till, vilket är rätt för en föreningskalender som ett syskonpar delar.
 */
let feedBarn: Map<string, string[]> = new Map();
let barnFärger: Map<string, string> = new Map();

export function laddaFeedBarn(): void {
  const färger = new Map<string, string>();
  for (const r of db.query<{ namn: string; farg: string }, []>("SELECT namn, farg FROM barn").all()) {
    färger.set(r.namn, r.farg);
  }
  barnFärger = färger;

  const karta = new Map<string, string[]>();
  for (const r of db.query<{ feed_id: string; barn: string }, []>("SELECT feed_id, barn FROM feed_barn").all()) {
    const lista = karta.get(r.feed_id) ?? [];
    lista.push(r.barn);
    karta.set(r.feed_id, lista);
  }
  feedBarn = karta;
}

function barnFor(rad: Rad): string[] {
  if (rad.lag_barn) return [rad.lag_barn];
  const lista = feedBarn.get(rad.feed_id);
  return lista && lista.length > 0 ? lista : [rad.child];
}

/** Sporten: titeln först (blandade sporter), sedan laget, sedan flödet. */
function sportFor(rad: Rad): string {
  return rad.sport_titel ?? rad.lag_sport ?? rad.sport;
}

/** Färgen: lagets egen först, annars barnets, annars flödets. Ett barn har samma färg överallt. */
function fargFor(rad: Rad): string {
  return rad.lag_farg ?? rad.barn_farg ?? rad.color;
}

/** Alla inblandade barns färger. Två barn på samma pass ska synas som två färger, inte en. */
function fargLista(rad: Rad): string[] {
  if (rad.lag_farg) return [rad.lag_farg];
  const lista = barnFor(rad).map((b) => barnFärger.get(b) ?? rad.color);
  return lista.length > 0 ? [...new Set(lista)] : [rad.color];
}

/** Klubben: lagets först, flödets som reserv. */
function klubbFor(rad: Rad): string {
  return rad.lag_klubb ?? rad.club;
}

/**
 * Sant när passet inte går att tillskriva ett barn säkert: flödet gäller flera barn och titeln
 * saknar lagkod. Sådana pass räknas inte som krockar — en gissning hade givit falska varningar
 * varje dag i en klubbkalender som täcker alla lag.
 */
function ärOmappad(rad: Rad): boolean {
  if (rad.lag_barn) return false;
  return (feedBarn.get(rad.feed_id)?.length ?? 0) > 1;
}

function tillAnsvarig(rad: Rad): Ansvarig {
  const typ = rad.ansvarig_typ;
  if (typ === "person" || typ === "samakning" || typ === "egen") {
    return { typ, user_id: rad.ansvarig_user_id };
  }
  return { typ: "ingen", user_id: null };
}

/** Ett pass som klienten ser det. Krocken skickas med, färdigräknad. */
function tillKort(
  r: Rad,
  k: ReturnType<typeof beraknaKrockar> extends Map<string, infer V> ? V | undefined : never,
  medBeskrivning = false
) {
  return {
    id: `${r.feed_id}|${r.uid}`,
    titel: r.titel,
    lag: r.lag,
    barn: barnFor(r),
    sport: sportFor(r),
    sportFarg: r.sport_farg,
    klubb: klubbFor(r),
    fargLista: fargLista(r),
    omappad: ärOmappad(r),
    farg: fargFor(r),
    start: r.start_ms,
    slut: r.slut_ms,
    heldag: r.heldag === 1,
    flerdygn: r.flerdygn === 1,
    plats: r.plats_text,
    platsKand: r.plats_id != null,
    samling: r.samling_override ?? r.samling_ms,
    samlingKalla: r.samling_override != null ? "manuell" : r.samling_kalla,
    motstandare: r.motstandare,
    beskrivning: medBeskrivning ? r.beskrivning : null,
    status: r.ics_status,
    dold: r.dold === 1,
    ansvarig: tillAnsvarig(r),
    ansvarigNamn: r.ansvarig_namn,
    anteckning: r.anteckning,
    uppdateradAv: r.uppdaterad_av,
    uppdaterad: r.uppdaterad,
    krock: k
      ? { typ: k.typ, mot: k.mot, glappMin: k.glappMin, restidMin: k.restidMin, olost: k.olost, sammaBarn: k.sammaBarn }
      : null,
  };
}

/**
 * Kalenderfil för ett pass. Samlingen läggs som en egen VEVENT med RELATED-TO, så att både
 * "Samling 09:15" och "Match 10:00" hamnar som egna rader i telefonens kalender.
 */
function somKalenderfil(uid: string, rad: Rad): Response {
  const samling = rad.samling_override ?? rad.samling_ms;
  const utc = (ms: number): string => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const rensa = (t: string): string =>
    t.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
  const nyckel = `${uid}@sport.smutje.se`;

  const rader: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//sport.smutje.se//familjekalender//SV",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${nyckel}`,
    `DTSTAMP:${utc(Date.now())}`,
    `DTSTART:${utc(rad.start_ms)}`,
    `DTEND:${utc(rad.slut_ms)}`,
    `SUMMARY:${rensa(rad.titel)}`,
    ...(rad.plats_text ? [`LOCATION:${rensa(rad.plats_text)}`] : []),
    ...(rad.beskrivning ? [`DESCRIPTION:${rensa(rad.beskrivning)}`] : []),
    "END:VEVENT",
  ];

  if (samling != null) {
    rader.push(
      "BEGIN:VEVENT",
      `UID:${nyckel}-samling`,
      `DTSTAMP:${utc(Date.now())}`,
      `DTSTART:${utc(samling)}`,
      `DTEND:${utc(Math.min(samling + 15 * 60_000, rad.start_ms))}`,
      `SUMMARY:${rensa(`Samling – ${rad.titel}`)}`,
      `DESCRIPTION:${rensa(`Samling ${klockslag(samling)}${rad.plats_text ? ` på ${rad.plats_text}` : ""}.`)}`,
      `RELATED-TO:${nyckel}`,
      "END:VEVENT"
    );
  }

  rader.push("END:VCALENDAR");

  return new Response(rader.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${rad.feed_id}-${uid.slice(0, 12)}.ics"`,
      "Cache-Control": "no-store",
    },
  });
}

export const handelseRutter = new Elysia()
  .get("/api/events", ({ request }) => {
    const anvandare = inloggad(request);
    if (!anvandare) return krävsApi();

    const url = new URL(request.url);
    const spann = intervall(url);
    if ("fel" in spann) return Response.json({ fel: spann.fel }, { status: 400 });

    // Dolda pass har ingen naturlig plats i tiden, så de hämtas för sig utan datumspann.
    if (url.searchParams.get("dolda") === "1") {
      if (anvandare.roll !== "foralder") return krävsForalder();
      laddaFeedBarn();
      const dolda = db
        .query<Rad, []>(`${SQL.replace("AND e.start_ms <= ? AND e.slut_ms >= ?", "AND o.dold = 1")} LIMIT 200`)
        .all();
      return { fran: 0, till: 0, handelser: dolda.map((r) => tillKort(r, undefined)) };
    }

    const visaDolda = url.searchParams.get("includeHidden") === "1" && anvandare.roll === "foralder";
    const barnFilter = (url.searchParams.get("barn") ?? "")
      .split(",")
      .map((b) => b.trim().toLowerCase())
      .filter(Boolean);

    laddaFeedBarn();
    const rader = db.query<Rad, [number, number]>(SQL).all(spann.till, spann.fran);
    const platser = new Map(lasPlatser().map((p) => [p.id, p]));

    const valda = rader
      .filter((r) => visaDolda || r.dold !== 1)
      .filter(
        (r) => barnFilter.length === 0 || barnFor(r).some((b) => barnFilter.includes(b.toLowerCase()))
      );

    const pass: KrockPass[] = valda.map((r) => ({
      id: `${r.feed_id}|${r.uid}`,
      barn: barnFor(r),
      plats_id: r.plats_id,
      samling_ms: r.samling_override ?? r.samling_ms,
      start_ms: r.start_ms,
      slut_ms: r.slut_ms,
      // Tvetydiga pass deltar inte i krockberäkningen, men visas i listan.
      dold: r.dold === 1 || ärOmappad(r),
      installt: r.ics_status === "CANCELLED",
      ansvarig: tillAnsvarig(r),
    }));

    const krockar = beraknaKrockar(pass, platser);

    const händelser = valda.map((r) => tillKort(r, krockar.get(`${r.feed_id}|${r.uid}`)));

    const kropp = JSON.stringify({ fran: spann.fran, till: spann.till, handelser: händelser });
    const etag = `W/"${Bun.hash(kropp).toString(16)}"`;

    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers: { ETag: etag } });
    }

    return new Response(kropp, {
      headers: { "Content-Type": "application/json; charset=utf-8", ETag: etag },
    });
  })

  /**
   * Våra egna val på ett pass: deltar ej, ansvarig, anteckning och rättad samlingstid.
   *
   * Bara de fält som skickas ändras. `overrides` ägs av oss och rörs aldrig av hämtaren.
   */
  .patch("/api/overrides/:feed/:uid", async ({ request, params }) => {
    const anvandare = inloggad(request);
    if (!anvandare) return krävsApi();
    if (anvandare.roll !== "foralder") return krävsForalder();
    if (!sammaUrsprung(request) || !krävsJson(request)) {
      return Response.json({ fel: "Ogiltig förfrågan" }, { status: 403 });
    }

    const finns = db
      .query<{ n: number }, [string, string]>("SELECT COUNT(*) AS n FROM events WHERE feed_id = ? AND uid = ?")
      .get(params.feed, params.uid);
    if (!finns?.n) return Response.json({ fel: "Passet finns inte" }, { status: 404 });

    const kropp = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!kropp) return Response.json({ fel: "Ogiltig JSON" }, { status: 400 });

    let dold = 0;
    let typ = "ingen";
    let userId: number | null = null;

    if ("dold" in kropp) {
      if (typeof kropp.dold !== "boolean") return Response.json({ fel: "dold måste vara boolean" }, { status: 400 });
      dold = kropp.dold ? 1 : 0;
    }

    if ("ansvarig" in kropp) {
      const a = kropp.ansvarig as { typ?: unknown; user_id?: unknown } | null;
      const t = typeof a?.typ === "string" ? a.typ : "ingen";
      if (!["ingen", "person", "samakning", "egen"].includes(t)) {
        return Response.json({ fel: "Okänd ansvarigtyp" }, { status: 400 });
      }
      typ = t;
      if (t === "person") {
        const id = Number(a?.user_id);
        const finns = Number.isInteger(id)
          ? db.query<{ n: number }, [number]>("SELECT COUNT(*) AS n FROM users WHERE id = ? AND roll = 'foralder'").get(id)
          : null;
        if (!finns?.n) return Response.json({ fel: "Okänd förälder" }, { status: 400 });
        userId = id;
      }
    }

    const anteckning = typeof kropp.anteckning === "string" ? kropp.anteckning.trim() : null;
    const samling = kropp.samling_ms === null ? null : Number(kropp.samling_ms);

    // Två steg: skapa raden om den saknas, uppdatera sedan bara de fält som skickades.
    db.run(
      `INSERT INTO overrides (feed_id, uid, dold, ansvarig_typ, ansvarig_user_id, anteckning, samling_ms, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(feed_id, uid) DO UPDATE SET updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      [params.feed, params.uid, dold, typ, userId, anteckning, Number.isFinite(samling) ? samling : null, anvandare.id, Date.now()]
    );

    const uppdateringar: [string, string | number | null][] = [];
    if ("dold" in kropp) uppdateringar.push(["dold", dold]);
    if ("ansvarig" in kropp) {
      uppdateringar.push(["ansvarig_typ", typ], ["ansvarig_user_id", userId]);
    }
    if ("anteckning" in kropp) uppdateringar.push(["anteckning", anteckning]);
    if ("samling_ms" in kropp) uppdateringar.push(["samling_ms", Number.isFinite(samling) ? samling : null]);

    for (const [kolumn, värde] of uppdateringar) {
      db.run(`UPDATE overrides SET ${kolumn} = ? WHERE feed_id = ? AND uid = ?`, [värde, params.feed, params.uid]);
    }

    const rad = db
      .query<{ dold: number; ansvarig_typ: string; ansvarig_user_id: number | null; anteckning: string | null; samling_ms: number | null; updated_by: number | null; updated_at: number }, [string, string]>(
        "SELECT dold, ansvarig_typ, ansvarig_user_id, anteckning, samling_ms, updated_by, updated_at FROM overrides WHERE feed_id = ? AND uid = ?"
      )
      .get(params.feed, params.uid);

    return {
      ok: true,
      override: rad
        ? {
            dold: rad.dold === 1,
            ansvarig: { typ: rad.ansvarig_typ, user_id: rad.ansvarig_user_id },
            anteckning: rad.anteckning,
            samling: rad.samling_ms,
            andradAv: rad.updated_by,
            andrad: rad.updated_at,
          }
        : null,
    };
  })

  /**
   * Ett enskilt pass som .ics, för "Lägg i kalendern".
   *
   * Samlingen läggs som en egen VEVENT med RELATED-TO, så att både "Samling 09:15" och
   * "Match 10:00" hamnar som egna rader i telefonens kalender. Det är hela poängen: annars
   * försvinner samlingstiden när passet lämnar appen.
   */
  /**
   * Ett pass, som JSON eller som kalenderfil.
   *
   * Samma rutt för båda, eftersom Elysia inte tillåter två rutter med samma form men olika
   * parameternamn. Ändelsen `.ics` avgör svaret, och adressen ser ändå ut som en fil, vilket
   * telefonens kalender behöver.
   */
  .get("/api/pass/:feed/:uid", ({ request, params }) => {
    if (!inloggad(request)) return krävsApi();

    const villHaFil = params.uid.toLowerCase().endsWith(".ics");
    const uid = villHaFil ? params.uid.slice(0, -4) : params.uid;

    laddaFeedBarn();
    // Två steg: målet först via primärnyckeln, sedan bara fönstret runt det. Att läsa in hela
    // tabellen och filtrera i JavaScript fungerade med 100 rader men inte med 10 000.
    const målet = db
      .query<Rad, [string, string]>(`${SQL.replace("AND e.start_ms <= ? AND e.slut_ms >= ?", "AND e.feed_id = ? AND e.uid = ?")}`)
      .get(params.feed, uid);
    if (!målet) return Response.json({ fel: "Passet finns inte" }, { status: 404 });

    const rader = db
      .query<Rad, [number, number]>(SQL)
      .all(målet.slut_ms + 36 * 3_600_000, målet.start_ms - 36 * 3_600_000);

    if (villHaFil) return somKalenderfil(uid, målet);

    // Fönstret kan i teorin missa målet om dess eget intervall ligger utanför; lägg till då.
    const närliggande = rader.some((r) => r.uid === målet.uid && r.feed_id === målet.feed_id)
      ? rader
      : [målet, ...rader];

    const platser = new Map(lasPlatser().map((p) => [p.id, p]));
    const pass: KrockPass[] = närliggande.map((r) => ({
      id: `${r.feed_id}|${r.uid}`,
      barn: barnFor(r),
      plats_id: r.plats_id,
      samling_ms: r.samling_override ?? r.samling_ms,
      start_ms: r.start_ms,
      slut_ms: r.slut_ms,
      // Tvetydiga pass deltar inte i krockberäkningen, men visas i listan.
      dold: r.dold === 1 || ärOmappad(r),
      installt: r.ics_status === "CANCELLED",
      ansvarig: tillAnsvarig(r),
    }));
    const krockar = beraknaKrockar(pass, platser);
    const minKrock = krockar.get(`${målet.feed_id}|${målet.uid}`);
    const motIds = new Set(minKrock?.mot ?? []);

    return {
      handelse: tillKort(målet, krockar.get(`${målet.feed_id}|${målet.uid}`), true),
      krockar: närliggande
        .filter((r) => motIds.has(`${r.feed_id}|${r.uid}`))
        .map((r) => tillKort(r, krockar.get(`${r.feed_id}|${r.uid}`))),
    };
  })

  .post("/api/refresh", async ({ request }) => {
    const anvandare = inloggad(request);
    if (!anvandare) return krävsApi();
    if (anvandare.roll !== "foralder") return krävsForalder();
    if (!sammaUrsprung(request) || !krävsJson(request)) {
      return Response.json({ fel: "Ogiltig förfrågan" }, { status: 403 });
    }

    const nu = Date.now();
    if (nu - senasteRefresh < REFRESH_SPARR_MS) {
      const vanta = Math.ceil((REFRESH_SPARR_MS - (nu - senasteRefresh)) / 1000);
      return Response.json(
        { fel: `Vänta ${vanta} sekunder innan nästa hämtning` },
        { status: 429, headers: { "Retry-After": String(vanta) } }
      );
    }
    senasteRefresh = nu;

    const resultat = await hamtaAlla({ nu });
    return { ok: true, resultat };
  });
