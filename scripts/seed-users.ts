/**
 * heals-system-rebuild — Seed Supabase Auth users + linked profiles.
 *
 * Creates one owner account + three cashier accounts (one per branch)
 * the first time it runs. Idempotent: if a user with the same email
 * already exists, the script just refreshes the linked `profiles`
 * row.
 *
 * Default credentials (override via env vars before running):
 *   OWNER_EMAIL / OWNER_PASSWORD            (default: owner@heals.local / changeme)
 *   CASHIER_KIM_EMAIL / CASHIER_KIM_PASSWORD
 *   CASHIER_BS_EMAIL  / CASHIER_BS_PASSWORD
 *   CASHIER_CL_EMAIL  / CASHIER_CL_PASSWORD
 *
 * Run from `c:\BILL\app\` via:
 *   npm run seed:users
 *
 * IMPORTANT: change the default passwords IMMEDIATELY after first
 * sign-in. The script prints a reminder.
 */

import { createClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!URL || !KEY) {
  console.error(
    'Missing env. Source .env.local with NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
  )
  process.exit(2)
}

const sb = createClient(URL, KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

interface SeedUser {
  email: string
  password: string
  role: 'owner' | 'cashier'
  branch: string | null
  displayName: string
}

function readUsers(): SeedUser[] {
  return [
    {
      email: process.env.OWNER_EMAIL ?? 'owner@heals.local',
      password: process.env.OWNER_PASSWORD ?? 'changeme',
      role: 'owner',
      branch: null,
      displayName: 'Owner',
    },
    {
      email:
        process.env.CASHIER_KIM_EMAIL ?? 'cashier.kimberry@heals.local',
      password: process.env.CASHIER_KIM_PASSWORD ?? 'changeme',
      role: 'cashier',
      branch: 'Kimberry',
      displayName: 'Kimberry cashier',
    },
    {
      email: process.env.CASHIER_BS_EMAIL ?? 'cashier.bishop@heals.local',
      password: process.env.CASHIER_BS_PASSWORD ?? 'changeme',
      role: 'cashier',
      branch: 'Bishop',
      displayName: 'Bishop cashier',
    },
    {
      email: process.env.CASHIER_CL_EMAIL ?? 'cashier.chulia@heals.local',
      password: process.env.CASHIER_CL_PASSWORD ?? 'changeme',
      role: 'cashier',
      branch: 'Chulia',
      displayName: 'Chulia cashier',
    },
  ]
}

async function ensureUser(u: SeedUser): Promise<string> {
  // Try to create. If it already exists, look it up via the admin API
  // and return its id.
  const { data: created, error: createErr } = await sb.auth.admin.createUser({
    email: u.email,
    password: u.password,
    email_confirm: true,
  })
  if (created?.user) {
    return created.user.id
  }
  // 422 = already registered; any other error is fatal.
  if (createErr && createErr.message.toLowerCase().includes('already')) {
    // Look up the user by email via admin list (paginated; small list
    // for this app, so default page is fine).
    const { data: list, error: listErr } = await sb.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    })
    if (listErr) {
      throw new Error(`list users failed: ${listErr.message}`)
    }
    const match = list.users.find((x) => x.email === u.email)
    if (!match) {
      throw new Error(
        `user ${u.email} reported as existing but not found in list`,
      )
    }
    return match.id
  }
  if (createErr) {
    throw new Error(`create user ${u.email} failed: ${createErr.message}`)
  }
  throw new Error(`create user ${u.email} returned no user`)
}

async function ensureProfile(u: SeedUser, userId: string): Promise<void> {
  const { data: existing } = await sb
    .from('profiles')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle()

  if (existing) {
    const { error } = await sb
      .from('profiles')
      .update({
        role: u.role,
        branch: u.branch,
        display_name: u.displayName,
      })
      .eq('id', existing.id)
    if (error) {
      throw new Error(
        `update profile for ${u.email} failed: ${error.message}`,
      )
    }
    return
  }

  const { error } = await sb.from('profiles').insert({
    user_id: userId,
    role: u.role,
    branch: u.branch,
    display_name: u.displayName,
  })
  if (error) {
    throw new Error(`insert profile for ${u.email} failed: ${error.message}`)
  }
}

async function main(): Promise<void> {
  console.log(`seeding users into ${URL}`)
  const users = readUsers()
  for (const u of users) {
    const id = await ensureUser(u)
    await ensureProfile(u, id)
    console.log(
      `  ✓ ${u.email.padEnd(36)} role=${u.role.padEnd(8)} branch=${
        u.branch ?? '(none)'
      }`,
    )
  }
  console.log('')
  console.log('=== users seeded ===')
  console.log(`  total: ${users.length}`)
  console.log('')
  console.log('Default password for every account: changeme')
  console.log('Sign in at /auth/sign-in then change passwords immediately.')
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
