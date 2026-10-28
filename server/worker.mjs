// Single-owner planner. No registration endpoint and no public trip listing.
const encoder = new TextEncoder();
const SESSION_SECONDS = 12 * 3600;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_SHARES = 30;
export const hex = bytes => [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2, '0')).join('');
export const randomToken = () => hex(crypto.getRandomValues(new Uint8Array(32)));
export async function digest(value) { return hex(await crypto.subtle.digest('SHA-256', encoder.encode(value))); }
export async function passwordHash(password, salt = randomToken(), iterations = 100000) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({name:'PBKDF2', hash:'SHA-256', salt:encoder.encode(salt), iterations}, key, 256);
  return `pbkdf2$${iterations}$${salt}$${hex(bits)}`;
}
function equal(a, b) {
  let mismatch = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) mismatch |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return mismatch === 0;
}
export async function verifyPassword(password, stored) {
  const [kind, iterations, salt, hash] = String(stored || '').split('$');
  if (kind !== 'pbkdf2' || !salt || !hash || Number(iterations) !== 100000) return false;
  return equal(await passwordHash(password, salt, Number(iterations)), stored);
}
function fail(status, message) { throw Object.assign(new Error(message), {status}); }
function text(value, max = 1000) { return typeof value === 'string' ? value.slice(0, max) : ''; }
export function sanitize(value) {
  return JSON.parse(JSON.stringify(value, (key, item) =>
    key==='key'&&['itinerary','list','settlement','preparation','materials'].includes(item)?item:/^(?:key|api[_-]?key|access[_-]?token|secret|password|authorization)$/i.test(key) ? '' : item));
}
export function validateBook(book) {
  if (!book || !Array.isArray(book.trips) || book.trips.length > 100) fail(400, '여행 데이터 형식을 확인해 주세요.');
  const ids = new Set();
  for (const trip of book.trips) {
    if (typeof trip.id !== 'string' || ids.has(trip.id) || !trip.data?.settings ||
        !Array.isArray(trip.data.days) || !trip.data.days.length || trip.data.days.length > 90 ||
        !trip.data.days.every(day => Array.isArray(day) && day.length <= 500 && day.every(s => s && typeof s === 'object')) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(trip.start) || !/^\d{4}-\d{2}-\d{2}$/.test(trip.end)) fail(400, '여행 데이터 형식을 확인해 주세요.');
    ids.add(trip.id);
  }
  return sanitize(book);
}
// Explicit public fields: no expense details, members, files, source URLs or private notes.
export function shareSnapshot(trip, choices = {}) {
  const stops = trip.data.days.flat();
  const allowedTabs=['itinerary','list','settlement','preparation','materials'];
  const options={tabs:Array.isArray(choices.tabs)?[...new Set(choices.tabs.filter(key=>allowedTabs.includes(key)))]:['itinerary','list'],notes:choices.notes===true,costs:choices.costs===true,members:choices.members===true,map:choices.map!==false};
  if(!options.tabs.length)fail(400,'공유할 탭을 하나 이상 선택해 주세요.');
  if(options.tabs.includes('settlement'))options.costs=true;
  const pick=(value,keys)=>Object.fromEntries(keys.filter(key=>value?.[key]!==undefined).map(key=>[key,value[key]]));
  const expense=e=>pick(e,['id','name','category','currency','actual','amount','planned','scope','amountBasis','peopleSnapshot','payerId','splitIds','reimbursedIds','allocationConfirmed','settlementStatus','stopIds']);
  const data={version:2,settings:pick(trip.data.settings,['people','travelCurrency','currencyRates','rate']),expenses:options.costs?(trip.data.expenses||[]).map(expense):[]};
  data.settings.budget=options.costs?Number(trip.data.settings.budget)||0:0;
  data.settings.members=(trip.data.settings.members||[]).map((member,index)=>({id:member.id,name:options.members?text(member.name,40):'여행자 '+(index+1),active:member.active,...(options.members&&typeof member.photo==='string'&&member.photo.length<=60000&&/^data:image\/(jpeg|png|webp);base64,/.test(member.photo)?{photo:member.photo}:{})}));
  data.days=trip.data.days.map(day=>day.map(stop=>{
    const item=pick(stop,['id','name','category','time','startTime','endTime','timeUnset','startDate','endDate','stay','mode','minutes','segmentEnabled','manualRoute','lodgingStopId']);
    item.query=options.map?text(stop.query,1000):'';item.note=options.notes?text(stop.note,1000):'';
    item.currency=stop.currency||data.settings.travelCurrency||'KRW';item.amount=options.costs?(stop.amount??null):null;item.fare=options.costs?(stop.fare??null):null;
    if(options.map){item.mapsUrl=text(stop.mapsUrl,4096);if(stop.placeQuery===stop.query&&Number.isFinite(stop.chosenPlace?.lat)&&Number.isFinite(stop.chosenPlace?.lng)){item.chosenPlace=pick(stop.chosenPlace,['id','lat','lng','name','address','url']);item.placeQuery=item.query;}}
    item.costItems=options.costs?(stop.costItems||[]).map(expense):[];
    if(options.costs){Object.assign(item,pick(stop,['actualFare','actualFareCurrency','fareCurrency']));if(stop.farePayment)item.farePayment=expense(stop.farePayment);}
    return item;
  }));
  data.preparation=options.tabs.includes('preparation')?(trip.data.preparation||[]).map(task=>({...pick(task,['id','title','status','category','emoji','color','checklist']),note:options.notes?text(task.note,1000):''})):[];
  data.resources=options.tabs.includes('materials')?(trip.data.resources||[]).map(resource=>({...pick(resource,['id','title','category','stopIds']),note:options.notes?text(resource.note,30000):'',references:(resource.references||[]).filter(link=>/^https?:\/\//i.test(link.url)).map(link=>pick(link,['id','url','title','previewMode']))})):[];
  const planner={...pick(trip,['title','location','start','end','viewMode','workspaceView','mapDisplay']),id:trip.id,data,workspaceTabs:allowedTabs.map(key=>({...pick((trip.workspaceTabs||[]).find(tab=>tab.key===key)||{},['emoji','label']),key,hidden:!options.tabs.includes(key)}))};
  const snapshot = {
    title: text(trip.title, 100), location: text(trip.location, 150), start:trip.start, end:trip.end,
    days: trip.data.days.map(day => day.map(stop => {
      const lodging = stop.lodgingStopId ? stops.find(item => item.id === stop.lodgingStopId && item.category === '숙소' && !item.lodgingStopId) : null;
      const source = lodging || stop;
      const point = source.placeQuery === source.query ? source.chosenPlace : null;
      return {
        name: text(stop.name, 300), category:text(stop.category, 80),
        startTime:stop.timeUnset ? '' : text(stop.startTime || stop.time, 5), endTime:stop.timeUnset ? '' : text(stop.endTime, 5),
        endDate:text(stop.endDate, 10),
        point: point && Number.isFinite(point.lat) && Number.isFinite(point.lng) && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180 ? {lat:point.lat, lng:point.lng} : null
      };
    }))
  };
  return {...snapshot,format:'sappun-share-v2',options,planner:sanitize(planner),updatedAt:Date.now()};
}
async function mapCipherKey(env) {
  return crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',encoder.encode('sappun-share-map:'+env.OWNER_PASSWORD_HASH)),{name:'AES-GCM'},false,['encrypt','decrypt']);
}
async function encryptMapKey(value,env) {
  if(typeof value!=='string'||!value||value.length>256)return '';
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},await mapCipherKey(env),encoder.encode(value));
  return hex(iv)+':'+hex(encrypted);
}
async function decryptMapKey(value,env) {
  try{const [iv,cipher]=value.split(':');const bytes=s=>new Uint8Array(s.match(/../g).map(part=>parseInt(part,16)));return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(iv)},await mapCipherKey(env),bytes(cipher)));}catch{return '';}
}
async function body(request) {
  if (Number(request.headers.get('Content-Length')) > MAX_BYTES) fail(413, '저장할 데이터가 너무 커요. 첨부파일은 제외해 주세요.');
  const reader = request.body?.getReader();
  if (!reader) fail(400, '요청 내용을 확인해 주세요.');
  const chunks = []; let size = 0;
  while (true) {
    const {value, done} = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) { await reader.cancel(); fail(413, '저장할 데이터가 너무 커요.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { fail(400, '요청 내용을 확인해 주세요.'); }
}
async function throttle(env, key, now, limit = 10) {
  const bucket = `${await digest(key)}:${Math.floor(now / 900)}`;
  const row = await env.DB.prepare('INSERT INTO attempts(bucket,count,expires_at) VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1 RETURNING count').bind(bucket, now + 1800).first();
  if (row.count > limit) fail(429, '여러 번 시도했어요. 15분 뒤 다시 입력해 주세요.');
}
function allowedMapsUrl(value) {
  let url;try {url=new URL(value);}catch {fail(400,'Google 지도 공유 링크를 확인해 주세요.');}
  if(url.protocol!=='https:'||url.username||url.password||url.port)fail(400,'Google 지도 공유 링크를 확인해 주세요.');
  const host=url.hostname.toLowerCase();
  if(host==='maps.app.goo.gl')return url;
  if(host==='goo.gl'&&/^\/maps(?:\/|$)/.test(url.pathname))return url;
  if(['google.com','www.google.com','maps.google.com','google.co.jp','www.google.co.jp','maps.google.co.jp','google.co.kr','www.google.co.kr','maps.google.co.kr'].includes(host)&&(/^\/maps(?:\/|$)/.test(url.pathname)||host.startsWith('maps.')))return url;
  fail(400,'Google 지도 장소 링크만 가져올 수 있어요.');
}
export async function resolveGoogleMapsLink(value, fetcher = fetch) {
  if(typeof value!=='string'||value.length>4096)fail(400,'Google 지도 공유 링크를 확인해 주세요.');
  let url=allowedMapsUrl(value);
  for(let index=0;index<5;index++) {
    if(!['maps.app.goo.gl','goo.gl'].includes(url.hostname))return url.href;
    const response=await fetcher(url.href,{redirect:'manual',headers:{'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36'},signal:AbortSignal.timeout(2500)});
    const location=response.headers.get('location');await response.body?.cancel();
    if(response.status<300||response.status>=400||!location)fail(422,'이 공유 링크에서 장소를 찾지 못했어요. Google 지도의 장소 공유 링크를 다시 복사해 주세요.');
    url=allowedMapsUrl(new URL(location,url).href);
  }
  fail(422,'공유 링크가 여러 번 연결돼요. 장소 이름이나 긴 지도 주소를 입력해 주세요.');
}
async function bearer(request) {
  const token = request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!token) fail(401, '로그인이 필요해요.');
  return digest(token);
}
async function owner(request, env, now) {
  const hash = await bearer(request);
  const session = await env.DB.prepare('SELECT expires_at FROM sessions WHERE token_hash=?').bind(hash).first();
  if (!session || session.expires_at <= now) fail(401, '로그인 시간이 지났어요. 다시 로그인해 주세요.');
  return hash;
}
async function liveShare(env, id, now) {
  if (!/^[a-f0-9]{64}$/.test(id)) fail(404, '공유 링크를 확인해 주세요.');
  const share = await env.DB.prepare('SELECT * FROM shares WHERE id=?').bind(id).first();
  if (!share || share.revoked || share.expires_at <= now) fail(410, '공유가 종료되었거나 만료되었어요.');
  return share;
}
async function route(request, env, now) {
  const path = new URL(request.url).pathname;
  const method = request.method;
  if (path === '/api/maps/resolve' && method === 'POST') {
    await throttle(env, `map-link:${request.headers.get('CF-Connecting-IP') || 'unknown'}`, now, 60);
    const input=await body(request);
    return {url:await resolveGoogleMapsLink(input.url)};
  }
  if (path === '/api/login' && method === 'POST') {
    await throttle(env, `login:${request.headers.get('CF-Connecting-IP') || 'unknown'}`, now);
    const input = await body(request);
    if (typeof input.password !== 'string' || input.password.length > 256 ||
        !await verifyPassword(input.password, env.OWNER_PASSWORD_HASH) || !equal(text(input.username, 100), env.OWNER_USERNAME)) fail(401, '아이디 또는 비밀번호를 확인해 주세요.');
    const token = randomToken();
    await env.DB.prepare('INSERT INTO sessions(token_hash,expires_at) VALUES (?,?)').bind(await digest(token), now + SESSION_SECONDS).run();
    return {token};
  }
  const shared = path.match(/^\/api\/shared\/([a-f0-9]+)(\/unlock)?$/);
  if (shared) {
    const [, id, unlock] = shared;
    if (unlock && method === 'POST') {
      await throttle(env, `share:${id}:${request.headers.get('CF-Connecting-IP') || 'unknown'}`, now);
      const share = await liveShare(env, id, now), input = await body(request);
      if (typeof input.password !== 'string' || input.password.length > 256 || !await verifyPassword(input.password, share.password_hash)) fail(401, '비밀번호를 확인해 주세요.');
      const token = randomToken();
      await env.DB.prepare('INSERT INTO share_sessions(token_hash,share_id,expires_at) VALUES (?,?,?)').bind(await digest(token), id, Math.min(share.expires_at, now + 3600)).run();
      return {token};
    }
    if (!unlock && method === 'GET') {
      const hash = await bearer(request);
      const session = await env.DB.prepare('SELECT * FROM share_sessions WHERE token_hash=? AND share_id=?').bind(hash, id).first();
      if (!session || session.expires_at <= now) fail(401, '비밀번호를 다시 입력해 주세요.');
      const share = await liveShare(env, id, now);
      const snapshot=JSON.parse(share.payload),cipher=snapshot._mapCipher;delete snapshot._mapCipher;delete snapshot._passwordCipher;
      const mapKey=snapshot.options?.map===false?'':(cipher?await decryptMapKey(cipher,env):env.MAPS_BROWSER_KEY||'');
      return {trip:snapshot, expiresAt:share.expires_at, mapKey};
    }
    fail(405, '읽기만 가능한 공유예요.');
  }
  const tokenHash = await owner(request, env, now);
  if (path === '/api/logout' && method === 'POST') {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(tokenHash).run(); return {ok:true};
  }
  if (path === '/api/book' && method === 'GET') {
    const book = await env.DB.prepare('SELECT * FROM books WHERE id=1').first();
    return {book:book ? JSON.parse(book.payload) : null, revision:book?.revision || 0, mapKey:env.MAPS_BROWSER_KEY || ''};
  }
  if (path === '/api/book' && method === 'PUT') {
    const input = await body(request), book = validateBook(input.book);
    if (!Number.isInteger(input.revision) || input.revision < 0) fail(400, '저장 버전을 확인해 주세요.');
    // Atomic compare-and-swap prevents two tabs or devices silently overwriting a newer book.
    const result = input.revision === 0
      ? await env.DB.prepare('INSERT OR IGNORE INTO books(id,payload,revision) VALUES (1,?,1)').bind(JSON.stringify(book)).run()
      : await env.DB.prepare('UPDATE books SET payload=?,revision=revision+1 WHERE id=1 AND revision=?').bind(JSON.stringify(book), input.revision).run();
    if (result.meta.changes !== 1) fail(409, '다른 화면에서 수정했어요. 서버 일정을 다시 불러와 주세요.');
    return {revision:input.revision + 1};
  }
  if (path === '/api/shares' && method === 'GET') {
    const result = await env.DB.prepare('SELECT id,title,expires_at,revoked,created_at,payload FROM shares WHERE revoked=0 AND expires_at>? ORDER BY created_at DESC').bind(now).all(); return {shares:result.results.map(row=>{const snapshot=JSON.parse(row.payload);const {payload,...item}=row;return {...item,tripId:snapshot.planner?.id,options:snapshot.options,hasPassword:!!snapshot._passwordCipher};})};
  }
  if (path === '/api/shares' && method === 'POST') {
    const input = await body(request);
    if (typeof input.password !== 'string' || input.password.length < 8 || input.password.length > 128) fail(400, '공유 비밀번호는 8~128자로 입력해 주세요.');
    if (!Number.isInteger(input.expiresAt) || input.expiresAt <= now || input.expiresAt > now + 90*86400) fail(400, '만료일은 현재부터 90일 이내로 정해 주세요.');
    const count = await env.DB.prepare('SELECT count(*) AS n FROM shares WHERE revoked=0 AND expires_at>?').bind(now).first();
    if (count.n >= MAX_SHARES) fail(400, '활성 공유는 최대 30개예요. 이전 공유를 취소해 주세요.');
    const saved = await env.DB.prepare('SELECT payload FROM books WHERE id=1').first();
    const trip = saved && JSON.parse(saved.payload).trips.find(t => t.id === input.tripId);
    if (!trip) fail(404, '여행을 먼저 서버에 저장해 주세요.');
    const snapshot = shareSnapshot(trip,input.options), id = randomToken();
    if(snapshot.options.map)snapshot._mapCipher=await encryptMapKey(input.mapKey||env.MAPS_BROWSER_KEY||'',env);
    snapshot._passwordCipher=await encryptMapKey(input.password,env);
    await env.DB.prepare('INSERT INTO shares(id,title,payload,password_hash,expires_at,created_at) VALUES (?,?,?,?,?,?)').bind(id, snapshot.title, JSON.stringify(snapshot), await passwordHash(input.password), input.expiresAt, now).run();
    return {id};
  }
  const revoke = path.match(/^\/api\/shares\/([a-f0-9]{64})$/);
  const sharePassword=path.match(/^\/api\/shares\/([a-f0-9]{64})\/password$/);
  if(sharePassword&&(method==='GET'||method==='PUT')) {
    const item=await liveShare(env,sharePassword[1],now),snapshot=JSON.parse(item.payload);
    if(method==='GET')return {password:snapshot._passwordCipher?await decryptMapKey(snapshot._passwordCipher,env):null};
    const input=await body(request);
    if(typeof input.password!=='string'||input.password.length<8||input.password.length>128)fail(400,'공유 비밀번호는 8~128자로 입력해 주세요.');
    snapshot._passwordCipher=await encryptMapKey(input.password,env);
    await env.DB.batch([
      env.DB.prepare('UPDATE shares SET password_hash=?,payload=? WHERE id=?').bind(await passwordHash(input.password),JSON.stringify(snapshot),sharePassword[1]),
      env.DB.prepare('DELETE FROM share_sessions WHERE share_id=?').bind(sharePassword[1])
    ]);return {ok:true};
  }
  if(revoke&&method==='PATCH') {
    const input=await body(request),existing=await env.DB.prepare('SELECT id,payload FROM shares WHERE id=? AND revoked=0').bind(revoke[1]).first();
    if(!existing)fail(404,'공유 링크를 찾지 못했어요.');
    const saved=await env.DB.prepare('SELECT payload FROM books WHERE id=1').first();
    const trip=saved&&JSON.parse(saved.payload).trips.find(item=>item.id===input.tripId);
    if(!trip)fail(404,'공유할 여행을 확인해 주세요.');
    const snapshot=shareSnapshot(trip,input.options);
    snapshot._passwordCipher=JSON.parse(existing.payload)._passwordCipher||'';
    if(snapshot.options.map)snapshot._mapCipher=await encryptMapKey(input.mapKey||env.MAPS_BROWSER_KEY||'',env);
    await env.DB.prepare('UPDATE shares SET title=?,payload=? WHERE id=?').bind(snapshot.title,JSON.stringify(snapshot),revoke[1]).run();return {id:revoke[1]};
  }
  if (revoke && method === 'DELETE') {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM shares WHERE id=?').bind(revoke[1]),
      env.DB.prepare('DELETE FROM share_sessions WHERE share_id=?').bind(revoke[1])
    ]); return {ok:true};
  }
  fail(404, '요청한 기능이 없어요.');
}
export default {
  async fetch(request, env, context) {
    const origin = request.headers.get('Origin');
    const headers = {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'Vary':'Origin', 'X-Content-Type-Options':'nosniff'};
    const localMapLink = new URL(request.url).pathname === '/api/maps/resolve' && (origin === 'null' || /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(origin || ''));
    const allowedOrigin = origin === env.APP_ORIGIN || localMapLink;
    if (allowedOrigin) Object.assign(headers, {'Access-Control-Allow-Origin':origin, 'Access-Control-Allow-Methods':localMapLink?'POST,OPTIONS':'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'Access-Control-Allow-Headers':'Content-Type,Authorization', 'Access-Control-Max-Age':'600'});
    if (!env.APP_ORIGIN || !env.DB || !env.OWNER_PASSWORD_HASH || !env.OWNER_USERNAME) return new Response(JSON.stringify({error:'서버 설정을 완료해 주세요.'}), {status:503, headers});
    if (!allowedOrigin) return new Response(JSON.stringify({error:'허용되지 않은 접속 주소예요.'}), {status:403, headers});
    if (request.method === 'OPTIONS') return new Response(null, {status:204, headers});
    try { return new Response(JSON.stringify(await route(request, env, Math.floor(Date.now()/1000))), {headers}); }
    catch (error) { return new Response(JSON.stringify({error:error.status ? error.message : '서버에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.'}), {status:error.status || 500, headers}); }
  },
  async scheduled(event, env) {
    const now = Math.floor(Date.now()/1000);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE expires_at<=?').bind(now),
      env.DB.prepare('DELETE FROM share_sessions WHERE expires_at<=?').bind(now),
      env.DB.prepare('DELETE FROM attempts WHERE expires_at<=?').bind(now),
      env.DB.prepare('DELETE FROM shares WHERE expires_at<=? OR revoked=1').bind(now)
    ]);
  }
};
