// Optional real-browser check: set SAPPUN_PLAYWRIGHT_MODULE to an installed Playwright entry.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {readFile, mkdir} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import worker, {passwordHash} from '../server/worker.mjs';
const {chromium} = await import(process.env.SAPPUN_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.SAPPUN_PLAYWRIGHT_MODULE).href : 'playwright');
const root = resolve(import.meta.dirname,'..');
const sql = new DatabaseSync(':memory:');
sql.exec(await readFile(resolve(root,'server/schema.sql'),'utf8'));
const DB = {
  prepare(statement) {let values=[];return {
    bind(...args){values=args;return this;},async first(){return sql.prepare(statement).get(...values)||null;},
    async all(){return {results:sql.prepare(statement).all(...values)};},async run(){return {meta:{changes:sql.prepare(statement).run(...values).changes}};}
  };},async batch(statements){const out=[];for(const item of statements)out.push(await item.run());return out;}
};
const env={DB,OWNER_USERNAME:'owner',OWNER_PASSWORD_HASH:await passwordHash('owner-test-password')};
let base;
const server = createServer(async (req,res) => {
  try {
    const url = new URL(req.url,base);
    if (url.pathname.startsWith('/api/')) {
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      // Production uses cross-origin GitHub Pages -> Workers, which supplies Origin on GET too.
      const request=new Request(url,{method:req.method,headers:{...req.headers,origin:req.headers.origin||base},...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})});
      const response=await worker.fetch(request,env,{});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
    }
    if(url.pathname==='/js/cloud-config.js'){res.setHeader('Content-Type','text/javascript');res.end(`window.SAPPUN_CLOUD={apiBase:${JSON.stringify(base)}};`);return;}
    const file=resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/travel-planner.html':url.pathname));
    if(!file.startsWith(root+sep)||!['.html','.js','.css'].includes(extname(file))){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type',{'.html':'text/html','.js':'text/javascript','.css':'text/css'}[extname(file)]);
    res.end(await readFile(file));
  }catch {res.writeHead(500);res.end('test server error');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port;env.APP_ORIGIN=base;
let browser;
try {
  browser = await chromium.launch({headless:true,...(process.env.SAPPUN_BROWSER_CHANNEL?{channel:process.env.SAPPUN_BROWSER_CHANNEL}:{})});
  const context = await browser.newContext({viewport:{width:390,height:844}});
  await context.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.abort());
  const page = await context.newPage(), errors=[];page.on('pageerror',err=>errors.push(err.message));
  await page.goto(base+'/travel-planner.html');
  await page.getByLabel('아이디',{exact:true}).fill('owner');await page.getByLabel('비밀번호',{exact:true}).fill('owner-test-password');
  await page.getByRole('button',{name:'로그인',exact:true}).click();
  try {await page.locator('#cloud-gate').waitFor({state:'hidden',timeout:10000});}
  catch(error){console.error('Browser errors:',errors,'Gate:',await page.locator('#cloud-gate').innerText());throw error;}
  await page.evaluate(()=>{
    const data=newTripData(2);data.days[0].push({id:'fixture-stop',name:'공유할 테스트 장소',query:'fixture',note:'공유하지 않을 메모',time:'09:00',startTime:'09:00',endTime:'11:00',category:'관광',currency:'KRW',amount:null,minutes:null,fare:null,chosenPlace:{lat:35,lng:135},placeQuery:'fixture'});
    tripBook.trips.push({id:'browser-fixture',title:'브라우저 테스트 여행',location:'테스트 도시',start:'2027-01-01',end:'2027-01-02',data});save();openTrip('browser-fixture');
  });
  await page.waitForFunction(()=>document.querySelector('.cloud-status')?.textContent==='서버에 저장됨');
  await page.getByLabel('여행 메뉴').click();await page.getByRole('button',{name:'공유',exact:true}).click();
  await page.getByLabel('친구에게 알려줄 비밀번호 (8자 이상)').fill('friend-test-password');
  await page.getByRole('button',{name:'공유 링크 만들기'}).click();
  const link = page.locator('.cloud-share-result p');await link.waitFor();const shareUrl=await link.textContent();
  assert.match(shareUrl,/\?share=[a-f0-9]{64}/);
  await mkdir(resolve(root,'output'),{recursive:true});await page.screenshot({path:resolve(root,'output/cloud-share-mobile.png')});
  const friendContext = await browser.newContext({viewport:{width:390,height:844}});
  await friendContext.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.abort());
  await friendContext.addInitScript(()=>{const previous=window.setInterval;window.setInterval=(fn,ms,...args)=>previous(fn,ms===30000?250:ms,...args);});
  const friend = await friendContext.newPage();friend.on('pageerror',err=>errors.push(err.message));
  const ownerRequests=[];friend.on('request',request=>{if(/\/api\/(?:book|shares|login)/.test(request.url()))ownerRequests.push(request.url());});
  await friend.goto(shareUrl);await friend.getByLabel('공유 비밀번호').fill('friend-test-password');
  await friend.getByRole('button',{name:'일정 보기',exact:true}).click();await friend.getByText('공유할 테스트 장소',{exact:true}).waitFor();
  assert.equal(await friend.getByText('공유하지 않을 메모').count(),0);
  assert.equal(await friend.locator('.shared-stop').count(),1);
  await friend.getByRole('button',{name:/Day 1/}).click();await friend.getByRole('button',{name:/D2 ·/}).click();
  await friend.getByText('아직 일정이 없어요.',{exact:true}).waitFor();
  await friend.screenshot({path:resolve(root,'output/cloud-friend-mobile.png')});
  await friend.getByRole('button',{name:'이전 날짜'}).click();
  await page.getByRole('button',{name:'공유 취소',exact:true}).click();
  await friend.getByLabel('공유 비밀번호').waitFor();
  assert.equal(ownerRequests.length,0,'friend view never calls owner APIs');
  await page.getByRole('button',{name:'닫기',exact:true}).click();
  await page.reload();await page.locator('#cloud-gate').waitFor({state:'hidden'});
  await page.getByText('브라우저 테스트 여행',{exact:true}).waitFor();
  const pc=await browser.newPage({viewport:{width:1440,height:1000}});await pc.goto(base+'/travel-planner.html');
  await pc.getByLabel('아이디',{exact:true}).waitFor();await pc.screenshot({path:resolve(root,'output/cloud-login-desktop.png')});
  assert.deepEqual(errors,[]);
  console.log('PASS: mobile owner login, auto-save, share creation, friend password, date sheet, private-note exclusion, revocation, session reload and desktop gate.');
} finally {await browser?.close();server.close();sql.close();}
