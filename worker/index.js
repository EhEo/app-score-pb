import { DurableObject } from 'cloudflare:workers';
import QRCode from 'qrcode';
import { validPacket } from '../shared/protocol.js';

const WEEK = 7 * 24 * 60 * 60 * 1000;
const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' } });
function randomHex(length) { return Array.from(crypto.getRandomValues(new Uint8Array(length)), b => b.toString(16).padStart(2,'0')).join(''); }
async function tokenHash(token) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))), b=>b.toString(16).padStart(2,'0')).join(''); }
async function parsePacket(request) {
  if (Number(request.headers.get('content-length')) > 100000) return null;
  const text = await request.text();
  if (text.length > 100000) return null;
  try { const packet = JSON.parse(text); return validPacket(packet) ? packet : null; }
  catch (error) { if (error instanceof SyntaxError) return null; throw error; }
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/health') return json({ok:true,runtime:'cloudflare-workers',version:'3'});
      if (url.pathname === '/api/rooms' && request.method === 'POST') {
        if (request.headers.get('Origin') && request.headers.get('Origin') !== url.origin) return json({error:'다른 사이트에서는 경기를 만들 수 없습니다.'},403);
        const packet = await parsePacket(request);
        if (!packet) return json({error:'경기 데이터가 올바르지 않습니다.'},400);
        for (let attempt=0;attempt<3;attempt++) {
          const code = randomHex(4).toUpperCase(), token = randomHex(32);
          const response = await env.ROOMS.getByName(code).fetch(new Request('https://room/init',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({packet,tokenHash:await tokenHash(token)})}));
          if (response.status === 409) continue;
          if (!response.ok) return response;
          return json({code,token},201);
        }
        return json({error:'연결방을 만들지 못했습니다. 다시 시도해 주세요.'},503);
      }
      const match = url.pathname.match(/^\/api\/rooms\/([A-F0-9]{8})(\/socket)?$/);
      if (match) {
        if (request.headers.get('Origin') && request.headers.get('Origin') !== url.origin) return json({error:'다른 사이트에서는 연결할 수 없습니다.'},403);
        return env.ROOMS.getByName(match[1]).fetch(request);
      }
      if (url.pathname === '/api/qr' && request.method === 'GET') {
        const link = url.searchParams.get('url');
        if (!link || link.length > 2048) return json({error:'주소가 필요합니다.'},400);
        return new Response(await QRCode.toString(link,{type:'svg',margin:2}),{headers:{'Content-Type':'image/svg+xml','Cache-Control':'no-store'}});
      }
      if (url.pathname.startsWith('/api/')) return json({error:'주소를 찾을 수 없습니다.'},404);
      const response = await env.ASSETS.fetch(request);
      const headers = new Headers(response.headers);
      headers.set('X-Content-Type-Options','nosniff');
      headers.set('Referrer-Policy','no-referrer');
      headers.set('Content-Security-Policy',"default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
      headers.set('Cache-Control','no-cache');
      return new Response(response.body,{status:response.status,headers});
    } catch (error) { console.error('Worker request failed',error instanceof Error ? error.message : 'unknown'); return json({error:'연결 처리에 실패했습니다. 다시 시도해 주세요.'},500); }
  }
};

export class ScoreRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx,env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping','pong'));
  }
  fetch(request) { return this.ctx.blockConcurrencyWhile(()=>this.route(request)); }
  async route(request) {
    const url = new URL(request.url);
    let room = await this.ctx.storage.get('room');
    if (url.pathname === '/init' && request.method === 'POST') {
      if (room) return json({error:'이미 존재하는 경기입니다.'},409);
      const initial = await request.json();
      room = {...initial,expiresAt:Date.now()+WEEK};
      await this.ctx.storage.put('room',room); await this.ctx.storage.setAlarm(room.expiresAt);
      return json({ok:true},201);
    }
    if (!room || room.expiresAt < Date.now()) return json({error:'경기 코드가 없거나 7일 동안 사용하지 않아 만료됐습니다.'},404);
    if (url.pathname.endsWith('/socket') && request.method === 'GET') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({error:'WebSocket 연결이 필요합니다.'},426);
      const id = url.searchParams.get('viewer');
      if (!id || !/^[a-zA-Z0-9-]{1,80}$/.test(id)) return json({error:'표시 기기 ID가 필요합니다.'},400);
      const existing = this.ctx.getWebSockets('viewer').filter(ws=>ws.readyState===1);
      if (existing.some(ws=>ws.deserializeAttachment()?.viewerId !== id)) return json({error:'이미 태블릿 1대가 연결되어 있습니다.'},409);
      for (const ws of existing) ws.close(1000,'새 연결로 전환');
      const pair = new WebSocketPair(), client=pair[0], server=pair[1];
      this.ctx.acceptWebSocket(server,['viewer']); server.serializeAttachment({viewerId:id});
      server.send(JSON.stringify(room.packet));
      return new Response(null,{status:101,webSocket:client});
    }
    if (request.method === 'PUT' && !url.pathname.endsWith('/socket')) {
      const token = request.headers.get('Authorization')?.replace(/^Bearer /,'');
      if (!token || token.length !== 64 || await tokenHash(token) !== room.tokenHash) return json({error:'조작 권한이 없습니다.'},403);
      const packet = await parsePacket(request);
      if (!packet) return json({error:'경기 데이터가 올바르지 않습니다.'},400);
      if (packet.revision > room.packet.revision) {
        room = {...room,packet,expiresAt:Date.now()+WEEK};
        await this.ctx.storage.put('room',room); await this.ctx.storage.setAlarm(room.expiresAt);
        for (const socket of this.ctx.getWebSockets('viewer')) {
          if (socket.readyState === 1) socket.send(JSON.stringify(packet));
        }
      }
      return json({revision:room.packet.revision,viewer:this.ctx.getWebSockets('viewer').some(ws=>ws.readyState===1)});
    }
    if (request.method === 'GET') return json({...room.packet,viewer:this.ctx.getWebSockets('viewer').some(ws=>ws.readyState===1)});
    return json({error:'지원하지 않는 요청입니다.'},405);
  }
  webSocketMessage(ws, message) { if (message !== 'ping') ws.close(1008,'표시 전용 연결입니다.'); }
  webSocketClose(ws, code) { ws.close(code,'연결 종료'); }
  webSocketError(ws) { ws.close(1011,'다시 연결해 주세요.'); }
  async alarm() {
    const room = await this.ctx.storage.get('room');
    if (room && room.expiresAt > Date.now()) return this.ctx.storage.setAlarm(room.expiresAt);
    for (const ws of this.ctx.getWebSockets()) ws.close(1000,'경기 코드 만료');
    await this.ctx.storage.deleteAll();
  }
}
