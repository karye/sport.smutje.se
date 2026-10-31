import { describe, expect, test } from "bun:test";
import {
  datumEtikett,
  delar,
  isoVecka,
  klockslag,
  manadsIntervall,
  tillUtc,
  veckodagNamn,
  veckoIntervall,
} from "../src/tid.ts";

describe("tidszonen", () => {
  test("18:00 i Stockholm i november är 17:00 UTC", () => {
    expect(new Date(tillUtc(2026, 11, 3, 18, 0)).toISOString()).toBe("2026-11-03T17:00:00.000Z");
  });

  test("sommartid ger två timmars förskjutning", () => {
    expect(new Date(tillUtc(2026, 6, 29, 18, 0)).toISOString()).toBe("2026-06-29T16:00:00.000Z");
  });

  test("delar läser tillbaka samma klocka", () => {
    const d = delar(tillUtc(2026, 11, 3, 18, 0));
    expect([d.ar, d.manad, d.dag, d.timme, d.minut]).toEqual([2026, 11, 3, 18, 0]);
  });
});

describe("ISO-veckor", () => {
  test("1 januari 2026 är en torsdag och ligger i vecka 1", () => {
    expect(isoVecka(tillUtc(2026, 1, 1, 12, 0))).toEqual({ ar: 2026, vecka: 1 });
  });

  test("29 december 2025 hör till vecka 1 år 2026", () => {
    expect(isoVecka(tillUtc(2025, 12, 29, 12, 0))).toEqual({ ar: 2026, vecka: 1 });
  });

  test("31 december 2026 hör till vecka 53", () => {
    expect(isoVecka(tillUtc(2026, 12, 31, 12, 0))).toEqual({ ar: 2026, vecka: 53 });
  });

  test("1 januari 2027 hör fortfarande till vecka 53 år 2026", () => {
    expect(isoVecka(tillUtc(2027, 1, 1, 12, 0))).toEqual({ ar: 2026, vecka: 53 });
  });

  test("vecka 45 år 2026 börjar måndag 2 november", () => {
    const { fran } = veckoIntervall(2026, 45);
    expect(new Date(fran).toISOString()).toBe("2026-11-01T23:00:00.000Z");
    expect(veckodagNamn(fran)).toBe("måndag");
  });

  test("veckans intervall slutar söndag 23:59:59.999", () => {
    const { till } = veckoIntervall(2026, 45);
    expect(new Date(till).toISOString()).toBe("2026-11-08T22:59:59.999Z");
  });

  test("sommavecka räknas med sommartid", () => {
    const { fran } = veckoIntervall(2026, 27);
    expect(new Date(fran).toISOString()).toBe("2026-06-28T22:00:00.000Z");
  });

  test("månadens intervall täcker hela november", () => {
    const { fran, till } = manadsIntervall(2026, 11);
    expect(klockslag(fran)).toBe("00:00");
    expect(delar(till)).toMatchObject({ manad: 11, dag: 30, timme: 23, minut: 59 });
    expect(datumEtikett(fran)).toBe("1 november");
  });
});
