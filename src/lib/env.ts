// heals-system-rebuild — Heals Thai Massage POS
// Centralised environment configuration loader.
//
// Validates `process.env` once per access using Zod and exposes two
// narrowed records:
//
//   - `clientEnv`  — the two NEXT_PUBLIC_* values that are safe to ship
//                    to the browser. Validated eagerly on import (every
//                    page boot needs them).
//   - `serverEnv`  — all four values (URL, anon key, service role key,
//                    cron secret). Validated **lazily** on first
//                    property access so booting the dev server without
//                    a CRON_SECRET still works — only code paths that
//                    actually need the cron secret (the
//                    `/api/cron/*` routes) trip the validation.
//
// Lazy server-side validation matters because Next 14 imports
// `serverEnv` transitively from many places (sign-in page, supabase
// SSR client, every server action) — but only the cron route actually
// reads `serverEnv.CRON_SECRET`. Eagerly throwing on missing values
// would block the whole dev server.
//
// Browser safety: in a browser bundle, accessing any property of
// `serverEnv` throws immediately so a stray client import surfaces
// the violation loudly instead of silently reading `undefined`.
//
// _Requirements: 1.1, 20.1_

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

// Non-empty string after trimming. We treat empty strings the same as
// `undefined` because `.env` files often contain `KEY=` lines that
// resolve to empty strings, which are never valid for any of these
// secrets.
const requiredString = z
  .string({
    required_error: 'is required',
    invalid_type_error: 'must be a string',
  })
  .trim()
  .min(1, { message: 'is required' })

const clientEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: requiredString.url({
    message: 'must be a valid URL',
  }),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: requiredString,
})

// Each server-only secret is validated independently and only at the
// moment it's read — this avoids the "boot the dev server fails if
// CRON_SECRET is missing" problem when the developer just wants to
// click around the cashier page.
const supabaseServiceRoleKeySchema = requiredString
const cronSecretSchema = requiredString

export type ClientEnv = z.infer<typeof clientEnvSchema>
export interface ServerEnv {
  NEXT_PUBLIC_SUPABASE_URL: string
  NEXT_PUBLIC_SUPABASE_ANON_KEY: string
  SUPABASE_SERVICE_ROLE_KEY: string
  CRON_SECRET: string
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const key = issue.path.join('.') || '(root)'
      return `${key} ${issue.message}`
    })
    .join('; ')
}

function loadClientEnv(): ClientEnv {
  const result = clientEnvSchema.safeParse(process.env)
  if (!result.success) {
    throw new Error(
      `Invalid public environment configuration: ${formatIssues(result.error)}`,
    )
  }
  return result.data
}

/**
 * Validate one server-only key on demand and return its value.
 *
 * Throws a precise error mentioning ONLY the key that failed, so a
 * missing CRON_SECRET doesn't make the developer think the whole
 * Supabase wiring is broken.
 */
function readServerKey(
  schema: z.ZodSchema<string>,
  envName: string,
): string {
  const result = schema.safeParse(process.env[envName])
  if (!result.success) {
    throw new Error(
      `Invalid server environment configuration: ${envName} ${formatIssues(result.error)}`,
    )
  }
  return result.data
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

// `clientEnv` is safe in both server and browser bundles. NEXT_PUBLIC_*
// values are inlined by Next.js at build time, so accessing them on
// the client works.
export const clientEnv: ClientEnv = loadClientEnv()

/**
 * Server-only environment record with **lazy per-key validation**.
 *
 * - On the server: each property accessor reads + validates its value
 *   on demand. If the value is missing, the throw mentions only that
 *   key. Other properties stay reachable.
 * - In the browser: every property access throws immediately so a
 *   stray client import is loud instead of silent.
 */
function makeServerEnv(): ServerEnv {
  return new Proxy({} as ServerEnv, {
    get(_target, prop) {
      if (typeof window !== 'undefined') {
        throw new Error(
          `serverEnv.${String(prop)} is not accessible in the browser. ` +
            `Move this code to a Server Component, Server Action, or Route Handler.`,
        )
      }
      switch (prop) {
        case 'NEXT_PUBLIC_SUPABASE_URL':
          return readServerKey(requiredString, 'NEXT_PUBLIC_SUPABASE_URL')
        case 'NEXT_PUBLIC_SUPABASE_ANON_KEY':
          return readServerKey(
            requiredString,
            'NEXT_PUBLIC_SUPABASE_ANON_KEY',
          )
        case 'SUPABASE_SERVICE_ROLE_KEY':
          return readServerKey(
            supabaseServiceRoleKeySchema,
            'SUPABASE_SERVICE_ROLE_KEY',
          )
        case 'CRON_SECRET':
          return readServerKey(cronSecretSchema, 'CRON_SECRET')
        default:
          // Allow Symbol.toPrimitive, util.inspect, etc. to no-op so
          // logging the object doesn't trip the proxy.
          return undefined
      }
    },
  })
}

export const serverEnv: ServerEnv = makeServerEnv()
