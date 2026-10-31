import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  apiFelText,
  delaId,
  hämtaBarn,
  hämtaFloden,
  hämtaSporter,
  hämtaVuxna,
  uppdateraFloden,
  sparaÖverstyrning,
  type Ansvarig,
  type Barn,
  type Handelse,
  type Sport,
  type Vuxen,
} from "./api";
import { Ark, Chips, Fel, googleKalenderLänk } from "./komponenter";
import { Flagga, SportIkon, Uppdatera, Vanster } from "./ikoner";
import { dagNyckel, isoVecka, klockslag, sedan, tillStockholmMs, veckodag } from "./tid";
import { Vecka } from "./vyer/Vecka";
import { Manad } from "./vyer/Manad";
import { Pass } from "./vyer/Pass";
import { Installningar } from "./vyer/Installningar";
import { Dolda } from "./vyer/Dolda";

export interface VyProps {
  navigera: (till: string, ersätt?: boolean) => void;
  filter: (h: Handelse) => boolean;
  vuxna: Vuxen[];
  onAnsvarig: (h: Handelse) => void;
  /** Ökas varje gång något sparats, så att vyn hämtar om. */
  version: number;
}

/* ------------------------------------------------------------------ router */

function useRouter(): [string, (till: string, ersätt?: boolean) => void] {
  const [väg, setVäg] = useState(() => window.location.pathname + window.location.search);

  useEffect(() => {
    const påPop = () => setVäg(window.location.pathname + window.location.search);
    window.addEventListener("popstate", påPop);
    return () => window.removeEventListener("popstate", påPop);
  }, []);

  const navigera = useCallback((till: string, ersätt = false) => {
    if (till === window.location.pathname + window.location.search) return;
    if (ersätt) window.history.replaceState({}, "", till);
    else window.history.pushState({}, "", till);
    setVäg(till);
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);

  return [väg, navigera];
}

/* ------------------------------------------------------------------ ansvarigarket */

const ANSVARIGA: { typ: Ansvarig["typ"]; text: string }[] = [
  { typ: "ingen", text: "Ingen vald" },
  { typ: "samakning", text: "Samåkning" },
  { typ: "egen", text: "Egen transport" },
];

function AnsvarigArk({
  h,
  vuxna,
  onStang,
  onSparad,
  navigera,
}: {
  h: Handelse;
  vuxna: Vuxen[];
  onStang: () => void;
  onSparad: () => void;
  navigera: VyProps["navigera"];
}) {
  const { feed, uid } = delaId(h.id);
  const [sparar, setSparar] = useState(false);
  const [fel, setFel] = useState<string | null>(null);
  const [anteckning, setAnteckning] = useState(h.anteckning ?? "");
  const [samling, setSamling] = useState(h.samling != null ? klockslag(h.samling) : "");

  const spara = async (kropp: Parameters<typeof sparaÖverstyrning>[2]) => {
    setSparar(true);
    setFel(null);
    try {
      await sparaÖverstyrning(feed, uid, kropp);
      onSparad();
      onStang();
    } catch (e) {
      setFel(apiFelText(e));
    } finally {
      setSparar(false);
    }
  };

  const välj = (typ: Ansvarig["typ"], userId: number | null) => {
    void spara({ ansvarig: { typ, user_id: userId } });
  };

  const vald = (typ: Ansvarig["typ"], userId: number | null): boolean =>
    h.ansvarig.typ === typ && (typ !== "person" || h.ansvarig.user_id === userId);

  return (
    <Ark öppen rubrik={h.titel} onStang={onStang}>
      <p className="mb-3 text-meta text-dampad">
        {veckodag(h.start)} {klockslag(h.start)} · {h.barn.join(" & ")} · {h.klubb}
        {h.plats ? ` · ${h.plats}` : ""}
      </p>
      {h.uppdateradAv && h.uppdaterad && (
        <p className="mb-3 text-meta text-dampad">
          {h.uppdateradAv} ändrade {sedan(h.uppdaterad)}
        </p>
      )}

      {fel && <Fel text={fel} />}

      <div className="grid gap-2">
        {vuxna.map((v) => (
          <button
            key={v.id}
            type="button"
            disabled={sparar}
            className={`knapp justify-start ${vald("person", v.id) ? "aktiv" : ""}`}
            onClick={() => välj("person", v.id)}
          >
            {v.namn}
          </button>
        ))}
        {ANSVARIGA.map((a) => (
          <button
            key={a.typ}
            type="button"
            disabled={sparar}
            className={`knapp justify-start ${vald(a.typ, null) ? "aktiv" : ""}`}
            onClick={() => välj(a.typ, null)}
          >
            {a.text}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-2">
        <label className="block">
          <span className="mb-1 block text-meta font-semibold text-dampad">
            Rättad samlingstid (tom = använd föreningens)
          </span>
          <div className="flex gap-2">
            <input
              className="falt flex-1"
              inputMode="numeric"
              placeholder="09:15"
              value={samling}
              onChange={(e) => setSamling(e.target.value)}
            />
            <button
              type="button"
              className="knapp"
              disabled={sparar}
              onClick={() => {
                if (!samling.trim()) {
                  void spara({ samling_ms: null });
                  return;
                }
                const ms = tillStockholmMs(dagNyckel(h.start), samling);
                if (ms == null) {
                  setFel("Skriv tiden som 09:15");
                  return;
                }
                void spara({ samling_ms: ms });
              }}
            >
              Spara tid
            </button>
          </div>
        </label>
        <label className="block">
          <span className="mb-1 block text-meta font-semibold text-dampad">Anteckning</span>
          <textarea
            className="falt min-h-[64px]"
            value={anteckning}
            placeholder="termos, matchtröja, skjuts från jobbet…"
            onChange={(e) => setAnteckning(e.target.value)}
          />
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            className="knapp flex-1"
            disabled={sparar}
            onClick={() => void spara({ anteckning: anteckning.trim() ? anteckning.trim() : null })}
          >
            Spara anteckning
          </button>
          <button
            type="button"
            className={`knapp flex-1 ${h.dold ? "aktiv" : ""}`}
            disabled={sparar}
            onClick={() => void spara({ dold: !h.dold })}
          >
            {h.dold ? "Deltar ej ✓" : "Deltar ej"}
          </button>
        </div>
        <a
          className="knapp"
          href={googleKalenderLänk(h)}
          target="_blank"
          rel="noopener noreferrer"
        >
          Lägg i Google Kalender
        </a>
        <button
          type="button"
          className="knapp"
          onClick={() => {
            onStang();
            navigera(`/pass/${encodeURIComponent(feed)}/${encodeURIComponent(uid)}`);
          }}
        >
          Öppna passet
        </button>
      </div>
    </Ark>
  );
}

/* ------------------------------------------------------------------ appen */

export function App() {
  const [väg, navigera] = useRouter();
  const [barn, setBarn] = useState<Barn[]>([]);
  const [vuxna, setVuxna] = useState<Vuxen[]>([]);
  const [sporter, setSporter] = useState<Sport[]>([]);
  const [valda, setValda] = useState<Set<string>>(new Set());
  const [utanAnsvarig, setUtanAnsvarig] = useState(false);
  const headerRef = useRef<HTMLElement | null>(null);

  // Dagsrubrikerna i veckan klistrar under headern, vars höjd beror av chip-raden. Höjden mäts i
  // stället för att gissas: en fast 52 px gjorde att rubriken gled in bakom chipsen.
  useLayoutEffect(() => {
    const sätt = () => {
      const h = headerRef.current;
      if (h) document.documentElement.style.setProperty("--header-h", `${h.offsetHeight}px`);
    };
    sätt();
    const observatör = new ResizeObserver(sätt);
    if (headerRef.current) observatör.observe(headerRef.current);
    window.addEventListener("resize", sätt);
    return () => {
      observatör.disconnect();
      window.removeEventListener("resize", sätt);
    };
  }, []);

  const [ark, setArk] = useState<Handelse | null>(null);
  const [version, setVersion] = useState(0);
  const [startFel, setStartFel] = useState<string | null>(null);
  const [hämtar, setHämtar] = useState(false);
  const [hämtat, setHämtat] = useState<number | null>(null);

  useEffect(() => {
    let avbruten = false;
    (async () => {
      try {
        const [b, v, s, f] = await Promise.all([
          hämtaBarn(),
          hämtaVuxna(),
          hämtaSporter(),
          hämtaFloden(),
        ]);
        if (avbruten) return;
        setBarn(b.barn);
        setVuxna(v);
        setSporter(s);
        setHämtat(f.reduce<number | null>((sen, x) => (x.senastHamtad && (!sen || x.senastHamtad > sen) ? x.senastHamtad : sen), null));
      } catch (e) {
        if (!avbruten) setStartFel(apiFelText(e));
      }
    })();
    return () => {
      avbruten = true;
    };
  }, []);

  // Rotadressen skickar vidare till innevarande vecka, utan att lägga något i historiken.
  useEffect(() => {
    if (väg !== "/") return;
    const { år, vecka } = isoVecka(Date.now());
    navigera(`/vecka/${år}-v${vecka}`, true);
  }, [väg, navigera]);

  const filter = useCallback(
    (h: Handelse) => {
      if (utanAnsvarig && h.ansvarig.typ !== "ingen") return false;
      return valda.size === 0 || h.barn.some((b) => valda.has(b)) || valda.has(h.sport);
    },
    [valda, utanAnsvarig]
  );

  const vyProps: VyProps = useMemo(
    () => ({
      navigera,
      filter,
      vuxna,
      onAnsvarig: setArk,
      version,
    }),
    [navigera, filter, vuxna, version]
  );

  const delar = väg.split("/").filter(Boolean);
  const sektion = delar[0] ?? "vecka";

  // Kalendervyerna är hemma. Allt annat — inställningar, dolda pass, ett enskilt pass — får en
  // bakåtknapp i huvudet, för bottenmenyn räcker inte som enda väg tillbaka.
  const ärKalendervy = sektion === "vecka" || sektion === "manad";

  const tillbaka = useCallback(() => {
    if (window.history.length > 1) window.history.back();
    else navigera("/vecka", true);
  }, [navigera]);

  const innehåll = (() => {
    if (väg === "/") return null;
    if (sektion === "vecka") return <Vecka {...vyProps} param={delar[1]} />;
    if (sektion === "manad") return <Manad {...vyProps} param={delar[1]} />;
    if (sektion === "pass" && delar[1] && delar[2])
      return <Pass {...vyProps} feed={delar[1]} uid={decodeURIComponent(delar[2])} />;
    if (sektion === "installningar")
      return <Installningar {...vyProps} onÖppnaDolda={() => navigera("/dolda")} />;
    if (sektion === "dolda")
      return <Dolda {...vyProps} onÄndrad={() => setVersion((v) => v + 1)} />;
    return <p className="px-4 py-8 text-meta text-dampad">Sidan finns inte.</p>;
  })();

  const flik = (till: string, text: string, aktiv: boolean) => (
    <button
      key={till}
      type="button"
      onClick={() => navigera(till, till === "/vecka" || till === "/manad")}
      className={`flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 text-meta font-semibold ${
        aktiv ? "text-text" : "text-dampad"
      }`}
      aria-current={aktiv ? "page" : undefined}
    >
      {text}
    </button>
  );

  return (
    <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col lg:max-w-5xl">
      <header
        ref={headerRef}
        className="sticky top-0 z-20 border-b border-kant bg-bakgrund/95 pt-[env(safe-area-inset-top)] backdrop-blur"
      >
        <div className="flex h-[52px] items-center justify-between gap-2 px-4 lg:px-6">
          <div className="flex min-w-0 items-center gap-1">
            {!ärKalendervy && (
              <button
                type="button"
                className="knapp !min-h-[36px] !border-transparent !px-2 !text-lg"
                aria-label="Tillbaka till kalendern"
                onClick={tillbaka}
              >
                <Vanster className="h-4 w-4" />
              </button>
            )}
            <span className="truncate text-titel font-bold">
              {sektion === "installningar" ? "Inställningar" : sektion === "dolda" ? "Dolda pass" : "Familjens kalender"}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {/* På desktop finns plats för flikar i huvudet; då behövs ingen bottenmeny. */}
            <nav className="mr-2 hidden items-center gap-1 lg:flex" aria-label="Huvudmeny">
              {[
                { till: "/vecka", text: "Vecka", aktiv: sektion === "vecka" || sektion === "pass" },
                { till: "/manad", text: "Månad", aktiv: sektion === "manad" },
                {
                  till: "/installningar",
                  text: "Mer",
                  aktiv: sektion === "installningar" || sektion === "dolda",
                },
              ].map((f) => (
                <button
                  key={f.till}
                  type="button"
                  onClick={() => navigera(f.till)}
                  className={`rounded-lg px-3 py-1.5 text-meta font-semibold ${
                    f.aktiv ? "bg-text text-bakgrund" : "text-dampad hover:bg-sida"
                  }`}
                >
                  {f.text}
                </button>
              ))}
            </nav>
            <button
              type="button"
              className="knapp !min-h-[36px] !border-transparent !px-2"
              aria-label="Uppdatera flödena"
              title={hämtat ? `Flödena hämtades ${sedan(hämtat)}` : "Uppdatera flödena"}
              disabled={hämtar}
              onClick={async () => {
                setHämtar(true);
                try {
                  await uppdateraFloden();
                  const f = await hämtaFloden();
                  setHämtat(f.reduce<number | null>((sen, x) => (x.senastHamtad && (!sen || x.senastHamtad > sen) ? x.senastHamtad : sen), null));
                  setVersion((v) => v + 1);
                } catch (e) {
                  setStartFel(apiFelText(e));
                } finally {
                  setHämtar(false);
                }
              }}
            >
              <Uppdatera className={`h-4 w-4 ${hämtar ? "animate-spin" : ""}`} />
            </button>

          </div>
        </div>
        {(sektion === "vecka" || sektion === "manad") && (
          <Chips
            val={valda}
            onChange={setValda}
            grupper={[
              ...barn.map((b) => ({ namn: b.namn, färg: b.farg })),
              ...sporter
                .filter((s) => s.antal > 0)
                .map((s) => ({
                  namn: s.namn,
                  ikon: (
                    <span style={{ color: s.farg }}>
                      <SportIkon sport={s.namn} className="h-3.5 w-3.5" />
                    </span>
                  ),
                })),
            ]}
            extra={{
              text: "Saknar ansvarig",
              ikon: <Flagga className="h-3.5 w-3.5" />,
              på: utanAnsvarig,
              växla: () => setUtanAnsvarig((v) => !v),
            }}
          />
        )}
      </header>

      <main className="flex-1 px-4 pb-[calc(env(safe-area-inset-bottom)+5.5rem)] pt-3 lg:px-6 lg:pb-10">
        {startFel && <Fel text={startFel} />}
        {innehåll}
      </main>

      <nav
        className="fixed inset-x-0 bottom-0 z-20 mx-auto flex max-w-2xl border-t border-kant bg-bakgrund/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
        aria-label="Huvudmeny"
      >
        {flik("/vecka", "Vecka", sektion === "vecka" || sektion === "pass")}
        {flik("/manad", "Månad", sektion === "manad")}
        {flik("/installningar", "Mer", sektion === "installningar" || sektion === "dolda")}
      </nav>

      {ark && (
        <AnsvarigArk
          h={ark}
          vuxna={vuxna}
          navigera={navigera}
          onStang={() => setArk(null)}
          onSparad={() => setVersion((v) => v + 1)}
        />
      )}
    </div>
  );
}
