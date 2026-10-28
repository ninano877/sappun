const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../js/travel-planner.js'),'utf8');
let draws=0,resizes=0,scrolls=0,closed=0;const embed={src:''},column={scrollIntoView(){scrolls++;}};
const prefs={},trip={viewMode:'list',workspaceView:'materials',location:'Osaka'},data={days:[[{id:'a',name:'Airport',query:'Kansai Airport Japan'}],[{id:'b',name:'Hotel',query:'Osaka Hotel Japan'}]]};
const ctx=vm.createContext({state:data,currentTripId:'trip',homeOpen:false,day:0,selected:0,requestedMapFocus:null,mapViewportSelection:'',allMapSignature:'',mapDisplay:()=>prefs,trip:()=>trip,gmap:null,save(){},render(){},closeDetail(){closed++;},requestAnimationFrame:fn=>fn(),toast(){},savedPoint:stop=>stop.chosenPlace,resolvePlace:async()=>({lat:34,lng:135}),google:{maps:{event:{trigger(){resizes++;}}}},drawGoogle:async()=>{draws++;},document:{addEventListener(){},querySelector:selector=>selector==='.mapcolumn'?column:embed}});
vm.runInContext(source.slice(source.indexOf('let scheduleMapRequest='),source.indexOf('function segmentBlock(')),ctx);
module.exports=(async()=>{
  await ctx.openScheduleMap(1);assert.equal(prefs.selectedDay,1);assert.equal(trip.viewMode,'map');assert.equal(trip.workspaceView,'itinerary');assert.equal(ctx.day,1);assert.match(embed.src,/Osaka%20Hotel%20Japan/);assert.equal(scrolls,1);assert.equal(closed,1);
  trip.viewMode='list';ctx.gmap={};await ctx.openScheduleMap(0,0);assert.equal(trip.viewMode,'map');assert.equal(prefs.selectedDay,0);assert.equal(draws,1);assert.equal(resizes,1);assert.equal(data.days[0][0].chosenPlace.lat,34);assert.equal(ctx.requestedMapFocus.stopId,'a');
  await ctx.openScheduleMap(null);assert.equal(prefs.selectedDay,null,'all selects the full-trip map');assert.equal(trip.viewMode,'map');
  console.log('PASS: map buttons switch to itinerary/map mode, select the requested day, focus a requested place, close place details and scroll to the map.');
})();
