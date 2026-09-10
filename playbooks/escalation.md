# Escalation requirements

These requirements govern runtime procurement. They do not introduce approval steps for normal developer work on the repository or development database.

## Hard boundaries

| Trigger | Required action |
| --- | --- |
| Expensive or regulated purchase | Assign to the configured human escalation owner. Human ordering only; approval does not grant the routine executor permission to place it. |
| Required permit/license missing, expired, revoked, mismatched, or unverified | Block order release. Identify the precise evidence and reviewer needed. Upload alone is not verification. |
| Mandatory compatibility, specification, or allergy evidence unresolved | Block the affected commitment and ask the designated reviewer. Do not invent suitability. |
| Purchase exceeds authority, total is unresolved, or approved scope changes materially | Obtain a decision bound to the exact revised purchase; reevaluate policy before execution. |
| Delivery misses needed-by or a decision deadline passes | Persist and notify the owner of the impact and response options. Do not accept new scope, extra spend, substitutions, or a changed required date on the owner's behalf. |
| Conflicting evidence affects a decision | Present the conflict and source dates; hold the affected commitment until resolved. |
| External action outcome is unknown | Preserve action identity and reservation; reconcile before retrying. |
| Contact, booking, subscription, or purchase lacks the applicable authority | Prepare the work and request the specific missing authorization before acting. |

Every escalation records the reason, evidence, affected action, resolver, response options, and decision deadline or explicit unknown. Silence and message reactions do not clear a purchasing gate. Resolve only with the required verified evidence or authorized disposition.

Continue permitted research on the same request, as well as unrelated permitted research, while a commitment is blocked. No human approval is needed to expand native research workers, investigate ratings or compare better candidates within the authorized research scope. Escalations should not stop the whole request unnecessarily. Suppress repeated unchanged alerts; notify on material changes or an overdue decision.

Use the returned `resolverType` and `resolverId`. Research issues and agent-owned blockers are work for the Procurement Bot, not automatic requests for owner approval. Investigate missing prices, tax, stock, timing and product evidence; ask the user only for facts you cannot establish or choices they must make. Owner/reviewer verification remains separate even when research has supporting sources. A manual blocker's named resolver is preserved.

The backend enforces amounts, approval scope, documentation validity, state transitions, and idempotency. Conversational instructions and native bot approval controls complement that enforcement.
