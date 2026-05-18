// salary-system-rebuild — Heals Thai Massage POS
// Tests for `<StaffPicker />` — the popover staff selector used by
// the cashier sheet (task 21.4).
//
// Coverage:
//   - Renders all three sections (Staff / Other Shop / Freelance)
//     when each has at least one entry.
//   - Hides the Other Shop section when no visiting staff are present.
//   - In Bishop with an empty home roster, Other Shop is expanded by
//     default on initial open.
//   - Selecting a pill fires `onSelect` with the full staff object.
//   - Other Shop pills carry a KM/BS/CL shortcode badge matching the
//     staff's home_branch.
//   - "+ add" buttons render only when `onAddStaff` is supplied, and
//     the cashier's input flows back to the handler with the
//     correct `isFreelance` flag.

/**
 * @jest-environment jsdom
 */

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import StaffPicker, { type ActiveStaff } from './StaffPicker'

const STAFF_KIM_HOME: ActiveStaff[] = [
  { id: 's-beer', name: 'Beer', homeBranch: 'Kimberry', isFreelance: false, color: '#ef4444' },
  { id: 's-lin', name: 'Lin', homeBranch: 'Kimberry', isFreelance: false, color: '#10b981' },
  { id: 's-ney', name: 'Ney', homeBranch: 'Bishop', isFreelance: false, color: '#3b82f6' },
  { id: 's-mim', name: 'Mim', homeBranch: 'Chulia', isFreelance: false, color: '#fbbf24' },
  { id: 's-som', name: 'Som', homeBranch: 'Kimberry', isFreelance: true, color: '#a855f7' },
  { id: 's-ja', name: 'Ja', homeBranch: 'Bishop', isFreelance: true, color: '#f97316' },
]

function getSection(label: string): HTMLElement {
  return screen.getByRole('group', { name: label })
}

describe('<StaffPicker /> — three sections', () => {
  it('renders Staff, Other Shop, and Freelance when each has an entry', () => {
    render(
      <StaffPicker
        branch="Kimberry"
        staff={STAFF_KIM_HOME}
        onSelect={() => {}}
        defaultOpen
      />,
    )

    const staff = getSection('Staff')
    expect(within(staff).getByRole('button', { name: /Pick Beer/i })).toBeTruthy()
    expect(within(staff).getByRole('button', { name: /Pick Lin/i })).toBeTruthy()

    const otherShop = getSection('Other Shop')
    expect(within(otherShop).getByRole('button', { name: /Pick Ney/i })).toBeTruthy()
    expect(within(otherShop).getByRole('button', { name: /Pick Mim/i })).toBeTruthy()

    const freelance = getSection('Freelance')
    expect(within(freelance).getByRole('button', { name: /Pick Som/i })).toBeTruthy()
    expect(within(freelance).getByRole('button', { name: /Pick Ja/i })).toBeTruthy()
  })

  it('hides Other Shop when no visiting staff are present', () => {
    const onlyHome: ActiveStaff[] = [
      { id: 's-beer', name: 'Beer', homeBranch: 'Kimberry', isFreelance: false },
      { id: 's-lin', name: 'Lin', homeBranch: 'Kimberry', isFreelance: false },
      { id: 's-som', name: 'Som', homeBranch: 'Kimberry', isFreelance: true },
    ]

    render(
      <StaffPicker
        branch="Kimberry"
        staff={onlyHome}
        onSelect={() => {}}
        defaultOpen
      />,
    )

    expect(screen.queryByRole('group', { name: 'Other Shop' })).toBeNull()
    expect(screen.getByRole('group', { name: 'Staff' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Freelance' })).toBeTruthy()
  })
})

describe('<StaffPicker /> — Bishop empty home roster', () => {
  it('expands Other Shop by default when the home group is empty', () => {
    // No staff have homeBranch === 'Bishop' here; Other Shop is the
    // only place the cashier can pick a regular from. The section
    // should be expanded on initial open.
    const noBishopHome: ActiveStaff[] = [
      { id: 's-beer', name: 'Beer', homeBranch: 'Kimberry', isFreelance: false },
      { id: 's-lin', name: 'Lin', homeBranch: 'Kimberry', isFreelance: false },
      { id: 's-mim', name: 'Mim', homeBranch: 'Chulia', isFreelance: false },
    ]

    render(
      <StaffPicker
        branch="Bishop"
        staff={noBishopHome}
        onSelect={() => {}}
        defaultOpen
      />,
    )

    const otherShop = getSection('Other Shop')
    expect(otherShop.getAttribute('data-expanded')).toBe('true')

    // Pills are reachable without an extra expand click.
    expect(within(otherShop).getByRole('button', { name: /Pick Beer/i })).toBeTruthy()
    expect(within(otherShop).getByRole('button', { name: /Pick Lin/i })).toBeTruthy()
    expect(within(otherShop).getByRole('button', { name: /Pick Mim/i })).toBeTruthy()
  })
})

describe('<StaffPicker /> — selection', () => {
  it('clicking a pill fires onSelect with the full staff object', async () => {
    const user = userEvent.setup()
    const onSelect = jest.fn()
    render(
      <StaffPicker
        branch="Kimberry"
        staff={STAFF_KIM_HOME}
        onSelect={onSelect}
        defaultOpen
      />,
    )

    const beer = screen.getByRole('button', { name: /Pick Beer/i })
    await user.click(beer)

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 's-beer',
        name: 'Beer',
        homeBranch: 'Kimberry',
        isFreelance: false,
        color: '#ef4444',
      }),
    )
  })

  it('selecting from Other Shop forwards the visiting staff object', async () => {
    const user = userEvent.setup()
    const onSelect = jest.fn()
    render(
      <StaffPicker
        branch="Kimberry"
        staff={STAFF_KIM_HOME}
        onSelect={onSelect}
        defaultOpen
      />,
    )

    const otherShop = getSection('Other Shop')
    const ney = within(otherShop).getByRole('button', { name: /Pick Ney/i })
    await user.click(ney)

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect.mock.calls[0][0]).toMatchObject({
      id: 's-ney',
      name: 'Ney',
      homeBranch: 'Bishop',
      isFreelance: false,
    })
  })

  it('selecting a freelancer forwards isFreelance: true', async () => {
    const user = userEvent.setup()
    const onSelect = jest.fn()
    render(
      <StaffPicker
        branch="Kimberry"
        staff={STAFF_KIM_HOME}
        onSelect={onSelect}
        defaultOpen
      />,
    )

    const freelance = getSection('Freelance')
    const som = within(freelance).getByRole('button', { name: /Pick Som/i })
    await user.click(som)

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect.mock.calls[0][0]).toMatchObject({
      id: 's-som',
      name: 'Som',
      isFreelance: true,
    })
  })
})

describe('<StaffPicker /> — Other Shop shortcode badges', () => {
  it('renders KM/BS/CL badges matching each visiting staff home_branch', () => {
    // With branch=Bishop:
    //   - Beer (Bishop home) and Local (Bishop home) → Staff section
    //   - Mim (Chulia) and Yui (Kimberry) → Other Shop section with
    //     CL and KM shortcodes respectively
    const staff: ActiveStaff[] = [
      { id: 's-beer', name: 'Beer', homeBranch: 'Bishop', isFreelance: false },
      { id: 's-mim', name: 'Mim', homeBranch: 'Chulia', isFreelance: false },
      { id: 's-yui', name: 'Yui', homeBranch: 'Kimberry', isFreelance: false },
      { id: 's-local', name: 'Local', homeBranch: 'Bishop', isFreelance: false },
    ]

    render(
      <StaffPicker
        branch="Bishop"
        staff={staff}
        onSelect={() => {}}
        defaultOpen
      />,
    )

    const otherShop = getSection('Other Shop')
    const mim = within(otherShop).getByRole('button', { name: /Pick Mim/i })
    expect(mim.getAttribute('data-shortcode')).toBe('CL')
    expect(mim.textContent).toMatch(/CL/)

    const yui = within(otherShop).getByRole('button', { name: /Pick Yui/i })
    expect(yui.getAttribute('data-shortcode')).toBe('KM')
    expect(yui.textContent).toMatch(/KM/)

    // Local Bishop staff in the home Staff section should NOT carry
    // a shortcode badge.
    const home = getSection('Staff')
    const local = within(home).getByRole('button', { name: /Pick Local/i })
    expect(local.getAttribute('data-shortcode')).toBeNull()
    expect(local.textContent).not.toMatch(/\bBS\b/)
  })

  it('renders KM badge for a Kimberry-home staff visiting Chulia', () => {
    const staff: ActiveStaff[] = [
      { id: 's-beer', name: 'Beer', homeBranch: 'Kimberry', isFreelance: false },
    ]

    render(
      <StaffPicker
        branch="Chulia"
        staff={staff}
        onSelect={() => {}}
        defaultOpen
      />,
    )

    const otherShop = getSection('Other Shop')
    const beer = within(otherShop).getByRole('button', { name: /Pick Beer/i })
    expect(beer.getAttribute('data-shortcode')).toBe('KM')
  })
})

describe('<StaffPicker /> — add buttons', () => {
  it('does NOT render + add buttons when onAddStaff is not supplied', () => {
    render(
      <StaffPicker
        branch="Kimberry"
        staff={STAFF_KIM_HOME}
        onSelect={() => {}}
        defaultOpen
      />,
    )

    expect(screen.queryByRole('button', { name: /\+ add new staff/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /\+ add freelance/i })).toBeNull()
  })

  it('renders both + add buttons when onAddStaff is supplied', () => {
    render(
      <StaffPicker
        branch="Kimberry"
        staff={STAFF_KIM_HOME}
        onSelect={() => {}}
        onAddStaff={() => {}}
        defaultOpen
      />,
    )

    expect(
      screen.getByRole('button', { name: /\+ add new staff/i }),
    ).toBeTruthy()
    expect(
      screen.getByRole('button', { name: /\+ add freelance/i }),
    ).toBeTruthy()
  })

  it('typing into "+ add new staff" calls onAddStaff with isFreelance=false', async () => {
    const user = userEvent.setup()
    const onAddStaff = jest.fn()
    render(
      <StaffPicker
        branch="Kimberry"
        staff={STAFF_KIM_HOME}
        onSelect={() => {}}
        onAddStaff={onAddStaff}
        defaultOpen
      />,
    )

    await user.click(screen.getByRole('button', { name: /\+ add new staff/i }))
    const form = await screen.findByRole('form', { name: /Add new staff/i })
    await user.type(within(form).getByLabelText(/New staff name/i), 'NewGirl')
    await user.click(within(form).getByRole('button', { name: /Save/i }))

    expect(onAddStaff).toHaveBeenCalledTimes(1)
    expect(onAddStaff).toHaveBeenCalledWith('NewGirl', false)
  })

  it('typing into "+ add freelance" calls onAddStaff with isFreelance=true', async () => {
    const user = userEvent.setup()
    const onAddStaff = jest.fn()
    render(
      <StaffPicker
        branch="Kimberry"
        staff={STAFF_KIM_HOME}
        onSelect={() => {}}
        onAddStaff={onAddStaff}
        defaultOpen
      />,
    )

    await user.click(screen.getByRole('button', { name: /\+ add freelance/i }))
    const form = await screen.findByRole('form', { name: /Add freelance/i })
    await user.type(within(form).getByLabelText(/New freelance name/i), 'Mia')
    await user.click(within(form).getByRole('button', { name: /Save/i }))

    expect(onAddStaff).toHaveBeenCalledTimes(1)
    expect(onAddStaff).toHaveBeenCalledWith('Mia', true)
  })
})

describe('<StaffPicker /> — homeStaffSessionCount sort', () => {
  it('sorts home staff by today session count desc then alphabetic', () => {
    // Beer 0, Lin 5, Aaron 3 → expected order Lin (5), Aaron (3), Beer (0).
    const staff: ActiveStaff[] = [
      { id: 's-beer', name: 'Beer', homeBranch: 'Kimberry', isFreelance: false },
      { id: 's-lin', name: 'Lin', homeBranch: 'Kimberry', isFreelance: false },
      { id: 's-aaron', name: 'Aaron', homeBranch: 'Kimberry', isFreelance: false },
    ]

    render(
      <StaffPicker
        branch="Kimberry"
        staff={staff}
        onSelect={() => {}}
        defaultOpen
        homeStaffSessionCount={{ lin: 5, aaron: 3, beer: 0 }}
      />,
    )

    const home = getSection('Staff')
    const pills = within(home).getAllByRole('button', { name: /^Pick / })
    const names = pills.map((p) => p.getAttribute('data-staff'))
    expect(names).toEqual(['Lin', 'Aaron', 'Beer'])
  })

  it('falls back to alphabetic when counts are absent', () => {
    const staff: ActiveStaff[] = [
      { id: 's-beer', name: 'Beer', homeBranch: 'Kimberry', isFreelance: false },
      { id: 's-aaron', name: 'Aaron', homeBranch: 'Kimberry', isFreelance: false },
      { id: 's-lin', name: 'Lin', homeBranch: 'Kimberry', isFreelance: false },
    ]

    render(
      <StaffPicker
        branch="Kimberry"
        staff={staff}
        onSelect={() => {}}
        defaultOpen
      />,
    )

    const home = getSection('Staff')
    const pills = within(home).getAllByRole('button', { name: /^Pick / })
    const names = pills.map((p) => p.getAttribute('data-staff'))
    expect(names).toEqual(['Aaron', 'Beer', 'Lin'])
  })
})
