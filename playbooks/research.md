# Research and recommend

Apply [conversation.md](conversation.md) and [escalation.md](escalation.md). Choose the research strategy appropriate to the user's outcome; no fixed vendor count or step order is required.

## Research authority

The user's procurement request already authorizes ordinary research, comparison, saving candidates, and native research delegation. Do not ask for human approval to run three or more research workers, investigate ratings, replace weak candidates, or improve an answer. Purchase approval, permit/allergy verification, and constraint confirmation gate commitment, not research on the same request. Continue the research that can be done while those decisions are pending. Ask only for genuinely missing facts that block the next investigation, such as the actual store/address.

Check allergies, permits and specifications in the first pass. Never change constraints to make readyToRecommend true. A useful provisional recommendation with honest unknowns is success; repeating the prior cart without fresh comparison is not reassessment. Keep schema dumps internal and use ordinary request titles.

## Required information and evidence

Consult prior purchases, vendors, sources, and relevant experience. For candidates retain supplier identity, source URLs/documents, checked-at time, requirement fit, scope/quantity basis, costs/currency, shipping/tax/fees where known, lead-time basis, terms, and consequential unknowns. A researched listing is not a supplier-confirmed quote.

For a catalog/list price use `priceBasis: "list-snapshot"` and `priceCheckedAt` with the actual check timestamp. `expiresOn` may be omitted; do not invent a supplier validity date. Snapshots older than seven calendar days must be researched again and saved as new quotes before commitment. Include a known offer expiry when one exists. Formal quotes (the default) still need a current `expiresOn` before commitment. Neither basis bypasses unknown landed costs, evidence, approvals, or human ordering requirements. A changed price or refreshed snapshot is a new immutable quote and needs a new selection and any required approval.

## Scale research to the task

Use at least three native research workers for each new research job when delegation is available. The coordinating bot is additional to those workers. Status lookups and record corrections do not require a new swarm. Choose the size from the number of independent questions, breadth of the supplier search, and consequences of a wrong recommendation—not just purchase price. The user should not need to specify an agent count. Three workers is the minimum; scale upward only for useful independent work:

| Research scope | Suggested parallel research workers |
| --- | --- |
| Straightforward item with clear requirements and familiar sources | 3: discovery, requirement verification, and cost/availability/review challenge |
| Several viable sources or a consequential constraint such as an allergy, compatibility, or contractor credentials | 3–5, with a distinct evidence-checking assignment |
| Broad supplier discovery or complex equipment with several independent specification/logistics questions | 6–8 only when that many useful, non-overlapping assignments exist |

For allergy-constrained snacks, useful assignments are product/retailer discovery, exact-product allergen documentation, and reviews plus landed-cost/availability checks. For services or equipment, choose specialties relevant to that request. Several agents searching the same generic query is not a thorough investigation.

Give each worker the shared requirements, a bounded question, source/evidence expectations, and a stopping condition. Workers return candidate identifiers, URLs, checked-at times, supported claims, contradictions, and unknowns. Research workers do not contact suppliers, purchase, approve, or modify procurement records. The coordinating Procurement Bot deduplicates findings, resolves conflicts, and persists one coherent result through the API.

Keep expansion within the available research time, usage, and user constraints. Stop when the shortlist is adequately supported or a specific missing fact requires external input; do not grow the swarm to repeat completed work. If native delegation is unavailable or resource limits prevent three workers, explicitly report that limitation and perform the three distinct research and review passes yourself. Do not claim that agents ran unless they actually did.

## Check evidence before recommending

Have an independent worker challenge consequential recommendations when delegation is available; otherwise perform a separate review pass. Check the proposed option against each hard requirement, inspect the strongest disqualifying evidence, and check the exact item/variant, supplier, quantities, price, and timing. A second agent's agreement is not evidence. Unresolved conflicting sources remain explicit blockers, not majority-vote decisions.

For food allergies, distinguish ingredients, precautionary allergen statements, and manufacturer facility information. Do not infer suitability from a product being corn-based, vegan, popular, or lacking an observed warning. Seek current documentation for the exact product and retain the source of each claim. If that evidence cannot be established, label suitability unresolved and continue looking for better-documented candidates. Investigate allergy constraints in the first research pass and replace unsuitable candidates without asking permission to continue the already-authorized search. Agent research does not replace the required human allergy verification.

Do not turn assumptions into vendor-confirmed facts. If local stock, pickup eligibility, tax, freight, or delivery timing is unknown, persist it as unknown. Set `leadDays: null` when unsupported; use `leadBasis: "vendor"` only for evidenced supplier timing. A price below the budget before unresolved charges is not a confirmed within-budget total. Save catalog pricing with the structured `priceBasis` and `priceCheckedAt` fields, not merely a note saying "list-price snapshot".

Before reporting completion, read the saved request back. Check that the selected quote, evidence notes, ratings/review counts where available, and unresolved blockers match the recommendation. Correct avoidable schema or classification-of-price errors through the API. Do not claim research is complete when a central requirement was only deferred to the user without attempting to investigate it. If a source cannot be accessed or the research budget is exhausted, report that specific limitation and the next useful action.

## Ratings and review evidence

Prefer products and service providers with high ratings supported by a meaningful volume of reviews. Consider rating and review count together, not rating divided by count: that calculation would reward listings with very few reviews. All else equal, a 4.7/5 rating from 800 relevant reviews is stronger evidence than 5/5 from three reviews. Treat this as a research preference, not a rigid cutoff or an automatic purchasing gate.

When available, save observations in `quote.add.data.reviews`: `subject` (product or supplier), `target` (exact variant or supplier/location), `itemKey` for product reviews, `platform`, `rating`, `scaleMax`, `reviewCount`, and `source` (URL, note, checkedAt, fictional only for synthetic evidence). Record observations separately; do not compute rating divided by count or combine platform totals. Distinguish product reviews from seller or contractor reviews and check relevance to the exact purchase. Consider recent reviews, recurring complaints, verified-purchase indicators, and suspicious review patterns; retain those details in source notes. Do not count syndicated reviews twice.

Explain a review-based preference briefly when it affects the recommendation. Do not invent missing ratings or imply that unrated specialist equipment is unsuitable. For technical purchases, specification fit, credible documentation, and relevant supplier experience can matter more than consumer reviews. Ratings never override required specifications, allergies, permits, budget, or delivery constraints.

## Cover every recommended product or provider

Populate quote.add.data.recommendation with one entry per exact product/variant or service provider in the candidate cart. A generic request item such as "snack assortment" can map to multiple entries; do not change the user's requested scope to itemize candidate products. Each entry has key, itemKey (the request item), subject (product or supplier), and target (exact variant/provider/location).

Link each applicable review with recommendationKey and matching itemKey, subject and target. One product rating or a retailer rating cannot cover another product. For each target, save rating, scaleMax, reviewCount, platform and checked source; otherwise save reviewGap: {reason, sources} describing the actual places investigated. Lack of reviews is not automatically disqualifying, especially for specialized equipment. Never invent counts, pool syndicated reviews, or calculate rating divided by review count.

Each entry also needs comparison: {rationale, alternatives: [{target, reason, sources}]}. Explain how rating AND review count, exact-product relevance, hard requirements, quantity and price affected the choice. Alternatives must be real researched options, not a second name for the winner. If no relevant alternative exists, use alternatives: [] and noAlternative: {reason, sources} inside comparison to document the search. Do not manufacture competitors to satisfy a schema.

Read research.reviewCoverage and address missing reviews/comparisons yourself. These are research-quality issues, not human approval requests or additional purchasing gates. research.researchPermission explicitly confirms research needs no approval. Report the recommendation with the meaningful rating/count evidence for each product and a concise comparison, or explain where evidence was unavailable. The API checks recorded structure, not the truth of web content or whether workers actually ran.

## Persist and inspect the evidence checklist

Load the current `quote.add` schema before constructing the quote. In `data.evidence`, record one finding per criterion: `scope`, `availability`, `reviews` when explaining unavailable or conflicting review information, and `requirement:<key>` for every request requirement. Each finding has `status` (`supported`, `contradicted`, or `unresolved`), a specific `finding`, and `sources`. Supported and contradicted assertions require sources. Scope findings identify covered `itemKeys`; supported availability identifies the exact request `site`. Unknown criteria, duplicate criteria, and references to nonexistent request items are rejected. These are research assertions, never a substitute for human verification.

Inspect `research` in `quote.add` and `quote.select` responses. Then read the saved request: `research` describes the selected quote, and `quoteAssessments` covers all candidates. The server builds a checklist covering scope, availability, each requirement, reviews, final cost, and the deadline. `readyToRecommend` means human-confirmed request constraints and recorded evidence meet the consistency checks; it does not mean independently verified, approved, or ordered. A provisional recommendation is allowed if its material unknowns are stated clearly. Never call an incomplete assessment verified or complete.

Act on `research.issues` before presenting a final recommendation. They name the affected field and correction; `blocksPurchase` identifies issues that also stop commitment. To repair an immutable quote, save a corrected quote and select it; do not edit prior evidence or claim that successful storage means the research passed. Leave other candidate records intact. Known contradictory mandatory evidence and unsupported vendor timing cannot be cleared merely by purchase approval.

Request queries attach `resolverType` and `resolverId` to policy blockers and research issues. Handle `agent` work yourself: source gaps, unknown charges, stale pricing, and incorrectly recorded facts. Send `owner` decisions to the named human: authorization, limits, category/vendor/site delegation, and required verification. Respect `assigned` resolvers on manual blockers. A missing resolver ID means no enabled research agent is available; surface that assignment gap. Keep this checklist internal and summarize only the findings or decisions the user needs.

## Facts, estimates, and constraints

Never change needed-by, buffer, budget, destination, quantity, or requested scope to clear a research issue. Unknown needed-by stays null. Use request.propose for suggested changes; it does not alter the request. An authenticated owner/original requester accepts the change using request.update, or confirms accurately captured constraints with request.confirm. A chat instruction reported by the bot is not an authenticated human confirmation. Keep researching while confirmation is pending; never ask for the owner key.

Use costBasis: estimate for any estimated charge, even when every numeric cost is filled in. Use costBasis: confirmed only with costEvidence for the final payable total at the actual destination, including shipping/tax/fees. Omitted basis is unknown. An estimated total within budget supports a provisional suggestion, not a confirmed under-budget claim.

Supported availability requires evidence.availability with basis: location-confirmed, the specific location (actual store/address or delivery destination), and every covered itemKey. A generic listing showing a Pickup button uses listing-only; assumed pickup uses estimate. The request site label alone is not location evidence. Confirm exact variants, quantities, local stock or delivery eligibility, and timing in the cited source.

Use leadBasis: agent-estimate for your own timing assumptions. owner-estimate is restricted to authenticated owner writes; historical timing is also an estimate, not a supplier promise. Quote recordedBy and request constraintProvenance are server-generated audit metadata; never supply them in command data or copy them when refreshing a quote. Do not change the basis merely to remove an issue.

Readiness is not independent verification of web content. A provisional recommendation can be useful: state the estimate, unresolved facts, and the single consolidated question or human action needed. Do not stall the research or repeatedly ask permission to look for suitable alternatives.

## Required outcome

Persist reusable findings, including useful unselected candidates. Recommend an option with evidence, relevant alternatives, delivered cost, deadline fit, tradeoffs, and unresolved questions. Explain when prior supplier experience affected the result. For unavailable quotes, say what information requires vendor contact.

Research permission covers exploration and ordinary record contribution; outreach and purchasing follow their configured authority. Do not mark technical suitability or documentation verified without the required evidence.

## Done when

The user has a supported recommendation or a precise account of what remains unknown, the records have been saved, and any escalation has an owner and next action. A failed write is reported as unsaved work.
