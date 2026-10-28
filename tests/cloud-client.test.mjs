import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../js/cloud-access.js',import.meta.url),'utf8');
class Element {
  constructor(tag='div') {this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.hidden=false;this.value='';this.textContent='';this.style={setProperty(){}};this.attributes={};const classes=new Set();this.classList={add:(...names)=>names.forEach(n=>classes.add(n)),remove:(...names)=>names.forEach(n=>classes.delete(n)),contains:n=>classes.has(n),toggle:(n,value)=>value?classes.add(n):classes.delete(n)};}
  append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);}}
  replaceChildren(...nodes){this.children=[];this.append(...nodes);}
  setAttribute(key,value){this.attributes[key]=value;}
  querySelectorAll(selector){const wanted=selector.replace('.','');return descend(this).filter(n=>n.className?.split(' ').includes(wanted));}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  after(node){this.parent?.append(node);}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);}
  addEventListener(){} showModal(){this.open=true;} close(){this.open=false;}
  getBoundingClientRect(){return {top:100,bottom:150};}
}
function descend(node){return node.children.flatMap(child=>[child,...descend(child)]);}
const tick=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));};
function setup({share='',configured=true,localTrips=[],href='https://test.example/travel-planner.html'}={}) {
  const gate=new Element(),body=new Element('body'),header=new Element('header'),tools=new Element(),calls=[],timers=[];
  header.append(tools);body.append(gate,header);body.classList.add('auth-pending');
  const sessions=new Map(),storage=new Map();
  const context=vm.createContext({
    console,URL,URLSearchParams,Date,JSON,Promise,AbortSignal,innerHeight:844,
    location:{search:share?'?share='+share:'',href},
    sessionStorage:{getItem:key=>sessions.get(key),setItem:(key,val)=>sessions.set(key,val),removeItem:key=>sessions.delete(key)},
    localStorage:{setItem:(key,val)=>storage.set(key,val)},
    document:{body,hidden:false,getElementById:()=>gate,createElement:tag=>new Element(tag),querySelector:selector=>selector==='body > header'?header:selector==='body > header .tools'?tools:body.querySelector(selector),querySelectorAll:selector=>body.querySelectorAll(selector),addEventListener(){},removeEventListener(){}},
    window:{SAPPUN_CLOUD:{apiBase:configured?'https://api.example':''},addEventListener(){}},
    navigator:{clipboard:{writeText:async()=>{}}},
    setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){},setInterval:fn=>{timers.push(fn);return timers.length;},clearInterval(){},
    IntersectionObserver:class{observe(){}disconnect(){}},
    confirm:()=>true,toast(){},dayPalette:['blue'],dayBackgrounds:['#eaf2ff'],
    fetch:async(url,options)=>{
      calls.push({url,options});let data;
      if(url.endsWith('/login'))data={token:'test-owner-session'};
      else if(url.endsWith('/unlock'))data={token:'test-friend-session'};
      else if(url.includes('/shared/'))data={trip:{title:'공유할 여행',location:'도시',start:'2027-01-01',days:[[{name:'공유 장소',category:'관광',startTime:'09:00',endTime:'10:00',point:null}]]},expiresAt:Math.floor(Date.now()/1000)+3600,mapKey:''};
      else if(options.method==='PUT')data={revision:1};
      else if(url.endsWith('/book'))data={book:null,revision:0};
      else data={shares:[]};
      return {ok:true,status:200,json:async()=>data};
    }
  });
  vm.runInContext(`let tripBook={version:3,key:'',trips:${JSON.stringify(localTrips)}};let state={settings:{}},day=0,selected=0,currentTripId=null,homeOpen=true;
    function save(){return true;} function serializeTripBook(book){return JSON.stringify(book,(name,item)=>name==='key'?'':item);}
    function trip(){return tripBook.trips[0];}function sessionMapKey(){return '';}function storeSessionMapKey(){}
    function newTripData(){return {settings:{},days:[[]]};}function showHome(){}function validAnyData(){return true;}`,context);
  vm.runInContext(source,context);
  const nodes=()=>descend(body);
  return {context,gate,body,calls,timers,sessions,storage,nodes,
    findText:value=>nodes().find(n=>n.textContent===value),
    input:name=>nodes().find(n=>n.tagName==='INPUT'&&n.name===name),
    async submit(){await nodes().find(n=>n.tagName==='FORM').onsubmit({preventDefault(){}});await tick();}
  };
}
const pending=setup({configured:false});
assert.equal(pending.findText('로그인').disabled,true);assert.equal(pending.calls.length,0);
for (const href of ['file:///test/travel-planner.html','http://localhost:5500/travel-planner.html','http://127.0.0.1:5500/travel-planner.html']) {
  const preview=setup({configured:false,href});
  assert.equal(preview.input('username').required,false);
  assert.equal(preview.input('password').required,false);
  await preview.submit();
  assert.equal(preview.gate.hidden,true,'empty form enters local preview');
  assert.equal(preview.body.classList.contains('auth-pending'),false);
  vm.runInContext('save()',preview.context);
  assert.equal(preview.calls.length,0,'preview never calls the server');
  assert.equal(preview.sessions.size,0,'preview creates no login token');
}
const arbitrary=setup({configured:false,href:'http://localhost:5500/travel-planner.html'});
arbitrary.input('username').value='anything';arbitrary.input('password').value='anything';await arbitrary.submit();
assert.equal(arbitrary.gate.hidden,true,'any input enters local preview');
const localShare=setup({configured:false,share:'a'.repeat(64),href:'http://localhost:5500/travel-planner.html'});
assert.equal(localShare.findText('일정 보기').disabled,true,'shared links never use the local bypass');
const owner=setup();owner.input('username').value='owner';owner.input('password').value='owner-test-password';await owner.submit();
assert.equal(owner.gate.hidden,true);assert.equal(owner.sessions.get('sappun-owner-session'),'test-owner-session');
vm.runInContext("tripBook.trips.push({id:'new-trip',data:{settings:{key:'test-map-key'}}});save();",owner.context);
await owner.timers.at(-1)();await tick();
const stored=owner.calls.find(call=>call.options.method==='PUT');assert.ok(stored);assert.doesNotMatch(stored.options.body,/test-map-key/);
const needsChoice=setup({localTrips:[{id:'device-trip'}]});needsChoice.input('username').value='owner';needsChoice.input('password').value='owner-test-password';
const waiting=needsChoice.submit();await tick();
assert.ok(needsChoice.findText('이 기기 일정 서버에 저장'));assert.equal(needsChoice.calls.some(call=>call.options.method==='PUT'),false,'never uploads device trips before explicit choice');
needsChoice.findText('이 기기 일정 서버에 저장').onclick();await waiting;
assert.equal(needsChoice.calls.some(call=>call.options.method==='PUT'),true);
const friend=setup({share:'a'.repeat(64),localTrips:[{id:'private-owner-trip'}]});
assert.equal(friend.input('username'),undefined);assert.equal(friend.calls.length,0);
friend.input('password').value='friend-test-password';await friend.submit();
assert.ok(friend.findText('공유 장소'));assert.equal(friend.calls.length,2);
assert.ok(friend.calls.every(call=>call.url.includes('/shared/')));
assert.equal(friend.calls[1].options.headers.Authorization,'Bearer test-friend-session');
assert.equal(friend.findText('공유'),undefined,'shared view has no owner share/edit tools');
assert.equal(friend.body.classList.contains('auth-pending'),true,'underlying device app remains hidden in shared mode');
assert.equal(friend.input('password'),undefined,'password input is removed after unlock');
console.log('PASS: unconfigured gate, owner login, private sync, explicit upload choice, and isolated friend read-only client flow.');
