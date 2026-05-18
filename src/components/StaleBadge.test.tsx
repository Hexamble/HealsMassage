// salary-system-rebuild — Heals Thai Massage POS
// Tests for the stale-data badge (Task 7.2). Pure presentational coverage:
// nothing renders on `connected`, amber on `reconnecting`, red on
// `disconnected`. Uses plain DOM assertions to avoid relying on
// `@testing-library/jest-dom` matchers (the jest config does not auto-load
// the matchers; this keeps the test self-contained).

/**
 * @jest-environment jsdom
 */

import { render, screen } from '@testing-library/react'
import StaleBadge from './StaleBadge'

describe('<StaleBadge />', () => {
  it('renders nothing when status is "connected"', () => {
    const { container } = render(<StaleBadge status="connected" />)
    expect(container.childNodes.length).toBe(0)
  })

  it('renders an amber "Reconnecting…" pill when status is "reconnecting"', () => {
    render(<StaleBadge status="reconnecting" />)
    const badge = screen.getByRole('status')
    expect(badge.textContent).toBe('Reconnecting…')
    expect(badge.className).toMatch(/bg-amber-100/)
  })

  it('renders a red "Disconnected — data may be stale" pill when status is "disconnected"', () => {
    render(<StaleBadge status="disconnected" />)
    const badge = screen.getByRole('status')
    expect(badge.textContent).toBe('Disconnected — data may be stale')
    expect(badge.className).toMatch(/bg-red-100/)
  })
})
