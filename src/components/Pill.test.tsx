// salary-system-rebuild — Heals Thai Massage POS
//
// Tests for `<Pill />` — the small colored badge used everywhere a
// staff / course / duration / method appears in the cashier panel.
//
// Coverage:
//   - Static pill (no onClick) renders as a span with the supplied
//     background color and an auto-contrasting foreground.
//   - Interactive pill (with onClick) renders as a button, fires the
//     click handler, and exposes `aria-pressed` when `selected`.
//   - Children render verbatim inside the pill.
//
// Validates: ergonomics — Epic 16, task 16.1.

/**
 * @jest-environment jsdom
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { Pill } from './Pill'

describe('<Pill />', () => {
  it('renders a static span with the supplied background and auto-contrast foreground', () => {
    render(<Pill color="#0d9488">THC</Pill>)
    const span = screen.getByText('THC')
    expect(span.tagName).toBe('SPAN')
    expect(span.style.backgroundColor).toBe('rgb(13, 148, 136)') // #0d9488
    // Dark teal background → white text.
    expect(span.style.color).toBe('rgb(255, 255, 255)')
  })

  it('uses dark text on a light background', () => {
    render(<Pill color="#fbbf24">30</Pill>)
    const span = screen.getByText('30')
    // Amber-400 background → dark text.
    expect(span.style.color).toBe('rgb(15, 23, 42)') // #0f172a
  })

  it('renders an interactive button when onClick is provided', async () => {
    const onClick = jest.fn()
    const user = userEvent.setup()
    render(
      <Pill color="#14b8a6" onClick={onClick} aria-label="Pick CASH">
        CASH
      </Pill>,
    )
    const button = screen.getByRole('button', { name: 'Pick CASH' })
    expect(button.tagName).toBe('BUTTON')
    await user.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('exposes aria-pressed when selected', () => {
    render(
      <Pill color="#14b8a6" onClick={() => {}} selected aria-label="Pick CASH">
        CASH
      </Pill>,
    )
    const button = screen.getByRole('button', { name: 'Pick CASH' })
    expect(button.getAttribute('aria-pressed')).toBe('true')
  })

  it('omits aria-pressed when not selected', () => {
    render(
      <Pill color="#14b8a6" onClick={() => {}} aria-label="Pick CASH">
        CASH
      </Pill>,
    )
    const button = screen.getByRole('button', { name: 'Pick CASH' })
    expect(button.getAttribute('aria-pressed')).toBeNull()
  })
})
