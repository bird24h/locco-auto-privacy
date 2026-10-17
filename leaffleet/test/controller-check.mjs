// M1 controller check with a DOM double. Does not validate browser layout.
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const fixture=JSON.parse(await readFile(new URL('./panel-fixture.json',import.meta.url),'utf8'));
const scenario=(await readFile(new URL('public/demo-scenario.mjs',root),'utf8')).replace(/^export /gm,'');
const telegramSource=(await readFile(new URL('public/telegram.mjs',root),'utf8')).replace(/^export /gm,'');
const source=(await readFile(new URL('public/app.mjs',root),'utf8')).replace(/^import .*;\n/gm,'');
function element(tag,attrs={}){
 const classes=new Set((attrs.class||'').split(' '));let value='';
 return {tag,attrs,id:attrs.id,dataset:Object.fromEntries(Object.entries(attrs).filter(([k])=>k.startsWith('data-')).map(([k,v])=>[k.slice(5),v])),
  open:false,showModal(){this.open=true},close(){this.open=false},value:attrs.value||'',hidden:'hidden' in attrs,disabled:false,innerHTML:'',
  set textContent(v){value=String(v);this.innerHTML=value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')},
  get textContent(){return value},style:{setProperty(){}},addEventListener(){},click(){return this.onclick?.()},
  setAttribute(k,v){this.attrs[k]=v},removeAttribute(k){delete this.attrs[k]},
  classList:{toggle(k,on){if(on)classes.add(k);else classes.delete(k)},contains:k=>classes.has(k)}};
}
async function setup(local=false,storedKey=false,theme=null,hosted=false,inTelegram=false){
 const nodes=fixture.map(n=>element(n.tag,n.attrs)),byId=Object.fromEntries(nodes.filter(n=>n.attrs.id).map(n=>[n.attrs.id,n]));
 const intervals=new Map(),events={},calls=[],storage=new Map(storedKey?[['lf_admin','test-owner'],['lf_view','live']]:[]);if(theme)storage.set('lf_theme',theme);let serial=0;
 const nativeEvents={},nativeCalls=[];
 const record=name=>(...args)=>nativeCalls.push([name,...args]);
 const webApp={platform:'ios',isActive:true,isVersionAtLeast:()=>true,ready:record('ready'),expand:record('expand'),requestFullscreen:record('fullscreen'),setHeaderColor:record('header'),setBackgroundColor:record('background'),setBottomBarColor:record('bottom'),onEvent:(name,fn)=>nativeEvents[name]=fn,BackButton:{show:record('back.show'),hide:record('back.hide'),onClick:fn=>nativeEvents.back=fn},SettingsButton:{show:record('settings.show'),onClick:fn=>nativeEvents.settings=fn}};
 const ctx={console,Date,Number,String,Math,JSON,Map,Set,Error,Boolean,URL,AbortController,AbortSignal,structuredClone,
  ...(inTelegram?{Telegram:{WebApp:webApp}}:{}),
  location:hosted?{protocol:'https:',hostname:'leaf.test',origin:'https://leaf.test'}:local?{protocol:'http:',hostname:'127.0.0.1',origin:'http://127.0.0.1:8787'}:{protocol:'file:',hostname:'',origin:'null'},
  sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
  document:{documentElement:element('html'),hidden:false,getElementById:id=>byId[id],createElement:tag=>element(tag),
   querySelectorAll:selector=>nodes.filter(n=>selector==='[data-tab]'?'tab' in n.dataset:selector==='[data-export]'?'export' in n.dataset:selector==='.panels'?n.attrs.class?.split(' ').includes('panels'):false),
   addEventListener:(name,fn)=>events[name]=fn},
  setInterval(fn,ms){const id=++serial;intervals.set(id,{fn,ms});return id},clearInterval:id=>intervals.delete(id),
  setTimeout:()=>++serial,clearTimeout(){},
  async fetch(path){calls.push(path);let data={ok:true};
   if(path==='/api/access')data={ok:true,owner:hosted};
   else if(path==='/demo-config.json')data={demo:true,admin_key:'test-owner'};
   else if(path==='/api/summary')data={ok:true,version:'1.0.2',state:{soc:100},device:{},settings:{},metrics:{},notifications:{configured:false},online:true,measurement_fresh:true};
   else data={ok:true,items:[]};
   return {ok:true,json:async()=>data};}
 };
 vm.runInContext(scenario+'\n'+telegramSource+'\n'+source,vm.createContext(ctx));
 await new Promise(resolve=>setImmediate(resolve));
 return {nodes,byId,ctx,intervals,events,calls,storage,nativeEvents,nativeCalls,webApp};
}
const h=await setup(),e=h.byId;
assert.equal(h.ctx.document.documentElement.dataset.theme,'dark');
e.themeToggle.click();assert.equal(h.ctx.document.documentElement.dataset.theme,'light');assert.equal(h.storage.get('lf_theme'),'light');
assert.equal(e.themeColor.attrs.content,'#f2f2f0');assert.match(e.themeToggle.attrs['aria-label'],/темну/);
e.themeToggle.click();assert.equal(h.ctx.document.documentElement.dataset.theme,'dark');
assert.equal(e.demoSheet.open,false);e.previewDemo.click();assert.equal(e.demoSheet.open,true);e.demoClose.click();assert.equal(e.demoSheet.open,false);
e.demoLaunch.click();e.demoSheet.onclick({target:e.demoSheet});assert.equal(e.demoSheet.open,false);
for(const b of h.nodes.filter(n=>'go' in n.dataset)){e.quickActions.onclick({target:{closest:()=>b}});assert.equal(e['tab-'+b.dataset.go].classList.contains('active'),true)}
e.targetShortcut.click();assert.equal(e['tab-settings'].classList.contains('active'),true);
e.eventsShortcut.click();assert.equal(e['tab-events'].classList.contains('active'),true);

assert.equal(e.socStat.textContent,'76%');assert.equal(e.demoControls.hidden,false);
assert.equal(e.testTelegram.disabled,true);assert.equal(e.saveSettings.disabled,true);assert.equal(h.calls.length,0);
for(const button of h.nodes.filter(n=>'tab' in n.dataset)){
 e.nav.onclick({target:{closest:()=>button}});
 assert.equal(h.nodes.filter(n=>n.attrs.class?.split(' ').includes('panels')&&n.classList.contains('active')).length,1);
 assert.equal(e['tab-'+button.dataset.tab].classList.contains('active'),true);
 const history=['charging','trips','events'].includes(button.dataset.tab);
 assert.equal(e.historyNav.hidden,!history);
 const historyButton=h.nodes.find(n=>n.dataset.group==='history');
 assert.equal(historyButton.classList.contains('active'),history);
 if(history)assert.equal(e.pageTitle.textContent,'Історія');
}
e.demoNext.click();e.demoNext.click();assert.equal(e.socStat.textContent,'90%');e.previewDemo.click();assert.equal(e.socStat.textContent,'90%');assert.equal(e.demoSheet.open,true);e.demoClose.click();
e.demoNext.click();assert.match(e.onlineChip.textContent,/поза мережею/);assert.equal(e.modeTag.textContent,'Стан невідомий');assert.match(e.powerStat.innerHTML,/—/);
assert.ok(!e.chargesTable.innerHTML.includes('Повний заряд BMS'));
e.demoNext.click();assert.equal(e.socStat.textContent,'96%');e.demoNext.click();assert.equal(e.socStat.textContent,'100%');
assert.equal(e.demoNext.disabled,true);assert.match(e.chargesTable.innerHTML,/Повний заряд BMS/);
e.demoReset.click();assert.equal(e.socStat.textContent,'76%');
e.previewDemo.click();e.demoPlay.click();assert.equal(e.demoSheet.open,false);const tick=()=>{for(const timer of [...h.intervals.values()])if(timer.ms===3000)timer.fn()};
tick();tick();assert.equal(e.socStat.textContent,'90%');e.demoPlay.click();assert.equal([...h.intervals.values()].filter(t=>t.ms===3000).length,0);
e.demoPlay.click();h.ctx.document.hidden=true;h.events.visibilitychange();assert.equal([...h.intervals.values()].filter(t=>t.ms===3000).length,0);h.ctx.document.hidden=false;
e.demoPlay.click();tick();tick();tick();assert.equal(e.socStat.textContent,'100%');assert.equal([...h.intervals.values()].filter(t=>t.ms===3000).length,0);
e.demoReset.click();e.demoPlay.click();e.demoLaunch.click();e.demoExit.click();assert.equal(e.demoSheet.open,false);assert.equal(e.demoControls.hidden,true);assert.equal(e.socStat.textContent,'—');assert.equal(h.storage.has('lf_admin'),false);assert.equal([...h.intervals.values()].filter(t=>t.ms===3000).length,0);
for(const stored of [false,true]){
 const local=await setup(true,stored);
 assert.match(local.byId.notice.textContent,/Локальна демонстрація/);
 assert.equal(local.byId.onlineChip.textContent,'Локальний тест');
}
const restored=await setup(false,false,'light');assert.equal(restored.ctx.document.documentElement.dataset.theme,'light');
console.log('PASS: native-sheet controller, theme toggle/restoration, 3D shortcuts, target/events links, controller init, six tabs, manual charge cycle, offline state, playback/pause/reset, hidden-page pause, logout cleanup, local-demo reload label. DOM double only; browser rendering remains unverified.');

const hosted=await setup(false,false,null,true);assert.equal(hosted.byId.adminKey.disabled,true);assert.equal(hosted.byId.socStat.textContent,'100%');assert.equal(hosted.storage.has('lf_admin'),true);hosted.byId.logout.click();assert.equal(hosted.byId.socStat.textContent,'—');await hosted.byId.connect.click();assert.equal(hosted.byId.socStat.textContent,'100%');console.log('PASS: verified-owner bootstrap (mocked API), keyless API access, disconnect and reconnect.');

const tg=await setup(false,false,null,true,true);
assert.equal(tg.ctx.document.documentElement.dataset.telegram,'true');
assert.ok(tg.nativeCalls.some(c=>c[0]==='fullscreen'));assert.equal(tg.nativeCalls.filter(c=>c[0].startsWith('back.')).at(-1)[0],'back.hide');
tg.byId.targetShortcut.click();assert.equal(tg.byId.appMain.dataset.route,'settings');assert.equal(tg.nativeCalls.at(-1)[0],'back.show');
tg.nativeEvents.back();assert.equal(tg.byId.appMain.dataset.route,'overview');assert.equal(tg.nativeCalls.at(-1)[0],'back.hide');
tg.byId.previewDemo.click();tg.nativeEvents.back();assert.equal(tg.byId.demoSheet.open,false);assert.equal(tg.byId.appMain.dataset.route,'overview');
tg.nativeEvents.settings();assert.equal(tg.byId.appMain.dataset.route,'settings');
tg.byId.themeToggle.click();assert.ok(tg.nativeCalls.some(c=>c[0]==='header'&&c[1]==='#f2f2f0'));
await tg.byId.connect.click();const beforePause=tg.calls.length;tg.webApp.isActive=false;
for(const timer of tg.intervals.values())if(timer.ms===30000)timer.fn();assert.equal(tg.calls.length,beforePause);
tg.webApp.isActive=true;tg.nativeEvents.activated();await new Promise(resolve=>setImmediate(resolve));assert.equal(tg.calls.length,beforePause+5);
console.log('PASS: Telegram route/sheet back behavior, settings shortcut, native theme, suspended polling and resume. DOM double only.');
