/**
 * Appen. Rutterna sätts ihop här och `index.ts` startar den.
 *
 * Uppdelningen finns för att appen ska gå att anropa i test utan att någon port öppnas:
 * `skapaApp().handle(new Request(...))`.
 *
 * Allt utom `/auth/*` kräver inloggning. `/api/halsa` ligger också bakom, enligt beslutet att
 * ingen del av appen ska vara läsbar utan konto.
 */
import { Elysia } from "elysia";
import { join, resolve, sep } from "node:path";
import { db } from "./db.ts";
import { ZON } from "./tid.ts";
import { ärKonfigurerad } from "./auth.ts";
import { inloggad, krävsApi } from "./skydd.ts";
import { escapar, inloggningsSida, sida } from "./webb.ts";
import { inloggningsRutter } from "./rutter/inloggning.ts";
import { handelseRutter } from "./rutter/handelser.ts";
import { installningsRutter } from "./rutter/installningar.ts";

const PUBLIC_DIR: string = resolve(join(import.meta.dir, "..", "public"));

/**
 * Filer som måste nås utan inloggning, annars kan appen inte installeras på hemskärmen: webbläsaren
 * hämtar manifestet och service workern innan den har en session, och får annars loginsidan.
 */
const ÖPPNA_FILER = new Set(["/manifest.webmanifest", "/sw.js", "/ikon.svg", "/favicon.ico"]);

export const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".ics": "text/calendar; charset=utf-8",
};

export function skapaApp() {
  return new Elysia()
    .use(inloggningsRutter)
    .use(handelseRutter)
    .use(installningsRutter)

    .get("/api/halsa", ({ request }) => {
      if (!inloggad(request)) return krävsApi();
      const floden = db.query("SELECT id, last_fetch_at, last_status FROM feeds ORDER BY id").all();
      return { ok: true, tid: new Date().toISOString(), zon: ZON, floden };
    })

    // Allt annat. Inloggning krävs, och därefter är ordningen: fil, annars appskalet.
    //
    // Fällan: uid:n innehåller `@sportadmin.se`, alltså en punkt. Att avgöra "är det en fil?" på
    // en punkt i sista segmentet ger 404 på varje pass-sida. Regeln är i stället: en fil med känd
    // ändelse som inte finns är 404, allt annat är appskalet.
    .get("/*", async ({ request }) => {
      const url = new URL(request.url);
      const anvandare = inloggad(request);

      // Manifest och service worker måste nås utan session, annars kan appen inte installeras på
      // hemskärmen: webbläsaren hämtar dem innan den har en kaka.
      const öppenFil = ÖPPNA_FILER.has(url.pathname);

      if (!anvandare && !öppenFil) {
        if (url.pathname.startsWith("/api/")) return krävsApi();
        return inloggningsSida(ärKonfigurerad().saknas);
      }

      // Kända api-rutter ligger före den här; hit kommer bara okända.
      if (url.pathname.startsWith("/api/")) return Response.json({ fel: "Finns inte" }, { status: 404 });

      const relativ = decodeURIComponent(url.pathname).replace(/^\/+/, "");

      if (relativ) {
        // Skydd mot att klättra ut ur public/. `new URL()` normaliserar %2e%2e men inte kodade
        // snedstreck, så "/..%2f..%2f.env" blir "../../.env" först efter avkodningen. Utan den
        // här kontrollen serveras .env och databasen till varje inloggad klient.
        const fullVäg = resolve(PUBLIC_DIR, relativ);
        if (fullVäg !== PUBLIC_DIR && !fullVäg.startsWith(PUBLIC_DIR + sep)) {
          return new Response("Förbjuden", { status: 403 });
        }

        const fil = Bun.file(fullVäg);
        if (await fil.exists()) {
          const ändelse = relativ.slice(relativ.lastIndexOf(".")).toLowerCase();
          return new Response(fil, {
            headers: { "Content-Type": MIME[ändelse] ?? "application/octet-stream" },
          });
        }

        const ändelse = relativ.includes(".") ? relativ.slice(relativ.lastIndexOf(".")).toLowerCase() : "";
        if (ändelse in MIME && ändelse !== ".html") return new Response("Finns inte", { status: 404 });
      }

      const skal = Bun.file(join(PUBLIC_DIR, "index.html"));
      if (await skal.exists()) {
        return new Response(skal, {
          headers: { "Content-Type": MIME[".html"] as string, "Cache-Control": "no-cache" },
        });
      }

      // Reserv när frontendbygget saknas. `anvandare` kan vara null här om bara manifestet
      // efterfrågas utan session, och då finns inget namn att hälsa med.
      if (!anvandare) return new Response("Finns inte", { status: 404 });

      return sida({
        rubrik: `Hej ${escapar(anvandare.display_name)}`,
        underrubrik: `Inloggad som ${escapar(anvandare.email)} · ${anvandare.roll}`,
        noCache: true,
        innehall: `<p>Inloggningen, databasen, tolken och krockberäkningen är klara och testade.
          Gränssnittet är nästa steg.</p>
          <p class="knapprad"><a class="knapp sekundar" href="/auth/logout">Logga ut</a></p>`,
      });
    })

    .onError(({ code, error }) => {
      console.error(`${code}:`, error);
      const status = code === "NOT_FOUND" ? 404 : 500;
      return Response.json({ fel: status === 404 ? "Finns inte" : "Serverfel" }, { status });
    });
}
