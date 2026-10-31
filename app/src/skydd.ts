/**
 * Skyddet. En plats som vet vad som krävs, så att ingen rutt glömmer det.
 *
 *   inloggad      vem som frågar
 *   krävsSida     svaret när en sida efterfrågas utan inloggning
 *   krävsApi      svaret när ett API-anrop görs utan inloggning
 *   krävsForalder svaret när rollen barn försöker skriva
 *   sammaUrsprung för skrivningar, utöver SameSite=Lax
 */
import type { Anvandare } from "./typer.ts";
import { currentUser } from "./auth.ts";
import { cookieFran } from "./cookies.ts";

export function inloggad(request: Request): Anvandare | null {
  return currentUser(cookieFran(request));
}

export const krävsApi = (): Response =>
  Response.json({ fel: "Inte inloggad" }, { status: 401 });

export const krävsForalder = (): Response =>
  Response.json({ fel: "Kräver föräldrakonto" }, { status: 403 });

/**
 * Origin-kontroll för skrivningar.
 *
 * SameSite=Lax skyddar mot formulär från andra sajter, men inte mot alla anrop. Regeln är att
 * Origin ska finnas och peka på samma värd som Host. Saknas Origin avvisas anropet — en webbläsare
 * skickar alltid huvudet vid POST och PATCH.
 */
export function sammaUrsprung(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;

  // Host-huvudet sätts av Apache, men en Request som byggs i en testklient har det inte. URL:ens
  // värd är då rätt jämförelse: den är serverns egen adress, inte något anroparen kan styra över.
  let host = request.headers.get("host");
  try {
    host = host ?? new URL(request.url).host;
  } catch {
    return false;
  }
  if (!host) return false;

  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function krävsJson(request: Request): boolean {
  return (request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json");
}
