import { describe, expect, test } from "bun:test";
import {
  dagINumma,
  dagNyckel,
  isoVecka,
  klockslag,
  lokalMidnatt,
  månadsSpann,
  tillStockholmMs,
  veckansDagar,
} from "../../frontend/src/tid.ts";

/**
 * Klientens datumräkning.
 *
 * Den låg utanför testerna eftersom den bor i `frontend/`, och det kostade en bugg: månadsrutnätet
 * stegade 24 timmar i taget från lokal midnatt, vilket gav 25 timmar över övergången till
 * vintertid. Samma datum kom då två gånger och alla följande dagar hamnade i fel kolumn.
 */
describe("månadsrutnätet", () => {
  test("oktober 2026, månaden då vintertiden infaller", () => {
    const { dagar } = månadsSpann(2026, 10);
    const nycklar = dagar.map(dagNyckel);

    expect(new Set(nycklar).size).toBe(nycklar.length);
    expect(nycklar[0]).toBe("2026-09-28");
    expect(nycklar.at(-1)).toBe("2026-11-01");
    expect(nycklar).toHaveLength(35);
  });

  test("varje ruta är lokal midnatt", () => {
    for (const dag of månadsSpann(2026, 10).dagar) {
      const d = new Date(dag);
      const klocka = new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Europe/Stockholm",
        hour: "2-digit",
        minute: "2-digit",
      }).format(d);
      expect(klocka).toBe("00:00");
    }
  });

  test("mars 2027, övergången till sommartid", () => {
    const { dagar } = månadsSpann(2027, 3);
    const nycklar = dagar.map(dagNyckel);
    expect(new Set(nycklar).size).toBe(nycklar.length);
    expect(nycklar).toContain("2027-03-28");
  });

  test("veckans dagar är sju unika datum", () => {
    const dagar = veckansDagar(2026, 44).map(dagNyckel);
    expect(dagar).toHaveLength(7);
    expect(new Set(dagar).size).toBe(7);
  });

  test("en rättad samlingstid blir rätt UTC, sommar som vinter", () => {
    for (const [dag, tid] of [
      ["2026-11-14", "09:30"],
      ["2026-06-15", "09:30"],
      ["2026-10-25", "09:30"],
      ["2026-03-29", "09:30"],
    ] as const) {
      const ms = tillStockholmMs(dag, tid);
      expect(ms).not.toBeNull();
      expect(klockslag(ms as number)).toBe(tid);
    }
  });

  test("orimliga tider ger null i stället för en gissning", () => {
    expect(tillStockholmMs("2026-11-14", "25:99")).toBeNull();
    expect(tillStockholmMs("fel", "09:30")).toBeNull();
  });

  test("dagens siffra läses i Stockholm, inte i UTC", () => {
    // Lokal midnatt 1 oktober ligger på 30 september 22:00 UTC. getUTCDate() gav därför 30,
    // vilket ritade fel siffra i månadsrutnätet hela vinterhalvåret.
    const första = lokalMidnatt(2026, 10, 1);
    expect(new Date(första).getUTCDate()).toBe(30);
    expect(dagINumma(första)).toBe(1);

    for (const dag of månadsSpann(2026, 10).dagar) {
      expect(dagINumma(dag)).toBe(Number(dagNyckel(dag).slice(-2)));
    }
  });

  test("ISO-veckan vid årsskiftet", () => {
    expect(isoVecka(Date.UTC(2026, 11, 31, 12, 0))).toEqual({ år: 2026, vecka: 53 });
    expect(isoVecka(Date.UTC(2027, 0, 1, 12, 0))).toEqual({ år: 2026, vecka: 53 });
  });
});
