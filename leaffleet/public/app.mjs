import {DEMO_STEPS,makeDemoSnapshot} from './demo-scenario.mjs';
import {createTelegramBridge,telegramAuthHeaders} from './telegram.mjs?v=20261016-cf';
const $=id=>document.getElementById(id);
const storage={get(k){try{return sessionStorage.getItem(k)}catch{return null}},set(k,v){try{sessionStorage.setItem(k,v)}catch{}},remove(k){try{sessionStorage.removeItem(k)}catch{}}};
const EMPTY={summary:{},telemetry:[],charges:[],events:[],trips:[]};
let localDemo=false,ownerIdentity=false,ownerAccess=false;
let data=EMPTY,view='locked',requestSerial=0,controller=null,busy=false,dirty=false,toastTimer;
let demoStep=0,demoTimer=null,demoEpoch=Date.now();
const telegram=createTelegramBridge({
 onBack(){if($('demoSheet').open)closeSheet();else tab('overview')},
 onSettings(){tab('settings')},
 onResume(){if(view==='live'&&!busy&&!document.hidden)load()},
 onPause(){if(demoTimer){stopDemo();draw()}},
});
const names={charging:'Заряджається',discharging:'Розряд батареї',idle:'Очікування',unknown:'Стан невідомий'};
const chargerNames={charging:'Зарядка',finished:'Цикл завершено',interrupted:'Перервано',timer_wait:'Очікування таймера',idle:'Очікування',v2x:'Віддача енергії',unknown:'Невідомо'};
function toast(text){clearTimeout(toastTimer);$('toast').textContent=text;$('toast').style.display='block';toastTimer=setTimeout(()=>$('toast').style.display='none',5000)}
function fmt(v,d=1,suffix=''){return v===null||v===undefined||!Number.isFinite(Number(v))?'—':Number(v).toLocaleString('uk-UA',{maximumFractionDigits:d,minimumFractionDigits:d})+suffix}
function dt(v){return v&&Number.isFinite(Date.parse(v))?new Date(v).toLocaleString('uk-UA',{timeZone:'Europe/Kyiv',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'—'}
function safe(s){const div=document.createElement('div');div.textContent=String(s??'');return div.innerHTML}
function chart(samples){
 const arr=samples.filter(t=>t.soc!=null&&t.can_fresh!==0&&t.time_quality!=='received'&&Number.isFinite(Date.parse(t.ts))).slice().sort((a,b)=>Date.parse(a.ts)-Date.parse(b.ts));
 if(!arr.length){$('socChart').innerHTML='<text x="12" y="90" fill="var(--muted)" font-size="12">Очікування вимірювань</text>';return;}
 const start=Date.parse(arr[0].ts),end=Date.parse(arr.at(-1).ts),x=t=>42+(end===start?190:381*(Date.parse(t.ts)-start)/(end-start)),y=v=>164-v*1.35;
 const groups=[];arr.forEach((t,i)=>{if(i===0||Date.parse(t.ts)-Date.parse(arr[i-1].ts)>300000)groups.push([]);groups.at(-1).push(t)});
 let grid='';for(const n of [0,25,50,75,100])grid+=`<line x1="42" x2="426" y1="${y(n)}" y2="${y(n)}" stroke="var(--line)" stroke-dasharray="3 5"/><text x="3" y="${y(n)+4}" class="charttext">${n}%</text>`;
 const paths=groups.map(group=>{const path=group.map((t,i)=>(i?'L':'M')+x(t).toFixed(1)+' '+y(t.soc).toFixed(1)).join(' ');return `<path d="${path} L${x(group.at(-1)).toFixed(1)} 164 L${x(group[0]).toFixed(1)} 164 Z" fill="url(#chargeArea)"/><path d="${path}" fill="none" stroke="var(--chart)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`}).join('');
 $('socChart').innerHTML=`<defs><linearGradient id="chargeArea" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="var(--chart)" stop-opacity=".15"/><stop offset="100%" stop-color="var(--chart)" stop-opacity="0"/></linearGradient></defs>`+grid+paths+`<circle cx="${x(arr.at(-1))}" cy="${y(arr.at(-1).soc)}" r="4" fill="var(--chart)" stroke="var(--paper)" stroke-width="2"/><text x="42" y="187" class="charttext">${safe(dt(arr[0].ts))}</text><text x="426" y="187" text-anchor="end" class="charttext">${safe(dt(arr.at(-1).ts))}</text>`;
}
function events(id,items){
 $(id).innerHTML=items.length?items.map(e=>{
  const complete=['charge_completed','charge_finished'].includes(e.event_type),charge=['charge_started','target_reached'].includes(e.event_type);
  const mark=complete?'<path d="m5 12 4 4 10-10"/>':charge?'<path d="m13 3-7 10h5l-1 8 8-12h-6z"/>':'<circle cx="12" cy="12" r="8"/><path d="M12 8v4m0 4h.01"/>';
  const text=String(e.details||e.event_type||'Подія').replace(/^[^\p{L}\p{N}]+/u,'');
  return `<div class="event"><span class="event-mark ${complete?'complete':charge?'charge':''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${mark}</svg></span><div class="event-content"><p>${safe(text)}</p><time class="eventtime">${safe(dt(e.ts))}</time></div></div>`;
 }).join(''):'<div class="empty">Подій поки немає</div>';
}
function rows(id,items){$(id).innerHTML=items.map(([label,v])=>`<div class="detailrow"><span>${safe(label)}</span><b>${safe(v)}</b></div>`).join('')}
function draw(){
 const summary=data.summary,s=summary.state||{},device=summary.device||{},metrics=summary.metrics||{},n=summary.notifications||{},fresh=summary.measurement_fresh===true;
 $('targetSummary').textContent=fmt(summary.settings?.target_soc,0,'%');$('socStat').textContent=fmt(s.soc,0,'%');$('socDonut').textContent=fmt(s.soc,0,'%');$('donut').style.setProperty('--soc',Math.max(0,Math.min(100,s.soc||0))+'%');
 $('socInfo').textContent=s.soc==null?'Очікування даних':fresh?(s.full?'BMS: повний заряд':'Виміряно: '+dt(s.last_can_ts||s.last_ts)):'Останній вимір: '+dt(s.last_can_ts||s.last_ts);
 $('powerStat').innerHTML=fmt(fresh&&s.current_a!=null&&s.voltage_v!=null?Math.abs(s.current_a*s.voltage_v)/1000:null,1)+' <small>кВт</small>';
 $('chargesStat').textContent=metrics.total_charges??'—';$('distanceStat').innerHTML=fmt(metrics.total_trips?metrics.gps_km:null,1)+' <small>км</small>';
 $('volt').textContent=fmt(fresh?s.voltage_v:null,1,' В');$('amp').textContent=fmt(fresh?s.current_a:null,1,' А');$('enerIn').textContent=fmt(s.energy_in_kwh,2,' кВт·год');$('enerOut').textContent=fmt(s.energy_out_kwh,2,' кВт·год');
 $('donut').dataset.mode=fresh?(s.mode||'unknown'):'unknown';$('donut').dataset.fresh=String(fresh);
 $('modeTag').textContent=fresh?(names[s.mode]||names.unknown):names.unknown;$('modeTag').className='badge'+(fresh&&s.full?' positive':fresh&&s.mode==='charging'?' accent':'');
 $('onlineChip').className='status'+(view==='live'&&summary.online?' online':'');$('onlineChip').textContent=localDemo&&view==='live'?'Локальний тест':view==='demo'?(summary.online?'Демо · на зв’язку':'Демо · поза мережею'):view==='locked'?'Потрібен вхід':summary.online?'Пристрій на зв’язку':'Пристрій поза мережею';
 $('lastSync').textContent='Доставка: '+dt(device.last_received_at);
 $('notice').className='notice'+(view==='demo'||localDemo&&view==='live'?' demo':view==='live'&&!fresh?' warn':'');
 $('notice').textContent=localDemo&&view==='live'?'Локальна демонстрація · дані симулятора.':view==='demo'?`Демо · ${demoStep+1}/${DEMO_STEPS.length} · ${DEMO_STEPS[demoStep].title}`:view==='locked'?'Відкрий через Telegram або введи ключ у налаштуваннях.':!summary.online?'Пристрій поза мережею. Стан зарядки невідомий. Останній вимір: '+dt(s.last_can_ts||s.last_ts)+'.':!fresh?'Очікування CAN-вимірювань.':'';
 $('noticeWrap').hidden=view==='live'&&!localDemo&&fresh&&Boolean(summary.online);
 $('demoControls').hidden=view!=='demo';$('demoLaunch').hidden=view!=='demo';$('previewDemo').hidden=view==='live'&&!localDemo;
 $('demoProgress').style.setProperty('--step',((demoStep+1)/DEMO_STEPS.length*100)+'%');
 $('demoStep').textContent=`${demoStep+1} / ${DEMO_STEPS.length} · ${DEMO_STEPS[demoStep].title}`;
 $('demoHint').textContent=DEMO_STEPS[demoStep].hint;
 $('demoPlay').textContent=demoTimer?'Пауза':demoStep===DEMO_STEPS.length-1?'Повторити':'Відтворити';
 $('demoPlay').setAttribute('aria-pressed',String(Boolean(demoTimer)));$('demoNext').disabled=demoStep===DEMO_STEPS.length-1;
 chart(data.telemetry);events('miniEvents',data.events.slice(0,3));events('allEvents',data.events);
 const endings={full_bms:'Повний заряд BMS',charger_finished:'Цикл завершено',stopped:'Зупинено'};
 $('chargesTable').innerHTML=data.charges.length?data.charges.map(c=>`<tr><td data-label="Початок">${safe(dt(c.started_at))}</td><td data-label="Завершення">${safe(dt(c.ended_at))}</td><td data-label="Заряд батареї">${fmt(c.start_soc,0)} → ${fmt(c.end_soc,0)}%</td><td data-label="Отримано батареєю">${fmt(c.charged_kwh,2)} кВт·год${c.energy_complete===0?' · неповні вимірювання':''}</td><td data-label="Результат"><span class="tag ${c.end_reason==='full_bms'?'':'muted'}">${c.ended_at?(endings[c.end_reason]||'Завершено'):'Сесія відкрита'}</span></td></tr>`).join(''):'<tr><td colspan="5" class="empty"><div class="empty-illustrated"><span class="art art-charger" aria-hidden="true" style="width:100px"></span><h3>Зарядок немає</h3></div></td></tr>';
 $('tripsTable').innerHTML=data.trips.length?data.trips.map(t=>`<tr><td data-label="Початок">${safe(dt(t.started_at))}</td><td data-label="Завершення">${safe(dt(t.ended_at))}</td><td data-label="Відстань">${fmt(t.distance_km,2)} км</td><td data-label="Макс. швидкість">${fmt(t.max_speed_kmh,0)} км/год</td></tr>`).join(''):'<tr><td colspan="4" class="empty"><div class="empty-illustrated"><span class="art art-map" aria-hidden="true"></span><h3>Поїздок немає</h3><p>Потрібен GNSS-модуль.</p></div></td></tr>';
 if(s.lat!=null&&s.lon!=null){const url=`https://www.openstreetmap.org/?mlat=${encodeURIComponent(s.lat)}&mlon=${encodeURIComponent(s.lon)}#map=15/${encodeURIComponent(s.lat)}/${encodeURIComponent(s.lon)}`;$('gps').innerHTML=`Координати: ${fmt(s.lat,5)}, ${fmt(s.lon,5)}<p>Виміряно: ${safe(dt(s.last_gps_ts))}</p><a class="link" target="_blank" rel="noopener noreferrer" href="${url}">Відкрити карту ↗</a>`;}else $('gps').textContent='Потрібен GNSS-модуль.';
 rows('deviceDetails',[['Прошивка',device.firmware_version||'—'],['Остання доставка',dt(device.last_received_at)],['Черга на ESP',fmt(device.queue_bytes,0,' байт')],['Втрачено через переповнення',fmt(device.dropped_samples,0)],['Пошкоджених записів',fmt(device.rejected_samples,0)],['Wi-Fi RSSI',fmt(device.rssi,0,' dBm')],['Пропущено CAN-кадрів',fmt(device.can_rx_missed,0)]]);
 rows('measurementDetails',[['Останній вимір',dt(s.last_can_ts||s.last_ts)],['Актуальність',fresh?'Актуальні':'Очікування / застарілі'],['Джерело часу',({synced:'NTP',reconstructed:'Відновлено з часу ESP',received:'Час доставки'})[s.time_quality]||'—'],['Зарядний пристрій',fresh?(chargerNames[s.charger_state]||'Невідомо'):'Невідомо'],['Версія сервера',summary.version||'—']]);
 rows('notificationDetails',[['Налаштовано',n.configured?'Так':'Ні'],['Очікують доставки',fmt(n.pending??0,0)],['Доставлено',fmt(n.sent??0,0)],['Пропущено застарілі',fmt(n.expired??0,0)],['Остання доставка',dt(n.last_sent_at)]]);$('testTelegram').disabled=view!=='live'||!n.configured;
 if(!dirty){$('targetSOC').value=summary.settings?.target_soc??90;$('price').value=summary.settings?.electricity_price??'';}
 $('saveSettings').disabled=view!=='live';
}
function explain(error){const t=error.message;return ({'Owner access denied':'Невірний ключ власника.','Telegram secrets are missing':'Додай токен бота й CHAT_ID на сервері.','Invalid target or price':'Перевір ціль 50–100% та тариф.','Failed to fetch':'Сервер недоступний. Перевір інтернет.'})[t]||t;}
async function api(path,opt={},signal){const key=$('adminKey').value.trim();if(!key&&!ownerAccess)throw Error('Введи ключ власника.');const r=await fetch(path,{...opt,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000),headers:{...telegramAuthHeaders(),...(key?{'x-admin-key':key}:{}),...opt.headers},cache:'no-store'});let result;try{result=await r.json()}catch{throw Error('Адреса не повернула дані LeafFleet.')}if(!r.ok||!result.ok)throw Error(result.error||'Помилка сервера');return result;}
async function load(connecting=false){
 const ticket=++requestSerial;controller?.abort();controller=new AbortController();busy=true;
 try{const r=await Promise.all(['/api/summary','/api/telemetry?limit=150','/api/charges?limit=100','/api/events?limit=100','/api/trips?limit=100'].map(p=>api(p,{},controller.signal)));
 if(ticket!==requestSerial)return false;stopDemo();data={summary:r[0],telemetry:r[1].items,charges:r[2].items,events:r[3].items,trips:r[4].items};view='live';storage.set('lf_admin',$('adminKey').value.trim());storage.set('lf_view','live');draw();return true;
 }catch(e){if(e.name==='AbortError')return false;if(ticket!==requestSerial)return false;if(connecting){storage.remove('lf_admin');view='locked';data=EMPTY;draw();}else{data.summary={...data.summary,online:false,measurement_fresh:false};draw();$('onlineChip').textContent='Помилка зв’язку';$('notice').className='notice warn';$('notice').textContent='Панель втратила зв’язок із сервером. Відображено останні отримані дані.';}toast(explain(e));return false;}finally{if(ticket===requestSerial)busy=false;}
}
const ROUTES={overview:['Авто',''],charging:['Історія',''],trips:['Історія',''],events:['Історія',''],diagnostics:['Стан',''],settings:['Налаштування','']};
function tab(name){
 if(!Object.hasOwn(ROUTES,name))return;
 const history=['charging','trips','events'].includes(name);
 document.querySelectorAll('[data-tab]').forEach(b=>{const active=b.dataset.tab===name||b.dataset.group==='history'&&history;b.classList.toggle('active',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')});
 document.querySelectorAll('.panels').forEach(p=>p.classList.toggle('active',p.id==='tab-'+name));
 $('appMain').dataset.route=name;globalThis.scrollTo?.({top:0,behavior:'instant'});
 $('historyNav').hidden=!history;$('pageTitle').textContent=ROUTES[name][0];$('pageSubtitle').textContent=ROUTES[name][1];
 syncTelegramNavigation();
}
function syncTelegramNavigation(){telegram.setNavigation($('demoSheet').open||$('appMain').dataset.route!=='overview')}
function closeSheet(){if($('demoSheet').open)$('demoSheet').close();syncTelegramNavigation();}
function openSheet(){if(view!=='demo')enterDemo();if(!$('demoSheet').open)$('demoSheet').showModal();syncTelegramNavigation();}
function applyTheme(theme){const next=theme==='light'?'light':'dark';document.documentElement.dataset.theme=next;$('themeToggle').setAttribute('aria-label',next==='dark'?'Увімкнути світлу тему':'Увімкнути темну тему');$('themeColor').setAttribute('content',next==='dark'?'#17191d':'#f2f2f0');storage.set('lf_theme',next);telegram.syncTheme(next);}
function stopDemo(){clearInterval(demoTimer);demoTimer=null;}
function cancel(){closeSheet();stopDemo();clearTimeout(toastTimer);$('toast').style.display='none';requestSerial++;controller?.abort();busy=false;dirty=false;}
function showDemoStep(index){demoStep=Math.max(0,Math.min(DEMO_STEPS.length-1,index));if(demoStep===0)demoEpoch=Date.now();if(demoStep===DEMO_STEPS.length-1)stopDemo();data=makeDemoSnapshot(demoStep,demoEpoch);draw();}
function enterDemo(){cancel();storage.remove('lf_admin');storage.set('lf_view','demo');$('adminKey').value='';view='demo';showDemoStep(0);tab('overview');}
$('nav').onclick=e=>{const b=e.target.closest('[data-tab]');if(b)tab(b.dataset.tab)};$('historyNav').onclick=$('nav').onclick;
$('connect').onclick=async()=>{if(location.protocol==='file:')return toast('Відкрий HTTPS-адресу розгорнутого LeafFleet або локальний сервер.');if(ownerIdentity)ownerAccess=true;$('connect').disabled=true;try{if(await load(true))toast('Підключення виконано.')}finally{$('connect').disabled=false}};
$('demo').onclick=()=>{enterDemo();openSheet()};$('previewDemo').onclick=openSheet;$('demoLaunch').onclick=openSheet;
$('demoClose').onclick=closeSheet;$('demoSheet').onclick=e=>{if(e.target===$('demoSheet'))closeSheet()};
$('demoSheet').addEventListener('close',syncTelegramNavigation);
$('themeToggle').onclick=()=>applyTheme(document.documentElement.dataset.theme==='dark'?'light':'dark');
$('quickActions').onclick=e=>{const b=e.target.closest('[data-go]');if(b)tab(b.dataset.go)};
$('targetShortcut').onclick=()=>tab('settings');$('eventsShortcut').onclick=()=>tab('events');
$('demoPlay').onclick=()=>{if(view!=='demo')return;if(demoTimer){stopDemo();draw();return;}if(demoStep===DEMO_STEPS.length-1)showDemoStep(0);demoTimer=setInterval(()=>{if(view==='demo')showDemoStep(demoStep+1);else stopDemo();},3000);draw();closeSheet();};
$('demoNext').onclick=()=>{if(view==='demo'){stopDemo();showDemoStep(demoStep+1);}};
$('demoReset').onclick=()=>{if(view==='demo'){stopDemo();showDemoStep(0);}};
document.addEventListener('visibilitychange',()=>{if(document.hidden&&demoTimer){stopDemo();draw();}});
$('logout').onclick=()=>{ownerAccess=false;cancel();storage.remove('lf_admin');storage.remove('lf_view');$('adminKey').value='';view='locked';data=EMPTY;draw();tab('settings')};
$('demoExit').onclick=$('logout').onclick;
$('refresh').onclick=()=>view==='live'?load():toast(view==='demo'?'Демонстраційні дані.':'Спочатку підключи сервер.');
for(const id of ['targetSOC','price'])$(id).addEventListener('input',()=>dirty=true);
$('saveSettings').onclick=async()=>{const target=Number($('targetSOC').value),price=$('price').value===''?null:Number($('price').value);if(!Number.isInteger(target)||target<50||target>100||price!==null&&(!Number.isFinite(price)||price<0||price>1000))return toast('Ціль: 50–100%. Тариф: 0–1000 грн.');try{await api('/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({target_soc:target,electricity_price:price})});dirty=false;await load();toast('Налаштування збережено.')}catch(e){toast(explain(e))}};
$('testTelegram').onclick=async()=>{try{await api('/api/notifications/test',{method:'POST'});toast('Тестове повідомлення додано до черги.');setTimeout(()=>{if(view==='live')load()},2000)}catch(e){toast(explain(e))}};
for(const b of document.querySelectorAll('[data-export]'))b.onclick=async()=>{if(view!=='live')return toast('Спочатку підключи сервер.');try{const r=await fetch('/api/export.csv?kind='+b.dataset.export,{headers:{...telegramAuthHeaders(),...($('adminKey').value.trim()?{'x-admin-key':$('adminKey').value.trim()}:{} )},cache:'no-store'});if(!r.ok)throw Error('Експорт не виконано.');const a=document.createElement('a');a.href=URL.createObjectURL(await r.blob());a.download=`leaffleet-${b.dataset.export}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000);toast('Експортовано до 5000 останніх записів.')}catch(e){toast(explain(e))}};
$('serverInfo').textContent=location.protocol==='file:'?'Демонстрація без сервера.':'Сервер: '+location.origin;
applyTheme(storage.get('lf_theme')||'dark');
$('adminKey').value=storage.get('lf_admin')||'';
if(location.protocol==='file:'||storage.get('lf_view')==='demo'){view='demo';data=makeDemoSnapshot(0)}draw();
async function bootstrap(){
 const ticket=requestSerial;
 if(['localhost','127.0.0.1'].includes(location.hostname)){
  try{const r=await fetch('/demo-config.json');const c=r.ok?await r.json():null;
   if(ticket!==requestSerial||view==='demo')return;
   if(c?.demo){localDemo=true;if(!$('adminKey').value)$('adminKey').value=c.admin_key;}
  }catch{}
 }
 if(!['localhost','127.0.0.1'].includes(location.hostname)&&ticket===requestSerial&&view!=='demo'){
  try{const r=await fetch('/api/access',{headers:telegramAuthHeaders(),cache:'no-store'});const access=r.ok?await r.json():null;
   if(ticket!==requestSerial||view==='demo')return;
   if(access?.owner===true){ownerIdentity=true;ownerAccess=true;$('adminKey').disabled=true;$('adminKey').placeholder='Доступ через Telegram';$('serverInfo').textContent='Доступ через Telegram';await load(true);return;}
  }catch{}
 }
 if(ticket===requestSerial&&view!=='demo'&&$('adminKey').value)load(true);
}
if(view!=='demo'&&location.protocol!=='file:')bootstrap();
syncTelegramNavigation();telegram.ready();
setInterval(()=>{if(view==='live'&&!busy&&!document.hidden&&telegram.isActive())load()},30000);
