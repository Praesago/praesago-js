import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { Praesago, AuthenticationError, InsufficientCreditsError, NotFoundError, RateLimitError, PraesagoError } from '../dist/index.js'

let server
let base
let requests = []
let replies = []

before(async () => {
  server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      requests.push({ method: req.method, path: req.url, headers: req.headers, body })
      const [status, payload, headers] = replies.shift() ?? [200, { success: true, data: {} }, {}]
      const raw = typeof payload === 'string' ? payload : JSON.stringify(payload)
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers })
      res.end(raw)
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
})
after(() => server.close())
beforeEach(() => { requests = []; replies = [] })

const client = (o = {}) => new Praesago({ apiKey: 'test-key', baseUrl: base, ...o })

test('district path, key, unwrap and credits', async () => {
  replies.push([200, { success: true, data: { district: 'E17' } }, { 'X-Credits-Charged': '3', 'X-Credits-Remaining': '497' }])
  const c = client()
  assert.deepEqual(await c.district(' e17 '), { district: 'E17' })
  assert.equal(requests[0].path, '/api/agent/v1/district/E17')
  assert.equal(requests[0].headers['x-api-key'], 'test-key')
  assert.match(requests[0].headers['user-agent'], /^praesago-js\//)
  assert.deepEqual(c.lastCredits, { charged: 3, remaining: 497 })
})

const cases = [
  [(c) => c.district('E17', ['property', 'crime']), '/api/agent/v1/district/E17?sections=property%2Ccrime'],
  [(c) => c.context('E17'), '/api/v1/districts/E17/context'],
  [(c) => c.sectors('E17'), '/api/v1/districts/E17/sectors'],
  [(c) => c.soldPsf('E17'), '/api/v1/districts/E17/sold-psf'],
  [(c) => c.rental('E17'), '/api/v1/districts/E17/rental'],
  [(c) => c.priceHistory('E17', { months: 24 }), '/api/v1/districts/E17/price-history?months=24'],
  [(c) => c.planning('E17', { months: 6 }), '/api/v1/planning/E17?months=6'],
  [(c) => c.listings('E17', { channel: 'rent' }), '/api/v1/listings/E17?channel=rent'],
  [(c) => c.movers({ metric: 'inventory' }), '/api/v1/listings/movers?metric=inventory'],
  [(c) => c.search('Walthamstow', { limit: 5 }), '/api/v1/districts/search?q=Walthamstow&limit=5'],
  [(c) => c.screen({ min_yield_pct: 6, sort_by: 'yield' }), '/api/v1/screen?min_yield_pct=6&sort_by=yield'],
  [(c) => c.compare('E17', 'E18'), '/api/v1/compare?a=E17&b=E18'],
  [(c) => c.catalogue(), '/api/v1/catalogue'],
  [(c) => c.demo(), '/api/v1/demo'],
]
for (const [call, path] of cases) {
  test(`path ${path}`, async () => {
    await call(client())
    assert.equal(requests[0].path, path)
  })
}

test('batch posts JSON', async () => {
  await client().batch(['E17', 'CF10'])
  assert.equal(requests[0].method, 'POST')
  assert.equal(requests[0].path, '/api/v1/districts/batch')
  assert.deepEqual(JSON.parse(requests[0].body), { districts: ['E17', 'CF10'] })
  assert.equal(requests[0].headers['content-type'], 'application/json')
})

for (const [status, code, Cls] of [[401, 'invalid_key', AuthenticationError], [402, 'insufficient_credits', InsufficientCreditsError], [404, 'not_found', NotFoundError]]) {
  test(`error ${status}`, async () => {
    replies.push([status, { success: false, data: null, error: 'nope', code, request_id: 'req_1' }])
    await assert.rejects(client().context('ZZ99'), (e) => e instanceof Cls && e instanceof PraesagoError && e.code === code && e.requestId === 'req_1' && e.status === status)
  })
}

test('429 retries then succeeds', async () => {
  replies.push([429, { success: false, error: 'slow', code: 'rate_limited' }, { 'Retry-After': '0' }])
  replies.push([200, { success: true, data: [1] }])
  assert.deepEqual(await client().search('x'), [1])
  assert.equal(requests.length, 2)
})

test('429 gives up after retries', async () => {
  for (let i = 0; i < 3; i++) replies.push([429, { success: false, error: 'slow', code: 'rate_limited' }, { 'Retry-After': '0' }])
  await assert.rejects(client({ maxRetries: 2 }).search('x'), RateLimitError)
  assert.equal(requests.length, 3)
})

test('non-JSON 404', async () => {
  replies.push([404, '<!DOCTYPE html>'])
  await assert.rejects(client().context('E17'), NotFoundError)
})

test('no key sends no header', async () => {
  await new Praesago({ apiKey: '', baseUrl: base }).demo()
  assert.equal(requests[0].headers['x-api-key'], undefined)
})

// ---- live calls: only endpoints that need no key ----
test('live: demo and catalogue', async () => {
  const c = new Praesago({ apiKey: '' })
  assert.equal((await c.demo()).district.district, 'E17')
  assert.match((await c.catalogue()).coverage, /England and Wales/)
})

test('live: bad key is AuthenticationError on the full district route', async () => {
  await assert.rejects(new Praesago({ apiKey: 'not-a-real-key', maxRetries: 0 }).district('E17'), (e) => e instanceof AuthenticationError && e.code === 'invalid_key')
})
