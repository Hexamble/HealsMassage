/**
 * heals-system-rebuild — `ownerSetDayCommission` server action tests
 * (task 7.15).
 *
 * The heals contract is: owner edits one or more of `baseCommission`,
 * `balmBonus`, `bookingBonus`, `addon` for a specific row by UUID.
 * Missing parts are merged from the existing row, and `total_commission`
 * is recomputed server-side so the `total_commission_equals_parts`
 * CHECK constraint always holds. Audit is captured automatically by
 * the AFTER UPDATE trigger on `transactions`.
 *
 * Tests mock `getCurrentProfile` and `createServerSupabaseClient` and
 * assert:
 *   1. UNAUTHENTICATED when no profile
 *   2. NOT_OWNER when profile.role is cashier
 *   3. INVALID_INPUT when id is not a UUID
 *   4. INVALID_INPUT when no override field is supplied (empty patch)
 *   5. NOT_FOUND when the row does not exist
 *   6. partial override merges with existing parts and recomputes total
 *   7. full override recomputes total from supplied parts
 *   8. DB_ERROR surfaced on update failure
 *
 * Validates: Requirements 1.6 (audit via DB trigger), 13.3 (owner edit).
 */

jest.mock('@/lib/profile', () => ({
  getCurrentProfile: jest.fn(),
}))
jest.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: jest.fn(),
}))

import { getCurrentProfile } from '@/lib/profile'
import { createServerSupabaseClient } from '@/lib/supabase/server'

import { ownerSetDayCommission } from './ownerSetDayCommission'

const mockGetCurrentProfile = getCurrentProfile as jest.MockedFunction<
  typeof getCurrentProfile
>
const mockCreateServerSupabaseClient =
  createServerSupabaseClient as jest.MockedFunction<
    typeof createServerSupabaseClient
  >

// ---------------------------------------------------------------------------
// Mock client factory
// ---------------------------------------------------------------------------

const VALID_UUID = '11111111-1111-4111-8111-111111111111'

interface ExistingPartsRow {
  base_commission: number | string
  balm_bonus: number | string
  booking_bonus: number | string
  addon: number | string
}

interface PersistedRow {
  id: string
  branch: 'Kimberry' | 'Bishop' | 'Chulia'
  business_date: string
  cashier_row_number: number
  staff: string
  course: string
  duration: number
  time_in: string | null
  time_out: string | null
  method: string
  addon: number
  base_commission: number
  balm_bonus: number
  booking_bonus: number
  total_commission: number
  cash: number
  qr: number
  credit: number
  price: number
  flags: string | null
  comment: string | null
  created_at: string
  updated_at: string
  created_by: string | null
}

interface MockSetup {
  /** Existing parts returned by the SELECT-before-update fetch. */
  existing?: ExistingPartsRow | null
  /** Persisted row returned by the UPDATE … RETURNING * call. */
  updatedRow?: PersistedRow | null
  /** When set, the SELECT step fails with this message. */
  fetchErrorMessage?: string
  /** When set, the UPDATE step fails with this message. */
  updateErrorMessage?: string
}

interface CapturedUpdate {
  patch: Record<string, unknown>
  id: string
}

function installMockClient(setup: MockSetup) {
  const updates: CapturedUpdate[] = []

  const client = {
    from: (table: string) => {
      if (table !== 'transactions') {
        throw new Error(`unexpected table on user client: ${table}`)
      }
      return {
        // SELECT step (fetch existing parts)
        select: (_cols: string) => ({
          eq: (_col: string, _id: string) => ({
            maybeSingle: () => {
              if (setup.fetchErrorMessage) {
                return Promise.resolve({
                  data: null,
                  error: { message: setup.fetchErrorMessage },
                })
              }
              return Promise.resolve({
                data: setup.existing ?? null,
                error: null,
              })
            },
          }),
        }),
        // UPDATE step
        update: (patch: Record<string, unknown>) => ({
          eq: (_col: string, id: string) => ({
            select: (_cols: string) => ({
              maybeSingle: () => {
                if (setup.updateErrorMessage) {
                  return Promise.resolve({
                    data: null,
                    error: { message: setup.updateErrorMessage },
                  })
                }
                updates.push({ patch, id })
                return Promise.resolve({
                  data: setup.updatedRow ?? null,
                  error: null,
                })
              },
            }),
          }),
        }),
      }
    },
  }

  mockCreateServerSupabaseClient.mockReturnValue(client as never)
  return { updates }
}

function setOwner() {
  mockGetCurrentProfile.mockResolvedValue({
    userId: 'owner-1',
    role: 'owner',
    branch: null,
    displayName: 'Owner',
  })
}

function setCashier() {
  mockGetCurrentProfile.mockResolvedValue({
    userId: 'cashier-1',
    role: 'cashier',
    branch: 'Kimberry',
    displayName: 'Cashier',
  })
}

function makePersistedRow(overrides: Partial<PersistedRow> = {}): PersistedRow {
  return {
    id: VALID_UUID,
    branch: 'Kimberry',
    business_date: '2026-05-15',
    cashier_row_number: 7,
    staff: 'Beer',
    course: 'FR',
    duration: 60,
    time_in: '10:00',
    time_out: '11:00',
    method: 'CASH',
    addon: 0,
    base_commission: 18,
    balm_bonus: 0,
    booking_bonus: 0,
    total_commission: 18,
    cash: 70,
    qr: 0,
    credit: 0,
    price: 70,
    flags: '',
    comment: '',
    created_at: '2026-05-15T10:00:00Z',
    updated_at: '2026-05-15T10:00:00Z',
    created_by: null,
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ownerSetDayCommission', () => {
  test('UNAUTHENTICATED when no profile resolved', async () => {
    mockGetCurrentProfile.mockResolvedValue(null)
    installMockClient({})

    const result = await ownerSetDayCommission({
      id: VALID_UUID,
      baseCommission: 30,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('UNAUTHENTICATED')
  })

  test('NOT_OWNER when profile.role is cashier', async () => {
    setCashier()
    installMockClient({})

    const result = await ownerSetDayCommission({
      id: VALID_UUID,
      baseCommission: 30,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('NOT_OWNER')
  })

  test('INVALID_INPUT when id is not a UUID', async () => {
    setOwner()
    installMockClient({})

    const result = await ownerSetDayCommission({
      id: 'not-a-uuid',
      baseCommission: 30,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('INVALID_INPUT')
  })

  test('INVALID_INPUT when no override fields supplied', async () => {
    setOwner()
    installMockClient({})

    const result = await ownerSetDayCommission({ id: VALID_UUID })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('INVALID_INPUT')
  })

  test('INVALID_INPUT when override is negative', async () => {
    setOwner()
    installMockClient({})

    const result = await ownerSetDayCommission({
      id: VALID_UUID,
      baseCommission: -1,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('INVALID_INPUT')
  })

  test('NOT_FOUND when the row does not exist', async () => {
    setOwner()
    installMockClient({ existing: null })

    const result = await ownerSetDayCommission({
      id: VALID_UUID,
      baseCommission: 30,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('NOT_FOUND')
  })

  test('partial override merges with existing parts and recomputes total', async () => {
    setOwner()
    const { updates } = installMockClient({
      existing: {
        base_commission: 18,
        balm_bonus: 3,
        booking_bonus: 0,
        addon: 0,
      },
      updatedRow: makePersistedRow({
        base_commission: 25,
        balm_bonus: 3,
        booking_bonus: 0,
        addon: 0,
        total_commission: 28,
      }),
    })

    // Caller overrides only baseCommission; other parts must be merged
    // from the existing row and the total recomputed.
    const result = await ownerSetDayCommission({
      id: VALID_UUID,
      baseCommission: 25,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.row.baseCommission).toBe(25)
    expect(result.row.balmBonus).toBe(3)
    expect(result.row.bookingBonus).toBe(0)
    expect(result.row.addon).toBe(0)
    expect(result.row.totalCommission).toBe(28)
    expect(result.row.rowId).toBe('Kimberry|2026-05-15|7')

    // Patch sent to UPDATE includes recomputed total_commission.
    expect(updates).toHaveLength(1)
    expect(updates[0].id).toBe(VALID_UUID)
    expect(updates[0].patch.base_commission).toBe(25)
    expect(updates[0].patch.balm_bonus).toBe(3)
    expect(updates[0].patch.booking_bonus).toBe(0)
    expect(updates[0].patch.addon).toBe(0)
    expect(updates[0].patch.total_commission).toBe(28)
  })

  test('full override recomputes total from all four supplied parts', async () => {
    setOwner()
    const { updates } = installMockClient({
      existing: {
        base_commission: 18,
        balm_bonus: 0,
        booking_bonus: 0,
        addon: 0,
      },
      updatedRow: makePersistedRow({
        base_commission: 20,
        balm_bonus: 3,
        booking_bonus: 4.5,
        addon: 2,
        total_commission: 29.5,
      }),
    })

    const result = await ownerSetDayCommission({
      id: VALID_UUID,
      baseCommission: 20,
      balmBonus: 3,
      bookingBonus: 4.5,
      addon: 2,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.row.totalCommission).toBe(29.5)

    expect(updates).toHaveLength(1)
    expect(updates[0].patch.total_commission).toBe(29.5)
  })

  test('parts coming back as decimal strings are coerced to numbers', async () => {
    // PostgREST sometimes returns numeric(10,2) as strings depending on
    // client settings; the action must coerce when merging defaults.
    setOwner()
    const { updates } = installMockClient({
      existing: {
        base_commission: '18.00',
        balm_bonus: '3.00',
        booking_bonus: '0',
        addon: '0',
      },
      updatedRow: makePersistedRow({
        base_commission: 18,
        balm_bonus: 3,
        booking_bonus: 0,
        addon: 5,
        total_commission: 26,
      }),
    })

    const result = await ownerSetDayCommission({
      id: VALID_UUID,
      addon: 5,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(updates[0].patch.base_commission).toBe(18)
    expect(updates[0].patch.balm_bonus).toBe(3)
    expect(updates[0].patch.total_commission).toBe(26)
  })

  test('DB_ERROR surfaced when fetch fails', async () => {
    setOwner()
    installMockClient({ fetchErrorMessage: 'connection lost' })

    const result = await ownerSetDayCommission({
      id: VALID_UUID,
      baseCommission: 30,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('DB_ERROR')
    expect(result.message).toBe('connection lost')
  })

  test('DB_ERROR surfaced when update fails', async () => {
    setOwner()
    installMockClient({
      existing: {
        base_commission: 18,
        balm_bonus: 0,
        booking_bonus: 0,
        addon: 0,
      },
      updateErrorMessage: 'check constraint violation',
    })

    const result = await ownerSetDayCommission({
      id: VALID_UUID,
      baseCommission: 30,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('DB_ERROR')
    expect(result.message).toBe('check constraint violation')
  })

  test('NOT_FOUND when update returns no row (RLS reject or vanished)', async () => {
    setOwner()
    installMockClient({
      existing: {
        base_commission: 18,
        balm_bonus: 0,
        booking_bonus: 0,
        addon: 0,
      },
      updatedRow: null,
    })

    const result = await ownerSetDayCommission({
      id: VALID_UUID,
      baseCommission: 30,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('NOT_FOUND')
  })
})
