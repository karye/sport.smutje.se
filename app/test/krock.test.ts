import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { beraknaKrockar, harOlostKrock } from "../src/krock.ts";
import { tolkaFlode } from "../src/tolk.ts";
import { tillUtc } from "../src/tid.ts";
import type { Ansvarig, Handelse, KrockPass, Plats } from "../src/typer.ts";

const platser: Plats[] = [
  { id: 1, namn: "Kärrtorps IP", normaliserat: "karrtorps", lat: 59.2833, lon: 18.1167 },
  { id: 2, namn: "Äppelviksskolan", normaliserat: "appelviksskolan", lat: 59.3333, lon: 17.9667 },
  { id: 3, namn: "Vällingbyhallen", normaliserat: "vallingbyhallen", lat: 59.3622, lon: 17.8719 },
  { id: 4, namn: "Brommahallen", normaliserat: "brommahallen", lat: null, lon: null },
];
const platsMap = new Map(platser.map((p) => [p.id, p]));

const fönster = { fran: tillUtc(2026, 10, 1, 0, 0), till: tillUtc(2027, 1, 31, 0, 0) };
const läsexempel = async (namn: string): Promise<string> =>
  Bun.file(join(import.meta.dir, "fixtures", namn)).text();

const barn1 = tolkaFlode(
  await läsexempel("sportadmin-barn1.ics"),
  { id: "sbbk-p16", label: "SBBK P16", samling_monster: null },
  fönster,
  platser
).handelser;
const barn2 = tolkaFlode(
  await läsexempel("sportadmin-barn2.ics"),
  { id: "sbbk-f14", label: "SBBK F14", samling_monster: null },
  fönster,
  platser
).handelser;

const ingen: Ansvarig = { typ: "ingen", user_id: null };
const foralder1: Ansvarig = { typ: "person", user_id: 1 };
const foralder2: Ansvarig = { typ: "person", user_id: 2 };

const somPass = (h: Handelse, barn: string, ansvarig: Ansvarig = ingen): KrockPass => ({
  id: h.uid,
  barn: [barn],
  plats_id: h.plats_id,
  samling_ms: h.samling_ms,
  start_ms: h.start_ms,
  slut_ms: h.slut_ms,
  dold: false,
  installt: h.ics_status === "CANCELLED",
  ansvarig,
});

const vid = (lista: Handelse[], start: number): Handelse => {
  const h = lista.find((x) => x.start_ms === start);
  if (!h) throw new Error(`Ingen händelse vid ${new Date(start).toISOString()}`);
  return h;
};

const barn1sMatch = vid(barn1, tillUtc(2026, 11, 14, 10, 0));
const barn2sSammandrag = vid(barn2, tillUtc(2026, 11, 14, 10, 15));
const barn2sMatch = vid(barn2, tillUtc(2026, 11, 14, 11, 0));

describe("lördagen i november", () => {
  test("Barn 1:s match och Barn 2:s sammandrag krockar", () => {
    const krockar = beraknaKrockar(
      [...barn1.map((h) => somPass(h, "Barn 1")), ...barn2.map((h) => somPass(h, "Barn 2"))],
      platsMap
    );

    const krock = krockar.get(barn1sMatch.uid);
    expect(krock?.typ).toBe("tid");
    expect(krock?.olost).toBe(true);
    expect(krock?.mot).toContain(barn2sSammandrag.uid);
    expect(krock?.sammaBarn).toBe(false);
  });

  test("Barn 2:s två pass på samma plats krockar inte med varandra", () => {
    const krockar = beraknaKrockar(
      [...barn1.map((h) => somPass(h, "Barn 1")), ...barn2.map((h) => somPass(h, "Barn 2"))],
      platsMap
    );

    expect(krockar.get(barn2sSammandrag.uid)?.mot ?? []).not.toContain(barn2sMatch.uid);
    expect(krockar.get(barn2sMatch.uid)?.mot ?? []).not.toContain(barn2sSammandrag.uid);
  });

  test("varningstriangeln tänds när krocken är olöst", () => {
    const krockar = beraknaKrockar(
      [...barn1.map((h) => somPass(h, "Barn 1")), ...barn2.map((h) => somPass(h, "Barn 2"))],
      platsMap
    );
    expect(harOlostKrock(krockar)).toBe(true);
  });
});

describe("transportkrock", () => {
  const a = somPass(vid(barn1, tillUtc(2026, 11, 3, 18, 0)), "Barn 1");

  test("glapp kortare än restiden är en krock", () => {
    const b: KrockPass = {
      id: "konstruerad",
      barn: ["Barn 2"],
      plats_id: 2,
      samling_ms: tillUtc(2026, 11, 3, 19, 45),
      start_ms: tillUtc(2026, 11, 3, 20, 0),
      slut_ms: tillUtc(2026, 11, 3, 21, 0),
      dold: false,
      installt: false,
      ansvarig: ingen,
    };
    const krock = beraknaKrockar([a, b], platsMap).get(a.id);
    expect(krock?.typ).toBe("transport");
    expect(krock?.restidMin).toBe(30);
    expect(krock?.glappMin).toBe(15);
  });

  test("glapp längre än restiden är ingen krock", () => {
    const b: KrockPass = {
      id: "konstruerad",
      barn: ["Barn 2"],
      plats_id: 2,
      samling_ms: tillUtc(2026, 11, 3, 20, 15),
      start_ms: tillUtc(2026, 11, 3, 20, 30),
      slut_ms: tillUtc(2026, 11, 3, 21, 0),
      dold: false,
      installt: false,
      ansvarig: ingen,
    };
    expect(beraknaKrockar([a, b], platsMap).size).toBe(0);
  });

  test("okänd plats ger ingen transportkrock", () => {
    const b: KrockPass = {
      id: "utan-plats",
      barn: ["Barn 2"],
      plats_id: null,
      samling_ms: tillUtc(2026, 11, 3, 19, 45),
      start_ms: tillUtc(2026, 11, 3, 20, 0),
      slut_ms: tillUtc(2026, 11, 3, 21, 0),
      dold: false,
      installt: false,
      ansvarig: ingen,
    };
    expect(beraknaKrockar([a, b], platsMap).size).toBe(0);
  });
});

describe("logistiken löser krocken", () => {
  const pass = (a: Ansvarig, b: Ansvarig): Map<string, { olost: boolean }> =>
    beraknaKrockar(
      [
        somPass(barn1sMatch, "Barn 1", a),
        somPass(barn2sSammandrag, "Barn 2", b),
      ],
      platsMap
    );

  test("Förälder 1 och Förälder 2 löser den", () => {
    expect(pass(foralder1, foralder2).get(barn1sMatch.uid)?.olost).toBe(false);
  });

  test("samma person på båda löser den inte", () => {
    expect(pass(foralder1, foralder1).get(barn1sMatch.uid)?.olost).toBe(true);
  });

  test("samåkning löser den", () => {
    expect(pass({ typ: "samakning", user_id: null }, ingen).get(barn1sMatch.uid)?.olost).toBe(false);
  });

  test("egen transport löser den", () => {
    expect(pass(ingen, { typ: "egen", user_id: null }).get(barn1sMatch.uid)?.olost).toBe(false);
  });

  test("ingen ansvarig lämnar den olöst", () => {
    expect(pass(ingen, ingen).get(barn1sMatch.uid)?.olost).toBe(true);
  });
});

describe("det som inte krockar", () => {
  test("dolda pass deltar inte", () => {
    const a = { ...somPass(barn1sMatch, "Barn 1"), dold: true };
    const b = somPass(barn2sSammandrag, "Barn 2");
    expect(beraknaKrockar([a, b], platsMap).size).toBe(0);
  });

  test("inställda pass deltar inte", () => {
    const a = somPass(barn1sMatch, "Barn 1");
    const b = { ...somPass(barn2sSammandrag, "Barn 2"), installt: true };
    expect(beraknaKrockar([a, b], platsMap).size).toBe(0);
  });

  test("syskon i samma lag räknas båda", () => {
    const a = { ...somPass(barn1sMatch, "Barn 1"), barn: ["Barn 1", "Barn 2"] };
    const b = { ...somPass(barn2sSammandrag, "Barn 2"), barn: ["Barn 2"] };
    expect(beraknaKrockar([a, b], platsMap).get(a.id)?.sammaBarn).toBe(true);
  });

  test("olika barn på olika pass är ingen dubbelbokning", () => {
    const a = { ...somPass(barn1sMatch, "Barn 1"), barn: ["Barn 1"] };
    const b = { ...somPass(barn2sSammandrag, "Barn 2"), barn: ["Barn 2"] };
    expect(beraknaKrockar([a, b], platsMap).get(a.id)?.sammaBarn).toBe(false);
  });

  test("samma barn på två ställen markeras", () => {
    const träning = vid(barn1, tillUtc(2026, 11, 3, 18, 0));
    const extra: KrockPass = {
      id: "fotboll",
      barn: ["Barn 1"],
      plats_id: 3,
      samling_ms: null,
      start_ms: tillUtc(2026, 11, 3, 18, 30),
      slut_ms: tillUtc(2026, 11, 3, 20, 0),
      dold: false,
      installt: false,
      ansvarig: ingen,
    };
    const krock = beraknaKrockar([somPass(träning, "Barn 1"), extra], platsMap).get("fotboll");
    expect(krock?.sammaBarn).toBe(true);
    expect(krock?.typ).toBe("tid");
  });
});
