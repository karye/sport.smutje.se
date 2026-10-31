import { describe, expect, test } from "bun:test";
import { tolkaSamling } from "../src/samling.ts";
import { tillUtc } from "../src/tid.ts";

const start = tillUtc(2026, 11, 3, 18, 0);

describe("samlingstid", () => {
  // Verkligt format från Sportadmins flöde: 75 av 86 händelser ser ut så här.
  test("Samling: 18:00", () => {
    expect(tolkaSamling("Samling: 17:45", start)).toEqual({
      ms: tillUtc(2026, 11, 3, 17, 45),
      kalla: "regex",
      likaStart: false,
    });
  });

  // Sportadmin fyller i samma tid som starten när ledaren inte angett någon samling.
  test("samling lika med starttiden rapporteras som likaStart", () => {
    const s = tolkaSamling("Samling: 18:00", start);
    expect(s?.likaStart).toBe(true);
    expect(s?.ms).toBe(start);
  });

  test("punkt som avskiljare", () => {
    expect(tolkaSamling("Samling 17.45", start)?.ms).toBe(tillUtc(2026, 11, 3, 17, 45));
  });

  test("samlingen följd av mer text", () => {
    const text = "Samling: 17:45\nTa med vattenflaska och röd tröja.";
    expect(tolkaSamling(text, start)?.ms).toBe(tillUtc(2026, 11, 3, 17, 45));
  });

  // Verkligt format från SvenskaLag: platsen står mellan ordet och tiden.
  test("plats före tiden", () => {
    expect(tolkaSamling("Samling: Kärrtorps IP, kl 16:00\nVi ses!", start)?.ms).toBe(
      tillUtc(2026, 11, 3, 16, 0)
    );
    expect(tolkaSamling("Samling: I omklädningsrummet, kl 17:30", start)?.ms).toBe(
      tillUtc(2026, 11, 3, 17, 30)
    );
  });

  test("datum i texten blir inte ett klockslag", () => {
    expect(tolkaSamling("Samling 14/11 kl 16:00", start)?.ms).toBe(tillUtc(2026, 11, 3, 16, 0));
  });

  test("minuter innan", () => {
    const s = tolkaSamling("Samling 45 min innan", start);
    expect(s?.kalla).toBe("minuter");
    expect(s?.ms).toBe(start - 45 * 60000);
  });

  test("egen mall per flöde", () => {
    const s = tolkaSamling("Uppvärmning 10:30", tillUtc(2026, 11, 7, 11, 0), "uppvärmning\\D{0,4}(\\d{1,2})[:.](\\d{2})");
    expect(s?.ms).toBe(tillUtc(2026, 11, 7, 10, 30));
  });

  test("ogiltig egen mall faller tillbaka på standardmönstret", () => {
    expect(tolkaSamling("Samling: 17:45", start, "(((")?.ms).toBe(tillUtc(2026, 11, 3, 17, 45));
  });

  test("ingen samling i texten ger null, aldrig en gissning", () => {
    expect(tolkaSamling("", start)).toBeNull();
    expect(tolkaSamling(null, start)).toBeNull();
    expect(tolkaSamling("Ta med shorts", start)).toBeNull();
  });

  test("en orimligt tidig tid är inte en samling", () => {
    // Skarpt fall: samling 13:30 för ett pass som börjar 17:30.
    const sent = tillUtc(2026, 11, 3, 17, 30);
    expect(tolkaSamling("Samling: 13:30", sent)).toBeNull();
    // Tre timmar innan är fortfarande rimligt (läger, bortamatch).
    expect(tolkaSamling("Samling: 14:30", sent)?.ms).toBe(tillUtc(2026, 11, 3, 14, 30));
  });

  test("en tid efter passet är inte en samling", () => {
    expect(tolkaSamling("Samling: 19:00", start)).toBeNull();
  });

  test("samling strax före midnatt hör till föregående dag", () => {
    const midnatt = tillUtc(2026, 11, 3, 0, 30);
    expect(tolkaSamling("Samling: 23:00", midnatt)?.ms).toBe(tillUtc(2026, 11, 2, 23, 0));
  });
});
