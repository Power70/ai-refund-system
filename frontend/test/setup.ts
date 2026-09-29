import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { server } from './api'

// jsdom lacks layout APIs the chat uses.
window.matchMedia ??= (query: string) =>
  ({ matches: false, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }) as MediaQueryList
Element.prototype.scrollTo ??= function scrollTo() {}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' })
  // Node's fetch rejects relative URLs; resolve them the way a browser would.
  const intercepted = globalThis.fetch
  globalThis.fetch = (input, init) => intercepted(typeof input === 'string' ? new URL(input, window.location.origin) : input, init)
})

afterEach(() => {
  cleanup()
  server.resetHandlers()
  sessionStorage.clear()
})

afterAll(() => server.close())
