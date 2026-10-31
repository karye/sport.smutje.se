import { useEffect, useState } from "react";
import { apiFelText, hämtaHändelser, type Handelse } from "./api";

/**
 * Hämtar händelser för ett intervall.
 *
 * `version` i beroendelistan gör att vyn hämtar om när något sparats: en överstyrning ändrar
 * krockarna, och då räcker det inte att bara rita om kortet.
 */
export function useHändelser(spann: { fran: number; till: number }, version: number) {
  const [handelser, setHandelser] = useState<Handelse[]>([]);
  const [laddar, setLaddar] = useState(true);
  const [fel, setFel] = useState<string | null>(null);

  const { fran, till } = spann;

  useEffect(() => {
    let avbruten = false;
    setLaddar(true);
    (async () => {
      try {
        const svar = await hämtaHändelser(fran, till);
        if (avbruten) return;
        setHandelser(svar.handelser);
        setFel(null);
      } catch (e) {
        if (!avbruten) setFel(apiFelText(e));
      } finally {
        if (!avbruten) setLaddar(false);
      }
    })();
    return () => {
      avbruten = true;
    };
  }, [fran, till, version]);

  return { handelser, laddar, fel };
}

/** Fönsterbredd, för att bara visa tidsaxeln när den får plats. */
export function useBredd(): number {
  const [bredd, setBredd] = useState(() => window.innerWidth);
  useEffect(() => {
    const påÄndring = () => setBredd(window.innerWidth);
    window.addEventListener("resize", påÄndring);
    return () => window.removeEventListener("resize", påÄndring);
  }, []);
  return bredd;
}
