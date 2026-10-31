import { useEffect, useState } from "react";
import type { VyProps } from "../App";
import { apiFelText, kalenderlänk, hämtaPass, sparaÖverstyrning, type Passsvar } from "../api";
import { Fel, Laddar, googleKalenderLänk } from "../komponenter";
import { datum, klockslag, veckodag } from "../tid";

/**
 * Pass-sidan. Egen adress, eftersom den ska kunna skickas till den andra föräldern.
 * Tillbaka går till historiken när den finns, annars till veckan.
 */
export function Pass({
  feed,
  uid,
  navigera,
  onAnsvarig,
  version,
}: VyProps & { feed: string; uid: string }) {
  const [svar, setSvar] = useState<Passsvar | null>(null);
  const [fel, setFel] = useState<string | null>(null);
  const [sparar, setSparar] = useState(false);
  const [egenVersion, setEgenVersion] = useState(0);

  useEffect(() => {
    let avbruten = false;
    setFel(null);
    (async () => {
      try {
        const s = await hämtaPass(feed, uid);
        if (!avbruten) setSvar(s);
      } catch (e) {
        if (!avbruten) setFel(apiFelText(e));
      }
    })();
    return () => {
      avbruten = true;
    };
  }, [feed, uid, version, egenVersion]);

  const tillbaka = () => {
    if (window.history.length > 1) window.history.back();
    else navigera("/vecka");
  };

  if (fel) {
    return (
      <section>
        <Fel text={fel} />
        <button type="button" className="knapp mt-2" onClick={tillbaka}>
          Tillbaka
        </button>
      </section>
    );
  }

  if (!svar) return <Laddar />;

  const h = svar.handelse;
  const { feed: f, uid: u } = { feed, uid };

  const växlaDold = async () => {
    setSparar(true);
    try {
      await sparaÖverstyrning(f, u, { dold: !h.dold });
      setEgenVersion((v) => v + 1);
    } catch (e) {
      setFel(apiFelText(e));
    } finally {
      setSparar(false);
    }
  };

  return (
    <section className="pb-4">
      <button type="button" className="knapp mb-3 !min-h-[40px]" onClick={tillbaka}>
        ‹ Tillbaka
      </button>

      <div className="rounded-2xl border border-kant bg-bakgrund p-4" style={{ borderLeft: `5px solid ${h.farg}` }}>
        <p className="text-meta font-semibold uppercase tracking-wide text-dampad">
          {h.barn.join(" & ")} · {h.klubb} · {h.sport}
        </p>
        <h1 className={`mt-1 text-lg font-bold leading-tight ${h.status === "CANCELLED" ? "line-through opacity-60" : ""}`}>
          {h.titel}
        </h1>

        {h.status === "CANCELLED" && (
          <p className="mt-1 rounded-lg bg-fel/10 px-2 py-1 text-meta font-semibold text-fel">
            Föreningen har ställt in passet.
          </p>
        )}

        <dl className="mt-3 grid grid-cols-[5.5rem_1fr] gap-y-1.5 text-brod">
          <dt className="text-meta font-semibold text-dampad">När</dt>
          <dd>
            {veckodag(h.start)} {datum(h.start)}
            <br />
            <span className="tabular-nums">
              {klockslag(h.start)}–{klockslag(h.slut)}
            </span>
          </dd>

          <dt className="text-meta font-semibold text-dampad">Samling</dt>
          <dd>
            {h.samling != null ? (
              <>
                <span className="font-semibold tabular-nums">{klockslag(h.samling)}</span>
                {h.samlingKalla === "manuell" && <span className="text-meta text-dampad"> (rättad)</span>}
              </>
            ) : (
              <span className="text-dampad">saknas i inbjudan</span>
            )}
          </dd>

          <dt className="text-meta font-semibold text-dampad">Plats</dt>
          <dd>{h.plats ?? <span className="text-dampad">saknas i inbjudan</span>}</dd>

          {h.motstandare && (
            <>
              <dt className="text-meta font-semibold text-dampad">Motståndare</dt>
              <dd>{h.motstandare}</dd>
            </>
          )}

          <dt className="text-meta font-semibold text-dampad">Ansvarig</dt>
          <dd>
            {h.ansvarig.typ === "person"
              ? (h.ansvarigNamn ?? "förälder")
              : h.ansvarig.typ === "samakning"
                ? "Samåkning"
                : h.ansvarig.typ === "egen"
                  ? "Egen transport"
                  : <span className="text-dampad">ingen vald</span>}
          </dd>

          {h.anteckning && (
            <>
              <dt className="text-meta font-semibold text-dampad">Anteckning</dt>
              <dd>{h.anteckning}</dd>
            </>
          )}
        </dl>

        {h.krock && (
          <div className="mt-3 rounded-xl bg-varning/10 px-3 py-2">
            <p className="text-meta font-semibold text-varning">
              {h.krock.sammaBarn
                ? "Dubbelbokat för samma barn"
                : h.krock.typ === "tid"
                  ? `Tidskrock, ${Math.abs(h.krock.glappMin)} min överlapp`
                  : `Bara ${h.krock.glappMin} minuter mellan, resan tar ${h.krock.restidMin}`}
              {h.krock.olost ? " — olöst" : " — löst"}
            </p>
            {svar.krockar.map((k) => (
              <button
                key={k.id}
                type="button"
                className="mt-1 block w-full truncate text-left text-meta underline"
                onClick={() =>
                  navigera(`/pass/${encodeURIComponent(k.id.split("|")[0] ?? "")}/${encodeURIComponent(k.id.split("|").slice(1).join("|"))}`)
                }
              >
                {k.barn}: {k.titel} · {klockslag(k.start)}
              </button>
            ))}
          </div>
        )}

        {h.beskrivning && (
          <details className="mt-3">
            <summary className="cursor-pointer text-meta font-semibold text-dampad">Föreningens text</summary>
            <p className="mt-1 whitespace-pre-wrap text-brod">{h.beskrivning}</p>
          </details>
        )}

        <div className="mt-4 grid gap-2 lg:grid-cols-2">
          <button type="button" className="knapp" onClick={() => onAnsvarig(h)}>
            Ändra ansvarig eller anteckning
          </button>
          <a className="knapp primar" href={kalenderlänk(f, u)} download>
            Ladda ner kalenderfil
          </a>
          <a className="knapp" href={googleKalenderLänk(h)} target="_blank" rel="noopener noreferrer">
            Lägg i Google Kalender
          </a>
          <button
            type="button"
            className={`knapp ${h.dold ? "aktiv" : ""}`}
            disabled={sparar}
            onClick={() => void växlaDold()}
          >
            {h.dold ? "Deltar ej ✓ (ångra)" : "Vi deltar inte"}
          </button>
        </div>
      </div>
    </section>
  );
}
