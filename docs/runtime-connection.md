# Connect the conversational operator

Use the existing Grok Bot/Slack connection. This repository supplies a command interface and playbooks; it does not install Slack listeners or configure the user's bot account.

## Service side

Run `npm start` on the machine that holds `.env.service.local`. It defaults to loopback on port 47831. Only this service host receives the restricted Postgres service credential. Migration/admin credentials belong to the development environment. The service role cannot alter the schema or update/delete event, quote, or command history.

## Bot side

Give the bot a reachable `PROCUREMENT_URL` and its agent-scoped `PROCUREMENT_KEY` through the existing secure connection. If the service is remote, use HTTPS through the user's authenticated network/reverse proxy. Do not assume the bot's cloud computer can reach a developer laptop's localhost. Do not expose a raw database URL or an owner key to the bot. Transport provisioning is outside this release.

The bot can invoke the CLI from a checkout or call the HTTP routes in [commands.md](commands.md). Load `GET /queries/playbooks` for the deployed procurement instructions and `GET /queries/describe/<command.type>` for input schemas. Keep playbook content revisions with the job's saved context and use stable command keys. Query live status through the service, not Git history.

For a hosted API, follow [hosting](hosting.md). The database and service run in the cloud; the laptop and tunnel are unnecessary. Give Grok Bot this initial instruction with its URL and secure agent key: "Read `/queries/me`, confirm the agent role and Tachyon Demo workspace, then load `/queries/playbooks`. Use `/queries/describe/<type>` to discover commands. Handle my procurement requests through this service and follow its purchasing gates."

The person making an approval uses their own owner/reviewer identity. A bot's statement that a human approved is not an authenticated approval. The current CLI supports a separate owner environment file for that purpose; a Slack integration must preserve the same identity boundary when adding its approval mechanism. Reactions or a message forwarded by the agent are not substitutes for that boundary.

## Connection check

1. Read `me`; confirm the bot's role is `agent`.
2. Submit an arbitrary partial request and query it back.
3. Save a sourced vendor/quote; query the retained evidence.
4. Attempt an owner-only action with the agent key; it must fail.
5. Retry a request with the same key; it must return the same record.
6. Render the Gantt and share the resulting file through the existing channel.

Local CLI/service/database behavior is covered by the repository tests. Grok Bot and Slack operation is only verified after the user's connection has exercised this checklist.
