# Procurement Engine

A procurement backend for a conversational operator. Grok Bot handles the conversation and research; this project stores the purchasing knowledge, enforces decisions, and tracks fulfillment in Neon Postgres.

Office supplies, contractor services, and technical equipment share the same lifecycle. Categories and requirements are configuration, so an unfamiliar request does not need a new bot or a custom workflow.

## What works

- Requests, editable category hierarchies, source-backed vendors and quote comparisons.
- Exact landed costs, order-by dates, named blockers, and delivery-change escalations.
- Human classification and evidence verification, version-bound approvals, spending limits, and mandatory human handoffs for expensive or regulated purchases.
- Idempotent simulated checkout with atomic aggregate budgets and explicit unknown-outcome reconciliation.
- Human confirmation records, partial receipts, later technical acceptance, and attributed purchasing experience.
- Vendor/category lead-time observations, with simulated history separated from actual supplier performance.
- A standalone interactive HTML Gantt generated from the same database records.
- Authenticated HTTP command-schema and playbook discovery, plus catalog price snapshots with freshness checks.
- Source-linked requirement checklists, structured ratings/review counts, quote consistency feedback, and separate agent/owner blocker routing.

The automated checkout is **simulated**. This release does not send vendor messages, make payments, or book services. Grok Bot/Slack transport is supplied by the operator; this repository provides the executable interface and conversational playbooks.

## Quick start

Requires Node.js 22+ and a Postgres database. Development uses an isolated Neon branch.

For a cloud service that stays available when your laptop is off, see [Vercel API hosting and demo setup](docs/hosting.md).

```sh
npm ci
npx neon@latest link
```

Select the intended development project/branch. The CLI writes ignored local connection settings. If the branch does not exist, create it with `neon branches create`, then select it with `neon checkout`. The setup and migration scripts reject a branch named `production` by default.

```sh
npm run db:migrate
npm run setup
npm start
```

Setup creates an empty simulation workspace, owner and agent identities, and a restricted database service role. It writes `.env.service.local`, `.env.owner.local`, and `.env.bot.local`; none belongs in Git. Setup refuses to overwrite existing credentials. No example purchasing limits are silently activated.

In another terminal:

```sh
npm run procure -- query me
npm run procure -- describe request.create
npm run procure -- command examples/request.json --key example-optical-intake-v1
npm run procure -- query requests
npm run procure -- gantt artifacts/procurement.html
```

This captures a clearly labeled, incomplete example request. For your own request, create a JSON file matching the command schema. The bot can do that from ordinary conversation. Reuse the same key when retrying the same action.

Owner-only decisions use the separate owner key:

```sh
node --env-file=.env.owner.local --import tsx src/cli.ts query me
node --env-file=.env.owner.local --import tsx src/cli.ts command decision.json --key owner-decision-001
```

The first request can be researched immediately. Purchasing remains blocked until the owner configures policy and the applicable evidence/approvals are present. See [command reference](docs/commands.md) for the lifecycle and exact schema discovery.

## Conversational runtime

Start with [the Procurement Bot playbook](playbooks/README.md). It specifies the information and evidence needed while leaving research strategy and conversation flexible.

The bot gets a scoped service API key, not database credentials or an owner key. The service exposes `POST /commands` and `GET /queries/:name`. [Connection handoff](docs/runtime-connection.md) describes how to use the operator's existing Grok Bot/Slack setup, including the separate human approval identity.

The local service binds to `127.0.0.1:47831`. The [Vercel API deployment](docs/hosting.md) gives a cloud bot an HTTPS endpoint independent of the laptop. No frontend, custom Slack adapter, or model API is required.

## Verification

```sh
npm run typecheck
npm test
npm run test:integration
```

Integration tests require a separate test branch configured in `.env.test.local` with `TEST_DATABASE_URL` and `NEON_BRANCH`. They never fall back to `.env.local`. They create isolated fictional workspaces and retain append-only test history; they do not delete operational records. The suite exercises the actual Postgres transactions and HTTP boundary, including caps under concurrency, retries, unknown outcomes, revoked evidence, stale approvals, partial receipts, replay, schema discovery, and workspace isolation.

The tests generate `artifacts/procurement.html` from persisted synthetic records. Open it in a browser to inspect the timeline. Re-export to refresh a snapshot.

## Structure

| Location | Responsibility |
| --- | --- |
| `src/domain.ts`, `src/policy.ts` | Validated commands, event projection, dates, costs and purchasing rules |
| `src/engine.ts`, `src/db/` | Transactional actions and Postgres records |
| `src/server.ts`, `src/cli.ts` | Authenticated service and bot-friendly client |
| `src/gantt.ts` | Self-contained timeline artifact |
| `drizzle/` | Versioned schema and integrity constraints |
| `playbooks/` | Conversational operating instructions and escalation requirements |
| `tests/` | Unit and database-backed integration checks |

Read [architecture and limitations](docs/architecture.md). Vendor email, proactive routines, live checkout, binary document ingestion, and advanced scheduling are follow-up work.

An independent project exploring procurement operations for hardware teams.
