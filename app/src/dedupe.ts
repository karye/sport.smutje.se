/**
 * Fingerprint för att känna igen samma match i två flöden.
 *
 * Samma match kan ligga både i barnets flöde och i lagets. Titeln skiljer sig ofta åt mellan
 * flödena, därför normaliseras den hårt: gemener, utan diakriter, utan skiljetecken.
 */
import { createHash } from "node:crypto";
import { delar } from "./tid.ts";

function normalisera(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function fingerprint(titel: string, startMs: number, slutMs: number, plats: string | null): string {
  const d = delar(startMs);
  // Starttiden är med, avrundad nedåt till kvart: två matcher samma dag på samma plats är olika
  // händelser, men en förening som rättar 10:00 till 10:05 ska inte ge en ny nyckel.
  const kvart = `${d.ar}-${d.manad}-${d.dag}T${String(d.timme).padStart(2, "0")}:${String(Math.floor(d.minut / 15) * 15).padStart(2, "0")}`;
  const nyckel = [normalisera(titel), kvart, slutMs > 0 ? 1 : 0, normalisera(plats ?? "")].join("|");
  return createHash("sha1").update(nyckel).digest("hex").slice(0, 16);
}
