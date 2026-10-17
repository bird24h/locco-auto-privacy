// Browser-only demonstration. No network requests or vehicle commands.
export const DEMO_STEPS = [
  {title:'Очікування',soc:76,minute:0,hint:'Заряджання не почалося.'},
  {title:'Зарядка почалася',soc:76,minute:1,hint:'Зарядну сесію відкрито.'},
  {title:'Досягнуто 90%',soc:90,minute:31,hint:'Досягнуто цілі заряджання.'},
  {title:'Втрачено зв’язок',soc:90,minute:36,hint:'Останній заряд: 90%. Стан заряджання невідомий.'},
  {title:'Зв’язок відновлено',soc:96,minute:46,hint:'Заряджання триває.'},
  {title:'Повний заряд',soc:100,minute:61,hint:'BMS підтвердив 100%. Сесію завершено.'}
];

export function makeDemoSnapshot(index=0,now=Date.now()) {
  const step=Math.max(0,Math.min(DEMO_STEPS.length-1,Math.trunc(index)||0));
  const current=DEMO_STEPS[step],offline=step===3,finished=step===5;
  const start=now-DEMO_STEPS.at(-1).minute*60000,ts=minute=>new Date(start+minute*60000).toISOString();
  const measured=offline?DEMO_STEPS[2]:current;
  const active=step>0&&!finished;
  const samples=DEMO_STEPS.slice(0,step+1).filter((_,i)=>i!==3).map(s=>({
    ts:ts(s.minute),soc:s.soc,can_fresh:1,time_quality:'synced'
  })).reverse();
  const event=(id,event_type,minute,details)=>({id,event_type,ts:ts(minute),details});
  const events=[];
  if(step>=1)events.push(event('demo-start','charge_started',1,'Заряджання почалося · 76%'));
  if(step>=2)events.push(event('demo-target','target_reached',31,'Досягнуто цілі · 90%'));
  if(step>=3)events.push(event('demo-offline','connection_lost',36,'Зв’язок втрачено'));
  if(step>=4)events.push(event('demo-restored','connection_restored',46,'Зв’язок відновлено · 96%'));
  if(finished)events.push(event('demo-full','charge_completed',61,'Повний заряд BMS · 100%'));
  const energy=step===0?0:Math.max(0,(measured.soc-76)*0.22);
  return {
    summary:{version:'1.0.6',online:!offline,measurement_fresh:!offline,
      state:{soc:measured.soc,voltage_v:finished?394:371.2,current_a:active?-17.6:0,
        mode:active?'charging':'idle',full:finished?1:0,can_fresh:offline?0:1,
        charger_state:finished?'finished':active?'charging':'idle',time_quality:'synced',
        last_ts:ts(measured.minute),last_can_ts:ts(measured.minute),energy_in_kwh:energy,
        energy_out_kwh:0,lat:null,lon:null},
      device:{last_received_at:ts(measured.minute),firmware_version:'демонстрація',queue_bytes:offline?2048:0,
        dropped_samples:0,rejected_samples:0,rssi:offline?null:-53,can_rx_missed:0},
      settings:{target_soc:90,electricity_price:null},metrics:{total_charges:step>0?1:0,gps_km:null,total_trips:0},
      notifications:{configured:false,pending:0,sent:0,expired:0}},
    telemetry:samples,
    charges:step===0?[]:[{id:'demo-charge',started_at:ts(1),ended_at:finished?ts(61):null,
      start_soc:76,end_soc:finished?100:null,charged_kwh:energy,end_reason:finished?'full_bms':null,energy_complete:1}],
    events:events.reverse(),trips:[]
  };
}
