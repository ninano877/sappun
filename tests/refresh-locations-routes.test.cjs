const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../js/travel-planner.js'),'utf8');
const stop=(id,start,end,extra={})=>({id,name:id,query:id,startTime:start,endTime:end,startDate:'2026-12-11',endDate:'2026-12-11',mode:'도보',segmentEnabled:true,...extra});
const days=[[stop('a','08:00','09:00',{minutes:10,manualRoute:false,googleRouteRequested:true}),stop('b','09:10','11:10',{minutes:20,manualRoute:true}),stop('c','10:30','11:30',{minutes:null,manualRoute:false}),stop('d','12:00','13:00',{query:'c',minutes:null,manualRoute:true})]];
const events=[],results=new Map(),resolved=new Map();
const ctx=vm.createContext({state:{days},currentTripId:'t',homeOpen:false,gmap:{},locationLoadBusy:false,allMapSignature:'',resolvedPlaces:resolved,
  tripDate:()=> '2026-12-11',trip:()=>({end:'2026-12-15'}),hasStopTime:()=>true,stopStart:s=>s.startTime,stopEnd:s=>s.endTime,scheduleEndDate:s=>s.endDate,hasSegment:s=>s.segmentEnabled,
  routeSignature:(d,i)=>days[d][i].id+'-'+days[d][i].endTime,currentRoute:()=>null,routeResults:results,
  resolvePlace:async(s,refresh)=>{events.push('place:'+s.query+':'+refresh);const point={lat:35,lng:135};resolved.set(s.query,point);return point;},
  lookupSegmentRoute:async(d,a,b)=>{events.push('route:'+a.id);return {status:'ok',minutes:15};},mapDisplay:()=>({}),save(){},render(){},toast(){},errorText:e=>e.message});
vm.runInContext(source.slice(source.indexOf('function syncFollowingSchedule('),source.indexOf('function legTimes(')),ctx);
vm.runInContext(source.slice(source.indexOf('async function refreshGoogleSegments('),source.indexOf('function leg(i)',source.indexOf('async function refreshGoogleSegments('))),ctx);
module.exports=(async()=>{
  ctx.cascadeScheduleEdit(0,1,Date.parse('2026-12-11T10:10:00Z'));assert.equal(days[0][2].startTime,'11:30');assert.equal(days[0][3].startTime,'13:00','later schedules shift even beyond a segment with an unknown duration');assert.equal(days[0][1].minutes,20);
  await ctx.loadSelectedDays([0],true);assert.equal(events.filter(e=>e.startsWith('place:')).length,3,'duplicate locations share one search');assert.ok(events.indexOf('route:a')>events.findLastIndex(e=>e.startsWith('place:')),'all locations resolve before routes');assert.deepEqual(events.filter(e=>e.startsWith('route:')),['route:a'],'only previously Google-searched segments refresh');assert.equal(days[0][0].minutes,15);assert.equal(days[0][1].minutes,20,'manual duration is preserved');
  ctx.lookupSegmentRoute=async()=>{throw Error('API failed');};await ctx.loadSelectedDays([0],true);assert.equal(days[0][0].minutes,15,'failed refresh keeps previous duration');assert.equal(ctx.locationLoadBusy,false);
  console.log('PASS: schedule edits cascade, location searches precede eligible route refreshes, duplicate searches reuse results, manual durations remain and failures preserve prior times.');
})();
