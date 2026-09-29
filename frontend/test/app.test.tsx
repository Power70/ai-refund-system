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

    expect(await screen.findByText(/how can we help\?/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Support dashboard|Customer view/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/Service online/)).not.toBeInTheDocument()
  })

  it('restores the support dashboard from its session cookie after a reload', async () => {
    window.location.hash = '#/admin'
    server.use(http.get(url('/health'), () => json({ status: 'ok' })), http.get(url('/admin/session'), noContent))
    adminEndpoints()
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Support dashboard' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
  })

  it('signs a reviewer in with the admin password, and shows "Invalid credentials." for a wrong one', async () => {
    window.location.hash = '#/admin'
    let sent: unknown
    server.use(
      http.get(url('/health'), () => json({ status: 'ok' })),
      http.get(url('/admin/session'), unauthorized),
      http.post(url('/admin/session'), async ({ request }) => {
        sent = await request.json()
        return (sent as { password: string }).password === 'admin' ? json({ expiresAt: '2026-09-29T12:00:00Z' }) : json({ statusCode: 401, message: 'Invalid credentials.' }, 401)
      }),
    )
    adminEndpoints()
    const user = userEvent.setup()
    render(<App />)

    const field = await screen.findByLabelText('Password')
    await user.type(field, 'wrong')
    await user.click(screen.getByRole('button', { name: 'Open dashboard' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid credentials.')

    await user.clear(field)
    await user.type(field, 'admin')
    await user.click(screen.getByRole('button', { name: 'Open dashboard' }))
    expect(await screen.findByRole('heading', { name: 'Support dashboard' })).toBeInTheDocument()
    expect(sent).toEqual({ password: 'admin' })
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

  it('signs a customer in with email and password, and shows "Invalid credentials." for a wrong one', async () => {
    let sent: unknown
    server.use(
      http.get(url('/health'), () => json({ status: 'ok' })),
      http.get(url('/customer/session'), unauthorized),
      http.post(url('/customer/session'), async ({ request }) => {
        sent = await request.json()
        return (sent as { password: string }).password === 'customer' ? json({ firstName: 'Ada', expiresAt: '2026-09-29T12:00:00Z' }) : json({ statusCode: 401, message: 'Invalid credentials.' }, 401)
      }),
    )
    customerApi(conversation())
    const user = userEvent.setup()
    render(<App />)

    await user.type(await screen.findByLabelText('Email'), 'ada.okafor@example.com')
    await user.type(screen.getByLabelText('Password'), 'nope')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid credentials.')

    expect(screen.queryByText(/Demo accounts/i)).not.toBeInTheDocument()
    await user.clear(screen.getByLabelText('Password'))
    await user.type(screen.getByLabelText('Password'), 'customer')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText(/how can we help\?/)).toBeInTheDocument()
    expect(sent).toEqual({ email: 'ada.okafor@example.com', password: 'customer' })
  })

  it('signs a customer out from the top bar, ending the session on the server', async () => {
    let signedOut = false
    server.use(
      http.get(url('/health'), () => json({ status: 'ok' })),
      http.get(url('/customer/session'), () => (signedOut ? unauthorized() : json({ firstName: 'Ada' }))),
      http.delete(url('/customer/session'), () => ((signedOut = true), noContent())),
    )
    customerApi(conversation())
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Sign out' }))
    expect(await screen.findByLabelText('Email')).toBeInTheDocument()
    expect(signedOut).toBe(true)
  })

  it('signs a reviewer out from the top bar, ending the session on the server', async () => {
    window.location.hash = '#/admin'
    let signedOut = false
    server.use(
      http.get(url('/health'), () => json({ status: 'ok' })),
      http.get(url('/admin/session'), noContent),
      http.delete(url('/admin/session'), () => ((signedOut = true), noContent())),
    )
    adminEndpoints()
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Sign out' }))
    expect(await screen.findByLabelText('Password')).toBeInTheDocument()
    expect(signedOut).toBe(true)
  })
})
