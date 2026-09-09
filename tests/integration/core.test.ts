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

loadEnv(process.env.PROCUREMENT_TEST_ENV_FILE??'.env.test.local');
if(!process.env.NEON_BRANCH || process.env.NEON_BRANCH==='production') throw new Error('Integration tests require an explicit development branch.');
const {pool,db}=database(required('TEST_DATABASE_URL'));
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
    await run('request.confirm',{...ref,evidence});
    await run('classification.verify',{...ref,regulated:!!opts.regulated,technical:!!opts.technical,evidence});
    const q=await run('quote.add',{requestId:r.id,vendorId:vendor.id,data:{summary:'FICTIONAL supplier quote',currency:'USD',costBasis:'confirmed',costEvidence:evidence,costs:{subtotal:opts.subtotal??5000,shipping:500,tax:0,hazmat:0,other:0},leadDays:3,leadBasis:'vendor',expiresOn:addDays(today,30),sources:[evidence],fit:'Fixture matches requested quantity and scope',evidence:[{criterion:'scope',status:'supported',itemKeys:['item'],finding:'Fixture covers both requested units',sources:[evidence]},{criterion:'availability',status:'supported',site:'Demo site',availability:{basis:'location-confirmed',location:'123 Fictional Test Street',itemKeys:['item']},finding:'Fixture vendor confirms delivery basis',sources:[evidence]}]}},agent);
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
    assert.equal((await fetch(base+'/queries/describe/quote.add')).status,401);
    const schema=await fetch(base+'/queries/describe/quote.add',{headers});assert.equal(schema.status,200);
    assert.equal((await schema.json()).properties.type.const,'quote.add');
    assert.equal((await fetch(base+'/queries/describe/not-a-command',{headers})).status,404);
    const books=await (await fetch(base+'/queries/playbooks',{headers})).json();
    assert.ok(books.playbooks.some((p:any)=>p.name==='research' && p.content.includes('quote') && p.revision.length===64));
    assert.equal((await fetch(base+'/queries/playbooks/research.md',{headers})).status,200);
    assert.equal((await fetch(base+'/queries/playbooks/not-a-playbook',{headers})).status,404);
    const {r,q}=await f.request('HTTP selected quote regression');
    const selected=await (await fetch(base+'/queries/request?id='+r.id,{headers})).json();
    assert.equal(selected.quoteId,q.id);assert.equal(selected.selectedQuote.id,q.id);
    const visible=await (await fetch(base+'/queries/requests',{headers})).json();
    assert.deepEqual(visible.map((r:any)=>r.id),[r.id]);
    assert.deepEqual(visible[0].selectedQuote,selected.selectedQuote);
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

test('structured research persists and can support a recommendation without granting human verification',async()=> {
  const f=await fixture({technical:true}),{r,ref,data}=await f.request('Specified amplifier');
  const before:any=await f.engine.read(f.agent,'request',{id:r.id});
  const {requestRevision,recordedBy,...base}=before.selectedQuote.data;
  const evidenceRows=[...base.evidence,{criterion:'requirement:spec',status:'supported',finding:'Manufacturer specification matches the exact requested model',sources:[evidence]}];
  const reviews=[{subject:'product',itemKey:'item',target:'Specified amplifier variant',platform:'Fixture supplier',rating:4.7,scaleMax:5,reviewCount:800,source:evidence}];
  const input={requestId:r.id,vendorId:f.vendor.id,data:{...base,evidence:evidenceRows,reviews}};
  const key=randomUUID(),q=await f.run('quote.add',input,f.agent,key);
  assert.equal(q.research.readyToRecommend,true);
  assert.deepEqual(await f.run('quote.add',input,f.agent,key),q);
  const selected=await f.run('quote.select',{...ref,quoteId:q.id,reason:'Evidence-backed option'},f.agent);
  assert.equal(selected.selectedQuote.id,q.id);assert.equal(selected.research.reviews[0].reviewCount,800);
  const saved:any=await f.engine.read(f.agent,'request',{id:r.id});
  assert.equal(saved.research.readyToRecommend,true);
  assert.equal(saved.research.checklist.find((c:any)=>c.criterion==='requirement:spec').status,'supported');
  assert.ok(saved.policy.blocks.some((b:any)=>b.code==='requirement:spec'&&b.resolverId===f.owner.id&&b.resolverType==='owner'));
  assert.equal(saved.policy.allowed,false);
  await assert.rejects(()=>f.run('requirement.verify',{...ref,key:'spec',site:'Demo site',validFrom:today,validUntil:addDays(today,30),evidence},f.agent),/owner or reviewer/);
  const knowledge:any=await f.engine.read(f.agent,'knowledge');
  assert.equal(knowledge[0].researchedQuotes.find((v:any)=>v.id===q.id).data.reviews[0].reviewCount,800);
  await f.run('requirement.verify',{...ref,key:'spec',site:'Demo site',validFrom:today,validUntil:addDays(today,30),evidence});
  const contradicted=await f.run('quote.add',{...input,data:{...input.data,evidence:evidenceRows.map((e:any)=>e.criterion==='requirement:spec'?{...e,status:'contradicted',finding:'Correction: connector incompatible'}:e)}},f.agent);
  await f.run('quote.select',{...ref,quoteId:contradicted.id,reason:'Keep incompatible option visible for review'},f.agent);
  await f.run('approval.grant',{...ref,quoteId:contradicted.id,expiresAt:new Date(Date.now()+3600000).toISOString(),evidence});
  const blocked=await f.run('checkout.simulate',{...ref,quoteId:contradicted.id},f.agent);
  assert.equal(blocked.outcome,'blocked');assert.ok(blocked.policy.blocks.some((b:any)=>b.code==='research:contradicted:requirement:spec'));
  await f.run('request.update',{...ref,data:{...data,items:data.items.map(i=>({...i,quantity:3}))},reason:'Quantity changed'},f.owner);
  const revised:any=await f.engine.read(f.agent,'request',{id:r.id});
  assert.equal(revised.research.readyToRecommend,false);assert.ok(revised.research.checklist.every((c:any)=>c.status==='unresolved'));
});

test('saved quote corrections route to the bot while approvals and manual blockers retain human ownership',async()=> {
  const f=await fixture(),{r,ref}=await f.request('Snacks');
  const q=await f.run('quote.add',{requestId:r.id,vendorId:f.vendor.id,data:{summary:'Snack assortment',terms:'List-price snapshot. Pickup assumed.',currency:'USD',costs:{subtotal:1598,tax:null,shipping:0,hazmat:0,other:0},leadDays:0,leadBasis:'vendor',expiresOn:null,sources:[evidence],fit:'Unverified pickup option'}},f.agent);
  assert.ok(q.research.issues.some((i:any)=>i.code==='price-basis-mismatch'));
  assert.ok(q.research.issues.some((i:any)=>i.code==='vendor-timing-unsupported'));
  await f.run('quote.select',{...ref,quoteId:q.id,reason:'Provisional candidate'},f.agent);
  const manual=await f.run('blocker.add',{requestId:r.id,reason:'Reviewer input',resolverId:f.reviewer.id,decisionBy:null});
  for(const actor of [f.agent,f.owner]) {
    const saved:any=await f.engine.read(actor,'request',{id:r.id});
    for(const code of ['cost-unknown','quote-expired','research:price-basis-mismatch','research:vendor-timing-unsupported']) {
      const b=saved.policy.blocks.find((b:any)=>b.code===code);assert.equal(b.resolverType,'agent');assert.equal(b.resolverId,f.agent.id);
    }
    assert.equal(saved.policy.blocks.find((b:any)=>b.code==='approval-required').resolverId,f.owner.id);
    assert.equal(saved.policy.blocks.find((b:any)=>b.code==='blocker:'+manual.id).resolverId,f.reviewer.id);
    assert.ok(saved.research.issues.every((i:any)=>i.resolverType==='agent'&&i.resolverId===f.agent.id));
  }
  await db.update(t.workspaces).set({policy:{}}).where(eq(t.workspaces.id,f.workspaceId));
  const unconfigured:any=await f.engine.read(f.owner,'request',{id:r.id});
  assert.equal(unconfigured.policy.blocks.find((b:any)=>b.code==='policy-unconfigured').resolverId,f.owner.id);
  assert.equal(unconfigured.policy.blocks.find((b:any)=>b.code==='cost-unknown').resolverId,f.agent.id);
});

test('research evidence rejects duplicate criteria, unknown item references and duplicate review observations',async()=> {
  const f=await fixture(),{r}=await f.request();
  const saved:any=await f.engine.read(f.agent,'request',{id:r.id});
  const {requestRevision,recordedBy,...base}=saved.selectedQuote.data;
  const add=(changes:any)=>f.run('quote.add',{requestId:r.id,vendorId:f.vendor.id,data:{...base,...changes}},f.agent);
  await assert.rejects(()=>add({evidence:[base.evidence[0],base.evidence[0]]}),/Duplicate evidence/);
  await assert.rejects(()=>add({evidence:[{...base.evidence[0],criterion:'requirement:invented'}]}),/Unknown evidence/);
  await assert.rejects(()=>add({evidence:[{...base.evidence[0],itemKeys:['other-item']}]}),/unknown request item/);
  const review={subject:'product',itemKey:'item',target:'Exact variant',platform:'Fixture',rating:4.7,scaleMax:5,reviewCount:800,source:evidence};
  await assert.rejects(()=>add({reviews:[{...review,itemKey:'unknown'}]}),/unknown request item/);
  await assert.rejects(()=>add({reviews:[review,review]}),/Duplicate review/);
  const final:any=await f.engine.read(f.agent,'request',{id:r.id});assert.equal(final.quotes.length,saved.quotes.length);
});

test('agents cannot rewrite constraints or self-confirm; proposals preserve state until a human accepts',async()=>{
  const f=await fixture(),{r,ref}=await f.request('Office snacks');
  const initial:any=await f.engine.read(f.agent,'request',{id:r.id});
  for(const change of [{neededBy:addDays(today,30)},{bufferDays:0},{budgetCents:99999},{site:'Other office'},{currency:'EUR'},
    {items:initial.data.items.map((i:any)=>({...i,quantity:3}))}]) {
    await assert.rejects(()=>f.run('request.update',{...ref,data:{...initial.data,...change},reason:'Make the checks pass'},f.agent),/owner or requester/);
  }
  await assert.rejects(()=>f.run('request.confirm',{...ref,evidence},f.agent),/owner or requester/);
  const proposed={...initial.data,neededBy:addDays(today,30),bufferDays:0};
  const key=randomUUID(),body={...ref,data:proposed,reason:'Proposed later date, not yet accepted'};
  const p=await f.run('request.propose',body,f.agent,key);
  assert.equal(p.applied,false);assert.deepEqual(await f.run('request.propose',body,f.agent,key),p);
  let saved:any=await f.engine.read(f.agent,'request',{id:r.id});
  assert.deepEqual(saved.data,initial.data);assert.deepEqual(saved.approvals,initial.approvals);
  assert.equal(saved.proposals.length,1);assert.equal(saved.revision,1);
  await f.run('request.update',{...ref,data:proposed,reason:'Owner accepts later date'},f.owner);
  saved=await f.engine.read(f.agent,'request',{id:r.id});
  assert.equal(saved.revision,2);assert.equal(saved.data.neededBy,proposed.neededBy);
  assert.equal(saved.constraintProvenance.actorId,f.owner.id);assert.equal(saved.constraintProvenance.confirmed,true);
  assert.equal(saved.approvals.length,0);
  await assert.rejects(()=>f.run('request.confirm',{...ref,evidence}),/revision changed/);
});

test('quote provenance is authenticated and estimated final costs remain blocked after approval',async()=>{
  const f=await fixture(),{r,ref}=await f.request();
  const initial:any=await f.engine.read(f.agent,'request',{id:r.id});
  const {requestRevision,recordedBy,...base}=initial.selectedQuote.data;
  const add=(data:any,actor=f.agent)=>f.run('quote.add',{requestId:r.id,vendorId:f.vendor.id,data},actor);
  await assert.rejects(()=>add({...base,leadBasis:'owner-estimate'}),/owner/);
  await assert.rejects(()=>add({...base,recordedBy:{actorId:f.owner.id,role:'owner',recordedAt:new Date().toISOString()}}),/Unrecognized/);
  await assert.rejects(()=>add({...base,costEvidence:undefined}),/final payable cost evidence/);
  const estimate=await add({...base,costBasis:'estimate',leadBasis:'agent-estimate'});
  await f.run('quote.select',{...ref,quoteId:estimate.id,reason:'Provisional estimate'},f.agent);
  await f.run('approval.grant',{...ref,quoteId:estimate.id,expiresAt:new Date(Date.now()+3600000).toISOString(),evidence});
  const saved:any=await f.engine.read(f.agent,'request',{id:r.id});
  assert.equal(saved.selectedQuote.data.recordedBy.actorId,f.agent.id);
  assert.equal(saved.research.readyToRecommend,false);
  assert.equal((await f.run('checkout.simulate',{...ref,quoteId:estimate.id},f.agent)).outcome,'blocked');
  const ownerQuote=await add({...base,leadBasis:'owner-estimate'},f.owner);
  assert.ok(!ownerQuote.research.issues.some((i:any)=>i.code==='owner-estimate-unattributed'));
});

test('agent intake and legacy constraints are unconfirmed, with human confirmation routed to the owner',async()=>{
  const f=await fixture();
  const data={title:'Snacks',items:[{key:'snacks',description:'Snacks',quantity:1,categoryId:f.category.id}],site:'Office',neededBy:null,budgetCents:2000};
  const r=await f.run('request.create',{data},f.agent),ref={requestId:r.id,expectedRevision:1};
  let saved:any=await f.engine.read(f.agent,'request',{id:r.id});
  assert.equal(saved.constraintProvenance.role,'agent');assert.equal(saved.constraintProvenance.confirmed,false);
  assert.equal(saved.research.issues.find((i:any)=>i.code==='constraints-unconfirmed').resolverId,f.owner.id);
  await f.run('request.confirm',{...ref,evidence});
  saved=await f.engine.read(f.agent,'request',{id:r.id});
  assert.equal(saved.constraintProvenance.confirmed,true);assert.equal(saved.data.neededBy,null);
  assert.equal(saved.revision,1);
  const legacy=project(r.id,[{id:randomUUID(),requestId:r.id,actorId:f.owner.id,sequence:1,type:'request.created',payload:{data},createdAt:new Date()}]);
  assert.equal(legacy.constraintProvenance!.confirmed,false);
});
