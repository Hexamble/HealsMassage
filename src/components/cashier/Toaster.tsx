'use client'

/**
 * heals-system-rebuild — Lightweight toast system.
 *
 * Tiny event-bus + portal-rendered stack of timed messages. The
 * cashier panel uses it for two things right now:
 *
 *   1. "Row deleted — Undo?" — the SessionTable's × button removes a
 *      row optimistically, then queues a 5-second window during which
 *      the cashier can hit Undo to restore it. If the window passes
 *      without Undo, the deletion is committed to the DB.
 *
 *   2. Save-error notifications — when a row save fails terminally
 *      (UNKNOWN_STAFF, BRANCH_MISMATCH, etc.), a toast surfaces the
 *      message without blocking the table.
 *
 * Self-contained: no external state library, no portal manager. The
 * `<Toaster />` mounts once near the app root; any caller can fire a
 * toast via `toast(...)` from the same module.
 */

import { useEffect, useState } from 'react'

// ---------------------------------------------------------------------------
// Pub/sub
// ---------------------------------------------------------------------------

export interface ToastInput {
  /** Message body. */
  message: string
  /**
   * Visual variant. `default` = neutral, `success` = green, `error` =
   * red. Default `default`.
   */
  variant?: 'default' | 'success' | 'error'
  /** Auto-dismiss timeout (ms). Default 4000. Set 0 to keep open. */
  durationMs?: number
  /**
   * Optional action button. When clicked, fires `onClick` and then
   * dismisses the toast.
   */
  action?: { label: string; onClick: () => void }
  /** Fired when the toast auto-dismisses (NOT when action is clicked). */
  onTimeout?: () => void
}

interface ToastEntry extends ToastInput {
  id: string
}

type Listener = (toasts: ToastEntry[]) => void

const listeners = new Set<Listener>()
let toasts: ToastEntry[] = []
let nextId = 1

function emit(): void {
  const snapshot = Array.from(listeners)
  for (const cb of snapshot) cb([...toasts])
}

export function toast(input: ToastInput): { id: string; dismiss: () => void } {
  const id = `t-${nextId++}`
  const entry: ToastEntry = { ...input, id }
  toasts = [...toasts, entry]
  emit()
  const duration = input.durationMs ?? 4000
  let timer: ReturnType<typeof setTimeout> | null = null
  if (duration > 0) {
    timer = setTimeout(() => {
      const found = toasts.find((t) => t.id === id)
      if (!found) return
      toasts = toasts.filter((t) => t.id !== id)
      emit()
      try {
        input.onTimeout?.()
      } catch {
        // swallow
      }
    }, duration)
  }
  return {
    id,
    dismiss(): void {
      if (timer) clearTimeout(timer)
      const found = toasts.find((t) => t.id === id)
      if (!found) return
      toasts = toasts.filter((t) => t.id !== id)
      emit()
    },
  }
}

// ---------------------------------------------------------------------------
// React component
// ---------------------------------------------------------------------------

export default function Toaster() {
  const [list, setList] = useState<ToastEntry[]>([])
  useEffect(() => {
    const fn: Listener = (next) => setList(next)
    listeners.add(fn)
    fn([...toasts])
    return () => {
      listeners.delete(fn)
    }
  }, [])

  if (list.length === 0) return null

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm"
    >
      {list.map((t) => {
        const variantCls =
          t.variant === 'success'
            ? 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-100'
            : t.variant === 'error'
              ? 'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/60 dark:text-red-100'
              : 'border-zinc-300 bg-white text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100'
        return (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto rounded-xl border shadow-lg px-4 py-3 text-sm flex items-center gap-3 ${variantCls}`}
          >
            <span className="flex-1">{t.message}</span>
            {t.action && (
              <button
                type="button"
                onClick={() => {
                  try {
                    t.action!.onClick()
                  } catch {
                    // swallow
                  }
                  toasts = toasts.filter((x) => x.id !== t.id)
                  emit()
                }}
                className="rounded-md border border-current/30 px-2 py-1 text-xs font-medium hover:bg-black/5 dark:hover:bg-white/5"
              >
                {t.action.label}
              </button>
            )}
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => {
                toasts = toasts.filter((x) => x.id !== t.id)
                emit()
              }}
              className="text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 text-lg leading-none"
            >
              ×
            </button>
          </div>
        )
      })}
    </div>
  )
}
