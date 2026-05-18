'use client'

/**
 * heals-system-rebuild — IndexedDB-backed offline write queue (task 6.10).
 *
 * The cashier POS records every transaction and expense through a server
 * action. When the device is offline (or the action fails for a
 * retryable reason) we cannot drop the write — the iPad isn't the
 * source of truth, but we also can't lose what the cashier just typed.
 * So pending writes get serialized into IndexedDB keyed on the row's
 * idempotency identifier and a background drain replays them when the
 * network comes back.
 *
 * Storage layout:
 *   - Database: `heals-cashier-offline` (version 1)
 *   - Object store: `pending-writes`, keyPath `id`
 *   - Index: `createdAt` (so `getAll()` can return FIFO order)
 *   - One record per pending write: { id, kind, payload, createdAt,
 *     retries, lastError? }
 *
 * Idempotency: `id` carries the conflict key (the transaction `row_id`
 * for transactions, or the expense `uuid` for expenses). Re-enqueueing
 * the same `id` overwrites the previous entry — the latest payload
 * always wins. The server action upserts on the same key, so replaying
 * a write that already landed is a safe no-op.
 *
 * Browser-only: every public helper rejects with a clear error when
 * called server-side (or in any environment without `indexedDB`). The
 * cashier UI is the only caller; SSR paths must not import this module
 * at runtime.
 *
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5.
 *
 * See `c:/BILL/.kiro/specs/heals-system-rebuild/design.md`
 *     §"Offline Support (Cashier Only)".
 */

import { openDB, type IDBPDatabase } from 'idb'

const DB_NAME = 'heals-cashier-offline'
const STORE = 'pending-writes'
const INDEX_CREATED_AT = 'createdAt'
const VERSION = 1

export type PendingWriteKind = 'transaction' | 'expense'

export interface PendingWrite {
  /** Idempotency key. `row_id` for transactions, uuid for expenses. */
  id: string
  /** Discriminator for which server action should drain this entry. */
  kind: PendingWriteKind
  /** Server-action input — opaque to the queue itself. */
  payload: Record<string, unknown>
  /** ISO timestamp; FIFO ordering uses this via the `createdAt` index. */
  createdAt: string
  /** Replay attempts so far; bumped by the drain loop on retryable errors. */
  retries: number
  /** Most recent error message; cleared by callers when re-enqueueing fresh. */
  lastError?: string
  /**
   * Earliest epoch-ms at which the drain loop should retry this entry
   * (per-entry exponential backoff). Persisted so the cooldown survives
   * reloads. Absent or <= now means "ready now". Set by the offline-sync
   * worker after a retryable failure.
   */
  nextRetryAt?: number
}

let dbPromise: Promise<IDBPDatabase> | null = null

/**
 * Open (and lazily upgrade) the queue database. Cached so concurrent
 * callers share a single connection. Rejects when called outside the
 * browser — IndexedDB doesn't exist on the server.
 */
function getDb(): Promise<IDBPDatabase> {
  // Browser-only: production callers always hit a real `indexedDB`.
  // The `'use client'` directive guarantees this module is excluded
  // from the SSR bundle, so the only environment without `indexedDB`
  // is one we explicitly opt into (e.g. tests that haven't installed
  // a polyfill — those should fail loudly, which they do).
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('offline-queue is browser-only'))
  }
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' })
          store.createIndex(INDEX_CREATED_AT, 'createdAt')
        }
      },
    })
  }
  return dbPromise
}

/**
 * Reset the cached connection. Tests use this to drop the handle after
 * `indexedDB.deleteDatabase` so a subsequent `getDb()` opens cleanly.
 * Not exported on the public surface — tests reach it via `clear()`.
 */
function resetDbCache(): void {
  dbPromise = null
}

/**
 * Persist a pending write. Upserts on `id`, so re-enqueueing the same
 * row replaces the previous entry. The drain loop reads `retries` and
 * `lastError` off the stored record, so callers updating those fields
 * (after a failed replay attempt) re-enqueue with the bumped values.
 */
export async function enqueue(entry: PendingWrite): Promise<void> {
  const db = await getDb()
  await db.put(STORE, entry)
}

/**
 * Remove a pending write — used by the drain loop after a successful
 * replay, or after a terminal validation error that retrying cannot
 * fix. Missing keys are silently no-op (idb's delete is forgiving).
 */
export async function dequeue(id: string): Promise<void> {
  const db = await getDb()
  await db.delete(STORE, id)
}

/**
 * Return every pending write in FIFO order (oldest first). Ordering is
 * derived from the `createdAt` index, not insertion order, so re-queued
 * entries (same id, refreshed `createdAt`) move to the back of the
 * queue if they need to.
 */
export async function getAll(): Promise<PendingWrite[]> {
  const db = await getDb()
  const rows = (await db.getAllFromIndex(STORE, INDEX_CREATED_AT)) as PendingWrite[]
  return rows
}

/**
 * Count pending writes — used by the "Pending sync (N)" badge.
 */
export async function getCount(): Promise<number> {
  const db = await getDb()
  return db.count(STORE)
}

/**
 * Drain every pending write. Intended for tests and for explicit user
 * actions ("clear queue") — the drain loop never calls this.
 */
export async function clear(): Promise<void> {
  const db = await getDb()
  await db.clear(STORE)
}

/**
 * Test-only escape hatch: drop the cached connection so a subsequent
 * call opens a fresh handle. Pairs with `indexedDB.deleteDatabase`
 * inside test setup to guarantee isolation across test cases.
 */
export function __resetForTests(): void {
  resetDbCache()
}
