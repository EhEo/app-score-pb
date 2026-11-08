import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import QRCode from 'qrcode';
import { WebSocketServer } from 'ws';
import { validPacket } from './shared/protocol.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.join(root, '.data');
await mkdir(dataDir, { recursive: true });
let rooms;
try { rooms = JSON.parse(await readFile(path.join(dataDir, 'rooms.json'), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; rooms = {}; }
const streams = new Map();
const sockets = new Map();
const connected = code => streams.has(code) || sockets.get(code)?.ws.readyState === 1;
let saving = Promise.resolve();
function persist() {
  const snapshot = JSON.stringify(rooms);
  saving = saving.catch(() => {}).then(async () => {
    await writeFile(path.join(dataDir, 'rooms.tmp'), snapshot);
    await rename(path.join(dataDir, 'rooms.tmp'), path.join(dataDir, 'rooms.json'));
  });
  return saving;
}
function equal(a, b) { return typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b)); }
function send(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); }
async function body(req) {
  let value = ''; for await (const chunk of req) { value += chunk; if (value.length > 1_000_000) throw new Error('요청이 너무 큽니다.'); }
  return JSON.parse(value);
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/rooms' && req.method === 'POST') {
      const packet = await body(req);
      if (!validPacket(packet)) return send(res, 400, { error: '경기 데이터가 올바르지 않습니다.' });
      const code = randomBytes(4).toString('hex').toUpperCase();
      const token = randomBytes(32).toString('hex');
      rooms[code] = { token, packet, updatedAt: Date.now() };
      await persist(); return send(res, 201, { code, token });
    }
    const match = url.pathname.match(/^\/api\/rooms\/([A-F0-9]{8})(\/events)?$/);
    if (match) {
      const code = match[1], room = rooms[code];
      if (!room) return send(res, 404, { error: '경기 코드를 찾을 수 없습니다.' });
      if (req.method === 'PUT' && !match[2]) {
        if (!equal(req.headers.authorization?.replace('Bearer ', ''), room.token)) return send(res, 403, { error: '조작 권한이 없습니다.' });
        const packet = await body(req);
        if (!validPacket(packet)) return send(res, 400, { error: '경기 데이터가 올바르지 않습니다.' });
        if (packet.revision > room.packet.revision) {
          room.packet = packet; room.updatedAt = Date.now(); await persist();
          streams.get(code)?.res.write(`data: ${JSON.stringify(packet)}\n\n`);
          const socket = sockets.get(code)?.ws; if (socket?.readyState === 1) socket.send(JSON.stringify(packet));
        }
        return send(res, 200, { revision: room.packet.revision, viewer: connected(code) });
      }
      if (req.method === 'GET' && match[2]) {
        const viewerId = url.searchParams.get('viewer');
        if (!viewerId || viewerId.length > 80) return send(res, 400, { error: '표시 기기 ID가 필요합니다.' });
        const existing = streams.get(code);
        if ((existing && existing.viewerId !== viewerId) || sockets.has(code)) return send(res, 409, { error: '이미 표시용 태블릿 1대가 연결되어 있습니다.' });
        existing?.res.end();
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.write(`data: ${JSON.stringify(room.packet)}\n\n`);
        const entry = { res, viewerId }; streams.set(code, entry);
        const heartbeat = setInterval(() => res.write(`event: heartbeat\ndata: ${Date.now()}\n\n`), 5000);
        req.on('close', () => { clearInterval(heartbeat); if (streams.get(code) === entry) streams.delete(code); });
        return;
      }
      if (req.method === 'GET') return send(res, 200, { ...room.packet, viewer: connected(code) });
      return send(res, 405, { error: '지원하지 않는 요청입니다.' });
    }
    if (url.pathname === '/api/qr') {
      const link = url.searchParams.get('url');
      if (!link || link.length > 2048) return send(res, 400, { error: '주소가 필요합니다.' });
      const svg = await QRCode.toString(link, { type: 'svg', margin: 2 });
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' }); return res.end(svg);
    }
    if (url.pathname.startsWith('/api/')) return send(res, 404, { error: '주소를 찾을 수 없습니다.' });
    const allowed = new Set(['index.html', 'app.js', 'engine.js', 'style.css', 'mobile.css', 'sw.js', 'manifest.webmanifest', 'icon.svg']);
    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (!allowed.has(file)) return send(res, 404, { error: '주소를 찾을 수 없습니다.' });
    const types = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', webmanifest: 'application/manifest+json', svg: 'image/svg+xml' };
    res.writeHead(200, { 'Content-Type': types[file.split('.').at(-1)], 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" });
    res.end(await readFile(path.join(root, 'public', file)));
  } catch (error) { console.error(error.message); if (!res.headersSent) send(res, 500, { error: '처리하지 못했습니다. 연결 후 다시 시도해 주세요.' }); else res.end(); }
});
const wss = new WebSocketServer({noServer:true});
server.on('upgrade',(req,socket,head)=>{
  const url = new URL(req.url,'http://localhost');
  const match = url.pathname.match(/^\/api\/rooms\/([A-F0-9]{8})\/socket$/);
  const code=match?.[1], viewerId=url.searchParams.get('viewer'), room=rooms[code], existing=sockets.get(code);
  function reject(status){socket.write(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\n\r\n`);socket.destroy();}
  if (!room) return reject(404);
  if (!viewerId || !/^[a-zA-Z0-9-]{1,80}$/.test(viewerId)) return reject(400);
  if ((existing && existing.viewerId!==viewerId && existing.ws.readyState===1) || streams.has(code)) return reject(409);
  existing?.ws.close(1000,'새 연결로 전환');
  wss.handleUpgrade(req,socket,head,ws=>{
    const entry={ws,viewerId};sockets.set(code,entry);ws.send(JSON.stringify(room.packet));
    ws.on('message',message=>{if(message.toString()==='ping')ws.send('pong');else ws.close(1008,'표시 전용 연결입니다.');});
    ws.on('close',()=>{if(sockets.get(code)===entry)sockets.delete(code);});
    ws.on('error',()=>ws.close());
  });
});
server.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log(`COURTSIDE ready: http://localhost:${process.env.PORT || 3000}`));
