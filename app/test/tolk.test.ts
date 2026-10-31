import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { lagUrTitel, motstandareUrTitel, sportUrTitel, tolkaFlode } from "../src/tolk.ts";
import { tillUtc } from "../src/tid.ts";
import type { Handelse, Plats } from "../src/typer.ts";

const platser: Plats[] = [
  { id: 1, namn: "Kärrtorps IP", normaliserat: "karrtorps", lat: 59.2833, lon: 18.1167 },
  { id: 2, namn: "Äppelviksskolan", normaliserat: "appelviksskolan", lat: 59.3333, lon: 17.9667 },
  { id: 3, namn: "Vällingbyhallen", normaliserat: "vallingbyhallen", lat: 59.3622, lon: 17.8719 },
  { id: 4, namn: "Brommahallen", normaliserat: "brommahallen", lat: null, lon: null },
];

const fönster = { fran: tillUtc(2026, 10, 1, 0, 0), till: tillUtc(2027, 1, 31, 0, 0) };

const läsexempel = async (namn: string): Promise<string> =>
  Bun.file(join(import.meta.dir, "fixtures", namn)).text();

const barn1 = tolkaFlode(
  await läsexempel("sportadmin-barn1.ics"),
  { id: "sbbk-p16", label: "SBBK P16", samling_monster: null },
  fönster,
  platser
);

const barn2 = tolkaFlode(
  await läsexempel("sportadmin-barn2.ics"),
  { id: "sbbk-f14", label: "SBBK F14", samling_monster: null },
  fönster,
  platser
);

const hitta = (lista: Handelse[], start: number): Handelse => {
  const h = lista.find((x) => x.start_ms === start);
  if (!h) throw new Error(`Ingen händelse vid ${new Date(start).toISOString()}`);
  return h;
};

describe("tolken mot Sportadmin-formatet", () => {
  test("tolv händelser i Barn 1:s flöde, varav fyra ur serien", () => {
    expect(barn1.handelser.length).toBe(11);
    expect(barn1.antalAterkommande).toBe(1);
    expect(barn1.antalInstallda).toBe(1);
  });

  test("lokal tid med TZID blir rätt UTC", () => {
    const träning = hitta(barn1.handelser, tillUtc(2026, 11, 3, 18, 0));
    expect(träning.titel).toBe("Träning - P16 Bandy SBBK");
    expect(träning.slut_ms).toBe(tillUtc(2026, 11, 3, 19, 30));
  });

  test("samlingen plockas ur beskrivningen", () => {
    const träning = hitta(barn1.handelser, tillUtc(2026, 11, 3, 18, 0));
    expect(träning.samling_ms).toBe(tillUtc(2026, 11, 3, 17, 45));
    expect(träning.samling_kalla).toBe("regex");
  });

  test("samling lika med starten räknas men visas inte", () => {
    // 1 nov-serien har samling 09:45 och start 10:00, alltså en riktig samling.
    expect(hitta(barn1.handelser, tillUtc(2026, 11, 1, 10, 0)).samling_ms).toBe(tillUtc(2026, 11, 1, 9, 45));
    expect(barn1.antalSamlingLikStart).toBe(0);
  });

  test("tom beskrivning ger ingen samling", () => {
    const träning = hitta(barn1.handelser, tillUtc(2026, 11, 10, 18, 0));
    expect(träning.beskrivning).toBeNull();
    expect(träning.samling_ms).toBeNull();
  });

  test("motståndaren plockas ur matchtiteln", () => {
    const match = hitta(barn1.handelser, tillUtc(2026, 11, 14, 10, 0));
    expect(match.motstandare).toBe("Hammarby IF");
    expect(match.samling_ms).toBe(tillUtc(2026, 11, 14, 9, 15));
  });

  test("träning har ingen motståndare", () => {
    expect(hitta(barn1.handelser, tillUtc(2026, 11, 3, 18, 0)).motstandare).toBeNull();
  });

  test("inställd träning behålls med status CANCELLED", () => {
    const inställd = hitta(barn1.handelser, tillUtc(2026, 11, 17, 18, 0));
    expect(inställd.ics_status).toBe("CANCELLED");
  });

  test("händelse utan LOCATION får ingen plats och ingen restid", () => {
    const utan = hitta(barn1.handelser, tillUtc(2026, 11, 21, 12, 0));
    expect(utan.plats_text).toBeNull();
    expect(utan.plats_id).toBeNull();
  });

  test("känd plats kopplas till platsregistret", () => {
    expect(hitta(barn1.handelser, tillUtc(2026, 11, 3, 18, 0)).plats_id).toBe(1);
    expect(hitta(barn2.handelser, tillUtc(2026, 11, 4, 17, 0)).plats_id).toBe(2);
  });

  test("okända platser rapporteras", () => {
    const resultat = tolkaFlode(
      "BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:a@b\nDTSTART;TZID=Europe/Stockholm:20261103T180000\nDTEND;TZID=Europe/Stockholm:20261103T190000\nSUMMARY:Träning\nLOCATION:Zinkensdamms IP\nEND:VEVENT\nEND:VCALENDAR",
      { id: "x", label: "x", samling_monster: null },
      fönster,
      platser
    );
    expect(resultat.okandaPlatser).toEqual(["Zinkensdamms IP"]);
  });

  test("serien expanderas och den flyttade instansen ersätter sin tid", () => {
    const serieTider = barn1.handelser
      .filter((h) => h.titel.includes("(extra)") || h.titel.includes("(flyttad)"))
      .map((h) => h.start_ms)
      .sort((a, b) => a - b);

    expect(serieTider).toContain(tillUtc(2026, 11, 1, 10, 0));
    expect(serieTider).toContain(tillUtc(2026, 11, 8, 10, 0));
    expect(serieTider).toContain(tillUtc(2026, 11, 16, 10, 0));
    expect(serieTider).toContain(tillUtc(2026, 11, 22, 10, 0));
    expect(serieTider).not.toContain(tillUtc(2026, 11, 15, 10, 0));
    expect(serieTider.length).toBe(4);
  });

  test("instanser ur en serie får egna uid", () => {
    const instans = hitta(barn1.handelser, tillUtc(2026, 11, 1, 10, 0));
    expect(instans.uid).toBe(`17000001-2742@sportadmin.se#${tillUtc(2026, 11, 1, 10, 0)}`);
    expect(instans.titel).toBe("Träning - P16 Bandy SBBK (extra)");
  });

  test("en flyttad instans behåller sin ursprungliga nyckel", () => {
    const flyttad = hitta(barn1.handelser, tillUtc(2026, 11, 16, 10, 0));
    expect(flyttad.uid).toBe(`17000001-2742@sportadmin.se#${tillUtc(2026, 11, 15, 10, 0)}`);
  });

  test("händelser utanför fönstret tas inte med", async () => {
    const smalt = tolkaFlode(
      await läsexempel("sportadmin-barn2.ics"),
      { id: "sbbk-f14", label: "SBBK F14", samling_monster: null },
      { fran: tillUtc(2026, 11, 10, 0, 0), till: tillUtc(2026, 11, 12, 0, 0) },
      platser
    );
    expect(smalt.handelser.length).toBe(1);
    expect(smalt.handelser[0]?.start_ms).toBe(tillUtc(2026, 11, 11, 17, 0));
  });

  test("Barn 2:s två pass på lördagen finns båda", () => {
    const lördag = barn2.handelser.filter(
      (h) => h.plats_id === 2 && h.start_ms >= tillUtc(2026, 11, 14, 0, 0) && h.start_ms <= tillUtc(2026, 11, 14, 23, 59)
    );
    expect(lördag.length).toBe(2);
  });
});

describe("lagkod och sport ur titel", () => {
  test("lagkoden plockas ut", () => {
    expect(lagUrTitel("Träning - F2016 Gul")).toBe("F2016");
    expect(lagUrTitel("Träning spånga - Richard - SBBK U2015 Träning")).toBe("U2015");
    expect(lagUrTitel("Träning - P 2016")).toBe("P2016");
  });

  test("titlar utan kod ger null", () => {
    expect(lagUrTitel("Träning - SBBK Flickor")).toBeNull();
    expect(lagUrTitel("Sammandrag: SBBK F14 - Flera lag")).toBeNull();
  });

  test("sporten plockas ur titeln när den står där", () => {
    expect(sportUrTitel("Extra Träning innebandy - F2013")).toBe("innebandy");
    expect(sportUrTitel("Träning - F2013")).toBeNull();
    expect(sportUrTitel("Bandyträning")).toBe("bandy");
  });

  test("händelsen bär sporten som titeln anger", () => {
    const träning = hitta(barn1.handelser, tillUtc(2026, 11, 3, 18, 0));
    expect(träning.sport_titel).toBe("bandy");
    // Fixturens titel är "P16", alltså ingen fyrsiffrig lagkod. Det ger inget lag, och händelsen
    // faller tillbaka på flödets barn och sport. Verkliga flöden skriver F2013 och U2015.
    expect(träning.lag).toBeNull();
  });
});

describe("flödets filter", () => {
  const scout = `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:a-1@x\nDTSTART;TZID=Europe/Stockholm:20261120T180000\nDTEND;TZID=Europe/Stockholm:20261122T140000\nSUMMARY:Asa-hajken 2026\nDESCRIPTION:Hajk för scout eller ledare på Skutorna och Vindarna.\nCATEGORIES:Äventyrare\nEND:VEVENT\nBEGIN:VEVENT\nUID:a-2@x\nDTSTART;TZID=Europe/Stockholm:20261206T150000\nDTEND;TZID=Europe/Stockholm:20261206T170000\nSUMMARY:Glögg för ledare\nDESCRIPTION:Alla ledare välkomna.\nCATEGORIES:Ledare\nEND:VEVENT\nEND:VCALENDAR`;

  test("filtret matchar beskrivningen, inte bara titeln", () => {
    const r = tolkaFlode(
      scout,
      { id: "x", label: "x", samling_monster: null, filter_monster: "Skutorna" },
      fönster,
      platser
    );
    expect(r.handelser.map((h) => h.titel)).toEqual(["Asa-hajken 2026"]);
    expect(r.antalFiltrerade).toBe(1);
  });

  test("filtret matchar kategorin", () => {
    // "Äventyrare" står bara i CATEGORIES — varken i titeln eller i beskrivningen.
    const r = tolkaFlode(
      scout,
      { id: "x", label: "x", samling_monster: null, filter_monster: "Äventyrare" },
      fönster,
      platser
    );
    expect(r.handelser.map((h) => h.titel)).toEqual(["Asa-hajken 2026"]);
    expect(r.antalFiltrerade).toBe(1);
  });

  test("utan filter sparas allt", () => {
    const r = tolkaFlode(scout, { id: "x", label: "x", samling_monster: null }, fönster, platser);
    expect(r.handelser).toHaveLength(2);
    expect(r.antalFiltrerade).toBe(0);
  });

  test("ett trasigt filter släpper igenom allt och varnar", () => {
    const r = tolkaFlode(
      scout,
      { id: "x", label: "x", samling_monster: null, filter_monster: "((" },
      fönster,
      platser
    );
    expect(r.handelser).toHaveLength(2);
    expect(r.varningar.join(" ")).toContain("filter");
  });
});

describe("titelregler för lag utan kod", () => {
  test("en regel matchar titeln när koden saknas", () => {
    const resultat = tolkaFlode(
      `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:a-1@x\nDTSTART;TZID=Europe/Stockholm:20261103T180000\nDTEND;TZID=Europe/Stockholm:20261103T190000\nSUMMARY:Träning - SBBK Flickor\nEND:VEVENT\nEND:VCALENDAR`,
      { id: "x", label: "x", samling_monster: null },
      fönster,
      platser,
      [{ kode: "SBBK FLICKOR", monster: "SBBK Flickor" }]
    );
    expect(resultat.handelser[0]?.lag).toBe("SBBK FLICKOR");
  });

  test("koden i titeln vinner över regeln", () => {
    const resultat = tolkaFlode(
      `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:a-2@x\nDTSTART;TZID=Europe/Stockholm:20261103T180000\nDTEND;TZID=Europe/Stockholm:20261103T190000\nSUMMARY:Träning - F2013\nEND:VEVENT\nEND:VCALENDAR`,
      { id: "x", label: "x", samling_monster: null },
      fönster,
      platser,
      [{ kode: "REGL", monster: "Träning" }]
    );
    expect(resultat.handelser[0]?.lag).toBe("F2013");
  });

  test("en trasig regel kraschar inte tolkningen", () => {
    const resultat = tolkaFlode(
      `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:a-3@x\nDTSTART;TZID=Europe/Stockholm:20261103T180000\nDTEND;TZID=Europe/Stockholm:20261103T190000\nSUMMARY:Träning\nEND:VEVENT\nEND:VCALENDAR`,
      { id: "x", label: "x", samling_monster: null },
      fönster,
      platser,
      [{ kode: "TRASIG", monster: "(((" }]
    );
    expect(resultat.handelser[0]?.lag).toBeNull();
  });
});

describe("motståndare ur titel", () => {
  test("match med bindestreck", () => {
    expect(motstandareUrTitel("Match: SBBK P16 - Hammarby IF")).toBe("Hammarby IF");
  });

  test("sammandrag ger ingen motståndare", () => {
    expect(motstandareUrTitel("Sammandrag: SBBK F14 - Flera lag")).toBeNull();
  });

  test("träning ger ingen motståndare", () => {
    expect(motstandareUrTitel("Träning - P16 Bandy SBBK")).toBeNull();
  });
});
