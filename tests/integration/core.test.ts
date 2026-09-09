import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync,writeFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { database } from '../../src/db/index.js';
import * as t from '../../src/db/schema.js';
import { Engine,type Actor } from '../../src/engine.js';
import { hash,day,addDays,project } from '../../src/domain.js';
import { loadEnv,required } from '../../src/config.js';
import { createApp } from '../../src/server.js';
import { renderGantt } from '../../src/gantt.js';

loadEnv();
if(!process.env.NEON_BRANCH || process.env.NEON_BRANCH==='production') throw new Error('Integration tests require an explicit development branch.');
const {pool,db}=database(process.env.TEST_DATABASE_URL??required('DATABASE_URL_UNPOOLED'));
after(async()=>{await pool.end();});
const evidence={url:'https://example.com/fictional-evidence',note:'FICTIONAL TEST EVIDENCE',checkedAt:new Date().toISOString(),fictional:true};
const today=day();
async function fixture(opts:{regulated?:boolean;technical?:boolean;subtotal?:number;dailyCap?:number}={}) {
  const workspaceId=randomUUID();await db.insert(t.workspaces).values({id:workspaceId,name:'FICTIONAL integration '+workspaceId.slice(0,8),mode:'simulation'});
  const entries=['owner','agent','reviewer','requester'].map(role=>({id:randomUUID(),workspaceId,name:'Test '+role,role,keyHash:hash(role+workspaceId),enabled:true,createdAt:new Date()}));
  await db.insert(t.actors).values(entries); const [owner,agent,reviewer,requester]=entries as Actor[]; const engine=new Engine(db);
  const run=(type:string,body:any={},actor:Actor=owner,key=randomUUID())=>engine.execute(actor,key,{type,...body}) as Promise<any>;
  const requirements=opts.regulated?[{key:'permit',label:'Demo permit on file',kind:'permit',material:'Helium'}]:opts.technical?[{key:'spec',label:'Exact engineering specification',kind:'specification'}]:[];
  const category=await run('category.create',{name:opts.regulated?'Cryogens':opts.technical?'RF equipment':'Office supplies',defaults:{regulated:!!opts.regulated,technical:!!opts.technical,requirements}});
  const vendor=await run('vendor.save',{name:'Fictional Acme Supply',identity:'acme.example',categoryIds:[category.id],sources:[evidence],location:'Demo site'});
  const policy={currency:'USD',perOrderCap:10000,dailyCap:opts.dailyCap??25000,expensiveThreshold:50000,escalationOwnerId:owner.id,timezone:'UTC',allowedCategoryIds:[category.id],allowedVendorIds:[vendor.id],allowedSites:['Demo site'],requireRoutineApproval:true};
  await run('policy.set',{data:policy});
  async function request(title='Unfamiliar procurement') {
    const data={title,items:[{key:'item',description:title,quantity:2,categoryId:category.id}],site:'Demo site',neededBy:addDays(today,14),bufferDays:2};
    const r=await run('request.create',{data},agent); const ref={requestId:r.id,expectedRevision:1};
    await run('classification.verify',{...ref,regulated:!!opts.regulated,technical:!!opts.technical,evidence});
    const q=await run('quote.add',{requestId:r.id,vendorId:vendor.id,data:{summary:'FICTIONAL supplier quote',currency:'USD',costs:{subtotal:opts.subtotal??5000,shipping:500,tax:0,hazmat:0,other:0},leadDays:3,leadBasis:'vendor',expiresOn:addDays(today,30),sources:[evidence],fit:'Fixture matches requested quantity and scope'}},agent);
    await run('quote.select',{...ref,quoteId:q.id,reason:'Source supports requested scope'},agent);
    await run('approval.grant',{...ref,quoteId:q.id,expiresAt:new Date(Date.now()+3600000).toISOString(),evidence});
    return {r,q,ref,data};
  }
  return {engine,run,owner,agent,reviewer,requester,category,vendor,policy,request,workspaceId};
}
test('arbitrary category → research → simulated order → partial receipt → close → reusable history and Gantt',async()=> {
  const f=await fixture(); const {r,q,ref}=await f.request('Custom optical mounting hardware');
  const order=await f.run('checkout.simulate',{...ref,quoteId:q.id},f.agent);assert.equal(order.simulation,true);assert.equal(order.state,'confirmed');
  await f.run('receipt.record',{requestId:r.id,orderId:order.id,arrivedOn:today,quantities:[{key:'item',quantity:1}],accepted:true,evidence},f.agent);
  await assert.rejects(()=>f.run('request.close',ref),/All items/);
  await f.run('receipt.record',{requestId:r.id,orderId:order.id,arrivedOn:today,quantities:[{key:'item',quantity:1}],accepted:true,evidence},f.agent);
  await f.run('feedback.add',{requestId:r.id,note:'Fictional outcome: packed well; retain source for future mounts.'},f.agent);
  await f.run('request.close',ref); const final:any=await f.engine.read(f.owner,'request',{id:r.id});assert.equal(final.status,'closed');
  const knowledge:any=await f.engine.read(f.agent,'knowledge',{q:'Acme'});assert.equal(knowledge.length,1);assert.equal(knowledge[0].experience,'researched');assert.equal(knowledge[0].observedLeadTime.sampleCount,0);assert.equal(knowledge[0].purchases[0].leadDays,0);
  assert.match(knowledge[0].purchases[0].feedback[0].note,/packed well/);
  const next=await f.request('Repeat optical mounting hardware');assert.notEqual(next.r.id,r.id);
  const retained:any=await f.engine.read(f.agent,'knowledge',{q:'Repeat optical'});assert.equal(retained.length,1);assert.ok(retained[0].researchedQuotes.some((q:any)=>q.requestId===next.r.id));
  const rows=await f.engine.read(f.agent,'timeline') as any[];mkdirSync('artifacts',{recursive:true});writeFileSync('artifacts/procurement.html',renderGantt(rows));
  const events:any=await f.engine.read(f.owner,'events',{id:r.id});assert.equal(project(r.id,events).status,final.status);
});
test('idempotency is scoped, payload-bound and does not duplicate commitments',async()=> {
  const f=await fixture(),{r,q,ref}=await f.request(); const key=randomUUID();
  const one=await f.run('checkout.simulate',{...ref,quoteId:q.id},f.agent,key),two=await f.run('checkout.simulate',{...ref,quoteId:q.id},f.agent,key);
  assert.deepEqual(one,two);await assert.rejects(()=>f.run('checkout.simulate',{...ref,quoteId:q.id,outcome:'unknown'},f.agent,key),/different payload/);
  await assert.rejects(()=>f.run('checkout.simulate',{...ref,quoteId:q.id},f.agent),/already has an order/);
  const orders=await db.select().from(t.orders).where(eq(t.orders.requestId,r.id));assert.equal(orders.length,1);
});
test('concurrent checkouts share an atomic aggregate cap; unknown results retain reservations',async()=> {
  const f=await fixture({dailyCap:8000});const a=await f.request('First'),b=await f.request('Second');
  const results=await Promise.all([f.run('checkout.simulate',{...a.ref,quoteId:a.q.id,outcome:'unknown'},f.agent),f.run('checkout.simulate',{...b.ref,quoteId:b.q.id},f.agent)]);
  assert.equal(results.filter(r=>r.outcome==='blocked').length,1);assert.equal(results.filter(r=>r.id).length,1);
  const winning=results.find(r=>r.id);const winRef=results[0].id?a.ref:b.ref;
  if(winning.state==='unknown') {
    await assert.rejects(()=>f.run('order.resolve',{requestId:winRef.requestId,orderId:winning.id,outcome:'failed',reference:'reconciled',evidence},f.agent),/owner/);
    await f.run('order.resolve',{requestId:winRef.requestId,orderId:winning.id,outcome:'failed',reference:'confirmed not placed',evidence});
    const retry=await f.run('checkout.simulate',{...winRef,quoteId:results[0].id?a.q.id:b.q.id},f.agent);assert.equal(retry.state,'confirmed');
  }
});
test('regulated documentation blocks commitments and clearance never authorizes bot ordering',async()=> {
  const f=await fixture({regulated:true}),{r,q,ref}=await f.request('Helium delivery');
  let p:any=await f.engine.read(f.agent,'request',{id:r.id});assert.ok(p.policy.blocks.some((b:any)=>b.code==='requirement:permit'));
  await assert.rejects(()=>f.run('requirement.verify',{...ref,key:'permit',site:'Wrong site',material:'Helium',validFrom:today,validUntil:addDays(today,30),evidence}),/coverage/);
  await f.run('requirement.verify',{...ref,key:'permit',site:'Demo site',material:'Helium',validFrom:addDays(today,-10),validUntil:addDays(today,-1),evidence});
  p=await f.engine.read(f.agent,'request',{id:r.id});assert.equal(p.policy.humanAllowed,false);
  await f.run('requirement.verify',{...ref,key:'permit',site:'Demo site',material:'Helium',validFrom:today,validUntil:addDays(today,30),evidence});
  p=await f.engine.read(f.agent,'request',{id:r.id});assert.equal(p.policy.humanAllowed,true);assert.equal(p.policy.allowed,false);
  const result=await f.run('checkout.simulate',{...ref,quoteId:q.id},f.agent);assert.equal(result.outcome,'blocked');
  assert.ok(result.policy.blocks.some((b:any)=>b.code==='human-order-only'));
});
test('technical acceptance is separate from arrival',async()=> {
  const f=await fixture({technical:true}),{r,q,ref}=await f.request('RF amplifier');
  await f.run('requirement.verify',{...ref,key:'spec',site:'Demo site',validFrom:today,validUntil:addDays(today,30),evidence},f.reviewer);
  const o=await f.run('checkout.simulate',{...ref,quoteId:q.id},f.agent);
  await assert.rejects(()=>f.run('receipt.record',{requestId:r.id,orderId:o.id,arrivedOn:today,quantities:[{key:'item',quantity:2}],accepted:true,evidence},f.agent),/owner or reviewer/);
  const receipt=await f.run('receipt.record',{requestId:r.id,orderId:o.id,arrivedOn:today,quantities:[{key:'item',quantity:2}],accepted:false,evidence},f.agent);
  await assert.rejects(()=>f.run('request.close',ref),/accepted/);
  await f.run('receipt.accept',{requestId:r.id,receiptId:receipt.id,evidence},f.reviewer);await f.run('request.close',ref);
});
test('scope revisions invalidate approvals and retain established regulated requirements',async()=> {
  const f=await fixture({regulated:true}),{r,q,ref,data}=await f.request();
  await f.run('request.update',{...ref,data:{...data,regulated:false,requirements:[]},reason:'New quantity'},f.agent);
  const s:any=await f.engine.read(f.agent,'request',{id:r.id});assert.equal(s.data.regulated,true);assert.equal(s.data.requirements.length,1);assert.equal(s.revision,2);
  await assert.rejects(()=>f.run('checkout.simulate',{...ref,quoteId:q.id},f.agent),/revision changed/);
  assert.ok(s.policy.blocks.some((b:any)=>b.code==='quote-stale'));assert.ok(s.policy.blocks.some((b:any)=>b.code==='approval-required'));
});
test('database history rejects direct mutation and category cycles are rejected',async()=> {
  const f=await fixture(),{r}=await f.request();
  await assert.rejects(()=>pool.query('update procurement_events set type=$1 where request_id=$2',['fabricated',r.id]),/append-only/);
  await assert.rejects(()=>f.run('category.update',{categoryId:f.category.id,name:'Cycle',parentId:f.category.id,archived:false,defaults:{}}),/cycles/);
  await assert.rejects(()=>f.run('policy.set',{data:f.policy},f.agent),/owner/);
  await assert.rejects(()=>f.engine.state(db,f.requester,r.id),/not found/);
});
test('delivery changes preserve baseline and create an owner escalation',async()=> {
  const f=await fixture(),{r,q,ref}=await f.request();const o=await f.run('checkout.simulate',{...ref,quoteId:q.id},f.agent);
  await f.run('order.delivery-update',{requestId:r.id,orderId:o.id,promisedOn:addDays(today,20),evidence},f.agent);
  const s:any=await f.engine.read(f.agent,'request',{id:r.id});assert.equal(s.orders[0].originalPromisedOn,addDays(today,3));assert.equal(s.orders[0].promisedOn,addDays(today,20));assert.equal(s.policy.schedule.late,true);
  const blocker:any=Object.values(s.blockers)[0];assert.equal(blocker.resolverId,f.owner.id);
  await assert.rejects(()=>f.run('blocker.resolve',{requestId:r.id,blockerId:blocker.id,disposition:'Ignore'},f.agent),/named resolver/);
});
test('HTTP interface rejects missing auth, unauthorized approvals and malformed commands',async()=> {
  const f=await fixture();const server=createApp(f.engine);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address() as any,base='http://127.0.0.1:'+address.port;
  try {
    assert.equal((await fetch(base+'/queries/requests')).status,401);
    const headers={Authorization:'Bearer '+('agent'+f.workspaceId),'Content-Type':'application/json','Idempotency-Key':randomUUID()};
    const response=await fetch(base+'/commands',{method:'POST',headers,body:JSON.stringify({type:'policy.set',data:f.policy})});assert.equal(response.status,403);
    assert.equal((await fetch(base+'/commands',{method:'POST',headers,body:'bad'})).status,400);
    const me=await fetch(base+'/queries/me',{headers});assert.equal(me.status,200);assert.equal((await me.json()).id,f.agent.id);
  } finally { await new Promise<void>(resolve=>server.close(()=>resolve())); }
});

test('revocation and policy restoration cannot revive previously granted approvals',async()=> {
  const f=await fixture(),{r,q,ref}=await f.request();
  await f.run('policy.set',{data:{...f.policy,perOrderCap:6000}});
  await f.run('policy.set',{data:f.policy});
  const result=await f.run('checkout.simulate',{...ref,quoteId:q.id},f.agent);
  assert.equal(result.outcome,'blocked');assert.ok(result.policy.blocks.some((b:any)=>b.code==='approval-required'));
  await f.run('approval.grant',{...ref,quoteId:q.id,expiresAt:new Date(Date.now()+3600000).toISOString(),evidence});
  await f.run('approval.revoke',{requestId:r.id,reason:'Decision withdrawn'});
  assert.equal((await f.run('checkout.simulate',{...ref,quoteId:q.id},f.agent)).outcome,'blocked');
});

test('expensive requests require human confirmation; synthetic human receipts remain synthetic',async()=> {
  const f=await fixture({subtotal:60000}),{r,q,ref}=await f.request('Turbo pump');
  const result=await f.run('checkout.simulate',{...ref,quoteId:q.id},f.agent);assert.equal(result.outcome,'blocked');assert.equal(result.policy.humanOnly,true);
  await assert.rejects(()=>f.run('order.record',{...ref,quoteId:q.id,reference:'FICTIONAL-PO',placedOn:today,promisedOn:addDays(today,3),evidence},f.agent),/owner/);
  const order=await f.run('order.record',{...ref,quoteId:q.id,reference:'FICTIONAL-PO',placedOn:today,promisedOn:addDays(today,3),evidence});assert.equal(order.simulation,true);
  await f.run('receipt.record',{requestId:r.id,orderId:order.id,arrivedOn:today,quantities:[{key:'item',quantity:2}],accepted:true,evidence});
  const knowledge:any=await f.engine.read(f.agent,'knowledge');assert.equal(knowledge[0].observedLeadTime.sampleCount,0);assert.equal(knowledge[0].simulatedLeadTime.sampleCount,1);assert.equal(knowledge[0].leadTimeByCategory[0].sampleCount,0);
});

test('revoked permits and delivery beyond permit coverage block human order records',async()=> {
  const f=await fixture({regulated:true}),{r,q,ref}=await f.request();
  await f.run('requirement.verify',{...ref,key:'permit',site:'Demo site',material:'Helium',validFrom:today,validUntil:addDays(today,5),evidence});
  await assert.rejects(()=>f.run('order.record',{...ref,quoteId:q.id,reference:'TEST',placedOn:today,promisedOn:addDays(today,10),evidence}),/does not cover/);
  await f.run('requirement.revoke',{requestId:r.id,key:'permit',reason:'Fictional permit revoked',evidence});
  const outcome=await f.run('order.record',{...ref,quoteId:q.id,reference:'TEST',placedOn:today,promisedOn:addDays(today,3),evidence});assert.equal(outcome.outcome,'blocked');
});

test('unknown costs cannot become zero and changed quotes require a new decision',async()=> {
  const f=await fixture(),{r,ref}=await f.request();
  const q=await f.run('quote.add',{requestId:r.id,vendorId:f.vendor.id,data:{summary:'Unknown freight',currency:'USD',costs:{subtotal:100,shipping:null,tax:0,hazmat:0,other:0},leadDays:2,leadBasis:'vendor',expiresOn:addDays(today,30),sources:[evidence],fit:'Freight unresolved'}});
  await f.run('quote.select',{...ref,quoteId:q.id,reason:'New quote needs review'});
  const result=await f.run('checkout.simulate',{...ref,quoteId:q.id},f.agent);assert.equal(result.outcome,'blocked');assert.ok(result.policy.blocks.some((b:any)=>b.code==='cost-unknown'));assert.ok(result.policy.blocks.some((b:any)=>b.code==='approval-required'));
});

test('human-discovered regulation survives later intake edits and cannot be relabeled away',async()=> {
  const f=await fixture(),{r,ref,data}=await f.request();
  await f.run('classification.verify',{...ref,regulated:true,technical:false,evidence});
  await assert.rejects(()=>f.run('classification.verify',{...ref,regulated:false,technical:false,evidence}),/cannot be removed/);
  await f.run('request.update',{...ref,data,reason:'Clarify original description'},f.agent);
  const state:any=await f.engine.read(f.agent,'request',{id:r.id});assert.equal(state.data.regulated,true);
});
