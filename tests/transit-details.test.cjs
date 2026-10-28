const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../js/travel-planner.js'),'utf8'),requests=[];
const bus={durationMillis:13*60000,distanceMeters:2500,legs:[{steps:[{travelMode:'WALKING',staticDurationMillis:120000,navigationInstruction:{instructions:'정류장까지 이동'}},{travelMode:'TRANSIT',staticDurationMillis:660000,transitDetails:{transitLine:{nameShort:'702A',name:'서울 버스'},departureStop:{name:'서울역버스환승센터'},arrivalStop:{name:'정동길'},headsign:'서오릉',stopCount:4,localizedValues:{departureTime:{time:{text:'15:26'}}}}}]}],path:[{lat:37,lng:127},{lat:37.1,lng:127.1}]};
const schedule=new Date('2026-12-11T08:00:00+09:00');
const ctx=vm.createContext({Date,Intl,state:{settings:{key:'test'}},gmap:{},routeMoney:()=>null,departAt:()=>schedule,hasStopTime:()=>true,resolvePlace:async stop=>({lat:37,lng:127,name:stop.name,address:'서울 대한민국'}),google:{maps:{importLibrary:async()=>({Route:{computeRoutes:async request=>{requests.push(request);return {routes:[{...bus,durationMillis:24*60000},bus]};}}})}}});
vm.runInContext(source.slice(source.indexOf('function extractRoute('),source.indexOf('async function getLeg(')),ctx);
module.exports=(async()=>{
  const result=await ctx.lookupSegmentRoute(0,{name:'서울역'},{name:'정동길'},'대중교통');
  assert.equal(result.minutes,24,'keep provider order rather than silently choosing or fabricating a duration');assert.equal(result.alternatives[1].minutes,13);assert.equal(requests[0].computeAlternativeRoutes,true);assert.equal(requests[0].departureTime,schedule);assert.match(result.departureLabel,/2026-12-11 08:00/);
  assert.equal(result.steps[1].line,'702A');assert.equal(result.steps[1].from,'서울역버스환승센터');assert.equal(result.steps[1].to,'정동길');assert.equal(result.steps[1].headsign,'서오릉');assert.equal(result.steps[1].stopCount,4);assert.equal(result.steps[1].departureText,'15:26');
  assert.doesNotThrow(()=>JSON.stringify(result),'alternative routes remain serializable');
  await ctx.lookupSegmentRoute(0,{name:'서울역'},{name:'정동길'},'대중교통',{departureBasis:'now'});assert.ok(Math.abs(requests[1].departureTime-Date.now())<5000);
  console.log('PASS: transit lines, boarding/alighting stops, direction, stop count, alternative durations, explicit planned/current departure basis and serializable results.');
})();
