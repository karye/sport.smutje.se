/**
 * Krockberäkningen. Rena funktioner, inga databasanrop, inga klockanrop — den ska gå att testa.
 *
 * Ett pass upptar familjens tid från samlingen, inte från avspark. Två pass kan därför krocka
 * även när de inte överlappar: glappet mellan dem är kortare än resan mellan platserna.
 */
import type { Ansvarig, Krock, KrockPass, Plats } from "./typer.ts";
import { restidMinuter } from "./platser.ts";

/** Längre glapp än så här kan aldrig bli en transportkrock, och då behöver vi inte jämföra. */
const MAX_GLAPP_MS = 6 * 3600000;

const från = (p: KrockPass): number => p.samling_ms ?? p.start_ms;

/**
 * Är krocken olöst? Namnet är valt för att inte gå att läsa baklänges: funktionen svarar true när
 * krocken **kvarstår**, alltså när ingen logistik skiljer passen åt.
 *
 *   ingen + ingen            → olöst (true)
 *   Förälder 1 + Förälder 2            → löst (false)
 *   Förälder 1 + Förälder 1            → olöst (samma person kan inte vara på två ställen)
 *   samåkning eller egen     → löst, någon annan löser transporten
 */
function ärOlöst(a: Ansvarig, b: Ansvarig): boolean {
  const nyckel = (x: Ansvarig): string => (x.typ === "person" ? `person:${x.user_id ?? "?"}` : x.typ);
  if (nyckel(a) === "egen" || nyckel(b) === "egen") return false;
  if (nyckel(a) === "samakning" || nyckel(b) === "samakning") return false;
  if (nyckel(a) === "ingen" || nyckel(b) === "ingen") return true;
  return nyckel(a) === nyckel(b);
}

/** Rangordning när ett pass krockar med flera: tidskrock väger tyngre än transportkrock. */
function vikt(k: Krock): number {
  return (k.typ === "tid" ? 10 : 0) + (k.olost ? 5 : 0) + (k.sammaBarn ? 2 : 0);
}

/**
 * Beräknar den allvarligaste krocken per pass.
 *
 * Pass som är dolda (`Deltar ej`) eller inställda deltar inte: de upptar ingen tid. Det är
 * samma regel som gör att varningstriangeln i månadsvyn bara tänds för verkliga problem.
 */
export function beraknaKrockar(
  pass: readonly KrockPass[],
  platser: ReadonlyMap<number, Plats>
): Map<string, Krock> {
  const aktiva = pass
    .filter((p) => !p.dold && !p.installt)
    .slice()
    .sort((a, b) => från(a) - från(b));

  const resultat = new Map<string, Krock>();

  const lagg = (id: string, k: Krock): void => {
    const nu = resultat.get(id);
    if (!nu) {
      resultat.set(id, { ...k, mot: [...k.mot] });
      return;
    }
    const samma = nu.typ === k.typ && nu.sammaBarn === k.sammaBarn && nu.olost === k.olost;
    const mot = [...new Set([...nu.mot, ...k.mot])];
    const vinnare = vikt(k) > vikt(nu) ? k : nu;
    resultat.set(id, { ...vinnare, mot });
    if (samma) resultat.set(id, { ...vinnare, mot, glappMin: Math.min(nu.glappMin, k.glappMin) });
  };

  for (let i = 0; i < aktiva.length; i++) {
    const a = aktiva[i];
    if (!a) continue;
    for (let j = i + 1; j < aktiva.length; j++) {
      const b = aktiva[j];
      if (!b) continue;

      const glapp = från(b) - a.slut_ms;
      if (glapp > MAX_GLAPP_MS) break;

      const sammaPlats = a.plats_id != null && a.plats_id === b.plats_id;
      const överlappar = från(b) < a.slut_ms;
      const sammaBarn = a.barn.some((namn) => b.barn.includes(namn));

      let krock: Krock;
      if (överlappar) {
        if (sammaPlats) continue; // en förälder kan stå i samma hall
        krock = {
          typ: "tid",
          mot: [b.id],
          glappMin: Math.round(glapp / 60000),
          restidMin: null,
          olost: ärOlöst(a.ansvarig, b.ansvarig),
          sammaBarn,
        };
      } else {
        const restid = restidMinuter(
          a.plats_id == null ? null : platser.get(a.plats_id),
          b.plats_id == null ? null : platser.get(b.plats_id)
        );
        if (restid == null || restid === 0) continue;
        if (glapp >= restid * 60000) continue;
        krock = {
          typ: "transport",
          mot: [b.id],
          glappMin: Math.round(glapp / 60000),
          restidMin: restid,
          olost: ärOlöst(a.ansvarig, b.ansvarig),
          sammaBarn,
        };
      }

      lagg(a.id, krock);
      lagg(b.id, { ...krock, mot: [a.id] });
    }
  }

  return resultat;
}

/** Sant om något pass i listan har en olöst krock. Används av varningstriangeln i månaden. */
export function harOlostKrock(krockar: ReadonlyMap<string, Krock>): boolean {
  for (const k of krockar.values()) if (k.olost) return true;
  return false;
}
