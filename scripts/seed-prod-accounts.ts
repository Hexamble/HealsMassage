// salary-system-rebuild — Heals Thai Massage POS
// One-shot seed script for the HOSTED (production) Supabase project.
//
// Differs from `seed-test-accounts.ts` by:
//   - Loading `.env.production.local` instead of `.env.local`
//   - Seeding ONLY the two accounts the production smoke test needs:
//       bill@heals.local                 — role: owner
//       cashier-kimberry@heals.local     — role: cashier, branch: Kimberry
//   - Ensuring a Kimberry staff roster row exists (so the cashier UI has
//     at least one selectable name when submitting the smoke session).
//   - NOT seeding the May 15 fixture transactions (production should
//     stay empty until the legacy CSV migration tool is run).
//
// Idempotent: re-running updates existing users instead of erroring.
//
// Run from `c:\BILL\app\` via:
//   npx tsx -r dotenv/config scripts/seed-prod-accounts.ts dotenv_config_path=.env.production.local

import { createClient } from '@supabase/supabase-js'
import type { Branch } from '@/domain/row-id'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const PASSWORD = 'heals1234'

if (!URL || !KEY) {
  console.error('Missing env. Source .env.production.local first.')
  process.exit(2)
}

if (!URL.includes('cpbvqxbyicbplsacmfad')) {
  console.error(
    `Refusing to seed: SUPABASE_URL does not look like the hosted production project (${URL}).`,
  )
  process.exit(2)
}

const sb = createClient(URL, KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

interface AccountSpec {
  email: string
  role: 'owner' | 'cashier' | 'boss_view'
  branch?: Branch
}

const ACCOUNTS: AccountSpec[] = [
  { email: 'bill@heals.local', role: 'owner' },
  { email: 'cashier-kimberry@heals.local', role: 'cashier', branch: 'Kimberry' },
]

async function ensureUser(spec: AccountSpec): Promise<void> {
  const { data: list, error: listErr } = await sb.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  })
  if (listErr) throw listErr

  const existing = list.users.find(
    (u) => u.email?.toLowerCase() === spec.email.toLowerCase(),
  )

  const appMetadata: Record<string, unknown> = { role: spec.role }
  if (spec.branch) appMetadata.branch = spec.branch
  else appMetadata.branch = null

  if (existing) {
    const { error } = await sb.auth.admin.updateUserById(existing.id, {
      password: PASSWORD,
      email_confirm: true,
      app_metadata: appMetadata,
    })
    if (error) throw error
    console.log(
      `updated ${spec.email}  (role=${spec.role}${spec.branch ? `, branch=${spec.branch}` : ''})`,
    )
  } else {
    const { error } = await sb.auth.admin.createUser({
      email: spec.email,
      password: PASSWORD,
      email_confirm: true,
      app_metadata: appMetadata,
    })
    if (error) throw error
    console.log(
      `created ${spec.email}  (role=${spec.role}${spec.branch ? `, branch=${spec.branch}` : ''})`,
    )
  }
}

async function ensureKimberryRoster(): Promise<void> {
  // The smoke test submits one session at /cashier/Kimberry; the SessionForm
  // needs at least one staff name in the dropdown for the row to be valid.
  const KIMBERRY_STAFF = [
    { name: 'Beer', homeBranch: 'Kimberry' as Branch, isFreelance: false },
  ]
  for (const s of KIMBERRY_STAFF) {
    const { data: existing } = await sb
      .from('staff')
      .select('id')
      .ilike('name', s.name)
      .maybeSingle()
    if (existing) {
      await sb
        .from('staff')
        .update({
          home_branch: s.homeBranch,
          is_freelance: s.isFreelance,
          active: true,
        })
        .eq('id', existing.id)
    } else {
      await sb.from('staff').insert({
        name: s.name,
        home_branch: s.homeBranch,
        is_freelance: s.isFreelance,
        active: true,
      })
    }
  }
  console.log(`staff roster: ${KIMBERRY_STAFF.length} Kimberry entry ensured`)
}

async function main(): Promise<void> {
  console.log(`seeding hosted Supabase: ${URL}`)
  for (const a of ACCOUNTS) {
    await ensureUser(a)
  }
  await ensureKimberryRoster()

  console.log('')
  console.log('=== Production smoke-test accounts (password "heals1234") ===')
  for (const a of ACCOUNTS) {
    console.log(
      `  ${a.email}  ${a.role}${a.branch ? ` ${a.branch}` : ''}`,
    )
  }
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
