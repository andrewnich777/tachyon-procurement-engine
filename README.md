# Procurement Engine

A procurement workspace for hardware teams: capture what needs buying, find suitable suppliers, track decisions and delivery, and retain the knowledge for next time.

Office supplies, contractor services, and technical equipment share a purchasing lifecycle. Configurable categories supply the requirements that make each request different.

## Build status

Early development. This repository currently contains the project overview; the application, database schema, and integrations are not implemented yet.

## Planned capabilities

- **Procurement knowledge:** supplier profiles, sourced research, quotes, specifications, and previous purchasing experiences.
- **Request tracking:** ownership, required evidence, landed costs, needed-by dates, and a view of what is blocked and who can resolve it.
- **Purchasing controls:** explicit spending authority, human review for expensive or regulated purchases, and required-document gates.
- **Procurement timelines:** order-by dates based on lead time and buffer, followed by a Gantt view over the same records.
- **Research and communication:** an agent that contributes findings to shared records, with Slack and email integration.

## Design approach

Neon Postgres will hold authoritative procurement records. Application controls will enforce approvals and purchasing limits. An append-only event history will record changes with their actor, time, and evidence. Research findings and actual supplier experience will remain distinguishable.

The first implementation will support the full human-operated purchasing lifecycle. Automated execution will be tested separately before eligible routine orders can run live.

An independent project exploring procurement operations for hardware teams.
