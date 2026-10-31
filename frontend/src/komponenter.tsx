import { useEffect, useRef, type ReactNode } from "react";
import type { Handelse } from "./api";
import { kalenderstämpel, klockslag } from "./tid";

/**
 * Länk som lägger passet i Google Kalender direkt, utan nyckel och utan OAuth.
 *
 * Starttiden sätts till samlingen när den finns — annars hade kalenderposten börjat vid avspark och
 * samlingen försvunnit, vilket är den enda uppgift som är lätt att missa.
 */
export function googleKalenderLänk(h: Handelse): string {
  const start = h.samling ?? h.start;
  const rader = [
    `${h.barn.join(" & ")} · ${h.sport} · ${h.klubb}`,
    h.samling != null ? `Samling ${klockslag(h.samling)}. Passet börjar ${klockslag(h.start)}.` : "",
    h.plats ? `Plats: ${h.plats}` : "",
    h.motstandare ? `Motståndare: ${h.motstandare}` : "",
    h.anteckning ? `Anteckning: ${h.anteckning}` : "",
    "Skapat i sport.smutje.se",
  ].filter(Boolean);

  const frågor = new URLSearchParams({
    action: "TEMPLATE",
    text: `${h.titel} (${h.klubb})`,
    dates: `${kalenderstämpel(start)}/${kalenderstämpel(h.slut)}`,
    details: rader.join("\n\n"),
    location: h.plats ?? "",
  });

  return `https://calendar.google.com/calendar/render?${frågor.toString()}`;
}

export function Laddar({ text = "Hämtar…" }: { text?: string }) {
  return <p className="px-1 py-6 text-center text-meta text-dampad">{text}</p>;
}

export function Fel({ text }: { text: string }) {
  return (
    <p className="mx-1 my-4 rounded-xl border border-fel/30 bg-fel/10 px-3 py-2 text-meta text-fel">{text}</p>
  );
}

export function Tomt({ text }: { text: string }) {
  return <p className="px-1 py-6 text-center text-meta text-dampad">{text}</p>;
}

/* ------------------------------------------------------------------ ark */

/**
 * Ark från botten. Används i stället för modal i mitten: på en telefon når tummen hit, och
 * arket kan scrolla utan att sidan bakom hoppar.
 */
export function Ark({
  öppen,
  rubrik,
  onStang,
  children,
}: {
  öppen: boolean;
  rubrik: string;
  onStang: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!öppen) return;
    const påTangent = (e: KeyboardEvent) => {
      if (e.key === "Escape") onStang();
    };
    document.addEventListener("keydown", påTangent);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", påTangent);
      document.body.style.overflow = "";
    };
  }, [öppen, onStang]);

  if (!öppen) return null;

  return (
    <div className="fixed inset-0 z-40">
      <button
        aria-label="Stäng"
        className="absolute inset-0 h-full w-full bg-black/40"
        onClick={onStang}
        type="button"
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={rubrik}
        className="ark-panel absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl border-t border-kant bg-bakgrund pb-[calc(env(safe-area-inset-bottom)+1rem)] shadow-2xl"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-kant bg-bakgrund px-4 py-3">
          <h2 className="text-titel font-semibold">{rubrik}</h2>
          <button type="button" className="knapp" onClick={onStang}>
            Klar
          </button>
        </div>
        <div className="px-4 py-3">{children}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ fält */

export function Fält({
  etikett,
  ...rest
}: { etikett: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1 block text-meta font-semibold text-dampad">{etikett}</span>
      <input className="falt" {...rest} />
    </label>
  );
}

export function Väljare({
  etikett,
  värde,
  alternativ,
  onChange,
}: {
  etikett: string;
  värde: string;
  alternativ: { värde: string; text: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-meta font-semibold text-dampad">{etikett}</span>
      <select className="falt" value={värde} onChange={(e) => onChange(e.target.value)}>
        {alternativ.map((a) => (
          <option key={a.värde} value={a.värde}>
            {a.text}
          </option>
        ))}
      </select>
    </label>
  );
}

/* ------------------------------------------------------------------ chips */

export function Chips({
  val,
  onChange,
  grupper,
  extra,
}: {
  val: Set<string>;
  onChange: (ny: Set<string>) => void;
  grupper: { namn: string; färg?: string }[];
  /** Ett filter som inte är ett namn, till exempel "saknar ansvarig". Ligger i samma rad. */
  extra?: { text: string; på: boolean; växla: () => void };
}) {
  const växla = (namn: string) => {
    const ny = new Set(val);
    if (ny.has(namn)) ny.delete(namn);
    else ny.add(namn);
    onChange(ny);
  };

  if (grupper.length === 0) return null;

  return (
    <div className="flex gap-2 overflow-x-auto px-4 pb-2 lg:px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <button
        type="button"
        className={`shrink-0 rounded-full border px-3 py-1.5 text-meta font-semibold ${
          val.size === 0 ? "border-text bg-text text-bakgrund" : "border-kant bg-bakgrund"
        }`}
        onClick={() => onChange(new Set())}
      >
        Alla
      </button>
      {extra && (
        <button
          type="button"
          onClick={extra.växla}
          className={`shrink-0 rounded-full border px-3 py-1.5 text-meta font-semibold ${
            extra.på ? "border-varning bg-varning/15 text-varning" : "border-kant bg-bakgrund text-dampad"
          }`}
        >
          {extra.text}
        </button>
      )}
      {grupper.map((g) => {
        const på = val.has(g.namn);
        return (
          <button
            key={g.namn}
            type="button"
            onClick={() => växla(g.namn)}
            className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-meta font-semibold ${
              på ? "border-text bg-text text-bakgrund" : "border-kant bg-bakgrund"
            }`}
          >
            {g.färg && (
              <span
                aria-hidden
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: g.färg }}
              />
            )}
            {g.namn}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ kortet */

export function Kort({
  h,
  onÖppna,
  onAnsvarig,
  vuxna,
}: {
  h: Handelse;
  onÖppna: () => void;
  onAnsvarig: () => void;
  vuxna: { id: number; namn: string }[];
}) {
  const inställd = h.status === "CANCELLED";
  const krock = h.krock;
  const ansvarigText =
    h.ansvarig.typ === "person"
      ? (h.ansvarigNamn ?? vuxna.find((v) => v.id === h.ansvarig.user_id)?.namn ?? "Okänd")
      : h.ansvarig.typ === "samakning"
        ? "Samåkning"
        : h.ansvarig.typ === "egen"
          ? "Egen transport"
          : null;

  return (
    <div className="relative flex overflow-hidden rounded-2xl border border-kant bg-bakgrund shadow-sm transition hover:border-dampad/40">
      {/*
        Färgstolpen ligger innanför kortet med samma höjd som det, alltså blir hörnen skarpa.
        Två barn på samma pass ger två färger i stolpen, inte bara det ena barnets.
      */}
      <span
        aria-hidden
        className="w-1.5 shrink-0"
        style={{
          background:
            (h.fargLista?.length ?? 1) > 1
              ? `linear-gradient(to bottom, ${h.fargLista.join(", ")})`
              : (h.fargLista?.[0] ?? h.farg),
        }}
      />

      {/* Hela kortet är klickbart, men knappen nedanför vinner över klickytan. */}
      <button
        type="button"
        aria-label={`Öppna ${h.titel}`}
        className="absolute inset-0 z-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primar"
        onClick={onÖppna}
      />

      <div className="pointer-events-none relative z-10 flex min-w-0 flex-1 items-start justify-between gap-3 py-2.5 pl-3 pr-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-titel font-bold tabular-nums">
              {klockslag(h.start)}–{klockslag(h.slut)}
            </span>
            {h.flerdygn && <span className="text-meta text-dampad">flera dagar</span>}
            {inställd && (
              <span className="rounded bg-fel/10 px-1.5 py-0.5 text-meta font-semibold text-fel">Inställt</span>
            )}
            {h.samling != null && (
              <span className="rounded bg-sida px-1.5 py-0.5 text-meta font-semibold">
                Samling {klockslag(h.samling)}
                {h.samlingKalla === "manuell" ? " (rättad)" : ""}
              </span>
            )}
            {krock && (
              <span className="rounded bg-varning/15 px-1.5 py-0.5 text-meta font-semibold text-varning">
                {krock.sammaBarn ? "Dubbelbokat" : null}
                {!krock.sammaBarn && krock.typ === "tid"
                  ? `${Math.abs(krock.glappMin)} min överlapp`
                  : null}
                {!krock.sammaBarn && krock.typ !== "tid"
                  ? `${krock.glappMin} min mellan, ${krock.restidMin} min resa`
                  : null}
                {krock.olost ? "" : " · löst"}
              </span>
            )}
          </div>

          <p className={`mt-0.5 truncate text-brod font-semibold ${inställd ? "line-through opacity-60" : ""}`}>
            {h.titel}
          </p>
          <p className="flex items-center gap-1.5 text-meta text-dampad">
            <span
              aria-hidden
              className="inline-block h-2 w-2 shrink-0 rounded-full"
              style={{ background: h.sportFarg ?? "transparent", border: h.sportFarg ? "none" : "1px solid currentColor" }}
            />
            <span className="truncate">
              {[h.barn.join(" & "), h.sport === "okänd" ? null : h.sport, h.klubb, h.plats ?? "plats saknas"]
                .filter(Boolean)
                .join(" · ")}
              {h.motstandare ? ` · mot ${h.motstandare}` : ""}
            </span>
          </p>
          {h.anteckning && (
            <p className="mt-1 truncate text-meta text-dampad">”{h.anteckning}”</p>
          )}
        </div>

        <button
          type="button"
          className="knapp pointer-events-auto relative z-10 shrink-0 !min-h-[36px] !px-2 !text-meta"
          onClick={(e) => {
            e.stopPropagation();
            onAnsvarig();
          }}
        >
          {ansvarigText ?? "Vem skjutsar?"}
        </button>
      </div>
    </div>
  );
}
