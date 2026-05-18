/**
 * salary-system-rebuild — `updateRoster` server action tests.
 *
 * Two callers share this action:
 *   - **Owner** — full create/update of any staff row (legacy path,
 *     used by the Roster Manager).
 *   - **Cashier** — INSERT-only, scoped to the cashier's own branch,
 *     `is_freelance = false`, `active = true`. Powers the
 *     "+ Add new staff" quick-add button in `<RosterPanel />`
 *     (task 16.7).
 *
 * The Supabase clients are mocked; no local Supabase is booted. The
 * mock store models the relevant slice of the `staff` table along
 * with the case-insensitive lookup that drives the duplicate check.
 *
 * Validates: Requirements 7.2, 7.3, 12.1, 12.2.
 */

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn(),
}))
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn(),
}))

import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { updateRoster } from './updateRoster'

const mockCreateServerClient = createServerClient as jest.MockedFunction<
  typeof createServerClient
>
const mockCreateServiceClient = createServiceClient as jest.MockedFunction<
  typeof createServiceClient
>

// ---------------------------------------------------------------------------
// Mock client factory
// ---------------------------------------------------------------------------

interface StaffRow {
  id: string
  name: string
  home_branch: string
  is_freelance: boolean
  active: boolean
  color: string
}

interface AuditEntry {
  event: string
  payload: Record<string, unknown>
  actor: string | null
}

interface MockSetup {
  user: string | null
  role?: string
  branchClaim?: string | null
  initialStaff?: StaffRow[]
  /** Force the upsert to fail with this error message. */
  upsertErrorMessage?: string
}

function makeMockClients(setup: MockSetup) {
  const staffStore = new Map<string, StaffRow>(
    (setup.initialStaff ?? []).map((row) => [row.name, row]),
  )
  const auditStore: AuditEntry[] = []

  const userClient = {
    auth: {
      getUser: () =>
        Promise.resolve({
          data: {
            user: setup.user
              ? {
                  id: setup.user,
                  app_metadata: {
                    role: setup.role ?? 'owner',
                    branch: setup.branchClaim,
                  },
                }
              : null,
          },
          error: setup.user ? null : { message: 'no user' },
        }),
    },
    from: (table: string) => {
      if (table !== 'staff') {
        throw new Error(`unexpected table on user client: ${table}`)
      }
      return {
        select: (_cols: string) => ({
          ilike: (_col: string, value: string) => {
            const pattern = value.toLowerCase()
            const rows = Array.from(staffStore.values()).filter(
              (r) => r.name.toLowerCase() === pattern,
            )
            return Promise.resolve({ data: rows, error: null })
          },
        }),
      }
    },
  }

  const serviceClient = {
    from: (table: string) => {
      if (table === 'audit_log') {
        return {
          insert: (entry: AuditEntry) => {
            auditStore.push(entry)
            return Promise.resolve({ error: null })
          },
        }
      }
      if (table === 'staff') {
        return {
          upsert: (
            payload: {
              name: string
              home_branch: string
              is_freelance: boolean
              active: boolean
              color: string
            },
            _opts: { onConflict?: string },
          ) => ({
            select: () => ({
              single: <T,>() => {
                if (setup.upsertErrorMessage) {
                  return Promise.resolve({
                    data: null as T | null,
                    error: { message: setup.upsertErrorMessage },
                  })
                }
                const existing = staffStore.get(payload.name)
                const row: StaffRow = {
                  id: existing?.id ?? `staff-${payload.name.toLowerCase()}`,
                  name: payload.name,
                  home_branch: payload.home_branch,
                  is_freelance: payload.is_freelance,
                  active: payload.active,
                  color: payload.color,
                }
                staffStore.set(payload.name, row)
                return Promise.resolve({
                  data: row as unknown as T,
                  error: null,
                })
              },
            }),
          }),
        }
      }
      throw new Error(`unexpected table on service client: ${table}`)
    },
  }

  return { userClient, serviceClient, staffStore, auditStore }
}

function installMocks(setup: MockSetup) {
  const { userClient, serviceClient, staffStore, auditStore } =
    makeMockClients(setup)
  mockCreateServerClient.mockReturnValue(userClient as never)
  mockCreateServiceClient.mockReturnValue(serviceClient as never)
  return { staffStore, auditStore }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks()
})

describe('updateRoster — auth gate', () => {
  test('UNAUTHENTICATED when no user session', async () => {
    const { staffStore } = installMocks({ user: null })
    const result = await updateRoster({
      name: 'NewGirl',
      homeBranch: 'Kimberry',
      isFreelance: false,
      active: true,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('UNAUTHENTICATED')
    expect(staffStore.size).toBe(0)
  })

  test('NOT_OWNER when role is unknown (e.g. boss_view)', async () => {
    const { staffStore } = installMocks({
      user: 'user-1',
      role: 'boss_view',
    })
    const result = await updateRoster({
      name: 'NewGirl',
      homeBranch: 'Kimberry',
      isFreelance: false,
      active: true,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('NOT_OWNER')
    expect(staffStore.size).toBe(0)
  })
})

describe('updateRoster — owner path', () => {
  test('owner can insert a new staff at any branch', async () => {
    const { staffStore, auditStore } = installMocks({
      user: 'owner-1',
      role: 'owner',
    })
    const result = await updateRoster({
      name: 'Beer',
      homeBranch: 'Bishop',
      isFreelance: false,
      active: true,
      color: '#abcdef',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.staff.name).toBe('Beer')
    expect(result.staff.homeBranch).toBe('Bishop')
    expect(staffStore.get('Beer')?.color).toBe('#abcdef')
    expect(auditStore[0]?.payload.action).toBe('insert')
  })

  test('owner can update an existing staff (case-exact match)', async () => {
    const { staffStore, auditStore } = installMocks({
      user: 'owner-1',
      role: 'owner',
      initialStaff: [
        {
          id: 'staff-beer',
          name: 'Beer',
          home_branch: 'Kimberry',
          is_freelance: false,
          active: true,
          color: '#94a3b8',
        },
      ],
    })
    const result = await updateRoster({
      name: 'Beer',
      homeBranch: 'Kimberry',
      isFreelance: false,
      active: false, // deactivate
      color: '#94a3b8',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.staff.active).toBe(false)
    expect(staffStore.get('Beer')?.active).toBe(false)
    expect(auditStore[0]?.payload.action).toBe('update')
  })

  test('DUPLICATE_STAFF when case differs from existing row', async () => {
    const { staffStore } = installMocks({
      user: 'owner-1',
      role: 'owner',
      initialStaff: [
        {
          id: 'staff-beer',
          name: 'Beer',
          home_branch: 'Kimberry',
          is_freelance: false,
          active: true,
          color: '#94a3b8',
        },
      ],
    })
    const result = await updateRoster({
      name: 'beer',
      homeBranch: 'Kimberry',
      isFreelance: false,
      active: true,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('DUPLICATE_STAFF')
    // Original row untouched.
    expect(staffStore.get('Beer')?.name).toBe('Beer')
  })
})

describe('updateRoster — cashier path (task 16.7)', () => {
  test('cashier with valid branch claim can insert a new staff', async () => {
    const { staffStore, auditStore } = installMocks({
      user: 'cashier-1',
      role: 'cashier',
      branchClaim: 'Kimberry',
    })
    const result = await updateRoster({
      name: 'NewGirl',
      homeBranch: 'Kimberry',
      isFreelance: false,
      active: true,
      color: '#ff8800',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.staff.name).toBe('NewGirl')
    expect(result.staff.homeBranch).toBe('Kimberry')
    expect(result.staff.isFreelance).toBe(false)
    expect(result.staff.active).toBe(true)
    expect(staffStore.get('NewGirl')).toBeTruthy()
    expect(auditStore[0]?.payload.action).toBe('insert')
    expect(auditStore[0]?.payload.actorRole).toBe('cashier')
  })

  test('cashier homeBranch is overridden by the JWT branch claim, not the payload', async () => {
    // Cashier signed in as Kimberry tries to register a staff at
    // Bishop. The action ignores the payload and forces homeBranch
    // back to the cashier's own branch.
    const { staffStore } = installMocks({
      user: 'cashier-1',
      role: 'cashier',
      branchClaim: 'Kimberry',
    })
    const result = await updateRoster({
      name: 'NewGirl',
      homeBranch: 'Bishop',
      isFreelance: false,
      active: true,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.staff.homeBranch).toBe('Kimberry')
    expect(staffStore.get('NewGirl')?.home_branch).toBe('Kimberry')
  })

  test('cashier isFreelance=true in payload is silently forced to false', async () => {
    const { staffStore } = installMocks({
      user: 'cashier-1',
      role: 'cashier',
      branchClaim: 'Kimberry',
    })
    const result = await updateRoster({
      name: 'NewGirl',
      homeBranch: 'Kimberry',
      isFreelance: true, // payload tries to mark as freelance
      active: true,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.staff.isFreelance).toBe(false)
    expect(staffStore.get('NewGirl')?.is_freelance).toBe(false)
  })

  test('cashier active=false in payload is silently forced to true', async () => {
    const { staffStore } = installMocks({
      user: 'cashier-1',
      role: 'cashier',
      branchClaim: 'Kimberry',
    })
    const result = await updateRoster({
      name: 'NewGirl',
      homeBranch: 'Kimberry',
      isFreelance: false,
      active: false, // payload tries to deactivate
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.staff.active).toBe(true)
    expect(staffStore.get('NewGirl')?.active).toBe(true)
  })

  test('cashier rejected when branch claim is missing or invalid', async () => {
    const { staffStore } = installMocks({
      user: 'cashier-1',
      role: 'cashier',
      branchClaim: null,
    })
    const result = await updateRoster({
      name: 'NewGirl',
      homeBranch: 'Kimberry',
      isFreelance: false,
      active: true,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('NOT_OWNER')
    expect(staffStore.size).toBe(0)
  })

  test('cashier cannot UPDATE an existing staff (case-exact match → DUPLICATE_STAFF)', async () => {
    // Even though the case-exact path would normally UPSERT, cashiers
    // are insert-only. A re-add of an existing name is rejected so
    // they cannot deactivate or re-home a staff via this route.
    const { staffStore } = installMocks({
      user: 'cashier-1',
      role: 'cashier',
      branchClaim: 'Kimberry',
      initialStaff: [
        {
          id: 'staff-beer',
          name: 'Beer',
          home_branch: 'Bishop',
          is_freelance: false,
          active: true,
          color: '#94a3b8',
        },
      ],
    })
    const result = await updateRoster({
      name: 'Beer',
      homeBranch: 'Kimberry',
      isFreelance: false,
      active: true,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('DUPLICATE_STAFF')
    // Original row untouched — homeBranch still Bishop.
    expect(staffStore.get('Beer')?.home_branch).toBe('Bishop')
  })

  test('cashier cannot collide with case-different existing staff', async () => {
    const { staffStore } = installMocks({
      user: 'cashier-1',
      role: 'cashier',
      branchClaim: 'Kimberry',
      initialStaff: [
        {
          id: 'staff-beer',
          name: 'Beer',
          home_branch: 'Kimberry',
          is_freelance: false,
          active: true,
          color: '#94a3b8',
        },
      ],
    })
    const result = await updateRoster({
      name: 'BEER',
      homeBranch: 'Kimberry',
      isFreelance: false,
      active: true,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('DUPLICATE_STAFF')
    expect(staffStore.size).toBe(1)
  })
})

describe('updateRoster — input validation', () => {
  test('INVALID_INPUT when name is empty', async () => {
    const { staffStore } = installMocks({
      user: 'owner-1',
      role: 'owner',
    })
    const result = await updateRoster({
      name: '',
      homeBranch: 'Kimberry',
      isFreelance: false,
      active: true,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('INVALID_INPUT')
    expect(staffStore.size).toBe(0)
  })

  test('INVALID_INPUT when homeBranch is not a known enum', async () => {
    const { staffStore } = installMocks({
      user: 'owner-1',
      role: 'owner',
    })
    const result = await updateRoster({
      name: 'NewGirl',
      homeBranch: 'Atlantis',
      isFreelance: false,
      active: true,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('INVALID_INPUT')
    expect(staffStore.size).toBe(0)
  })

  test('INVALID_INPUT when color is malformed', async () => {
    const { staffStore } = installMocks({
      user: 'owner-1',
      role: 'owner',
    })
    const result = await updateRoster({
      name: 'NewGirl',
      homeBranch: 'Kimberry',
      isFreelance: false,
      active: true,
      color: 'red',
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('INVALID_INPUT')
    expect(staffStore.size).toBe(0)
  })
})

describe('updateRoster — DB error path', () => {
  test('owner upsert error returns DB_ERROR and skips audit_log', async () => {
    const { staffStore, auditStore } = installMocks({
      user: 'owner-1',
      role: 'owner',
      upsertErrorMessage: 'simulated db failure',
    })
    const result = await updateRoster({
      name: 'NewGirl',
      homeBranch: 'Kimberry',
      isFreelance: false,
      active: true,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('DB_ERROR')
    expect(result.message).toBe('simulated db failure')
    expect(staffStore.size).toBe(0)
    expect(auditStore).toHaveLength(0)
  })
})
