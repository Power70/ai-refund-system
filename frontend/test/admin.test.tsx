import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import type { CaseBrief } from '../src/api/client'
import { AdminDashboard } from '../src/components/admin/AdminDashboard'
import { caseBrief, json, metrics, queueRow, server, url } from './api'

function adminApi(options: { metricsStatus?: number; resolve?: (body: unknown) => Response } = {}) {
  const queueCalls: string[] = []
  server.use(
    http.get(url('/admin/metrics'), () => (options.metricsStatus ? json({ code: 'UNAUTHORIZED', message: 'Invalid token.' }, options.metricsStatus) : json(metrics))),
    http.get(url('/admin/refund-requests'), ({ request }) => {
      queueCalls.push(request.headers.get('Authorization') ?? '')
      return json({ items: [queueRow], total: 1, page: 1, pageSize: 20 })
    }),
    http.get(url('/admin/refund-requests/:id'), () => json(caseBrief)),
    http.post(url('/admin/refund-requests/:id/resolution'), async ({ request }) => options.resolve!(await request.json())),
  )
  return queueCalls
}

const renderDashboard = (onSignedOut = () => {}) => render(<AdminDashboard token="admin-demo-token" onSignedOut={onSignedOut} />)

describe('support dashboard', () => {
  it('shows the AI status as a dot and lists the queue with the bearer token', async () => {
    const queueCalls = adminApi()
    renderDashboard()

    expect(await screen.findByText('AI online')).toBeInTheDocument()
    expect(await screen.findByText('Kemi Adeyemi')).toBeInTheDocument()
    expect(queueCalls[0]).toBe('Bearer admin-demo-token')
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
