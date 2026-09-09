import { randomUUID } from 'node:crypto';
import { and, eq, asc, sql, inArray } from 'drizzle-orm';
import type { Database, Tx } from './db/index.js';
import * as t from './db/schema.js';
import { command, defaults, fail, hash, project, total, day, addDays, daysBetween, policyData,
  type State, type Event, type RequestData, type QuoteData, type Command } from './domain.js';
import { evaluate, routeBlock } from './policy.js';
import { assessResearch } from './research.js';

export type Actor = typeof t.actors.$inferSelect;
type Conn = Database | Tx;
const scope = (column: any, actor: Actor) => eq(column,actor.workspaceId);
function role(actor:Actor,...roles:string[]) { if (!roles.includes(actor.role)) fail('This action requires '+roles.join(' or ')+'.',403); }
function active(s:State) { if (['closed','canceled'].includes(s.status)) fail('Request is finished.',409); }

export class Engine {
  constructor(public db:Database) {}
  async authenticate(key:string):Promise<Actor> {
    const [actor] = await this.db.select().from(t.actors).where(and(eq(t.actors.keyHash,hash(key)),eq(t.actors.enabled,true)));
    if (!actor) fail('Invalid or revoked API key.',401);
    return actor;
  }
  async state(c:Conn,a:Actor,requestId:string):Promise<State> {
    const [r] = await c.select().from(t.requests).where(and(eq(t.requests.id,requestId),scope(t.requests.workspaceId,a)));
    if (!r) fail('Request not found.',404);
    const rows = await c.select().from(t.events).where(eq(t.events.requestId,requestId)).orderBy(asc(t.events.sequence));
    const s = project(requestId,rows as Event[]);
    if (a.role==='requester' && s.requesterId!==a.id && s.data.ownerId!==a.id) fail('Request not found.',404);
    return s;
  }
  async selected(c:Conn,a:Actor,s:State) {
    if (!s.quoteId) return null;
    const [q] = await c.select().from(t.quotes).where(and(eq(t.quotes.id,s.quoteId),scope(t.quotes.workspaceId,a)));
    return q ? {...q,data:q.data as QuoteData & {requestRevision:number}} : null;
  }
  async workspace(c:Conn,a:Actor) {
    const [w] = await c.select().from(t.workspaces).where(eq(t.workspaces.id,a.workspaceId));
    if (!w) fail('Workspace not found.',404);
    return w;
  }
  async policy(c:Conn,a:Actor,s:State) {
    const w = await this.workspace(c,a), p=policyData.safeParse(w.policy);
    const period = new Intl.DateTimeFormat('en-CA',{timeZone:p.success?p.data.timezone:'UTC',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const os = await c.select().from(t.orders).where(and(scope(t.orders.workspaceId,a),eq(t.orders.period,period)));
    const spent = os.filter(o=>o.simulation && ['confirmed','unknown'].includes(o.state)).reduce((sum,o)=>sum+o.totalCents,0);
    const cs = await c.select().from(t.categories).where(scope(t.categories.workspaceId,a));
    const allowed = p.success && s.data.items.every(i=> {
      let current=cs.find(v=>v.id===i.categoryId); const seen=new Set<string>();
      while(current && !seen.has(current.id)) { if (current.archived) return false; seen.add(current.id);
        if (p.data.allowedCategoryIds.includes(current.id)) return true;
        current=cs.find(v=>v.id===current!.parentId); }
      return false;
    });
    const result=evaluate(s,await this.selected(c,a,s),w.policy,spent,allowed,new Date(),w.policyVersion);
    const actors=await c.select({id:t.actors.id,role:t.actors.role}).from(t.actors).where(and(scope(t.actors.workspaceId,a),eq(t.actors.enabled,true))).orderBy(asc(t.actors.createdAt),asc(t.actors.id));
    if(!p.success) {
      const owner=actors.find(actor=>actor.role==='owner');
      if(owner) result.escalationOwnerId=owner.id;
    }
    const researcher=actors.find(actor=>actor.id===s.requesterId&&actor.role==='agent')??actors.find(actor=>actor.role==='agent');
    const blocks=result.blocks.map(b=>routeBlock(b,result.escalationOwnerId,researcher?.id??null));
    const humanBlocks=result.humanBlocks.map(b=>routeBlock(b,result.escalationOwnerId,researcher?.id??null));
    const research={...result.research,issues:result.research.issues.map(issue=>({...issue,resolverType:'agent' as const,resolverId:researcher?.id??null}))};
    return {...result,blocks,humanBlocks,research,period};
  }
  async actorExists(c:Conn,a:Actor,id:string) {
    const [x]=await c.select().from(t.actors).where(and(eq(t.actors.id,id),scope(t.actors.workspaceId,a),eq(t.actors.enabled,true)));
    if(!x) fail('Unknown active actor.'); return x;
  }
  async enrich(c:Conn,a:Actor,data:RequestData,previous?:RequestData) {
    const seen=new Set<string>(); for(const i of data.items) { if(seen.has(i.key)) fail('Item keys must be unique.'); seen.add(i.key); }
    const requirements = new Map<string,any>();
    const add=(r:any)=> { const existing=requirements.get(r.key); if(existing && hash(existing)!==hash(r)) fail('Conflicting requirement key: '+r.key); requirements.set(r.key,r); };
    previous?.requirements.forEach(add); data.requirements.forEach(add);
    let regulated=data.regulated || !!previous?.regulated, technical=data.technical || !!previous?.technical;
    const cs=await c.select().from(t.categories).where(scope(t.categories.workspaceId,a));
    for(const i of data.items) if(i.categoryId) {
      let current=cs.find(v=>v.id===i.categoryId); if(!current || current.archived) fail('Unknown or archived category.');
      const parents=new Set<string>();
      while(current) { if(parents.has(current.id)) fail('Category cycle.'); parents.add(current.id);
        if(current.archived) fail('Category ancestry is archived.');
        const d=defaults.parse(current.defaults); regulated ||= d.regulated; technical ||= d.technical; d.requirements.forEach(add);
        current=cs.find(v=>v.id===current!.parentId);
      }
    }
    if(data.ownerId) await this.actorExists(c,a,data.ownerId);
    return {...data,regulated,technical,requirements:[...requirements.values()]};
  }
  async execute(a:Actor,key:string,input:unknown) {
    if (!/^[a-zA-Z0-9._:-]{8,160}$/.test(key)) fail('Idempotency-Key must be 8–160 simple characters.');
    const cmd=command.parse(input), digest=hash(cmd);
    return this.db.transaction(async c=> {
      // Small-team workload: one workspace lock keeps policy, reservations and event sequences atomic.
      await c.execute(sql`select id from workspaces where id=${a.workspaceId} for update`);
      const currentActor=await this.actorExists(c,a,a.id); if(currentActor.role!==a.role) fail('Actor authority changed; retry.',409);
      const [prior]=await c.select().from(t.commands).where(and(scope(t.commands.workspaceId,a),eq(t.commands.actorId,a.id),eq(t.commands.key,key)));
      if(prior) { if(prior.hash!==digest) fail('Idempotency key reused with a different payload.',409); return prior.result; }
      const requestId='requestId' in cmd?cmd.requestId:null;
      let s=requestId?await this.state(c,a,requestId):null;
      if(s && 'expectedRevision' in cmd && cmd.expectedRevision!==s.revision) fail('Request revision changed; reload before acting.',409);
      const emit=async(type:string,payload:any,rid:string|null=requestId)=> {
        const rows=await c.select({sequence:t.events.sequence}).from(t.events).where(rid?eq(t.events.requestId,rid):and(scope(t.events.workspaceId,a),sql`${t.events.requestId} is null`));
        const sequence=Math.max(0,...rows.map(e=>e.sequence))+1;
        const e={id:randomUUID(),workspaceId:a.workspaceId,requestId:rid,actorId:a.id,sequence,type,payload,commandKey:key};
        await c.insert(t.events).values(e); return e;
      };
      let result:any;
      switch(cmd.type) {
        case 'category.create': case 'category.update': {
          role(a,'owner','agent'); if(cmd.type==='category.update') role(a,'owner');
          const cs=await c.select().from(t.categories).where(scope(t.categories.workspaceId,a));
          const cid=cmd.type==='category.create'?randomUUID():cmd.categoryId;
          if(cmd.type==='category.update' && !cs.some(v=>v.id===cid)) fail('Category not found.',404);
          let parent=cmd.parentId; const visited=new Set([cid]);
          while(parent) { if(visited.has(parent)) fail('Category hierarchy cannot contain cycles.'); visited.add(parent);
            const cat=cs.find(v=>v.id===parent); if(!cat || cat.archived) fail('Unknown/archived parent category.'); parent=cat.parentId; }
          const values={name:cmd.name,parentId:cmd.parentId,defaults:cmd.defaults,archived:cmd.type==='category.update'?cmd.archived:false};
          if(cmd.type==='category.create') await c.insert(t.categories).values({id:cid,workspaceId:a.workspaceId,...values});
          else await c.update(t.categories).set(values).where(eq(t.categories.id,cid));
          await emit(cmd.type,{id:cid,...values}); result={id:cid,...values}; break;
        }
        case 'vendor.save': {
          role(a,'owner','agent');
          for(const cid of cmd.categoryIds) { const [cat]=await c.select().from(t.categories).where(and(eq(t.categories.id,cid),scope(t.categories.workspaceId,a))); if(!cat) fail('Unknown category.'); }
          const identity=cmd.identity.toLowerCase().trim();
          const [old]=await c.select().from(t.vendors).where(and(scope(t.vendors.workspaceId,a),eq(t.vendors.identity,identity)));
          const vid=old?.id??randomUUID();
          const data={categoryIds:cmd.categoryIds,sources:cmd.sources,location:cmd.location,onboarding:cmd.onboarding};
          if(old) await c.update(t.vendors).set({name:cmd.name,data}).where(eq(t.vendors.id,vid));
          else await c.insert(t.vendors).values({id:vid,workspaceId:a.workspaceId,name:cmd.name,identity,data});
          await emit('vendor.saved',{id:vid,name:cmd.name,identity,data}); result={id:vid}; break;
        }
        case 'request.create': {
          const rid=randomUUID(),data=await this.enrich(c,a,cmd.data);
          await c.insert(t.requests).values({id:rid,workspaceId:a.workspaceId}); await emit('request.created',{data},rid);
          result={id:rid,revision:1}; break;
        }
        case 'request.update': {
          active(s!);
          const data=await this.enrich(c,a,cmd.data,{...s!.data,regulated:s!.data.regulated||!!s!.classification?.regulated,technical:s!.data.technical||!!s!.classification?.technical});
          if(s!.orders.some(o=>['confirmed','unknown'].includes(o.state))) fail('Ordered requests cannot change scope. Use fulfillment and delivery updates.',409);
          await emit('request.updated',{data,reason:cmd.reason}); result={id:s!.id,revision:s!.revision+1}; break;
        }
        case 'quote.add': {
          role(a,'owner','agent'); active(s!); const [vendor]=await c.select().from(t.vendors).where(and(eq(t.vendors.id,cmd.vendorId),scope(t.vendors.workspaceId,a)));
          if(!vendor) fail('Vendor not found.',404); total(cmd.data.costs);
          const criteria=new Set(['scope','availability','reviews',...s!.data.requirements.map(r=>'requirement:'+r.key)]),seen=new Set<string>();
          for(const evidence of cmd.data.evidence??[]) {
            if(!criteria.has(evidence.criterion)) fail('Unknown evidence criterion: '+evidence.criterion);
            if(seen.has(evidence.criterion)) fail('Duplicate evidence criterion: '+evidence.criterion);
            seen.add(evidence.criterion);
            if(evidence.itemKeys?.some(key=>!s!.data.items.some(item=>item.key===key))) fail('Evidence refers to an unknown request item.');
          }
          for(const review of cmd.data.reviews??[]) if(review.itemKey && !s!.data.items.some(i=>i.key===review.itemKey)) fail('Review refers to an unknown request item.');
          const reviewKeys=new Set<string>();
          for(const review of cmd.data.reviews??[]) {
            const key=hash([review.subject,review.itemKey??null,review.target.toLowerCase(),review.platform.toLowerCase(),review.source.url]);
            if(reviewKeys.has(key)) fail('Duplicate review observation; do not count the same source twice.');
            reviewKeys.add(key);
          }
          const qid=randomUUID(),data={...cmd.data,requestRevision:s!.revision};
          await c.insert(t.quotes).values({id:qid,workspaceId:a.workspaceId,requestId:s!.id,vendorId:cmd.vendorId,data});
          await emit('quote.recorded',{quoteId:qid,vendorId:cmd.vendorId,sources:data.sources}); result={id:qid,research:assessResearch(s!,{id:qid,data})}; break;
        }
        case 'quote.select': {
          role(a,'owner','agent'); active(s!); if(s!.orders.some(o=>o.state!=='failed')) fail('An order already exists.',409);
          const [q]=await c.select().from(t.quotes).where(and(eq(t.quotes.id,cmd.quoteId),eq(t.quotes.requestId,s!.id)));
          if(!q || (q.data as any).requestRevision!==s!.revision) fail('Quote does not cover this request revision.');
          await emit('quote.selected',{quoteId:cmd.quoteId,reason:cmd.reason}); result={id:s!.id,quoteId:cmd.quoteId,selectedQuote:q,research:assessResearch(s!,q as any)}; break;
        }
        case 'classification.verify': {
          role(a,'owner','reviewer'); active(s!);
          if(((s!.data.regulated||s!.classification?.regulated) && !cmd.regulated)||((s!.data.technical||s!.classification?.technical) && !cmd.technical)) fail('Established requirements cannot be removed by classification.');
          await emit('classification.verified',{...cmd,revision:s!.revision}); result={verified:true}; break;
        }
        case 'requirement.verify': {
          role(a,'owner','reviewer'); active(s!); const r=s!.data.requirements.find(r=>r.key===cmd.key);
          if(!r) fail('Requirement not found.');
          if(cmd.site!==s!.data.site || (r.material && r.material!==cmd.material) || cmd.validFrom>cmd.validUntil) fail('Verification coverage does not match.');
          await emit('requirement.verified',{...cmd,revision:s!.revision}); result={verified:true}; break;
        }
        case 'approval.grant': {
          role(a,'owner'); active(s!); if(s!.quoteId!==cmd.quoteId) fail('Approve the selected quote.');
          if(Date.parse(cmd.expiresAt)<=Date.now()) fail('Approval expiry must be in the future.');
          const w=await this.workspace(c,a); const p=policyData.safeParse(w.policy); if(!p.success) fail('Configure policy first.');
          await emit('approval.granted',{...cmd,revision:s!.revision,policyHash:hash({policy:w.policy,version:w.policyVersion})}); result={approved:true}; break;
        }
        case 'requirement.revoke': {
          role(a,'owner','reviewer'); if(!s!.verifications[cmd.key]) fail('Verified requirement not found.');
          await emit('requirement.revoked',{key:cmd.key,reason:cmd.reason,evidence:cmd.evidence}); result={revoked:true}; break;
        }
        case 'approval.revoke': {
          role(a,'owner'); await emit('approval.revoked',{reason:cmd.reason});result={revoked:true};break;
        }
        case 'policy.set': {
          role(a,'owner'); const owner=await this.actorExists(c,a,cmd.data.escalationOwnerId); if(owner.role!=='owner') fail('Escalation owner must have owner authority.');
          for(const cid of cmd.data.allowedCategoryIds) { const [cat]=await c.select().from(t.categories).where(and(eq(t.categories.id,cid),scope(t.categories.workspaceId,a))); if(!cat) fail('Unknown delegated category.'); }
          for(const vid of cmd.data.allowedVendorIds) { const [v]=await c.select().from(t.vendors).where(and(eq(t.vendors.id,vid),scope(t.vendors.workspaceId,a))); if(!v) fail('Unknown delegated vendor.'); }
          const w=await this.workspace(c,a);
          await c.update(t.workspaces).set({policy:cmd.data,policyVersion:w.policyVersion+1}).where(eq(t.workspaces.id,a.workspaceId)); await emit('policy.changed',{data:cmd.data,version:w.policyVersion+1}); result={configured:true}; break;
        }
        case 'blocker.add': {
          active(s!); await this.actorExists(c,a,cmd.resolverId); const bid=randomUUID();
          await emit('blocker.added',{id:bid,reason:cmd.reason,resolverId:cmd.resolverId,decisionBy:cmd.decisionBy,evidence:cmd.evidence??null}); result={id:bid}; break;
        }
        case 'blocker.resolve': {
          const b=s!.blockers[cmd.blockerId]; if(!b) fail('Blocker not found.',404);
          if(a.id!==b.resolverId && a.role!=='owner') fail('Only the named resolver or owner can resolve this blocker.',403);
          await emit('blocker.resolved',{blockerId:cmd.blockerId,disposition:cmd.disposition}); result={resolved:true}; break;
        }
        case 'checkout.simulate': case 'order.record': {
          role(a,...(cmd.type==='order.record'?['owner']:['owner','agent'])); active(s!);
          if(s!.quoteId!==cmd.quoteId) fail('Action must target the selected quote.');
          if(s!.orders.some(o=>o.state!=='failed')) fail('Request already has an order or an uncertain outcome.',409);
          const policy=await this.policy(c,a,s!); const manual=cmd.type==='order.record';
          if(manual && policy.humanOnly && a.id!==policy.escalationOwnerId) fail('This purchase belongs to its escalation owner.',403);
          if(manual?!policy.humanAllowed:!policy.allowed) {
            result={outcome:'blocked',policy}; await emit('purchase.blocked',result); break;
          }
          const q=(await this.selected(c,a,s!))!,w=await this.workspace(c,a);
          if(!manual && w.mode!=='simulation') fail('Only simulated checkout is implemented.');
          if(manual && (cmd.placedOn>day() || cmd.promisedOn<cmd.placedOn)) fail('Invalid order dates.');
          const oid=randomUUID(),placedOn=manual?cmd.placedOn:day(),promisedOn=manual?cmd.promisedOn:q.data.promisedDate??(q.data.leadDays!==null?addDays(placedOn,q.data.leadDays):null);
          if(!promisedOn) fail('A promised delivery date or usable lead time is required.');
          if(manual) for(const requirement of s!.data.requirements) {
            const v=s!.verifications[requirement.key];
            if(!v || v.validFrom>placedOn || v.validUntil<promisedOn) fail('Required evidence does not cover the recorded purchase/delivery dates.');
          }
          const state=manual?'confirmed':cmd.outcome;
          const data={items:s!.data.items,placedOn,promisedOn,originalPromisedOn:promisedOn,vendorId:q.vendorId,
            reference:manual?cmd.reference:'SIM-'+oid.slice(0,8),evidence:manual?cmd.evidence:null,requestRevision:s!.revision};
          const simulation=!manual || w.mode==='simulation';
          await c.insert(t.orders).values({id:oid,workspaceId:a.workspaceId,requestId:s!.id,quoteId:q.id,state,simulation,totalCents:policy.totalCents!,period:policy.period,data});
          await emit('order.created',{id:oid,state,simulation,totalCents:policy.totalCents,...data}); result={id:oid,state,simulation,reference:data.reference}; break;
        }
        case 'order.resolve': {
          role(a,'owner'); const [o]=await c.select().from(t.orders).where(and(eq(t.orders.id,cmd.orderId),eq(t.orders.requestId,s!.id)));
          if(!o || o.state!=='unknown') fail('Only an outcome-unknown order can be reconciled.');
          await c.update(t.orders).set({state:cmd.outcome,data:{...(o.data as any),reference:cmd.reference,resolutionEvidence:cmd.evidence}}).where(eq(t.orders.id,o.id));
          await emit('order.resolved',{...cmd}); result={resolved:true}; break;
        }
        case 'order.delivery-update': {
          role(a,'owner','agent'); active(s!);
          const [o]=await c.select().from(t.orders).where(and(eq(t.orders.id,cmd.orderId),eq(t.orders.requestId,s!.id)));
          if(!o || o.state!=='confirmed') fail('A confirmed order is required.');
          const data=o.data as any; if(cmd.promisedOn<data.placedOn) fail('Delivery cannot precede placement.');
          await c.update(t.orders).set({data:{...data,promisedOn:cmd.promisedOn,deliveryEvidence:cmd.evidence}}).where(eq(t.orders.id,o.id));
          await emit('order.delivery-updated',{...cmd});
          if(s!.data.neededBy && addDays(cmd.promisedOn,s!.data.bufferDays)>s!.data.neededBy) {
            const owner=policyData.parse((await this.workspace(c,a)).policy).escalationOwnerId;
            await emit('blocker.added',{id:randomUUID(),reason:'Delivery forecast misses needed-by. Owner must decide how to respond.',resolverId:owner,decisionBy:day(),evidence:cmd.evidence});
          }
          result={updated:true}; break;
        }
        case 'receipt.accept': {
          role(a,'owner','reviewer'); active(s!); const r=s!.receipts.find(r=>r.id===cmd.receiptId);
          if(!r || r.accepted) fail('An unaccepted receipt is required.');
          await emit('receipt.accepted',{receiptId:cmd.receiptId,evidence:cmd.evidence}); result={accepted:true}; break;
        }
        case 'receipt.record': {
          active(s!); const [o]=await c.select().from(t.orders).where(and(eq(t.orders.id,cmd.orderId),eq(t.orders.requestId,s!.id)));
          if(!o || o.state!=='confirmed') fail('A confirmed order is required.'); const data=o.data as any;
          if(cmd.arrivedOn>day() || cmd.arrivedOn<data.placedOn) fail('Arrival must be between placement and today.');
          if((s!.data.technical||s!.classification?.technical) && cmd.accepted) role(a,'owner','reviewer');
          const seen=new Set<string>(); for(const qty of cmd.quantities) {
            if(seen.has(qty.key)) fail('Receipt item keys must be unique.'); seen.add(qty.key);
            const item=data.items.find((i:any)=>i.key===qty.key); if(!item) fail('Unknown order item.');
            const prior=s!.receipts.filter(r=>r.orderId===o.id).flatMap(r=>r.quantities).filter((q:any)=>q.key===qty.key).reduce((sum:number,q:any)=>sum+q.quantity,0);
            if(prior+qty.quantity>item.quantity) fail('Received quantity exceeds ordered quantity.');
          }
          const rid=randomUUID(); await emit('receipt.recorded',{...cmd,id:rid,simulation:o.simulation,leadDays:daysBetween(data.placedOn,cmd.arrivedOn),lateDays:daysBetween(data.originalPromisedOn,cmd.arrivedOn)}); result={id:rid}; break;
        }
        case 'feedback.add': {
          if(!s!.receipts.length) fail('Record fulfillment before purchase feedback.');
          await emit('feedback.added',{note:cmd.note,evidence:cmd.evidence??null,simulation:s!.orders.some(o=>o.simulation)}); result={saved:true}; break;
        }
        case 'request.close': {
          active(s!); if(s!.data.items.some(i=>s!.receipts.filter(r=>r.accepted).flatMap(r=>r.quantities).filter((q:any)=>q.key===i.key).reduce((sum:number,q:any)=>sum+q.quantity,0)<i.quantity)) fail('All items/service quantities must be received and accepted.');
          if(Object.keys(s!.blockers).length) fail('Resolve outstanding blockers before closure.');
          await emit('request.closed',{}); result={closed:true}; break;
        }
        case 'request.cancel': {
          active(s!); if(s!.orders.some(o=>o.state!=='failed')) fail('Resolve the existing order; cancellation cannot erase a commitment.');
          await emit('request.canceled',{reason:cmd.reason}); result={canceled:true}; break;
        }
        default: { const exhaustive:never=cmd; throw new Error(String(exhaustive)); }
      }
      await c.insert(t.commands).values({id:randomUUID(),workspaceId:a.workspaceId,actorId:a.id,key,hash:digest,result});
      return result;
    });
  }
  async read(a:Actor,kind:string,params:Record<string,string>={}) {
    switch(kind) {
      case 'me': {
        const w=await this.workspace(this.db,a);
        return {id:a.id,name:a.name,role:a.role,workspaceId:a.workspaceId,workspaceName:w.name,mode:w.mode};
      }
      case 'categories': return this.db.select().from(t.categories).where(scope(t.categories.workspaceId,a));
      case 'policy': return (await this.workspace(this.db,a)).policy;
      case 'actors': role(a,'owner','agent','reviewer'); return this.db.select({id:t.actors.id,name:t.actors.name,role:t.actors.role}).from(t.actors).where(scope(t.actors.workspaceId,a));
      case 'request': {
        const s=await this.state(this.db,a,params.id), policy=await this.policy(this.db,a,s);
        const qs=await this.db.select().from(t.quotes).where(eq(t.quotes.requestId,s.id));
        return {...s,quotes:qs,quoteAssessments:qs.map(q=>assessResearch(s,q as any)),selectedQuote:qs.find(q=>q.id===s.quoteId)??null,research:policy.research,policy};
      }
      case 'events': await this.state(this.db,a,params.id); return this.db.select().from(t.events).where(eq(t.events.requestId,params.id)).orderBy(asc(t.events.sequence));
      case 'requests': case 'blocked': case 'timeline': {
        const rs=await this.db.select().from(t.requests).where(scope(t.requests.workspaceId,a)); const result=[];
        for(const r of rs) {
          const rows=await this.db.select().from(t.events).where(eq(t.events.requestId,r.id)); const s=project(r.id,rows as Event[]);
          if(a.role==='requester' && s.requesterId!==a.id && s.data.ownerId!==a.id) continue;
          const policy=await this.policy(this.db,a,s); result.push({...s,policy,research:policy.research,selectedQuote:await this.selected(this.db,a,s)});
        }
        return kind==='blocked'?result.filter(r=>!['closed','canceled'].includes(r.status)):result;
      }
      case 'knowledge': {
        const search=(params.q??'').trim().toLowerCase(); const vs=await this.db.select().from(t.vendors).where(scope(t.vendors.workspaceId,a));
        const rs=await this.read(a,'requests') as any[];
        const visibleIds=new Set(rs.map(r=>r.id));
        const candidates=(await this.db.select().from(t.quotes).where(scope(t.quotes.workspaceId,a))).filter(q=>visibleIds.has(q.requestId));
        return vs.map(v=> {
          const purchases=rs.flatMap(r=>r.orders.filter((o:any)=>o.vendorId===v.id).map((o:any)=> {
            const receipts=r.receipts.filter((x:any)=>x.orderId===o.id); const complete=o.items.every((i:any)=>receipts.flatMap((x:any)=>x.quantities).filter((q:any)=>q.key===i.key).reduce((n:number,q:any)=>n+q.quantity,0)>=i.quantity);
            const arrived=complete?receipts.map((x:any)=>x.arrivedOn).sort().at(-1):null;
            return {requestId:r.id,title:r.data.title,orderId:o.id,state:o.state,simulation:o.simulation,categoryIds:o.items.map((i:any)=>i.categoryId),
              placedOn:o.placedOn,promisedOn:o.originalPromisedOn,arrivedOn:arrived,leadDays:arrived?daysBetween(o.placedOn,arrived):null,feedback:r.feedback};
          }));
          const real=purchases.filter(p=>!p.simulation&&p.leadDays!==null);
          const summary=(samples:typeof purchases)=> {
            const values=samples.map(p=>p.leadDays!).sort((a,b)=>a-b);
            const median=values.length?values.length%2?values[Math.floor(values.length/2)]:(values[values.length/2-1]+values[values.length/2])/2:null;
            return {medianCalendarDays:median,sampleCount:values.length};
          };
          const categoryIds=[...new Set(purchases.flatMap(p=>p.categoryIds))];
          return {...v,experience:purchases.some(p=>!p.simulation&&p.state==='confirmed')?'used':'researched',purchases,
            researchedQuotes:candidates.filter(q=>q.vendorId===v.id).map(q=>({...q,requestTitle:rs.find(r=>r.id===q.requestId)?.data.title})),
            observedLeadTime:{...summary(real),basis:'Completed real orders only; partial receipts count once.'},
            leadTimeByCategory:categoryIds.map(categoryId=>({categoryId,...summary(real.filter(p=>p.categoryIds.includes(categoryId)))})),
            simulatedLeadTime:{...summary(purchases.filter(p=>p.simulation&&p.leadDays!==null)),label:'FICTIONAL / SIMULATED observations; not real supplier performance'}};
        }).filter(v=>!search || JSON.stringify(v).toLowerCase().includes(search));
      }
      default: return fail('Unknown query.',404);
    }
  }
}
