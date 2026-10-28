const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'../js/travel-planner.js'),'utf8');
const extract=(from,to)=>src.slice(src.indexOf(from),src.indexOf(to,src.indexOf(from)));
const days=[[{startTime:'09:00',endTime:'10:00'}, {startTime:'11:00',endTime:'12:00',minutes:15,segmentEnabled:true}, {startTime:'14:00',endTime:'15:30'}]];
const ctx=vm.createContext({state:{days},tripDate:()=> '2026-12-11',trip:()=>({end:'2026-12-16'}),hasStopTime:s=>s.timeUnset!==true&&!!s.startTime,stopStart:s=>s.startTime||'09:00',stopEnd:s=>s.endTime||'10:00',scheduleEndDate:(s)=>s.endDate||s.startDate||'2026-12-11',hasSegment:s=>s.segmentEnabled===true,toast(){}});
vm.runInContext(extract('function syncFollowingSchedule(', '\nfunction legTimes('),ctx);
assert.equal(ctx.syncFollowingSchedule(0,0,30),true);
assert.equal(days[0][1].startTime,'10:30');assert.equal(days[0][1].endTime,'11:30');
assert.equal(days[0][2].startTime,'11:45');assert.equal(days[0][2].endTime,'13:15');
days[0][0].endTime='23:50';ctx.syncFollowingSchedule(0,0,30);
assert.equal(days[0][1].startDate,'2026-12-12');assert.equal(days[0][1].startTime,'00:20');
const before=JSON.stringify(days);ctx.trip=()=>({end:'2026-12-11'});assert.equal(ctx.syncFollowingSchedule(0,0,30),false);assert.equal(JSON.stringify(days),before);

module.exports=(async()=>{
  const lines=[],statuses=[];
  const stops=[{name:'Airport A',mode:'항공',minutes:120,p:{lat:34,lng:135}}, {name:'Airport B',mode:'도보',p:{lat:35,lng:136}}, {name:'Hotel',p:{lat:36,lng:137}}];
  const mapCtx=vm.createContext({state:{days:[stops]},mapDisplay:()=>({showPins:true}),mapDrawVersion:1,homeOpen:false,trip:()=>({workspaceView:'itinerary'}),mapDayVisible:()=>true,hasSegment:()=>true,savedPoint:s=>s.p,updateMapRouteStatus:s=>statuses.push(s),currentRoute:()=>({status:'error'}),overviewLines:[],travelLabelMarkers:[],gmap:{},dayColor:()=> '#3182F6',transportIcon:{항공:'✈'},day:0,leg(){},document:{createElement:()=>({style:{}})},google:{maps:{Polyline:function(options){lines.push(options);},marker:{AdvancedMarkerElement:function(){}},SymbolPath:{FORWARD_CLOSED_ARROW:'arrow'}}}});
  vm.runInContext(extract('function routePathPoint(', '\nasync function drawGoogle('),mapCtx);
  await mapCtx.drawMapRoutes(1);
  assert.equal(lines.length,2);assert.equal(lines[0].path.length,2);assert.equal(lines[0].strokeOpacity,0.95);assert.equal(lines[1].strokeOpacity,0);assert.match(statuses.at(-1),/직접 입력한 이동 1개/);assert.match(statuses.at(-1),/점선 연결 1개/);assert.equal(stops[0].minutes,120,'drawing preserves the entered duration');
  mapCtx.currentRoute=()=>({status:'ok',path:[{lat:34,lng:135},{lat:34.5,lng:135.5},{lat:35,lng:136}],minutes:20});
  await mapCtx.drawMapRoutes(1);assert.equal(lines[2].path.length,3);assert.equal(lines[2].strokeOpacity,1);

  const workspace=fs.readFileSync(path.join(__dirname,'../js/travel-workspace.js'),'utf8');
  const code=workspace.slice(workspace.indexOf('  async function deleteResource('),workspace.indexOf('  function resourceDetail('));
  const data={resources:[{id:'r',title:'예약서'},{id:'keep',title:'보존'}],days:[[{resourceIds:['r','keep']}]]};
  const files=[{id:'file-r',tripId:'t',resourceId:'r'},{id:'other',tripId:'t',resourceId:'keep'}],removed=[];
  const deleteCtx=vm.createContext({state:data,confirm:()=>false,currentTripId:'t',db:{},allFiles:async()=>files,dbop:async(mode,fn)=>fn({delete:id=>removed.push(id)}),resourceEditing:null,workspaceFiles:files,clearCoverUrls(){},save(){},render(){},toast(){},tripBook:{}});
  vm.runInContext(code,deleteCtx);await deleteCtx.deleteResource('r');assert.equal(data.resources.length,2);
  deleteCtx.confirm=()=>true;await deleteCtx.deleteResource('r');assert.deepEqual(data.resources.map(r=>r.id),['keep']);assert.deepEqual(data.days[0][0].resourceIds,['keep']);assert.deepEqual(removed,['file-r']);
  console.log('PASS: travel times chain with stay durations and midnight dates, map fallback/real paths, and resource deletion with attachments.');
})();
