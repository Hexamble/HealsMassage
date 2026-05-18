'use client'

/**
 * heals-system-rebuild — Owner dashboard sidebar (desktop nav).
 *
 * Active-route highlighting via `usePathname()`. Mobile users get the
 * bottom-tab nav (`OwnerBottomNav`); this is hidden under `md`.
 */

import Link from 'next/link'
import { usePathname } from 'next/navigation'

interface NavItem {
  href: string
  label: string
}

const NAV: readonly NavItem[] = [
  { href: '/owner', label: 'Command Center' },
  { href: '/owner/salary', label: 'Salary Board' },
  { href: '/owner/income', label: 'Shop Income' },
  { href: '/owner/time-machine', label: 'Time Machine' },
  { href: '/owner/roster', label: 'Roster' },
  { href: '/owner/rates', label: 'Commission rates' },
  { href: '/owner/prices', label: 'Prices' },
  { href: '/owner/reports', label: 'Reports' },
] as const

const BRANCH_LINKS: readonly { href: string; label: string }[] = [
  { href: '/cashier/Kimberry', label: 'Kimberry' },
  { href: '/cashier/Bishop', label: 'Bishop' },
  { href: '/cashier/Chulia', label: 'Chulia' },
] as const

export default function OwnerSidebar({ userEmail }: { userEmail: string }) {
  const pathname = usePathname() ?? ''

  return (
    <aside className="hidden md:flex w-60 border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 flex-col gap-1">
      <div className="px-2 py-3 mb-2 border-b border-zinc-200 dark:border-zinc-800">
        <div className="text-sm font-semibold">Heals POS</div>
        <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
          {userEmail}
        </div>
      </div>
      {NAV.map((item) => {
        const active =
          pathname === item.href ||
          (item.href !== '/owner' && pathname.startsWith(item.href + '/'))
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`px-3 py-2 rounded-lg text-sm transition-colors ${
              active
                ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-medium'
                : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
            }`}
          >
            {item.label}
          </Link>
        )
      })}
      <div className="mt-4 mb-1 px-3 text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
        Branches
      </div>
      {BRANCH_LINKS.map((link) => {
        const active = pathname.startsWith(link.href)
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`px-3 py-2 rounded-lg text-sm transition-colors ${
              active
                ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-medium'
                : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
            }`}
          >
            {link.label}
          </Link>
        )
      })}
    </aside>
  )
}
