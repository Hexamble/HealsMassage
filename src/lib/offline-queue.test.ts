/**
 * heals-system-rebuild — offline-queue unit tests (task 6.10).
 *
 * Validates: Requirements 7.1, 7.2, 7.5 (FIFO ordering, idempotent
 *            row id keying, persistence wiring).
 *
 * `fake-indexeddb/auto` installs a process-wide IndexedDB before any
 * import, so the module under test sees a working `indexedDB` global
 * even though it imports under the `'use client'` directive.
 */
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'

import {
  enqueue,
  dequeue,
  getAll,
  getCount,
  clear,
  __resetForTests,
  type PendingWrite,
} from './offline-queue'

/**
 * Reset the IndexedDB instance between tests so cached state never
 * leaks across cases. Replacing `globalThis.indexedDB` with a fresh
 * factory is faster (and more reliable) than calling `clear()` and
 * trusting transactions complete.
 */
function resetIDB(): void {
  ;(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory()
  __resetForTests()
}

function makeEntry(overrides: Partial<PendingWrite> = {}): PendingWrite {
  return {
    id: 'Kimberry|2026-05-15|1',
    kind: 'transaction',
    payload: { staff: 'Beer', course: 'FR', duration: 60 },
    createdAt: new Date('2026-05-15T05:00:00.000Z').toISOString(),
    retries: 0,
    ...overrides,
  }
}

describe('offline-queue', () => {
  beforeEach(() => {
    resetIDB()
  })

  it('enqueue persists a row that getAll returns', async () => {
    const entry = makeEntry()
    await enqueue(entry)

    const rows = await getAll()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual(entry)
  })

  it('enqueue is idempotent on the same id (upsert overwrites)', async () => {
    const id = 'Bishop|2026-05-15|7'
    await enqueue(makeEntry({ id, payload: { staff: 'Lin' } }))
    await enqueue(
      makeEntry({
        id,
        payload: { staff: 'Nana' },
        retries: 2,
        lastError: 'network down',
      }),
    )

    const rows = await getAll()
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(id)
    expect(rows[0].payload).toEqual({ staff: 'Nana' })
    expect(rows[0].retries).toBe(2)
    expect(rows[0].lastError).toBe('network down')
  })

  it('getAll returns rows in FIFO order by createdAt', async () => {
    // Intentionally insert out of chronological order to prove the
    // ordering comes from the `createdAt` index, not insertion order.
    await enqueue(
      makeEntry({
        id: 'a',
        createdAt: new Date('2026-05-15T05:30:00.000Z').toISOString(),
      }),
    )
    await enqueue(
      makeEntry({
        id: 'b',
        createdAt: new Date('2026-05-15T05:00:00.000Z').toISOString(),
      }),
    )
    await enqueue(
      makeEntry({
        id: 'c',
        createdAt: new Date('2026-05-15T05:15:00.000Z').toISOString(),
      }),
    )

    const rows = await getAll()
    expect(rows.map((r) => r.id)).toEqual(['b', 'c', 'a'])
  })

  it('dequeue removes one row and leaves the rest intact', async () => {
    await enqueue(
      makeEntry({
        id: 'r1',
        createdAt: new Date('2026-05-15T05:00:00.000Z').toISOString(),
      }),
    )
    await enqueue(
      makeEntry({
        id: 'r2',
        createdAt: new Date('2026-05-15T05:10:00.000Z').toISOString(),
      }),
    )
    await enqueue(
      makeEntry({
        id: 'r3',
        createdAt: new Date('2026-05-15T05:20:00.000Z').toISOString(),
      }),
    )

    await dequeue('r2')

    const rows = await getAll()
    expect(rows.map((r) => r.id)).toEqual(['r1', 'r3'])
  })

  it('dequeue is a no-op when the id does not exist', async () => {
    await enqueue(makeEntry({ id: 'r1' }))
    await expect(dequeue('does-not-exist')).resolves.toBeUndefined()
    expect(await getCount()).toBe(1)
  })

  it('getCount tracks enqueue and dequeue accurately', async () => {
    expect(await getCount()).toBe(0)

    await enqueue(makeEntry({ id: 'x1' }))
    await enqueue(makeEntry({ id: 'x2' }))
    await enqueue(makeEntry({ id: 'x3' }))
    expect(await getCount()).toBe(3)

    await dequeue('x2')
    expect(await getCount()).toBe(2)

    // Re-enqueue at same id — count stays the same.
    await enqueue(makeEntry({ id: 'x1', retries: 1 }))
    expect(await getCount()).toBe(2)
  })

  it('handles both transaction and expense kinds', async () => {
    await enqueue(
      makeEntry({
        id: 'Kimberry|2026-05-15|1',
        kind: 'transaction',
        createdAt: new Date('2026-05-15T05:00:00.000Z').toISOString(),
      }),
    )
    await enqueue(
      makeEntry({
        id: '7c4f2a91-9d3a-4e07-9e0a-3a9fdf2d6a01',
        kind: 'expense',
        payload: { item: 'Bills', amount: 50 },
        createdAt: new Date('2026-05-15T05:05:00.000Z').toISOString(),
      }),
    )

    const rows = await getAll()
    expect(rows).toHaveLength(2)
    expect(rows[0].kind).toBe('transaction')
    expect(rows[1].kind).toBe('expense')
    expect(rows[1].payload).toEqual({ item: 'Bills', amount: 50 })
  })

  it('clear empties the store', async () => {
    await enqueue(makeEntry({ id: 'a' }))
    await enqueue(makeEntry({ id: 'b' }))
    expect(await getCount()).toBe(2)

    await clear()
    expect(await getCount()).toBe(0)
    expect(await getAll()).toEqual([])
  })
})
