// Whole-expense accounting. No participant names are created automatically.
const TravelFinance = (() => {
  const known = e => e && e.actual !== null && e.actual !== undefined && e.actual !== '' && Number.isFinite(Number(e.actual)) && Number(e.actual) >= 0;
  function prepare(data) {
    data.settings.members ??= [];
    const people = Math.max(1, Number(data.settings.people) || 1);
    function legacy(entry, basis) {
      if (!entry.amountBasis) { entry.amountBasis = basis; entry.peopleSnapshot = people; entry.allocationConfirmed = false; }
      entry.splitIds ??= [];
      entry.payerId ??= '';
      entry.settlementStatus ??= 'pending';
    }
    for (const stops of data.days) for (const stop of stops) {
      for (const entry of stop.costItems || []) legacy(entry, 'perPerson');
      if (stop.actualFare !== null && stop.actualFare !== undefined) { stop.farePayment ??= {}; legacy(stop.farePayment, 'perPerson'); }
    }
    for (const entry of data.expenses) legacy(entry, entry.scope === '전체' ? 'total' : 'perPerson');
    return data.settings.members;
  }
  function totalOriginal(entry, people = 1, legacyBasis = 'perPerson') {
    const multiplier = (entry.amountBasis || legacyBasis) === 'total' ? 1 : Math.max(1, Number(entry.peopleSnapshot ?? people) || 1);
    return Number(entry.actual || 0) * multiplier;
  }
  function perPersonOriginal(entry, people=1) { return totalOriginal(entry,people) / Math.max(1,Number(entry.peopleSnapshot ?? people)||1); }
  function changePayer(entry,payerId,people=1,members=[]) {
    const actual=entry.payerId==='self'?perPersonOriginal(entry,people):totalOriginal(entry,people);
    const splitIds=payerId==='self'?[]:(entry.splitIds?.length?entry.splitIds:members.filter(member=>member.active!==false).map(member=>member.id));
    return {payerId,actual,amountBasis:payerId==='self'?'perPerson':'total',peopleSnapshot:people,splitIds,allocationConfirmed:payerId==='self'||Boolean(payerId&&splitIds.length),reimbursedIds:[],settlementStatus:'pending'};
  }
  function totalKRW(entry, people, convert, legacyBasis = 'perPerson') { const value=Math.round(convert(totalOriginal(entry, people, legacyBasis), entry.currency)); if(!Number.isSafeInteger(value)||value<0)throw Error('환산 금액이 계산 가능한 범위를 벗어났어요. 금액과 환율을 확인해 주세요.'); return value; }
  function collect(data) {
    const rows = [];
    data.days.forEach((stops, day) => stops.forEach((stop, stopIndex) => {
      (stop.costItems || []).forEach((entry, index) => { if (known(entry)) rows.push({entry, day, stopId: stop.id, stopIndex, index, source:'place'}); });
      if (stopIndex < stops.length - 1 && !stop.noTravel && known({actual:stop.actualFare})) rows.push({
        entry: {...(stop.farePayment || {}), actual:stop.actualFare, currency:stop.actualFareCurrency || stop.fareCurrency || 'JPY', id:'fare:'+stop.id, category:stop.farePayment?.category || '교통비', name:stop.farePayment?.name || stop.name+' → '+stops[stopIndex+1].name},
        day, stopId:stop.id, stopIndex, source:'transport',
      });
    }));
    data.expenses.forEach((entry,index) => { if (known(entry)) { const linkedDay=data.days.findIndex(stops=>stops.some(stop=>(entry.stopIds||[]).includes(stop.id))); rows.push({entry,index,day:linkedDay<0?null:linkedDay,source:'common'}); } });
    return rows;
  }
  function shares(total, ids) {
    ids = [...new Set(ids)];
    if (!ids.length) return [];
    const base = Math.floor(total / ids.length), remainder = total % ids.length;
    return ids.map((id,index) => ({id, amount:base + (index < remainder ? 1 : 0)}));
  }
  function calculate(data, convert) {
    const members = prepare(data), rows = collect(data);
    const balances = new Map([...members.map(member => [member.id,{...member, paid:0, owed:0, balance:0}]), ['pool',{id:'pool',name:'공금',paid:0,owed:0,balance:0}]]);
    const missing = [];
    let total = 0, unsettled = 0;
    for (const row of rows) {
      const entry=row.entry, amount=totalKRW(entry,data.settings.people,convert, row.source==='common' && entry.scope==='전체'?'total':'perPerson');
      row.total=amount; total+=amount;
      const splitIds=entry.payerId === "self" ? members.filter(p=>p.active!==false).map(p=>p.id) : entry.splitIds || [];
      const ids=[...new Set(splitIds)].filter(id=>balances.has(id)&&id!=='pool');
      row.shares=entry.payerId === "self" ? ids.map(id=>({id,amount: Math.round(convert(perPersonOriginal(entry,data.settings.people),entry.currency))})) : ids.length===new Set(splitIds).size?shares(amount,ids):[];
      const payer=entry.payerId, validPayer=payer==='self'||balances.has(payer);
      row.needsReview=payer!=="self" && amount>0 && (entry.allocationConfirmed===false || !ids.length || ids.length!==new Set(splitIds).size || !validPayer);
      if(row.needsReview) missing.push(row);
      for(const share of row.shares) balances.get(share.id).owed+=share.amount;
      if(payer==='self') for(const share of row.shares) balances.get(share.id).paid+=share.amount;
      else if(balances.has(payer)) balances.get(payer).paid+=amount;
      if(!amount || row.needsReview || entry.settlementStatus==='settled' || payer==='self') continue;
      const repaid=new Set(entry.reimbursedIds||[]);
      const completed=row.shares.filter(share=>share.id!==payer&&repaid.has(share.id)).reduce((sum,share)=>sum+share.amount,0);
      unsettled+=row.shares.filter(share=>share.id!==payer&&!repaid.has(share.id)).reduce((sum,share)=>sum+share.amount,0);
      balances.get(payer).balance+=amount-completed;
      for(const share of row.shares)if(share.id===payer||!repaid.has(share.id))balances.get(share.id).balance-=share.amount;
    }
    const creditors=[...balances.values()].filter(p=>p.balance>0).map(p=>({id:p.id,remaining:p.balance})).sort((a,b)=>b.remaining-a.remaining);
    const debtors=[...balances.values()].filter(p=>p.balance<0).map(p=>({id:p.id,remaining:-p.balance})).sort((a,b)=>b.remaining-a.remaining);
    const transfers=[];let c=0,d=0;
    while(c<creditors.length&&d<debtors.length){const amount=Math.min(creditors[c].remaining,debtors[d].remaining);if(amount)transfers.push({from:debtors[d].id,to:creditors[c].id,amount});creditors[c].remaining-=amount;debtors[d].remaining-=amount;if(!creditors[c].remaining)c++;if(!debtors[d].remaining)d++;}
    return {total,unsettled,rows,missing,balances:[...balances.values()],transfers};
  }
  function validate(data) {
    const members=data.settings?.members;
    if(members!==undefined&&(!Array.isArray(members)||members.length>50||members.some(p=>!p||typeof p.id!=='string'||typeof p.name!=='string'||!p.name.trim()||p.name.length>40||(p.active!==undefined&&typeof p.active!=='boolean'))||new Set(members.map(p=>p.id)).size!==members.length))return false;
    const entry=e=>e&&(e.reimbursedIds===undefined||(Array.isArray(e.reimbursedIds)&&e.reimbursedIds.length<=50&&e.reimbursedIds.every(id=>typeof id==='string')))&&[undefined,'total','perPerson'].includes(e.amountBasis)&&(e.peopleSnapshot===undefined||(Number.isInteger(e.peopleSnapshot)&&e.peopleSnapshot>0&&e.peopleSnapshot<=50))&&(e.payerId===undefined||typeof e.payerId==='string')&&(e.splitIds===undefined||(Array.isArray(e.splitIds)&&e.splitIds.length<=50&&e.splitIds.every(id=>typeof id==='string')))&&[undefined,'pending','progress','settled'].includes(e.settlementStatus)&&(e.allocationConfirmed===undefined||typeof e.allocationConfirmed==='boolean')&&(e.actual===undefined||e.actual===null||(Number.isFinite(e.actual)&&e.actual>=0));
    if(!data.expenses.every(entry)||!data.days.every(stops=>stops.every(stop=>(stop.costItems||[]).every(entry)&&(!stop.farePayment||entry(stop.farePayment)))))return false;
    if(data.preparation!==undefined&&(!Array.isArray(data.preparation)||data.preparation.length>1000||data.preparation.some(t=>!t||typeof t.id!=='string'||typeof t.title!=='string'||!['todo','doing','done'].includes(t.status)||(t.checklist!==undefined&&(!Array.isArray(t.checklist)||t.checklist.some(c=>typeof c.text!=='string'||typeof c.done!=='boolean'))))))return false;
    if(data.resources!==undefined&&(!Array.isArray(data.resources)||data.resources.length>2000||data.resources.some(r=>!r||typeof r.id!=='string'||typeof r.title!=='string'||(r.references!==undefined&&(!Array.isArray(r.references)||r.references.length>200||r.references.some(link=>!link||typeof link.id!=='string'||typeof link.url!=='string')))||(r.note!==undefined&&typeof r.note!=='string')||(r.stopIds!==undefined&&(!Array.isArray(r.stopIds)||r.stopIds.some(id=>typeof id!=='string'))))))return false;
    return true;
  }
  return {prepare,known,totalOriginal,perPersonOriginal,changePayer,totalKRW,collect,shares,calculate,validate};
})();
if (typeof module !== 'undefined') module.exports = TravelFinance;
