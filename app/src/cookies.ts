/**
 * Cookies. Samma form som prov.smutje.se, av samma skäl: en enda plats som vet hur en
 * Set-Cookie-rad ser ut, så att sessionen och state-noncen aldrig glider isär.
 */

export interface CookieVal {
  maxAge?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Lax" | "Strict" | "None";
  path?: string;
}

export function serialize(namn: string, varde: string, val: CookieVal = {}): string {
  const delar = [`${namn}=${varde}`, `Path=${val.path ?? "/"}`];
  if (val.maxAge !== undefined) delar.push(`Max-Age=${Math.floor(val.maxAge)}`);
  if (val.httpOnly !== false) delar.push("HttpOnly");
  if (val.secure !== false) delar.push("Secure");
  delar.push(`SameSite=${val.sameSite ?? "Lax"}`);
  return delar.join("; ");
}

export function serializeCleared(namn: string): string {
  return `${namn}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

/** Läser Cookie-huvudet till ett objekt. Sista värdet vinner, vilket räcker för våra namn. */
export function parse(header: string | null | undefined): Record<string, string> {
  const ut: Record<string, string> = {};
  if (!header) return ut;
  for (const del of header.split(";")) {
    const likamed = del.indexOf("=");
    if (likamed < 1) continue;
    const namn = del.slice(0, likamed).trim();
    const varde = del.slice(likamed + 1).trim();
    if (namn) ut[namn] = decodeURIComponent(varde);
  }
  return ut;
}

export const cookieFran = (request: Request): Record<string, string> =>
  parse(request.headers.get("cookie"));
