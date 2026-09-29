import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App'
import { conversation, customerApi, json, metrics, server, url } from './api'

const noContent = () => new Response(null, { status: 204 })
const unauthorized = () => json({ statusCode: 401, message: 'Please sign in.' }, 401)

function adminEndpoints() {
  server.use(
    http.get(url('/admin/metrics'), () => json(metrics)),
    http.get(url('/admin/refund-requests'), () => json({ items: [], total: 0, page: 1, pageSize: 10 })),
  )
}

afterEach(() => {
  window.location.hash = ''
})

describe('app shell', () => {
  it('keeps a signed-in customer signed in after a reload, with no switch to the support dashboard', async () => {
    server.use(http.get(url('/health'), () => json({ status: 'ok' })), http.get(url('/customer/session'), () => json({ firstName: 'Ada' })))
    customerApi(conversation())
    render(<App />)

    expect(await screen.findByText('Ada')).toBeInTheDocument()
    expect(screen.getByText(/how can we help\?/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Support dashboard|Customer view/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/Service online/)).not.toBeInTheDocument()
  })

  it('restores the support dashboard from its session cookie after a reload', async () => {
    window.location.hash = '#/admin'
    server.use(http.get(url('/health'), () => json({ status: 'ok' })), http.get(url('/admin/session'), noContent))
    adminEndpoints()
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Support dashboard' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Admin token')).not.toBeInTheDocument()
  })

  it('signs a reviewer in by exchanging the token for a session', async () => {
    window.location.hash = '#/admin'
    let sent: unknown
    server.use(
      http.get(url('/health'), () => json({ status: 'ok' })),
      http.get(url('/admin/session'), unauthorized),
      http.post(url('/admin/session'), async ({ request }) => ((sent = await request.json()), json({ expiresAt: '2026-09-29T12:00:00Z' }))),
    )
    adminEndpoints()
    const user = userEvent.setup()
    render(<App />)

    await user.type(await screen.findByLabelText('Admin token'), 'admin-demo-token')
    await user.click(screen.getByRole('button', { name: 'Open dashboard' }))
    expect(await screen.findByRole('heading', { name: 'Support dashboard' })).toBeInTheDocument()
    expect(sent).toEqual({ token: 'admin-demo-token' })
  })

  it('shows "Trying to reconnect" only while the service is unreachable', async () => {
    let up = false
    server.use(
      http.get(url('/health'), () => (up ? json({ status: 'ok' }) : HttpResponse.error())),
      http.get(url('/customer/session'), unauthorized),
    )
    render(<App />)

    expect(await screen.findByText(/Trying to reconnect/)).toBeInTheDocument()
    up = true
    await vi.waitFor(() => expect(screen.queryByText(/Trying to reconnect/)).not.toBeInTheDocument(), { timeout: 5_000 })
  }, 10_000)
})
