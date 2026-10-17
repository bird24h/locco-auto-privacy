export const DEMO_ADMIN='demo-owner-key-000000000000000000000';
export const DEMO_DEVICE='demo-device-key-00000000000000000000';
export function demoSamples(now=Date.now(),nonce='demo') {
 const samples=[];let charge=0;
 const start=now-8*60000;
 for(let i=0;i<9;i++){
  const active=i<8;charge+=active?0.095:0;
  samples.push({id:`leaf-001-${nonce}-${i}`,boot_id:nonce,seq:i+1,uptime_ms:i*60000,time_quality:'synced',ts:new Date(start+i*60000).toISOString(),
    soc:active?76+i*3:100,mode:active?'charging':'idle',charger_state:active?'charging':'finished',can_fresh:true,full:!active,
    voltage_v:370+i*2,current_a:active?-15.4:0,energy_in_kwh:charge,energy_out_kwh:0,charge_energy_kwh:charge,lat:null,lon:null,speed_kmh:null});
 }
 return samples;
}
