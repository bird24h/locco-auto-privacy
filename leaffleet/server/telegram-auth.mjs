const encoder = new TextEncoder();
const MAX_AGE_SECONDS = 3600;

async function hmac(key, data) {
  const imported = await crypto.subtle.importKey('raw', key, {name:'HMAC', hash:'SHA-256'}, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', imported, encoder.encode(data)));
}

// Trust only Telegram's server-verifiable signature and an explicitly configured owner.
// Neither initDataUnsafe nor a caller-supplied identity header grants permission.
export async function telegramOwner(request, env, now = Date.now()) {
  const owner = String(env.OWNER_TELEGRAM_ID || '');
  const token = env.TELEGRAM_BOT_TOKEN;
  const raw = request.headers.get('x-telegram-init-data') || '';
  if (!/^[1-9]\d{0,15}$/.test(owner) || typeof token !== 'string' || !token || !raw || raw.length > 16384) return false;
  const params = new URLSearchParams(raw);
  const keys = [...params.keys()];
  if (keys.length !== new Set(keys).size) return false;
  const hash = params.get('hash') || '';
  const date = params.get('auth_date') || '';
  if (!/^[a-f0-9]{64}$/.test(hash) || !/^\d{10}$/.test(date)) return false;
  const age = now / 1000 - Number(date);
  if (age < -30 || age > MAX_AGE_SECONDS) return false;
  params.delete('hash');
  const check = [...params.entries()].sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([k,v]) => `${k}=${v}`).join('\n');
  const secret = await hmac(encoder.encode('WebAppData'), token);
  const received = Uint8Array.from(hash.match(/../g), value => parseInt(value,16));
  const key = await crypto.subtle.importKey('raw', secret, {name:'HMAC',hash:'SHA-256'}, false, ['verify']);
  if (!await crypto.subtle.verify('HMAC', key, received, encoder.encode(check))) return false;
  // Do not parse or use identity until integrity and freshness have passed.
  try {
    const user = JSON.parse(params.get('user') || 'null');
    return Number.isSafeInteger(user?.id) && String(user.id) === owner;
  } catch { return false; }
}
