import { z } from 'zod';
import { createHash } from 'node:crypto';

export class Problem extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function fail(message: string, status = 400): never { throw new Problem(status, message); }
export const id = z.string().uuid();
export const short = z.string().trim().min(1).max(2000);
export const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
  const d = new Date(v + 'T00:00:00Z'); return !isNaN(+d) && d.toISOString().slice(0, 10) === v;
}, 'Invalid calendar date');
const cents = z.number().int().min(0).max(100_000_000);
export const source = z.object({ url: z.url().refine(v => /^https?:\/\//i.test(v), 'HTTP(S) evidence only'),
  note: short, checkedAt: z.iso.datetime(), fictional: z.boolean().default(false) }).strict();
export const requirement = z.object({ key: z.string().regex(/^[a-z0-9_-]{1,64}$/), label: short,
  kind: z.enum(['specification', 'allergy', 'document', 'permit']), material: short.optional() }).strict();
export const defaults = z.object({ regulated: z.boolean().default(false), technical: z.boolean().default(false),
  requirements: z.array(requirement).max(30).default([]) }).strict();
export const item = z.object({ key: z.string().regex(/^[a-z0-9_-]{1,64}$/), description: short,
  quantity: z.number().int().min(1).max(1_000_000), unit: short.default('each'), categoryId: id.nullable() }).strict();
export const requestData = z.object({ title: short, description: z.string().max(8000).default(''),
  items: z.array(item).min(1).max(30), site: short, neededBy: date.nullable(), bufferDays: z.number().int().min(0).max(365).default(2),
  budgetCents: cents.nullable().default(null), currency: z.string().regex(/^[A-Z]{3}$/).default('USD'),
  regulated: z.boolean().default(false), technical: z.boolean().default(false), requirements: z.array(requirement).max(30).default([]),
  notes: z.string().max(8000).default(''), ownerId: id.optional() }).strict();
export type RequestData = z.infer<typeof requestData>;
export const costs = z.object({ subtotal: cents, discount: cents.default(0), shipping: cents.nullable(), tax: cents.nullable(),
  hazmat: cents.nullable(), other: cents.nullable(), restockingTerms: z.string().max(2000).default('') }).strict();
export const provenance = z.object({actorId: id, role: short, recordedAt: z.iso.datetime()}).strict();
// Ignore category enrichment when comparing user-controlled scope.
export function constraints(data:RequestData) {
  return {title:data.title,description:data.description,items:data.items.map(({categoryId,...item})=>item),
    site:data.site,neededBy:data.neededBy,bufferDays:data.bufferDays,budgetCents:data.budgetCents,currency:data.currency,ownerId:data.ownerId??null};
}
export const researchEvidence = z.object({
  criterion: short.describe('scope, availability, reviews, or requirement:<request requirement key>'),
  status: z.enum(['supported','contradicted','unresolved']),
  finding: short,
  itemKeys: z.array(short).max(30).optional().describe('For scope evidence, the request item keys covered by this finding.'),
  site: short.optional().describe('For supported availability evidence, the request destination/site covered by the source.'),
  availability: z.object({basis:z.enum(['location-confirmed','estimate','listing-only']),
    location:short, itemKeys:z.array(short).min(1).max(30)}).strict().optional()
    .describe('For availability: exact store/address or delivery destination, covered items, and whether availability was actually confirmed there.'),
  sources: z.array(source).max(20).default([]),
}).strict().superRefine((v,ctx)=>{
  if(v.status!=='unresolved' && !v.sources.length)
    ctx.addIssue({code:'custom',path:['sources'],message:'Supported or contradicted findings require source evidence.'});
});
export const reviewEvidence = z.object({
  subject: z.enum(['product','supplier']), target: short.describe('Exact product/variant or supplier/location being rated'),
  itemKey: short.optional().describe('Required for product ratings; links to a request item.'),
  recommendationKey: short.optional().describe('Links this observation to one exact recommended product or service provider.'),
  platform: short, rating: z.number().min(0), scaleMax: z.number().min(1).max(100),
  reviewCount: z.number().int().min(1).max(1_000_000_000), source,
}).strict().superRefine((v,ctx)=>{
  if(v.rating>v.scaleMax) ctx.addIssue({code:'custom',path:['rating'],message:'Rating cannot exceed its scale.'});
  if(v.subject==='product' && !v.itemKey) ctx.addIssue({code:'custom',path:['itemKey'],message:'Product ratings require a request item key.'});
});
const investigatedGap = z.object({reason:short,sources:z.array(source).min(1).max(20)}).strict();
export const recommendationItem = z.object({
  key:short,itemKey:short,subject:z.enum(['product','supplier']),target:short,
  reviewGap:investigatedGap.optional().describe('If relevant reviews are unavailable, explain why and cite the places checked for this exact target.'),
  comparison:z.object({rationale:short,
    alternatives:z.array(z.object({target:short,reason:short,sources:z.array(source).min(1).max(20)}).strict()).max(10),
    noAlternative:investigatedGap.optional()
  }).strict().optional().describe('Explain rating/count relevance, requirement fit, price and tradeoffs versus actual alternatives; if none exist, document the search.')
}).strict();
export const quoteData = z.object({ summary: short, currency: z.string().regex(/^[A-Z]{3}$/), costs,
  leadDays: z.number().int().min(0).max(3650).nullable(), leadBasis: z.enum(['vendor', 'historical', 'owner-estimate', 'agent-estimate']),
  costBasis: z.enum(['confirmed','estimate']).optional().describe('Omitted is unknown, never confirmed. Confirmed requires evidence of the final payable total at the actual destination.'),
  costEvidence: source.optional(),
  promisedDate: date.nullable().default(null), expiresOn: date.nullable().default(null),
  priceBasis: z.enum(['formal-quote', 'list-snapshot']).optional().describe('Omitted means formal-quote, preserving historical command payloads.'),
  priceCheckedAt: z.iso.datetime().optional().describe('Required for list-snapshot: when the catalog price was checked. Snapshots must be rechecked after seven calendar days.'),
  sources: z.array(source).min(1).max(20),
  evidence: z.array(researchEvidence).max(40).optional().describe('Research findings, not human verification. Include scope, availability, reviews, and each requirement:<key>.'),
  recommendation: z.array(recommendationItem).min(1).max(30).optional().describe('One entry per exact product or service provider in this candidate cart, even when the request has one generic assortment item. Drafts may omit it.'),
  reviews: z.array(reviewEvidence).max(30).optional().describe('Separate product and supplier ratings with counts, scales, and source dates.'),
  fit: short, unknowns: z.array(short).max(30).default([]), terms: z.string().max(3000).default('') }).strict();
export type QuoteData = z.infer<typeof quoteData> & {recordedBy?:z.infer<typeof provenance>};
export const policyData = z.object({ currency: z.string().regex(/^[A-Z]{3}$/), perOrderCap: cents, dailyCap: cents,
  expensiveThreshold: cents.min(1), escalationOwnerId: id, timezone: z.string().refine(v => {
    try { new Intl.DateTimeFormat('en', { timeZone: v }); return true; } catch { return false; }
  }), allowedCategoryIds: z.array(id), allowedVendorIds: z.array(id), allowedSites: z.array(short),
  requireRoutineApproval: z.boolean().default(true) }).strict();
export type Policy = z.infer<typeof policyData>;
const requestRef = { requestId: id };
const revision = { ...requestRef, expectedRevision: z.number().int().min(1) };
export const command = z.discriminatedUnion('type', [
  z.object({ type: z.literal('category.create'), name: short, parentId: id.nullable().default(null), defaults: defaults.default({ regulated: false, technical: false, requirements: [] }) }).strict(),
  z.object({ type: z.literal('category.update'), categoryId: id, name: short, parentId: id.nullable(), archived: z.boolean(), defaults }).strict(),
  z.object({ type: z.literal('vendor.save'), name: short, identity: z.string().trim().min(1).max(300),
    categoryIds: z.array(id).default([]), sources: z.array(source).min(1).max(20), location: short,
    onboarding: z.object({ w9: z.enum(['unknown','requested','on-file','not-applicable']).default('unknown'),
      coi: z.enum(['unknown','requested','on-file','expired','not-applicable']).default('unknown'),
      paymentTerms: z.string().max(2000).default(''), netTermsStatus: z.enum(['unknown','requested','approved','rejected']).default('unknown') }).strict().default({w9:'unknown',coi:'unknown',paymentTerms:'',netTermsStatus:'unknown'}) }).strict(),
  z.object({ type: z.literal('request.create'), data: requestData }).strict(),
  z.object({ type: z.literal('request.update'), ...revision, data: requestData, reason: short }).strict(),
  z.object({ type: z.literal('request.propose'), ...revision, data:requestData, reason:short }).strict(),
  z.object({ type: z.literal('request.confirm'), ...revision, evidence:source }).strict(),
  z.object({ type: z.literal('quote.add'), ...requestRef, vendorId: id, data: quoteData }).strict(),
  z.object({ type: z.literal('quote.select'), ...revision, quoteId: id, reason: short }).strict(),
  z.object({ type: z.literal('classification.verify'), ...revision, regulated: z.boolean(), technical: z.boolean(), evidence: source }).strict(),
  z.object({ type: z.literal('requirement.verify'), ...revision, key: short, site: short, material: short.optional(),
    validFrom: date, validUntil: date, evidence: source }).strict(),
  z.object({ type: z.literal('approval.grant'), ...revision, quoteId: id, expiresAt: z.iso.datetime(), acceptScheduleRisk: z.boolean().default(false), evidence: source }).strict(),
  z.object({ type: z.literal('policy.set'), data: policyData }).strict(),
  z.object({ type: z.literal('requirement.revoke'), ...requestRef, key: short, reason: short, evidence: source }).strict(),
  z.object({ type: z.literal('approval.revoke'), ...requestRef, reason: short }).strict(),
  z.object({ type: z.literal('blocker.add'), ...requestRef, reason: short, resolverId: id, decisionBy: date.nullable(), evidence: source.optional() }).strict(),
  z.object({ type: z.literal('blocker.resolve'), ...requestRef, blockerId: id, disposition: short }).strict(),
  z.object({ type: z.literal('checkout.simulate'), ...revision, quoteId: id, outcome: z.enum(['confirmed','unknown','failed']).default('confirmed') }).strict(),
  z.object({ type: z.literal('order.record'), ...revision, quoteId: id, reference: short, placedOn: date, promisedOn: date, evidence: source }).strict(),
  z.object({ type: z.literal('order.resolve'), ...requestRef, orderId: id, outcome: z.enum(['confirmed','failed']), reference: short, evidence: source }).strict(),
  z.object({ type: z.literal('order.delivery-update'), ...requestRef, orderId: id, promisedOn: date, evidence: source }).strict(),
  z.object({ type: z.literal('receipt.accept'), ...requestRef, receiptId: id, evidence: source }).strict(),
  z.object({ type: z.literal('receipt.record'), ...requestRef, orderId: id, arrivedOn: date,
    quantities: z.array(z.object({ key: short, quantity: z.number().int().min(1).max(1_000_000) }).strict()).min(1).max(30),
    accepted: z.boolean(), notes: z.string().max(3000).default(''), evidence: source }).strict(),
  z.object({ type: z.literal('feedback.add'), ...requestRef, note: short, evidence: source.optional() }).strict(),
  z.object({ type: z.literal('request.close'), ...revision }).strict(),
  z.object({ type: z.literal('request.cancel'), ...revision, reason: short }).strict(),
]);
export type Command = z.infer<typeof command>;
export type Event = { id: string; requestId: string | null; actorId: string; sequence: number; type: string; payload: any; createdAt: Date | string };
export type State = { id: string; version: number; revision: number; data: RequestData; requesterId: string;
  constraintProvenance?: {actorId:string;role:string;recordedAt:string;confirmed:boolean}; proposals?:any[];
  status: string; quoteId: string | null; blockers: Record<string, any>; classification: any;
  verifications: Record<string, any>; approvals: any[]; receipts: any[]; feedback: any[]; orders: any[]; updatedAt: string };

export function project(id: string, rows: Event[]): State {
  const s: State = { id, version: 0, revision: 0, data: {} as RequestData, requesterId: '', status: 'draft',
    quoteId: null, blockers: {}, classification: null, verifications: {}, approvals: [], receipts: [], feedback: [], orders: [], updatedAt: '' };
  for (const e of rows.toSorted((a,b) => a.sequence - b.sequence)) {
    s.version = e.sequence; s.updatedAt = new Date(e.createdAt).toISOString();
    const p = e.payload;
    if(e.type==='request.created' || e.type==='request.updated') {
      if(e.type==='request.created' || hash(constraints(s.data))!==hash(constraints(p.data)))
        s.constraintProvenance={actorId:e.actorId,role:p.actorRole??'unknown',recordedAt:new Date(e.createdAt).toISOString(),confirmed:['owner','requester'].includes(p.actorRole)};
    }
    switch (e.type) {
      case 'request.created': s.data = p.data; s.requesterId = e.actorId; s.revision = 1; s.status = 'researching'; break;
      case 'request.updated': s.data = p.data; s.revision++; s.classification = null; s.verifications = {}; s.approvals = []; break;
      case 'request.confirmed':
        if(p.revision===s.revision) s.constraintProvenance={actorId:e.actorId,role:p.actorRole,recordedAt:new Date(e.createdAt).toISOString(),confirmed:true};
        break;
      case 'request.proposed': (s.proposals??=[]).push({...p,id:e.id,actorId:e.actorId,recordedAt:new Date(e.createdAt).toISOString()}); break;
      case 'classification.verified': s.classification = p; break;
      case 'requirement.verified': s.verifications[p.key] = { ...p, actorId: e.actorId }; break;
      case 'requirement.revoked': delete s.verifications[p.key]; break;
      case 'quote.selected': s.quoteId = p.quoteId; s.status = 'decision'; break;
      case 'approval.granted': s.approvals.push(p); break;
      case 'approval.revoked': s.approvals=[]; break;
      case 'blocker.added': s.blockers[p.id] = p; break;
      case 'blocker.resolved': delete s.blockers[p.blockerId]; break;
      case 'order.created': s.orders.push(p); s.status = p.state === 'confirmed' ? 'ordered' : p.state === 'unknown' ? 'outcome-unknown' : 'decision'; break;
      case 'order.resolved': s.orders = s.orders.map(o => o.id === p.orderId ? {...o, state:p.outcome} : o); s.status = p.outcome === 'confirmed' ? 'ordered' : 'decision'; break;
      case 'order.delivery-updated': s.orders = s.orders.map(o => o.id === p.orderId ? {...o,promisedOn:p.promisedOn} : o); break;
      case 'receipt.recorded': s.receipts.push({ ...p, actorId: e.actorId }); s.status = 'receiving'; break;
      case 'receipt.accepted': s.receipts = s.receipts.map(r=>r.id===p.receiptId?{...r,accepted:true,acceptanceEvidence:p.evidence}:r); break;
      case 'feedback.added': s.feedback.push({ ...p, actorId:e.actorId, recordedAt:new Date(e.createdAt).toISOString() }); break;
      case 'request.closed': s.status = 'closed'; break;
      case 'request.canceled': s.status = 'canceled'; break;
    }
  }
  return s;
}
export function hash(value: unknown): string {
  const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
export function total(c: QuoteData['costs']): number | null {
  if ([c.shipping,c.tax,c.hazmat,c.other].some(v => v === null)) return null;
  const n = c.subtotal - c.discount + c.shipping! + c.tax! + c.hazmat! + c.other!;
  if (!Number.isSafeInteger(n) || n < 0 || n > 100_000_000) fail('Invalid landed cost.');
  return n;
}
export const day = (d = new Date()) => d.toISOString().slice(0,10);
export const addDays = (value: string, days: number) => new Date(Date.parse(value+'T00:00:00Z') + days * 86400000).toISOString().slice(0,10);
export const daysBetween = (a:string,b:string) => Math.round((Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/86400000);
export function schedule(s: State, q: QuoteData | null, today = day()) {
  const lead = q?.leadDays ?? null;
  const orderBy = s.data.neededBy && lead !== null ? addDays(s.data.neededBy,-lead-s.data.bufferDays) : null;
  const confirmed = s.orders.findLast(o => o.state === 'confirmed');
  const forecast = confirmed?.promisedOn ?? q?.promisedDate ?? (lead !== null ? addDays(today,lead) : null);
  return { neededBy:s.data.neededBy, orderBy, forecast, leadDays:lead, leadBasis:q?.leadBasis ?? null,
    bufferDays:s.data.bufferDays, calendar:'calendar-days', overdue:!!orderBy && orderBy<today && !confirmed,
    late:!!forecast && !!s.data.neededBy && addDays(forecast,s.data.bufferDays)>s.data.neededBy };
}
