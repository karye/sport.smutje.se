import { useCallback, useEffect, useState } from "react";
import type { VyProps } from "../App";
import { apiFelText, delaId, hämtaDolda, sparaÖverstyrning, type Handelse } from "../api";
import { Vanster } from "../ikoner";
import { Fel, Laddar, Tomt } from "../komponenter";
import { datum, klockslag, veckodag } from "../tid";

/**
 * Dolda pass. Utan den här vyn går ett "deltar ej" inte att ångra, och då blir knappen farlig:
 * ett feltryck hade gömt ett pass för all framtid.
 */
export function Dolda({ navigera, onÄndrad }: VyProps & { onÄndrad?: () => void }) {
  const [handelser, setHandelser] = useState<Handelse[] | null>(null);
  const [fel, setFel] = useState<string | null>(null);
  const [sparar, setSparar] = useState<string | null>(null);

  const ladda = useCallback(async () => {
    try {
      const svar = await hämtaDolda();
      setHandelser(svar.handelser.filter((h) => h.dold));
      setFel(null);
    } catch (e) {
      setFel(apiFelText(e));
    }
  }, []);

  useEffect(() => {
    void ladda();
  }, [ladda]);

  const återställ = async (h: Handelse) => {
    const { feed, uid } = delaId(h.id);
    setSparar(h.id);
    try {
      await sparaÖverstyrning(feed, uid, { dold: false });
      await ladda();
      onÄndrad?.();
    } catch (e) {
      setFel(apiFelText(e));
    } finally {
      setSparar(null);
    }
  };

  return (
    <section className="pb-4">
      <button type="button" className="knapp mb-3 !min-h-[40px]" onClick={() => navigera("/installningar")}>
        <Vanster className="h-4 w-4" /> Tillbaka
      </button>

      <h1 className="mb-1 text-rubrik font-bold">Dolda pass</h1>
      <p className="mb-3 text-meta text-dampad">
        Pass ni markerat med <span className="font-semibold">Deltar ej</span>. De syns inte i veckan
        eller månaden och räknas inte som krockar.
      </p>

      {fel && <Fel text={fel} />}
      {!handelser && !fel && <Laddar />}
      {handelser && handelser.length === 0 && <Tomt text="Inga dolda pass. Inget att ångra." />}

      <div className="grid gap-2">
        {handelser?.map((h) => (
          <div key={h.id} className="rounded-2xl border border-kant bg-bakgrund p-3" style={{ borderLeft: `4px solid ${h.farg}` }}>
            <p className="text-meta text-dampad">
              {veckodag(h.start)} {datum(h.start)} · {klockslag(h.start)}–{klockslag(h.slut)} ·{" "}
              {h.barn.join(" & ")}
            </p>
            <p className="text-brod font-semibold line-through opacity-70">{h.titel}</p>
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="truncate text-meta text-dampad">{h.plats ?? "plats saknas"}</span>
              <button
                type="button"
                className="knapp shrink-0 !min-h-[36px] !text-meta"
                disabled={sparar === h.id}
                onClick={() => void återställ(h)}
              >
                Återställ
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
