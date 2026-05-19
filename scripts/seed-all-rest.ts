/**
 * heals-system-rebuild — Seed everything via Supabase REST.
 *
 * Imports each seed module and runs them in order. No spawning child
 * processes — runs in-process so output and errors propagate cleanly.
 *
 * Usage:
 *   npm run seed:all          (uses .env.local)
 *   npm run seed:all:prod     (uses .env.production.local)
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(2)
}

console.log(`Seeding all reference data into ${SUPABASE_URL}\n`)

async function run(name: string, modulePath: string): Promise<void> {
  console.log(`>>> ${name}`)
  // Each seed script's main() runs at import time. Awaiting the import
  // lets us serialize them. Each module ends with `main().catch(...)`.
  // We need to wait for that promise; the cleanest way is to wrap each
  // seed in a top-level async block. Since the existing seeds use a
  // top-level main() with .catch(process.exit), importing them
  // synchronously kicks them off but doesn't expose the promise.
  //
  // Workaround: spawn tsx as a subprocess but use spawnSync with
  // shell:true so the npx.cmd resolution works on Windows.
  const { spawnSync } = await import('node:child_process')
  const r = spawnSync(
    'npx',
    ['tsx', '-r', 'dotenv/config', modulePath, `dotenv_config_path=${process.env.DOTENV_CONFIG_PATH ?? '.env.local'}`],
    { stdio: 'inherit', env: process.env, shell: true },
  )
  if (r.status !== 0) {
    throw new Error(`Seed ${name} failed (exit ${r.status})`)
  }
  console.log('')
}

async function main(): Promise<void> {
  await run('prices', 'scripts/seed-prices.ts')
  await run('rates', 'scripts/seed-commission-rates.ts')
  await run('staff', 'scripts/seed-staff.ts')
  await run('settings', 'scripts/seed-settings.ts')
  await run('users', 'scripts/seed-users.ts')
  console.log('All seeds complete.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
