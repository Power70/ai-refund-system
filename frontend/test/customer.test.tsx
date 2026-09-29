import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { SupportWorkspace } from '../src/components/SupportWorkspace'
import { conversation, customerApi, json, order, proposal, requestView, server, url } from './api'

const renderWorkspace = () => render(<SupportWorkspace firstName="Ada" onSignedOut={() => {}} />)

/** Records each claim submission and answers with the next response in turn. */
function submissions(...responses: (() => Response)[]) {
  const calls: { key: string | null; body: unknown }[] = []
  server.use(
    http.post(url('/customer/refund-requests'), async ({ request }) => {
      calls.push({ key: request.headers.get('Idempotency-Key'), body: await request.json() })
      return responses[Math.min(calls.length, responses.length) - 1]()
    }),
  )
  return calls
}

describe('submitting a claim', () => {
  it('repeats the same idempotency key on every retry, then shows the decision', async () => {
    customerApi(conversation({ proposal }))
    const calls = submissions(() => HttpResponse.error(), () => HttpResponse.error(), () => json(requestView(), 201))
    const user = userEvent.setup()
    renderWorkspace()

    // Pressing Submit again and pressing Try again must both repeat the same key.
    await user.click(await screen.findByRole('button', { name: 'Submit request' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("We couldn't reach the server")
    await user.click(screen.getByRole('button', { name: 'Submit request' }))
    await screen.findByRole('alert')
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    const decision = await screen.findByRole('region', { name: /Refund request/ })
    expect(within(decision).getByText('Approved')).toBeInTheDocument()
    expect(within(decision).getByText('Refund amount:')).toHaveTextContent('$49.99')
    expect(calls).toHaveLength(3)
    expect(calls[0].key).toBeTruthy()
    expect(new Set(calls.map((c) => c.key)).size).toBe(1)
    expect(calls[0].body).toEqual({ orderNumber: 'WN-7K3P9Q', reason: 'DAMAGED', lines: [{ itemId: 'item-shirt', quantity: 1 }], conversationId: 'conv-1' })
  })

  it('uses a new key once the claim is edited', async () => {
    customerApi(conversation({ proposal }))
    const calls = submissions(() => json({ code: 'INTERNAL', message: 'Something went wrong.' }, 500), () => json(requestView({ status: 'ESCALATED' }), 201))
    const user = userEvent.setup()
    renderWorkspace()

    await user.click(await screen.findByRole('button', { name: 'Submit request' }))
    await screen.findByRole('alert')
    await user.click(screen.getByRole('radio', { name: 'I changed my mind' }))
    await user.click(screen.getByRole('button', { name: 'Submit request' }))

    await screen.findByRole('region', { name: /Refund request/ })
    expect(calls.map((c) => (c.body as { reason: string }).reason)).toEqual(['DAMAGED', 'CHANGED_MIND'])
    expect(calls[1].key).not.toBe(calls[0].key)
  })

  it('points out a reason that differs from what the customer described', async () => {
    customerApi(conversation({ proposal }))
    const user = userEvent.setup()
    renderWorkspace()

    await user.click(await screen.findByRole('radio', { name: 'I changed my mind' }))
    expect(screen.getByText(/In the chat you described this as/)).toHaveTextContent('“it arrived damaged or defective”')
    await user.click(screen.getByRole('button', { name: 'Use “It arrived damaged or defective”' }))
    expect(screen.getByRole('radio', { name: 'It arrived damaged or defective' })).toBeChecked()
  })

  it('keeps checking a request that is still processing until it is decided', async () => {
    customerApi(conversation({ proposal }))
    submissions(() => json(requestView({ status: 'PROCESSING', customerMessage: null, approvedAmountMinor: 0, lines: [{ itemName: 'Oxford shirt, blue', quantity: 1, outcome: 'PROCESSING' }] }), 202))
    const escalated = requestView({
      status: 'ESCALATED',
      customerMessage: "Thanks for your patience. We're taking a closer look at your request.",
      approvedAmountMinor: 0,
      lines: [{ itemName: 'Oxford shirt, blue', quantity: 1, outcome: 'UNDER_REVIEW' }],
    })
    let checks = 0
    server.use(http.get(url('/customer/refund-requests/:id'), () => json(++checks === 1 ? { ...escalated, status: 'PROCESSING', customerMessage: null } : escalated)))
    const user = userEvent.setup()
    renderWorkspace()

    await user.click(await screen.findByRole('button', { name: 'Submit request' }))
    const decision = await screen.findByRole('region', { name: /Refund request/ })
    expect(within(decision).getByText(/checking your request/)).toBeInTheDocument()

    expect(await within(decision).findByText("Thanks for your patience. We're taking a closer look at your request.", {}, { timeout: 5_000 })).toBeInTheDocument()
    expect(within(decision).getAllByText('In review')).toHaveLength(2)
    expect(checks).toBe(2)
  }, 10_000)
})

describe('decision and order details', () => {
  it('shows each item with its own outcome', async () => {
    const partial = requestView({
      approvedAmountMinor: 4000,
      lines: [
        { itemName: 'Canvas belt, navy', quantity: 1, outcome: 'NOT_REFUNDED' },
        { itemName: 'Polo shirt, green', quantity: 1, outcome: 'REFUNDED' },
      ],
    })
    customerApi(conversation({ state: 'SUBMITTED', requestId: partial.requestId }), [partial])
    server.use(http.get(url('/customer/refund-requests/:id'), () => json(partial)))
    renderWorkspace()

    const decision = await screen.findByRole('region', { name: /Refund request/ })
    expect(within(decision).getByText('1 × Canvas belt, navy').parentElement).toHaveTextContent('Not refunded')
    expect(within(decision).getByText('1 × Polo shirt, green').parentElement).toHaveTextContent('Refunded')
    expect(within(decision).getByText('Refund amount:')).toHaveTextContent('$40.00')
  })

  it('opens order details and starts a chat about an item from there', async () => {
    customerApi(conversation())
    const sent: unknown[] = []
    server.use(
      http.post(url('/customer/conversations/:id/messages'), async ({ request }) => {
        sent.push(await request.json())
        return json(conversation())
      }),
    )
    const user = userEvent.setup()
    renderWorkspace()

    await user.click(await screen.findByRole('button', { name: /WN-7K3P9Q/ }))
    const details = screen.getByRole('dialog', { name: /Order WN-7K3P9Q/ })
    expect(within(details).getByText('Order total').nextElementSibling).toHaveTextContent('$49.99')
    expect(within(details).getByText('Delivery').nextElementSibling).toHaveTextContent('Delivered Sep 23, 2026')
    expect(within(details).getByText('No refund requests for this order.')).toBeInTheDocument()

    await user.click(within(details).getByRole('button', { name: 'Ask about this item' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(sent).toEqual([{ clientMessageId: expect.any(String), orderItemId: 'item-shirt' }])
  })

  it('opens a request from the history with its latest outcome', async () => {
    const reviewed = requestView({
      status: 'DENIED',
      customerMessage: 'We looked at your request carefully and could not refund the belt.',
      approvedAmountMinor: 0,
      lines: [{ itemName: 'Canvas belt, navy', quantity: 1, outcome: 'NOT_REFUNDED' }],
    })
    // The list was loaded before a reviewer decided; opening the request fetches its latest state.
    customerApi(conversation(), [{ ...reviewed, status: 'ESCALATED', customerMessage: "We're taking a closer look.", lines: [{ ...reviewed.lines[0], outcome: 'UNDER_REVIEW' }] }])
    server.use(http.get(url('/customer/refund-requests/:id'), () => json(reviewed)))
    const user = userEvent.setup()
    renderWorkspace()

    await user.click(await screen.findByRole('button', { name: /rr_abcdefghjkmn/ }))
    const details = screen.getByRole('dialog', { name: /Refund request rr_abcdefghjkmn/ })
    expect(within(details).getByText('Not approved')).toBeInTheDocument()
    expect(within(details).getByText('We looked at your request carefully and could not refund the belt.')).toBeInTheDocument()
    expect(within(details).getByText('1 × Canvas belt, navy').parentElement).toHaveTextContent('Not refunded')
  })
})

describe('loading failures', () => {
  it('says when orders and requests could not be loaded, and loads them on retry', async () => {
    customerApi(conversation())
    let attempts = 0
    server.use(http.get(url('/customer/orders'), () => (++attempts === 1 ? json({ code: 'INTERNAL', message: 'Down.' }, 500) : json({ orders: [order] }))))
    const user = userEvent.setup()
    renderWorkspace()

    const alerts = await screen.findAllByRole('alert')
    expect(alerts.map((a) => a.textContent)).toEqual(expect.arrayContaining([expect.stringContaining("We couldn't load your orders."), expect.stringContaining("We couldn't load your requests.")]))
    await user.click(within(alerts[0]).getByRole('button', { name: 'Try again' }))

    expect(await screen.findByRole('button', { name: /WN-7K3P9Q/ })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('No refund requests yet.')).toBeInTheDocument()
  })
})
