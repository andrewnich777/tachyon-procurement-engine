import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { database } from '../src/db/index.js';
import { loadEnv, required } from '../src/config.js';
import { hash } from '../src/domain.js';
import * as t from '../src/db/schema.js';

loadEnv();
if(!process.env.NEON_BRANCH || process.env.NEON_BRANCH==='production') throw new Error('Select a development branch before setup.');
const paths=['.env.service.local','.env.owner.local','.env.bot.local'];
for(const path of paths) if(existsSync(path)) throw new Error(`${path} exists; setup will not overwrite credentials.`);
const url=required('DATABASE_URL_UNPOOLED'),{pool,db}=database(url);
const workspaceId=randomUUID(),ownerId=randomUUID(),botId=randomUUID();
const ownerKey=randomBytes(32).toString('hex'),botKey=randomBytes(32).toString('hex');
const servicePassword=randomBytes(32).toString('hex');
try {
  const role='procurement_service';
  const existing=await pool.query('select 1 from pg_roles where rolname=$1',[role]);
  if(existing.rowCount) throw new Error('Service role already exists. Configure a service URL manually instead of rotating a shared role.');
  await db.transaction(async tx=> {
    await tx.insert(t.workspaces).values({id:workspaceId,name:process.env.WORKSPACE_NAME??'Procurement development',mode:'simulation'});
    await tx.insert(t.actors).values([
      {id:ownerId,workspaceId,name:'Procurement owner',role:'owner',keyHash:hash(ownerKey)},
      {id:botId,workspaceId,name:'Procurement Bot',role:'agent',keyHash:hash(botKey)},
    ]);
  });
  // The service role has no schema ownership or DDL rights; bot clients receive only a scoped API key.
  await pool.query(`CREATE ROLE ${role} LOGIN PASSWORD '${servicePassword}'`);
  await pool.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
  await pool.query(`GRANT SELECT ON workspaces,actors,categories,vendors,requests,quotes,procurement_events,commands,orders TO ${role}`);
  await pool.query(`GRANT INSERT ON categories,vendors,requests,quotes,procurement_events,commands,orders TO ${role}`);
  await pool.query(`GRANT UPDATE ON workspaces,categories,vendors,orders TO ${role}`);
  const serviceURL=new URL(required('DATABASE_URL'));serviceURL.username=role;serviceURL.password=servicePassword;
  writeFileSync(paths[0],`DATABASE_URL=${serviceURL}\nHOST=127.0.0.1\nPORT=47831\n`,{flag:'wx',mode:0o600});
  writeFileSync(paths[1],`PROCUREMENT_URL=http://127.0.0.1:47831\nPROCUREMENT_KEY=${ownerKey}\n`,{flag:'wx',mode:0o600});
  writeFileSync(paths[2],`PROCUREMENT_URL=http://127.0.0.1:47831\nPROCUREMENT_KEY=${botKey}\n`,{flag:'wx',mode:0o600});
  console.log(JSON.stringify({workspaceId,ownerId,botId,credentialFiles:paths,policy:'unconfigured; no spending authority'},null,2));
} finally { await pool.end(); }
