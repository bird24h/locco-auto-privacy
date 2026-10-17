import {api,auth} from '../cloud/src/index.mjs';
import {FRESH_SCHEMA} from '../cloud/src/fresh-schema.mjs';
import {telegramOwner} from './telegram-auth.mjs';

export const TABLES=['telemetry','events','charging_sessions','gps_trips','vehicle_state','settings','schema_meta','ingest_guard','notification_outbox','device_status'];
const tableNames=new RegExp('\\b('+TABLES.join('|')+')\\b','g');
const initialized=new WeakMap();
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});

export function probeDatabase(db){return {prepare(sql){return db.prepare(sql.replace(tableNames,name=>'probe_'+name))},batch(statements){return db.batch(statements)}};}
function defaults(db,prefix){return ['vehicle_state','settings','device_status'].map(name=>db.prepare(`INSERT OR IGNORE INTO ${prefix}${name}(id) VALUES(1)`)).concat(db.prepare(`INSERT OR IGNORE INTO ${prefix}schema_meta(id,version) VALUES(1,2)`));}
export async function initializeDatabase(db){
 if(!db)throw Error('Missing database');
 if(!initialized.has(db)){
  const work=(async()=>{
   let meta;
   try{meta=await db.prepare('SELECT version FROM schema_meta WHERE id=1').first()}catch{}
   if(meta){if(meta.version!==2)throw Error('Unsupported schema');return;}
   const legacy=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='telemetry'").first();
   if(legacy)throw Error('Apply the existing database migration first');
   await db.batch(FRESH_SCHEMA.map(sql=>db.prepare(sql)));
  })().catch(error=>{initialized.delete(db);throw error});
  initialized.set(db,work);
 }
 await initialized.get(db);
}

export async function gateway(request,env,ctx){
 const url=new URL(request.url);
 const owner=await telegramOwner(request,env);
 if(url.pathname==='/api/access'){
  return request.method==='GET'?json({ok:true,owner,method:'telegram',configured:Boolean(env.TELEGRAM_BOT_TOKEN&&env.OWNER_TELEGRAM_ID)}):json({ok:false,error:'Method not allowed'},405);
 }
 if(owner&&!['GET','HEAD'].includes(request.method)){
  const origin=request.headers.get('origin');
  if((origin&&origin!==url.origin)||request.headers.get('sec-fetch-site')==='cross-site')return json({ok:false,error:'Cross-origin request denied'},403);
 }
 const headers=new Headers(request.headers);
 headers.delete('oai-authenticated-user-id');
 if(owner&&typeof env.ADMIN_KEY==='string')headers.set('x-admin-key',env.ADMIN_KEY);
 const authenticated=new Request(request,{headers});
 try{
  // Reject anonymous private data requests before touching D1.
  const deviceRoute=url.pathname==='/api/ingest'||url.pathname==='/api/probe/ingest';
  const health=url.pathname==='/api/health'||url.pathname==='/api/probe/health';
  if(!health&&!auth(authenticated,env.ADMIN_KEY,'x-admin-key')&&!(deviceRoute&&auth(authenticated,env.DEVICE_KEY,'x-device-key')))return json({ok:false,error:'Owner access denied'},401);
  await initializeDatabase(env.DB);
  const probe=url.pathname.startsWith('/api/probe/');
  if(probe&&url.pathname==='/api/probe/reset'){
   if(request.method!=='POST')return json({ok:false,error:'Method not allowed'},405);
   if(!auth(authenticated,env.ADMIN_KEY,'x-admin-key'))return json({ok:false,error:'Owner access denied'},401);
   await env.DB.batch([...TABLES.map(name=>env.DB.prepare(`DELETE FROM probe_${name}`)),...defaults(env.DB,'probe_')]);
   return json({ok:true,scope:'probe',reset:true});
  }
  const scopedEnv=probe?{...env,DB:probeDatabase(env.DB),TELEGRAM_BOT_TOKEN:undefined,TELEGRAM_CHAT_ID:undefined}:env;
  let target=authenticated;
  if(probe){const next=new URL(url);next.pathname=next.pathname.replace(/^\/api\/probe(?=\/)/,'/api');target=new Request(next,authenticated);}
  const response=await api(target,scopedEnv,ctx),outHeaders=new Headers(response.headers);
  outHeaders.set('X-LeafFleet-Data-Scope',probe?'probe':'vehicle');
  return new Response(response.body,{status:response.status,headers:outHeaders});
 }catch{return json({ok:false,error:'Database unavailable'},503)}
}
