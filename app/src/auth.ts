/**
 * Google-inloggningen och rollerna.
 *
 * Mönstret är prov.smutje.se:s, som i sin tur ärvt det från class.smutje.se och redan är felsökt:
 *
 *   1. redirect_uri läses alltid från miljön, aldrig från förfrågan. Att bygga den ur
 *      X-Forwarded-Host är en öppen omdirigering.
 *   2. En CSRF-nonce skickas med till Google och verifieras i callbacken.
 *   3. Sessionen är statslös: en HMAC-signerad cookie med användar-id och utgångstid. Ingen
 *      sessionstabell, ingen hemlighet i cookien.
 *
 * Skillnaden mot prov: giltigheten är 90 dagar i stället för 8 timmar. En familjekalender på
 * hemskärmen ska inte logga ut, och cookien sitter på en enhet som redan är upplåst.
 *
 * Miljön läses när funktionerna anropas, inte när modulen laddas. Då kan appen starta och visa
 * en begriplig sida även om en nyckel saknas, i stället för att dö i en import.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "./db.ts";
import type { Anvandare, Roll } from "./typer.ts";

export const SESSION_COOKIE = "sport_session";
export const STATE_COOKIE = "sport_oauth_state";
export const SESSION_MAX_AGE = 90 * 24 * 60 * 60;
export const STATE_MAX_AGE = 10 * 60;

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO = "https://openidconnect.googleapis.com/v1/userinfo";

/** Bara identiteten. Inga känsliga scopes, alltså ingen verifiering hos Google. */
const SCOPES: readonly string[] = ["openid", "email", "profile"];

function kräv(namn: string): string {
  const v = process.env[namn];
  if (!v) throw new Error(`${namn} saknas i miljön. Se .env.example.`);
  return v;
}

function hemlighet(): string {
  const s = kräv("SESSION_SECRET");
  if (s.length < 32) throw new Error("SESSION_SECRET är kortare än 32 tecken.");
  return s;
}

export function ärKonfigurerad(): { ok: boolean; saknas: string[] } {
  const saknas = ["SESSION_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "REDIRECT_URI"].filter(
    (n) => !process.env[n]
  );
  return { ok: saknas.length === 0, saknas };
}

/* ------------------------------------------------------------------ signering */

interface SigneradNytta {
  exp: number;
}

export interface Sessionsnytta extends SigneradNytta {
  uid: number;
}

export interface Statenytta extends SigneradNytta {
  state: string;
}

const sign = (värde: string): string =>
  `${värde}.${createHmac("sha256", hemlighet()).update(värde).digest("base64url")}`;

function unsign(token: unknown): string | null {
  if (typeof token !== "string") return null;
  const punkt = token.lastIndexOf(".");
  if (punkt < 1) return null;

  const värde = token.slice(0, punkt);
  const mottagen = Buffer.from(token.slice(punkt + 1));
  const väntad = Buffer.from(createHmac("sha256", hemlighet()).update(värde).digest("base64url"));

  if (mottagen.length !== väntad.length) return null;
  if (!timingSafeEqual(mottagen, väntad)) return null;
  return värde;
}

export function issue(payload: Record<string, unknown>, maxAgeSeconds: number): string {
  const kropp = { ...payload, exp: Math.floor(Date.now() / 1000) + maxAgeSeconds };
  return sign(Buffer.from(JSON.stringify(kropp)).toString("base64url"));
}

/** Verifierar signatur och utgångstid. Returnerar null vid minsta tvekan. */
export function read<T extends SigneradNytta>(token: unknown): T | null {
  const värde = unsign(token);
  if (!värde) return null;
  try {
    const kropp = JSON.parse(Buffer.from(värde, "base64url").toString("utf8")) as T;
    if (typeof kropp.exp !== "number" || kropp.exp < Math.floor(Date.now() / 1000)) return null;
    return kropp;
  } catch {
    return null;
  }
}

export const newState = (): string => randomBytes(32).toString("hex");

/* --------------------------------------------------------------------- roller */

export interface TillatenPost {
  epost: string;
  roll: Roll;
}

/**
 * ALLOWED_EMAILS som `epost:roll,epost:roll`. En post utan snabel-a kan aldrig matcha ett konto,
 * och felet är tyst: personen får 403 och ingen förstår varför. Därför en varning i loggen.
 */
export function tillatna(): TillatenPost[] {
  const rå = process.env.ALLOWED_EMAILS ?? "";
  const ut: TillatenPost[] = [];
  for (const del of rå.split(",")) {
    const post = del.trim();
    if (!post) continue;
    const kolon = post.lastIndexOf(":");
    const epost = (kolon === -1 ? post : post.slice(0, kolon)).trim().toLowerCase();
    const rollText = kolon === -1 ? "" : post.slice(kolon + 1).trim().toLowerCase();
    if (!epost.includes("@")) {
      console.warn(`ALLOWED_EMAILS: "${post}" är ingen e-postadress och kommer aldrig matcha.`);
      continue;
    }
    if (rollText && rollText !== "foralder" && rollText !== "barn") {
      console.warn(`ALLOWED_EMAILS: okänd roll "${rollText}" för ${epost}. Behandlas som barn.`);
    }
    ut.push({ epost, roll: rollText === "foralder" ? "foralder" : "barn" });
  }
  return ut;
}

/** Rollen för en adress, eller null om adressen inte släpps in. */
export function rollFor(epost: string | undefined | null): Roll | null {
  const adress = (epost ?? "").trim().toLowerCase();
  if (!adress) return null;
  return tillatna().find((p) => p.epost === adress)?.roll ?? null;
}

/* --------------------------------------------------------------------- Google */

export function buildAuthUrl(state: string): string {
  const url = new URL(GOOGLE_AUTH);
  url.searchParams.set("client_id", kräv("GOOGLE_CLIENT_ID"));
  url.searchParams.set("redirect_uri", kräv("REDIRECT_URI"));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

interface TokenSvar {
  access_token: string;
}

export async function exchangeCode(code: string): Promise<TokenSvar> {
  const svar = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: kräv("GOOGLE_CLIENT_ID"),
      client_secret: kräv("GOOGLE_CLIENT_SECRET"),
      redirect_uri: kräv("REDIRECT_URI"),
      grant_type: "authorization_code",
    }),
  });

  if (!svar.ok) throw new Error(`Tokenutbyte misslyckades: ${svar.status} ${await svar.text()}`);
  return (await svar.json()) as TokenSvar;
}

export interface GoogleProfil {
  sub: string;
  email?: string;
  name?: string;
}

export async function fetchUserInfo(accessToken: string): Promise<GoogleProfil> {
  const svar = await fetch(GOOGLE_USERINFO, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!svar.ok) throw new Error(`Kunde inte hämta profilen: ${svar.status} ${await svar.text()}`);
  return (await svar.json()) as GoogleProfil;
}

/* ------------------------------------------------------------------ användare */

/**
 * Skapar eller uppdaterar användaren. Rollen sätts vid första inloggningen och skrivs inte över
 * när listan i miljön ändras — den som en gång blivit förälder blir inte barn av ett stavfel.
 */
export function upsertUser({ sub, email, name }: GoogleProfil, roll: Roll): Anvandare {
  const befintlig = db
    .query<Anvandare, [string]>("SELECT * FROM users WHERE google_id = ?")
    .get(sub);

  if (befintlig) {
    db.run("UPDATE users SET email = ?, display_name = ?, last_seen_at = datetime('now') WHERE id = ?", [
      email ?? befintlig.email,
      name ?? befintlig.display_name,
      befintlig.id,
    ]);
    return db.query<Anvandare, [number]>("SELECT * FROM users WHERE id = ?").get(befintlig.id) as Anvandare;
  }

  db.run(
    "INSERT INTO users (google_id, email, display_name, roll, last_seen_at) VALUES (?, ?, ?, ?, datetime('now'))",
    [sub, email ?? null, name ?? (email ?? "Namnlös"), roll]
  );
  return db.query<Anvandare, [string]>("SELECT * FROM users WHERE google_id = ?").get(sub) as Anvandare;
}

/** Läser användaren ur sessionscookien. Null om inget gäller. */
export function currentUser(cookies: Record<string, string>): Anvandare | null {
  const session = read<Sessionsnytta>(cookies[SESSION_COOKIE]);
  if (!session || typeof session.uid !== "number") return null;
  return db.query<Anvandare, [number]>("SELECT * FROM users WHERE id = ?").get(session.uid) ?? null;
}
