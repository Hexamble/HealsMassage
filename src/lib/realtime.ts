// Realtime stub.
//
// The original `subscribeCashier` / `subscribeOwner` / `usePostgresChanges`
// implementation pulled in `@supabase/realtime-js` which carried a heavy
// WebSocket runtime and an unbounded exponential-backoff reconnect loop.
// Combined with the `CashierContext` retry handlers it produced
// memory leaks that crashed the Vercel/Render Node process under load
// ("instance was killed because it ran out of available memory").
//
// We do NOT need realtime for the shop's actual workflow:
//   - Each cashier writes only to their own branch.
//   - The owner can press the "Refresh" button on Boss HQ to re-pull.
//   - Background revalidation is handled by Next's `revalidatePath` after
//     every server action, so panels reflect the latest writes on the
//     cashier's own machine without any websocket.
//
// This file remains exported for type compatibility with old imports
// (`ConnectionState`, `RealtimeStatus`, etc.). The factories return inert
// no-op handles that never open a socket and never schedule a reconnect.

export type ConnectionState = 'connected' | 'connecting' | 'disconnected'
export type RealtimeStatus = 'connected' | 'reconnecting' | 'disconnected'

export interface RealtimeChangeEvent {
  type: 'INSERT' | 'UPDATE' | 'DELETE'
  new?: Record<string, unknown>
  old?: Record<string, unknown>
}

export interface SubscriptionHandle {
  unsubscribe(): void
  getConnectionState(): ConnectionState
  onStateChange(cb: (state: ConnectionState) => void): () => void
  onResync(cb: () => void): () => void
}

interface AnyHandlers {
  onTransaction?: (event: RealtimeChangeEvent) => void
  onExpense?: (event: RealtimeChangeEvent) => void
  onRoster?: (event: RealtimeChangeEvent) => void
  onStaff?: (event: RealtimeChangeEvent) => void
  onResync?: () => void
}

function inertHandle(): SubscriptionHandle {
  return {
    unsubscribe() {},
    getConnectionState: () => 'connected' as const,
    onStateChange: () => () => {},
    onResync: () => () => {},
  }
}

export function subscribeCashier(
  _branch: string,
  _handlers: AnyHandlers,
): SubscriptionHandle {
  return inertHandle()
}

export function subscribeOwner(_handlers: AnyHandlers): SubscriptionHandle {
  return inertHandle()
}
