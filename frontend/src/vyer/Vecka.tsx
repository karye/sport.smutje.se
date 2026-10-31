import { useMemo, useState } from "react";
import type { VyProps } from "../App";
import { Fel, Kort, Laddar, Tomt } from "../komponenter";
import { useBredd, useHändelser } from "../useHändelser";
import {
  dagEtikett,
  dagINumma,
  dagNyckel,
  isoVecka,
  klockslag,
  timmeFraktion,
  veckodagKort,
  veckansDagar,
  veckoSpann,
} from "../tid";
import type { Handelse } from "../api";

function tolkaParam(param: string | undefined): { år: number; vecka: number } {
  const träff = /^(\d{4})-v(\d{1,2})$/.exec(param ?? "");
  if (träff?.[1] && träff[2]) return { år: Number(träff[1]), vecka: Number(träff[2]) };
  return isoVecka(Date.now());
}

const veckoSträng = (år: number, vecka: number): string => `/vecka/${år}-v${vecka}`;

/** Nästa eller föregående ISO-vecka, även över årsskiftet. */
function flytta(år: number, vecka: number, steg: number): { år: number; vecka: number } {
  const dagar = veckansDagar(år, vecka);
  const måndag = dagar[0] ?? Date.now();
  // En vecka är 7 dygn; att räkna på måndagen och läsa av ISO-veckan igen klarar årsskiftet.
  return isoVecka(måndag + steg * 7 * 86_400_000);
}

export function Vecka({ param, navigera, filter, onAnsvarig, vuxna, version }: VyProps & { param?: string }) {
  const nu = Date.now();
  const { år, vecka } = tolkaParam(param);
  const idag = isoVecka(nu);
  const ärDennaVecka = idag.år === år && idag.vecka === vecka;

  const spann = useMemo(() => veckoSpann(år, vecka), [år, vecka]);
  const { handelser, laddar, fel } = useHändelser(spann, version);
  const [läge, setLäge] = useState<"översikt" | "axel">("översikt");
  const [visaTidigare, setVisaTidigare] = useState(false);
  const bredd = useBredd();

  const valda = handelser.filter(filter);
  const dagar = veckansDagar(år, vecka);

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

  // I innevarande vecka börjar listan på idag; tidigare dagar fälls ihop till en rad.
  const idagNyckel = dagNyckel(nu);
  const tidigareDagar = ärDennaVecka ? dagar.filter((d) => dagNyckel(d) < idagNyckel) : [];
  const kommandeDagar = ärDennaVecka ? dagar.filter((d) => dagNyckel(d) >= idagNyckel) : dagar;
  const tidigarePass = tidigareDagar.flatMap((d) => perDag.get(dagNyckel(d)) ?? []);

  const axel = läge === "axel" && bredd >= 640;
  // Bara olösta krockar räknas: en krock som någon tagit ansvar för är inte längre ett problem.
  const olösta = valda.filter((h) => h.krock?.olost === true).length;

  const kort = (h: Handelse) => (
    <Kort
      key={h.id}
      h={h}
      vuxna={vuxna}
      onAnsvarig={() => onAnsvarig(h)}
      onÖppna={() => navigera(`/pass/${encodeURIComponent(h.id.split("|")[0] ?? "")}/${encodeURIComponent(h.id.split("|").slice(1).join("|"))}`)}
    />
  );

  return (
    <section>
      <div className="mb-2 flex items-center gap-2 lg:gap-3">
        <button
          type="button"
          className="knapp !min-h-[40px] !px-3"
          aria-label="Föregående vecka"
          onClick={() => navigera(veckoSträng(flytta(år, vecka, -1).år, flytta(år, vecka, -1).vecka))}
        >
          ‹
        </button>
        <div className="flex-1 text-center">
          <span className="text-titel font-bold">v.{vecka}</span>
          <span className="ml-2 text-meta text-dampad">{år}</span>
          {olösta > 0 && (
            <span className="ml-2 rounded-full bg-varning/15 px-2 py-0.5 text-meta font-semibold text-varning">
              ⚠ {olösta} olösta
            </span>
          )}
        </div>
        <button
          type="button"
          className="knapp !min-h-[40px] !px-3"
          aria-label="Nästa vecka"
          onClick={() => navigera(veckoSträng(flytta(år, vecka, 1).år, flytta(år, vecka, 1).vecka))}
        >
          ›
        </button>
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        {ärDennaVecka ? (
          <button
            type="button"
            className="knapp !min-h-[40px]"
            onClick={() => navigera(veckoSträng(flytta(år, vecka, 1).år, flytta(år, vecka, 1).vecka))}
          >
            Nästa vecka
          </button>
        ) : (
          <button
            type="button"
            className="knapp !min-h-[40px]"
            onClick={() => navigera(veckoSträng(idag.år, idag.vecka))}
          >
            Tillbaka till denna vecka
          </button>
        )}
        <div className="hidden overflow-hidden rounded-xl border border-kant sm:flex">
          <button
            type="button"
            className={`px-3 text-meta font-semibold ${läge === "översikt" ? "bg-text text-bakgrund" : ""}`}
            onClick={() => setLäge("översikt")}
          >
            Översikt
          </button>
          <button
            type="button"
            className={`px-3 text-meta font-semibold ${läge === "axel" ? "bg-text text-bakgrund" : ""}`}
            onClick={() => setLäge("axel")}
          >
            Tidsaxel
          </button>
        </div>
      </div>

      {fel && <Fel text={fel} />}
      {laddar && <Laddar />}

      {!laddar && !fel && valda.length === 0 && <Tomt text="Inga pass den här veckan." />}

      {!laddar && !fel && tidigarePass.length > 0 && (
        <div className="mb-3 rounded-xl border border-kant bg-bakgrund px-3 py-2">
          <button
            type="button"
            className="flex w-full items-center justify-between text-meta font-semibold text-dampad"
            onClick={() => setVisaTidigare((v) => !v)}
          >
            <span>
              {tidigarePass.length} pass tidigare i veckan
            </span>
            <span>{visaTidigare ? "Dölj" : "Visa"}</span>
          </button>
          {visaTidigare && <div className="mt-2 grid gap-2 opacity-70">{tidigarePass.map(kort)}</div>}
        </div>
      )}

      {!laddar && !fel && axel && (
        <Tidsaxel dagar={kommandeDagar} perDag={perDag} navigera={navigera} />
      )}

      {!laddar && !fel && !axel && (
        <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
          {[kommandeDagar.slice(0, 4), kommandeDagar.slice(4)].map((kolumn) => (
            <div key={kolumn[0] ?? "tom"} className="grid gap-4">
              {kolumn.map((dag) => {
            const lista = perDag.get(dagNyckel(dag)) ?? [];
            if (lista.length === 0 && !(ärDennaVecka && dagNyckel(dag) === idagNyckel)) return null;
            return (
              <div key={dagNyckel(dag)}>
                <h2 className="sticky top-[var(--header-h,92px)] z-10 -mx-4 mb-1.5 bg-sida/95 px-4 py-1 text-meta font-bold uppercase tracking-wide text-dampad backdrop-blur">
                  {dagEtikett(dag, nu)}
                </h2>
                {lista.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-kant px-3 py-3 text-meta text-dampad">
                    Inget pass idag.
                  </p>
                ) : (
                  <div className="grid gap-2">{lista.map(kort)}</div>
                )}
              </div>
            );
              })}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ tidsaxeln */

const TIMMAR = Array.from({ length: 18 }, (_, i) => i + 6); // 06–23
const TIMME_PX = 56;
const HÖJD = TIMMAR.length * TIMME_PX;

/**
 * Veckomatris: veckodagarna horisontellt, tiden lodrätt.
 *
 * Det är den form en vecka faktiskt har — sju dagar sida vid sida och en klocka som går nedåt.
 * Samlingen ritas som ett tunt streck ovanför blocket, så att man ser att passet börjar senare
 * än man ska vara på plats, utan att blocket börjar på fel tid.
 */
function Tidsaxel({
  dagar,
  perDag,
  navigera,
}: {
  dagar: number[];
  perDag: Map<string, Handelse[]>;
  navigera: VyProps["navigera"];
}) {
  const nu = Date.now();
  const idag = dagNyckel(nu);
  const nuFraktion = timmeFraktion(nu);

  const öppna = (h: Handelse) =>
    navigera(
      `/pass/${encodeURIComponent(h.id.split("|")[0] ?? "")}/${encodeURIComponent(h.id.split("|").slice(1).join("|"))}`
    );

  return (
    <div className="overflow-hidden rounded-xl border border-kant bg-bakgrund">
      {/* Dagnavet ligger utanför scrollen, så att det alltid syns. */}
      <div className="flex border-b border-kant bg-sida">
        <div className="w-11 shrink-0" />
        {dagar.map((dag) => {
          const ärIdag = dagNyckel(dag) === idag;
          return (
            <div
              key={dagNyckel(dag)}
              className={`flex-1 border-l border-kant/60 px-0.5 py-1 text-center ${
                ärIdag ? "bg-bakgrund" : ""
              }`}
            >
              <span className={`block text-meta ${ärIdag ? "font-bold text-primar" : "text-dampad"}`}>
                {ärIdag ? "Idag" : veckodagKort(dag)}
              </span>
              <span className="block text-meta tabular-nums text-dampad">
                {dagINumma(dag)}
              </span>
            </div>
          );
        })}
      </div>

      <div className="max-h-[70vh] overflow-y-auto">
        <div className="flex">
          <div className="relative w-11 shrink-0" style={{ height: HÖJD }}>
            {TIMMAR.map((t) => (
              <span
                key={t}
                className="absolute right-1 -translate-y-1/2 text-meta tabular-nums text-dampad"
                style={{ top: (t - 6) * TIMME_PX }}
              >
                {String(t).padStart(2, "0")}
              </span>
            ))}
          </div>

          {dagar.map((dag) => {
            const lista = perDag.get(dagNyckel(dag)) ?? [];
            const ärIdag = dagNyckel(dag) === idag;
            return (
              <div
                key={dagNyckel(dag)}
                className={`relative flex-1 border-l border-kant/60 ${ärIdag ? "bg-sida/60" : ""}`}
                style={{ height: HÖJD }}
              >
                {TIMMAR.map((t) => (
                  <span
                    key={t}
                    className="absolute inset-x-0 border-t border-kant/40"
                    style={{ top: (t - 6) * TIMME_PX }}
                  />
                ))}

                {/* Nutidslinjen: bara i dagens kolumn, och bara när klockan är inom axeln. */}
                {ärIdag && nuFraktion >= 6 && nuFraktion <= 23 && (
                  <span
                    className="absolute inset-x-0 z-20 border-t-2 border-primar"
                    style={{ top: (nuFraktion - 6) * TIMME_PX }}
                  />
                )}

                {/* Samlingen ritas som ett eget streck strax ovanför blocket. Den kan inte ligga
                    inuti blocket: blocket klipper sin egen yta, och samlingen ligger före starten. */}
                {lista.map((h) => {
                  if (h.samling == null) return null;
                  const s = timmeFraktion(h.samling);
                  if (s < 6 || s > 23) return null;
                  return (
                    <span
                      key={`${h.id}-samling`}
                      aria-hidden
                      className="absolute inset-x-0.5 z-10 h-[3px] rounded-full opacity-70"
                      style={{ top: (s - 6) * TIMME_PX - 4, background: h.farg }}
                    />
                  );
                })}

                {lista.map((h) => {
                  const från = Math.max(6, Math.min(23, timmeFraktion(h.start)));
                  const till = Math.max(från + 0.35, Math.min(23, timmeFraktion(h.slut)));
                  const topp = (från - 6) * TIMME_PX;
                  const höjd = Math.max(20, (till - från) * TIMME_PX - 2);
                  return (
                    <button
                      key={h.id}
                      type="button"
                      onClick={() => öppna(h)}
                      title={`${h.titel} · ${klockslag(h.start)}–${klockslag(h.slut)}${
                        h.samling != null ? ` · samling ${klockslag(h.samling)}` : ""
                      }`}
                      className="absolute inset-x-0.5 z-10 overflow-hidden rounded-md px-1 py-0.5 text-left text-meta font-semibold leading-tight text-white shadow-sm"
                      style={{ top: topp, height: höjd, background: h.farg }}
                    >
                      <span className="block truncate">{h.titel}</span>
                      {höjd >= 34 && (
                        <span className="block truncate font-normal opacity-90">{klockslag(h.start)}</span>
                      )}
                      {h.krock?.olost && <span className="absolute right-0.5 top-0.5 text-[10px]">⚠</span>}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
