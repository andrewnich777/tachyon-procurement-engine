# Hosted procurement API

Vercel runs `api/index.ts`, which uses the same handler and purchasing engine as the local server. Neon remains the live database. There is no frontend or model API dependency. The function shares a connection pool managed by Vercel's lifecycle helper. The API accepts the existing scoped bearer keys stored as hashes in Neon.

## Deployment

1. Link the repository to a Vercel project with the **Other** framework preset and Node.js 22 or 24.
2. Set `DATABASE_URL` as a sensitive Vercel environment variable using the **restricted service connection** from `.env.service.local`. Never upload migration/admin credentials, `.env.owner.local`, or `.env.bot.local`.
3. Deploy. `vercel.json` routes requests into the function and packages the public playbooks. `.vercelignore` allows only runtime source, playbooks, and build configuration; private planning, credentials, test data and artifacts are excluded.
4. For bot access, the chosen deployment alias must allow API traffic without a Vercel browser login. Application bearer authentication stays enabled. Point `PROCUREMENT_URL` to that stable HTTPS alias.
5. Give the bot only its existing agent key and the URL; load `/queries/playbooks` and `/queries/describe` over the service. Owner decisions still use a separate owner identity.

Preview and production environment variables are separate. A production deployment should use the same approved service database or an explicitly provisioned replacement. Deploying never runs migrations, seeds fixtures, changes policy, or rotates keys.

## Demo data

Run `npm run demo:seed` explicitly on the trusted operator machine. It authenticates the local owner against the restricted service connection, requires a simulation workspace, and stages three labeled fictional examples: snacks with dietary verification and simulated purchase approval, an expensive technical pump pending review, and helium pending permit/license evidence and human approval. It places no orders.

For an unconfigured workspace only, it installs fictional USD authority: $250 per routine order, $1,000 daily, and mandatory human ordering at $1,000 or for regulated purchases. Its allowlists cover only the seeded categories, fictional vendor and fictional site. Existing configured policies are preserved. Seeds use fixed action keys, retain existing requests/history, and do not duplicate records on rerun. Dates are anchored on the first seed run; stale evidence must be refreshed through normal commands, not by rerunning the seed.

All API reads are scoped to the authenticated workspace. Integration tests require a separate `.env.test.local` with `TEST_DATABASE_URL` and `NEON_BRANCH`; they never fall back to the demo connection. Existing historical test workspaces need not be deleted to keep them out of the bot's view.

## Runtime limitations

The hosted API does not add live checkout, vendor outreach, Slack event listeners, or bot scheduling. The bot provides those conversational connections. Gantt files remain generated snapshots. The policy checks catalog snapshot freshness for seven calendar days; it does not continuously poll supplier prices.
