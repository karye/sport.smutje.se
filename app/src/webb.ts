/**
 * HTML-skalet för de få sidor servern ritar själv: inloggning, nekad inloggning, fel.
 *
 * Gränssnittet i övrigt är React och byggs i `frontend/`. Det här är bara det som måste fungera
 * innan appen finns, och det ska se ut som resten: samma tokens som `class.smutje.se`.
 */

export interface SidVal {
  rubrik: string;
  underrubrik?: string;
  innehall: string;
  status?: number;
  /** Sätts på inloggningssidan, som inte ska cachas av någon mellanliggande proxy. */
  noCache?: boolean;
}

const STIL = `
  :root {
    --bakgrund: hsl(0 0% 100%);
    --sida: hsl(210 20% 98%);
    --text: hsl(222 47% 11%);
    --dämpad: hsl(215 16% 47%);
    --kant: hsl(214 32% 91%);
    --primar: hsl(221 83% 53%);
    --fel: hsl(0 72% 51%);
    color-scheme: light;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bakgrund: hsl(222 47% 11%); --sida: hsl(222 40% 9%); --text: hsl(210 20% 96%);
            --dämpad: hsl(215 20% 65%); --kant: hsl(215 25% 22%); color-scheme: dark; }
  }
  * { box-sizing: border-box }
  body { margin: 0; background: var(--sida); color: var(--text);
         font: 16px/1.55 -apple-system, "Segoe UI", Roboto, sans-serif;
         -webkit-font-smoothing: antialiased; }
  main { max-width: 26rem; margin: 0 auto; padding: 3rem 1.25rem calc(2rem + env(safe-area-inset-bottom)); }
  h1 { font-size: 1.35rem; line-height: 1.25; margin: 0 0 .35rem; letter-spacing: -.01em }
  .underrubrik { color: var(--dämpad); margin: 0 0 1.5rem; font-size: .95rem }
  .kort { background: var(--bakgrund); border: 1px solid var(--kant); border-radius: .875rem;
          padding: 1.25rem; }
  .knapp { display: flex; align-items: center; justify-content: center; min-height: 48px;
           padding: .75rem 1rem; border-radius: .75rem; background: var(--primar); color: #fff;
           font-weight: 600; text-decoration: none; }
  .knapp.sekundar { background: transparent; color: var(--text); border: 1px solid var(--kant) }
  .knapprad { display: grid; gap: .6rem; margin-top: 1.25rem }
  code { background: var(--sida); padding: .1em .35rem; border-radius: .25rem;
         font-size: .875em }
  ul { padding-left: 1.1rem; margin: .5rem 0 }
  .fel { color: var(--fel); font-weight: 600 }
  .tyst { color: var(--dämpad); font-size: .85rem; margin-top: 1.5rem }
`;

/** Text som kommer utifrån (Googles visningsnamn) får aldrig hamna oescapad i HTML. */
export function escapar(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function sida({ rubrik, underrubrik, innehall, status = 200, noCache = false }: SidVal): Response {
  const html = `<!doctype html>
<html lang="sv">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#ffffff">
<title>${rubrik} · sport.smutje.se</title>
<style>${STIL}</style>
</head>
<body>
<main>
  <h1>${rubrik}</h1>
  ${underrubrik ? `<p class="underrubrik">${underrubrik}</p>` : ""}
  <div class="kort">${innehall}</div>
  <p class="tyst">sport.smutje.se — familjens kalender</p>
</main>
</body>
</html>`;

  const headers: Record<string, string> = { "Content-Type": "text/html; charset=utf-8" };
  if (noCache) headers["Cache-Control"] = "no-store";
  return new Response(html, { status, headers });
}

/** Inloggningssidan. `saknas` gör att ett halvfärdigt `.env` syns i stället för att bara ge 500. */
export function inloggningsSida(saknas: string[]): Response {
  if (saknas.length > 0) {
    return sida({
      rubrik: "Servern är inte konfigurerad",
      underrubrik: "Inloggningen kan inte startas förrän miljön är komplett.",
      noCache: true,
      status: 500,
      innehall: `<p>Dessa variabler saknas i <code>.env</code>:</p>
        <ul>${saknas.map((n) => `<li><code>${n}</code></li>`).join("")}</ul>`,
    });
  }

  return sida({
    rubrik: "Familjens kalender",
    underrubrik: "Barn 1 och Barn 2s idrotter, samlade. Bara vi kommer in.",
    noCache: true,
    innehall: `<p>Logga in med det Google-konto som finns i familjens lista.</p>
      <p class="knapprad"><a class="knapp" href="/auth/login">Logga in med Google</a></p>`,
  });
}
