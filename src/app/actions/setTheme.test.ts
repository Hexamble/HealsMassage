/**
 * salary-system-rebuild — `setTheme` server action tests.
 *
 * The action is intentionally simple: auth gate, zod validation,
 * and an UPSERT into `user_preferences` keyed by `user_id`. We
 * mock the user-bound Supabase client so the tests run without a
 * local DB. There is no audit_log write, so we don't mock the
 * service client.
 *
 * Validates: ergonomics — Epic 18 (theme toggle).
 */

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn(),
}))

import { createServerClient } from '@/lib/supabase/server'
import { setTheme } from './setTheme'

const mockCreateServerClient = createServerClient as jest.MockedFunction<
  typeof createServerClient
>

// ---------------------------------------------------------------------------
// Mock client factory
// ---------------------------------------------------------------------------

interface MockSetup {
  user: string | null
  /** Optional override: force the upsert to fail with this error message. */
  upsertErrorMessage?: string
}

interface StoredPref {
  user_id: string
  theme: string
  updated_at: string
}

function makeMockClient(setup: MockSetup) {
  const store = new Map<string, StoredPref>()

  const client = {
    auth: {
      getUser: () =>
        Promise.resolve({
          data: {
            user: setup.user
              ? {
                  id: setup.user,
                  app_metadata: {},
                }
              : null,
          },
          error: setup.user ? null : { message: 'no user' },
        }),
    },
    from: (table: string) => {
      if (table !== 'user_preferences') {
        throw new Error(`unexpected table: ${table}`)
      }
      return {
        upsert: (
          payload: { user_id: string; theme: string; updated_at: string },
          _opts: { onConflict?: string },
        ) => ({
          select: (_cols: string) => ({
            single: <T,>() => {
              if (setup.upsertErrorMessage) {
                return Promise.resolve({
                  data: null as T | null,
                  error: { message: setup.upsertErrorMessage },
                })
              }
              const stored: StoredPref = {
                user_id: payload.user_id,
                theme: payload.theme,
                updated_at: payload.updated_at,
              }
              store.set(payload.user_id, stored)
              return Promise.resolve({
                data: {
                  user_id: stored.user_id,
                  theme: stored.theme,
                } as T,
                error: null,
              })
            },
          }),
        }),
      }
    },
  }

  return { client, store }
}

function installMocks(setup: MockSetup) {
  const { client, store } = makeMockClient(setup)
  mockCreateServerClient.mockReturnValue(client as never)
  return { store }
}

beforeEach(() => {
  jest.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('setTheme', () => {
  test('UNAUTHENTICATED when no user session', async () => {
    const { store } = installMocks({ user: null })

    const result = await setTheme({ theme: 'dark' })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('UNAUTHENTICATED')
    expect(store.size).toBe(0)
  })

  test('INVALID_INPUT when theme is not one of light/dark/system', async () => {
    const { store } = installMocks({ user: 'user-1' })

    const result = await setTheme({ theme: 'blue' })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('INVALID_INPUT')
    expect(store.size).toBe(0)
  })

  test('INVALID_INPUT when payload is missing the theme field', async () => {
    const { store } = installMocks({ user: 'user-1' })

    const result = await setTheme({})

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('INVALID_INPUT')
    expect(store.size).toBe(0)
  })

  test('valid call upserts the pref row keyed by user_id', async () => {
    const { store } = installMocks({ user: 'user-1' })

    const result = await setTheme({ theme: 'dark' })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.theme).toBe('dark')
    expect(store.size).toBe(1)
    const stored = store.get('user-1')!
    expect(stored.theme).toBe('dark')
    expect(stored.user_id).toBe('user-1')
    expect(stored.updated_at).toEqual(expect.any(String))
  })

  test('switching theme overwrites the existing row (idempotent upsert)', async () => {
    const { store } = installMocks({ user: 'user-1' })

    const r1 = await setTheme({ theme: 'dark' })
    const r2 = await setTheme({ theme: 'light' })
    const r3 = await setTheme({ theme: 'system' })

    expect(r1.ok && r1.theme).toBe('dark')
    expect(r2.ok && r2.theme).toBe('light')
    expect(r3.ok && r3.theme).toBe('system')
    // Still exactly one row per user.
    expect(store.size).toBe(1)
    expect(store.get('user-1')!.theme).toBe('system')
  })

  test('DB_ERROR surfaces the underlying error message', async () => {
    installMocks({
      user: 'user-1',
      upsertErrorMessage: 'simulated db failure',
    })

    const result = await setTheme({ theme: 'dark' })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('DB_ERROR')
    expect(result.message).toBe('simulated db failure')
  })

  test('every authenticated user (any role) may set their own theme', async () => {
    // No role gate — even an unknown-role user gets through provided
    // they have a session. Validates that we are not duplicating the
    // owner role check from `setPrice`.
    const { store } = installMocks({ user: 'cashier-1' })

    const result = await setTheme({ theme: 'light' })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(store.get('cashier-1')!.theme).toBe('light')
  })
})
