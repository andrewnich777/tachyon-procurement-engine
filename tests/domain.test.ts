import test from 'node:test';
import assert from 'node:assert/strict';
import { date, total, hash, project, schedule, requestData, quoteData } from '../src/domain.js';
import { renderGantt } from '../src/gantt.js';
import { evaluate } from '../src/policy.js';

test('exact landed costs preserve unknowns and exclude conditional restocking fees',()=> {
  const costs={subtotal:1000,discount:100,shipping:200,tax:50,hazmat:0,other:0,restockingTerms:'25% if returned'};
  assert.equal(total(costs),1150);assert.equal(total({...costs,tax:null}),null);
  assert.throws(()=>total({...costs,discount:2000}),/Invalid landed cost/);
});
test('dates validate real days and compute calendar order-by with buffer',()=> {
  assert.equal(date.safeParse('2026-02-30').success,false);
  assert.equal(date.safeParse('2028-02-29').success,true);
  const data=requestData.parse({title:'Pump',items:[{key:'pump',description:'Pump',quantity:1,categoryId:null}],site:'Demo site',neededBy:'2026-10-01',bufferDays:3});
  const s=project('id',[{id:'e',requestId:'id',actorId:'a',sequence:1,type:'request.created',payload:{data},createdAt:'2026-09-01T00:00:00Z'}]);
  const q=quoteData.parse({summary:'Quote',currency:'USD',costs:{subtotal:1,shipping:0,tax:0,hazmat:0,other:0},leadDays:5,leadBasis:'vendor',expiresOn:'2026-10-01',sources:[{url:'https://example.com/quote',note:'Fixture',checkedAt:'2026-09-01T00:00:00Z'}],fit:'Matches'});
  assert.equal(schedule(s,q,'2026-09-01').orderBy,'2026-09-23');assert.equal(schedule(s,null).orderBy,null);
});
test('event projection is deterministic and source objects are not changed',()=> {
  const rows=[{id:'2',requestId:'r',actorId:'a',sequence:2,type:'request.canceled',payload:{reason:'test'},createdAt:'2026-09-02T00:00:00Z'},
    {id:'1',requestId:'r',actorId:'a',sequence:1,type:'request.created',payload:{data:{title:'Initial'}},createdAt:'2026-09-01T00:00:00Z'}];
  const before=JSON.stringify(rows);assert.deepEqual(project('r',rows),project('r',rows));assert.equal(project('r',rows).status,'canceled');assert.equal(JSON.stringify(rows),before);
  assert.equal(hash({b:2,a:1}),hash({a:1,b:2}));
});
test('standalone chart escapes embedded script content and contains no remote dependencies',()=> {
  const html=renderGantt([{id:'r',data:{title:'</script><script>alert(1)</script>',ownerId:'x'},requesterId:'x',status:'researching',version:1,updatedAt:'2026-09-01',orders:[],receipts:[],policy:{schedule:{},blocks:[]}}]);
  assert.ok(!html.includes('</script><script>alert(1)'));
  assert.ok(html.includes('\\u003c/script>'));assert.ok(html.includes("connect-src 'none'"));assert.ok(!html.includes('script src='));
});

test('catalog snapshots have bounded freshness without inventing formal quote expiry',()=> {
  const now=new Date('2026-09-09T12:00:00Z');
  const data=requestData.parse({title:'Snacks',items:[{key:'food',description:'Snacks',quantity:1,categoryId:null}],site:'Demo',neededBy:null});
  const s=project('r',[{id:'e',requestId:'r',actorId:'a',sequence:1,type:'request.created',payload:{data},createdAt:now}]);
  const base=quoteData.parse({summary:'Catalog',currency:'USD',costs:{subtotal:100,shipping:null,tax:0,hazmat:0,other:0},leadDays:3,leadBasis:'vendor',sources:[{url:'https://example.com',note:'FICTIONAL',checkedAt:now.toISOString()}],fit:'Matches'});
  const codes=(data:any)=>evaluate(s,{id:'q',vendorId:'v',data:{...data,requestRevision:1}},{},0,false,now).blocks.map(b=>b.code);
  assert.ok(codes(base).includes('quote-expired'));
  const current={...base,priceBasis:'list-snapshot',priceCheckedAt:now.toISOString()};
  assert.ok(!codes(current).includes('quote-expired'));
  assert.ok(!codes(current).includes('catalog-price-stale'));
  assert.ok(codes(current).includes('cost-unknown'));
  for(const priceCheckedAt of [undefined,'2026-09-01T12:00:00Z','2026-09-10T12:00:00Z'])
    assert.ok(codes({...current,priceCheckedAt}).includes('catalog-price-stale'));
  assert.ok(codes({...current,expiresOn:'2026-09-08'}).includes('quote-expired'));
  assert.ok(codes({...base,expiresOn:'2026-09-08'}).includes('quote-expired'));
});
