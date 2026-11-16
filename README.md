# praesago (JavaScript and TypeScript)

Client for the [Praesago API](https://praesago.com/docs/api): property and area data for every postcode district in **England and Wales**. Sold prices, sector prices, price per square foot, rents and yields, weekly asking-market statistics, planning, crime, schools, flood risk, broadband and more, from official sources joined in one place.

No dependencies. Node 18 or later, Deno, Bun and edge runtimes (it uses `fetch`). Types included.

```bash
npm install praesago
```

## Start

Create a key at <https://praesago.com/settings/api-keys>. Every account gets 500 free credits each month.

```ts
import { Praesago } from 'praesago'

const client = new Praesago()               // reads PRAESAGO_API_KEY
const e17 = await client.district('E17')    // everything for one district
console.log(e17.area_name, e17.median_sold_price_gbp)
console.log(client.lastCredits)             // { charged: 3, remaining: 497 }
```

Try it without a key:

```ts
await new Praesago().demo()        // real figures for E17
await new Praesago().catalogue()   // every source, licence, period and coverage
```

Keep your key on the server. Do not put it in code that runs in a browser.

## Examples

```ts
// Buy-to-let screen: 6% or higher asking yield under £250,000
await client.screen({ min_yield_pct: 6, max_median_price_gbp: 250000, sort_by: 'yield', limit: 10 })

// Two districts side by side
await client.compare('E17', 'CF10')

// Headline facts for up to 50 districts (1 credit for each district found)
await client.batch(['E17', 'M14', 'LS6', 'CF24'])
```

## All methods

| Method | What it returns |
|---|---|
| `district(d, sections?)` | Everything held for one district. `sections` limits the reply. |
| `context(d)` | Market context for a district |
| `sectors(d)` | Sold prices by postcode sector (a median needs 10 or more sales) |
| `soldPsf(d)` | Sold price per square foot (houses) |
| `rental(d)` | Rent and yield by bedrooms, rental demand, Local Housing Allowance |
| `priceHistory(d, { months })` | Monthly HPI and yearly ONS medians |
| `planning(d, { months })` | Planning activity (1 to 24 months) |
| `listings(d, { channel, weeks, source })` | Weekly asking-market statistics |
| `movers({ channel, metric, limit })` | Biggest week-over-week changes |
| `search(q, { limit })` | Find districts by outcode or place name |
| `screen(filters)` | Filter districts by price, rent, listings, price cuts, yield, region |
| `compare(a, b)` | Two districts side by side |
| `batch(districts)` | Headline facts for up to 50 districts |
| `catalogue()` | Sources and coverage (no key) |
| `demo()` | Fixed demo district (no key) |

Credit costs for each call are on the [pricing page](https://praesago.com/pricing).

## Errors

Every error is a `PraesagoError` with `status`, `code` (stable, branch on it), `requestId` (quote it to support) and `retryAfter`. Subclasses: `AuthenticationError` (401), `InsufficientCreditsError` (402), `NotFoundError` (404), `RateLimitError` (429), `BadRequestError` (400), `ServerError` (5xx).

```ts
import { NotFoundError, InsufficientCreditsError } from 'praesago'

try {
  await client.district('ZZ99')
} catch (e) {
  if (e instanceof NotFoundError) { /* not a district in England and Wales */ }
  if (e instanceof InsufficientCreditsError) { /* buy credits at https://praesago.com/pricing */ }
}
```

The client retries rate limits (429), server faults (5xx) and network faults twice, with back-off. Change it with `new Praesago({ maxRetries: 0 })`.

## Also

- MCP server for AI assistants: <https://praesago.com/docs/mcp>
- Python client: [`praesago` on PyPI](https://pypi.org/project/praesago/)

MIT licence.
