import { gateway, initializeDatabase } from './gateway.mjs';
import { maintenance } from '../cloud/src/index.mjs';

const CSP = "default-src 'self'; script-src 'self' https://telegram.org; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self' https://web.telegram.org; form-action 'self'";

export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/api/')) return gateway(request, env, ctx);
    if (!['GET','HEAD'].includes(request.method)) return new Response('Method not allowed', {status:405});
    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    headers.set('Content-Security-Policy', CSP);
    headers.set('X-Content-Type-Options','nosniff');
    headers.set('Referrer-Policy','no-referrer');
    if (headers.get('Content-Type')?.includes('text/html')) headers.set('Cache-Control','no-store');
    return new Response(response.body, {status:response.status,headers});
  },
  scheduled(_event, env, ctx) { ctx.waitUntil((async()=>{await initializeDatabase(env.DB);await maintenance(env)})()); },
};
