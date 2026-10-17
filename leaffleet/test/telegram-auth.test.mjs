import test from 'node:test';
import assert from 'node:assert/strict';
import {telegramOwner} from '../server/telegram-auth.mjs';
import {telegramAuthHeaders} from '../public/telegram.mjs';

import {TOKEN,OWNER,signedData} from './fixtures/telegram.mjs';
const env={TELEGRAM_BOT_TOKEN:TOKEN,OWNER_TELEGRAM_ID:OWNER};
const request=data=>new Request('https://leaf.test/api/access',{headers:{'x-telegram-init-data':data}});

test('fresh payload signed by the bot grants the configured owner access',async()=>{assert.equal(await telegramOwner(request(signedData()),env),true)});
test('a valid Telegram identity belonging to someone else is denied',async()=>{assert.equal(await telegramOwner(request(signedData({id:987654321})),env),false)});
test('tampered user, token and hash are denied',async()=>{
 const raw=signedData();
 const p=new URLSearchParams(raw);p.set('user',JSON.stringify({id:Number(OWNER),first_name:'Changed'}));
 assert.equal(await telegramOwner(request(p.toString()),env),false);
 assert.equal(await telegramOwner(request(raw),{...env,TELEGRAM_BOT_TOKEN:'other-token'}),false);
 p.set('hash','0'.repeat(64));assert.equal(await telegramOwner(request(p.toString()),env),false);
});
test('expired and future launch data are denied',async()=>{
 const seconds=Math.floor(Date.now()/1000);
 assert.equal(await telegramOwner(request(signedData({date:seconds-3601})),env),false);
 assert.equal(await telegramOwner(request(signedData({date:seconds+120})),env),false);
});
test('missing settings, duplicate parameters and unsigned identities fail closed',async()=>{
 assert.equal(await telegramOwner(request(signedData()),{}),false);
 assert.equal(await telegramOwner(request(signedData()),{...env,OWNER_TELEGRAM_ID:'-1001'}),false);
 assert.equal(await telegramOwner(request(signedData()+'&auth_date=1'),env),false);
 assert.equal(await telegramOwner(request('user='+encodeURIComponent(JSON.stringify({id:Number(OWNER)}))),env),false);
 assert.equal(await telegramOwner(request('x'.repeat(16385)),env),false);
});
test('client sends only original signed initData, never initDataUnsafe',()=>{
 assert.deepEqual(telegramAuthHeaders({initData:signedData()}),{'x-telegram-init-data':signedData()});
 assert.deepEqual(telegramAuthHeaders({initDataUnsafe:{user:{id:Number(OWNER)}}}),{});
 assert.deepEqual(telegramAuthHeaders({initData:'x'.repeat(16385)}),{});
});
