export const VERSION = '1.1.0';
export const MODES = new Set(['charging', 'discharging', 'idle', 'unknown']);
export const CHARGER_STATES = new Set(['charging', 'finished', 'interrupted', 'timer_wait', 'idle', 'v2x', 'unknown']);
function number(v, min, max, name) {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw Error(`Invalid ${name}`);
  return v;
}
export function normalizeSample(input, now = new Date(), clock = null) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Invalid sample');
  const id = input.id;
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{8,90}$/.test(id)) throw Error('Invalid sample id');
  const boot = input.boot_id ?? null;
  if (boot !== null && (typeof boot !== 'string' || !/^[A-Za-z0-9_-]{4,40}$/.test(boot))) throw Error('Invalid boot_id');
  const seq = number(input.seq, 0, 4294967295, 'seq');
  const uptime = number(input.uptime_ms, 0, 4294967295, 'uptime_ms');
  if (seq !== null && !Number.isInteger(seq)) throw Error('Invalid seq');
  let quality = 'received', ts = now.toISOString(), historical = true;
  if (input.time_quality === 'synced' && typeof input.ts === 'string') {
    const t = Date.parse(input.ts);
    if (!Number.isFinite(t) || t > +now + 300000 || t < +now - 365 * 86400000) throw Error('Invalid timestamp');
    ts = new Date(t).toISOString(); quality = 'synced'; historical = false;
  } else if (clock && boot !== null && clock.boot_id === boot && uptime !== null) {
    const anchor = Date.parse(clock.ts);
    const delta = clock.uptime_ms - uptime;
    // A rollover or a clock from another boot must never reconstruct a plausible but wrong time.
    if (Number.isFinite(anchor) && anchor <= +now + 300000 && anchor >= +now - 300000 &&
        Number.isFinite(delta) && delta >= 0 && delta < 7 * 86400000) {
      ts = new Date(anchor - delta).toISOString(); quality = 'reconstructed'; historical = false;
    }
  }
  const charger = CHARGER_STATES.has(input.charger_state) ? input.charger_state : 'unknown';
  const canFresh = input.can_fresh === true;
  let mode = MODES.has(input.mode) ? input.mode : 'unknown';
  if (!canFresh || (mode === 'charging' && charger !== 'charging')) mode = 'unknown';
  const s = {id, ts, time_quality: quality, historical, boot_id: boot, seq, uptime_ms: uptime,
    mode, charger_state: charger, can_fresh: canFresh, full: canFresh && input.full === true,
    soc: number(input.soc, 0, 100, 'soc'), voltage_v: number(input.voltage_v, 0, 500, 'voltage_v'),
    current_a: number(input.current_a, -500, 500, 'current_a'),
    energy_in_kwh: number(input.energy_in_kwh, 0, 1000000, 'energy_in_kwh'),
    energy_out_kwh: number(input.energy_out_kwh, 0, 1000000, 'energy_out_kwh'),
    charge_energy_kwh: number(input.charge_energy_kwh, 0, 1000000, 'charge_energy_kwh'),
    lat: number(input.lat, -90, 90, 'lat'), lon: number(input.lon, -180, 180, 'lon'),
    speed_kmh: number(input.speed_kmh, 0, 220, 'speed_kmh'), odometer_km: number(input.odometer_km, 0, 2000000, 'odometer_km')};
  if ((s.lat === null) !== (s.lon === null)) throw Error('GPS requires lat and lon');
  return s;
}
export function terminalKind(s) {
  if (!s.can_fresh || s.mode === 'unknown' || s.mode === 'charging') return null;
  if (s.full && ['finished', 'idle'].includes(s.charger_state)) return 'charge_completed';
  if (s.charger_state === 'finished') return 'charge_finished';
  if (['interrupted', 'idle', 'timer_wait', 'v2x'].includes(s.charger_state)) return 'charge_stopped';
  return null;
}
export function deriveEvents(prev, next, target = 90, session = null) {
  const active = Boolean(session || prev?.active_charge_id || prev?.mode === 'charging');
  const events = [];
  if (next.mode === 'charging' && next.charger_state === 'charging' && next.can_fresh && !active) events.push('charge_started');
  if ((active || events.includes('charge_started')) && next.can_fresh && next.mode === 'charging' &&
      next.soc !== null && next.soc >= target && !(session?.target_notified || prev?.target_notified)) events.push('target_reached');
  const terminal = terminalKind(next);
  if (active && terminal) events.push(terminal);
  return events;
}
export function eventText(type, s, target = 90) {
  const soc = s.soc === null ? '—' : `${Math.round(s.soc)}%`;
  const texts = {
    charge_started: `🔌 Nissan Leaf: зарядка почалася. SOC: ${soc}.`,
    target_reached: `⚡ Nissan Leaf досяг цілі ${target}%. SOC: ${soc}.`,
    charge_completed: `🔋 Nissan Leaf: BMS підтверджує повний заряд. SOC: ${soc}.`,
    charge_finished: `✅ Nissan Leaf: зарядний пристрій завершив цикл. SOC: ${soc}.`,
    charge_stopped: `⚠️ Nissan Leaf: зарядку зупинено. SOC: ${soc}.`,
    connection_lost: `📡 LeafFleet: зв'язок з пристроєм відсутній понад 20 хвилин. Останній SOC: ${soc}.`,
    connection_restored: `📶 LeafFleet: зв'язок з пристроєм відновлено.`,
    can_lost: `⚠️ LeafFleet: під час зарядки перестали надходити CAN-дані. Останній SOC: ${soc}. Стан зарядки невідомий.`,
    test: '✅ LeafFleet: тест сповіщень. Telegram підключено.'
  };
  return texts[type] || `LeafFleet: ${type}`;
}
export function haversineKm(a,b,c,d) {
  const r = Math.PI/180, x=(c-a)*r, y=(d-b)*r;
  const h = Math.min(1,Math.max(0,Math.sin(x/2)**2 + Math.cos(a*r)*Math.cos(c*r)*Math.sin(y/2)**2));
  return 6371*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
}
export function csvField(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (/^[\s]*[=+@\-]/.test(s) || /^[\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s;
}
export function freshness(state, device, now = Date.now()) {
  const online = Boolean(device?.last_received_at && now - Date.parse(device.last_received_at) < 300000);
  const fresh = Boolean(state?.can_fresh && (state.last_can_ts||state.last_ts) && state.time_quality !== 'received' && now - Date.parse(state.last_can_ts||state.last_ts) < 300000);
  return {online, measurement_fresh: online && fresh};
}
