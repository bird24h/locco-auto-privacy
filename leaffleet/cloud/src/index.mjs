import {VERSION,normalizeSample,freshness,csvField,eventText} from './logic.mjs';
import {storeSample} from './store.mjs';
import {deliverNotifications,notificationStatement} from './notifications.mjs';
const SECURITY={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY',
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"};
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{...SECURITY,'Content-Type':'application/json; charset=utf-8'}})}
function fail(status,error){return json({ok:false,error},status)}
export function auth(req,secret,header) {
  if(typeof secret!=='string' || secret.length<32) return false;
  const value=req.headers.get(header)||'';let diff=value.length^secret.length;
  for(let i=0;i<secret.length;i++) diff|=secret.charCodeAt(i)^(value.charCodeAt(i)||0);
  return diff===0;
}
async function body(req) {
  const reader=req.body?.getReader();if(!reader) throw Error('Bad JSON');
  const parts=[];let bytes=0;
  for(;;){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>45000){await reader.cancel();throw Error('Payload too large')}parts.push(value)}
  const buffer=new Uint8Array(bytes);let offset=0;for(const p of parts){buffer.set(p,offset);offset+=p.length}
  try{return JSON.parse(new TextDecoder().decode(buffer))}catch{throw Error('Bad JSON')}
}
function background(ctx, promise) {if(ctx?.waitUntil)ctx.waitUntil(promise.catch(()=>{}));else return promise.catch(()=>{})}
const LISTS={
 '/api/telemetry':'SELECT * FROM telemetry ORDER BY ts DESC, rowid DESC LIMIT ?',
 '/api/events':'SELECT * FROM events ORDER BY ts DESC, id DESC LIMIT ?',
 '/api/charges':'SELECT * FROM charging_sessions ORDER BY started_at DESC LIMIT ?',
 '/api/trips':'SELECT * FROM gps_trips ORDER BY started_at DESC LIMIT ?'
};
export async function api(request,env,ctx) {
 const url=new URL(request.url),path=url.pathname,db=env.DB;
 if(!db) return fail(503,'Database binding missing');
 let schema;try{schema=await db.prepare('SELECT version FROM schema_meta WHERE id=1').first()}catch{return fail(503,'Apply LeafFleet database schema / upgrade')}
 if(schema?.version!==2) return fail(503,'Unsupported database schema');
 if(path==='/api/health')return request.method==='GET'?json({ok:true,version:VERSION,schema_version:2}):fail(405,'Method not allowed');
 if(typeof env.DEVICE_KEY!=='string'||typeof env.ADMIN_KEY!=='string'||env.DEVICE_KEY.length<32||env.ADMIN_KEY.length<32||env.DEVICE_KEY===env.ADMIN_KEY||env.DEVICE_KEY.startsWith('CHANGE_ME')||env.ADMIN_KEY.startsWith('CHANGE_ME'))return fail(503,'Configure two different secrets of at least 32 characters');
 if(path==='/api/ingest') {
  if(request.method!=='POST')return fail(405,'Method not allowed');
  if(!auth(request,env.DEVICE_KEY,'x-device-key'))return fail(401,'Device access denied');
  let payload;try{payload=await body(request)}catch(e){return fail(e.message==='Payload too large'?413:400,e.message)}
  if(!payload||payload.device_id!=='leaf-001'||!Array.isArray(payload.samples)||payload.samples.length<1||payload.samples.length>40)return fail(400,'Expected leaf-001 with 1..40 samples');
  const now=new Date();let samples;
  try {samples=payload.samples.map(s=>normalizeSample(s,now,payload.clock));}catch(e){return fail(400,e.message)}
  const settings=await db.prepare('SELECT * FROM settings WHERE id=1').first();if(!settings)return fail(503,'Settings missing');
  const counters={inserted:0,duplicates:0,archived:0};
  try {
   for(const sample of samples){const status=await storeSample(db,sample,settings,now);counters[{duplicate:'duplicates',inserted:'inserted',archived:'archived'}[status]]++}
   const diag=payload.diagnostics||{};
   const n=(key,min,max)=>typeof diag[key]==='number'&&Number.isFinite(diag[key])?Math.min(max,Math.max(min,Math.trunc(diag[key]))):null;
   const previous=await db.prepare('SELECT * FROM device_status WHERE id=1').first();
   const restoredId='restored:'+(previous?.last_received_at||'initial'),restoredText=eventText('connection_restored',samples.at(-1));
   const writes=[
    db.prepare("INSERT OR IGNORE INTO events(event_id,event_type,ts,details) SELECT ?,?,?,? FROM device_status WHERE id=1 AND offline_reported=1 AND last_received_at=?")
      .bind(restoredId,'connection_restored',now.toISOString(),restoredText,previous?.last_received_at??null),
    db.prepare("INSERT OR IGNORE INTO notification_outbox(event_id,message,created_at,next_attempt_at) SELECT ?,?,?,? FROM device_status WHERE id=1 AND offline_reported=1 AND last_received_at=?")
      .bind(restoredId,restoredText,now.toISOString(),+now,previous?.last_received_at??null),
    db.prepare('UPDATE device_status SET last_received_at=?,firmware_version=?,boot_id=?,queue_bytes=?,dropped_samples=?,rejected_samples=?,rssi=?,can_rx_missed=?,offline_reported=0 WHERE id=1')
      .bind(now.toISOString(),typeof diag.firmware_version==='string'?diag.firmware_version.slice(0,24):null,samples.at(-1).boot_id,n('queue_bytes',0,5000000),n('dropped_samples',0,2147483647)??0,n('rejected_samples',0,2147483647)??0,n('rssi',-150,0),n('can_rx_missed',0,2147483647)??0)];
   await db.batch(writes);
  }catch{return fail(503,'Database write failed. Retry the same sample IDs')}
  background(ctx,deliverNotifications(env));
  return json({ok:true,...counters,accepted_ids:samples.map(s=>s.id)});
 }
 if(!auth(request,env.ADMIN_KEY,'x-admin-key'))return fail(401,'Owner access denied');
 if(path==='/api/summary'&&request.method==='GET') {
  const [state,settings,device,metrics,trips,notifications]=await Promise.all([
   db.prepare('SELECT * FROM vehicle_state WHERE id=1').first(),db.prepare('SELECT * FROM settings WHERE id=1').first(),db.prepare('SELECT * FROM device_status WHERE id=1').first(),
   db.prepare('SELECT ROUND(SUM(charged_kwh),2) charged_kwh,COUNT(*) total_charges FROM charging_sessions').first(),
   db.prepare('SELECT ROUND(SUM(distance_km),2) gps_km,COUNT(*) total_trips FROM gps_trips').first(),
   db.prepare("SELECT SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) pending,SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END) sent,SUM(CASE WHEN status='expired' THEN 1 ELSE 0 END) expired,MAX(sent_at) last_sent_at FROM notification_outbox").first()]);
  return json({ok:true,version:VERSION,device_id:'leaf-001',state,settings,device,metrics:{...metrics,...trips},...freshness(state,device),
    notifications:{...notifications,configured:Boolean(env.TELEGRAM_BOT_TOKEN&&env.TELEGRAM_CHAT_ID)}});
 }
 if(path in LISTS&&request.method==='GET') {
  const limit=Math.max(1,Math.min(500,parseInt(url.searchParams.get('limit')||'150',10)||150));
  return json({ok:true,items:(await db.prepare(LISTS[path]).bind(limit).all()).results});
 }
 if(path==='/api/settings'&&request.method==='PUT') {
  let v;try{v=await body(request)}catch(e){return fail(400,e.message)}
  if(!v || typeof v!=='object')return fail(400,'Invalid settings');
  const target=v.target_soc,price=v.electricity_price;
  if(!Number.isInteger(target)||target<50||target>100 || !(price===null || typeof price==='number'&&Number.isFinite(price)&&price>=0&&price<=1000))return fail(400,'Invalid target or price');
  await db.prepare('UPDATE settings SET target_soc=?,electricity_price=? WHERE id=1').bind(target,price).run();
  return json({ok:true});
 }
 if(path==='/api/notifications/test'&&request.method==='POST') {
  if(!env.TELEGRAM_BOT_TOKEN||!env.TELEGRAM_CHAT_ID)return fail(409,'Telegram secrets are missing');
  const id='test:'+Math.floor(Date.now()/60000),text=eventText('test',{});
  await notificationStatement(db,id,text,new Date().toISOString()).run();
  background(ctx,deliverNotifications(env));return json({ok:true,queued:true});
 }
 if(path==='/api/export.csv'&&request.method==='GET') {
  const kind=url.searchParams.get('kind')||'telemetry';
  if(!['telemetry','events','charging_sessions','gps_trips'].includes(kind))return fail(400,'Invalid export kind');
  const time=['telemetry','events'].includes(kind)?'ts':'started_at';
  const rows=(await db.prepare(`SELECT * FROM ${kind} ORDER BY ${time} DESC LIMIT 5000`).all()).results;
  const columns=rows.length?Object.keys(rows[0]):['id'];
  const csv='\ufeff'+columns.join(',')+'\r\n'+rows.map(row=>columns.map(k=>csvField(row[k])).join(',')).join('\r\n');
  return new Response(csv,{headers:{...SECURITY,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="leaffleet-${kind}.csv"`,'X-Export-Limit':'5000'}});
 }
 if(path in LISTS || ['/api/settings','/api/summary','/api/notifications/test','/api/export.csv'].includes(path))return fail(405,'Method not allowed');
 return fail(404,'Not found');
}
export async function maintenance(env,now=new Date()) {
 const db=env.DB;if(!db)return;
 const device=await db.prepare('SELECT * FROM device_status WHERE id=1').first();
 if(device?.last_received_at && +now-Date.parse(device.last_received_at)>1200000 && !device.offline_reported) {
  const state=await db.prepare('SELECT soc FROM vehicle_state WHERE id=1').first();
  const id='offline:'+device.last_received_at,text=eventText('connection_lost',state||{});
  // Re-check the observed receipt inside the transaction so a simultaneous ingest prevents a false alarm.
  const staleReceipt=device.last_received_at;
  await db.batch([
   db.prepare("INSERT OR IGNORE INTO events(event_id,event_type,ts,soc,details) SELECT ?,?,?,?,? FROM device_status WHERE id=1 AND last_received_at=? AND offline_reported=0")
     .bind(id,'connection_lost',now.toISOString(),state?.soc??null,text,staleReceipt),
   db.prepare("INSERT OR IGNORE INTO notification_outbox(event_id,message,created_at,next_attempt_at) SELECT ?,?,?,? FROM device_status WHERE id=1 AND last_received_at=? AND offline_reported=0")
     .bind(id,text,now.toISOString(),+now,staleReceipt),
   db.prepare('UPDATE device_status SET offline_reported=1 WHERE id=1 AND last_received_at=?').bind(staleReceipt)]);
 }
 const cutoff=new Date(+now-90*86400000).toISOString();
 await db.prepare('DELETE FROM telemetry WHERE id IN (SELECT id FROM telemetry WHERE ts<? LIMIT 25)').bind(cutoff).run();
 await db.prepare("DELETE FROM notification_outbox WHERE event_id IN (SELECT event_id FROM notification_outbox WHERE status IN ('sent','expired') AND created_at<? LIMIT 500)").bind(cutoff).run();
 return deliverNotifications(env,+now);
}
export default {
 async fetch(request,env,ctx) {
  try {
   if(new URL(request.url).pathname.startsWith('/api/'))return await api(request,env,ctx);
   const asset=await env.ASSETS.fetch(request),headers=new Headers(asset.headers);
   for(const [k,v] of Object.entries(SECURITY))headers.set(k,v);
   return new Response(asset.body,{status:asset.status,headers});
  }catch{return fail(500,'Internal server error')}
 },
 async scheduled(_event,env,ctx){return background(ctx,maintenance(env))}
};
