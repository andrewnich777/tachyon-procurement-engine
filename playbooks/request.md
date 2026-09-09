# Capture a procurement request

Apply [conversation.md](conversation.md) and [escalation.md](escalation.md). Capture any good or service in the shared lifecycle.

## Required outcome

Persist the requested outcome, line items or service scope, quantities/units, site/destination, needed-by date, requester/owner, budget context, and evidence supplied. Classify using the editable category tree; ambiguous classification may remain in triage.

Use a concise item or service name as the title. Do not prefix it with the workspace name, execution mode, or a scenario label. Unknown facts stay unknown; do not fill them from repository examples or prior staged exercises.

Load category defaults and request-specific preferences/specifications. Reuse available context. Ask only for consequential missing inputs; research can begin before all buying requirements are settled.

## Done when

The need is recorded with its current requirements, owner, and next action, or a partial request identifies what is missing and who can resolve it. Return a natural acknowledgment and useful follow-up; technical identifiers are recorded internally.

Intake does not itself authorize external contact or purchasing. New categories do not create buying authority.

Protect captured user constraints. Agent request.update may enrich categories and notes but cannot change scope, quantities, destination, neededBy, bufferDays, budget, currency, or ownership. Save suggested changes with request.propose and present them for human acceptance. The owner/original requester applies an accepted proposal using request.update at the current revision. request.confirm records human confirmation of the current captured constraints without changing revision. Research can continue provisionally while confirmation is pending. Do not invent a date to satisfy the checklist.
