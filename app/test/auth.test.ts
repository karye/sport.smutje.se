import { afterEach, describe, expect, test } from "bun:test";

/**
 * Signering, roller och allowlist. Rena funktioner, ingen databas.
 *
 * Miljön sätts före anropen eftersom auth.ts läser den när funktionerna körs — det är avsiktligt,
 * så att appen kan starta och visa en begriplig sida även med halvfärdig konfiguration.
 */
const HEMLIGHET = "a".repeat(64);

process.env.SESSION_SECRET = HEMLIGHET;
process.env.GOOGLE_CLIENT_ID = "klient-id.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "hemlig";
process.env.REDIRECT_URI = "https://sport.smutje.se/auth/callback";
process.env.ALLOWED_EMAILS = " FORALDER1@Example.com:foralder , foralder2@example.com:foralder, felpost ";

const auth = await import("../src/auth.ts");
type Sessionsnytta = import("../src/auth.ts").Sessionsnytta;

afterEach(() => {
  process.env.SESSION_SECRET = HEMLIGHET;
});

describe("sessionssigneringen", () => {
  test("rundtur", () => {
    const token = auth.issue({ uid: 7 }, 60);
    expect(auth.read<Sessionsnytta>(token)?.uid).toBe(7);
  });

  test("manipulerad nytta avvisas", () => {
    const token = auth.issue({ uid: 7 }, 60);
    const [värde, namn] = token.split(".");
    const fejkad = `${Buffer.from(JSON.stringify({ uid: 1, exp: 9e9 })).toString("base64url")}.${namn}`;
    expect(värde).toBeTruthy();
    expect(auth.read(fejkad)).toBeNull();
  });

  test("utgången nytta avvisas", () => {
    expect(auth.read(auth.issue({ uid: 7 }, -1))).toBeNull();
  });

  test("papperskorg", () => {
    expect(auth.read(null)).toBeNull();
    expect(auth.read("")).toBeNull();
    expect(auth.read("utanpunkt")).toBeNull();
    expect(auth.read(123)).toBeNull();
  });

  test("en annan hemlighet gör token ogiltig", () => {
    const token = auth.issue({ uid: 7 }, 60);
    process.env.SESSION_SECRET = "b".repeat(64);
    expect(auth.read(token)).toBeNull();
  });

  test("för kort hemlighet kastar", () => {
    process.env.SESSION_SECRET = "kort";
    expect(() => auth.issue({ uid: 1 }, 60)).toThrow();
  });
});

describe("allowlist och roller", () => {
  test("förälder och barn skiljs åt", () => {
    expect(auth.rollFor("foralder1@example.com")).toBe("foralder");
    expect(auth.rollFor("foralder2@example.com")).toBe("foralder");
  });

  test("adressen jämförs utan hänsyn till skiftläge och blanksteg", () => {
    expect(auth.rollFor("  FORALDER1@example.COM ")).toBe("foralder");
  });

  test("okänd adress släpps inte in", () => {
    expect(auth.rollFor("nagon@annanstans.se")).toBeNull();
    expect(auth.rollFor("")).toBeNull();
    expect(auth.rollFor(undefined)).toBeNull();
  });

  test("post utan snabel-a hoppas över", () => {
    expect(auth.tillatna().map((p) => p.epost)).toEqual(["foralder1@example.com", "foralder2@example.com"]);
  });

  test("okänd roll blir barn", () => {
    process.env.ALLOWED_EMAILS = "barn1@example.com:admin";
    expect(auth.rollFor("barn1@example.com")).toBe("barn");
    process.env.ALLOWED_EMAILS = " FORALDER1@Example.com:foralder , foralder2@example.com:foralder, felpost ";
  });

  test("adress utan roll blir barn", () => {
    process.env.ALLOWED_EMAILS = "barn2@example.com";
    expect(auth.rollFor("barn2@example.com")).toBe("barn");
    process.env.ALLOWED_EMAILS = " FORALDER1@Example.com:foralder , foralder2@example.com:foralder, felpost ";
  });
});

describe("Google-adressen", () => {
  test("redirect_uri kommer från miljön", () => {
    const url = new URL(auth.buildAuthUrl("nonce"));
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("redirect_uri")).toBe("https://sport.smutje.se/auth/callback");
    expect(url.searchParams.get("state")).toBe("nonce");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("response_type")).toBe("code");
  });

  test("saknad konfiguration rapporteras i stället för att kasta", () => {
    const sparat = process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_ID;
    expect(auth.ärKonfigurerad()).toEqual({ ok: false, saknas: ["GOOGLE_CLIENT_ID"] });
    process.env.GOOGLE_CLIENT_ID = sparat;
    expect(auth.ärKonfigurerad().ok).toBe(true);
  });

  test("nonce är lång och slumpad", () => {
    const a = auth.newState();
    expect(a).toHaveLength(64);
    expect(a).not.toBe(auth.newState());
  });
});
