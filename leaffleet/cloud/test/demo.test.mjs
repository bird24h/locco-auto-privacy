import test from 'node:test';
import assert from 'node:assert/strict';
import {DEMO_STEPS,makeDemoSnapshot} from '../../public/demo-scenario.mjs';

test('offline demo retains last SOC and never confirms completion',()=>{
 const d=makeDemoSnapshot(3);
 assert.equal(d.summary.state.soc,90);
 assert.equal(d.summary.online,false);
 assert.equal(d.summary.measurement_fresh,false);
 assert.equal(d.charges.length,1);
 assert.equal(d.charges[0].ended_at,null);
 assert.equal(d.charges[0].end_reason,null);
 assert.ok(!d.events.some(e=>e.event_type==='charge_completed'));
});
test('demo completes one charge with one target and one full event',()=>{
 const d=makeDemoSnapshot(DEMO_STEPS.length-1);
 assert.equal(d.charges.length,1);
 assert.equal(d.charges[0].end_soc,100);
 assert.equal(d.charges[0].end_reason,'full_bms');
 assert.ok(d.charges[0].ended_at>d.charges[0].started_at);
 assert.equal(d.events.filter(e=>e.event_type==='target_reached').length,1);
 assert.equal(d.events.filter(e=>e.event_type==='charge_completed').length,1);
 assert.equal(new Set(d.events.map(e=>e.id)).size,d.events.length);
});
test('every demo step keeps Telegram and GPS unconnected',()=>{
 for(let i=0;i<DEMO_STEPS.length;i++){
  const d=makeDemoSnapshot(i);
  assert.equal(d.summary.notifications.configured,false);
  assert.equal(d.summary.notifications.sent,0);
  assert.equal(d.summary.state.lat,null);
  assert.equal(d.summary.state.lon,null);
  assert.equal(d.summary.metrics.gps_km,null);
  assert.equal(d.trips.length,0);
 }
});
