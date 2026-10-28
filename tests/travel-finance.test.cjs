const assert=require('node:assert/strict');
const F=require('../js/travel-finance.js');
const plain=value=>JSON.parse(JSON.stringify(value));
const convert=(value,currency)=>value*(currency==='JPY'?9:1);
const members=['A','B','C','D'].map(id=>({id,name:id,active:true}));
const make=(expenses=[])=>({settings:{people:4,members:members.map(p=>({...p}))},days:[[]],expenses});
const expense=(actual,payerId='A',splitIds=['A','B'],extra={})=>({id:'e',name:'Meal',category:'식비',actual,currency:'KRW',amountBasis:'total',scope:'전체',payerId,splitIds,allocationConfirmed:true,settlementStatus:'pending',...extra});
let data=make([expense(1001)]),r=F.calculate(data,convert);
assert.deepEqual(plain(r.transfers),[{from:'B',to:'A',amount:500}]);
assert.equal(r.balances.find(p=>p.id==='A').owed,501);assert.equal(r.balances.find(p=>p.id==='B').owed,500);
for(const id of ['C','D'])assert.deepEqual(plain({...r.balances.find(p=>p.id===id)}),{id,name:id,active:true,paid:0,owed:0,balance:0},'unselected traveler is not charged');
assert.equal(r.balances.reduce((sum,p)=>sum+p.balance,0),0);
r=F.calculate(make([expense(100,'A',['B','C'])]),convert);assert.deepEqual(plain(r.transfers),[{from:'B',to:'A',amount:50},{from:'C',to:'A',amount:50}]);
r=F.calculate(make([expense(100),expense(60,'B')]),convert);assert.deepEqual(plain(r.transfers),[{from:'B',to:'A',amount:20}]);
for(const extra of [{payerId:'self'},{settlementStatus:'settled'}])assert.equal(F.calculate(make([expense(100,'A',['A','B'],extra)]),convert).transfers.length,0);
r=F.calculate(make([expense(100,'')]),convert);assert.equal(r.missing.length,1);assert.equal(r.transfers.length,0);assert.equal(r.total,100);
r=F.calculate(make([expense(100,'A',[])]),convert);assert.equal(r.missing.length,1);assert.equal(r.transfers.length,0);
r=F.calculate(make([expense(100,'pool')]),convert);assert.equal(r.transfers.reduce((sum,t)=>sum+t.amount,0),100);
assert.equal(r.balances.find(p=>p.id==='pool').balance,100);
assert.equal(F.shares(901,['A','B','C']).reduce((sum,s)=>sum+s.amount,0),901);
assert.deepEqual(plain(F.shares(901,['A','B','C'])),[{id:'A',amount:301},{id:'B',amount:300},{id:'C',amount:300}]);
data=make([{id:'whole',actual:100,currency:'KRW',scope:'전체'},{id:'each',actual:50,currency:'KRW',scope:'1인'}]);data.days=[[{id:'s',name:'Station',costItems:[{actual:100,currency:'KRW'}],actualFare:20,actualFareCurrency:'KRW'},{id:'next',costItems:[]}]];
F.prepare(data);assert.equal(F.calculate(data,convert).total,780);
data.settings.people=2;assert.equal(F.calculate(data,convert).total,780,'registering people never changes historical totals');
const empty={settings:{people:4},days:[[]],expenses:[]};assert.deepEqual(plain(F.prepare(empty)),[],'no participant names are generated');
const restored=JSON.parse(JSON.stringify(data));assert.equal(F.calculate(restored,convert).total,780,'legacy metadata survives backup round-trip');
data=make([expense(100,'A',['A','B'],{stopIds:['s']})]);data.days=[[{id:'s',costItems:[]}]];assert.equal(F.collect(data)[0].day,0,'linked expense counted once on its schedule day');
console.log('PASS: selected-person split, exact rounding, non-beneficiary payer, offsets, self/settled exclusion, missing assignments, pool, frozen legacy totals, empty registration, and round-trip.');

r=F.calculate(make([expense(300000,'self',[],{amountBasis:'perPerson',peopleSnapshot:4,allocationConfirmed:true})]),convert);for(const member of r.balances.filter(p=>p.id!=='pool')){assert.equal(member.owed,300000);assert.equal(member.paid,300000);}assert.equal(r.missing.length,0);assert.equal(r.transfers.length,0);assert.equal(F.perPersonOriginal(expense(1200000,'self',[]),4),300000);console.log('PASS: each traveler pays 300000 directly, no split selection or settlement required; legacy total edits as per-person amount.');

r=F.calculate(make([expense(400,'A',['A','B','C','D'],{settlementStatus:'progress',reimbursedIds:['B','C']})]),convert);assert.deepEqual(plain(r.transfers),[{from:'D',to:'A',amount:100}]);assert.equal(r.unsettled,100);assert.equal(r.total,400);assert.equal(r.balances.reduce((sum,p)=>sum+p.balance,0),0);for(const person of r.balances.filter(p=>p.id!=='pool'))assert.equal(person.owed,100);r=F.calculate(make([expense(400,'A',['A','B','C','D'],{settlementStatus:'progress',reimbursedIds:['B','C','D']})]),convert);assert.equal(r.transfers.length,0);assert.equal(r.unsettled,0);console.log('PASS: two reimbursed travelers are excluded, only unpaid traveler remains; spending totals stay unchanged.');

const selfEntry=expense(70000,'self',[],{amountBasis:'perPerson',peopleSnapshot:4});const poolEntry={...selfEntry,...F.changePayer(selfEntry,'pool',4,members)};assert.equal(poolEntry.actual,70000);assert.equal(poolEntry.amountBasis,'total');r=F.calculate(make([poolEntry]),convert);assert.equal(r.total,70000);for(const person of r.balances.filter(p=>p.id!=='pool'))assert.equal(person.owed,17500);const back={...poolEntry,...F.changePayer(poolEntry,'self',4,members)};assert.equal(back.actual,70000);assert.equal(back.amountBasis,'perPerson');r=F.calculate(make([back]),convert);for(const person of r.balances.filter(p=>p.id!=='pool'))assert.equal(person.owed,70000);console.log('PASS: changing self/pool/personal payer never multiplies or divides entered 70000; shared and per-person interpretations remain explicit.');
