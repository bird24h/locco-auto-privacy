import {createHmac} from 'node:crypto';
export const TOKEN='123456789:local-test-token-not-a-real-bot';
export const OWNER='123456789';
export function signedData({id=Number(OWNER),date=Math.floor(Date.now()/1000),extra={}}={}){
 const fields={auth_date:String(date),query_id:'test-query',user:JSON.stringify({id,first_name:'Test'}),...extra};
 const check=Object.entries(fields).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>`${k}=${v}`).join('\n');
 const secret=createHmac('sha256','WebAppData').update(TOKEN).digest();
 const hash=createHmac('sha256',secret).update(check).digest('hex');
 return new URLSearchParams({...fields,hash}).toString();
}
