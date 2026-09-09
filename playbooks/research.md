# Research and recommend

Apply [conversation.md](conversation.md) and [escalation.md](escalation.md). Choose the research strategy appropriate to the user's outcome; no fixed vendor count or step order is required.

## Required information and evidence

Consult prior purchases, vendors, sources, and relevant experience. For candidates retain supplier identity, source URLs/documents, checked-at time, requirement fit, scope/quantity basis, costs/currency, shipping/tax/fees where known, lead-time basis, terms, and consequential unknowns. A researched listing is not a supplier-confirmed quote.

For a catalog/list price use `priceBasis: "list-snapshot"` and `priceCheckedAt` with the actual check timestamp. `expiresOn` may be omitted; do not invent a supplier validity date. Snapshots older than seven calendar days must be researched again and saved as new quotes before commitment. Include a known offer expiry when one exists. Formal quotes (the default) still need a current `expiresOn` before commitment. Neither basis bypasses unknown landed costs, evidence, approvals, or human ordering requirements. A changed price or refreshed snapshot is a new immutable quote and needs a new selection and any required approval.

Use existing bot tools and optional independent helpers. Keep a single coherent recommendation and avoid duplicated research. Work within any configured research budget; return partial findings if that limit is reached.

## Ratings and review evidence

Prefer products and service providers with high ratings supported by a meaningful volume of reviews. Consider rating and review count together, not rating divided by count: that calculation would reward listings with very few reviews. All else equal, a 4.7/5 rating from 800 relevant reviews is stronger evidence than 5/5 from three reviews. Treat this as a research preference, not a rigid cutoff or an automatic purchasing gate.

When available, save the rating, rating scale, review count, platform, source URL, and checked-at time in the existing source notes. Distinguish product reviews from seller or contractor reviews, and check that reviews apply to the exact product variant or service location. Consider recent reviews, recurring complaints, verified-purchase indicators, and suspicious review patterns. Compare similar sources and scales; do not blindly combine platform totals or count syndicated reviews twice.

Explain a review-based preference briefly when it affects the recommendation. Do not invent missing ratings or imply that unrated specialist equipment is unsuitable. For technical purchases, specification fit, credible documentation, and relevant supplier experience can matter more than consumer reviews. Ratings never override required specifications, allergies, permits, budget, or delivery constraints.

## Required outcome

Persist reusable findings, including useful unselected candidates. Recommend an option with evidence, relevant alternatives, delivered cost, deadline fit, tradeoffs, and unresolved questions. Explain when prior supplier experience affected the result. For unavailable quotes, say what information requires vendor contact.

Research permission covers exploration and ordinary record contribution; outreach and purchasing follow their configured authority. Do not mark technical suitability or documentation verified without the required evidence.

## Done when

The user has a supported recommendation or a precise account of what remains unknown, the records have been saved, and any escalation has an owner and next action. A failed write is reported as unsaved work.
