export async function deliverNotifications(env, now = Date.now(), fetcher = fetch) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return {configured:false, sent:0};
  const db=env.DB, token=crypto.randomUUID(); let sent=0;
  const {results}=await db.prepare("SELECT n.*,e.event_type,e.ts AS event_ts FROM notification_outbox n LEFT JOIN events e ON e.event_id=n.event_id WHERE n.status='pending' AND n.next_attempt_at<=? AND (n.lease_until IS NULL OR n.lease_until<?) ORDER BY n.created_at LIMIT 3").bind(now,now).all();
  for (const row of results) {
    const claim=await db.prepare("UPDATE notification_outbox SET lease_token=?,lease_until=? WHERE event_id=? AND status='pending' AND (lease_until IS NULL OR lease_until<?) RETURNING event_id")
      .bind(token,now+60000,row.event_id,now).first();
    if (!claim) continue;
    const age=now-Date.parse(row.event_ts||row.created_at);
    const terminal=['charge_completed','charge_finished','charge_stopped'].includes(row.event_type);
    if(age>(terminal?86400000:600000)){
      await db.prepare("UPDATE notification_outbox SET status='expired',lease_until=NULL,lease_token=NULL,last_error='Notification expired' WHERE event_id=? AND lease_token=?").bind(row.event_id,token).run();continue;
    }
    const text=now-Date.parse(row.created_at)>600000?row.message+"\nДоставка із затримкою; подія: "+new Date(row.event_ts||row.created_at).toLocaleString('uk-UA',{timeZone:'Europe/Kyiv'})+'.':row.message;
    try {
      const response=await fetcher(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({chat_id:env.TELEGRAM_CHAT_ID,text,disable_web_page_preview:true}),signal:AbortSignal.timeout(8000)});
      let result; try {result=await response.json();} catch {result={};}
      if (!response.ok || result.ok!==true) {
        const retry=result.parameters?.retry_after;
        const error=new Error(`Telegram HTTP ${response.status}`); error.retry=retry; throw error;
      }
      await db.prepare("UPDATE notification_outbox SET status='sent',sent_at=?,telegram_message_id=?,lease_until=NULL,lease_token=NULL,last_error=NULL WHERE event_id=? AND lease_token=?")
        .bind(new Date(now).toISOString(),result.result?.message_id??null,row.event_id,token).run(); sent++;
    } catch (error) {
      const delay=Number.isFinite(error.retry)?Math.max(30,error.retry)*1000:Math.min(3600000,30000*2**Math.min(row.attempts,7));
      // Log only a generic status, never the URL containing the bot token.
      await db.prepare("UPDATE notification_outbox SET attempts=attempts+1,next_attempt_at=?,lease_until=NULL,lease_token=NULL,last_error=? WHERE event_id=? AND lease_token=?")
        .bind(now+delay,error.retry?'Telegram rate limit':'Telegram delivery failed',row.event_id,token).run();
    }
  }
  return {configured:true,sent};
}
export function notificationStatement(db, eventId, message, receivedAt) {
  return db.prepare("INSERT OR IGNORE INTO notification_outbox (event_id,message,created_at,next_attempt_at) VALUES (?,?,?,?)")
    .bind(eventId,message,receivedAt,Date.parse(receivedAt));
}
