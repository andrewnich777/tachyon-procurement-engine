import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { and, eq } from 'drizzle-orm';
import { database } from '../src/db/index.js';
import { Engine } from '../src/engine.js';
import { addDays, day } from '../src/domain.js';
import * as t from '../src/db/schema.js';

// Explicit operator command. Never invoked by setup, deployment, or the bot.
const service=parseEnv(readFileSync('.env.service.local','utf8'));
const ownerEnv=parseEnv(readFileSync('.env.owner.local','utf8'));
if(!service.DATABASE_URL || !ownerEnv.PROCUREMENT_KEY) throw new Error('Local service and owner credentials are required.');
const {pool,db}=database(service.DATABASE_URL);
try {
  const engine=new Engine(db),owner=await engine.authenticate(ownerEnv.PROCUREMENT_KEY);
  const w=await engine.workspace(db,owner);
  if(owner.role!=='owner' || w.mode!=='simulation') throw new Error('Demo seed requires an owner in a simulation workspace.');
  const previous=await db.select().from(t.commands).where(and(eq(t.commands.workspaceId,w.id),eq(t.commands.actorId,owner.id)));
  const seedCommands=previous.filter(c=>c.key.startsWith('demo-seed-v1:'));
  const anchor=seedCommands[0]?.createdAt??new Date(),today=day(anchor);
  const evidence={url:'https://example.com/fictional-procurement-demo',note:'FICTIONAL demonstration data; not a vendor offer or regulatory determination.',checkedAt:anchor.toISOString(),fictional:true};
  async function run(key:string,command:unknown):Promise<any> {
    const stable='demo-seed-v1:'+key;
    const saved=seedCommands.find(c=>c.key===stable);
    if(saved) return saved.result;
    return engine.execute(owner,stable,command);
  }
  const office=await run('office',{type:'category.create',name:'Office supplies'});
  const food=await run('food',{type:'category.create',name:'Food',parentId:office.id,defaults:{requirements:[{key:'allergy',label:'Snack ingredients match the stated dietary requirements',kind:'allergy'}]}});
  const equipment=await run('equipment',{type:'category.create',name:'Technical equipment and parts'});
  const pumps=await run('pumps',{type:'category.create',name:'Vacuum pumps',parentId:equipment.id,defaults:{technical:true,requirements:[{key:'spec',label:'Engineering specification acceptance',kind:'specification'}]}});
  const gas=await run('gas',{type:'category.create',name:'Regulated gas',parentId:equipment.id,defaults:{regulated:true,requirements:[{key:'permit',label:'Applicable permit/license on file for the demo site',kind:'permit',material:'Helium'}]}});
  const vendor=await run('vendor',{type:'vendor.save',name:'FICTIONAL Demo Supply',identity:'fictional-demo.example.com',location:'Fictional demo site',categoryIds:[food.id,pumps.id,gas.id],sources:[evidence]});
  if(!Object.keys(w.policy as object).length) await run('policy',{type:'policy.set',data:{currency:'USD',perOrderCap:25000,dailyCap:100000,expensiveThreshold:100000,escalationOwnerId:owner.id,timezone:'America/Los_Angeles',allowedCategoryIds:[office.id,equipment.id],allowedVendorIds:[vendor.id],allowedSites:['Fictional demo site'],requireRoutineApproval:true}});
  const examples=[
    {key:'snacks',title:'FICTIONAL — office snacks',categoryId:food.id,subtotal:7500,technical:false,regulated:false,leadDays:2},
    {key:'pump',title:'FICTIONAL — turbo pump',categoryId:pumps.id,subtotal:4500000,technical:true,regulated:false,leadDays:21},
    {key:'helium',title:'FICTIONAL — helium dewar delivery',categoryId:gas.id,subtotal:75000,technical:false,regulated:true,leadDays:7},
  ];
  const requests=[];
  for(const item of examples) {
    const r=await run(item.key+':request',{type:'request.create',data:{title:item.title,items:[{key:item.key,description:item.title,quantity:1,categoryId:item.categoryId}],site:'Fictional demo site',neededBy:addDays(today,30),ownerId:owner.id,notes:'FICTIONAL prices, vendors and requirements. Checkout is simulated.'}});
    const ref={requestId:r.id,expectedRevision:1};
    await run(item.key+':classification',{type:'classification.verify',...ref,technical:item.technical,regulated:item.regulated,evidence});
    const q=await run(item.key+':quote',{type:'quote.add',requestId:r.id,vendorId:vendor.id,data:{summary:'FICTIONAL price for demonstration',currency:'USD',costs:{subtotal:item.subtotal,shipping:0,tax:0,hazmat:0,other:0},leadDays:item.leadDays,leadBasis:'owner-estimate',priceBasis:item.key==='snacks'?'list-snapshot':'formal-quote',...(item.key==='snacks'?{priceCheckedAt:anchor.toISOString()}:{expiresOn:addDays(today,30)}),sources:[evidence],fit:'FICTIONAL match; engineering and permit gates remain visible.'}});
    await run(item.key+':select',{type:'quote.select',...ref,quoteId:q.id,reason:'Staged fictional example'});
    if(item.key==='snacks') {
      await run('snacks:allergy',{type:'requirement.verify',...ref,key:'allergy',site:'Fictional demo site',validFrom:today,validUntil:addDays(today,30),evidence});
      await run('snacks:approval',{type:'approval.grant',...ref,quoteId:q.id,expiresAt:addDays(today,7)+'T23:59:59Z',evidence});
    }
    requests.push({id:r.id,title:item.title});
  }
  console.log(JSON.stringify({workspaceId:w.id,mode:w.mode,requests,note:'No purchases placed. Existing requests and audit history retained.'},null,2));
} finally {await pool.end();}
