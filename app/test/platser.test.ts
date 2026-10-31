import { describe, expect, test } from "bun:test";
import { avstandKm, hittaPlats, medelfartKmh, normaliseraPlats, restidMinuter } from "../src/platser.ts";
import type { Plats } from "../src/typer.ts";

const platser: Plats[] = [
  { id: 1, namn: "Kärrtorps IP", normaliserat: "karrtorps", lat: 59.2833, lon: 18.1167 },
  { id: 2, namn: "Äppelviksskolan", normaliserat: "appelviksskolan", lat: 59.3333, lon: 17.9667 },
  { id: 3, namn: "Vällingbyhallen", normaliserat: "vallingbyhallen", lat: 59.3622, lon: 17.8719 },
  { id: 4, namn: "Brommahallen", normaliserat: "brommahallen", lat: null, lon: null },
];

describe("platsnormalisering", () => {
  test("del av anläggning skalas bort", () => {
    expect(normaliseraPlats("Brommahallen plan 2")).toBe("brommahallen");
    expect(normaliseraPlats("Kärrtorps IP")).toBe("karrtorps");
    expect(normaliseraPlats("Äppelviksskolan idrottshall")).toBe("appelviksskolan");
  });

  test("diakriter och skiljetecken spelar ingen roll", () => {
    expect(normaliseraPlats("Vällingbyhallen, plan 1")).toBe("vallingbyhallen");
  });

  test("exakt träff vinner", () => {
    expect(hittaPlats("Kärrtorps IP", platser)?.id).toBe(1);
  });

  test("delsträng räcker", () => {
    expect(hittaPlats("Äppelviksskolan idrottshall", platser)?.id).toBe(2);
  });

  test("okänd plats ger null", () => {
    expect(hittaPlats("Zinkensdamms IP", platser)).toBeNull();
    expect(hittaPlats(null, platser)).toBeNull();
  });
});

const [karrtorp, appelviken, , bromma] = platser as [Plats, Plats, Plats, Plats];

describe("restid", () => {
  test("Kärrtorp till Äppelviken tar 30 minuter i modellen", () => {
    expect(restidMinuter(karrtorp, appelviken)).toBe(30);
  });

  test("samma plats kostar ingen restid", () => {
    expect(restidMinuter(karrtorp, karrtorp)).toBe(0);
  });

  test("saknade koordinater ger null, inte en gissning", () => {
    expect(restidMinuter(bromma, appelviken)).toBeNull();
    expect(restidMinuter(null, appelviken)).toBeNull();
    expect(avstandKm(bromma, appelviken)).toBeNull();
  });

  test("farten trappas upp med avståndet", () => {
    expect(medelfartKmh(5)).toBe(30);
    expect(medelfartKmh(15)).toBe(30);
    expect(medelfartKmh(30)).toBe(50);
    expect(medelfartKmh(120)).toBe(75);
  });

  test("en resa till Karlstad tar timmar, inte ett dygn", () => {
    const karlstad: Plats = { id: 9, namn: "Karlstad", normaliserat: "karlstad", lat: 59.38091, lon: 13.50276 };
    const minuter = restidMinuter(karrtorp, karlstad);
    expect(minuter).not.toBeNull();
    expect(minuter!).toBeGreaterThan(200);
    expect(minuter!).toBeLessThan(360);
  });

  test("avrundas uppåt till fem minuter", () => {
    for (const a of platser) {
      for (const b of platser) {
        const r = restidMinuter(a, b);
        if (r != null) expect(r % 5).toBe(0);
      }
    }
  });
});
