import { day, hash, policyData, schedule, total, type State, type QuoteData, type Policy } from './domain.js';

export type Block = { code: string; reason: string; resolverId: string | null };
export function evaluate(s: State, quote: {id:string; vendorId:string; data:QuoteData & {requestRevision:number}} | null,
  rawPolicy: unknown, spent: number, categoryAllowed: boolean, now = new Date(), policyVersion=0) {
  const blocks: Block[] = [];
  const parsed = policyData.safeParse(rawPolicy);
  const p: Policy | null = parsed.success ? parsed.data : null;
  const owner = p?.escalationOwnerId ?? s.data.ownerId ?? s.requesterId;
  const block = (code:string, reason:string) => blocks.push({code,reason,resolverId:owner});
  if (!p) block('policy-unconfigured','Configure purchasing policy before commitment.');
  if (['closed','canceled'].includes(s.status)) block('request-finished','This request is already finished.');
  if (s.data.items.some(i=>!i.categoryId)) block('classification-missing','Classify every item before commitment.');
  if (!s.classification || s.classification.revision !== s.revision) block('classification-unverified','A human reviewer must verify purchasing classification.');
  const regulated = s.data.regulated || s.classification?.regulated === true;
  const technical = s.data.technical || s.classification?.technical === true;
  if (!quote) block('quote-missing','Select a sourced quote.');
  const q = quote?.data;
  const amount = q ? total(q.costs) : null;
  const today = day(now);
  if (q && q.requestRevision !== s.revision) block('quote-stale','Record a quote against the current request revision.');
  if (q && amount === null) block('cost-unknown','Resolve shipping, tax, hazmat, and other current charges.');
  if (q && (!q.expiresOn || q.expiresOn < today)) block('quote-expired','A current quote validity date is required.');
  if (p && q && (q.currency!==p.currency || s.data.currency!==p.currency)) block('currency-mismatch','Request, quote, and policy currency must match; FX conversion is not automatic.');
  if (amount !== null && s.data.budgetCents !== null && amount>s.data.budgetCents) block('request-budget','Quote exceeds the request budget.');
  const expensive = !!p && amount !== null && amount>=p.expensiveThreshold;
  const humanOnly = regulated || expensive;
  const timing = schedule(s, q ?? null, today);
  const requiredThrough = timing.forecast ?? s.data.neededBy ?? today;
  for (const r of s.data.requirements) {
    const v = s.verifications[r.key];
    if (!v || v.revision!==s.revision || v.site!==s.data.site || (r.material && r.material!==v.material)
      || v.validFrom>today || v.validUntil<requiredThrough) block('requirement:'+r.key,`Verified, applicable evidence required: ${r.label}.`);
  }
  if (regulated && !s.data.requirements.some(r=>r.kind==='permit')) block('permit-requirement','A reviewer must establish the applicable permit/license requirement.');
  if (technical && !s.data.requirements.some(r=>r.kind==='specification')) block('technical-requirement','A reviewer must establish the technical specification requirement.');
  for (const b of Object.values(s.blockers)) blocks.push({code:'blocker:'+b.id, reason:b.reason, resolverId:b.resolverId});
  const decision = s.approvals.findLast(a => a.revision===s.revision && a.quoteId===quote?.id
    && a.policyHash===hash({policy:rawPolicy,version:policyVersion}) && Date.parse(a.expiresAt)>+now);
  if(timing.late && !decision?.acceptScheduleRisk) block('schedule-risk','Delivery and receiving buffer miss needed-by; an owner disposition is required.');
  if (!decision && (p?.requireRoutineApproval || humanOnly)) block('approval-required','Owner approval must cover this quote, request revision, and policy.');
  // The human-order path still requires evidence/approval, but routine delegation limits do not authorize it.
  const routineBlocks = [...blocks];
  if (humanOnly) routineBlocks.push({code:'human-order-only',reason:regulated?'Regulated purchase: human ordering only.':'Expensive purchase: human ordering only.',resolverId:owner});
  if (p && q) {
    if (amount!==null && amount>p.perOrderCap) routineBlocks.push({code:'per-order-cap',reason:'Routine per-order cap exceeded.',resolverId:owner});
    if (amount!==null && amount+spent>p.dailyCap) routineBlocks.push({code:'daily-cap',reason:'Daily authority includes confirmed and outcome-unknown reservations.',resolverId:owner});
    if (!categoryAllowed) routineBlocks.push({code:'category-not-delegated',reason:'Category is not delegated for routine purchasing.',resolverId:owner});
    if (!p.allowedVendorIds.includes(quote!.vendorId)) routineBlocks.push({code:'vendor-not-delegated',reason:'Vendor is not delegated for routine purchasing.',resolverId:owner});
    if (!p.allowedSites.includes(s.data.site)) routineBlocks.push({code:'site-not-delegated',reason:'Destination is not delegated for routine purchasing.',resolverId:owner});
  }
  return { allowed:routineBlocks.length===0, humanAllowed:blocks.length===0, humanOnly, regulated, expensive,
    totalCents:amount, currency:q?.currency ?? s.data.currency, spentCents:spent, blocks:routineBlocks,
    humanBlocks:blocks, schedule:timing, policyHash:hash({policy:rawPolicy,version:policyVersion}), escalationOwnerId:owner };
}
