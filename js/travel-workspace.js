function initializeSettlementStatuses(data) {
  if(data.settings.inlineSettlementVersion === 1)return false;
  TravelFinance.prepare(data);
  for(const stops of data.days)for(const stop of stops){for(const entry of stop.costItems||[])entry.settlementStatus="pending";if(stop.farePayment)stop.farePayment.settlementStatus="pending";}
  for(const entry of data.expenses)entry.settlementStatus="pending";
  data.settings.inlineSettlementVersion=1;return true;
}
function applyInlineExpensePatch(row, patch) {
  if(row.source === "transport") { const stop=state.days[row.day][row.stopIndex]; if(patch.actual !== undefined)stop.actualFare=patch.actual;if(patch.currency)stop.actualFareCurrency=patch.currency;stop.farePayment={...(stop.farePayment||{}),...patch};Object.assign(row.entry,patch); }
  else Object.assign(row.entry,patch);
}
function scheduleLinkPicker(selected=[],name='expense-stop') {
  const selectedDay=state.days.findIndex(stops=>stops.some(stop=>selected.includes(stop.id)));
  const active=selectedDay<0?0:selectedDay;
  return '<div class="schedule-link-picker" data-link-day="'+active+'"><input class="schedule-link-search" type="search" placeholder="장소 이름 검색" aria-label="연결할 일정 검색" /><div class="schedule-link-days">'+state.days.map((_,d)=>'<button type="button" data-link-day="'+d+'" aria-pressed="'+(d===active)+'">Day '+(d+1)+'</button>').join('')+'<button type="button" data-link-day="all" aria-pressed="false">전체</button></div><div class="schedule-link-selected">'+selected.map(id=>{const stop=state.days.flat().find(stop=>stop.id===id);return stop?'<button type="button" data-unlink-stop="'+esc(id)+'">'+esc(stop.name)+' ×</button>':'';}).join('')+'</div><div class="schedule-link-options">'+state.days.flatMap((stops,d)=>stops.map(stop=>'<label data-link-option-day="'+d+'" data-link-search="'+esc(stop.name.toLowerCase())+'" '+(d===active?'':'hidden')+'><input type="checkbox" name="'+name+'" value="'+esc(stop.id)+'" '+(selected.includes(stop.id)?'checked':'')+' /><span>'+esc(stop.name)+'</span></label>')).join('')+'</div><p class="schedule-link-empty" hidden>해당 일정이 없어요.</p></div>';
}
function filterScheduleLinks(picker) {
  const query=picker.querySelector('.schedule-link-search').value.trim().toLowerCase();let count=0;
  picker.querySelectorAll('[data-link-option-day]').forEach(option=>{option.hidden=!(query?option.dataset.linkSearch.includes(query):picker.dataset.linkDay==='all'||option.dataset.linkOptionDay===picker.dataset.linkDay);if(!option.hidden)count++;});
  picker.querySelector('.schedule-link-empty').hidden=count>0;
}
function updateScheduleLinkChips(picker) {
  const selected=[...picker.querySelectorAll('input:checked')].map(input=>({id:input.value,label:input.closest('label').querySelector('span').textContent}));
  picker.querySelector('.schedule-link-selected').innerHTML=selected.map(stop=>'<button type="button" data-unlink-stop="'+esc(stop.id)+'">'+esc(stop.label)+' ×</button>').join('');
}
function expenseScheduleFields(entry) {
  const selected=entry?.stopIds||[];
  return '<details class="expense-related-schedules" '+(selected.length?'open':'')+'><summary>일정 연결'+(selected.length?' · '+selected.length+'개':'')+'</summary>'+scheduleLinkPicker(selected)+'</details>';
}
document.addEventListener('input',event=>{if(event.target.matches?.('.schedule-link-search'))filterScheduleLinks(event.target.closest('.schedule-link-picker'));});
document.addEventListener('change',event=>{const picker=event.target.closest('.schedule-link-picker');if(picker)updateScheduleLinkChips(picker);});
document.addEventListener('click',event=>{
  const button=event.target.closest('[data-link-day], [data-unlink-stop]');if(!button||button.tagName!=='BUTTON')return;
  const picker=button.closest('.schedule-link-picker');if(!picker)return;event.preventDefault();
  if(button.dataset.unlinkStop){const input=[...picker.querySelectorAll('input[type="checkbox"]')].find(input=>input.value===button.dataset.unlinkStop);if(input){input.checked=false;input.dispatchEvent(new Event('change',{bubbles:true}));}return;}
  picker.dataset.linkDay=button.dataset.linkDay;picker.querySelectorAll('.schedule-link-days button').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));picker.querySelector('.schedule-link-search').value='';filterScheduleLinks(picker);
});
function expensePayerField(entry,members){
  if (Number(state.settings.people) === 1) return '<input type="hidden" id="f-payer" value="self" />';
  const payer=entry?.payerId||'',mode=['self','pool'].includes(payer)?payer:'person';
  return '<div class="expense-payer-field" data-person="'+esc(mode==='person'?payer:'')+'"><b>누가 결제했나요?</b><input type="hidden" id="f-payer" value="'+esc(payer)+'" /><div class="payer-modes">'+[['self','각자 결제'],['person','한 사람이 결제'],...(payer==='pool'?[['pool','공금 · 기존 기록']]:[])].map(([key,label])=>'<button type="button" data-payer-mode="'+key+'" aria-pressed="'+(mode===key)+'">'+label+'</button>').join('')+'</div><div class="payer-person-options" '+(mode!=='person'?'hidden':'')+'>'+members.map(member=>'<button type="button" data-value-target="f-payer" data-value="'+esc(member.id)+'" class="'+(payer===member.id?'chosen':'')+'" aria-pressed="'+(payer===member.id)+'">'+esc(member.name)+'</button>').join('')+(!members.length?'<small>여행 설정에서 동행인 이름을 등록해 주세요.</small>':'')+'</div></div>';
}
// People are registered explicitly by the traveler; imports never create names.
function expenseAllocationFields(entry = null) {
  TravelFinance.prepare(state);
  if (Number(state.settings.people) === 1) return '<section class="expense-allocation" id="expense-allocation" data-solo="true"><input type="hidden" id="f-payer" value="self" /><input type="hidden" id="f-settlementstatus" value="settled" /><div id="expense-split-preview" hidden></div></section>';
  const members=state.settings.members.filter(p=>p.active!==false || entry?.splitIds?.includes(p.id) || entry?.payerId===p.id);
  const selected=entry?.splitIds ?? members.filter(p=>p.active!==false).map(p=>p.id);
  return '<section class="expense-allocation" id="expense-allocation">'+expensePayerField(entry,members)+
    '<div class="split-controls" '+(entry?.payerId==='self'?'hidden':'')+'><div class="allocation-heading"><b>나눌 사람</b><div><button type="button" data-split-select="all">전체 선택</button><button type="button" data-split-select="none">선택 해제</button></div></div>'+
    (members.length?'<div class="person-chips">'+members.map(p=>'<label class="person-chip"><input type="checkbox" name="expense-split" value="'+esc(p.id)+'" '+(selected.includes(p.id)?'checked':'')+' /><span>'+esc(p.name)+(p.active===false?' (이전 동행인)':'')+'</span></label>').join('')+'</div>':'<p class="note">여행 정보 수정에서 이름을 등록하면 지출자와 나눌 대상을 선택할 수 있어요.</p>')+
    '</div><div id="expense-split-preview" class="expense-split-preview" role="status" aria-live="polite"></div>'+
    '<input type="hidden" id="f-settlementstatus" value="'+esc(entry?.settlementStatus || 'pending')+'" />'+
    '<p class="note" id="allocation-note">'+(entry?.payerId==='self'?'1인당 결제한 금액을 입력하세요. 등록한 여행자 각각의 지출로 기록하고, 나누기와 정산에서는 제외해요.':'선택한 사람끼리 결제 총액을 나눠요.')+'</p></section>';
}
function readExpenseAllocation() {
  if (Number(state.settings.people) === 1) return {payerId:'self',splitIds:[],settlementStatus:'settled',allocationConfirmed:true,amountBasis:'total',peopleSnapshot:1};
  const members=state.settings.members || [], valid=new Set(members.map(p=>p.id));
  const payerId=val('payer'), splitIds=[...document.querySelectorAll('#expense-allocation input[name="expense-split"]:checked')].map(n=>n.value);
  if(splitIds.some(id=>!valid.has(id)) || (payerId && !valid.has(payerId) && !['self','pool'].includes(payerId))) throw Error('지출자와 나눌 사람을 다시 선택해 주세요.');
  if(payerId!=='self' && members.length && !splitIds.length) throw Error('비용을 나눌 사람을 한 명 이상 선택해 주세요.');
  const status=val('settlementstatus');
  if(!['pending','progress','settled'].includes(status)) throw Error('정산 상태를 확인해 주세요.');
  return {payerId,splitIds:payerId==='self'?[]:splitIds,settlementStatus:status,allocationConfirmed:payerId==='self'||splitIds.length>0,amountBasis:payerId==='self'?'perPerson':'total',peopleSnapshot:Math.max(1,members.filter(p=>p.active!==false).length || state.settings.people)};
}
function updateExpenseSplitPreview() {
  const root=document.querySelector('#expense-allocation'), preview=document.querySelector('#expense-split-preview');
  if(!root || !preview) return;
  const amount=document.querySelector(root.dataset.amountInput || '#f-actual'), currency=document.querySelector(root.dataset.currencyInput || '#f-currency');
  if (Number(state.settings.people) === 1) {
    preview.hidden = true;
    const label = amount?.closest('label');
    if (label?.firstChild) label.firstChild.textContent = '실제 지출 금액';
    return;
  }
  const self=val('payer')==='self';
  const split=root.querySelector('.split-controls'); if(split)split.hidden=self;
  const status=document.querySelector('#f-settlementstatus')?.closest('.button-field');if(status)status.hidden=self;
  if(amount){const label=amount.closest('label');if(label?.firstChild)label.firstChild.textContent=self?'실제 지출 · 1인당 결제 금액':'실제 지출 · 결제 총액';}
  const note=document.querySelector('#allocation-note');if(note)note.textContent=self?'1인당 금액을 입력하면 등록한 여행자 각각의 지출로 기록해요. 나누기와 정산은 필요 없어요.':'선택한 사람끼리 결제 총액을 나눠요.';
  if(self){preview.textContent=amount?.value ? '1인당 '+money(won(Number(amount.value)||0,currency?.value || 'KRW'))+' · 각자 결제 (정산 없음)' : '각자 결제한 1인당 금액을 입력해 주세요.';return;}
  if(!amount || !currency || amount.value===''){preview.textContent='총액을 입력하면 선택한 사람별 부담액을 볼 수 있어요.';return;}
  const value=Number(amount.value);if(!Number.isFinite(value)||value<0){preview.textContent='0 이상의 금액을 입력해 주세요.';return;}
  const ids=[...root.querySelectorAll('input[name="expense-split"]:checked')].map(n=>n.value);
  if(!ids.length){preview.textContent='나눌 사람을 선택해 주세요.';return;}
  try{preview.innerHTML='<small>원화 기준 부담액 · 1원 차이는 자동 배분</small><div>'+TravelFinance.shares(Math.round(won(value,currency.value)),ids).map(s=>'<span>'+esc(state.settings.members.find(p=>p.id===s.id)?.name || '')+' <b>'+money(s.amount)+'</b></span>').join('')+'</div>';}catch(error){preview.textContent=error.message;}
}
(function(){
  const beforeValidData=validAnyData;validAnyData=data=>beforeValidData(data)&&TravelFinance.validate(data);
  const statusLabels={pending:'정산 전',progress:'정산 중',settled:'정산 완료'};
  const prepStatuses={todo:'해야 할 일',doing:'진행 중',done:'완료'};
  let workspaceTripId='', materialFilter=null, ledgerFilter=null, workspaceFiles=[], fileTrip='', fileBusy=false;
  const activeMembers=()=>state.settings.members.filter(p=>p.active!==false);
  const memberName=id=>id==='self'?'각자 결제':id==='pool'?'공금':state.settings.members.find(p=>p.id===id)?.name || '미지정';
  function allocationText(entry){return entry.payerId==='self'?'각자 결제':(entry.splitIds||[]).map(memberName).join(' · ')||'함께 쓴 사람 미지정';}
  const relatedStops=ids=>(ids||[]).map(id=>state.days.flat().find(s=>s.id===id)).filter(Boolean);
  function refresh(){save();render();}
  function ledgerAmountHtml(row){
    const e=row.entry,self=e.payerId==='self',amount=self?TravelFinance.perPersonOriginal(e,state.settings.people):TravelFinance.totalOriginal(e,state.settings.people,row.source==='common'&&e.scope==='전체'?'total':'perPerson');
    return '<span class="ledger-amount">'+formatCurrency(amount,e.currency)+'</span>'+(self?'<small>1인당</small>':'')+(e.currency==='KRW'?'':'<small>약 '+money(self?Math.round(won(amount,e.currency)):row.total)+'</small>');
  }
  function expenseRows(result){
    const cell=(index,field,html)=>'<button type="button" class="ledger-cell" data-ledger-cell="'+index+'" data-ledger-field="'+field+'" aria-haspopup="dialog">'+html+'</button>';
    return result.rows.map((row,index)=>({...row,ledgerIndex:index})).filter(row=>!ledgerFilter||row.stopId===ledgerFilter||row.entry.stopIds?.includes(ledgerFilter)).map(row=>{
      const e=row.entry,i=row.ledgerIndex,self=e.payerId==='self';
      return '<tr><td>'+cell(i,'name','<b>'+esc(e.name)+'</b>')+cell(i,'category','<small>'+esc(e.category||'기타')+'</small>')+cell(i,'stopIds','<small>'+ (e.stopIds?.length?relatedStops(e.stopIds).map(stop=>esc(stop.name)).join(' / '):row.day===null?'＋ 일정 연결':'Day '+(row.day+1))+'</small>')+'</td><td>'+cell(i,'amount',ledgerAmountHtml(row))+'</td><td>'+cell(i,'payerId',esc(memberName(e.payerId)))+'</td><td>'+(self?cell(i,'splitIds','각자 부담 · 나누기 변경'):cell(i,'splitIds',row.shares.length?row.shares.map(share=>esc(memberName(share.id))+' '+money(share.amount)).join(' · '):'＋ 나눌 사람'))+(row.needsReview?'<small class="warning">지출자·나눌 대상 확인 필요</small>':'')+'</td><td>'+cell(i,'settlementStatus','<span class="settlement-state status-'+esc(e.settlementStatus||'pending')+'">'+statusLabels[e.settlementStatus||'pending']+'</span>'+((e.reimbursedIds||[]).length&&e.settlementStatus!=='settled'?'<small>'+e.reimbursedIds.length+'명 보냄</small>':''))+'</td></tr>';
    }).join('');
  }
  let ledgerPopover=null;
  function closeLedgerPopover(){if(ledgerPopover){ledgerPopover.remove();ledgerPopover=null;}}
  function editLedgerCell(button){
    closeLedgerPopover();
    const index=Number(button.dataset.ledgerCell),row=TravelFinance.calculate(state,won).rows[index];if(!row)return;
    const field=button.dataset.ledgerField,e=row.entry;
    const panel=document.createElement('div');ledgerPopover=panel;panel.className='ledger-popover';panel.setAttribute('role','dialog');panel.setAttribute('aria-label','지출 '+({settlementStatus:'정산 상태',payerId:'지출자',splitIds:'나눌 사람',amount:'금액',name:'항목 이름',category:'분류',stopIds:'일정 연결'}[field]||''));
    const options=values=>values.map(([value,label])=>'<button type="button" data-inline-value="'+esc(value)+'" aria-pressed="'+(e[field]===value)+'">'+esc(label)+(e[field]===value?' ✓':'')+'</button>').join('');
    const check=(name,id,label,checked)=>'<label><input type="checkbox" name="'+name+'" value="'+esc(id)+'" '+(checked?'checked':'')+' />'+esc(label)+'</label>';
    if(field==='settlementStatus'){const targets=row.shares.filter(share=>share.id!==e.payerId&&e.payerId!=='self');panel.innerHTML=options(Object.entries(statusLabels))+(targets.length?'<div class="partial-settlement"><b>이 항목에서 돈을 보낸 사람</b>'+targets.map(share=>check('inline-repaid',share.id,memberName(share.id)+' · '+money(share.amount),e.settlementStatus==='settled'||(e.reimbursedIds||[]).includes(share.id))).join('')+'</div>':'');}
    else if(field==='payerId')panel.innerHTML='<div class="payer-quick-grid">'+options([['self','각자 결제'],...(e.payerId==='pool'?[['pool','공금 · 기존 기록']]:[])])+'</div><p class="payer-section-label">결제한 사람</p><div class="payer-name-grid">'+options(state.settings.members.filter(p=>p.active!==false||p.id===e.payerId).map(p=>[p.id,p.name]))+'</div>'+options([['','미지정']]);
    else if(field==='category')panel.innerHTML=options(spendCategories.map(c=>[c,c]));
    else if(field==='splitIds')panel.innerHTML=e.payerId==='self'?'<p>각자 결제한 금액을 공동 결제로 바꿔 나눌 수 있어요.</p><button type="button" data-enable-split>함께 나누기로 변경</button>':'<div class="inline-split-heading"><b>나눌 사람</b><button type="button" data-inline-split-all>전체</button></div>'+state.settings.members.map(p=>check('inline-split',p.id,p.name,(e.splitIds||[]).includes(p.id))).join('')+(!state.settings.members.length?'<p>여행 정보 수정에서 동행인 이름을 등록해 주세요.</p>':'');
    else if(field==='stopIds')panel.innerHTML=row.source!=='common'?'<p>이 지출은 현재 장소에 직접 기록되어 있어요.</p>':'<b>일정 연결</b>'+scheduleLinkPicker(e.stopIds||[],'inline-stop');
    else if(field==='name')panel.innerHTML='<form><label>항목 이름<input name="name" maxlength="150" required value="'+esc(e.name)+'" /></label><button class="primary" type="submit">적용</button></form>';
    else if(field==='amount')panel.innerHTML='<form><label>'+(e.payerId==='self'?'1인당 금액':'결제 총액')+'<input name="amount" type="number" min="0" step="any" required value="'+esc(e.payerId==='self'?TravelFinance.perPersonOriginal(e,state.settings.people):TravelFinance.totalOriginal(e,state.settings.people))+'" /></label><div class="inline-currencies"><span>통화</span><input type="hidden" name="currency" value="'+esc(e.currency)+'" />'+expenseCurrencyOptions().map(c=>'<button type="button" data-inline-currency="'+esc(c)+'" aria-pressed="'+(e.currency===c)+'">'+esc(c==='KRW'?'원':c)+'</button>').join('')+'</div><button class="primary" type="submit">적용</button></form>';
    panel.insertAdjacentHTML('beforeend','<button type="button" class="inline-close">닫기</button>');document.body.append(panel);
    const rect=button.getBoundingClientRect();panel.style.left=Math.max(8,Math.min(rect.left,window.innerWidth-panel.getBoundingClientRect().width-8))+'px';panel.style.top=Math.max(8,Math.min(rect.bottom+6,window.innerHeight-panel.getBoundingClientRect().height-8))+'px';
    const commit=(patch,close=true)=>{applyInlineExpensePatch(row,patch);save();render();if(close)closeLedgerPopover();};
    panel.onclick=event=>{if(event.target.closest('[data-inline-split-all]')){const active=new Set(state.settings.members.filter(member=>member.active!==false).map(member=>member.id));const inputs=[...panel.querySelectorAll('input[name="inline-split"]')];inputs.forEach(input=>input.checked=active.has(input.value));if(inputs[0])inputs[0].dispatchEvent(new Event('change',{bubbles:true}));return;}if(event.target.closest('[data-enable-split]')){commit(TravelFinance.changePayer(e,'',state.settings.people,state.settings.members));return;}const currency=event.target.closest('[data-inline-currency]');if(currency){panel.querySelector('input[name="currency"]').value=currency.dataset.inlineCurrency;panel.querySelectorAll('[data-inline-currency]').forEach(button=>button.setAttribute('aria-pressed',String(button===currency)));}const option=event.target.closest('[data-inline-value]');if(option){const value=option.dataset.inlineValue;const patch={[field]:value};if(field==='settlementStatus'&&value==='pending')patch.reimbursedIds=[];if(field==='payerId'&&value!==e.payerId)Object.assign(patch,TravelFinance.changePayer(e,value,state.settings.people,state.settings.members));commit(patch);}if(event.target.closest('.inline-close'))closeLedgerPopover();};
    panel.onchange=event=>{if(event.target.name==='inline-repaid'){const ids=[...panel.querySelectorAll('input[name="inline-repaid"]:checked')].map(n=>n.value),count=panel.querySelectorAll('input[name="inline-repaid"]').length;const status=ids.length===count?'settled':ids.length?'progress':'pending';commit({reimbursedIds:ids,settlementStatus:status},false);panel.querySelectorAll('[data-inline-value]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.inlineValue===status)));}if(event.target.name==='inline-split'){const splitIds=[...panel.querySelectorAll('input[name="inline-split"]:checked')].map(n=>n.value),targets=splitIds.filter(id=>id!==e.payerId),old=e.settlementStatus==='settled'?(e.splitIds||[]):e.reimbursedIds||[],reimbursedIds=targets.filter(id=>old.includes(id));commit({splitIds,reimbursedIds,allocationConfirmed:splitIds.length>0,settlementStatus:targets.length&&reimbursedIds.length===targets.length?'settled':reimbursedIds.length?'progress':'pending'},false);}if(event.target.name==='inline-stop')commit({stopIds:[...panel.querySelectorAll('input[name="inline-stop"]:checked')].map(n=>n.value)},false);};
    const form=panel.querySelector('form');if(form)form.onsubmit=event=>{event.preventDefault();if(field==='name'){const name=form.elements.name.value.trim();if(!name)return;commit({name});}else {const actual=Number(form.elements.amount.value);if(!Number.isFinite(actual)||actual<0)return;commit({actual,currency:form.elements.currency.value,amountBasis:e.payerId==='self'?'perPerson':'total',peopleSnapshot:state.settings.people});}};
    panel.querySelector('input,button')?.focus();
  }
  document.addEventListener('pointerdown',event=>{if(ledgerPopover&&!ledgerPopover.contains(event.target)&&!event.target.closest('[data-ledger-cell]'))closeLedgerPopover();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')closeLedgerPopover();});
  function transferCards(result){
    const groups=new Map();for(const transfer of result.transfers){if(!groups.has(transfer.to))groups.set(transfer.to,[]);groups.get(transfer.to).push(transfer);}
    return '<div class="settlement-transfers">'+[...groups].map(([to,items])=>'<section class="settlement-recipient"><div class="recipient-heading"><span class="person-avatar">'+esc(memberName(to).slice(0,1))+'</span><div><b>'+esc(memberName(to))+'에게 보낼 금액</b><small>아직 보내지 않은 금액</small></div></div>'+items.map(item=>'<div class="transfer-person"><span>'+esc(memberName(item.from))+'</span><b>'+money(item.amount)+'</b></div>').join('')+'</section>').join('')+'</div>';
  }
  function settlementView(){const result=TravelFinance.calculate(state,won);
    return '<section class="workspace-panel expense-panel'+(Number(state.settings.people)===1?' is-solo':'')+'"><div class="workspace-heading"><div><small>'+(Number(state.settings.people)===1?'예산 · 지출':'예산 · 지출 · 정산')+'</small><h2>경비</h2></div><div class="tools">'+(ledgerFilter?'<button data-ledger-clear>전체 지출 보기</button>':'')+'<button class="primary" data-common-expense>＋ 지출 추가</button></div></div>'+actualDashboard()+
      '<div class="workspace-subheading"><h3>지출 내역</h3><span>'+result.rows.length+'건</span></div><div class="table-scroll"><table class="workspace-table expense-ledger"><thead><tr><th>항목·일정</th><th>금액</th><th>결제한 사람</th><th>함께 쓴 사람</th><th>정산</th></tr></thead><tbody>'+expenseRows(result)+'</tbody></table></div>'+
      '<details class="settlement-details"><summary>정산 확인'+(result.transfers.length?' · '+result.transfers.length+'건':'')+'</summary><h3>주고받을 금액</h3>'+(result.transfers.length?transferCards(result):'<p class="note">'+(result.missing.length?'지출 내역에서 결제한 사람과 함께 쓴 사람을 확인해 주세요.':'현재 주고받을 금액이 없어요.')+'</p>')+
      (state.settings.members.length?'<div class="table-scroll"><table class="workspace-table"><thead><tr><th>사람</th><th>사용 금액</th><th>결제 금액</th><th>남은 정산</th></tr></thead><tbody>'+result.balances.filter(p=>p.id!=='pool'||p.paid||p.balance).map(p=>'<tr><td>'+esc(p.name)+'</td><td>'+money(p.owed)+'</td><td>'+money(p.paid)+'</td><td>'+(p.balance>0?'받을 ':p.balance<0?'보낼 ':'')+money(Math.abs(p.balance))+'</td></tr>').join('')+'</tbody></table></div>':'<p class="note">여행 정보에 동행 이름을 등록하면 정산할 수 있어요.</p>')+'</details></section>';
  }
  const defaultWorkspaceTabs=[{key:'itinerary',label:'여행 일정',emoji:'🗓️'},{key:'list',label:'시간표',emoji:'📋'},{key:'settlement',label:'경비',emoji:'💸'},{key:'preparation',label:'체크리스트',emoji:'🧳'},{key:'materials',label:'자료실',emoji:'🎟️'}];
  function workspaceTabs(){const saved=Array.isArray(trip().workspaceTabs)?trip().workspaceTabs:[],seen=new Set();return [...saved,...defaultWorkspaceTabs].filter(t=>t&&defaultWorkspaceTabs.some(d=>d.key===t.key)&&!seen.has(t.key)&&seen.add(t.key)).map(t=>({...defaultWorkspaceTabs.find(d=>d.key===t.key),...t,label:({'경비 나누기':'경비','리스트·경비':'시간표','여행 준비':'체크리스트'})[t.label]||t.label}));}
  function editWorkspaceTabs(){
    let draft=workspaceTabs().map(t=>({...t}));
    const rows=()=>draft.map((t,i)=>'<div class="tab-editor-row" data-tab-row="'+t.key+'"><input aria-label="'+esc(t.label)+' 이모지" data-tab-emoji maxlength="16" value="'+esc(t.emoji)+'" /><input aria-label="탭 이름" data-tab-label maxlength="30" value="'+esc(t.label)+'" /><label><input type="checkbox" data-tab-visible '+(!t.hidden?'checked':'')+' />표시</label><button type="button" data-tab-move="'+i+'" data-direction="-1" '+(!i?'disabled':'')+' aria-label="'+esc(t.label)+' 앞으로 이동">↑</button><button type="button" data-tab-move="'+i+'" data-direction="1" '+(i===draft.length-1?'disabled':'')+' aria-label="'+esc(t.label)+' 뒤로 이동">↓</button></div>').join('');
    const read=()=>document.querySelectorAll('[data-tab-row]').forEach(row=>{const t=draft.find(t=>t.key===row.dataset.tabRow);t.emoji=row.querySelector('[data-tab-emoji]').value.trim();t.label=row.querySelector('[data-tab-label]').value.trim()||defaultWorkspaceTabs.find(d=>d.key===t.key).label;t.hidden=!row.querySelector('[data-tab-visible]').checked;});
    modal('<h2>✨ 내 여행 탭 꾸미기</h2><p class="note">화살표로 순서를 바꾸고, 이모지와 이름을 자유롭게 골라보세요. 쓰지 않는 탭은 숨길 수 있어요.</p><div id="tab-editor">'+rows()+'</div>',()=>{read();if(draft.every(t=>t.hidden))throw Error('탭을 하나 이상 표시해 주세요.');trip().workspaceTabs=draft;const active=trip().workspaceView==='itinerary'&&trip().viewMode==='list'?'list':trip().workspaceView||'itinerary';if(draft.find(t=>t.key===active)?.hidden){const next=draft.find(t=>!t.hidden).key;trip().workspaceView=next==='list'?'itinerary':next;if(next==='list'||next==='itinerary')trip().viewMode=next==='list'?'list':'map';}});
    document.querySelector('#tab-editor').onclick=event=>{const button=event.target.closest('[data-tab-move]');if(!button)return;read();const index=Number(button.dataset.tabMove),next=index+Number(button.dataset.direction);if(next<0||next>=draft.length)return;[draft[index],draft[next]]=[draft[next],draft[index]];document.querySelector('#tab-editor').innerHTML=rows();document.querySelector('[data-tab-row="'+draft[next].key+'"] [data-direction="'+button.dataset.direction+'"]').focus();};
  }
  const prepCategories=['챙길 것','미리 할 일','기타'];
  function deletePrepTask(id){
    const index=state.preparation?.findIndex(task=>task.id===id);
    if(index===undefined||index<0)return;
    state.preparation.splice(index,1);
    if(document.querySelector('#modal').open)document.querySelector('#modal').close();
    refresh();
    toast('할 일을 삭제했어요.');
  }
  function prepTitle(task){return [task.emoji,task.title].filter(Boolean).join(' ');}
  function prepCategory(task){const c=task?.category;return prepCategories.includes(c)?c:['짐 싸기'].includes(c)?'챙길 것':['예약','티켓·투어','숙소','서류·입국','이동·통신','즐길 거리'].includes(c)?'미리 할 일':'기타';}
  function prepView(){state.preparation??=[];const total=state.preparation.length;return '<section class="workspace-panel prep-panel"><div class="workspace-heading"><div><small>가볍게 챙기고, 설레게 떠나요</small><h2>🧳 여행 체크리스트</h2><p class="note">여기에는 해야 할 일만 적어요. 확인서와 티켓 파일은 자료실에 모아두세요.</p></div><div class="tools"><button type="button" data-prep-template>기본 목록 추가</button><button class="primary" data-prep-add>＋ 할 일 추가</button></div></div>'+(!total?'<div class="prep-welcome"><b>여행 전, 무엇을 챙길까요?</b><p>🛂 여권 확인 · 📱 eSIM 구매 · 🎒 충전기 챙기기</p><small>할 일에 이모지와 색을 더해 나만의 목록으로 만들어 보세요.</small></div>':'')+'<div class="prep-board">'+Object.entries(prepStatuses).map(([status,label])=>'<section class="prep-column '+status+'" data-prep-column="'+status+'"><h3>'+label+' <small>'+state.preparation.filter(t=>t.status===status).length+'</small></h3>'+state.preparation.filter(t=>t.status===status).map(t=>'<article class="prep-task tone-'+(['peach','lavender','mint','sky'].includes(t.color)?t.color:'peach')+'" draggable="true" data-prep-id="'+esc(t.id)+'"><button data-prep-edit="'+esc(t.id)+'"><b>'+esc(prepTitle(t))+'</b><small>'+esc(prepCategory(t))+'</small>'+(t.note?'<p class="prep-task-note">'+esc(t.note)+'</p>':'')+(t.checklist?.length?'<span>'+t.checklist.filter(c=>c.done).length+'/'+t.checklist.length+' 준비</span>':'')+'</button><button type="button" class="prep-delete-button" data-prep-delete="'+esc(t.id)+'" aria-label="'+esc(prepTitle(t))+' 삭제">삭제</button></article>').join('')+'<button class="prep-add" data-prep-add="'+status+'">＋ 추가</button></section>').join('')+'</div></section>';}
  function prepForm(id=null,status='todo'){state.preparation??=[];const task=state.preparation.find(t=>t.id===id);
    modal('<h2>체크리스트 '+(task?'수정':'추가')+'</h2>'+input('할 일','preptitle',task?prepTitle(task):'','text','required maxlength="150" placeholder="예: 🎒 충전기 챙기기"')+TravelComponents.choices('상태','prepstatus',Object.entries(prepStatuses).map(([value,label])=>({value,label})),task?.status||status)+TravelComponents.choices('분류','prepcategory',[...new Set([...prepCategories,prepCategory(task)])],prepCategory(task))+TravelComponents.choices('카드 색','prepcolor',[{value:'peach',label:'🍑 피치'},{value:'lavender',label:'💜 라벤더'},{value:'mint',label:'🌿 민트'},{value:'sky',label:'🩵 하늘'}],task?.color||'peach')+'<label>메모<textarea id="f-prepnote">'+esc(task?.note||'')+'</textarea></label>'+(task?.checklist?.length?'<div class="prep-checklist">'+task.checklist.map((item,index)=>'<label><input type="checkbox" data-prep-check="'+index+'" '+(item.done?'checked':'')+' />'+esc(item.text)+'</label>').join('')+'</div>':''),()=>{const title=val('preptitle').trim();if(!title)throw Error('할 일을 입력해 주세요.');const value={...(task||{id:uid()}),title,status:val('prepstatus'),category:val('prepcategory'),emoji:'',color:val('prepcolor'),note:val('prepnote')};if(task?.checklist)value.checklist=task.checklist.map((item,index)=>({...item,done:document.querySelector('[data-prep-check="'+index+'"]').checked}));if(task)Object.assign(task,value);else state.preparation.push(value);});
  }
  function stopChoices(selected){return '<div class="resource-stop-choices">'+state.days.flatMap((stops,d)=>stops.map(s=>'<label class="person-chip"><input type="checkbox" name="resource-stop" value="'+esc(s.id)+'" '+(selected.includes(s.id)?'checked':'')+' /><span>Day '+(d+1)+' · '+esc(s.name)+'</span></label>')).join('')+'</div>';}
  const coverObjectUrls=new Map();
  function resourceCoverSource(resource){
    if(resource.coverFileId){const file=workspaceFiles.find(file=>file.id===resource.coverFileId&&file.resourceId===resource.id);if(file?.blob){if(!coverObjectUrls.has(file.id))coverObjectUrls.set(file.id,URL.createObjectURL(file.blob));return coverObjectUrls.get(file.id);}return '';}
    return TravelMedia.web(resource.cover)?.href||'';
  }
  function clearCoverUrls(){for(const url of coverObjectUrls.values())URL.revokeObjectURL(url);coverObjectUrls.clear();}
  function coverControls(resource){return '<details class="resource-cover-controls"><summary>'+(resource.cover||resource.coverFileId?'커버 변경':'＋ 커버 추가')+'</summary><div class="resource-cover-menu"><button type="button" data-cover-upload>이미지 업로드</button><label>이미지 주소<input type="url" name="resource-cover-url" placeholder="https://…/image.jpg" value="'+esc(resource.cover||'')+'" /></label><button type="button" data-cover-url>주소 적용</button>'+(resource.cover||resource.coverFileId?'<button type="button" data-cover-remove>커버 삭제</button>':'')+'<small>커버는 자료실 카드에만 표시돼요.</small></div></details>';}
  function refreshCoverControls(){const menu=resourcePanel.querySelector('.resource-cover-controls');if(menu&&resourceEditing)menu.outerHTML=coverControls(resourceEditing.resource);}
  function materialsView(){
    state.resources??=[];
    let migrated=false;for(const stop of state.days.flat()){if(!stop.links?.length)continue;let resource=state.resources.find(r=>r.legacyPlaceLinks===stop.id);if(!resource){resource={id:uid(),title:stop.name+' · 참고자료',category:'메모',note:'',stopIds:[stop.id],references:[],legacyPlaceLinks:stop.id};state.resources.push(resource);}resource.references??=[];for(const link of stop.links)if(!resource.references.some(r=>r.url===link.url))resource.references.push({...link,id:link.id||uid()});stop.links=[];migrated=true;}if(migrated)save();
    const items=state.resources.filter(r=>!materialFilter||(r.stopIds||[]).includes(materialFilter)),loose=workspaceFiles.filter(f=>!f.resourceId&&f.kind!=='resource-cover'&&(!materialFilter||f.stopId===materialFilter));
    return '<section class="workspace-panel library-panel compact-library"><div class="workspace-heading"><div><small>예약서 · 파일 · 참고 링크를 한곳에</small><h2>여행 자료실</h2></div><div class="tools">'+(materialFilter?'<button data-resource-clear>전체 자료 보기</button>':'')+'<button class="primary" data-resource-add>＋ 자료 추가</button></div></div><div class="resource-grid">'+items.map(r=>{const files=workspaceFiles.filter(f=>f.resourceId===r.id&&f.kind!=='resource-cover'),cover=resourceCoverSource(r),image=files.find(f=>f.blob?.type.startsWith('image/'));let thumbnail=cover;if(!thumbnail&&image){if(!coverObjectUrls.has(image.id))coverObjectUrls.set(image.id,URL.createObjectURL(image.blob));thumbnail=coverObjectUrls.get(image.id);}return '<article class="resource-card"><button data-resource-open="'+esc(r.id)+'">'+(thumbnail?'<img src="'+esc(thumbnail)+'" alt="" loading="lazy" />':'<span class="compact-resource-icon">📁</span>')+'<div><small>'+esc(r.category||'자료')+'</small><h3>'+esc(r.title)+'</h3><p>'+esc(r.note||relatedStops(r.stopIds).map(stop=>stop.name).join(' · ')||'내용을 추가해 보세요')+'</p><span>'+files.length+'개 파일 · '+resourceReferences(r).length+'개 링크</span></div></button></article>';}).join('')+loose.map(file=>'<article class="resource-card loose-file-card"><button type="button" data-library-file="'+esc(file.id)+'"><span class="compact-resource-icon">📎</span><div><small>첨부파일</small><h3>'+esc(file.name)+'</h3><p>'+esc(relatedStops([file.stopId])[0]?.name||'여행 공통 자료')+'</p><span>눌러서 미리보기</span></div></button><button type="button" class="resource-delete-button" data-library-delete="'+esc(file.id)+'">삭제</button></article>').join('')+'</div>'+(!items.length&&!loose.length?'<div class="workspace-empty">자료를 추가하고 관련 장소를 연결해 보세요.</div>':'')+'</section>';
  }
  async function deleteLibraryFile(id){const file=workspaceFiles.find(f=>f.id===id);if(!file||!confirm('“'+file.name+'” 파일을 삭제할까요?'))return;const tripId=currentTripId;try{await dbop('readwrite',store=>store.delete(id));if(tripId!==currentTripId)return;workspaceFiles=workspaceFiles.filter(f=>f.id!==id);clearCoverUrls();render();renderFiles();}catch(error){toast('파일을 삭제하지 못했어요.','warning');}}
  function resourceForm(id=null){
    state.resources??=[];
    if(!id){const resource={id:uid(),title:'새 자료',category:'메모',note:'',stopIds:materialFilter?[materialFilter]:[]};state.resources.push(resource);save();render();id=resource.id;}
    resourceDetail(id);
  }
  function readableNote(note){return String(note||'').split(/(https?:\/\/[^\s<>\"]+)/g).map((part,index)=>{if(index%2===0)return esc(part);const url=part.replace(/[),.;]+$/,'');try{const parsed=new URL(url);return '<a href="'+esc(safeStoredLink(url))+'" target="_blank" rel="noopener">'+esc(parsed.hostname==='images.openai.com'?'이미지 보기':url.length>90?parsed.hostname+' 링크':url)+'</a>'+esc(part.slice(url.length));}catch{return esc(part);}}).join('');}
  const resourcePanel=document.createElement('aside');resourcePanel.id='resource-detail-panel';resourcePanel.hidden=true;resourcePanel.setAttribute('aria-label','여행 자료 상세');document.body.append(resourcePanel);
  let resourceEditing=null,resourceSaveTimer=0,resourceUrls=[],resourcePreviewVersion=0;
  function releaseResourceUrls(){for(const url of resourceUrls)URL.revokeObjectURL(url);resourceUrls=[];}
  function persistResourceEditor(){
    if(!resourceEditing||resourcePanel.hidden)return;
    const r=resourceEditing.resource,title=resourcePanel.querySelector('[name="resource-title"]').value.trim();
    if(title)r.title=title.slice(0,150);
    r.note=resourcePanel.querySelector('[name="resource-note"]').value;
    r.category=resourcePanel.querySelector('[name="resource-category"]').value;
    r.stopIds=[...resourcePanel.querySelectorAll('input[name="resource-stop"]:checked')].map(input=>input.value);
    save();const status=resourcePanel.querySelector('.resource-save-status');if(status)status.textContent='저장됨';
  }
  function closeResourcePanel(){
    if(resourcePanel.hidden)return;
    clearTimeout(resourceSaveTimer);persistResourceEditor();resourceEditing=null;resourcePanel.hidden=true;resourcePreviewVersion++;releaseResourceUrls();document.body.classList.remove('resource-open');render();
  }
  function resourceReferences(resource){
    resource.references??=[];
    if(resource.url){if(!resource.references.some(link=>link.url===resource.url))resource.references.push({id:uid(),url:resource.url});resource.url='';}
    return resource.references;
  }
  function resourceLinksPreview(resource){
    return resourceReferences(resource).map(link=>'<div class="registered-reference" data-reference-id="'+esc(link.id)+'">'+TravelMedia.link(link.url,link.title||'',{mode:link.previewMode,mapQuery:relatedStops(resource.stopIds)[0]?.query||relatedStops(resource.stopIds)[0]?.name||''})+'<button type="button" data-resource-link-delete="'+esc(link.id)+'">링크 삭제</button></div>').join('');
  }
  function addResourceReference(){
    if(!resourceEditing)return;
    const input=resourcePanel.querySelector('[name="resource-url"]'),resource=resourceEditing.resource;
    try{const url=safeLink(input.value.trim()),links=resourceReferences(resource);if(!links.some(link=>link.url===url))links.push({id:uid(),url});save();input.value='';resourcePanel.querySelector('.resource-embed-previews').innerHTML=resourceLinksPreview(resource);resourcePanel.querySelector('.reference-add-status').textContent='링크를 추가했어요 · '+links.length+'개';input.focus();}catch(error){toast(error.message,'warning');}
  }
  async function renderResourceAttachments(id,version){
    if(!db)return;
    try{const files=(await allFiles()).filter(file=>file.tripId===currentTripId&&file.resourceId===id&&file.kind!=='resource-cover');
      if(resourceEditing?.resource.id!==id||version!==resourcePreviewVersion)return;
      releaseResourceUrls();const host=resourcePanel.querySelector('.resource-inline-files');
      host.innerHTML=files.map(file=>{const url=URL.createObjectURL(file.blob);resourceUrls.push(url);return '<div class="resource-attachment-item">'+TravelMedia.file(file,url)+'<button type="button" class="resource-attachment-delete" data-resource-file-delete="'+esc(file.id)+'" aria-label="'+esc(file.name)+' 첨부파일 삭제">첨부파일 삭제</button></div>';}).join('');
    }catch(error){toast('첨부파일을 불러오지 못했어요.','warning');}
  }
  async function deleteResourceAttachment(id){
    const editing=resourceEditing;if(!editing||!db)return;
    const tripId=editing.tripId,resourceId=editing.resource.id;
    try{
      const file=(await allFiles()).find(file=>file.id===id&&file.tripId===tripId&&file.resourceId===resourceId&&file.kind!=='resource-cover');
      if(!file||resourceEditing!==editing||currentTripId!==tripId)return;
      if(!confirm('“'+file.name+'” 첨부파일을 삭제할까요?'))return;
      await dbop('readwrite',store=>store.delete(id));
      if(currentTripId!==tripId)return;
      workspaceFiles=workspaceFiles.filter(file=>file.id!==id);clearCoverUrls();
      if(resourceEditing===editing)await renderResourceAttachments(resourceId,resourcePreviewVersion);
      render();renderFiles();
      toast('첨부파일을 삭제했어요.','success');
    }catch(error){toast('첨부파일을 삭제하지 못했어요.','warning');}
  }
  async function deleteResource(id){
    const resource=state.resources?.find(item=>item.id===id);
    if(!resource||!confirm('“'+resource.title+'” 자료와 첨부파일을 삭제할까요?'))return;
    const data=state,tripId=currentTripId;
    try {
      if(db){const files=(await allFiles()).filter(file=>file.tripId===tripId&&file.resourceId===id);await dbop('readwrite',store=>{for(const file of files)store.delete(file.id);});}
      if(resourceEditing?.resource.id===id){clearTimeout(resourceSaveTimer);resourceEditing=null;resourcePanel.hidden=true;resourcePreviewVersion++;releaseResourceUrls();document.body.classList.remove('resource-open');}
      data.resources=data.resources.filter(item=>item.id!==id);
      for(const stop of data.days.flat())if(stop.resourceIds)stop.resourceIds=stop.resourceIds.filter(value=>value!==id);
      workspaceFiles=workspaceFiles.filter(file=>file.resourceId!==id);clearCoverUrls();
      if(currentTripId===tripId){save();render();}
      else { localStorage.setItem('sappun-trips-v3',serializeTripBook(tripBook)); window.dispatchEvent(new Event('sappun-book-changed')); }
      toast('자료를 삭제했어요.','success');
    }catch(error){toast('자료를 삭제하지 못했어요. '+error.message,'warning');}
  }
  function resourceDetail(id){
    if(resourceEditing)persistResourceEditor();
    const resource=state.resources?.find(item=>item.id===id);if(!resource)return;
    const origin=detailContext?{...detailContext}:resourceEditing?.origin;closeDetail();releaseResourceUrls();clearTimeout(resourceSaveTimer);resourceEditing={resource,tripId:currentTripId,origin};const version=++resourcePreviewVersion;
    resourcePanel.hidden=false;document.body.classList.add('resource-open');
    resourcePanel.innerHTML='<div class="detail-heading"><div>'+(origin?'<button type="button" data-resource-back>← 장소로</button>':'')+'<small>여행 자료실</small><span class="resource-save-status">저장됨</span></div><div class="tools">'+coverControls(resource)+'<button type="button" class="resource-delete-button" data-resource-delete="'+esc(id)+'">삭제</button><button type="button" data-resource-save>저장</button><button type="button" data-resource-close aria-label="자료 상세 닫기">×</button></div></div><div class="resource-editor-body"><input class="resource-title-editor" name="resource-title" aria-label="자료 제목" maxlength="150" value="'+esc(resource.title)+'" /><label class="resource-category-label">분류<select name="resource-category">'+['숙소','맛집','관광·체험','예약·티켓','교통','메모'].map(category=>'<option '+(category===resource.category?'selected':'')+'>'+category+'</option>').join('')+'</select></label><div class="resource-writing-heading"><b>내용</b><button type="button" data-resource-preview>읽기 모드</button></div><textarea class="resource-note-editor" name="resource-note" aria-label="자료 내용" placeholder="예약 정보, 준비할 것, 장소 설명을 자유롭게 적어 주세요. 링크도 붙여 넣을 수 있어요.">'+esc(resource.note||'')+'</textarea><div class="resource-read-preview" hidden></div><section class="detail-section resource-references"><h3>참고 링크</h3><div class="reference-add-row"><input type="url" name="resource-url" value="" placeholder="웹페이지 주소를 붙여 넣으세요" aria-label="추가할 참고 링크" /><button type="button" data-resource-link-add>추가</button></div><p class="reference-add-status" role="status">'+resourceReferences(resource).length+'개 등록됨</p><div class="resource-embed-previews">'+resourceLinksPreview(resource)+'</div></section><section class="detail-section"><details><summary>연결된 일정 '+(resource.stopIds?.length||0)+'개 · 관리</summary>'+scheduleLinkPicker(resource.stopIds||[],'resource-stop')+'</details></section><section class="detail-section"><div class="detail-section-heading"><h3>첨부파일</h3><button type="button" data-resource-upload="'+esc(id)+'">＋ 이미지·파일</button></div><div class="resource-inline-files"></div>'+'</section>'+'</div>';
    resourcePanel.onkeydown=event=>{if(event.key==='Enter'&&event.target.name==='resource-url'){event.preventDefault();addResourceReference();}};
    resourcePanel.oninput=event=>{if(!['resource-title','resource-note'].includes(event.target.name))return;resourcePanel.querySelector('.resource-save-status').textContent='저장 중…';clearTimeout(resourceSaveTimer);resourceSaveTimer=setTimeout(persistResourceEditor,500);};
    resourcePanel.onchange=event=>{if(event.target.name!=='resource-url'&&event.target.name!=='resource-cover-url')persistResourceEditor();};
    resourcePanel.onclick=event=>{const previewMode=event.target.closest('[data-media-mode]');if(previewMode){const reference=previewMode.closest('[data-reference-id]'),link=resourceReferences(resource).find(link=>link.id===reference?.dataset.referenceId);if(link){link.previewMode=previewMode.dataset.mediaMode;save();resourcePanel.querySelector('.resource-embed-previews').innerHTML=resourceLinksPreview(resource);}return;}const fileDelete=event.target.closest('[data-resource-file-delete]');if(fileDelete){event.preventDefault();event.stopPropagation();return deleteResourceAttachment(fileDelete.dataset.resourceFileDelete);}const deleteButton=event.target.closest('[data-resource-delete]');if(deleteButton){event.preventDefault();event.stopPropagation();deleteResource(deleteButton.dataset.resourceDelete);return;}if(event.target.closest('[data-resource-link-add]')){addResourceReference();return;}const removeLink=event.target.closest('[data-resource-link-delete]');if(removeLink){resource.references=resourceReferences(resource).filter(link=>link.id!==removeLink.dataset.resourceLinkDelete);save();resourcePanel.querySelector('.resource-embed-previews').innerHTML=resourceLinksPreview(resource);resourcePanel.querySelector('.reference-add-status').textContent=resource.references.length+'개 등록됨';return;}if(event.target.closest('[data-cover-upload]')){coverUpload.dataset.resourceId=resource.id;coverUpload.click();return;}if(event.target.closest('[data-cover-url]')){const value=resourcePanel.querySelector('[name="resource-cover-url"]').value.trim();try{if(!value)throw Error('이미지 주소를 입력해 주세요.');resource.cover=safeLink(value);delete resource.coverFileId;save();refreshCoverControls();render();}catch(error){toast(error.message,'warning');}return;}if(event.target.closest('[data-cover-remove]')){resource.cover='';delete resource.coverFileId;save();refreshCoverControls();render();return;}if(event.target.closest('[data-resource-back]')){const origin=resourceEditing.origin;closeResourcePanel();if(origin?.tripId===currentTripId){day=origin.day;const index=state.days[day].findIndex(stop=>stop.id===origin.stopId);if(index>=0)openDetail(index);}return;}if(event.target.closest('[data-resource-close]'))closeResourcePanel();if(event.target.closest('[data-resource-save]')){clearTimeout(resourceSaveTimer);persistResourceEditor();toast('자료를 저장했어요.','success');}const toggle=event.target.closest('[data-resource-preview]');if(toggle){persistResourceEditor();const editor=resourcePanel.querySelector('.resource-note-editor'),preview=resourcePanel.querySelector('.resource-read-preview');editor.hidden=!editor.hidden;preview.hidden=!editor.hidden;preview.innerHTML=readableNote(resource.note);toggle.textContent=editor.hidden?'글 수정':'읽기 모드';resourcePanel.querySelector('.resource-embed-previews').innerHTML=resourceLinksPreview(resource);}};
    renderResourceAttachments(id,version);
  }
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!document.querySelector('#modal').open)closeResourcePanel();});
  const openPlaceBeforeResource=openDetail;openDetail=function(index){if(!resourcePanel.hidden)closeResourcePanel();openPlaceBeforeResource(index);};
  const coverUpload=document.createElement('input');coverUpload.type='file';coverUpload.accept='image/*';coverUpload.hidden=true;document.body.append(coverUpload);
  coverUpload.onchange=async()=>{const file=coverUpload.files?.[0],id=coverUpload.dataset.resourceId,tripId=currentTripId;if(!file)return;try{if(!db)throw Error('브라우저 이미지 저장소를 사용할 수 없어요.');if(!file.type.startsWith('image/'))throw Error('이미지 파일을 선택해 주세요.');if(file.size>10*1024*1024)throw Error('커버 이미지는 10MB 이하로 선택해 주세요.');const resource=state.resources?.find(resource=>resource.id===id);if(!resource)return;const fileId=uid();await dbop('readwrite',store=>store.put({id:fileId,tripId,resourceId:id,day:0,stopId:null,kind:'resource-cover',name:file.name,blob:file}));resource.coverFileId=fileId;resource.cover='';save();if(currentTripId===tripId){workspaceFiles=(await allFiles()).filter(file=>file.tripId===tripId);if(resourceEditing?.resource.id===id)refreshCoverControls();render();}toast('커버 이미지를 저장했어요.','success');}catch(error){toast(error.message,'warning');}finally{coverUpload.value='';}};
  const upload=document.createElement('input');upload.type='file';upload.multiple=true;upload.hidden=true;document.body.append(upload);
  upload.onchange=async()=>{const id=upload.dataset.resourceId,tripId=currentTripId;try{if(!db)throw Error('브라우저 파일 저장소를 사용할 수 없어요.');for(const file of upload.files){if(file.size>20*1024*1024)throw Error('파일은 20MB 이하로 첨부해 주세요.');const resource=state.resources.find(r=>r.id===id),stop=relatedStops(resource?.stopIds)[0],d=stop?state.days.findIndex(stops=>stops.includes(stop)):0;await dbop('readwrite',store=>store.put({id:uid(),tripId,resourceId:id,day:d,stopId:stop?.id||null,kind:'resource',name:file.name,blob:file}));}if(currentTripId===tripId){workspaceFiles=(await allFiles()).filter(f=>f.tripId===tripId);if(resourceEditing?.resource.id===id)resourceDetail(id);render();}}catch(error){toast(error.message,'warning');}finally{upload.value='';}};
  function loadFiles(){if(!db||fileBusy||fileTrip===currentTripId)return;fileBusy=true;const id=currentTripId;allFiles().then(files=>{if(currentTripId===id){workspaceFiles=files.filter(f=>f.tripId===id);fileTrip=id;if(trip().workspaceView==='materials')render();}}).catch(()=>{}).finally(()=>{fileBusy=false;if(id!==currentTripId&&!homeOpen)loadFiles();});}
  const beforeLibraryUpload=uploadDetailFiles;uploadDetailFiles=async function(event){await beforeLibraryUpload(event);fileTrip='';loadFiles();};
  const beforeLibraryDelete=deleteDetailFile;deleteDetailFile=async function(id){await beforeLibraryDelete(id);fileTrip='';clearCoverUrls();loadFiles();};
  const beforeLibraryTripUpload=document.querySelector('#uploads').onchange;document.querySelector('#uploads').onchange=async function(event){await beforeLibraryTripUpload(event);fileTrip='';loadFiles();};
  const beforeRender=render;
  render=function(){if(!homeOpen&&trip().workspaceView==='calendar'){trip().workspaceView='itinerary';trip().viewMode='map';save();}if(resourceEditing&&resourceEditing.tripId!==currentTripId){resourcePanel.hidden=true;resourceEditing=null;releaseResourceUrls();document.body.classList.remove("resource-open");}if(!homeOpen && initializeSettlementStatuses(state))save();TravelFinance.prepare(state);beforeRender();if(homeOpen)return;if(workspaceTripId!==currentTripId){clearCoverUrls();workspaceTripId=currentTripId;materialFilter=null;ledgerFilter=null;workspaceFiles=[];fileTrip='';}loadFiles();
    let nav=document.querySelector('#trip-workspace-nav');if(!nav){nav=document.createElement('nav');nav.id='trip-workspace-nav';nav.setAttribute('aria-label','여행 작업 공간');document.querySelector('#planner-controls').before(nav);}
    const view=trip().workspaceView||'itinerary',activeView=view==='itinerary'&&trip().viewMode==='list'?'list':view;nav.className='view-buttons workspace-tabs';nav.innerHTML=workspaceTabs().filter(t=>!t.hidden||t.key===activeView).map(t=>'<button draggable="true" title="드래그하여 순서 변경" data-workspace-view="'+t.key+'" aria-pressed="'+(activeView===t.key)+'" class="'+(activeView===t.key?'active':'')+'">'+esc(t.emoji)+' '+esc(t.label)+'</button>').join('')+'<button type="button" data-tabs-edit aria-label="탭 꾸미기 및 순서 변경">⚙ 탭 편집</button>';
    document.querySelector('.layout').hidden=view!=='itinerary';document.querySelector('#planner-controls').hidden=true;document.querySelector('#summary').hidden=false;
    let content=document.querySelector('#trip-workspace-content');if(!content){content=document.createElement('div');content.id='trip-workspace-content';document.querySelector('.layout').after(content);}content.hidden=view==='itinerary';if(!content.hidden)content.innerHTML=view==='settlement'?settlementView():view==='preparation'?prepView():materialsView();if(view==='settlement'){document.querySelector('#list-rate').onclick=rateDialog;document.querySelector('#dashboard-common').onclick=()=>commonCostForm();}
    for(const card of document.querySelectorAll('#stops [data-stop-id]')){if(card.matches?.('.grid-event'))continue;const expenseLinks=state.expenses.filter(e=>e.stopIds?.includes(card.dataset.stopId));const cardTools=card.querySelector('.card-inline-tools');if(expenseLinks.length&&cardTools&&!cardTools.querySelector('[data-stop-expenses]')){const button=document.createElement('button');button.type='button';button.dataset.stopExpenses=card.dataset.stopId;button.textContent='₩ 연결 지출 '+expenseLinks.length;cardTools.append(button);}const linked=(state.resources||[]).filter(r=>r.stopIds?.includes(card.dataset.stopId));const tools=card.querySelector('.card-inline-tools');if(linked.length&&tools&&!tools.querySelector('[data-stop-resources]')){const button=document.createElement('button');button.type='button';button.dataset.stopResources=card.dataset.stopId;button.textContent='🔗 연결 자료 '+linked.length;tools.append(button);}}
  };
  const beforeModal=modal;modal=function(...args){const result=beforeModal(...args);document.querySelector('#form button[type="submit"]').textContent='저장하기';updateExpenseSplitPreview();return result;};
  const beforeLeg=leg;leg=function(index){const stop=state.days[day][index];beforeLeg(index);if(!stop)return;const metadata=stop.farePayment||{}, original=stop.actualFare;
    const amount=document.querySelector('#f-actualfare');if(original!==null&&original!==undefined)amount.value=metadata.payerId==='self'?TravelFinance.perPersonOriginal({...metadata,actual:original},state.settings.people):TravelFinance.totalOriginal({...metadata,actual:original},state.settings.people);
    const label=amount.closest('label');label.firstChild.textContent='실제 교통비 · 결제 총액 · 없으면 비워두기';label.insertAdjacentHTML('afterend',expenseAllocationFields(metadata));
    const panel=document.querySelector('#expense-allocation');panel.dataset.amountInput='#f-actualfare';panel.dataset.currencyInput='#f-farecurrency';const submit=submitHandler;submitHandler=()=>{const allocation=!['도보','없음'].includes(val('mode'))&&amount.value!==''?readExpenseAllocation():null;const result=submit();if(result===false)return false;if(allocation)stop.farePayment=allocation;return result;};updateExpenseSplitPreview();
  };
  document.addEventListener('input',updateExpenseSplitPreview);document.addEventListener('change',updateExpenseSplitPreview);
  document.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.dataset.libraryDelete){deleteLibraryFile(button.dataset.libraryDelete);return;}
    if(button.dataset.libraryFile){openAttachmentPreview(button.dataset.libraryFile);return;}
    if(button.dataset.placeLibrary!==undefined){materialFilter=button.dataset.placeLibrary;closeDetail();trip().workspaceView='materials';refresh();return;}
    if(button.hasAttribute('data-edit-budget')){goalDialog();return;}
    if(button.hasAttribute('data-prep-template')){state.preparation??=[];const examples=[['🛂 여권 · 신분증','챙길 것'],['💳 지갑 · 결제 카드','챙길 것'],['🔌 충전기 · 어댑터','챙길 것'],['👕 옷 · 속옷','챙길 것'],['🪥 세면도구','챙길 것'],['💊 평소 쓰는 약','챙길 것'],['🎫 항공권 · 숙소 예약 확인','미리 할 일'],['📱 로밍 · eSIM 준비','미리 할 일'],['💱 환전 · 해외 결제 설정','미리 할 일'],['🏠 집 정리 · 문단속','미리 할 일']];for(const [title,category] of examples)if(!state.preparation.some(t=>t.title===title))state.preparation.push({id:uid(),title,category,status:'todo',color:category==='챙길 것'?'mint':'lavender'});refresh();return;}
    if(button.dataset.ledgerCell!==undefined){event.preventDefault();editLedgerCell(button);return;}
    if(button.dataset.payerMode){const root=button.closest('.expense-payer-field'),mode=button.dataset.payerMode,payer=document.querySelector('#f-payer');if(mode==='person'){payer.value=root.dataset.person||'';}else{if(payer.value&&!['self','pool'].includes(payer.value))root.dataset.person=payer.value;payer.value=mode;}root.querySelector('.payer-person-options').hidden=mode!=='person';root.querySelectorAll('[data-payer-mode]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));updateExpenseSplitPreview();return;}
    if(button.dataset.valueTarget){if(button.dataset.valueTarget==='f-payer'){const root=button.closest('.expense-payer-field');if(root)root.dataset.person=button.dataset.value;}queueMicrotask(updateExpenseSplitPreview);}
    if(button.dataset.workspaceView){closeResourcePanel();const key=button.dataset.workspaceView;trip().workspaceView=key==='list'?'itinerary':key;if(key==='list'||key==='itinerary')trip().viewMode=key==='list'?'list':'map';closeLedgerPopover();closeDetail();refresh();if(key==='itinerary'&&gmap)requestAnimationFrame(()=>google.maps.event.trigger(gmap,'resize'));return;}
    if(button.hasAttribute('data-common-expense')){commonCostForm();return;}
    if(button.dataset.ledgerEdit!==undefined){const row=TravelFinance.calculate(state,won).rows[Number(button.dataset.ledgerEdit)];if(row.source==='common')commonCostForm(row.index);else {day=row.day;if(row.source==='transport')leg(row.stopIndex);else editCostItem(row.stopIndex,row.index);}return;}
    if(button.dataset.splitSelect){document.querySelectorAll('input[name="expense-split"]').forEach(input=>input.checked=button.dataset.splitSelect==='all');updateExpenseSplitPreview();return;}
    if(button.hasAttribute('data-tabs-edit')){editWorkspaceTabs();return;}
    if(button.dataset.prepToggle){const task=state.preparation?.find(t=>t.id===button.dataset.prepToggle);if(task){task.status=task.status==='done'?'todo':'done';refresh();}return;}
    if(button.hasAttribute('data-prep-add')){prepForm(null,button.dataset.prepAdd||'todo');return;}
    if(button.dataset.prepDelete){deletePrepTask(button.dataset.prepDelete);return;}
    if(button.dataset.prepEdit){prepForm(button.dataset.prepEdit);return;}
    if(button.hasAttribute('data-resource-add')){resourceForm();return;}
    if(button.dataset.resourceDelete){deleteResource(button.dataset.resourceDelete);return;}
    if(button.dataset.resourceOpen){resourceDetail(button.dataset.resourceOpen);return;}
    if(button.dataset.resourceEdit){document.querySelector('#modal').close();resourceForm(button.dataset.resourceEdit);return;}
    if(button.dataset.resourceUpload){upload.dataset.resourceId=button.dataset.resourceUpload;upload.click();return;}
    if(button.dataset.resourceFile){const file=workspaceFiles.find(f=>f.id===button.dataset.resourceFile);if(file)download(file.blob,file.name);return;}
    if(button.hasAttribute('data-ledger-clear')){ledgerFilter=null;render();return;}
    if(button.dataset.stopExpenses){ledgerFilter=button.dataset.stopExpenses;trip().workspaceView='settlement';refresh();return;}
    if(button.hasAttribute('data-resource-clear')){materialFilter=null;render();return;}
    if(button.dataset.stopResources){materialFilter=button.dataset.stopResources;trip().workspaceView='materials';refresh();return;}
  });
  let draggedTab=null,tabDropAfter=false;
  function clearTabDrag(){document.querySelectorAll('.tab-dragging,.tab-drop-before,.tab-drop-after').forEach(el=>el.classList.remove('tab-dragging','tab-drop-before','tab-drop-after'));document.querySelector('#trip-workspace-nav')?.classList.remove('is-dragging');}
  function moveWorkspaceTab(from,to,after=false){const tabs=workspaceTabs(),a=tabs.findIndex(t=>t.key===from);if(a<0||from===to)return;const moved=tabs.splice(a,1)[0],b=tabs.findIndex(t=>t.key===to);if(b<0)return;tabs.splice(b+(after?1:0),0,moved);trip().workspaceTabs=tabs;refresh();}
  document.addEventListener('dragstart',event=>{const tab=event.target.closest('[data-workspace-view]');if(tab){draggedTab=tab.dataset.workspaceView;tab.classList.add('tab-dragging');tab.closest('nav').classList.add('is-dragging');event.dataTransfer.setData('application/x-sappun-tab',draggedTab);event.dataTransfer.effectAllowed='move';return;}const task=event.target.closest('[data-prep-id]');if(task){event.dataTransfer.setData('application/x-sappun-prep',task.dataset.prepId);event.dataTransfer.effectAllowed='move';}});
  document.addEventListener('dragover',event=>{const tab=event.target.closest('[data-workspace-view]');if(tab&&draggedTab){event.preventDefault();event.dataTransfer.dropEffect='move';document.querySelectorAll('.tab-drop-before,.tab-drop-after').forEach(el=>el.classList.remove('tab-drop-before','tab-drop-after'));if(tab.dataset.workspaceView===draggedTab)return;const rect=tab.getBoundingClientRect();tabDropAfter=event.clientX>rect.left+rect.width/2;tab.classList.add(tabDropAfter?'tab-drop-after':'tab-drop-before');}});
  document.addEventListener('drop',event=>{const tab=event.target.closest('[data-workspace-view]'),from=event.dataTransfer.getData('application/x-sappun-tab');if(tab&&from){event.preventDefault();moveWorkspaceTab(from,tab.dataset.workspaceView,tabDropAfter);}draggedTab=null;clearTabDrag();});
  document.addEventListener('dragend',()=>{draggedTab=null;clearTabDrag();});
  document.addEventListener('dragover',event=>{if(event.target.closest('[data-prep-column]')&&[...event.dataTransfer.types].includes('application/x-sappun-prep')){event.preventDefault();event.dataTransfer.dropEffect='move';}});
  document.addEventListener('drop',event=>{const column=event.target.closest('[data-prep-column]');if(!column)return;const id=event.dataTransfer.getData('application/x-sappun-prep'),task=state.preparation?.find(t=>t.id===id);if(task){event.preventDefault();task.status=column.dataset.prepColumn;const target=event.target.closest('[data-prep-id]');if(target&&target.dataset.prepId!==id){state.preparation.splice(state.preparation.indexOf(task),1);state.preparation.splice(state.preparation.findIndex(t=>t.id===target.dataset.prepId),0,task);}refresh();}});
  const beforeWorkspaceHome=showHome;showHome=function(){closeResourcePanel();clearCoverUrls();workspaceTripId='';materialFilter=null;ledgerFilter=null;workspaceFiles=[];fileTrip='';return beforeWorkspaceHome();};
  const beforeTripForm=tripForm;
  tripForm=function(id=null){
    beforeTripForm(id);
    const original=submitHandler,t=tripBook.trips.find(t=>t.id===id);
    const members=t?.data.settings.members||[],draft=members.filter(p=>p.active!==false).map(p=>({...p}));
    let removeCover=false;
    const photoJobs=new Set();
    document.querySelector('#formbody').insertAdjacentHTML('beforeend','<section class="trip-members-settings"><h3>여행 인원 이름</h3><p class="note">위 여행 인원 수에 맞춰 이름을 입력하세요. 이름은 나중에 추가해도 돼요. 기존 지출 연결은 유지됩니다.</p><div id="trip-member-fields"></div></section><details class="resource-cover-controls trip-cover-settings" open><summary>여행 커버</summary><div class="trip-cover-fields"><label>이미지 업로드<input type="file" id="trip-cover-file" accept="image/*" /></label><label>이미지 주소<input type="url" id="trip-cover-url" placeholder="https://…/image.jpg" value="'+esc(t?.cover||'')+'" /></label><button type="button" id="trip-cover-remove">커버 삭제</button><small>메인 여행 카드에 표시됩니다.</small></div></details>');
    const fields=document.querySelector('#trip-member-fields'),countInput=document.querySelector('#f-people');
    function readNames(){fields.querySelectorAll('[data-trip-member-index]').forEach(input=>{const index=Number(input.dataset.tripMemberIndex);draft[index]??={id:uid(),name:'',active:true};draft[index].name=input.value;});}
    function drawNames(){readNames();const count=Math.max(1,Math.min(50,Number(countInput.value)||1));fields.innerHTML=Array.from({length:count},(_,index)=>{
      const photo=travelerPhotoSource(draft[index]?.photo),name=draft[index]?.name||'';
      return '<div class="trip-member-row"><label class="trip-member-photo-picker"><span class="trip-member-photo">'+(photo?'<img src="'+photo+'" alt="여행자 '+(index+1)+' 사진" />':esc([...name][0]||String(index+1)))+'</span><span>'+(photo?'사진 변경':'사진 추가')+'</span><input type="file" accept="image/*" data-trip-member-photo="'+index+'" hidden /></label><label class="trip-member-name-field">여행자 '+(index+1)+'<input data-trip-member-index="'+index+'" maxlength="40" value="'+esc(name)+'" placeholder="이름 · 선택" /></label>'+(photo?'<button type="button" data-trip-member-photo-remove="'+index+'">사진 삭제</button>':'')+'</div>';
    }).join('');}
    fields.onchange=event=>{
      const index=event.target.dataset.tripMemberPhoto;
      if(index===undefined||!event.target.files?.[0])return;
      readNames();const entry=draft[Number(index)]??={id:uid(),name:'',active:true};
      const job=travelerPhotoData(event.target.files[0]).then(photo=>{entry.photo=photo;if(fields.isConnected)drawNames();}).catch(error=>toast(error.message||'사진을 불러오지 못했어요. 다른 사진을 선택해 주세요.','warning')).finally(()=>photoJobs.delete(job));
      photoJobs.add(job);
    };
    fields.onclick=event=>{const button=event.target.closest('[data-trip-member-photo-remove]');if(!button)return;readNames();delete draft[Number(button.dataset.tripMemberPhotoRemove)].photo;drawNames();};
    countInput.oninput=drawNames;drawNames();
    document.querySelector('#trip-cover-remove').onclick=()=>{removeCover=true;document.querySelector('#trip-cover-url').value='';document.querySelector('#trip-cover-file').value='';};
    document.querySelector('#trip-cover-file').onchange=()=>{removeCover=false;};
    document.querySelector('#trip-cover-url').oninput=()=>{removeCover=false;};
    submitHandler=async()=>{
      await Promise.all(photoJobs);readNames();const count=Number(countInput.value);
      if(draft.slice(0,count).some(p=>p?.photo&&!p.name.trim()))throw Error('사진을 등록한 여행자의 이름도 입력해 주세요.');
      if(!Number.isInteger(count)||count<1||count>50)throw Error('여행 인원은 1~50명으로 입력해 주세요.');
      const active=draft.slice(0,count).filter(p=>p?.name.trim()).map(p=>({...p,name:p.name.trim(),active:true}));
      if(new Set(active.map(p=>p.name)).size!==active.length)throw Error('여행자 이름을 중복 없이 입력해 주세요.');
      const file=document.querySelector('#trip-cover-file').files?.[0];
      const cover=document.querySelector('#trip-cover-url').value.trim();
      if(cover)safeLink(cover);
      if(file&&(!file.type.startsWith('image/')||file.size>10*1024*1024))throw Error('10MB 이하 이미지 파일을 선택해 주세요.');
      if(file&&!db)throw Error('브라우저 이미지 저장소를 사용할 수 없어요.');
      const result=await original();if(result===false)return false;
      const target=id?tripBook.trips.find(t=>t.id===id):tripBook.trips.at(-1);
      target.data.settings.members=[...active,...members.filter(p=>!active.some(a=>a.id===p.id)).map(p=>({...p,active:false}))];target.data.settings.people=count;
      if(removeCover){target.cover='';delete target.coverFileId;}
      else if(file){const fileId=uid();await dbop('readwrite',store=>store.put({id:fileId,tripId:target.id,kind:'trip-cover',name:file.name,blob:file}));target.coverFileId=fileId;target.cover='';}
      else if(cover!==(target.cover||'')){target.cover=cover;delete target.coverFileId;}
      tripCoverLoadKey='';save();if(homeOpen)renderHome();else render();
      return result;
    };
  };
  const beforeDetail=renderDetail;
  renderDetail=function(){beforeDetail();const stop=detailStop();if(!stop)return;const expenses=state.expenses.map((entry,index)=>({entry,index})).filter(row=>row.entry.stopIds?.includes(stop.id));if(expenses.length){const section=document.createElement('section');section.className='detail-section';section.innerHTML='<h3>연결된 지출</h3>'+expenses.map(row=>'<div class="linked-expense-row"><span>'+esc(row.entry.name)+'<small>'+esc(memberName(row.entry.payerId))+' · '+esc(allocationText(row.entry))+'</small></span><b>'+(row.entry.payerId==='self'?'1인당 ':'결제 총액 ')+money(row.entry.payerId==='self'?Math.round(won(TravelFinance.perPersonOriginal(row.entry,state.settings.people),row.entry.currency)):TravelFinance.totalKRW(row.entry,state.settings.people,won,row.entry.scope==="전체"?"total":"perPerson"))+'</b><button data-commonedit="'+row.index+'">수정</button></div>').join('');document.querySelector('.detail-body').append(section);}const linked=(state.resources||[]).filter(r=>r.stopIds?.includes(stop.id));const section=document.createElement('section');section.className='detail-section place-resource-links';section.innerHTML='<h3>연결된 자료</h3><div class="place-resource-selected">'+linked.map(resource=>'<button type="button" data-resource-open="'+esc(resource.id)+'">📄 '+esc(resource.title)+'</button>').join('')+'</div><button type="button" data-place-library="'+esc(stop.id)+'">자료실에서 관리 ↗</button>';document.querySelector('.detail-body').append(section);};

  tripBook.trips.forEach(t=>initializeSettlementStatuses(t.data));
  save();if(!homeOpen)render();

})();
