const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../js/travel-planner.js'), 'utf8');
const components = fs.readFileSync(path.join(__dirname, '../js/travel-components.js'), 'utf8');
const extract = (from, to) => source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)));
const reorderCode = extract('function reorderScheduleStop(', '\nfunction installScheduleReordering(');
const dialogCode = extract('function leg(i) {', '\nfunction editCostItem(');
function dialogHarness() {
  const nodes = new Map(); let submit; let calls = 0;
  function node() { return {value: '', textContent: '', innerHTML: '', hidden: false, disabled: false, isConnected: true, open: true,
    classList: {add() {}, remove() {}, toggle() {}},
    addEventListener() {}, removeEventListener() {},
  }; }
  const $ = selector => { if (!nodes.has(selector)) nodes.set(selector, node()); return nodes.get(selector); };
  $('.segment-route-search').parentElement = node();
  $('#f-mode').value = '도보'; $('#f-minutes').value = '30'; $('#f-actualfare').value = '250'; $('#f-farecurrency').value = 'JPY';
  const stops = [{id: 'a', name: 'Station', mode: '도보', minutes: 30, actualFare: 250, startTime:'10:00', endTime:'11:00'}, {id: 'b', name: 'Market', startTime: '11:45', endTime:'12:45'}];
  const cache = new Map();
  const ctx = vm.createContext({$, day: 0, currentTripId: 'trip', state: {days: [stops]},
    TravelComponents: {choices: () => ''}, modes: ['대중교통','도보','택시','투어 버스'],
    esc: s => String(s), input: () => '', select: () => '', n: v => v === '' ? null : Number(v),
    val: id => $('#f-'+id).value, effectiveLeg: () => ({minutes: 30}), travelCurrency: () => 'JPY',
    hasStopTime: () => true, stopEnd: s => s.endTime, stopStart:s=>s.startTime,
    tripDate:()=> '2026-12-11',trip:()=>({end:'2026-12-16'}),scheduleEndDate:s=>s.endDate||'2026-12-11',hasSegment:s=>s.segmentEnabled===true,
    resolveSegmentLocations:()=>{},toast(){},clockAdd: () => '11:08', route: a => 'https://maps.example/'+a.mode,
    modal: (html, fn) => {submit = fn;}, routeResults: cache, routeSignature: () => 'saved-route', allMapSignature: '',
    errorText: e => e.message, queueMicrotask,
    lookupSegmentRoute: async () => {calls++; return {status: 'ok', minutes: 8, distance: 600, steps: [{text: 'Turn right'}], fetched: Date.now()};},
  });
  vm.runInContext(extract('function syncFollowingSchedule(', '\nfunction legTimes(')+dialogCode, ctx); ctx.leg(0);
  return {ctx, nodes, $, stops, cache, submit: () => submit(), calls: () => calls};
}
(async () => {
  const ctx = vm.createContext({state: {days: [[{id:'a', minutes:10, actualFare:100}, {id:'b'}, {id:'c'}], [{id:'x'}]]}, day:0, selected:0, requestedMapFocus:null, allMapSignature:'old', save() {}, render() {}});
  vm.runInContext(reorderCode,ctx);
  const original = ctx.state.days[0][0];
  assert.equal(ctx.reorderScheduleStop(0,'a',3),true);
  assert.equal(ctx.state.days[0].map(x=>x.id).join(','),'b,c,a');
  assert.equal(ctx.state.days[0][2],original, 'preserves the item, time and expenses');
  assert.equal(ctx.reorderScheduleStop(0,'a',0),true);
  assert.equal(ctx.state.days[0].map(x=>x.id).join(','),'a,b,c');
  assert.equal(ctx.reorderScheduleStop(0,'a',1),false);
  assert.equal(ctx.reorderScheduleStop(0,'unknown',1),false);
  assert.equal(ctx.reorderScheduleStop(0,'b',-1),false);
  assert.equal(ctx.state.days[1][0].id,'x','other days stay intact');
  const c = vm.createContext({dayBackgrounds: []}); vm.runInContext(components,c);
  const card = vm.runInContext('TravelComponents.stopCard({index:0,id:"a",count:2,color:"#3182F6",name:"Market",start:"11:00",end:"11:30",costsHtml:""})',c);
  assert.match(card,/schedule-drag-handle/); assert.doesNotMatch(card,/data-move=/);
  const row=vm.runInContext('TravelComponents.stopRow({index:0,id:"a",day:0,date:"10.23",name:"Market",start:"11:00",end:"11:30",costsHtml:"",mapHtml:""})',c);
  assert.match(row,/schedule-drag-handle/); assert.match(row,/data-stop-id="a"/);
  let h=dialogHarness();assert.equal(h.$('#segment-expense-fields').hidden,true,'walking hides currency, fare and settlement controls');
  await h.$('#segment-route-search').onclick();
  assert.equal(h.calls(),1);
  assert.equal(h.$('#f-minutes').value,'30','lookup does not overwrite duration');
  assert.equal(h.stops[0].minutes,30,'lookup does not mutate saved stop');
  assert.equal(h.cache.size,0,'draft is not committed on lookup or cancel');
  assert.match(h.$('#segment-route-result').innerHTML,/8분/);
  h.$('#segment-route-apply').onclick();
  assert.equal(h.$('#f-minutes').value,8);
  assert.equal(h.stops[0].minutes,30,'applying only edits form until Save');
  h.submit();
  assert.equal(h.stops[0].minutes,8); assert.equal(h.stops[0].actualFare,250);
  assert.equal(h.stops[0].manualRoute,false); assert.equal(h.cache.size,1);
  assert.equal(h.stops[1].startTime,'11:08','saved duration sets the next arrival');
  assert.equal(h.stops[1].endTime,'12:08','preserves the next place stay');
  h=dialogHarness();
  let resolve;
  h.ctx.lookupSegmentRoute=()=>new Promise(r=>resolve=r);
  const pending=h.$('#segment-route-search').onclick();
  h.$('#f-mode').value='택시';
  resolve({minutes:99,distance:1000,steps:[]}); await pending;
  assert.equal(h.$('#segment-route-result').hidden,true,'late response for old mode ignored');
  assert.equal(h.$('#f-minutes').value,'30');
  h=dialogHarness();
  h.ctx.lookupSegmentRoute=async()=>{throw Error('API unavailable');};
  await h.$('#segment-route-search').onclick();
  assert.match(h.$('#segment-route-status').textContent,/API unavailable/);
  assert.equal(h.$('#segment-route-search').disabled,false);
  assert.equal(h.stops[0].minutes,30);

  const requests=[];
  const routeCtx=vm.createContext({state:{settings:{key:'test'}},gmap:{},hasStopTime:()=>true,departAt:()=>new Date(),
    resolvePlace:async()=>({lat:35,lng:139}),extractRoute:(r,mode)=>({mode,path:r.path}),
    google:{maps:{importLibrary:async()=>({Route:{computeRoutes:async request=>{requests.push(request);return {routes:[{path:[1,2,3]}]};}}})}},
  });
  vm.runInContext(extract('async function lookupSegmentRoute(', '\nasync function getLeg('),routeCtx);
  for(const [mode,apiMode] of [['도보','WALKING'],['택시','DRIVING'],['대중교통','TRANSIT']]) {
    await routeCtx.lookupSegmentRoute(0,{}, {},mode);
    assert.equal(requests.at(-1).travelMode,apiMode);
    assert.ok(requests.at(-1).fields.includes('path'));
    assert.equal('departureTime' in requests.at(-1),mode==='대중교통');
  }
  await assert.rejects(()=>routeCtx.lookupSegmentRoute(0,{}, {},'항공'),/직접 입력/);
  assert.equal(requests.length,3);await assert.rejects(()=>routeCtx.lookupSegmentRoute(0,{query:'関西国際空港 日本'},{query:'大阪市浪速区日本橋 日本'},'대중교통'),/일본 대중교통.*지원하지/);assert.equal(requests.length,3,'unsupported Japanese transit does not consume a route request');await routeCtx.lookupSegmentRoute(0,{query:'関西国際空港 日本'},{query:'大阪市浪速区日本橋 日本'},'택시');assert.equal(requests.at(-1).travelMode,'DRIVING','Japanese driving remains supported');
  console.log('PASS: stable reorder, draft lookup/apply/save, arrival time synchronization on save, stale responses, API errors, and travel modes.');
})().catch(error=>{console.error(error);process.exitCode=1;});
