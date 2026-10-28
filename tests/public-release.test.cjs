const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname,'..');
const harness = fs.readFileSync(path.join(__dirname,'app-boot.test.cjs'),'utf8').split('// Test-only fixture.')[0];
const checks = `
assert.equal(vm.runInContext('tripBook.trips.length',context),0,'fresh install has no personal/demo trips');
assert.equal(vm.runInContext('state.days.flat().length',context),0,'fresh install has no places');
assert.equal(vm.runInContext('state.settings.people',context),1);
assert.equal(vm.runInContext('travelCurrency()',context),'KRW');
assert.equal(vm.runInContext('validAnyData(newTripData(1))',context),true,'new KRW trip remains backup/import compatible without a legacy JPY rate');
const session = new Map();
context.sessionStorage = {getItem:key=>session.get(key)||null,setItem:(key,value)=>session.set(key,value),removeItem:key=>session.delete(key)};
vm.runInContext('state.settings.key="test-only-map-key";save();',context);
assert.equal(session.get('sappun-map-key'),'test-only-map-key','key works during the current tab session');
assert.doesNotMatch(storage.get('sappun-trips-v3'),/test-only-map-key/,'key never enters persistent trip storage');
const packed = vm.runInContext('serializeTripBook({key:"test-only-map-key",trips:[{data:{settings:{key:"another-test-key"}}}],note:"keep user text",apiKey:"test-token"})',context);
assert.doesNotMatch(packed,/test-only-map-key|another-test-key|test-token/);
assert.match(packed,/keep user text/);
`;
vm.runInNewContext(harness+checks,{require,__dirname,console,URL,Intl,Date,Blob,AbortController,queueMicrotask,structuredClone});

const existing = {version:3,key:'test-old-key',trips:[{id:'saved',title:'보존할 테스트 여행',location:'테스트 도시',start:'2027-01-01',end:'2027-01-01',data:{version:2,settings:{people:1,budget:0,key:'test-old-key',travelCurrency:'KRW',currencyRates:{KRW:1}},days:[[]],expenses:[]}}]};
const withExisting = harness.replace('for(const file of [', 'storage.set("sappun-trips-v3",'+JSON.stringify(JSON.stringify(existing))+');for(const file of [');
vm.runInNewContext(withExisting+`
assert.equal(vm.runInContext('tripBook.trips.length',context),1,'existing user trips are not replaced');
assert.equal(vm.runInContext('tripBook.trips[0].title',context),'보존할 테스트 여행');
assert.equal(vm.runInContext('tripBook.key',context),'','old persisted key is not loaded');
assert.doesNotMatch(storage.get('sappun-trips-v3'),/test-old-key/);
`,{require,__dirname,console,URL,Intl,Date,Blob,AbortController,queueMicrotask,structuredClone});

const html = fs.readFileSync(path.join(root,'travel-planner.html'),'utf8');
assert.doesNotMatch(html,/\.private\./);
assert.doesNotMatch(html,/notion-import|data\//);
assert.match(html,/js\/app-config\.js/);
assert.doesNotMatch(fs.readFileSync(path.join(root,'js/travel-workspace.js'),'utf8'),/TravelNotionImport|installNotion|노션/);
for (const dir of ['data','imports','backups','exports']) if(fs.existsSync(path.join(root,dir))) assert.equal(fs.readdirSync(path.join(root,dir)).length,0,'private data directories must be empty');
assert.equal(fs.existsSync(path.join(root,'js/notion-import.js')),false);
console.log('PASS: empty public startup, session-only API key, sanitized persistence/exports, and no private source files.');
