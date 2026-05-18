'use client'

/**
 * heals-system-rebuild — Bottom-tab navigation for the owner dashboard
 * on phone-sized viewports. Hidden at `md+`. Five most-used links
 * fit neatly in a 5-column grid.
 */

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/owner', label: 'Today' },
  { href: '/owner/salary', label: 'Salary' },
  { href: '/owner/income', label: 'Income' },
  { href: '/owner/time-machine', label: 'History' },
  { href: '/owner/roster', label: 'Staff' },
] as const

function isActive(pathname: string, href: string): boolean {
  if (pathname === href) return true
  if (href === '/owner') return false
  return pathname.startsWith(href + '/')
}

export default function OwnerBottomNav() {
  const pathname = usePathname() ?? ''
  return (
    <nav
      aria-label="Owner sections"
      className="md:hidden fixed bottom-0 inset-x-0 z-40 grid grid-cols-5 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900"
    >
      {TABS.map((tab) => {
        const active = isActive(pathname, tab.href)
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={`h-14 flex items-center justify-center text-xs transition-colors ${
              active
                ? 'text-zinc-900 dark:text-zinc-100 font-medium bg-zinc-100 dark:bg-zinc-800'
                : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
            }`}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
