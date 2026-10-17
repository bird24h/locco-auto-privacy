import test from 'node:test';
import assert from 'node:assert/strict';
import {createTelegramBridge} from '../public/telegram.mjs';
import {configureTelegram} from '../scripts/configure-telegram.mjs';
const APP_URL='https://leaf.test/';

function native(version=8){
 const calls=[],handlers={},document={documentElement:{dataset:{}}};
 const record=name=>(...args)=>calls.push([name,...args]);
 const sdk={platform:'ios',isActive:true,isVersionAtLeast:v=>version>=Number(v),ready:record('ready'),expand:record('expand'),requestFullscreen:record('fullscreen'),setHeaderColor:record('header'),setBackgroundColor:record('background'),setBottomBarColor:record('bottom'),onEvent:(name,fn)=>handlers[name]=fn,
  BackButton:{show:record('back.show'),hide:record('back.hide'),onClick:fn=>handlers.back=fn},
  SettingsButton:{show:record('settings.show'),onClick:fn=>handlers.settings=fn}};
 return {sdk,calls,handlers,document};
}
test('ordinary browsers retain their layout even when the Telegram SDK is present',()=>{
 const n=native();n.sdk.platform='unknown';const bridge=createTelegramBridge({webApp:n.sdk,document:n.document});
 bridge.ready();bridge.syncTheme('light');bridge.setNavigation(true);
 assert.equal(bridge.active,false);assert.equal(bridge.isActive(),true);assert.deepEqual(n.calls,[]);assert.deepEqual(n.document.documentElement.dataset,{});
});
test('Mini App bridges navigation, lifecycle and theme without reading identity',()=>{
 const n=native();let back=0,settings=0,resume=0,pause=0;
 Object.defineProperty(n.sdk,'initDataUnsafe',{get(){throw Error('Untrusted identity must not be read')}});
 const bridge=createTelegramBridge({webApp:n.sdk,document:n.document,onBack:()=>back++,onSettings:()=>settings++,onResume:()=>resume++,onPause:()=>pause++});
 bridge.ready();bridge.syncTheme('dark');bridge.setNavigation(true);n.handlers.back();n.handlers.settings();n.handlers.activated();n.handlers.deactivated();
 assert.equal(n.document.documentElement.dataset.telegram,'true');assert.deepEqual([back,settings,resume,pause],[1,1,1,1]);
 assert.ok(n.calls.some(x=>x[0]==='fullscreen'));assert.ok(n.calls.some(x=>x[0]==='back.show'));
 for(const name of ['header','background','bottom'])assert.ok(n.calls.some(x=>x[0]===name&&x[1]==='#17191d'));
 n.sdk.isActive=false;assert.equal(bridge.isActive(),false);bridge.syncTheme('light');assert.ok(n.calls.some(x=>x[0]==='header'&&x[1]==='#f2f2f0'));
});
test('older clients and failed native methods leave the controller usable',()=>{
 const n=native(6.1);n.sdk.ready=()=>{throw Error('Native bridge unavailable')};const bridge=createTelegramBridge({webApp:n.sdk,document:n.document});
 assert.doesNotThrow(()=>{bridge.ready();bridge.syncTheme('dark');bridge.setNavigation(false)});
 assert.ok(n.calls.some(x=>x[0]==='expand'));assert.ok(n.calls.some(x=>x[0]==='back.hide'));
 assert.equal(n.calls.some(x=>['fullscreen','header','bottom','settings.show'].includes(x[0])),false);
});

const TOKEN='123456789:dummy_token_for_unit_tests_only';
function botServer(){
 let menu={type:'commands'};const calls=[];
 return {calls,fetcher:async(url,opt)=>{
  const method=new URL(url).pathname.split('/').at(-1),body=JSON.parse(opt.body);calls.push({method,body});
  let result;if(method==='getMe')result={is_bot:true,username:'LeafFleetUnitTestBot'};
  else if(method==='getChatMenuButton')result=menu;
  else if(method==='setChatMenuButton'){menu=body.menu_button;result=true}
  else throw Error('Unexpected Telegram method');
  return Response.json({ok:true,result});
 }};
}
test('bot setup installs and verifies a Web App menu and is idempotent',async()=>{
 const bot=botServer(),config={appUrl:APP_URL,token:TOKEN,fetcher:bot.fetcher};
 const result=await configureTelegram(config);assert.equal(result.changed,true);assert.equal(result.menu_button.web_app.url,APP_URL);assert.equal(result.menu_button.text,'Open');assert.ok(!JSON.stringify(result).includes(TOKEN));
 assert.equal((await configureTelegram(config)).changed,false);
 assert.equal(bot.calls.filter(c=>c.method==='setChatMenuButton').length,1);
 assert.ok(bot.calls.every(c=>!['sendMessage','setWebhook','deleteWebhook','getUpdates'].includes(c.method)));
});
test('setup rejects unsafe URLs and invalid private chat IDs before any calls',async()=>{
 const bot=botServer();
 for(const options of [{appUrl:undefined},{appUrl:'http://leaf.test/'},{appUrl:'https://secret@leaf.test/'},{appUrl:'https://leaf.test/#token'},{chatId:-123},{chatId:''},{token:'bad'}])await assert.rejects(configureTelegram({appUrl:APP_URL,token:TOKEN,fetcher:bot.fetcher,...options}));
 assert.equal(bot.calls.length,0);
});
test('setup never exposes a token through upstream errors',async()=>{
 await assert.rejects(configureTelegram({appUrl:APP_URL,token:TOKEN,fetcher:async()=>{throw Error('https://api.telegram.org/bot'+TOKEN+'/getMe')}}),error=>!error.message.includes(TOKEN)&&/request failed/.test(error.message));
});
test('setup detects an acknowledged but unapplied button and scopes private menus',async()=>{
 const bot=botServer();await configureTelegram({appUrl:APP_URL,token:TOKEN,chatId:'12345',fetcher:bot.fetcher});
 assert.ok(bot.calls.filter(c=>c.method!=='getMe').every(c=>c.body.chat_id===12345));
 await assert.rejects(configureTelegram({appUrl:APP_URL,token:TOKEN,fetcher:async url=>{
  const method=new URL(url).pathname.split('/').at(-1);return Response.json({ok:true,result:method==='getMe'?{is_bot:true,username:'TestBot'}:method==='setChatMenuButton'?true:{type:'commands'}});
 }}),/verification failed/);
});
