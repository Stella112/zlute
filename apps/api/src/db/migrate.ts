import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The authoritative schema DDL (idempotent: CREATE TABLE IF NOT EXISTS). */
export function schemaSql(): string {
  return readFileSync(fileURLToPath(new URL('../../src/db/schema.sql', import.meta.url)), 'utf8');
}
