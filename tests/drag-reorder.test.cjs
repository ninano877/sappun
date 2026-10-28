const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../js/travel-planner.js'),'utf8');
const logic=source.slice(source.indexOf('function reorderScheduleStop('),source.indexOf('\ninstallScheduleReordering();'));
function harness() {
  const events={}, frames=new Map(), animations=[], scrolls=[];let sequence=0;
  class Element {
    constructor(kind='div',className='') {this.kind=kind;this.className=className;this.children=[];this.dataset={};this.style={};this.isConnected=true;this.hidden=false;this.classes=new Set();this.classList={add:c=>this.classes.add(c),remove:c=>this.classes.delete(c),toggle:(c,on)=>on?this.classes.add(c):this.classes.delete(c)};}
    append(...nodes) {for(const n of nodes){if(n.parentElement)n.parentElement.children.splice(n.parentElement.children.indexOf(n),1);this.children.push(n);n.parentElement=this;}}
    prepend(n){this.insertBefore(n,this.children[0]||null);}
    insertBefore(n,anchor){if(n.parentElement)n.parentElement.children.splice(n.parentElement.children.indexOf(n),1);const i=anchor?this.children.indexOf(anchor):this.children.length;this.children.splice(i,0,n);n.parentElement=this;}
    remove(){if(this.parentElement)this.parentElement.children.splice(this.parentElement.children.indexOf(this),1);this.isConnected=false;}
    setAttribute(name,value){this[name]=value;}
    before(){} after(){}
    matches(selector){if(selector==='tr')return this.kind==='tr';if(selector==='[data-stop-id]')return this.dataset.stopId!==undefined;if(selector==='[data-group-day]')return this.dataset.groupDay!==undefined;return selector.startsWith('.')&&this.className.split(' ').includes(selector.slice(1));}
    closest(selector){return this.matches(selector)?this:this.parentElement?.closest(selector)||null;}
    querySelectorAll(selector){return this.children.flatMap(n=>[...(n.matches(selector)?[n]:[]),...n.querySelectorAll(selector)]);}
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
    get nextElementSibling(){const list=this.parentElement?.children||[];return list[list.indexOf(this)+1]||null;}
    getBoundingClientRect(){const block=this.closest('.schedule-stop-block');const i=block?block.parentElement.children.indexOf(block):0;const top=block?10+i*100:0;return {left:20,right:340,width:320,top,bottom:top+(this===group?400:100),height:this===group?400:100};}
    cloneNode(){return new Element(this.kind,this.className);}
    addEventListener(type,fn){events[type]=fn;}
    setPointerCapture(id){this.capture=id;}
    hasPointerCapture(id){return this.capture===id;}
    releasePointerCapture(){this.capture=null;events.lostpointercapture?.();}
    animate(keyframes,options){const a={keyframes,options,cancel(){this.cancelled=true;}};animations.push(a);return a;}
    focus(){this.focused=true;}
  }
  const host=new Element('div','stops'),group=new Element('section','day-group'),container=new Element('div','day-group-content'),body=new Element('body');
  group.dataset.groupDay='0';host.append(group);group.append(container);
  const state={days:[[{id:'a'},{id:'b'},{id:'c'}]]};
  for(const id of ['a','b','c']) {const block=new Element('div','schedule-stop-block'),row=new Element('article','map-stop-card'),handle=new Element('button','schedule-drag-handle');row.dataset={stopId:id,cardIndex:String(container.children.length)};row.append(handle);block.append(row);container.append(block);}
  const ctx=vm.createContext({state,day:0,selected:0,requestedMapFocus:null,allMapSignature:'',currentTripId:'trip',homeOpen:false,$:()=>host,
    save(){},render(){for(const [i,stop] of state.days[0].entries()){const row=host.querySelectorAll('[data-stop-id]').find(row=>row.dataset.stopId===stop.id);container.append(row.closest('.schedule-stop-block'));row.dataset.cardIndex=String(i);}},
    window:{innerHeight:1000,matchMedia:()=>({matches:false}),scrollBy:(x,y)=>scrolls.push(y)},getComputedStyle:()=>({transform:'none',overflowY:'visible'}),
    requestAnimationFrame:fn=>{const id=++sequence;frames.set(id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id),
    document:{body,createElement:kind=>new Element(kind)},
  });
  vm.runInContext(logic,ctx);ctx.installScheduleReordering();
  const row=id=>host.querySelectorAll('[data-stop-id]').find(row=>row.dataset.stopId===id);
  const event=(id,y,x=40)=>({target:row(id).querySelector('.schedule-drag-handle'),button:0,pointerId:1,clientX:x,clientY:y,preventDefault(){},stopPropagation(){}});
  const frame=()=>{const [id,fn]=frames.entries().next().value;frames.delete(id);fn();};
  return {ctx,state,host,group,container,body,events,frames,animations,scrolls,row,event,frame};
}
let h=harness();h.events.pointerdown(h.event('a',30));h.events.pointermove(h.event('a',280));h.frame();
assert.equal(h.host.querySelectorAll('[data-stop-id]').map(row=>row.dataset.stopId).join(','),'b,c,a','preview opens the new slot immediately');
assert.equal(h.state.days[0].map(s=>s.id).join(','),'a,b,c','preview does not save until drop');
const ghost=h.body.children.find(n=>n.className==='schedule-drag-preview');assert.match(ghost.style.transform,/translate3d/);assert.ok(h.animations.length>0,'neighboring cards animate');
h.events.pointerup(h.event('a',280));assert.equal(h.state.days[0].map(s=>s.id).join(','),'b,c,a');assert.equal(h.frames.size,0);assert.equal(h.body.children.length,0);
h=harness();h.events.pointerdown(h.event('c',270));h.events.pointermove(h.event('c',30));h.events.pointerup(h.event('c',30));assert.equal(h.state.days[0].map(s=>s.id).join(','),'c,a,b','quick drop works before first animation frame');
h=harness();h.events.pointerdown(h.event('a',30));h.events.pointermove(h.event('a',280));h.frame();h.events.pointercancel();assert.equal(h.state.days[0].map(s=>s.id).join(','),'a,b,c');assert.equal(h.host.querySelectorAll('[data-stop-id]').map(row=>row.dataset.stopId).join(','),'a,b,c','cancel restores original DOM order');assert.equal(h.frames.size,0);
h=harness();h.events.pointerdown(h.event('a',30));h.events.pointermove(h.event('a',280));h.frame();h.events.keydown({...h.event('a',280),key:'Escape'});assert.equal(h.state.days[0].map(s=>s.id).join(','),'a,b,c');
h=harness();h.events.pointerdown(h.event('a',30));h.events.pointermove(h.event('a',280,1000));h.frame();h.events.pointerup(h.event('a',280,1000));assert.equal(h.state.days[0].map(s=>s.id).join(','),'a,b,c','outside drop never commits');
h=harness();h.events.pointerdown(h.event('a',30));h.events.pointermove(h.event('a',980));h.frame();h.frame();assert.equal(h.scrolls.length,2,'edge scroll continues on animation frames without more pointer events');h.events.pointercancel();
h=harness();h.events.keydown({...h.event('a',30),key:'ArrowDown'});assert.equal(h.state.days[0].map(s=>s.id).join(','),'b,a,c');assert.equal(h.row('a').querySelector('.schedule-drag-handle').focused,true);
console.log('PASS: floating preview, live slot movement, neighbor animations, stable pointer capture, fast drops, touch/Escape cancellation, outside drops, continuous edge scroll, and keyboard focus.');

h=harness();h.state.days.push([]);const moving=h.state.days[0][0];moving.note="memo";moving.costItems=[{id:"cost",actual:100}];assert.equal(h.ctx.reorderScheduleStop(0,"a",0,1),true);assert.equal(h.state.days[1][0],moving);assert.equal(h.state.days[0].some(s=>s.id==="a"),false);assert.equal(h.ctx.day,1);assert.equal(moving.costItems[0].actual,100);assert.equal(h.ctx.reorderScheduleStop(1,"a",0,99),false);console.log("PASS: cross-day move into empty day preserves identity, notes and expenses; invalid destination rejected.");
