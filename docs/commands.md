# Command reference

The bot uses the CLI or the equivalent HTTP endpoints. It does not need database access. Conversation remains natural; the bot resolves record IDs and constructs command payloads internally.

## Discover the input schema

```sh
npm run procure -- help
npm run procure -- describe request.create
npm run procure -- describe quote.add
```

`describe` generates JSON Schema from the same validation definitions used by the service. It works without credentials. Amounts are integer minor units (USD cents); unknown charges are `null`, not zero. Dates use `YYYY-MM-DD` calendar days; timestamps include a timezone. Current release quantities are positive integers; use an appropriate unit such as milliliters for fractional bulk quantities.

HTTP discovery uses the agent bearer key: `GET /queries/describe` returns all command schemas; `GET /queries/describe/quote.add` returns one. `GET /queries/playbooks` returns all deployed playbooks with content hashes; `GET /queries/playbooks/research` returns one (the `.md` suffix is also accepted). Unknown names return 404. GitHub remains the source for maintaining instructions; the deployed API serves them without a GitHub connector or raw-file fetching.

`quote.add.data.priceBasis` may be `formal-quote` (also the default when omitted) or `list-snapshot`. Formal quotes need a current `expiresOn` to pass purchasing policy. Catalog snapshots can omit it but need `priceCheckedAt` within seven calendar days, never in the future. An explicit catalog expiry is still honored. Research can save incomplete candidates; purchasing remains blocked until charges and required evidence are resolved.

## Structured research

`quote.add.data.evidence` is an optional array for partially researched quotes. Each entry has `criterion`, `status` (`supported`, `contradicted`, `unresolved`), `finding`, and `sources`. Supported/contradicted findings require source evidence. Accepted criteria are `scope`, `availability`, `reviews`, and `requirement:<key>` from the current request. For supported scope, identify every covered request `itemKey` in `itemKeys`; for supported availability, provide the matching request `site`. The server computes cost and deadline checks from saved amounts/dates rather than trusting an agent's status assertion for those fields.

`quote.add.data.reviews` stores distinct observations: `subject` (`product` or `supplier`), exact `target`, `itemKey` for products, `platform`, `rating`, `scaleMax`, `reviewCount`, and `source`. Ratings must fit their scale, counts must be positive integers, and item references must exist. Duplicate observations with the same subject/item/target/platform/URL are rejected. Different sources remain separate; there is no automatic cross-platform average or claim of review authenticity. Document unavailable reviews with an unresolved `reviews` evidence finding; that does not disqualify specialist equipment.

Both quote write responses include `research`, a snapshot assessment with `checklist`, `issues`, structured `reviews`, and `readyToRecommend`. The single-request query returns the refreshed selected-quote assessment as `research` and assessments for every candidate as `quoteAssessments`. Lists and the blocked view include selected-quote research too. Current request revisions, source timestamps, and prices are reassessed on reads. Historical command replays return their original response; query the request for current assessment.

Issues include a stable code, affected field, correction message, and `blocksPurchase`. Price-basis/text conflicts, unsupported vendor timing, contradicted mandatory evidence, future source dates and obsolete quote scope stop commitment. Other incomplete research produces actionable feedback without preventing draft storage or imposing a ratings cutoff. Existing quotes remain readable and are assessed without rewriting history. A corrected quote is a new immutable record with fresh selection and any required approval.

These checks validate structure and recorded consistency; they do not browse source URLs, extract constraints from free text, certify allergen/technical claims, or independently verify review authenticity. Grok must capture consequential requirements and inspect the actual sources. Source-linked research never grants human verification or approval.

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

`me` includes the workspace name and simulation mode. The agent cannot enumerate other workspaces. Single-request and request-list responses both include `selectedQuote` (null only when none is selected) alongside `quoteId`.

Policy blockers and selected-quote research issues include `resolverType` (`agent`, `owner`, or `assigned` for named manual blockers) and `resolverId`. Source/cost/timing corrections route to the enabled agent who created the request, or the earliest enabled workspace agent; if none exists the ID is null, explicitly leaving an assignment gap. Policy/approval/mandatory verification decisions route to the escalation owner. Reads by a different actor do not change assignments. Category/vendor/site purchasing delegation remains an owner decision even though research is agent work.

`request.revision` changes when purchasing requirements change. Supply it as `expectedRevision` where required. `request.version` is the complete event sequence used to identify a snapshot. The CLI returns structured records for the bot to summarize with appropriate evidence; it does not fabricate natural-language answers.

## Render the Gantt

```sh
npm run procure -- gantt artifacts/procurement.html
```

The artifact has search, status/risk filters, request details, forecast bars, order-by and needed-by markers, and actual completion. It embeds only the returned authorized snapshot and runs without a server. It does not refresh itself. Regenerate and share the new file when records change. Treat exports according to the sensitivity of the records they include.

## Constraint provenance and estimates

`request.propose` takes `requestId`, `expectedRevision`, full request `data`, and `reason`. It appends a proposal without changing scope, revision, or approvals. An owner or original authenticated requester applies accepted changes through `request.update`. Agents can still enrich categories, requirements, and notes; changes to captured scope, quantities, destination, budget, timing, or ownership are rejected. `request.confirm` takes `requestId`, `expectedRevision`, and evidence and confirms the current constraints with owner/original-requester authority. Bot-created and legacy constraints remain unconfirmed until then. Queries expose server-derived `constraintProvenance` and proposals with `baseRevision`; outdated proposals must be reconsidered.

Quotes accept optional `costBasis` (`confirmed` or `estimate`) and `costEvidence`; omitted basis is unknown. Confirmation needs final payable evidence at the actual destination. Numeric estimates never clear the final-cost or commitment check. Availability findings need `availability: {basis, location, itemKeys}`; basis is `location-confirmed`, `listing-only`, or `estimate`. Generic pickup listings do not count as local availability. `leadBasis: agent-estimate` records bot assumptions; `owner-estimate` requires owner authority. `recordedBy` is generated by the server and cannot be submitted in quote commands. Existing quotes are immutable and must be replaced to add missing evidence.

Research can continue with a provisional recommendation. `readyToRecommend` reports evidence consistency, not independent source verification. The API does not execute or attest Grok subagents; the runtime playbook requires at least three research workers when delegation is available and an honest fallback otherwise.
