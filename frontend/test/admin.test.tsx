import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CaseBrief } from '../src/api/client'
import { AdminDashboard } from '../src/components/admin/AdminDashboard'
import { caseBrief, customerDetail, customerRow, json, metrics, queueRow, server, url } from './api'

function adminApi(options: { metricsStatus?: number; total?: number; empty?: boolean; resolve?: (body: unknown) => Response } = {}) {
  const queueCalls: { page: string | null; pageSize: string | null; authorization: string | null }[] = []
  server.use(
    http.get(url('/admin/metrics'), () => (options.metricsStatus ? json({ code: 'UNAUTHORIZED', message: 'Invalid token.' }, options.metricsStatus) : json(metrics))),
    http.get(url('/admin/refund-requests'), ({ request }) => {
      const params = new URL(request.url).searchParams
      queueCalls.push({ page: params.get('page'), pageSize: params.get('pageSize'), authorization: request.headers.get('Authorization') })
      return json({ items: options.empty ? [] : [queueRow], total: options.total ?? 1, page: Number(params.get('page')), pageSize: Number(params.get('pageSize')) })
    }),
    http.get(url('/admin/refund-requests/:id'), () => json(caseBrief)),
    http.post(url('/admin/refund-requests/:id/resolution'), async ({ request }) => options.resolve!(await request.json())),
  )
  return queueCalls
}

const renderDashboard = (onSignedOut = () => {}) => render(<AdminDashboard onSignedOut={onSignedOut} />)

describe('support dashboard', () => {
  it('shows the AI status as a dot, plain tiles and reasons, and lists the queue using the session cookie', async () => {
    const queueCalls = adminApi()
    renderDashboard()

    expect(await screen.findByText('AI online')).toBeInTheDocument()
    expect(await screen.findByText('Kemi Adeyemi')).toBeInTheDocument()
    expect(queueCalls[0]).toEqual({ page: '1', pageSize: '10', authorization: null })
    expect(screen.queryByText(/escalated in total|in last 24h|Expected 0/)).not.toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Metrics' })).getByText('No AI assessment')).toHaveTextContent(/^No AI assessment$/)
  })

  it('shows no pager when there is nothing to list', async () => {
    adminApi({ total: 0, empty: true })
    renderDashboard()

    expect(await screen.findByText('Nothing is waiting for review.')).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Pages' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Previous|Next/ })).not.toBeInTheDocument()
  })

  it('pages 10 rows at a time with Previous and Next, showing "1 of N"', async () => {
    const queueCalls = adminApi({ total: 25 })
    const user = userEvent.setup()
    renderDashboard()

    const pager = await screen.findByRole('navigation', { name: 'Pages' })
    expect(await within(pager).findByText('1 of 3')).toBeInTheDocument()
    expect(within(pager).queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(await within(pager).findByText('2 of 3')).toBeInTheDocument()
    expect(queueCalls.at(-1)).toMatchObject({ page: '2', pageSize: '10' })
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(await within(pager).findByText('3 of 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  it('signs the reviewer out when the token is rejected', async () => {
    adminApi({ metricsStatus: 401 })
    const onSignedOut = vi.fn()
    renderDashboard(onSignedOut)

    await vi.waitFor(() => expect(onSignedOut).toHaveBeenCalled())
  })

  it('resolves an escalated case item by item, with a required note', async () => {
    let sent: unknown
    const resolved: CaseBrief = {
      ...caseBrief,
      resolution: {
        outcome: 'PARTIALLY_APPROVED',
        approvedAmountMinor: 4000,
        reviewerNote: 'Belt was worn.',
        customerMessage: 'We refunded the shirt.',
        lines: [
          { lineId: 'line-shirt', itemName: 'Polo shirt, green', approve: true },
          { lineId: 'line-belt', itemName: 'Canvas belt, navy', approve: false },
        ],
        resolvedAt: '2026-09-28T11:00:00Z',
      },
    }
    const queueCalls = adminApi({
      resolve: (body) => {
        sent = body
        return json(resolved)
      },
    })
    const user = userEvent.setup()
    renderDashboard()

    await user.click(await screen.findByRole('button', { name: /Kemi Adeyemi/ }))
    const sheet = await screen.findByRole('dialog', { name: queueRow.requestId })
    const save = await within(sheet).findByRole('button', { name: 'Save decision' })
    expect(save).toBeDisabled()

    await user.click(within(within(sheet).getByRole('radiogroup', { name: 'Decision for Polo shirt, green' })).getByRole('radio', { name: 'Refund' }))
    await user.click(within(within(sheet).getByRole('radiogroup', { name: 'Decision for Canvas belt, navy' })).getByRole('radio', { name: 'Reject' }))
    expect(within(sheet).getByText(/Refund total:/)).toHaveTextContent('$40.00')
    expect(save).toBeDisabled()

    await user.type(within(sheet).getByRole('textbox', { name: /Internal note/ }), 'Belt was worn.')
    const queueLoadsBefore = queueCalls.length
    await user.click(save)

    expect(await within(sheet).findByText('Note: Belt was worn.')).toBeInTheDocument()
    expect(sent).toEqual({
      lineDecisions: [
        { lineId: 'line-shirt', approve: true },
        { lineId: 'line-belt', approve: false },
      ],
      reviewerNote: 'Belt was worn.',
    })
    expect(within(sheet).queryByRole('button', { name: 'Save decision' })).not.toBeInTheDocument()
    await vi.waitFor(() => expect(queueCalls.length).toBeGreaterThan(queueLoadsBefore))
  })

  it('tells the reviewer when someone else resolved the case first', async () => {
    adminApi({ resolve: () => json({ code: 'ALREADY_RESOLVED', message: 'Already resolved.' }, 409) })
    const user = userEvent.setup()
    renderDashboard()

    await user.click(await screen.findByRole('button', { name: /Kemi Adeyemi/ }))
    const sheet = await screen.findByRole('dialog', { name: queueRow.requestId })
    for (const group of within(sheet).getAllByRole('radiogroup')) await user.click(within(group).getByRole('radio', { name: 'Refund' }))
    await user.type(within(sheet).getByRole('textbox', { name: /Internal note/ }), 'Looks fine.')
    await user.click(within(sheet).getByRole('button', { name: 'Save decision' }))

    expect(await within(sheet).findByRole('alert')).toHaveTextContent('Another reviewer resolved this case.')
  })
})

describe('customers section', () => {
  afterEach(() => {
    window.location.hash = ''
  })

  it('is a sidebar section with its own address, listing and searching customers', async () => {
    adminApi()
    const searches: (string | null)[] = []
    server.use(
      http.get(url('/admin/customers'), ({ request }) => {
        searches.push(new URL(request.url).searchParams.get('q'))
        return json({ items: [customerRow], total: 12, page: 1, pageSize: 10 })
      }),
      http.get(url('/admin/customers/:id'), () => json(customerDetail)),
    )
    const user = userEvent.setup()
    renderDashboard()

    const sections = screen.getByRole('navigation', { name: 'Dashboard sections' })
    expect(within(sections).getByRole('link', { name: /Refund requests/ })).toHaveAttribute('aria-current', 'page')
    window.location.hash = '#/admin/customers'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    expect(await within(sections).findByRole('link', { name: /Customers/ })).toHaveAttribute('aria-current', 'page')

    const list = await screen.findByRole('region', { name: 'Customers' })
    expect(await within(list).findByText('Femi Johnson')).toBeInTheDocument()
    expect(within(list).getByText('1 of 2')).toBeInTheDocument()
    await user.type(within(list).getByPlaceholderText('Name or email'), 'femi')
    await vi.waitFor(() => expect(searches.at(-1)).toBe('femi'))

    await user.click(within(list).getByRole('button', { name: /Femi Johnson/ }))
    const sheet = await screen.findByRole('dialog', { name: 'Femi Johnson' })
    expect(await within(sheet).findByText('WN-8NF4QA')).toBeInTheDocument()
    expect(within(sheet).getByText('Refunded').nextElementSibling).toHaveTextContent('$300.00')
    expect(within(sheet).getByText('rr_6fem0chr0001')).toBeInTheDocument()
  })
})
