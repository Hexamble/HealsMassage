/**
 * heals-system-rebuild — `ownerDeleteTransaction` server action tests
 * (task 7.6).
 *
 * The heals contract migrated this action from the salary-system spec
 * into a thin wrapper around {@link deleteTransaction} that adds a
 * downstream `resnapshotDay` recalculation step. Tests therefore mock
 * the two delegate actions plus `getCurrentProfile`/the server
 * Supabase client and assert:
 *
 *   1. owner deleting by `{ rowId }` succeeds and triggers
 *      `resnapshotDay` for the parsed business date
 *   2. owner deleting by `{ id }` succeeds and triggers
 *      `resnapshotDay` for the row's looked-up business date
 *   3. non-owner role rejected with `NOT_OWNER` before any delete
 *   4. unauthenticated caller rejected with `UNAUTHENTICATED`
 *   5. malformed `rowId` rejected with `INVALID_INPUT`
 *   6. delete failure surfaces as the underlying error code without
 *      attempting recalculation
 *   7. when delete succeeds but `resnapshotDay` fails, the action
 *      still returns `ok: true` plus a `warning` field per Req 13.3
 *   8. when `resnapshotDay` throws unexpectedly, the action still
 *      returns `ok: true` with a generic warning per Req 13.3
 */

jest.mock('@/lib/profile', () => ({
  getCurrentProfile: jest.fn(),
}))
jest.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: jest.fn(),
  // legacy alias kept for any callers still importing the old name
  createServerClient: jest.fn(),
}))
jest.mock('./deleteTransaction', () => ({
  deleteTransaction: jest.fn(),
}))
jest.mock('./resnapshotDay', () => ({
  resnapshotDay: jest.fn(),
}))

import { getCurrentProfile } from '@/lib/profile'
import { createServerSupabaseClient } from '@/lib/supabase/server'

import { deleteTransaction } from './deleteTransaction'
import { resnapshotDay } from './resnapshotDay'
import { ownerDeleteTransaction } from './ownerDeleteTransaction'

const mockGetCurrentProfile = getCurrentProfile as jest.MockedFunction<
  typeof getCurrentProfile
>
const mockCreateServerSupabaseClient =
  createServerSupabaseClient as jest.MockedFunction<
    typeof createServerSupabaseClient
  >
const mockDeleteTransaction = deleteTransaction as jest.MockedFunction<
  typeof deleteTransaction
>
const mockResnapshotDay = resnapshotDay as jest.MockedFunction<
  typeof resnapshotDay
>

beforeEach(() => {
  jest.clearAllMocks()
  // Default: server client is unused unless a test asks for the `{id}`
  // path; install a throwing mock so accidental usage is loud.
  mockCreateServerSupabaseClient.mockReturnValue({
    from: () => {
      throw new Error('unexpected server-client access')
    },
  } as never)
})

function setOwner() {
  mockGetCurrentProfile.mockResolvedValue({
    userId: 'owner-1',
    role: 'owner',
    branch: null,
    displayName: 'Owner',
  })
}

describe('ownerDeleteTransaction', () => {
  test('owner deleting by rowId succeeds and triggers resnapshotDay', async () => {
    setOwner()
    mockDeleteTransaction.mockResolvedValue({ ok: true })
    mockResnapshotDay.mockResolvedValue({
      ok: true,
      businessDate: '2026-04-15',
      branch: null,
      checkedRows: 0,
      warnings: [],
    })

    const result = await ownerDeleteTransaction({
      rowId: 'Kimberry|2026-04-15|7',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.businessDate).toBe('2026-04-15')
    expect(result.warning).toBeUndefined()

    expect(mockDeleteTransaction).toHaveBeenCalledWith({
      rowId: 'Kimberry|2026-04-15|7',
    })
    expect(mockResnapshotDay).toHaveBeenCalledWith({
      businessDate: '2026-04-15',
    })
  })

  test('owner deleting by { id } looks up business_date and triggers resnapshotDay', async () => {
    setOwner()
    mockDeleteTransaction.mockResolvedValue({ ok: true })
    mockResnapshotDay.mockResolvedValue({
      ok: true,
      businessDate: '2026-03-01',
      branch: null,
      checkedRows: 0,
      warnings: [],
    })

    // Stub the SELECT(business_date).eq('id', …).maybeSingle() chain.
    mockCreateServerSupabaseClient.mockReturnValue({
      from: (table: string) => {
        if (table !== 'transactions') {
          throw new Error(`unexpected table: ${table}`)
        }
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { business_date: '2026-03-01' },
                  error: null,
                }),
            }),
          }),
        }
      },
    } as never)

    const id = '11111111-2222-3333-4444-555555555555'
    const result = await ownerDeleteTransaction({ id })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.businessDate).toBe('2026-03-01')

    expect(mockDeleteTransaction).toHaveBeenCalledWith({ id })
    expect(mockResnapshotDay).toHaveBeenCalledWith({
      businessDate: '2026-03-01',
    })
  })

  test('{ id } payload returns NOT_FOUND when the row is missing', async () => {
    setOwner()
    mockCreateServerSupabaseClient.mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
      }),
    } as never)

    const result = await ownerDeleteTransaction({
      id: '11111111-2222-3333-4444-555555555555',
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('NOT_FOUND')
    expect(mockDeleteTransaction).not.toHaveBeenCalled()
    expect(mockResnapshotDay).not.toHaveBeenCalled()
  })

  test('non-owner role rejected with NOT_OWNER before any delete', async () => {
    mockGetCurrentProfile.mockResolvedValue({
      userId: 'cashier-1',
      role: 'cashier',
      branch: 'Kimberry',
      displayName: 'Cashier',
    })

    const result = await ownerDeleteTransaction({
      rowId: 'Kimberry|2026-04-15|7',
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('NOT_OWNER')
    expect(mockDeleteTransaction).not.toHaveBeenCalled()
    expect(mockResnapshotDay).not.toHaveBeenCalled()
  })

  test('unauthenticated caller rejected with UNAUTHENTICATED', async () => {
    mockGetCurrentProfile.mockResolvedValue(null)

    const result = await ownerDeleteTransaction({
      rowId: 'Kimberry|2026-04-15|7',
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('UNAUTHENTICATED')
    expect(mockDeleteTransaction).not.toHaveBeenCalled()
    expect(mockResnapshotDay).not.toHaveBeenCalled()
  })

  test('malformed rowId rejected with INVALID_INPUT', async () => {
    setOwner()

    const result = await ownerDeleteTransaction({ rowId: 'not-a-row-id' })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('INVALID_INPUT')
    expect(mockDeleteTransaction).not.toHaveBeenCalled()
    expect(mockResnapshotDay).not.toHaveBeenCalled()
  })

  test('missing rowId/id rejected with INVALID_INPUT', async () => {
    setOwner()

    const result = await ownerDeleteTransaction({})

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('INVALID_INPUT')
    expect(mockDeleteTransaction).not.toHaveBeenCalled()
  })

  test('delete failure surfaces underlying code and skips recalc', async () => {
    setOwner()
    mockDeleteTransaction.mockResolvedValue({
      ok: false,
      code: 'NOT_FOUND',
      message: 'Transaction not found',
    })

    const result = await ownerDeleteTransaction({
      rowId: 'Kimberry|2026-04-15|999',
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('NOT_FOUND')
    expect(mockResnapshotDay).not.toHaveBeenCalled()
  })

  test('delete OK but resnapshotDay returns error → ok: true with warning (Req 13.3)', async () => {
    setOwner()
    mockDeleteTransaction.mockResolvedValue({ ok: true })
    mockResnapshotDay.mockResolvedValue({
      ok: false,
      code: 'DB_ERROR',
      message: 'snapshot rpc failed',
    })

    // Silence the warn that the action emits on the recalc-failure path.
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await ownerDeleteTransaction({
      rowId: 'Bishop|2026-04-15|3',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.businessDate).toBe('2026-04-15')
    expect(result.warning).toMatch(/recalculation failed/i)
    expect(result.warning).toMatch(/snapshot rpc failed/)

    warnSpy.mockRestore()
  })

  test('delete OK but resnapshotDay throws → ok: true with generic warning (Req 13.3)', async () => {
    setOwner()
    mockDeleteTransaction.mockResolvedValue({ ok: true })
    mockResnapshotDay.mockRejectedValue(new Error('unexpected'))

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await ownerDeleteTransaction({
      rowId: 'Chulia|2026-04-15|11',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warning).toMatch(/unexpected error/i)

    warnSpy.mockRestore()
  })
})
