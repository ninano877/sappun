const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../js/travel-planner.js'), 'utf8');
const drawing = source.slice(source.indexOf('function mapDisplay() {'), source.indexOf('\nasync function loadSelectedDays('));
function harness() {
  const elements = new Map(), listeners = {}, lines = [], pins = [], requests = [], routes = new Map();
  const tripData = {}, point = n => ({lat:35+n/100,lng:139+n/100});
  const stop = n => ({id:n,query:String(n),name:'Stop '+n,mode:'도보',chosenPlace:point(n)});
  const ctx = vm.createContext({state:{days:[[stop(0),stop(1)],[stop(2),stop(3)]]},day:0,
    trip:()=>tripData,homeOpen:false,currentTripId:'trip1',requestedMapFocus:null,allMapSignature:'',markers:[],overviewLines:[],shownRouteLines:[],travelLabelMarkers:[],routeResults:new Map(),
    dayBackgrounds:['#EAF2FF','#F2ECFF'],dayColor:d=>['#3182F6','#8755F4'][d],TravelComponents:{dayDot:c=>'<i>'+c+'</i>'},
    $:selector=>{if(!elements.has(selector)) elements.set(selector,{textContent:'',innerHTML:'',setAttribute(){},insertAdjacentHTML(where,html){this.innerHTML+=html;}});return elements.get(selector);},
    document:{querySelectorAll:()=>[],addEventListener:(type,fn)=>listeners[type]=fn,createElement:()=>({style:{setProperty(){}}})},
    google:{maps:{Polyline:class{constructor(options){this.options=options;this.map=options.map;lines.push(this);}setMap(map){this.map=map;}},LatLngBounds:class{extend(){}},SymbolPath:{FORWARD_CLOSED_ARROW:'arrow'},marker:{AdvancedMarkerElement:class{constructor(options){Object.assign(this,options);pins.push(this);}}}}},
    gmap:{fitBounds(){},setZoom(){},panTo(){}},savedPoint:s=>s.chosenPlace,hasSegment:s=>!s.noTravel,esc:s=>s,transportIcon:{'도보':'walk'},
    getLeg:async(d,i)=>{requests.push([d,i]);},currentRoute:(d,i)=>routes.get(d+':'+i),save(){},render(){},focusCard(){},leg(){},toast(){},
  });
  for(let d=0;d<2;d++) routes.set(d+':0',{status:'ok',minutes:7,path:[point(d*2),point(d*2+.5),point(d*2+1)]});
  vm.runInContext(drawing,ctx);
  const click = button => listeners.click({target:{closest:()=>button}});
  return {ctx,tripData,elements,lines,pins,routes,requests,click};
}
(async()=>{
  let h=harness();await h.ctx.drawGoogle();
  assert.equal(h.ctx.mapDisplay().selectedDay,0);
  assert.equal(h.ctx.markers.length,2,'default is Day 1 only');assert.equal(h.ctx.overviewLines.length,1);
  assert.equal(h.lines[0].options.path.length,3,'road geometry preserved');assert.equal(h.lines[0].options.icons[0].icon.path,'arrow');
  h.click({id:'',dataset:{mapday:'1'}});await h.ctx.drawGoogle();
  assert.equal(h.ctx.markers.length,2);assert.equal(h.ctx.overviewLines[0].options.strokeColor,'#8755F4');
  assert.ok(h.ctx.markers.every(pin=>pin.title.startsWith('Day 2')),'Day 2 replaces Day 1');
  h.click({id:'',dataset:{mapday:'1'}});await h.ctx.drawGoogle();
  assert.equal(h.ctx.markers.length,2,'clicking active day does not hide it');
  h.click({id:'toggle-map-pins',dataset:{}});await h.ctx.drawGoogle();
  assert.equal(h.ctx.markers.length,0);assert.equal(h.ctx.travelLabelMarkers.length,0);assert.equal(h.ctx.overviewLines.length,1,'pin toggle leaves real route intact');
  h.click({id:'',dataset:{mapday:'0'}});await h.ctx.drawGoogle();assert.equal(h.ctx.markers.length,0,'date change respects hidden pins');
  assert.equal(h.ctx.overviewLines[0].options.strokeColor,'#3182F6');
  h.click({id:'toggle-map-pins',dataset:{}});await h.ctx.drawGoogle();assert.equal(h.ctx.markers.length,2);
  h.click({id:'',dataset:{mapday:'all'}});await h.ctx.drawGoogle();assert.equal(h.ctx.markers.length,4);assert.equal(h.ctx.overviewLines.length,2);
  h.ctx.renderMapDayControls();assert.equal(h.elements.get('#mapstrip').innerHTML,'','date controls live in the itinerary headings');
  h.ctx.installMapDisplayControls(h.ctx.$('#toolbar'));
  assert.match(h.elements.get('#toolbar').innerHTML,/toggle-map-pins/);assert.doesNotMatch(h.elements.get('#toolbar').innerHTML,/toggle-map-routes|모든 날짜 숨기기/);
  h=harness();h.ctx.mapDisplay().selectedDay=null;h.routes.set('0:0',{status:'error'});h.routes.set('1:0',{status:'manual'});await h.ctx.drawGoogle();assert.equal(h.ctx.overviewLines.length,2,'missing routes use the existing dotted fallback');assert.ok(h.ctx.overviewLines.every(line=>line.options.strokeOpacity===0),'fallback has no solid route stroke');
  assert.match(h.elements.get('#map-route-status').textContent,/점선 연결 2개/);h.ctx.state.days[0][0].mode='대중교통';await h.ctx.drawGoogle();assert.equal(h.ctx.overviewLines[0].options.strokeOpacity,0.95,'transit without a saved duration is also solid');h.ctx.state.days[0][0].minutes=70;h.ctx.state.days[0][0].manualRoute=true;await h.ctx.drawGoogle();assert.equal(h.ctx.overviewLines[0].options.strokeOpacity,0.95);assert.equal(h.ctx.overviewLines[0].options.path.length,2);assert.equal(h.ctx.state.days[0][0].minutes,70);assert.match(h.elements.get('#map-route-status').textContent,/직접 입력한 이동 1개/);await h.ctx.drawGoogle();assert.equal(h.ctx.overviewLines[0].options.strokeOpacity,0.95,'manual transit remains solid on repeated rendering');
  h=harness();delete h.ctx.state.days[0][0].chosenPlace;await h.ctx.drawGoogle();assert.equal(h.requests.length,0);assert.match(h.elements.get('#map-route-status').textContent,/위치 미조회/);
  h=harness();await h.ctx.drawGoogle();const oldVersion=vm.runInContext('mapDrawVersion',h.ctx);
  h.click({id:'',dataset:{mapday:'1'}});await h.ctx.drawGoogle();await h.ctx.drawMapRoutes(oldVersion);
  assert.equal(h.ctx.overviewLines.length,1);assert.equal(h.ctx.overviewLines[0].options.strokeColor,'#8755F4','late Day 1 response cannot return after switching to Day 2');
  h=harness();const shared={lat:35,lng:139};h.ctx.state.days[0]=Array.from({length:10},(_,i)=>({id:i,query:'place'+i,name:i===9?'숙소 복귀':'장소 '+(i+1),mode:'도보',chosenPlace:i===0||i===9?shared:{lat:35+i/100,lng:139}}));const before=JSON.stringify(h.ctx.state.days);await h.ctx.drawGoogle();assert.equal(h.ctx.markers.length,9,'repeat visits at the same location share a marker');const grouped=h.ctx.markers.find(marker=>marker.content.className.includes('grouped-map-pin'));assert.ok(grouped);assert.match(grouped.content.innerHTML,/>1 · 10</);assert.match(grouped.title,/10번/);assert.equal(JSON.stringify(h.ctx.state.days),before,'grouping never changes schedule order');let visitHtml='';h.ctx.modal=html=>visitHtml=html;h.ctx.hasStopTime=()=>false;grouped.content.onclick();assert.match(visitHtml,/data-pin-visit="0"/);assert.match(visitHtml,/data-pin-visit="1"/);assert.match(visitHtml,/10번/);assert.ok(h.ctx.overviewLines.some(line=>line.options.strokeWeight>=5),'connection lines are thicker');
  h=harness();h.tripData.mapDisplay={hiddenDays:{0:true},showRoutes:false};assert.equal(h.ctx.mapDisplay().selectedDay,0);assert.equal(h.ctx.mapDisplay().showPins,true);assert.equal('hiddenDays' in h.ctx.mapDisplay(),false);
  console.log('PASS: exclusive day selection, repeat selection, independent pin visibility, all days, actual route geometry, stale responses, and preference migration.');
})().catch(error=>{console.error(error);process.exitCode=1;});
