// salary-system-rebuild — Heals Thai Massage POS
//
// Tests for `<ThemeToggle />`. The toggle is a tri-state segmented
// control: clicking a button updates local state, applies the theme
// to `<html>`, and persists the choice via the `setTheme` server
// action. We mock the action so the tests run without a DB.
//
// Validates: ergonomics — Epic 18 (theme toggle).

/**
 * @jest-environment jsdom
 */

import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockSetTheme = jest.fn()
jest.mock('@/app/actions/setTheme', () => ({
  setTheme: (...args: unknown[]) => mockSetTheme(...args),
}))

import ThemeToggle from './ThemeToggle'

// ---------------------------------------------------------------------------
// matchMedia stub. jsdom doesn't implement window.matchMedia by default;
// the toggle reads `(prefers-color-scheme: dark)` for the 'system'
// branch, so we install a stub that each test can configure.
// ---------------------------------------------------------------------------

let prefersDark = false

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches:
        query === '(prefers-color-scheme: dark)' ? prefersDark : false,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }),
  })
})

beforeEach(() => {
  jest.clearAllMocks()
  prefersDark = false
  document.documentElement.classList.remove('dark')
  // Default mock: action succeeds with whatever was sent.
  mockSetTheme.mockImplementation((input: { theme: string }) =>
    Promise.resolve({ ok: true, theme: input.theme }),
  )
})

afterEach(() => {
  document.documentElement.classList.remove('dark')
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('<ThemeToggle />', () => {
  it('renders all three options and marks the initial theme as selected', () => {
    render(<ThemeToggle initialTheme="system" />)

    const lightBtn = screen.getByRole('button', { name: 'Light' })
    const darkBtn = screen.getByRole('button', { name: 'Dark' })
    const systemBtn = screen.getByRole('button', { name: 'System' })

    expect(lightBtn).toBeTruthy()
    expect(darkBtn).toBeTruthy()
    expect(systemBtn).toBeTruthy()

    expect(systemBtn.getAttribute('aria-pressed')).toBe('true')
    expect(lightBtn.getAttribute('aria-pressed')).toBe('false')
    expect(darkBtn.getAttribute('aria-pressed')).toBe('false')
  })

  it('clicking Dark applies the dark class to <html> and calls setTheme', async () => {
    const user = userEvent.setup()
    render(<ThemeToggle initialTheme="light" />)

    const darkBtn = screen.getByRole('button', { name: 'Dark' })
    await user.click(darkBtn)

    expect(document.documentElement.classList.contains('dark')).toBe(true)
    await waitFor(() => {
      expect(mockSetTheme).toHaveBeenCalledWith({ theme: 'dark' })
    })
    // Selection state moved to Dark.
    expect(darkBtn.getAttribute('aria-pressed')).toBe('true')
  })

  it('clicking Light removes the dark class', async () => {
    const user = userEvent.setup()
    // Pre-set dark on <html> so we can observe it being removed.
    document.documentElement.classList.add('dark')
    render(<ThemeToggle initialTheme="dark" />)

    const lightBtn = screen.getByRole('button', { name: 'Light' })
    await user.click(lightBtn)

    expect(document.documentElement.classList.contains('dark')).toBe(false)
    await waitFor(() => {
      expect(mockSetTheme).toHaveBeenCalledWith({ theme: 'light' })
    })
  })

  it('clicking System with prefers-dark adds the dark class', async () => {
    prefersDark = true
    const user = userEvent.setup()
    render(<ThemeToggle initialTheme="light" />)

    const systemBtn = screen.getByRole('button', { name: 'System' })
    await user.click(systemBtn)

    expect(document.documentElement.classList.contains('dark')).toBe(true)
    await waitFor(() =>
      expect(mockSetTheme).toHaveBeenCalledWith({ theme: 'system' }),
    )
  })

  it('clicking System with prefers-light removes the dark class', async () => {
    prefersDark = false
    document.documentElement.classList.add('dark')
    const user = userEvent.setup()
    render(<ThemeToggle initialTheme="dark" />)

    const systemBtn = screen.getByRole('button', { name: 'System' })
    await user.click(systemBtn)

    expect(document.documentElement.classList.contains('dark')).toBe(false)
    await waitFor(() =>
      expect(mockSetTheme).toHaveBeenCalledWith({ theme: 'system' }),
    )
  })

  it('on action error reverts local state, restores the prior <html> class, and shows an inline error', async () => {
    mockSetTheme.mockResolvedValueOnce({
      ok: false,
      code: 'DB_ERROR',
      message: 'simulated failure',
    })

    const user = userEvent.setup()
    render(<ThemeToggle initialTheme="light" />)

    const darkBtn = screen.getByRole('button', { name: 'Dark' })
    const lightBtn = screen.getByRole('button', { name: 'Light' })

    await user.click(darkBtn)

    await waitFor(() => {
      // Selection reverted to Light.
      expect(lightBtn.getAttribute('aria-pressed')).toBe('true')
    })
    // dark class removed (we started in 'light').
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    // Inline error visible.
    expect(screen.getByRole('alert').textContent).toContain('simulated failure')
  })

  it('clicking the already-selected option is a no-op (does not call setTheme)', async () => {
    const user = userEvent.setup()
    render(<ThemeToggle initialTheme="dark" />)

    const darkBtn = screen.getByRole('button', { name: 'Dark' })
    await user.click(darkBtn)

    expect(mockSetTheme).not.toHaveBeenCalled()
  })

  it('applies the initial theme to <html> on mount when initialTheme is dark', async () => {
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    await act(async () => {
      render(<ThemeToggle initialTheme="dark" />)
    })
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})
