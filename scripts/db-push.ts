/**
 * heals-system-rebuild — Direct migration runner.
 *
 * Reads SUPABASE_DB_URL from env and applies every SQL file in
 * supabase/migrations/ in name order. Used for hosted-Supabase
 * deployments where psql + supabase CLI are not available.
 *
 * Idempotent because every migration uses CREATE … IF NOT EXISTS
 * and ON CONFLICT clauses.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { Client } from 'pg'

const DB_URL = process.env.SUPABASE_DB_URL
if (!DB_URL) {
  console.error('SUPABASE_DB_URL is required (postgres://… connection string)')
  process.exit(2)
}

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations')
if (!existsSync(MIGRATIONS_DIR)) {
  console.error(`Migrations dir not found: ${MIGRATIONS_DIR}`)
  process.exit(2)
}

async function main(): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  console.log(`Applying ${files.length} migration(s) to hosted DB…`)

  const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } })
  await client.connect()

  try {
    for (const file of files) {
      const path = join(MIGRATIONS_DIR, file)
      const sql = readFileSync(path, 'utf-8')
      console.log(`  → ${file}`)
      try {
        await client.query(sql)
        console.log(`    ✓ applied`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        // Tolerate "already exists" / "duplicate" on re-run; fail anything else.
        if (
          msg.includes('already exists') ||
          msg.includes('duplicate key') ||
          msg.includes('does not exist, skipping')
        ) {
          console.log(`    (skipped: ${msg.split('\n')[0]})`)
        } else {
          throw err
        }
      }
    }
  } finally {
    await client.end()
  }

  console.log('All migrations applied.')
}

main().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
