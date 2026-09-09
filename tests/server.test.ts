import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../src/server.js';
import type { Engine } from '../src/engine.js';

test('hosting adapter accepts already-parsed JSON and retains the command size limit',async()=> {
  let calls=0;
  const engine={authenticate:async()=>({id:'agent'}),execute:async(_actor:unknown,key:string,body:unknown)=>{calls++;return {key,body};}} as unknown as Engine;
  const handler=createHandler(engine);
  async function send(body:unknown) {
    let value:any;
    const response={statusCode:0,setHeader(){},end(text:string){value=JSON.parse(text);}};
    await handler({url:'/commands',method:'POST',headers:{authorization:'Bearer test-agent','content-type':'application/json','idempotency-key':'test-hosted-body'},body} as any,response as any);
    return {status:response.statusCode,value};
  }
  const command={type:'category.create',name:'Services'};
  const accepted=await send(command);
  assert.equal(accepted.status,200);assert.deepEqual(accepted.value.body,command);
  assert.equal(accepted.value.key,'test-hosted-body');
  assert.equal((await send({name:'é'.repeat(130000)})).status,413);
  assert.equal((await send('not JSON')).status,400);
  assert.equal(calls,1);
});
