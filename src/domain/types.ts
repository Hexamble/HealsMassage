/**
 * Shared domain types for the Heals system rebuild.
 *
 * Single source of truth for the cross-module type surface declared in
 * `c:/BILL/.kiro/specs/heals-system-rebuild/design.md` §"Components and
 * Interfaces" → §"Domain Layer". Everything here is a pure type / const
 * declaration with no runtime dependencies — safe to import from any
 * client, server, or domain file without pulling I/O into the bundle.
 *
 * The file is organised top-down by dependency:
 *
 *   1. Enum-style literal unions: `Branch`, `Course`, `Duration`,
 *      `PaymentMethod`, `TransactionMethod`.
 *   2. Branch code constants and the `BRANCH_TO_EXTRA` / `BRANCH_TO_OFFSET`
 *      maps used by the auto-mirror logic in `writeTransaction`.
 *   3. Persisted-row shapes: `TransactionRow`, `ExpenseRow`, `StaffMember`.
 *   4. Domain calculation contracts: `CommissionInput`, `CommissionResult`,
 *      `DayBranchIncome`, `StaffQueueStatus`, `Cycle`, `Settings`.
 *
 * Validates: Requirement 20.1 (single source-of-truth schema; consistent
 * types across cashier, salary, income, queue, and reporting modules).
 *
 * Notes for downstream module authors:
 *   - When `commission.ts`, `salary-board.ts`, `income-board.ts`, etc. are
 *     migrated to the rebuild contract, replace any locally-declared
 *     `Branch`, `Course`, `Duration`, etc. with imports from this file.
 *   - Existing legacy modules (e.g. the salary-system-rebuild
 *     `salary-board.ts`) intentionally still declare their own
 *     `TransactionRow` shape — those migrate later via separate tasks.
 */

// ---------------------------------------------------------------------------
// 1. Enum-style literal unions
// ---------------------------------------------------------------------------

/**
 * Canonical branch codes used everywhere in the system. Stored verbatim
 * in the `branch` column of `transactions`, `expenses`, `daily_roster`,
 * and `staff` (see schema in design.md §"Table Definitions").
 */
export const BRANCHES = ['Kimberry', 'Bishop', 'Chulia'] as const
export type Branch = (typeof BRANCHES)[number]

/**
 * Massage course codes. Order is the cashier-form display order from
 * Requirement 2.1. The trio `PBA` / `PBAC` and the `PT*` / `PA*` /
 * `PH*` family are grouped to match the legacy spreadsheet layout.
 */
export const COURSES = [
  'FR',
  'HS',
  'FNS',
  'BMT',
  'BAT',
  'DTM',
  'THC',
  'HOM',
  'PBA',
  'PBAC',
  'EAR',
  'PTF',
  'PAF',
  'PHL',
  'PHT',
] as const
export type Course = (typeof COURSES)[number]

/**
 * Allowed session durations in minutes (Requirement 2.1, schema CHECK
 * constraint in `transactions.duration`). These are the only values the
 * commission rate tables and price tables key on.
 */
export const DURATIONS = [30, 60, 90, 120] as const
export type Duration = (typeof DURATIONS)[number]

/**
 * Payment method enum used by the cashier session form for real
 * transactions (CASH / QR / CREDIT). Expense rows additionally accept
 * `'Other'`; that variant is encoded on `ExpenseRow.method` directly.
 *
 * `PaymentMethod` deliberately does NOT include `'Freelance'` or any
 * `EXTRA *` value — those belong on `TransactionMethod` (see below).
 */
export const PAYMENT_METHODS = ['CASH', 'QR', 'CREDIT'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

/**
 * Full enum of method values that can appear on a `TransactionRow`.
 * `Freelance` marks an ad-hoc freelancer's session (paid separately,
 * excluded from the salary board per Requirement 18.2). The three
 * `EXTRA *` values mark a staff member working at a different branch
 * (Requirement 5.1); `EXTRA KM` → Kimberry, `EXTRA BS` → Bishop,
 * `EXTRA CL` → Chulia.
 *
 * Cashiers may type minor case/whitespace variants (`extra-cl`,
 * `EXTRA  CHU`, etc.); decoders in `extra.ts` normalise on read while
 * write paths persist the canonical strings declared here.
 */
export const TRANSACTION_METHODS = [
  'CASH',
  'QR',
  'CREDIT',
  'Freelance',
  'EXTRA KM',
  'EXTRA BS',
  'EXTRA CL',
] as const
export type TransactionMethod = (typeof TRANSACTION_METHODS)[number]

// ---------------------------------------------------------------------------
// 2. Branch code constants + auto-mirror offset maps
// ---------------------------------------------------------------------------

/**
 * Two-letter branch codes used inside `EXTRA *` method strings.
 * Useful for writing canonical EXTRA values from a source `Branch`
 * without hardcoding the trailing string at call sites.
 */
export const BRANCH_CODES = {
  Kimberry: 'KM',
  Bishop: 'BS',
  Chulia: 'CL',
} as const satisfies Record<Branch, string>

/**
 * Map from a source branch (where the real customer payment was logged)
 * to the canonical EXTRA method written to its mirror row at the staff's
 * home branch. Source: design.md §"Implementation: Server-Side Hook in
 * writeTransaction".
 */
export const BRANCH_TO_EXTRA = {
  Kimberry: 'EXTRA KM',
  Bishop: 'EXTRA BS',
  Chulia: 'EXTRA CL',
} as const satisfies Record<Branch, 'EXTRA KM' | 'EXTRA BS' | 'EXTRA CL'>

/**
 * Per-source-branch row-number offset added to mirror sentinels so two
 * branches mirroring to the same home branch on the same business date
 * cannot collide on `(branch, business_date, cashier_row_number)`.
 *
 * Bands (from design.md):
 *   Kimberry → 0
 *   Bishop   → 1000
 *   Chulia   → 2000
 *
 * The mirror sentinel is `100_000 + sourceRowNum + BRANCH_TO_OFFSET[src]`,
 * placing every mirror in the 100_000+ band well clear of cashier-typed
 * row numbers (sequential from 1 per branch+date).
 */
export const BRANCH_TO_OFFSET = {
  Kimberry: 0,
  Bishop: 1000,
  Chulia: 2000,
} as const satisfies Record<Branch, number>

// ---------------------------------------------------------------------------
// 3. Persisted-row shapes
// ---------------------------------------------------------------------------

/**
 * In-memory shape of a row from the `transactions` table. Mirrors the
 * column set defined in design.md §"`transactions`" with camelCase keys
 * for the TS layer. Per Requirement 20.7, `totalCommission === base +
 * balm + book + addon` is enforced by a DB CHECK constraint AND by the
 * commission compute path, so this type does not encode the invariant
 * structurally.
 *
 * `method` is typed as `string` (not `TransactionMethod`) because raw
 * cashier-typed EXTRA variants such as `'extra-cl'` may pass through
 * the read path before normalisation; the canonical form is enforced
 * on write only. Decoders in `extra.ts` consume the raw string.
 */
export interface TransactionRow {
  /** Database UUID primary key. */
  id: string
  branch: Branch
  /** Business date (`yyyy-MM-dd`), 5 AM Asia/Kuala_Lumpur cutoff. */
  businessDate: string
  /** Sequential per (branch, business_date), used to build `row_id`. */
  cashierRowNumber: number
  /** Staff display name as stored — see Requirement 2.10 normalisation. */
  staff: string
  course: Course
  duration: Duration
  /** `HH:mm` 24h time the session started, or `null` if not recorded. */
  timeIn: string | null
  /** `HH:mm` 24h time the session ended, or `null` if not recorded. */
  timeOut: string | null
  /** Canonical method or raw cashier variant (see field-level note above). */
  method: string
  addon: number
  baseCommission: number
  balmBonus: number
  bookingBonus: number
  totalCommission: number
  cash: number
  qr: number
  credit: number
  price: number
  /** Free-form flag string (e.g. `'staff_balm'`, `'booking'`). */
  flags: string
  comment: string
  createdAt: string
  updatedAt: string
  createdBy: string | null
}

/**
 * In-memory shape of a row from the `expenses` table. Source design.md
 * §"`expenses`". `source` distinguishes cashier-entered expenses (Req
 * 17.1, 17.2) from owner-added ones (Req 17.4).
 */
export interface ExpenseRow {
  id: string
  branch: Branch
  businessDate: string
  item: string
  amount: number
  method: PaymentMethod | 'Other'
  note: string
  source: 'Cashier' | 'Manual'
  createdAt: string
  createdBy: string | null
}

/**
 * Roster entry (the `staff` table). `homeBranch` drives where the staff
 * is shown on the salary board (Req 9.1, 14.2); `isFreelance` excludes
 * the staff from per-branch and multi-branch sections (Req 18.2);
 * `isActive` controls visibility in cashier dropdowns without losing
 * historical data (Req 14.3, 14.4).
 */
export interface StaffMember {
  id: string
  name: string
  homeBranch: Branch
  isFreelance: boolean
  isActive: boolean
}

// ---------------------------------------------------------------------------
// 4. Domain calculation contracts
// ---------------------------------------------------------------------------

// `CommissionInput`, `CommissionResult`, and the rate/price-table types
// are owned by `./commission.ts` (see task 4.1 in
// `c:/BILL/.kiro/specs/heals-system-rebuild/tasks.md`). Importers should
// pull them from there rather than re-declaring here.

/**
 * Per (branch × business_date) financial roll-up rendered by the Shop
 * Income Board. Source design.md §"Income Board Computation".
 *
 *   sales       = Σ price for non-freelance transactions
 *   collected   = cash + qr
 *   netIncome   = collected − freelance − expenses
 *   sessions    = count of non-freelance transactions
 *
 * EXTRA rows have `price = 0` by DB constraint, so they contribute zero
 * to `sales` (Req 11.5). Freelance rows are excluded from `sales` and
 * `sessions`; their commissions are summed separately into `freelance`.
 */
export interface DayBranchIncome {
  sales: number
  cash: number
  qr: number
  credit: number
  collected: number
  freelance: number
  expenses: number
  netIncome: number
  sessions: number
}

/**
 * One staff member's live-queue status. Source design.md §"Queue Board
 * Computation". `minutesRemaining` and `currentCourse` are populated
 * only when `status === 'busy'`; they are `null` for free staff.
 */
export interface StaffQueueStatus {
  staffName: string
  status: 'busy' | 'free'
  minutesRemaining: number | null
  currentCourse: Course | null
}

/**
 * Pay cycle window. `monthIdx` is 0-based and labels the month the
 * cycle ENDS in (design.md §"Pay Cycle"). `days` is a contiguous
 * `yyyy-MM-dd` list from `startDate` to `endDate` inclusive — no gaps,
 * no duplicates (Property 7).
 */
export interface Cycle {
  monthIdx: number
  year: number
  startDate: string
  endDate: string
  /**
   * Contiguous list of `yyyy-MM-dd` strings from `startDate` to `endDate`
   * inclusive — no gaps, no duplicates. Mutable to match the salary-board
   * grid props (which spread / map over the array directly).
   */
  days: string[]
}

/**
 * In-memory view of the application's `settings` table (key/value
 * JSONB). Each property maps to a single `settings.key` row.
 *
 * Fields are optional because the rebuild seeds defaults (Req 10.3
 * for `payCycleStartDay = 21`; Req 19.x for theming) but the table
 * itself is sparse: a missing key means "use the application
 * default" rather than an error.
 */
export interface Settings {
  /** Pay cycle start day (1-28). Req 10.1, 10.3. */
  payCycleStartDay?: number
  /** Per-branch theme overrides keyed by `Branch`. Req 19.1, 19.2, 19.3. */
  branchThemes?: Readonly<Record<Branch, BranchThemeSetting>>
}

/**
 * Owner-editable subset of a `BranchTheme`. The full theme (CSS class
 * name, etc.) lives in `lib/theming.ts`; this is what the owner can
 * override via `setTheme`.
 */
export interface BranchThemeSetting {
  primary: string
  accent: string
}
