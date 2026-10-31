/**
 * Samlingstid ur beskrivningen.
 *
 * Verkligt format från Sportadmin (kontrollerat mot ett skarpt flöde 2026-10-29): 75 av 86
 * händelser har `DESCRIPTION:Samling: 18:00`, ofta följt av `\n` och mer text. Mönstret är
 * alltså inte en gissning, men det är föreningens text och kan ändras — därför ett mönster per
 * flöde, och hellre ingen samling än en påhittad.
 */
import { delar, tillUtc } from "./tid.ts";

export type SamlingKalla = "regex" | "minuter";

export interface Samling {
  ms: number;
  kalla: SamlingKalla;
  /**
   * Sant när tiden i texten är samma som passets starttid. Sportadmin fyller i samma tid när
   * ledaren inte angett någon samling (13 av 86 i det skarpa flödet), och då tillför raden
   * ingenting: kortet visar redan starttiden.
   */
  likaStart: boolean;
}

/**
 * `Samling: 18:00` (Sportadmin) och `Samling: Kärrtorps IP, kl 16:00` (SvenskaLag).
 *
 * Avståndet mellan ordet och tiden får vara upp till 60 tecken, men aldrig innehålla siffror —
 * då hade "samling 14/11 kl 16" kunnat läsas som klockslaget 14:11. `\D` hindrar det.
 */
const TID = /samling\D{0,60}?(\d{1,2})[:.](\d{2})/i;

/**
 * Samma sak men ankrad på `kl`, som SvenskaLag skriver: `Samling 14/11 kl 16:00`.
 * Utan ankaret kan inte datumet före tiden hoppas över, eftersom TID aldrig korsar en siffra.
 */
const TID_MED_KL = /samling\b.{0,60}?\bkl\.?\s*(\d{1,2})[:.](\d{2})/i;

/**
 * Längsta rimliga tid mellan samling och start.
 *
 * Föreningarna skriver ibland en tid som inte hör till passet — ett skarpt fall: samling 13:30
 * för en träning 17:30. Att visa den som samling vore att lämna ut fel uppgift, och dessutom
 * blockera fyra timmar i krockmodellen. Hellre ingen samling än en orimlig.
 */
export const MAX_TIDIG_SAMLING_MS = 3 * 3_600_000;

/** `Samling 45 min innan`. */
const MINUTER = /samling\D{0,20}?(\d{1,3})\s*min\s*(?:innan|före|fore)/i;

/**
 * Tolkar samlingstiden.
 *
 * `monster` är flödets eget mönster och måste ha två grupper: timme och minut. Är det ogiltigt
 * används standardmönstret, så att ett skrivfel i inställningarna inte tystar samlingen.
 */
export function tolkaSamling(
  beskrivning: string | null | undefined,
  startMs: number,
  monster?: string | null
): Samling | null {
  if (!beskrivning) return null;

  const text = beskrivning.replace(/\\n/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return null;

  if (monster) {
    try {
      const eget = new RegExp(monster, "i");
      const träff = eget.exec(text);
      if (träff?.[1] && träff[2]) {
        const ms = sammaDagSom(startMs, Number(träff[1]), Number(träff[2]));
        if (ms !== null) return { ms, kalla: "regex", likaStart: ms === startMs };
      }
    } catch {
      // Ogiltigt mönster: faller igenom till standardmönstret nedan.
    }
  }

  const minutträff = MINUTER.exec(text);
  if (minutträff?.[1]) {
    const minuter = Number(minutträff[1]);
    if (minuter > 0 && minuter <= 240) {
      return { ms: startMs - minuter * 60000, kalla: "minuter", likaStart: false };
    }
  }

  const träff = TID_MED_KL.exec(text) ?? TID.exec(text);
  if (träff?.[1] && träff[2]) {
    const ms = sammaDagSom(startMs, Number(träff[1]), Number(träff[2]));
    if (ms !== null) return { ms, kalla: "regex", likaStart: ms === startMs };
  }

  return null;
}

/**
 * Lägger tiden på samma kalenderdag som passet.
 *
 * En samling kan ligga strax före midnatt när passet börjar efter midnatt, och tvärtom. Regeln:
 * samlingen ska ligga före passet, men aldrig mer än tolv timmar före.
 */
function sammaDagSom(startMs: number, timme: number, minut: number): number | null {
  if (!Number.isInteger(timme) || !Number.isInteger(minut)) return null;
  if (timme < 0 || timme > 23 || minut < 0 || minut > 59) return null;

  const { ar, manad, dag } = delar(startMs);
  let ms = tillUtc(ar, manad, dag, timme, minut);

  if (ms > startMs) ms -= 86400000;
  if (startMs - ms > 12 * 3600000) ms += 86400000;

  if (ms > startMs) return null;

  // En samling fyra timmar före passet är inte en samling. Det skarpa fallet: "Samling: 13:30"
  // på en träning som börjar 17:30. Att visa den vore fel uppgift, och den skulle dessutom
  // blockera fyra timmar i krockmodellen.
  if (startMs - ms > MAX_TIDIG_SAMLING_MS) return null;

  return ms;
}
