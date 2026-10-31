import { useEffect, useMemo, useState } from "react";
import type { VyProps } from "../App";
import { Fel, Kort, Laddar } from "../komponenter";
import { Hoger, Vanster, Varning } from "../ikoner";
import { useHändelser } from "../useHändelser";
import {
  dagINumma,
  dagNyckel,
  isoVecka,
  lokalMidnatt,
  månadFrånParam,
  månadOchÅr,
  månadINumma,
  klockslag,
  månadsSpann,
  datum,
} from "../tid";
import type { Handelse } from "../api";

const VECKODAGAR = ["mån", "tis", "ons", "tor", "fre", "lör", "sön"];

/** Dagens datum om månaden är innevarande, annars den 1:a. */
function standardDag(år: number, månad: number): number {
  const första = lokalMidnatt(år, månad, 1);
  const sista = lokalMidnatt(år, månad, new Date(Date.UTC(år, månad, 0)).getUTCDate());
  const nu = Date.now();
  return nu >= första && nu <= sista ? nu : första;
}

export function Manad({ param, navigera, filter, onAnsvarig, vuxna, version }: VyProps & { param?: string }) {
  const { år, månad } = månadFrånParam(param);
  const spann = useMemo(() => månadsSpann(år, månad), [år, månad]);
  const { handelser, laddar, fel } = useHändelser(
    { fran: spann.fran, till: spann.till },
    version
  );

  const nu = Date.now();
  const idagNyckel = dagNyckel(nu);
  const valda = handelser.filter(filter);

  const perDag = useMemo(() => {
    const karta = new Map<string, Handelse[]>();
    for (const h of valda) {
      const nyckel = dagNyckel(h.start);
      const lista = karta.get(nyckel) ?? [];
      lista.push(h);
      karta.set(nyckel, lista);
    }
    for (const lista of karta.values()) lista.sort((a, b) => a.start - b.start);
    return karta;
  }, [valda]);

  // Vald dag hålls som tidpunkt, inte som sträng: då slipper jämförelsen tolka datumformat.
  const [valdDag, setValdDag] = useState<number>(() => standardDag(år, månad));

  // Byter man månad måste den valda dagen följa med, annars visar listan under rutnätet en dag
  // från föregående månad.
  useEffect(() => {
    setValdDag(standardDag(år, månad));
  }, [år, månad]);

  const flerdygn = valda.filter((h) => h.flerdygn);
  const dagens = perDag.get(dagNyckel(valdDag)) ?? [];

  const flyttaMånad = (steg: number): string => {
    const m = månad + steg;
    if (m < 1) return `/manad/${år - 1}-12`;
    if (m > 12) return `/manad/${år + 1}-1`;
    return `/manad/${år}-${m}`;
  };

  const kort = (h: Handelse) => (
    <Kort
      key={h.id}
      h={h}
      vuxna={vuxna}
      onAnsvarig={() => onAnsvarig(h)}
      onÖppna={() =>
        navigera(`/pass/${encodeURIComponent(h.id.split("|")[0] ?? "")}/${encodeURIComponent(h.id.split("|").slice(1).join("|"))}`)
      }
    />
  );

  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <button type="button" className="knapp !min-h-[40px] !px-3" aria-label="Föregående månad" onClick={() => navigera(flyttaMånad(-1))}>
          <Vanster className="h-4 w-4" />
        </button>
        <div className="flex-1 text-center text-rubrik font-bold capitalize">
          {månadOchÅr(lokalMidnatt(år, månad, 15))}
        </div>
        <button type="button" className="knapp !min-h-[40px] !px-3" aria-label="Nästa månad" onClick={() => navigera(flyttaMånad(1))}>
          <Hoger className="h-4 w-4" />
        </button>
      </div>

      {flerdygn.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {flerdygn.map((h) => (
            <span
              key={h.id}
              className="rounded-full border border-kant bg-bakgrund px-2 py-1 text-meta font-semibold"
              style={{ borderLeft: `3px solid ${h.farg}` }}
            >
              {h.titel} · {datum(h.start)}
            </span>
          ))}
        </div>
      )}

      {fel && <Fel text={fel} />}
      {laddar && <Laddar />}

      {!laddar && !fel && (
        <>
          <div className="overflow-hidden rounded-xl border border-kant bg-bakgrund">
            <div className="grid grid-cols-[2.25rem_repeat(7,minmax(0,1fr))] border-b border-kant bg-sida">
              <div className="px-1 py-1.5" />
              {VECKODAGAR.map((d) => (
                <div key={d} className="px-1 py-1.5 text-center text-meta font-semibold text-dampad">
                  {d}
                </div>
              ))}
            </div>

            {Array.from({ length: Math.ceil(spann.dagar.length / 7) }, (_, rad) => {
              const veckodagar = spann.dagar.slice(rad * 7, rad * 7 + 7);
              const måndag = veckodagar[0] ?? spann.dagar[0] ?? Date.now();
              const { vecka } = isoVecka(måndag);
              return (
                <div key={rad} className="grid grid-cols-[2.25rem_repeat(7,minmax(0,1fr))] border-b border-kant/60 last:border-0">
                  <div className="flex items-start justify-center px-1 pt-1 text-meta text-dampad">v.{vecka}</div>
                  {veckodagar.map((dag) => {
                    const nyckel = dagNyckel(dag);
                    const lista = perDag.get(nyckel) ?? [];
                    const iMånaden = månadINumma(dag) === månad;
                    const ärIdag = nyckel === idagNyckel;
                    const vald = nyckel === dagNyckel(valdDag);
                    const olöst = lista.some((h) => h.krock?.olost === true);
                    return (
                      <button
                        key={nyckel}
                        type="button"
                        onClick={() => setValdDag(dag)}
                        className={`flex min-h-[56px] min-w-0 flex-col items-stretch gap-1 overflow-hidden border-l border-kant/60 px-1 pb-1 pt-0.5 text-left lg:min-h-[96px] lg:px-1.5 ${
                          vald ? "bg-sida" : ""
                        } ${iMånaden ? "" : "opacity-40"}`}
                        aria-label={`${datum(dag)}${lista.length > 0 ? `, ${lista.length} pass` : ""}`}
                        aria-current={vald ? "date" : undefined}
                      >
                        <span className="flex items-center justify-between text-meta">
                          <span className={`${ärIdag ? "font-bold text-primar" : ""}`}>
                            {ärIdag ? "Idag" : dagINumma(dag)}
                          </span>
                          {olöst && (
                            <span className="text-varning" title="olöst krock">
                              <Varning className="h-3.5 w-3.5" />
                            </span>
                          )}
                        </span>
                        <span className="grid gap-0.5">
                          {lista.slice(0, 3).map((h) => (
                            <span key={h.id} className="min-w-0">
                              {/* Mobil: ett streck räcker som täthetsindikator. */}
                              <span
                                className="block h-1.5 rounded-full lg:hidden"
                                style={{ background: h.farg }}
                              />
                              {/* Desktop: tid och aktivitet, som i en riktig kalender. */}
                              <span
                                className="hidden min-w-0 items-center gap-1 overflow-hidden rounded px-1 py-0.5 text-[11px] font-semibold leading-tight text-white lg:flex"
                                style={{ background: h.farg }}
                                title={h.titel}
                              >
                                <span className="shrink-0 tabular-nums">
                                  {h.heldag || klockslag(h.start) === "00:00" ? "Heldag" : klockslag(h.start)}
                                </span>
                                <span className="truncate">{h.titel}</span>
                              </span>
                            </span>
                          ))}
                          {lista.length > 3 && (
                            <span className="text-meta leading-none text-dampad">+{lista.length - 3}</span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>

          <h2 className="mt-4 mb-1.5 text-meta font-bold uppercase tracking-wide text-dampad">
            {datum(valdDag)}
          </h2>
          {dagens.length === 0 ? (
            <p className="rounded-xl border border-dashed border-kant px-3 py-3 text-meta text-dampad">
              Inga pass den här dagen.
            </p>
          ) : (
            <div className="grid gap-2 lg:grid-cols-2">{dagens.map(kort)}</div>
          )}
        </>
      )}
    </section>
  );
}
