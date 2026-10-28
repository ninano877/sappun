const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const harness=fs.readFileSync(path.join(__dirname,'app-boot.test.cjs'),'utf8').split("vm.runInContext('openTrip")[0];
const scenario=`
vm.runInContext('openTrip(tripBook.trips[0].id);state.resources=[{id:"booking",title:"호텔 예약 확인서",stopIds:[state.days[0][0].id]}];trip().workspaceView="itinerary";trip().viewMode="map";render()',context);
assert.match(get('#stops').innerHTML,/schedule-resource-links/);assert.match(get('#stops').innerHTML,/data-resource-open="booking"/);assert.match(get('#stops').innerHTML,/호텔 예약 확인서/);
vm.runInContext('trip().viewMode="list";render()',context);assert.match(get('#stops').innerHTML,/호텔 예약 확인서/);
`;
module.exports=(async()=>{
  await vm.runInNewContext('(async()=>{'+harness+scenario+'})()',{require,__dirname,console,URL,Intl,Date,Blob,AbortController,queueMicrotask,structuredClone});
  const source=fs.readFileSync(path.join(__dirname,'../js/travel-workspace.js'),'utf8');
  const files=[{id:'target',tripId:'trip',resourceId:'booking',name:'ticket.pdf',kind:'resource',blob:new Blob(['pdf'],{type:'application/pdf'})},{id:'cover',tripId:'trip',resourceId:'booking',name:'cover',kind:'resource-cover'},{id:'other',tripId:'trip',resourceId:'other',name:'other'}];
  const host={innerHTML:''},editing={tripId:'trip',resource:{id:'booking',title:'Keep this title',note:'Keep this note'}},removed=[];
  const ctx=vm.createContext({db:{},currentTripId:'trip',resourceEditing:editing,resourcePreviewVersion:1,resourcePanel:{querySelector:()=>host},workspaceFiles:files.slice(),resourceUrls:[],releaseResourceUrls(){},clearCoverUrls(){},render(){},renderFiles(){},toast(){},confirm:()=>false,esc:String,TravelMedia:require('../js/travel-media.js'),URL:{createObjectURL:()=> 'blob:ticket'},allFiles:async()=>files,dbop:async(mode,fn)=>fn({delete:id=>{removed.push(id);files.splice(files.findIndex(f=>f.id===id),1);}})});
  vm.runInContext(source.slice(source.indexOf('  async function renderResourceAttachments('),source.indexOf('  async function deleteResource(id)')),ctx);
  await ctx.renderResourceAttachments('booking',1);assert.match(host.innerHTML,/data-resource-file-delete="target"/);assert.doesNotMatch(host.innerHTML,/data-resource-file-delete="cover"/);
  await ctx.deleteResourceAttachment('target');assert.equal(removed.length,0,'cancel keeps attachment');
  ctx.confirm=()=>true;await ctx.deleteResourceAttachment('other');await ctx.deleteResourceAttachment('cover');assert.equal(removed.length,0,'cannot delete another resource or its cover');
  await ctx.deleteResourceAttachment('target');assert.deepEqual(removed,['target']);assert.equal(host.innerHTML,'');assert.equal(ctx.workspaceFiles.some(f=>f.id==='target'),false);assert.equal(editing.resource.title,'Keep this title');assert.equal(editing.resource.note,'Keep this note');
  console.log('PASS: linked resource titles on both schedule views, attachment delete controls, cancellation, resource boundaries, preview/cache refresh and preserved resource content.');
})();
