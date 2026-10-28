import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker, {passwordHash, shareSnapshot, resolveGoogleMapsLink} from '../server/worker.mjs';

// Real SQLite exercises D1 SQL and compare-and-swap, not a canned HTTP response mock.
const sqlite = new DatabaseSync(':memory:');
sqlite.exec(readFileSync(new URL('../server/schema.sql',import.meta.url),'utf8'));
const DB = {
  prepare(sql) {
    let values = [];
    return {
      bind(...args) {values = args;return this;},
      async first() {return sqlite.prepare(sql).get(...values) || null;},
      async all() {return {results:sqlite.prepare(sql).all(...values)};},
      async run() {const result=sqlite.prepare(sql).run(...values);return {meta:{changes:result.changes}};}
    };
  },
  async batch(statements) {sqlite.exec('BEGIN');try{const result=[];for(const statement of statements)result.push(await statement.run());sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}}
};
const origin = 'https://test.example';
const env = {DB,APP_ORIGIN:origin,OWNER_USERNAME:'owner',OWNER_PASSWORD_HASH:await passwordHash('owner-test-password')};
async function request(path,{method='GET',body,token,requestOrigin=origin,ip='127.0.0.1'}={}) {
  const headers = {'Origin':requestOrigin,'CF-Connecting-IP':ip};
  if(token)headers.Authorization='Bearer '+token;
  if(body)headers['Content-Type']='application/json';
  const response = await worker.fetch(new Request('https://api.example'+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})}),env,{});
  return {status:response.status,headers:response.headers,data:response.status===204?null:await response.json()};
}
assert.equal((await request('/api/book')).status,401);
assert.equal((await request('/api/book',{requestOrigin:'https://untrusted.example'})).status,403);
assert.equal((await request('/api/book',{requestOrigin:'http://localhost:5500'})).status,403,'local map access never grants private book access');
assert.equal((await request('/api/maps/resolve',{method:'OPTIONS',requestOrigin:'http://localhost:5500'})).status,204);
assert.equal((await request('/api/maps/resolve',{method:'OPTIONS',requestOrigin:'null'})).status,204);
assert.equal((await request('/api/maps/resolve',{method:'POST',body:{url:'http://127.0.0.1/secret'}})).status,400);
assert.equal((await request('/api/book',{method:'OPTIONS'})).status,204);
assert.equal((await request('/api/login',{method:'POST',body:{username:'owner',password:'wrong'}})).status,401);
const login = await request('/api/login',{method:'POST',body:{username:'owner',password:'owner-test-password'}});
assert.equal(login.status,200); const owner = login.data.token;
assert.equal((await request('/api/book',{token:owner})).data.book,null);
const point = {lat:35,lng:135};
const book={version:3,key:'test-map-key',trips:[{id:'test-trip',title:'공유 테스트',location:'테스트 도시',start:'2027-01-01',end:'2027-01-01',data:{settings:{people:1,key:'test-map-key'},members:['private-member'],expenses:[{name:'private-expense'}],days:[[
  {id:'hotel',name:'테스트 숙소',category:'숙소',query:'test',placeQuery:'test',chosenPlace:point,startTime:'09:00',endTime:'11:00',note:'private-note',files:['private-file']},
  {id:'return',name:'숙소 복귀',category:'숙소',lodgingStopId:'hotel',timeUnset:true},
  {id:'stale',name:'위치 수정한 일정',query:'new',placeQuery:'old',chosenPlace:point}
]]}}]};
assert.equal((await request('/api/book',{method:'PUT',token:owner,body:{book,revision:0}})).status,200);
const loaded = await request('/api/book',{token:owner});
assert.equal(loaded.data.book.key,'');assert.equal(loaded.data.book.trips[0].data.settings.key,'');
assert.equal((await request('/api/book',{method:'PUT',token:owner,body:{book,revision:0}})).status,409);
assert.equal((await request('/api/book',{method:'PUT',token:owner,body:{book,revision:1}})).data.revision,2);
assert.equal((await request('/api/shares',{method:'POST',token:owner,body:{tripId:'test-trip',password:'short',expiresAt:Math.floor(Date.now()/1000)+3600}})).status,400);
const create = await request('/api/shares',{method:'POST',token:owner,body:{tripId:'test-trip',password:'test-share-pass',expiresAt:Math.floor(Date.now()/1000)+3600}});
assert.equal(create.status,200);const id = create.data.id;
assert.equal((await request('/api/shared/'+id)).status,401);
assert.equal((await request('/api/shared/'+id,{token:owner})).status,401,'owner token is not a friend token');
assert.equal((await request('/api/shared/'+id+'/unlock',{method:'POST',body:{password:'wrong'}})).status,401);
const unlocked = await request('/api/shared/'+id+'/unlock',{method:'POST',body:{password:'test-share-pass'}});
assert.equal(unlocked.status,200);const friend = unlocked.data.token;
const view = await request('/api/shared/'+id,{token:friend});
assert.equal(view.status,200);assert.equal(view.headers.get('Cache-Control'),'no-store');
assert.deepEqual(view.data.trip.days[0][0].point,point);assert.deepEqual(view.data.trip.days[0][1].point,point);
assert.equal(view.data.trip.days[0][2].point,null,'stale search results never shared');
assert.doesNotMatch(JSON.stringify(view.data),/private-note|private-expense|private-file|private-member|test-map-key/);
assert.equal((await request('/api/book',{token:friend})).status,401);
assert.equal((await request('/api/shares',{token:friend})).status,401);
assert.equal((await request('/api/shared/'+id,{method:'PUT',token:friend,body:{name:'edit'}})).status,405);
const changed = structuredClone(book);changed.trips[0].title='바뀐 이름';
await request('/api/book',{method:'PUT',token:owner,body:{book:changed,revision:2}});
assert.equal((await request('/api/shared/'+id,{token:friend})).data.trip.title,'바뀐 이름','shared trip follows the latest saved itinerary');
assert.equal((await request('/api/shares/'+id,{method:'DELETE',token:owner})).status,200);
assert.equal((await request('/api/shared/'+id,{token:friend})).status,401,'revocation invalidates existing sessions');
assert.equal((await request('/api/shared/'+id+'/unlock',{method:'POST',body:{password:'test-share-pass'}})).status,410);
const expiring = await request('/api/shares',{method:'POST',token:owner,body:{tripId:'test-trip',password:'test-share-pass',expiresAt:Math.floor(Date.now()/1000)+3600}});
const unlocked2 = await request('/api/shared/'+expiring.data.id+'/unlock',{method:'POST',body:{password:'test-share-pass'}});
sqlite.prepare('UPDATE shares SET expires_at=0 WHERE id=?').run(expiring.data.id);
assert.equal((await request('/api/shared/'+expiring.data.id,{token:unlocked2.data.token})).status,410);
for(let i=0;i<10;i++)assert.equal((await request('/api/login',{method:'POST',body:{username:'owner',password:'wrong'},ip:'other-client'})).status,401);
assert.equal((await request('/api/login',{method:'POST',body:{username:'owner',password:'wrong'},ip:'other-client'})).status,429);
await worker.scheduled({},env);
assert.equal(sqlite.prepare('SELECT count(*) AS n FROM shares').get().n,0);
assert.equal((await request('/api/logout',{method:'POST',token:owner})).status,200);
assert.equal((await request('/api/book',{token:owner})).status,401);
assert.deepEqual(shareSnapshot(book.trips[0]).days[0][1].point,point);
const longMap='https://www.google.com/maps/place/Test/data=!3d35!4d135';
const resolved=await resolveGoogleMapsLink('https://maps.app.goo.gl/test',async()=>new Response(null,{status:302,headers:{location:longMap}}));
assert.equal(resolved,longMap);
let requests=0;
await assert.rejects(()=>resolveGoogleMapsLink('https://maps.app.goo.gl/test',async()=>{requests++;return new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}});}),/Google 지도/);
assert.equal(requests,1,'untrusted redirect is never fetched');
await assert.rejects(()=>resolveGoogleMapsLink('https://google.com.evil.example/maps/place/Test'),/Google 지도/);
await assert.rejects(()=>resolveGoogleMapsLink('https://user:pass@www.google.com/maps/place/Test'),/Google 지도/);
await assert.rejects(()=>resolveGoogleMapsLink('https://maps.app.goo.gl/test',async()=>new Response(null,{status:200})),/공유 링크/);
let redirects=0;
await assert.rejects(()=>resolveGoogleMapsLink('https://maps.app.goo.gl/test',async()=>{redirects++;return new Response(null,{status:302,headers:{location:'https://maps.app.goo.gl/loop'}});}),/여러 번/);
assert.equal(redirects,5,'redirect loops stop after five requests');
sqlite.close();
console.log('PASS: owner login, private sync, conflict protection, password sharing, read-only permissions, privacy, expiry, revocation, and rate limiting.');
