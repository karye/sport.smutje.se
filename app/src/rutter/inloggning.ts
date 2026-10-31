/**
 * Inloggningen.
 *
 * Två saker är säkerhetskritiska, och båda är lånade från prov.smutje.se:
 *   1. redirect_uri läses alltid från miljön, aldrig från förfrågan.
 *   2. En CSRF-nonce skickas med till Google och verifieras i callbacken.
 */
import { Elysia } from "elysia";
import * as auth from "../auth.ts";
import { cookieFran, serialize, serializeCleared } from "../cookies.ts";
import { sida } from "../webb.ts";

export const inloggningsRutter = new Elysia()
  .get("/auth/login", () => {
    if (!auth.ärKonfigurerad().ok) {
      return sida({
        rubrik: "Inloggningen är inte konfigurerad",
        innehall: `<p>Fyll i <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code> och
          <code>REDIRECT_URI</code> i <code>.env</code>.</p>`,
        status: 500,
        noCache: true,
      });
    }

    const state = auth.newState();
    const cookie = serialize(
      auth.STATE_COOKIE,
      auth.issue({ state }, auth.STATE_MAX_AGE),
      { maxAge: auth.STATE_MAX_AGE }
    );

    return new Response(null, {
      status: 302,
      headers: [["Location", auth.buildAuthUrl(state)], ["Set-Cookie", cookie]],
    });
  })

  .get("/auth/callback", async ({ request }) => {
    const url = new URL(request.url);
    const cookies = cookieFran(request);

    const avslag = url.searchParams.get("error");
    if (avslag) {
      return sida({
        rubrik: "Inloggningen nekades",
        underrubrik: avslag,
        status: 400,
        noCache: true,
        innehall: `<p class="knapprad"><a class="knapp" href="/auth/login">Försök igen</a></p>`,
      });
    }

    const kod = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const väntad = auth.read<auth.Statenytta>(cookies[auth.STATE_COOKIE])?.state;

    if (!kod) {
      return sida({
        rubrik: "Ingen kod i svaret",
        underrubrik: "Google skickade tillbaka utan auktoriseringskod.",
        status: 400,
        noCache: true,
        innehall: `<p class="knapprad"><a class="knapp" href="/auth/login">Logga in igen</a></p>`,
      });
    }

    if (!väntad || state !== väntad) {
      return sida({
        rubrik: "Ogiltig förfrågan",
        underrubrik: "Möjligt CSRF-försök, eller en inloggning som tog mer än tio minuter.",
        status: 403,
        noCache: true,
        innehall: `<p class="knapprad"><a class="knapp" href="/auth/login">Logga in igen</a></p>`,
      });
    }

    try {
      const tokens = await auth.exchangeCode(kod);
      const profil = await auth.fetchUserInfo(tokens.access_token);

      const roll = auth.rollFor(profil.email);
      if (!roll) {
        console.warn("Inloggning nekad: adressen finns inte i ALLOWED_EMAILS.");
        return sida({
          rubrik: "Adressen är inte tillåten",
          underrubrik: "Kontot är inte ett av familjens. Be den som sköter servern lägga till det.",
          status: 403,
          noCache: true,
          innehall: `<p class="knapprad"><a class="knapp sekundar" href="/auth/login">Prova ett annat konto</a></p>`,
        });
      }

      const användare = auth.upsertUser(profil, roll);
      const session = serialize(
        auth.SESSION_COOKIE,
        auth.issue({ uid: användare.id }, auth.SESSION_MAX_AGE),
        { maxAge: auth.SESSION_MAX_AGE }
      );

      return new Response(null, {
        status: 302,
        headers: [
          ["Location", "/"],
          ["Set-Cookie", session],
          ["Set-Cookie", serializeCleared(auth.STATE_COOKIE)],
        ],
      });
    } catch (fel) {
      const meddelande = fel instanceof Error ? fel.message : String(fel);
      console.error("Inloggningen misslyckades:", meddelande);
      return sida({
        rubrik: "Inloggningen misslyckades",
        underrubrik: "Försök igen.",
        status: 500,
        noCache: true,
        innehall: `<p class="fel">Tokenutbytet eller profilhämtningen svarade fel.</p>
          <p>Detaljer finns i serverns logg. Vanligaste orsaken är att omdirigeringsadressen i
          Google Cloud Console inte är exakt <code>${process.env.REDIRECT_URI ?? "?"}</code>.</p>
          <p class="knapprad"><a class="knapp" href="/auth/login">Försök igen</a></p>`,
      });
    }
  })

  /**
   * Utloggning sker med POST.
   *
   * En GET som loggar ut kan triggas av en förhämtad länk, en bild eller en annan sajt — då blir
   * användaren utloggad utan att ha gjort något. POST kan inte förhämtas på samma sätt.
   */
  .post("/auth/logout", () =>
    new Response(null, {
      status: 302,
      headers: [["Location", "/"], ["Set-Cookie", serializeCleared(auth.SESSION_COOKIE)]],
    })
  );
