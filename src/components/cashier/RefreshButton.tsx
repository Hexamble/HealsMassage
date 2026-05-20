'use client'

import { useState } from 'react'
import { useCashier } from '@/app/cashier/[branch]/CashierContext'

export default function RefreshButton() {
  const { refreshAll } = useCashier()
  const [refreshing, setRefreshing] = useState(false)

  async function handleRefresh() {
    if (refreshing) return
    setRefreshing(true)
    try {
      await refreshAll()
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <button
      type="button"
      onClick={() => void handleRefresh()}
      disabled={refreshing}
      title="Refresh — pick up mirror rows from other branches"
      aria-label="Refresh session table"
      className="inline-flex items-center gap-1 rounded-md border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-2 py-1.5 text-xs font-medium hover:bg-zinc-50 dark:hover:bg-zinc-700 disabled:opacity-50"
    >
      <span aria-hidden className={refreshing ? 'animate-spin' : ''}>⟳</span>
      {refreshing ? 'Refreshing…' : 'Refresh'}
    </button>
  )
}
