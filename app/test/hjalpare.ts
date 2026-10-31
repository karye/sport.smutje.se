/**
 * Gemensam testhjälp.
 *
 * Den här filen måste importeras **före** `src/db.ts` i varje testfil som rör databasen. Moduler
 * utvärderas i den ordning de importeras, så miljön är satt när db.ts läser den.
 *
 * Alla testfiler delar en databasfil (modulcachen ger samma `db`-objekt), och varje fil rensar
 * tabellerna i sin `beforeAll`. Bun kör testfiler efter varandra, så det räcker.
 */
import { tmpdir } from "node:os";
import { join } from "node:path";

export const TEST_DB = join(tmpdir(), "sport-test.sqlite");

process.env.DB_PATH ??= TEST_DB;
process.env.DATA_DIR ??= tmpdir();
process.env.SESSION_SECRET ??= "s".repeat(64);
process.env.EXPORT_SECRET ??= "e".repeat(64);
process.env.GOOGLE_CLIENT_ID ??= "klient-id.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET ??= "hemlig";
process.env.REDIRECT_URI ??= "https://sport.smutje.se/auth/callback";
process.env.ALLOWED_EMAILS ??= "foralder1@example.com:foralder,foralder2@example.com:foralder";

export function rensa(databas: { exec(sql: string): void }): void {
  databas.exec(`
    DELETE FROM overrides;
    DELETE FROM events;
    DELETE FROM fetch_runs;
    DELETE FROM feeds;
    DELETE FROM lag;
    DELETE FROM barn;
    DELETE FROM users;
    DELETE FROM platser;
  `);
}
