import {deriveEvents,eventText,haversineKm} from './logic.mjs';
import {notificationStatement} from './notifications.mjs';
const COLUMNS=['id','ts','received_at','time_quality','mode','soc','voltage_v','current_a','full','energy_in_kwh','energy_out_kwh','lat','lon','speed_kmh','odometer_km','boot_id','seq','uptime_ms','can_fresh','charger_state','charge_energy_kwh','historical'];
const INSERT=`INSERT INTO telemetry (${COLUMNS.join(',')}) VALUES (${COLUMNS.map(()=>'?').join(',')})`;
const STATE_COLUMNS=['last_event_id','last_can_ts','last_ts','last_received_at','time_quality','mode','soc','voltage_v','current_a','full','energy_in_kwh','energy_out_kwh','charge_energy_kwh','lat','lon','speed_kmh','odometer_km','last_gps_ts','active_charge_id','active_trip_id','stopped_since','boot_id','seq','can_fresh','charger_state','can_lost_reported'];
export async function storeSample(db,s,settings,now=new Date()) {
  const received=now.toISOString();
  for(let attempt=0;attempt<5;attempt++) {
    if(await db.prepare('SELECT id FROM telemetry WHERE id=?').bind(s.id).first()) return 'duplicate';
    const state=await db.prepare('SELECT * FROM vehicle_state WHERE id=1').first();
    if(!state) throw Error('Schema not initialized');
    const archived=s.historical || (state.last_ts && s.ts<state.last_ts) ||
      (state.boot_id && state.boot_id===s.boot_id && state.seq!==null && s.seq!==null && s.seq<=state.seq);
    const writes=[db.prepare('INSERT INTO ingest_guard (expected_revision) VALUES (?)').bind(state.revision),
      db.prepare(INSERT).bind(...COLUMNS.map(k=>k==='received_at'?received:typeof s[k]==='boolean'?Number(s[k]):s[k]??null))];
    if(!archived) {
      const next={...state,last_event_id:s.id,last_ts:s.ts,last_received_at:received,time_quality:s.time_quality,
        last_can_ts:s.can_fresh?s.ts:state.last_can_ts,mode:s.mode,soc:s.can_fresh?s.soc:state.soc,voltage_v:s.voltage_v,current_a:s.current_a,full:Number(s.full),
        energy_in_kwh:s.energy_in_kwh,energy_out_kwh:s.energy_out_kwh,charge_energy_kwh:s.charge_energy_kwh,
        boot_id:s.boot_id,seq:s.seq,can_fresh:Number(s.can_fresh),charger_state:s.charger_state,
        odometer_km:s.odometer_km??state.odometer_km};
      let session=state.active_charge_id?await db.prepare('SELECT * FROM charging_sessions WHERE id=?').bind(state.active_charge_id).first():null;
      const events=deriveEvents(state,s,settings.target_soc,session);
      if(events.includes('charge_started')) {
        next.active_charge_id=`charge-${s.id}`;
        session={id:next.active_charge_id,charged_kwh:0,energy_complete:1,target_notified:0};
        writes.push(db.prepare('INSERT INTO charging_sessions (id,started_at,start_soc,start_energy_in_kwh,charged_kwh,charge_type) VALUES (?,?,?,?,?,?)')
          .bind(session.id,s.ts,s.soc,s.charge_energy_kwh,0,'CAN'));
      } else if(session) {
        const sameBoot=state.boot_id!==null && state.boot_id===s.boot_id;
        const delta=(sameBoot && s.charge_energy_kwh!==null && state.charge_energy_kwh!==null)?s.charge_energy_kwh-state.charge_energy_kwh:null;
        const dt=state.last_ts?(Date.parse(s.ts)-Date.parse(state.last_ts))/3600000:0;
        const valid=delta!==null && delta>=0 && delta<=Math.max(0.05,dt*100);
        if(valid) writes.push(db.prepare('UPDATE charging_sessions SET charged_kwh=COALESCE(charged_kwh,0)+? WHERE id=?').bind(delta,session.id));
        else writes.push(db.prepare('UPDATE charging_sessions SET energy_complete=0 WHERE id=?').bind(session.id));
      }
      if(events.includes('target_reached') && session) writes.push(db.prepare('UPDATE charging_sessions SET target_notified=1 WHERE id=?').bind(session.id));
      const terminal=events.find(x=>['charge_completed','charge_finished','charge_stopped'].includes(x));
      if(terminal && session) {
        const reason={charge_completed:'full_bms',charge_finished:'charger_finished',charge_stopped:'stopped'}[terminal];
        writes.push(db.prepare('UPDATE charging_sessions SET ended_at=?,end_soc=?,end_reason=? WHERE id=? AND ended_at IS NULL').bind(s.ts,s.soc,reason,session.id));
        next.active_charge_id=null;
      }
      if(session && !s.can_fresh && !state.can_lost_reported) { events.push('can_lost');next.can_lost_reported=1; }
      if(s.can_fresh) next.can_lost_reported=0;
      for(const type of events) {
        const eventId=`${s.id}:${type}`,text=eventText(type,s,settings.target_soc);
        writes.push(db.prepare('INSERT OR IGNORE INTO events (event_id,event_type,ts,soc,details) VALUES (?,?,?,?,?)').bind(eventId,type,s.ts,s.soc,text));
        const age=+now-Date.parse(s.ts), important=['charge_completed','charge_finished','charge_stopped'].includes(type);
        if(age<=600000 || (important && age<=86400000)) {
          const message=age>600000?`${text}\nПодія під час відсутності інтернету: ${new Date(s.ts).toLocaleString('uk-UA',{timeZone:'Europe/Kyiv'})}.`:text;
          writes.push(notificationStatement(db,eventId,message,received));
        }
      }
      // A missing GPS fix leaves the last location timestamp intact. It never invents mileage.
      if(s.lat!==null && s.lon!==null && s.speed_kmh!==null) {
        const moving=s.speed_kmh>=5;
        if(moving && !next.active_trip_id) {
          next.active_trip_id=`trip-${s.id}`;
          writes.push(db.prepare('INSERT INTO gps_trips (id,started_at,max_speed_kmh) VALUES (?,?,?)').bind(next.active_trip_id,s.ts,s.speed_kmh));
        }
        if(moving) next.stopped_since=null;
        else if(next.active_trip_id && !next.stopped_since) next.stopped_since=s.ts;
        let distance=0;
        if(next.active_trip_id && state.last_gps_ts && state.lat!==null && state.lon!==null) {
          const dt=(Date.parse(s.ts)-Date.parse(state.last_gps_ts))/1000;
          const d=haversineKm(state.lat,state.lon,s.lat,s.lon);
          if(dt>0 && dt<=180 && d<=dt/3600*170+0.08 && d<8) distance=d;
        }
        if(next.active_trip_id) writes.push(db.prepare('UPDATE gps_trips SET distance_km=distance_km+?,max_speed_kmh=MAX(max_speed_kmh,?) WHERE id=?').bind(distance,s.speed_kmh,next.active_trip_id));
        if(next.active_trip_id && next.stopped_since && Date.parse(s.ts)-Date.parse(next.stopped_since)>=300000) {
          writes.push(db.prepare('UPDATE gps_trips SET ended_at=? WHERE id=?').bind(s.ts,next.active_trip_id));
          next.active_trip_id=null;next.stopped_since=null;
        }
        next.lat=s.lat;next.lon=s.lon;next.last_gps_ts=s.ts;next.speed_kmh=s.speed_kmh;
      } else next.speed_kmh=null;
      writes.push(db.prepare(`UPDATE vehicle_state SET ${STATE_COLUMNS.map(k=>k+'=?').join(',')},revision=revision+1 WHERE id=1`).bind(...STATE_COLUMNS.map(k=>next[k]??null)));
    } else writes.push(db.prepare('UPDATE vehicle_state SET revision=revision+1 WHERE id=1'));
    writes.push(db.prepare('DELETE FROM ingest_guard'));
    try {await db.batch(writes);return archived?'archived':'inserted';}
    catch(error) {
      if(!/LF_CONFLICT|UNIQUE constraint failed: telemetry/.test(String(error.message))) throw error;
    }
  }
  throw Error('Concurrent ingestion: retry');
}
