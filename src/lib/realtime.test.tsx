// salary-system-rebuild — Heals Thai Massage POS
// Unit tests for the `usePostgresChanges` hook (Task 7.1).
//
// Strategy: mock `@/lib/supabase/browser` so we can inject a stub channel
// that exposes hooks for triggering subscribe-status callbacks and
// emitting payload events. This keeps the tests pure and offline.

/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { act, render } from '@testing-library/react'
import {
  usePostgresChanges,
  type PostgresChangesPayload,
  type RealtimeStatus,
} from './realtime'

// --- Mock Supabase browser client -----------------------------------------

type SubscribeCb = (status: string) => void
type EventCb = (payload: PostgresChangesPayload) => void

interface StubChannel {
  on: jest.Mock
  subscribe: jest.Mock
  /** Test-only hook to trigger the subscribe-status callback. */
  __emitStatus: (s: string) => void
  /** Test-only hook to emit a postgres_changes payload to the listener. */
  __emitEvent: (p: PostgresChangesPayload) => void
}

let lastChannel: StubChannel | null = null
const removeChannel = jest.fn()

function makeStubChannel(): StubChannel {
  let subscribeCb: SubscribeCb | null = null
  let eventCb: EventCb | null = null
  const ch: StubChannel = {
    on: jest.fn().mockImplementation((_event, _cfg, cb: EventCb) => {
      eventCb = cb
      return ch
    }),
    subscribe: jest.fn().mockImplementation((cb: SubscribeCb) => {
      subscribeCb = cb
      return ch
    }),
    __emitStatus: (s) => {
      if (subscribeCb) subscribeCb(s)
    },
    __emitEvent: (p) => {
      if (eventCb) eventCb(p)
    },
  }
  return ch
}

jest.mock('@/lib/supabase/browser', () => ({
  createBrowserClient: () => ({
    channel: (_name: string) => {
      lastChannel = makeStubChannel()
      return lastChannel
    },
    removeChannel,
  }),
}))

// --- Test harness ----------------------------------------------------------

function StatusProbe({
  onStatus,
  onPayload,
}: {
  onStatus: (s: RealtimeStatus) => void
  onPayload: (p: PostgresChangesPayload) => void
}) {
  const status = usePostgresChanges(
    { channel: 'test-ch', table: 'transactions', filter: 'branch=eq.Kimberry' },
    onPayload,
  )
  React.useEffect(() => {
    onStatus(status)
  }, [status, onStatus])
  return <span data-testid="status">{status}</span>
}

beforeEach(() => {
  lastChannel = null
  removeChannel.mockClear()
})

describe('usePostgresChanges', () => {
  it('returns "disconnected" on initial render before subscribe completes', () => {
    const statuses: RealtimeStatus[] = []
    render(
      <StatusProbe
        onStatus={(s) => statuses.push(s)}
        onPayload={() => {}}
      />,
    )
    // First render produces the initial status synchronously.
    expect(statuses[0]).toBe('disconnected')
  })

  it('reports "connected" when the subscribe callback receives SUBSCRIBED', () => {
    const statuses: RealtimeStatus[] = []
    render(
      <StatusProbe
        onStatus={(s) => statuses.push(s)}
        onPayload={() => {}}
      />,
    )
    expect(lastChannel).not.toBeNull()
    act(() => {
      lastChannel!.__emitStatus('SUBSCRIBED')
    })
    expect(statuses.at(-1)).toBe('connected')
  })

  it('maps CHANNEL_ERROR to "reconnecting" and CLOSED to "disconnected"', () => {
    const statuses: RealtimeStatus[] = []
    render(
      <StatusProbe
        onStatus={(s) => statuses.push(s)}
        onPayload={() => {}}
      />,
    )
    act(() => {
      lastChannel!.__emitStatus('CHANNEL_ERROR')
    })
    expect(statuses.at(-1)).toBe('reconnecting')
    act(() => {
      lastChannel!.__emitStatus('CLOSED')
    })
    expect(statuses.at(-1)).toBe('disconnected')
  })

  it('invokes onChange when the channel emits a postgres_changes payload', () => {
    const payloads: PostgresChangesPayload[] = []
    render(
      <StatusProbe
        onStatus={() => {}}
        onPayload={(p) => payloads.push(p)}
      />,
    )
    const sample: PostgresChangesPayload = {
      eventType: 'INSERT',
      schema: 'public',
      table: 'transactions',
      new: { row_id: 'Kimberry|2026-05-15|1' },
      old: {},
    }
    act(() => {
      lastChannel!.__emitEvent(sample)
    })
    expect(payloads).toHaveLength(1)
    expect(payloads[0].eventType).toBe('INSERT')
    expect((payloads[0].new as { row_id: string }).row_id).toBe(
      'Kimberry|2026-05-15|1',
    )
  })

  // Task 19.4 — mobile browsers silently drop the Realtime WebSocket when
  // the tab goes to the background. The hook must resubscribe on the next
  // `visibilitychange → visible`, so consumers' `(reconnecting →
  // connected)` re-fetch logic fires and the page shows fresh numbers.
  it('resubscribes when the page returns to the foreground', () => {
    const statuses: RealtimeStatus[] = []
    render(
      <StatusProbe
        onStatus={(s) => statuses.push(s)}
        onPayload={() => {}}
      />,
    )

    // Bring the channel up first.
    act(() => {
      lastChannel!.__emitStatus('SUBSCRIBED')
    })
    expect(statuses.at(-1)).toBe('connected')

    const firstChannel = lastChannel
    expect(firstChannel).not.toBeNull()

    // Simulate the tab going to background then coming back.
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    })
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    })
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    // The previous channel should have been removed and a new one opened.
    expect(removeChannel).toHaveBeenCalled()
    expect(lastChannel).not.toBe(firstChannel)
    // Status flips to 'reconnecting' optimistically while the new channel
    // negotiates, then back to 'connected' when SUBSCRIBED fires.
    expect(statuses).toContain('reconnecting')
    act(() => {
      lastChannel!.__emitStatus('SUBSCRIBED')
    })
    expect(statuses.at(-1)).toBe('connected')
  })

  it('does not resubscribe when the page is hidden without becoming visible', () => {
    render(
      <StatusProbe onStatus={() => {}} onPayload={() => {}} />,
    )
    act(() => {
      lastChannel!.__emitStatus('SUBSCRIBED')
    })
    const firstChannel = lastChannel
    removeChannel.mockClear()

    // Only fire 'hidden' — the listener is supposed to ignore that.
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    })
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(removeChannel).not.toHaveBeenCalled()
    expect(lastChannel).toBe(firstChannel)
  })
})
