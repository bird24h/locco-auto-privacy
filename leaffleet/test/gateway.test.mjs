import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {FRESH_SCHEMA} from '../cloud/src/fresh-schema.mjs';
import worker from '../server/worker.mjs';
import {TOKEN,OWNER,signedData} from './fixtures/telegram.mjs';
import {SQLiteD1} from '../scripts/sqlite-d1.mjs';
import {demoSamples,DEMO_ADMIN,DEMO_DEVICE} from '../scripts/demo-data.mjs';
import {gateway,TABLES,initializeDatabase} from '../server/gateway.mjs';
const schema=FRESH_SCHEMA.map(sql=>sql.replace(/;\s*$/,'')+';').join('\n');
function setup(t){const DB=new SQLiteD1();DB.sqlite.exec(schema);t.after(()=>DB.close());return {DB,ADMIN_KEY:DEMO_ADMIN,DEVICE_KEY:DEMO_DEVICE,TELEGRAM_BOT_TOKEN:TOKEN,OWNER_TELEGRAM_ID:OWNER};}
async function call(env,path,{method='GET',body,key=DEMO_ADMIN,owner=false,origin,site}={}){
 const pending=[],headers={'Content-Type':'application/json'};
 if(key)headers[path.endsWith('/ingest')?'x-device-key':'x-admin-key']=key;
 if(owner)headers['x-telegram-init-data']=signedData();
 if(origin)headers.origin=origin;if(site)headers['sec-fetch-site']=site;
 const request=new Request('https://leaf.test'+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})});
 const response=await worker.fetch(request,{...env,ASSETS:{fetch:async()=>new Response('<html>LeafFleet</html>',{headers:{'Content-Type':'text/html; charset=utf-8'}})}},{waitUntil:p=>pending.push(p)});
 await Promise.allSettled(pending);return response;
}
const count=(env,table)=>env.DB.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
const payload=()=>({device_id:'leaf-001',samples:demoSamples(Date.now()-500,'m2gateway'),diagnostics:{firmware_version:'M2 probe',queue_bytes:0}});

test('verified Telegram owner identity opens API without putting a key in the browser',async t=>{const env=setup(t);assert.equal((await (await call(env,'/api/access',{key:null,owner:true})).json()).owner,true);const response=await call(env,'/api/summary',{key:null,owner:true});assert.equal(response.status,200);assert.equal(response.headers.get('x-leaffleet-data-scope'),'vehicle');assert.equal((await response.json()).state.soc,null);});
test('service requests keep device and owner permissions separate',async t=>{const env=setup(t);assert.equal((await (await call(env,'/api/access',{key:null})).json()).owner,false);assert.equal((await call(env,'/api/summary',{key:DEMO_DEVICE})).status,401);assert.equal((await call(env,'/api/ingest',{method:'POST',body:payload(),key:DEMO_ADMIN})).status,401);assert.equal((await call(env,'/api/summary',{key:null})).status,401);});
test('probe pipeline writes real SQL while leaving vehicle history empty',async t=>{const env=setup(t),body=payload();const first=await call(env,'/api/probe/ingest',{method:'POST',body,key:DEMO_DEVICE});assert.equal(first.status,200);assert.equal(first.headers.get('x-leaffleet-data-scope'),'probe');assert.equal((await first.json()).inserted,9);const duplicate=await call(env,'/api/probe/ingest',{method:'POST',body,key:DEMO_DEVICE});assert.equal((await duplicate.json()).duplicates,9);assert.equal(count(env,'probe_telemetry'),9);assert.equal(count(env,'telemetry'),0);assert.equal(count(env,'charging_sessions'),0);assert.equal(count(env,'probe_charging_sessions'),1);const summary=await (await call(env,'/api/probe/summary')).json();assert.equal(summary.state.soc,100);assert.equal(summary.notifications.configured,false);assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM probe_events WHERE event_type='target_reached'").get().n,1);assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM probe_events WHERE event_type='charge_completed'").get().n,1);});
test('probe reset requires owner access and never clears vehicle data',async t=>{const env=setup(t),body=payload();await call(env,'/api/ingest',{method:'POST',body,key:DEMO_DEVICE});await call(env,'/api/probe/ingest',{method:'POST',body,key:DEMO_DEVICE});assert.equal((await call(env,'/api/probe/reset',{method:'POST',key:DEMO_DEVICE})).status,401);assert.equal((await call(env,'/api/probe/reset',{method:'POST'})).status,200);assert.equal(count(env,'probe_telemetry'),0);assert.equal(count(env,'telemetry'),9);assert.equal((await (await call(env,'/api/probe/health')).json()).schema_version,2);});
test('Telegram owner writes reject cross-origin requests',async t=>{const env=setup(t);assert.equal((await call(env,'/api/settings',{method:'PUT',owner:true,key:null,origin:'https://other.test',body:{target_soc:85}})).status,403);assert.equal((await call(env,'/api/probe/reset',{method:'POST',owner:true,key:null,site:'cross-site'})).status,403);const allowed=await call(env,'/api/settings',{method:'PUT',owner:true,key:null,origin:'https://leaf.test',body:{target_soc:85,electricity_price:null}});assert.equal(allowed.status,200);});
test('generated schema retains both revision guards',async t=>{const env=setup(t);await call(env,'/api/health');for(const prefix of ['', 'probe_']){assert.throws(()=>env.DB.sqlite.prepare(`INSERT INTO ${prefix}ingest_guard(expected_revision) VALUES(999)`).run(),/LF_CONFLICT/);for(const table of TABLES)assert.ok(env.DB.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(prefix+table));}});
test('missing database fails without leaking internals',async()=>{const response=await call({ADMIN_KEY:DEMO_ADMIN,DEVICE_KEY:DEMO_DEVICE},'/api/summary');assert.equal(response.status,503);assert.deepEqual(await response.json(),{ok:false,error:'Database unavailable'});});
test('document is served unchanged with the correct content type',async t=>{const env=setup(t),response=await call(env,'/');assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'text/html; charset=utf-8');assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'self' https:\/\/web.telegram.org/);assert.equal(await response.text(),'<html>LeafFleet</html>');assert.equal((await call(env,'/',{method:'POST'})).status,405);});
test('Telegram SDK and web client are allowed while Telegram launch data grants no access',async t=>{
 const env=setup(t),document=await call(env,'/'),csp=document.headers.get('content-security-policy');
 assert.match(csp,/script-src 'self' https:\/\/telegram.org;/);assert.match(csp,/frame-ancestors[^;]*https:\/\/web.telegram.org;/);assert.ok(!csp.includes('chatgpt.com'));
 const headers={'x-telegram-init-data':'user=%7B%22id%22%3A123%7D','x-telegram-user-id':'123'};
 const request=new Request('https://leaf.test/api/summary?tgWebAppData=user%3D123',{headers});
 assert.equal((await gateway(request,env,{waitUntil(){}})).status,401);
});

test('first boot creates empty D1 atomically and survives concurrent health requests',async t=>{
 const DB=new SQLiteD1();t.after(()=>DB.close());
 const env={DB,ADMIN_KEY:DEMO_ADMIN,DEVICE_KEY:DEMO_DEVICE};
 const responses=await Promise.all(Array.from({length:4},()=>call(env,'/api/health',{key:null})));
 assert.ok(responses.every(r=>r.status===200));
 for(const prefix of ['', 'probe_']){
  for(const table of TABLES)assert.ok(DB.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(prefix+table));
  assert.equal(DB.sqlite.prepare(`SELECT version FROM ${prefix}schema_meta`).get().version,2);
  assert.equal(count(env,prefix+'telemetry'),0);
  assert.throws(()=>DB.sqlite.prepare(`INSERT INTO ${prefix}ingest_guard(expected_revision) VALUES(999)`).run(),/LF_CONFLICT/);
 }
});

test('legacy database without a version is preserved and requires migration',async t=>{
 const DB=new SQLiteD1();t.after(()=>DB.close());DB.sqlite.exec('CREATE TABLE telemetry(id TEXT); INSERT INTO telemetry VALUES(\'legacy\');');
 await assert.rejects(initializeDatabase(DB),/migration/);
 assert.equal(DB.sqlite.prepare('SELECT id FROM telemetry').get().id,'legacy');
 assert.equal(DB.sqlite.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='schema_meta'").get().n,0);
});

test('public Worker ignores forged hosted identity and query parameters',async t=>{
 const env=setup(t);
 const forged=new Request('https://leaf.test/api/summary?owner=1&tgWebAppData=user%3D123',{headers:{'oai-authenticated-user-id':'forged-owner','x-telegram-user-id':OWNER}});
 assert.equal((await gateway(forged,env,{waitUntil(){}})).status,401);
 const wrongUser=new Request('https://leaf.test/api/summary',{headers:{'x-telegram-init-data':signedData({id:987654321})}});
 assert.equal((await gateway(wrongUser,env,{waitUntil(){}})).status,401);
});
