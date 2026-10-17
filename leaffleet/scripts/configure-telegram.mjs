import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

// Run only after the bot owner supplies its token. No messages or webhook changes.
export async function configureTelegram({token,appUrl,chatId,fetcher=fetch}={}){
 if(typeof token!=='string'||!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token))throw Error('Provide a valid bot token through hidden stdin.');
 let url;try{url=new URL(appUrl)}catch{throw Error('Mini App URL must be an absolute HTTPS URL.')}
 if(url.protocol!=='https:'||url.username||url.password||url.hash)throw Error('Mini App URL must use HTTPS without credentials or a fragment.');
 if(chatId!==undefined&&(!Number.isSafeInteger(Number(chatId))||Number(chatId)<=0))throw Error('chatId must identify a private user chat.');
 const scope=chatId===undefined?{}:{chat_id:Number(chatId)};
 async function api(method,body={}){
  let response,result;
  try{
   response=await fetcher(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
   result=await response.json();
  }catch{throw Error(`Telegram ${method}: request failed.`)}
  if(!response.ok||result.ok!==true)throw Error(`Telegram ${method}: request rejected (HTTP ${response.status}).`);
  return result.result;
 }
 const bot=await api('getMe');
 if(bot?.is_bot!==true||typeof bot.username!=='string'||!/^\w+$/.test(bot.username))throw Error('Telegram did not return a valid bot.');
 const menu={type:'web_app',text:'Open',web_app:{url:url.href}};
 const matches=current=>current?.type===menu.type&&current?.text===menu.text&&current?.web_app?.url===menu.web_app.url;
 const previous=await api('getChatMenuButton',scope);
 let changed=false;
 if(!matches(previous)){
  if(await api('setChatMenuButton',{...scope,menu_button:menu})!==true)throw Error('Telegram did not confirm the menu update.');
  changed=true;
 }
 if(!matches(await api('getChatMenuButton',scope)))throw Error('Telegram menu verification failed.');
 return {ok:true,bot_username:bot.username,bot_url:`https://t.me/${bot.username}`,menu_button:menu,scope:chatId===undefined?'default':'private-chat',changed,main_app_setup:'Configure Main Mini App separately in BotFather.',access:'Server verifies Telegram initData and the configured owner ID.'};
}

async function readHiddenInput(){
 if(!process.stdin.isTTY||typeof process.stdin.setRawMode!=='function')throw Error('Run in an interactive terminal; input must be hidden.');
 process.stdout.write('Ready for Telegram setup JSON on stdin (input is hidden).\n');
 process.stdin.setRawMode(true);process.stdin.resume();
 try{
  const line=await new Promise((resolve,reject)=>{
   let text='';
   const finish=(error,value)=>{process.stdin.off('data',read);error?reject(error):resolve(value)};
   function read(chunk){
    for(const char of chunk.toString('utf8')){
     if(char==='\u0003'||char==='\u0004')return finish(Error('Telegram setup cancelled.'));
     if(char==='\n'||char==='\r')return finish(null,text);
     if(char==='\u007f'||char==='\b')text=text.slice(0,-1);else text+=char;
     if(text.length>8192)return finish(Error('Telegram setup input is too long.'));
    }
   }
   process.stdin.on('data',read);
  });
  try{return JSON.parse(line)}catch{throw Error('Invalid Telegram setup JSON.')}
 }finally{process.stdin.setRawMode(false);process.stdin.pause()}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{const result=await configureTelegram(await readHiddenInput());console.log(JSON.stringify(result))}
 catch(error){console.error(error.message);process.exitCode=1}
}
