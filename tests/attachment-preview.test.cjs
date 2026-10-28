const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const harness=fs.readFileSync(path.join(__dirname,'app-boot.test.cjs'),'utf8').split("vm.runInContext('openTrip")[0];
const urls=[],released=[];
class PreviewURL extends URL{static createObjectURL(){const url='blob:preview-'+urls.length;urls.push(url);return url;}static revokeObjectURL(url){released.push(url);}}
const scenario=`
await Promise.resolve();await Promise.resolve();
vm.runInContext('openTrip(tripBook.trips[0].id);db={};window.previewFiles=[{id:"img",tripId:currentTripId,day:0,name:"<ticket>.png",blob:new Blob(["image"],{type:"image/png"})},{id:"pdf",tripId:currentTripId,day:0,name:"reservation.pdf",blob:new Blob(["pdf"])},{id:"other",tripId:currentTripId,day:0,name:"notes.docx",blob:new Blob(["doc"])}];dbop=async(mode,fn)=>fn({get:id=>window.previewFiles.find(f=>f.id===id),getAll:()=>window.previewFiles});',context);
await vm.runInContext('renderFiles()',context);
assert.match(get('#files').innerHTML,/data-filepreview="img"/);assert.match(get('#files').innerHTML,/data-download="img"/);
await get('#files').onclick({target:{closest:selector=>selector==='[data-filepreview]'?{dataset:{filepreview:'img'}}:null}});
const dialog=context.document.body.children.find(n=>n.id==='attachment-preview-dialog');
assert.equal(dialog.open,true);assert.match(dialog.innerHTML,/<img/);assert.match(dialog.innerHTML,/&lt;ticket&gt;.png/);assert.match(dialog.innerHTML,/data-preview-close/);
const initial=urls.length;await vm.runInContext('openAttachmentPreview("pdf")',context);assert.match(dialog.innerHTML,/type="application\\/pdf"/);assert.equal(released.length,1,'switching preview releases old object URL');
vm.runInContext('clearAttachmentPreview()',context);assert.equal(dialog.open,false);assert.equal(dialog.innerHTML,'');assert.equal(released.length,2);
await vm.runInContext('openAttachmentPreview("other")',context);assert.match(dialog.innerHTML,/file-placeholder/);assert.match(dialog.innerHTML,/열기·저장/);
dialog.onclick({target:{closest:()=>({})}});assert.equal(dialog.open,false,'close button dismisses dialog');
vm.runInContext('dbop=()=>new Promise(resolve=>window.finishPreview=resolve)',context);const pending=vm.runInContext('openAttachmentPreview("img")',context);vm.runInContext('clearAttachmentPreview();window.finishPreview(window.previewFiles[0])',context);await pending;assert.equal(dialog.open,false,'cancelled late request cannot reopen popup');
assert.equal(urls.length,initial+2,'stale request does not allocate an object URL');
console.log('PASS: file-name click opens modal image/PDF previews, escaped titles, file fallback, download control, close cleanup and stale-request cancellation.');
`;
module.exports=vm.runInNewContext('(async()=>{'+harness+scenario+'})()',{require,__dirname,console,URL:PreviewURL,urls,released,Intl,Date,Blob,AbortController,queueMicrotask,structuredClone},{filename:'attachment-preview-harness.cjs'});
