# Command reference

The bot uses the CLI or the equivalent HTTP endpoints. It does not need database access. Conversation remains natural; the bot resolves record IDs and constructs command payloads internally.

## Discover the input schema

```sh
npm run procure -- help
npm run procure -- describe request.create
npm run procure -- describe quote.add
```

`describe` generates JSON Schema from the same validation definitions used by the service. It works without credentials. Amounts are integer minor units (USD cents); unknown charges are `null`, not zero. Dates use `YYYY-MM-DD` calendar days; timestamps include a timezone. Current release quantities are positive integers; use an appropriate unit such as milliliters for fractional bulk quantities.

## Send a command

```sh
npm run procure -- command command.json --key request-42-quote-1
```

HTTP equivalent: `POST /commands`, JSON body, `Authorization: Bearer <scoped key>`, and `Idempotency-Key: <stable key>`. Reuse a key and identical payload for retries. Changed payloads with the same key are rejected. Keys are scoped to workspace and actor; when using multiple channels, derive them from the provider/account/event identity. A blocked result is persisted for that attempt; after resolving the blocker, use a new key for the new attempt.

## Actions

| Command | Purpose | Authority |
| --- | --- | --- |
| `category.create` | Add a category and inherited requirements | Owner or agent |
| `category.update` | Rename, reparent, archive, or change defaults | Owner |
| `vendor.save` | Save sourced vendor information using a stable identity | Owner or agent |
| `request.create` | Capture an arbitrary good or service; incomplete classification/dates may remain unknown | Any authenticated actor |
| `request.update` | Revise the request before an active order | Request access; current revision required |
| `quote.add` | Save a sourced comparison candidate/quote against the current request | Owner or agent |
| `quote.select` | Record the preferred option and rationale | Owner or agent |
| `classification.verify` | Confirm regulated/technical classification | Owner or reviewer |
| `requirement.verify` | Verify evidence for the site's requirement and validity interval | Owner or reviewer |
| `requirement.revoke` | Revoke verification with a reason/evidence | Owner or reviewer |
| `approval.grant` | Approve the selected quote, request revision, policy version and expiry | Owner |
| `approval.revoke` | Withdraw existing purchase approvals | Owner |
| `policy.set` | Configure delegated categories/vendors/sites, caps, currency, timezone and escalation owner | Owner |
| `blocker.add` | Record the blocker, resolver, decision deadline and evidence | Request access |
| `blocker.resolve` | Record a disposition for a manual blocker | Named resolver or owner |
| `checkout.simulate` | Exercise policy and a confirmed/unknown/failed simulated outcome | Owner or agent; all routine gates apply |
| `order.record` | Record an externally supplied human purchase confirmation | Owner; expensive/regulated requests require the designated escalation owner |
| `order.resolve` | Reconcile an unknown outcome using evidence | Owner |
| `order.delivery-update` | Record a changed vendor promise and escalate timing risk | Owner or agent |
| `receipt.record` | Record actual arrival/service quantities and acceptance | Request access; technical acceptance requires owner/reviewer |
| `receipt.accept` | Record later inspection/acceptance of a receipt | Owner or reviewer |
| `feedback.add` | Record attributed experience after fulfillment | Request access |
| `request.close` | Close only when quantities are received/accepted and blockers resolved | Request access |
| `request.cancel` | Cancel a request without an active or unknown order | Request access |

Requirements and regulated status already attached to a request survive reclassification. A request update creates a new revision and invalidates classifications, verifications, and approvals that need fresh review. Quotes are immutable; record a new quote instead of rewriting an old one.

## Read current state

```sh
npm run procure -- query me
npm run procure -- query categories
npm run procure -- query actors
npm run procure -- query policy
npm run procure -- query requests
npm run procure -- query blocked
npm run procure -- query request --id REQUEST_UUID
npm run procure -- query events --id REQUEST_UUID
npm run procure -- query knowledge --q SUPPLIER_OR_ITEM
```

HTTP equivalent: `GET /queries/<name>?id=...&q=...` with the same bearer key. `blocked` returns all open requests with their policy results, missing evidence, manual blockers, resolvers and schedule. `knowledge` searches vendor identity, source notes, purchases and attributed experience. It reports real and simulated observations separately and includes category-specific lead-time summaries.

`request.revision` changes when purchasing requirements change. Supply it as `expectedRevision` where required. `request.version` is the complete event sequence used to identify a snapshot. The CLI returns structured records for the bot to summarize with appropriate evidence; it does not fabricate natural-language answers.

## Render the Gantt

```sh
npm run procure -- gantt artifacts/procurement.html
```

The artifact has search, status/risk filters, request details, forecast bars, order-by and needed-by markers, and actual completion. It embeds only the returned authorized snapshot and runs without a server. It does not refresh itself. Regenerate and share the new file when records change. Treat exports according to the sensitivity of the records they include.
