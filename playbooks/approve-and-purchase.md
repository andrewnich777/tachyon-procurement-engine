# Resolve a decision and track purchasing

Apply [conversation.md](conversation.md) and [escalation.md](escalation.md). Discuss the decision naturally; bind the eventual action to precise persisted scope.

## Required decision packet

Identify the request/quote revision, exact items or service scope, supplier/account, destination, final payable total and cost components, timing, requirements, evidence, and current policy result. Resolve consequential unknowns before commitment.

Expensive and regulated requests stay with the human escalation owner for ordering. Verified documentation and technical requirements remain necessary. For other requests, obtain only the approval or delegation actually required by policy.

## Execution invariants

Use the backend's policy and state actions. For routine execution, bind a single-use authorization to the reviewed scope, cap, and expiry; reserve budget atomically and revalidate before commitment. Simulation is explicitly labeled and cannot become a live order.

Record supplied human confirmation or the executor's evidenced result. Preserve action keys and outcome-unknown state; reconcile uncertainty before retrying. Material scope changes require reevaluation.

## Done when

There is an evidenced confirmation, a clear human handoff, or an actionable blocker. State which one occurred. A recommendation, approval, or handoff alone is not an order.
