// Presentation adapter. Access is granted only by server-side signature verification.
// Never trust initDataUnsafe, URL parameters, or an unverified Telegram user ID.
export function createTelegramBridge({
 webApp=globalThis.Telegram?.WebApp,
 document=globalThis.document,
 onBack=()=>{},onSettings=()=>{},onResume=()=>{},onPause=()=>{},
}={}){
 const active=Boolean(webApp?.platform&&webApp.platform!=='unknown');
 const call=(object,name,...args)=>{try{return object?.[name]?.(...args)}catch{return undefined}};
 const supports=version=>active&&call(webApp,'isVersionAtLeast',version)===true;
 const bridge={
  active,
  isActive(){return !active||webApp.isActive!==false},
  setNavigation(visible){if(supports('6.1'))call(webApp.BackButton,visible?'show':'hide')},
  syncTheme(theme){
   if(!active)return;
   const color=theme==='light'?'#f2f2f0':'#17191d';
   if(supports('6.1'))call(webApp,'setBackgroundColor',color);
   // Arbitrary header colors are supported from 6.9 onward.
   if(supports('6.9'))call(webApp,'setHeaderColor',color);
   if(supports('7.10'))call(webApp,'setBottomBarColor',color);
  },
  ready(){
   if(!active)return;
   call(webApp,'ready');call(webApp,'expand');
   if(supports('8.0'))call(webApp,'requestFullscreen');
  },
 };
 if(!active)return bridge;
 document.documentElement.dataset.telegram='true';
 if(supports('6.1'))call(webApp.BackButton,'onClick',onBack);
 if(supports('7.0')){call(webApp.SettingsButton,'onClick',onSettings);call(webApp.SettingsButton,'show')}
 if(supports('8.0')){call(webApp,'onEvent','activated',onResume);call(webApp,'onEvent','deactivated',onPause)}
 return bridge;
}

// Send the original signed payload only in HTTPS request headers, never in a URL.
export function telegramAuthHeaders(webApp=globalThis.Telegram?.WebApp){
 const data=webApp?.initData;
 return typeof data==='string'&&data.length>0&&data.length<=16384?{'x-telegram-init-data':data}:{};
}
