import test from 'node:test';
import assert from 'node:assert/strict';
import { quoteData, requestData, project, reviewEvidence, researchEvidence } from '../src/domain.js';
import { assessResearch } from '../src/research.js';
import { routeBlock } from '../src/policy.js';

const now=new Date('2026-09-09T12:00:00Z');
const source={url:'https://example.com/fixture',note:'FICTIONAL exact-product evidence',checkedAt:now.toISOString(),fictional:true};
function fixture() {
  const data=requestData.parse({title:'Snacks',items:[{key:'snack',description:'Exact snack box',quantity:2,categoryId:null}],site:'Office',neededBy:'2026-09-20',budgetCents:2000,requirements:[{key:'peanut',kind:'allergy',label:'Peanut requirement'}]});
  const state=project('r',[{id:'e',requestId:'r',actorId:'agent',sequence:1,type:'request.created',payload:{data,actorRole:'owner'},createdAt:now}]);
  const quote={id:'q',data:{...quoteData.parse({summary:'Exact snack box',currency:'USD',costBasis:'confirmed',costEvidence:source,costs:{subtotal:1500,tax:100,shipping:0,hazmat:0,other:0},leadDays:2,leadBasis:'vendor',priceBasis:'list-snapshot',priceCheckedAt:now.toISOString(),sources:[source],fit:'Two boxes',
    evidence:[{criterion:'scope',status:'supported',itemKeys:['snack'],finding:'Two boxes of requested variant',sources:[source]},
      {criterion:'availability',status:'supported',site:'Office',availability:{basis:'location-confirmed',location:'123 Fixture Street',itemKeys:['snack']},finding:'Supplier confirms two-day delivery',sources:[source]},
      {criterion:'requirement:peanut',status:'supported',finding:'Manufacturer evidence for exact product; human verification still needed',sources:[source]}],
    reviews:[{subject:'product',itemKey:'snack',target:'Exact snack box',platform:'Fixture store',rating:4.7,scaleMax:5,reviewCount:800,source}]}),requestRevision:1}};
  return {state,quote};
}

test('checklist covers requirements, scope, cost, timing and reviews without granting verification',()=>{
  const {state,quote}=fixture(),r=assessResearch(state,quote,now);
  assert.equal(r.readyToRecommend,true);assert.equal(r.checklist.length,6);
  assert.equal(r.reviews[0].reviewCount,800);assert.deepEqual(state.verifications,{});
  assert.equal(r.checklist.find(r=>r.criterion==='requirement:peanut')!.status,'supported');
});

test('missing exact-scope or site evidence, contradictory requirements and stale scope prevent recommendation',()=>{
  const {state,quote}=fixture();
  quote.data.evidence![0].itemKeys=[];quote.data.evidence![1].site='Other office';
  quote.data.evidence![2].status='contradicted';
  const r=assessResearch(state,quote,now);
  assert.equal(r.readyToRecommend,false);
  assert.ok(r.issues.some(i=>i.code==='vendor-timing-unsupported'&&i.blocksPurchase));
  assert.ok(r.issues.some(i=>i.code==='contradicted:requirement:peanut'&&i.blocksPurchase));
  state.revision=2;
  const stale=assessResearch(state,quote,now);assert.ok(stale.checklist.every(row=>row.status==='unresolved'));
});

test('list-price prose, unknown charges and missing review observations produce concrete corrections',()=>{
  const {state,quote}=fixture();delete quote.data.priceBasis;delete quote.data.priceCheckedAt;
  quote.data.terms='List-price snapshot';quote.data.costs.tax=null;quote.data.reviews=[];
  quote.data.evidence!.push({criterion:'reviews',status:'supported',finding:'Great reviews',sources:[source]});
  const r=assessResearch(state,quote,now);
  assert.ok(r.issues.some(i=>i.code==='price-basis-mismatch'&&i.field==='priceBasis'&&i.blocksPurchase));
  assert.ok(r.issues.some(i=>i.code==='landed-cost-unknown'));
  assert.ok(r.issues.some(i=>i.code==='reviews-unstructured'));
  assert.equal(r.readyToRecommend,false);
});

test('unavailable reviews can be explained; budget, currency, deadline and future evidence remain visible',()=>{
  const {state,quote}=fixture();delete quote.data.reviews;
  quote.data.evidence!.push({criterion:'reviews',status:'unresolved',finding:'No relevant reviews found on manufacturer or retailer pages',sources:[]});
  assert.equal(assessResearch(state,quote,now).readyToRecommend,true);
  quote.data.currency='EUR';state.data.neededBy=null;
  let r=assessResearch(state,quote,now);assert.equal(r.readyToRecommend,false);
  assert.equal(r.checklist.find(r=>r.criterion==='landed-cost')!.status,'contradicted');
  assert.equal(r.checklist.find(r=>r.criterion==='deadline')!.status,'unresolved');
  quote.data.sources=[{...source,checkedAt:'2026-09-10T12:00:00Z'}];
  r=assessResearch(state,quote,now);assert.ok(r.issues.some(i=>i.code==='future-source'&&i.blocksPurchase));
});

test('structured review scales/counts and supported evidence are validated',()=>{
  const base={subject:'product',itemKey:'snack',target:'Exact snack box',platform:'Fixture',rating:4.7,scaleMax:5,reviewCount:800,source};
  assert.equal(reviewEvidence.safeParse(base).success,true);
  for(const change of [{rating:6},{reviewCount:0},{reviewCount:2.5},{itemKey:undefined}]) assert.equal(reviewEvidence.safeParse({...base,...change}).success,false);
  assert.equal(researchEvidence.safeParse({criterion:'scope',status:'supported',finding:'Looks good'}).success,false);
});

test('research fixes route to agents while decisions and named manual blockers retain their owners',()=>{
  for(const code of ['cost-unknown','quote-expired','quote-missing','research:vendor-timing-unsupported'])
    assert.deepEqual(routeBlock({code,reason:'Fix',resolverId:'owner'},'owner','agent'),{code,reason:'Fix',resolverId:'agent',resolverType:'agent'});
  for(const code of ['approval-required','requirement:peanut','daily-cap','policy-unconfigured','classification-unverified'])
    assert.equal(routeBlock({code,reason:'Decide',resolverId:'owner'},'owner','agent').resolverId,'owner');
  assert.equal(routeBlock({code:'blocker:manual',reason:'Resolve',resolverId:'reviewer'},'owner','agent').resolverId,'reviewer');
  assert.equal(routeBlock({code:'cost-unknown',reason:'Fix',resolverId:'owner'},'owner',null).resolverId,null);
});

test('estimated tax, generic pickup and agent-invented constraints cannot produce readiness',()=>{
  const {state,quote}=fixture();
  quote.data.costBasis='estimate';
  quote.data.evidence![1].availability!.basis='listing-only';
  state.constraintProvenance!.confirmed=false;
  const r=assessResearch(state,quote,now);
  assert.equal(r.readyToRecommend,false);
  for(const criterion of ['availability','landed-cost','deadline']) assert.equal(r.checklist.find(c=>c.criterion===criterion)!.status,'unresolved');
  assert.ok(r.issues.some(i=>i.code==='cost-unconfirmed'&&i.blocksPurchase));
  assert.ok(r.issues.some(i=>i.code==='constraints-unconfirmed'&&i.blocksPurchase));
  delete quote.data.costBasis;
  assert.ok(assessResearch(state,quote,now).issues.some(i=>i.code==='cost-unconfirmed'));
});

test('legacy owner estimates cannot impersonate authenticated provenance; historical forecasts stay provisional',()=>{
  const {state,quote}=fixture();
  quote.data.leadBasis='owner-estimate';
  assert.ok(assessResearch(state,quote,now).issues.some(i=>i.code==='owner-estimate-unattributed'&&i.blocksPurchase));
  for(const leadBasis of ['historical','agent-estimate'] as const){
    quote.data.leadBasis=leadBasis;
    const r=assessResearch(state,quote,now);
    assert.equal(r.readyToRecommend,false);
    assert.equal(r.checklist.find(c=>c.criterion==='deadline')!.status,'unresolved');
  }
  quote.data.costEvidence={...source,checkedAt:'2026-09-10T12:00:00Z'};
  assert.ok(assessResearch(state,quote,now).issues.some(i=>i.code==='cost-unconfirmed'&&i.blocksPurchase));
});
