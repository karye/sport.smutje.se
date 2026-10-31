import { useCallback, useEffect, useState } from "react";
import type { VyProps } from "../App";
import {
  apiFelText,
  hämtaBarn,
  hämtaFloden,
  hämtaLag,
  hämtaPlatser,
  hämtaSporter,
  hämtaVuxna,
  skapaFlode,
  sparaBarn,
  sparaFlode,
  sparaLag,
  sparaPlats,
  sparaSport,
  taBortBarn,
  taBortLag,
  testaFlode,
  ändraPlats,
  type Barn,
  type Flode,
  type Lag,
  type OkandPlats,
  type Plats,
  type Sport,
  type Vuxen,
} from "../api";
import { Fel, Fält, Laddar, Tomt, Väljare } from "../komponenter";
import { Hoger } from "../ikoner";
import { datum } from "../tid";

type Flik = "floden" | "lag" | "familj" | "sporter" | "platser";

const FLIKAR: { id: Flik; text: string }[] = [
  { id: "floden", text: "Flöden" },
  { id: "lag", text: "Lag" },
  { id: "familj", text: "Barn & familj" },
  { id: "sporter", text: "Sporter" },
  { id: "platser", text: "Platser" },
];

const SPORTER = ["bandy", "innebandy", "fotboll", "scout", "handboll", "basket"];

export function Installningar({ version: _version, onÖppnaDolda }: VyProps & { onÖppnaDolda: () => void }) {
  const [flik, setFlik] = useState<Flik>("floden");
  const [fel, setFel] = useState<string | null>(null);

  return (
    <section className="pb-4">
      <p className="mb-3 text-meta text-dampad">
        Allt här sparas i databasen på servern, gemensamt för alla konton. Inget ligger i webbläsaren.
      </p>

      <button
        type="button"
        onClick={onÖppnaDolda}
        className="mb-4 flex w-full items-center justify-between gap-2 rounded-xl border border-kant bg-bakgrund px-3 py-2.5 text-left"
      >
        <span>
          <span className="block text-brod font-semibold">Dolda pass</span>
          <span className="block text-meta text-dampad">Pass ni markerat ”Deltar ej” — ångra här</span>
        </span>
        <span aria-hidden className="text-dampad">
          <Hoger className="h-4 w-4" />
        </span>
      </button>

      <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl border border-kant bg-bakgrund p-1">
        {FLIKAR.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFlik(f.id)}
            className={`shrink-0 rounded-lg px-3 py-2 text-meta font-semibold ${
              flik === f.id ? "bg-text text-bakgrund" : "text-dampad"
            }`}
          >
            {f.text}
          </button>
        ))}
      </div>

      {fel && <Fel text={fel} />}

      {flik === "floden" && <Floden onFel={setFel} />}
      {flik === "lag" && <Lagmappning onFel={setFel} />}
      {flik === "familj" && <Familj onFel={setFel} />}
      {flik === "sporter" && <Sporter onFel={setFel} />}
      {flik === "platser" && <Platser onFel={setFel} />}

      <form method="post" action="/auth/logout" className="mt-6">
        <button type="submit" className="knapp w-full">
          Logga ut
        </button>
      </form>
    </section>
  );
}

/* ------------------------------------------------------------------ flöden */

function Floden({ onFel }: { onFel: (text: string | null) => void }) {
  const [floden, setFloden] = useState<Flode[] | null>(null);
  const [barn, setBarn] = useState<Barn[]>([]);

  const ladda = useCallback(async () => {
    try {
      const [f, b] = await Promise.all([hämtaFloden(), hämtaBarn()]);
      setFloden(f);
      setBarn(b.barn);
      onFel(null);
    } catch (e) {
      onFel(apiFelText(e));
    }
  }, [onFel]);

  useEffect(() => {
    void ladda();
  }, [ladda]);

  if (!floden) return <Laddar />;
  if (floden.length === 0) return <Tomt text="Inga flöden ännu." />;

  return (
    <div className="grid gap-3">
      <div className="grid gap-3 lg:grid-cols-2 lg:items-start">
        {floden.map((f) => (
          <Flodeskort key={f.id} flode={f} barn={barn} onSparad={ladda} onFel={onFel} />
        ))}
      </div>
      <NyttFlode barn={barn} onSparad={ladda} onFel={onFel} />
    </div>
  );
}

function Flodeskort({
  flode,
  barn,
  onSparad,
  onFel,
}: {
  flode: Flode;
  barn: Barn[];
  onSparad: () => Promise<void>;
  onFel: (text: string | null) => void;
}) {
  const [barnVal, setBarnVal] = useState<string[]>(flode.barnLista);
  const [sport, setSport] = useState(flode.sport);

  const [etikett, setEtikett] = useState(flode.etikett);
  const [aktiv, setAktiv] = useState(flode.aktiv);
  const [nyUrl, setNyUrl] = useState("");
  const [filter, setFilter] = useState(flode.filterMonster ?? "");
  const [prov, setProv] = useState<string | null>(null);
  const [sparar, setSparar] = useState(false);

  const spara = async () => {
    setSparar(true);
    try {
      await sparaFlode(flode.id, {
        ...(barnVal.join(",") !== flode.barnLista.join(",") ? { barnLista: barnVal } : {}),
        ...(sport !== flode.sport ? { sport } : {}),
        ...(etikett !== flode.etikett ? { etikett } : {}),
        ...(aktiv !== flode.aktiv ? { aktiv } : {}),
        ...(filter.trim() !== (flode.filterMonster ?? "") ? { filterMonster: filter.trim() || null } : {}),
        ...(nyUrl.trim() ? { url: nyUrl.trim() } : {}),
      });
      setNyUrl("");
      setProv(null);
      onFel(null);
      await onSparad();
    } catch (e) {
      onFel(apiFelText(e));
    } finally {
      setSparar(false);
    }
  };

  const testa = async (url: string) => {
    setProv("Testar…");
    try {
      const svar = await testaFlode(url, filter.trim() || null);
      setProv(
        `${svar.antal} händelser${svar.filtrerade ? ` (${svar.filtrerade} sållade av filtret)` : ""}${
          svar.första ? `, första ${datum(svar.första)}` : ""
        }${svar.namn ? ` · ${svar.namn}` : ""}`
      );
      onFel(null);
    } catch (e) {
      setProv(null);
      onFel(apiFelText(e));
    }
  };

  const hälsa = (() => {
    if (flode.status === "fel") return { text: `Fel: ${flode.fel ?? "okänt"}`, klass: "text-fel" };
    if (!flode.senastHamtad) return { text: "Aldrig hämtad", klass: "text-dampad" };
    const minuter = Math.round((Date.now() - flode.senastHamtad) / 60_000);
    const sen = minuter > 24 * 60;
    return {
      text: sen
        ? `Senast hämtad för ${Math.round(minuter / 60)} timmar sedan`
        : `Hämtad för ${minuter < 1 ? "en stund" : `${minuter} min`} sedan`,
      klass: sen ? "text-varning" : "text-dampad",
    };
  })();

  return (
    <div className="rounded-2xl border border-kant bg-bakgrund p-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <p className="text-titel font-bold">{flode.etikett}</p>
          <p className="text-meta text-dampad">
            Källa: {flode.vard} · {flode.antal} händelser
          </p>
          <p className={`text-meta ${hälsa.klass}`}>{hälsa.text}</p>
        </div>
        <label className="flex shrink-0 items-center gap-1.5 text-meta font-semibold">
          <input type="checkbox" checked={aktiv} onChange={(e) => setAktiv(e.target.checked)} className="h-5 w-5" />
          Aktiv
        </label>
      </div>

      <div className="grid gap-2">
        <div>
          <span className="mb-1 block text-meta font-semibold text-dampad">Gäller barnen</span>
          <div className="flex flex-wrap gap-2">
            {[...barn.map((b) => b.namn), ...barnVal.filter((n) => !barn.some((b) => b.namn === n))].map((namn) => {
              const på = barnVal.includes(namn);
              return (
                <label
                  key={namn}
                  className={`flex min-h-[40px] items-center gap-2 rounded-xl border px-3 text-meta font-semibold ${
                    på ? "border-text bg-text text-bakgrund" : "border-kant bg-bakgrund"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={på}
                    onChange={(e) =>
                      setBarnVal((nu) => (e.target.checked ? [...nu, namn] : nu.filter((n) => n !== namn)))
                    }
                  />
                  {namn}
                </label>
              );
            })}
          </div>
        </div>
        <Väljare
          etikett="Sport"
          värde={sport}
          alternativ={[
            ...SPORTER.map((s) => ({ värde: s, text: s })),
            ...(SPORTER.includes(sport)
              ? []
              : [{ värde: sport, text: sport === "okänd" ? "okänd (sätts per lag)" : `${sport} (egen)` }]),
          ]}
          onChange={setSport}
        />
        <Fält etikett="Etikett" value={etikett} onChange={(e) => setEtikett(e.target.value)} />
        <Fält
          etikett="Filter (titel, beskrivning eller kategori — tomt = allt)"
          placeholder="till exempel Skutorna"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <Fält
          etikett={`Ny adress (nu: ${flode.vard})`}
          placeholder="https:// eller webcal://"
          value={nyUrl}
          onChange={(e) => setNyUrl(e.target.value)}
        />
        <div className="flex gap-2">
          <button
            type="button"
            className="knapp flex-1"
            disabled={!nyUrl.trim()}
            onClick={() => void testa(nyUrl.trim())}
          >
            Testa adressen
          </button>
          <button type="button" className="knapp primar flex-1" disabled={sparar} onClick={() => void spara()}>
            Spara
          </button>
        </div>
        {prov && <p className="text-meta text-dampad">{prov}</p>}
        {!nyUrl && (
          <button
            type="button"
            className="text-left text-meta font-semibold text-dampad underline"
            onClick={() => void testa("")}
            hidden
          >
            testa nuvarande
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Lägger till en kalenderprenumeration. Adressen provas först, så att en felstavad adress eller
 * ett filter som inte matchar något aldrig sparas som ett tomt flöde.
 */
function NyttFlode({
  barn,
  onSparad,
  onFel,
}: {
  barn: Barn[];
  onSparad: () => Promise<void>;
  onFel: (text: string | null) => void;
}) {
  const [öppen, setÖppen] = useState(false);
  const [url, setUrl] = useState("");
  const [etikett, setEtikett] = useState("");
  const [klubb, setKlubb] = useState("");
  const [sport, setSport] = useState("bandy");
  const [filter, setFilter] = useState("");
  const [valda, setValda] = useState<string[]>([]);
  const [prov, setProv] = useState<string | null>(null);
  const [sparar, setSparar] = useState(false);

  if (!öppen) {
    return (
      <button type="button" className="knapp" onClick={() => setÖppen(true)}>
        + Lägg till kalenderprenumeration
      </button>
    );
  }

  const barnVal = valda.length > 0 ? valda : barn.slice(0, 1).map((b) => b.namn);

  return (
    <div className="grid gap-2 rounded-2xl border border-kant bg-bakgrund p-3">
      <p className="text-meta text-dampad">
        Klistra in adressen som föreningen skickade, med <code>webcal://</code> eller{" "}
        <code>https://</code>. Gäller kalendern hela föreningen kan du fylla i ett filter.
      </p>

      <Fält etikett="Adress" placeholder="webcal://…" value={url} onChange={(e) => setUrl(e.target.value)} />
      <Fält etikett="Etikett" placeholder="Blackebergs scoutkår" value={etikett} onChange={(e) => setEtikett(e.target.value)} />
      <Fält etikett="Klubb" placeholder="Föreningens namn" value={klubb} onChange={(e) => setKlubb(e.target.value)} />
      <Väljare
        etikett="Sport"
        värde={sport}
        alternativ={SPORTER.map((s) => ({ värde: s, text: s }))}
        onChange={setSport}
      />
      <div>
        <span className="mb-1 block text-meta font-semibold text-dampad">Gäller barnen</span>
        <div className="flex flex-wrap gap-2">
          {barn.map((b) => {
            const på = barnVal.includes(b.namn);
            return (
              <label
                key={b.namn}
                className={`flex min-h-[40px] items-center gap-2 rounded-xl border px-3 text-meta font-semibold ${
                  på ? "border-text bg-text text-bakgrund" : "border-kant bg-bakgrund"
                }`}
              >
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={på}
                  onChange={(e) =>
                    setValda((nu) => (e.target.checked ? [...nu, b.namn] : nu.filter((n) => n !== b.namn)))
                  }
                />
                {b.namn}
              </label>
            );
          })}
        </div>
      </div>
      <Fält
        etikett="Filter (titel, beskrivning eller kategori — tomt = allt)"
        placeholder="till exempel Skutorna"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />

      {prov && <p className="text-meta text-dampad">{prov}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          className="knapp flex-1"
          disabled={!url.trim()}
          onClick={async () => {
            setProv("Testar…");
            try {
              const svar = await testaFlode(url.trim(), filter.trim() || null);
              setProv(
                `${svar.antal} händelser${svar.filtrerade ? ` (${svar.filtrerade} sållade av filtret)` : ""}${
                  svar.första ? `, första ${datum(svar.första)}` : ""
                }`
              );
              onFel(null);
            } catch (e) {
              setProv(null);
              onFel(apiFelText(e));
            }
          }}
        >
          Testa
        </button>
        <button
          type="button"
          className="knapp primar flex-1"
          disabled={sparar || !url.trim() || !etikett.trim()}
          onClick={async () => {
            setSparar(true);
            try {
              await skapaFlode({
                url: url.trim(),
                etikett: etikett.trim(),
                klubb: klubb.trim() || "okänd",
                sport,
                barnLista: barnVal,
                filterMonster: filter.trim() || null,
              });
              setUrl("");
              setEtikett("");
              setKlubb("");
              setFilter("");
              setProv(null);
              setÖppen(false);
              onFel(null);
              await onSparad();
            } catch (e) {
              onFel(apiFelText(e));
            } finally {
              setSparar(false);
            }
          }}
        >
          Spara flöde
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ lag */

function Lagmappning({ onFel }: { onFel: (text: string | null) => void }) {
  const [lag, setLag] = useState<Lag[] | null>(null);
  const [utanLag, setUtanLag] = useState(0);
  const [barn, setBarn] = useState<Barn[]>([]);
  const [kode, setKode] = useState("");
  const [barnVal, setBarnVal] = useState("");
  const [sport, setSport] = useState("bandy");
  const [klubb, setKlubb] = useState("");
  const [monster, setMonster] = useState("");

  const ladda = useCallback(async () => {
    try {
      const [l, b] = await Promise.all([hämtaLag(), hämtaBarn()]);
      setLag(l.lag);
      setUtanLag(l.utanLag);
      setBarn(b.barn);
      setBarnVal((nu) => nu || (b.barn[0]?.namn ?? ""));
      onFel(null);
    } catch (e) {
      onFel(apiFelText(e));
    }
  }, [onFel]);

  useEffect(() => {
    void ladda();
  }, [ladda]);

  const läggTill = async () => {
    if (!kode.trim()) return;
    if (!klubb.trim()) {
      onFel("Klubben krävs: utan den kan passet inte visa någon förening.");
      return;
    }
    try {
      await sparaLag(
        kode.trim().toUpperCase(),
        barnVal,
        sport,
        barn.find((b) => b.namn === barnVal)?.farg ?? null,
        klubb.trim() || null,
        monster.trim() || null
      );
      setKode("");
      setKlubb("");
      setMonster("");
      await ladda();
    } catch (e) {
      onFel(apiFelText(e));
    }
  };

  if (!lag) return <Laddar />;

  return (
    <div>
      <p className="mb-3 text-meta text-dampad">
        Lagkoden står i titeln, till exempel <code>F2013</code>. Saknar passet kod räcker en{" "}
        <strong>titelregel</strong> — texten i rutan matchas mot titeln. Pass utan kod och utan regel
        räknas inte som krockar, eftersom vi inte vet vems de är.
      </p>

      <div className="mb-3 grid gap-2 rounded-2xl border border-kant bg-bakgrund p-3">
        <Fält etikett="Lagkod" placeholder="U2015" value={kode} onChange={(e) => setKode(e.target.value)} />
        <Väljare
          etikett="Barn"
          värde={barnVal}
          alternativ={[
            { värde: "", text: "ärv källans barn" },
            ...barn.map((b) => ({ värde: b.namn, text: b.namn })),
          ]}
          onChange={setBarnVal}
        />
        <Väljare
          etikett="Sport"
          värde={sport}
          alternativ={SPORTER.map((s) => ({ värde: s, text: s }))}
          onChange={setSport}
        />
        <Fält
          etikett="Klubb (krävs — annars visas ingen förening)"
          placeholder="Södra Ängby IF"
          value={klubb}
          onChange={(e) => setKlubb(e.target.value)}
        />
        <Fält
          etikett="Titelregel, om passet saknar lagkod"
          placeholder="SBBK Flickor"
          value={monster}
          onChange={(e) => setMonster(e.target.value)}
        />
        <button type="button" className="knapp primar" onClick={() => void läggTill()}>
          Lägg till eller ändra
        </button>
      </div>

      {lag.some((l) => !l.klubb) && (
        <p className="mb-3 rounded-xl bg-varning/10 px-3 py-2 text-meta text-varning">
          {lag.filter((l) => !l.klubb).length} lag saknar klubb. Deras pass visas utan förening —
          fyll i klubb för att rätta det.
        </p>
      )}

      {/* Grupperat per förening: det är klubben som skiljer lagen åt i samma källa. */}
      {[...new Set(lag.map((l) => l.klubb ?? "Klubb saknas"))].map((klubb) => (
        <div key={klubb} className="mb-3">
          <h3 className="mb-1.5 px-1 text-meta font-bold uppercase tracking-wide text-dampad">
            {klubb}
          </h3>
          <div className="overflow-hidden rounded-2xl border border-kant bg-bakgrund">
            {lag
              .filter((l) => (l.klubb ?? "Klubb saknas") === klubb)
              .map((l) => (
                <div key={l.kode} className="flex items-center gap-2 border-b border-kant/60 px-3 py-2 last:border-0">
                  <span className="w-28 shrink-0 text-titel font-bold">{l.kode}</span>
                  <span className="flex-1 text-brod">
                    {l.barn ?? "ärver källans barn"} · {l.sport}
                    {l.monster && (
                      <span className="block text-meta text-dampad">regel: ”{l.monster}”</span>
                    )}
                  </span>
                  <span className={`text-meta ${l.antal === 0 ? "font-bold text-varning" : "text-dampad"}`}>
                    {l.antal === 0 ? "0 pass — matchar inget" : `${l.antal} pass`}
                  </span>
                  <button
                    type="button"
                    className="knapp !min-h-[36px] !px-2 !text-meta"
                    onClick={async () => {
                      try {
                        await taBortLag(l.kode);
                        await ladda();
                      } catch (e) {
                        onFel(apiFelText(e));
                      }
                    }}
                  >
                    Ta bort
                  </button>
                </div>
              ))}
          </div>
        </div>
      ))}
      {lag.length === 0 && (
        <p className="rounded-2xl border border-dashed border-kant px-3 py-4 text-meta text-dampad">
          Ingen mappning ännu.
        </p>
      )}

      <p className="mt-2 text-meta text-dampad">
        {utanLag} händelser saknar lagkod och visas med flödets barn och sport.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ familj */

function Familj({ onFel }: { onFel: (text: string | null) => void }) {
  const [barn, setBarn] = useState<Barn[] | null>(null);
  const [okanda, setOkanda] = useState<string[]>([]);
  const [vuxna, setVuxna] = useState<Vuxen[]>([]);
  const [namn, setNamn] = useState("");
  const [farg, setFarg] = useState("#1d4ed8");

  const ladda = useCallback(async () => {
    try {
      const [b, v] = await Promise.all([hämtaBarn(), hämtaVuxna()]);
      setBarn(b.barn);
      setOkanda(b.okanda);
      setVuxna(v);
      onFel(null);
    } catch (e) {
      onFel(apiFelText(e));
    }
  }, [onFel]);

  useEffect(() => {
    void ladda();
  }, [ladda]);

  if (!barn) return <Laddar />;

  return (
    <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
      <div>
        <h2 className="mb-2 text-meta font-bold uppercase tracking-wide text-dampad">Barn</h2>
        <div className="overflow-hidden rounded-2xl border border-kant bg-bakgrund">
          {barn.map((b) => (
            <div key={b.namn} className="flex items-center gap-2 border-b border-kant/60 px-3 py-2 last:border-0">
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: b.farg }} />
              <span className="flex-1 text-brod font-semibold">{b.namn}</span>
              <span className="text-meta text-dampad">{b.antal} pass</span>
              <button
                type="button"
                className="knapp !min-h-[36px] !px-2 !text-meta"
                onClick={async () => {
                  try {
                    await taBortBarn(b.namn);
                    await ladda();
                  } catch (e) {
                    onFel(apiFelText(e));
                  }
                }}
              >
                Ta bort
              </button>
            </div>
          ))}
          {barn.length === 0 && <p className="px-3 py-4 text-meta text-dampad">Inga barn ännu.</p>}
        </div>

        {okanda.length > 0 && (
          <p className="mt-2 rounded-xl bg-varning/10 px-3 py-2 text-meta text-varning">
            Namn som används men saknas här: {okanda.join(", ")}. Det blir ett eget barn i filtret —
            lägg till eller rätta stavningen.
          </p>
        )}

        <div className="mt-2 grid gap-2 rounded-2xl border border-kant bg-bakgrund p-3">
          <Fält etikett="Namn" placeholder="Barn 1" value={namn} onChange={(e) => setNamn(e.target.value)} />
          <label className="block">
            <span className="mb-1 block text-meta font-semibold text-dampad">Färg</span>
            <input
              type="color"
              className="h-11 w-full rounded-xl border border-kant bg-bakgrund"
              value={farg}
              onChange={(e) => setFarg(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="knapp primar"
            onClick={async () => {
              if (!namn.trim()) return;
              try {
                await sparaBarn(namn.trim(), farg);
                setNamn("");
                await ladda();
              } catch (e) {
                onFel(apiFelText(e));
              }
            }}
          >
            Lägg till barn
          </button>
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-meta font-bold uppercase tracking-wide text-dampad">Vuxna</h2>
        <div className="overflow-hidden rounded-2xl border border-kant bg-bakgrund">
          {vuxna.map((v) => (
            <div key={v.id} className="border-b border-kant/60 px-3 py-2 last:border-0">
              <p className="text-brod font-semibold">{v.namn}</p>
              <p className="text-meta text-dampad">{v.epost}</p>
            </div>
          ))}
          {vuxna.length === 0 && <p className="px-3 py-4 text-meta text-dampad">Ingen har loggat in ännu.</p>}
        </div>
        <p className="mt-2 text-meta text-dampad">
          Namnen kommer från Google-kontot vid inloggning. Vem som släpps in bestäms av
          <code> ALLOWED_EMAILS </code>i serverns <code>.env</code>, inte här.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ sporter */

function Sporter({ onFel }: { onFel: (text: string | null) => void }) {
  const [sporter, setSporter] = useState<Sport[] | null>(null);
  const [nytt, setNytt] = useState("");
  const [nyFarg, setNyFarg] = useState("#0e7490");

  const ladda = useCallback(async () => {
    try {
      setSporter(await hämtaSporter());
      onFel(null);
    } catch (e) {
      onFel(apiFelText(e));
    }
  }, [onFel]);

  useEffect(() => {
    void ladda();
  }, [ladda]);

  if (!sporter) return <Laddar />;

  return (
    <div>
      <p className="mb-3 text-meta text-dampad">
        Sportens färg syns som en prick på korten och i chipsen. Kortets vänsterkant behåller
        barnets färg — två skalor, två betydelser.
      </p>

      <div className="overflow-hidden rounded-2xl border border-kant bg-bakgrund">
        {sporter.map((s) => (
          <div key={s.namn} className="flex items-center gap-2 border-b border-kant/60 px-3 py-2 last:border-0">
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: s.farg }} />
            <span className="flex-1 text-brod font-semibold capitalize">{s.namn}</span>
            <span className="text-meta text-dampad">{s.antal} pass</span>
            <input
              type="color"
              aria-label={`Färg för ${s.namn}`}
              className="h-9 w-12 rounded-lg border border-kant bg-bakgrund"
              value={s.farg}
              onChange={async (e) => {
                const farg = e.target.value;
                setSporter((nu) => nu?.map((x) => (x.namn === s.namn ? { ...x, farg } : x)) ?? nu);
                try {
                  await sparaSport(s.namn, farg);
                  await ladda();
                } catch (fel) {
                  onFel(apiFelText(fel));
                }
              }}
            />
          </div>
        ))}
      </div>

      <div className="mt-3 grid gap-2 rounded-2xl border border-kant bg-bakgrund p-3">
        <Fält etikett="Ny sport" placeholder="till exempel handboll" value={nytt} onChange={(e) => setNytt(e.target.value)} />
        <label className="block">
          <span className="mb-1 block text-meta font-semibold text-dampad">Färg</span>
          <input
            type="color"
            className="h-11 w-full rounded-xl border border-kant bg-bakgrund"
            value={nyFarg}
            onChange={(e) => setNyFarg(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="knapp primar"
          onClick={async () => {
            if (!nytt.trim()) return;
            try {
              await sparaSport(nytt.trim(), nyFarg);
              setNytt("");
              await ladda();
            } catch (e) {
              onFel(apiFelText(e));
            }
          }}
        >
          Lägg till sport
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ platser */

function Platser({ onFel }: { onFel: (text: string | null) => void }) {
  const [platser, setPlatser] = useState<Plats[] | null>(null);
  const [okanda, setOkanda] = useState<OkandPlats[]>([]);
  const [koordinat, setKoordinat] = useState<Record<string, string>>({});

  const ladda = useCallback(async () => {
    try {
      const svar = await hämtaPlatser();
      setPlatser(svar.platser);
      setOkanda(svar.okanda);
      onFel(null);
    } catch (e) {
      onFel(apiFelText(e));
    }
  }, [onFel]);

  useEffect(() => {
    void ladda();
  }, [ladda]);

  if (!platser) return <Laddar />;

  return (
    <div className="grid gap-4">
      <div>
        <h2 className="mb-1 text-meta font-bold uppercase tracking-wide text-dampad">
          Saknar position ({okanda.length})
        </h2>
        <p className="mb-2 text-meta text-dampad">
          Utan koordinater blir det ingen restid, och då ingen varning om att två pass ligger för nära
          varandra i tid.
        </p>

        {okanda.length === 0 ? (
          <p className="rounded-xl border border-dashed border-kant px-3 py-3 text-meta text-dampad">
            Alla platser i flödena är kända.
          </p>
        ) : (
          <div className="grid gap-2">
            {okanda.map((o) => (
              <div key={o.plats_text} className="rounded-2xl border border-kant bg-bakgrund p-3">
                <p className="text-brod font-semibold">
                  {o.plats_text} <span className="text-meta font-normal text-dampad">({o.antal} pass)</span>
                </p>
                <div className="mt-2 flex gap-2">
                  <input
                    className="falt"
                    placeholder="59.3519, 17.9122"
                    value={koordinat[o.plats_text] ?? ""}
                    onChange={(e) => setKoordinat({ ...koordinat, [o.plats_text]: e.target.value })}
                  />
                  <button
                    type="button"
                    className="knapp primar"
                    onClick={async () => {
                      const [lat, lon] = (koordinat[o.plats_text] ?? "").split(",").map((s) => Number(s.trim()));
                      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
                        onFel("Skriv koordinater som 59.3519, 17.9122");
                        return;
                      }
                      try {
                        await sparaPlats(o.plats_text, lat as number, lon as number);
                        await ladda();
                      } catch (e) {
                        onFel(apiFelText(e));
                      }
                    }}
                  >
                    Spara
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-2 text-meta font-bold uppercase tracking-wide text-dampad">Kända ({platser.length})</h2>
        <div className="overflow-hidden rounded-2xl border border-kant bg-bakgrund">
          {platser.map((p) => (
            <div key={p.id} className="border-b border-kant/60 px-3 py-2 last:border-0">
              <div className="flex items-center gap-2">
                <span className="flex-1 text-brod font-semibold">{p.namn}</span>
                <span className="text-meta text-dampad">{p.antal} pass</span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <input
                  className="falt !min-h-[36px] !text-meta"
                  defaultValue={p.lat != null && p.lon != null ? `${p.lat}, ${p.lon}` : ""}
                  placeholder="59.3519, 17.9122"
                  onBlur={async (e) => {
                    const [lat, lon] = e.target.value.split(",").map((s) => Number(s.trim()));
                    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
                    try {
                      await ändraPlats(p.id, { lat, lon });
                      await ladda();
                    } catch (fel) {
                      onFel(apiFelText(fel));
                    }
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
