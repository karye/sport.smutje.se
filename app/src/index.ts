/**
 * Startpunkten. Gör ingenting själv: sätter ihop appen och öppnar porten.
 *
 * Porten är 3011 eftersom 3000–3005, 3010, 5001 och 8082 redan är upptagna på maskinen.
 */
import { skapaApp } from "./app.ts";
import { hamtaAlla } from "./hamtare.ts";

const PORT: number = Number(process.env.PORT ?? 3011);

/**
 * Hämtaren går varje minut och frågar varje flöde om det är moget. Intervall och backoff räknas
 * per flöde i `hamtare.ts`, så den här klockan behöver inte veta något om 15 minuter eller
 * trappsteg — den tickar bara, och `arDags` svarar.
 */
let pågår = false;

async function hämtaRundan(): Promise<void> {
  if (pågår) return;
  pågår = true;
  try {
    const resultat = await hamtaAlla();
    for (const s of resultat) {
      if (s.status === "hoppad") continue;
      const extra = s.status === "ok" ? `${s.antal} händelser` : (s.fel ?? "");
      console.log(`hämtning ${s.feed}: ${s.status} ${extra} (${s.ms} ms)`);
    }
  } catch (fel) {
    console.error("hämtningen kastade:", fel);
  } finally {
    pågår = false;
  }
}

const server = skapaApp().listen(PORT);
console.log(`sport.smutje.se lyssnar på http://127.0.0.1:${server.server?.port ?? PORT}`);

void hämtaRundan();
setInterval(() => void hämtaRundan(), 60_000);
