import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { ZodError } from 'zod';
import { pathToFileURL } from 'node:url';
import { database } from './db/index.js';
import { Engine } from './engine.js';
import { Problem } from './domain.js';
import { loadEnv, required } from './config.js';
import { describe, playbooks } from './discovery.js';

export function createApp(engine: Engine): Server {
  return createServer(createHandler(engine));
}

export function createHandler(engine: Engine) {
  return async(req: IncomingMessage & { body?: unknown },res: ServerResponse)=> {
    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.setHeader('Cache-Control','no-store'); res.setHeader('X-Content-Type-Options','nosniff');
    const send=(status:number,value:unknown)=>{res.statusCode=status;res.end(JSON.stringify(value));};
    try {
      const url=new URL(req.url??'/', 'http://localhost');
      if(url.pathname==='/health' && req.method==='GET') { send(200,{status:'ok',service:'procurement'}); return; }
      if(req.headers.origin) throw new Problem(403,'Browser-origin API calls are not supported; use the CLI or server-side connector.');
      const match=/^Bearer ([^\s]+)$/.exec(req.headers.authorization??'');
      if(!match) throw new Problem(401,'A scoped bearer key is required.');
      const actor=await engine.authenticate(match[1]);
      if(req.method==='GET' && (url.pathname==='/queries/describe' || url.pathname.startsWith('/queries/describe/'))) {
        send(200,describe(url.pathname.slice('/queries/describe/'.length) || undefined)); return;
      }
      if(req.method==='GET' && (url.pathname==='/queries/playbooks' || url.pathname.startsWith('/queries/playbooks/'))) {
        send(200,playbooks(url.pathname.slice('/queries/playbooks/'.length) || undefined)); return;
      }
      if(req.method==='POST' && url.pathname==='/commands') {
        if(!req.headers['content-type']?.startsWith('application/json')) throw new Problem(415,'Use application/json.');
        let body='',size=0;
        if(req.body!==undefined) {
          body=typeof req.body==='string'?req.body:JSON.stringify(req.body);
          if(Buffer.byteLength(body)>256_000) throw new Problem(413,'Command exceeds 256 KB.');
        } else for await(const chunk of req) { size+=chunk.length; if(size>256_000) throw new Problem(413,'Command exceeds 256 KB.'); body+=chunk; }
        let input:unknown; try { input=JSON.parse(body); } catch { throw new Problem(400,'Invalid JSON.'); }
        const result=await engine.execute(actor,String(req.headers['idempotency-key']??''),input);
        send(200,result); return;
      }
      if(req.method==='GET' && url.pathname.startsWith('/queries/')) {
        const kind=url.pathname.slice('/queries/'.length);
        // One consistent snapshot keeps cross-record answers coherent under concurrent writes.
        const result=await engine.db.transaction(async tx => new Engine(tx as any).read(actor,kind,Object.fromEntries(url.searchParams)),{isolationLevel:'repeatable read',accessMode:'read only'});
        send(200,result); return;
      }
      send(404,{error:'Unknown route.'});
    } catch(error) {
      if(error instanceof Problem) send(error.status,{error:error.message});
      else if(error instanceof ZodError) send(400,{error:'Invalid input.',issues:error.issues.map(i=>({path:i.path,message:i.message}))});
      else { console.error('Request failed:',error instanceof Error?error.name:'Error'); send(500,{error:'Storage or internal operation failed; no successful completion is claimed.'}); }
    }
  };
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  loadEnv(process.env.PROCUREMENT_ENV_FILE??'.env.service.local');
  const {db,pool}=database(required('DATABASE_URL')); const server=createApp(new Engine(db));
  const port=Number(process.env.PORT??47831),host=process.env.HOST??'127.0.0.1';
  server.on('error',error=>{console.error('Could not start procurement service:',error.message);void pool.end();process.exitCode=1;});
  server.listen(port,host,()=>console.log(`Procurement service listening on http://${host}:${port}`));
  const stop=()=>server.close(()=>{void pool.end();}); process.on('SIGTERM',stop);process.on('SIGINT',stop);
}
