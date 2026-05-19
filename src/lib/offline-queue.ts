'use client'

// Offline queue stub.
//
// The original IndexedDB-backed queue caused memory leaks and added
// complexity that wasn't needed for the shop's workflow. Replaced with
// no-ops so existing imports compile without changes.

export type PendingWriteKind = 'transaction' | 'expense'

export interface PendingWrite {
  id: string
  kind: PendingWriteKind
  payload: Record<string, unknown>
  createdAt: string
  retries: number
  lastError?: string
  nextRetryAt?: number
}

export async function enqueue(_entry: PendingWrite): Promise<void> {}
export async function dequeue(_id: string): Promise<void> {}
export async function getAll(): Promise<PendingWrite[]> { return [] }
export async function getCount(): Promise<number> { return 0 }
export async function clear(): Promise<void> {}
export function __resetForTests(): void {}
