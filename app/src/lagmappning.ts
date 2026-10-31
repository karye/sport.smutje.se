/**
 * Vilket lag ett pass tillhör.
 *
 * Två vägar, i ordning:
 *
 *   1. En lagkod i titeln: F2016, P2015, U2015. Det föreningarna skriver.
 *   2. En titelregel per lag, för de pass som saknar kod: "SBBK Flickor", "Match: Ängby IF …".
 *      Utan regeln hamnar de i "omappad" och räknas inte som krockar.
 */
export interface Lagregel {
  kode: string;
  monster: string | null;
}

const KOD = /\b([FPU])[\s-]?(?:19|20)\d{2}\b/i;

export function lagUrTitel(titel: string): string | null {
  const träff = KOD.exec(titel);
  return träff ? `${träff[1]}${träff[0].slice(1).replace(/[\s-]/g, "")}`.toUpperCase() : null;
}

/**
 * Första regeln som matchar titeln. Reglerna prövas i den ordning de ligger i databasen, så en
 * specifik regel ska ligga före en vid.
 */
export function lagregelTraff(titel: string, regler: readonly Lagregel[]): string | null {
  for (const regel of regler) {
    if (!regel.monster) continue;
    try {
      if (new RegExp(regel.monster, "i").test(titel)) return regel.kode;
    } catch {
      // En ogiltig regel ska inte stoppa tolkningen av flödet.
    }
  }
  return null;
}

export function lagFor(titel: string, regler: readonly Lagregel[] = []): string | null {
  return lagUrTitel(titel) ?? lagregelTraff(titel, regler);
}
