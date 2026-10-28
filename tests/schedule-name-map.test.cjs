const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const src = fs.readFileSync(path.join(__dirname, '../js/travel-planner.js'), 'utf8');
const source = src.slice(src.indexOf('let mapFocusRequest = 0;'), src.indexOf('document.addEventListener("click", (e) => {', src.indexOf('let mapFocusRequest = 0;')));
const stops = [{id:'a',query:'Place A'}, {id:'b',query:'Place B'}, {id:'missing',query:'',locationNote:'집합 장소 확인 필요'}];
const draws = [], warnings = [], pending = [];
const trip = {viewMode:'list'};
const ctx = vm.createContext({
  state:{days:[stops]}, day:0, selected:0, currentTripId:'trip', homeOpen:false,
  gmap:{}, activeScheduleCard:null, requestedMapFocus:null,
  trip:()=>trip, mapDisplay:()=>({}), save(){}, render(){},
  requestAnimationFrame:fn=>fn(), $:()=>({scrollIntoView(){}}),
  savedPoint:s=>s.placeQuery===s.query?s.chosenPlace:null,
  resolvePlace:s=>new Promise(resolve=>pending.push({id:s.id,resolve})),
  drawGoogle:async()=>draws.push(ctx.requestedMapFocus.stopId),
  toast:message=>warnings.push(message)
});
vm.runInContext(source,ctx);
module.exports = (async()=>{
  const first=ctx.focusCard(0);
  assert.equal(trip.viewMode,'map');
  pending.shift().resolve({lat:34,lng:135}); await first;
  assert.deepEqual(draws,['a']); assert.equal(stops[0].placeQuery,'Place A');
  await ctx.focusCard(0); assert.equal(draws.length,2,'cached place focuses without another lookup');
  await ctx.focusCard(2); assert.match(warnings[0],/집합 장소/);
  stops[0].chosenPlace=null;
  const old=ctx.focusCard(0), newer=ctx.focusCard(1);
  pending.find(p=>p.id==='b').resolve({lat:35,lng:136}); await newer;
  pending.find(p=>p.id==='a').resolve({lat:34,lng:135}); await old;
  assert.equal(draws.at(-1),'b'); assert.equal(draws.length,3,'late lookup cannot override the newer click');
  console.log('PASS: name focus resolves uncached places, reuses saved positions, handles missing locations, and ignores stale results.');
})();
