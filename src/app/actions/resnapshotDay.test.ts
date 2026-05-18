/**
 * heals-system-rebuild — `resnapshotDay` server action tests (task 7.16).
 *
 * The action gates on `getCurrentProfile()` (owner-only), validates
 * the input shape (`businessDate` + optional `branch`), then SELECTs
 * the day's rows from `transactions` and verifies the commission
 * identity
 *
 *     total_commission = base_commission + balm_bonus + booking_bonus + addon
 *
 * row by row. Mismatches surface as a `warnings` array per Req 13.3;
 * the action only fails for auth, role, validation, or DB errors.
 *
 * The Supabase clients and `getCurrentProfile` are mocked so the test
 * does not boot a Supabase stack.
 *
 * Validates: Requirement 13.3 (recalc surfaces warnings rather than
 *            blocking the edit/delete path).
 */

jest.mock('@/lib/profile', () => ({
  getCurrentProfile: jest.fn(),
}))
jest.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: jest.fn(),
}))

import { getCurrentProfile } from '@/lib/profile'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { resnapshotDay } from './resnapshotDay'

const mockGetCurrentProfile = getCurrentProfile as jest.MockedFunction<
  typeof getCurrentProfile
>
const mockCreateServerSupabaseClient =
  createServerSupabaseClient as jest.MockedFunction<
    typeof createServerSupabaseClient
  >

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

interface FakeRow {
  branch: 'Kimberry' | 'Bishop' | 'Chulia'
  business_date: string
  cashier_row_number: number
  staff: string
  base_commission: number
  balm_bonus: number
  booking_bonus: number
  addon: number
  total_commission: number
}

interface SbCall {
  businessDate: string
  branch: string | null
}

interface MakeOpts {
  rows?: FakeRow[]
  selectError?: string
}

function makeSupabaseClient(opts: MakeOpts) {
  const calls: SbCall[] = []

  const builder = (() => {
    let businessDate: string | null = null
    let branch: string | null = null
    const chain = {
      select(_cols: string) {
        return chain
      },
      eq(col: string, val: unknown) {
        if (col === 'business_date') businessDate = String(val)
        if (col === 'branch') branch = String(val)
        return chain
      },
      // Awaiting the builder triggers the request.
      then<TResolve>(
        resolve: (value: {
          data: FakeRow[] | null
          error: { message: string } | null
        }) => TResolve,
      ): Promise<TResolve> {
        calls.push({ businessDate: businessDate ?? '', branch })
        if (opts.selectError) {
          return Promise.resolve(
            resolve({ data: null, error: { message: opts.selectError } }),
          )
        }
        const filtered = (opts.rows ?? []).filter(
          (r) =>
            (!businessDate || r.business_date === businessDate) &&
            (!branch || r.branch === branch),
        )
        return Promise.resolve(resolve({ data: filtered, error: null }))
      },
    }
    return chain
  }) as unknown

  const sb = {
    from(table: string) {
      if (table !== 'transactions') {
        throw new Error(`unexpected table: ${table}`)
      }
      return (builder as () => unknown)()
    },
  }

  return { sb, calls }
}

function setProfile(profile: {
  userId: string
  role: 'owner' | 'cashier'
  branch?: 'Kimberry' | 'Bishop' | 'Chulia' | null
} | null) {
  mockGetCurrentProfile.mockResolvedValue(
    profile
      ? {
          userId: profile.userId,
          role: profile.role,
          branch: profile.branch ?? null,
          displayName: 'Test',
        }
      : null,
  )
}

function setSupabase(opts: MakeOpts) {
  const { sb, calls } = makeSupabaseClient(opts)
  mockCreateServerSupabaseClient.mockReturnValue(sb as never)
  return { calls }
}

beforeEach(() => {
  jest.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('resnapshotDay', () => {
  test('UNAUTHENTICATED when no session', async () => {
    setProfile(null)
    const { calls } = setSupabase({ rows: [] })

    const result = await resnapshotDay({ businessDate: '2026-05-15' })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('UNAUTHENTICATED')
    expect(calls).toHaveLength(0)
  })

  test('NOT_OWNER when role is cashier', async () => {
    setProfile({ userId: 'u1', role: 'cashier', branch: 'Kimberry' })
    const { calls } = setSupabase({ rows: [] })

    const result = await resnapshotDay({ businessDate: '2026-05-15' })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('NOT_OWNER')
    expect(calls).toHaveLength(0)
  })

  test('INVALID_INPUT when businessDate is malformed', async () => {
    setProfile({ userId: 'owner-1', role: 'owner' })
    const { calls } = setSupabase({ rows: [] })

    const result = await resnapshotDay({ businessDate: '15/05/2026' })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('INVALID_INPUT')
    expect(calls).toHaveLength(0)
  })

  test('INVALID_INPUT when branch is not a valid enum', async () => {
    setProfile({ userId: 'owner-1', role: 'owner' })
    const { calls } = setSupabase({ rows: [] })

    const result = await resnapshotDay({
      businessDate: '2026-05-15',
      branch: 'Atlantis',
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('INVALID_INPUT')
    expect(calls).toHaveLength(0)
  })

  test('INVALID_INPUT when businessDate is missing', async () => {
    setProfile({ userId: 'owner-1', role: 'owner' })
    const { calls } = setSupabase({ rows: [] })

    const result = await resnapshotDay({})

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('INVALID_INPUT')
    expect(calls).toHaveLength(0)
  })

  test('owner with consistent rows returns ok with empty warnings', async () => {
    setProfile({ userId: 'owner-1', role: 'owner' })
    const rows: FakeRow[] = [
      {
        branch: 'Kimberry',
        business_date: '2026-05-15',
        cashier_row_number: 1,
        staff: 'Anna',
        base_commission: 30,
        balm_bonus: 3,
        booking_bonus: 4.5,
        addon: 0,
        total_commission: 37.5,
      },
      {
        branch: 'Kimberry',
        business_date: '2026-05-15',
        cashier_row_number: 2,
        staff: 'Bea',
        base_commission: 25,
        balm_bonus: 0,
        booking_bonus: 0,
        addon: 5,
        total_commission: 30,
      },
    ]
    const { calls } = setSupabase({ rows })

    const result = await resnapshotDay({ businessDate: '2026-05-15' })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.businessDate).toBe('2026-05-15')
    expect(result.branch).toBeNull()
    expect(result.checkedRows).toBe(2)
    expect(result.warnings).toEqual([])
    // Branch omitted → no `branch` filter on the query.
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({ businessDate: '2026-05-15', branch: null })
  })

  test('inconsistent rows surface as warnings (no error)', async () => {
    setProfile({ userId: 'owner-1', role: 'owner' })
    const rows: FakeRow[] = [
      {
        branch: 'Bishop',
        business_date: '2026-05-15',
        cashier_row_number: 7,
        staff: 'Cate',
        base_commission: 20,
        balm_bonus: 0,
        booking_bonus: 0,
        addon: 0,
        // Drift: 20 != 25
        total_commission: 25,
      },
    ]
    setSupabase({ rows })

    const result = await resnapshotDay({ businessDate: '2026-05-15' })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.checkedRows).toBe(1)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toMatch(/Bishop\|2026-05-15\|7/)
    expect(result.warnings[0]).toMatch(/Cate/)
  })

  test('branch filter scopes the consistency check to one branch', async () => {
    setProfile({ userId: 'owner-1', role: 'owner' })
    const rows: FakeRow[] = [
      {
        branch: 'Kimberry',
        business_date: '2026-05-15',
        cashier_row_number: 1,
        staff: 'Anna',
        base_commission: 30,
        balm_bonus: 0,
        booking_bonus: 0,
        addon: 0,
        total_commission: 30,
      },
      {
        branch: 'Bishop',
        business_date: '2026-05-15',
        cashier_row_number: 1,
        staff: 'Bea',
        base_commission: 30,
        balm_bonus: 0,
        booking_bonus: 0,
        addon: 0,
        total_commission: 30,
      },
    ]
    const { calls } = setSupabase({ rows })

    const result = await resnapshotDay({
      businessDate: '2026-05-15',
      branch: 'Bishop',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.branch).toBe('Bishop')
    expect(result.checkedRows).toBe(1)
    expect(calls[0]).toEqual({
      businessDate: '2026-05-15',
      branch: 'Bishop',
    })
  })

  test('zero rows for the day returns ok with empty warnings', async () => {
    setProfile({ userId: 'owner-1', role: 'owner' })
    setSupabase({ rows: [] })

    const result = await resnapshotDay({ businessDate: '2026-05-15' })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.checkedRows).toBe(0)
    expect(result.warnings).toEqual([])
  })

  test('DB_ERROR when select fails', async () => {
    setProfile({ userId: 'owner-1', role: 'owner' })
    setSupabase({ selectError: 'simulated db failure' })

    const result = await resnapshotDay({ businessDate: '2026-05-15' })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('DB_ERROR')
    expect(result.message).toBe('simulated db failure')
  })

  test('floating-point rounding within EPSILON does not warn', async () => {
    setProfile({ userId: 'owner-1', role: 'owner' })
    const rows: FakeRow[] = [
      {
        branch: 'Chulia',
        business_date: '2026-05-15',
        cashier_row_number: 1,
        staff: 'Dee',
        // 0.1 + 0.2 = 0.30000000000000004 in IEEE-754; we expect EPSILON to absorb it.
        base_commission: 0.1,
        balm_bonus: 0,
        booking_bonus: 0,
        addon: 0.2,
        total_commission: 0.3,
      },
    ]
    setSupabase({ rows })

    const result = await resnapshotDay({ businessDate: '2026-05-15' })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toEqual([])
  })
})
