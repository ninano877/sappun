// The owner's actual planner renderers, with ephemeral data and read-only interactions.
const SappunSharedPlanner = (() => {
  let options={},installed=false;
  const allowed='[data-workspace-view],[data-dayfold],[data-mapday],[data-mobile-day],[data-mobile-day-picker],[data-day-picker-value],[data-day-picker-close],[data-schedule-map-day],.schedule-day-map,[data-mapjump],[data-card-map],[data-detail-map],#show-all-map,#toggle-map-pins,#close-place-detail,[data-shared-close],#schedule-map-dialog .schedule-map-heading button,[data-ledger-clear],.map-pin,.map-travel-label,.gm-control-active,.gm-style button';
  const edits='[data-delete],[data-add],[data-add-place],[data-edit-budget],[data-edit-travelers],[data-tabs-edit],.schedule-drag-handle,.card-inline-tools,.map-searchbox,.temp-location-lookup,#mapsetup,#mapsetup-global,#backup,#restore,#settings,#go-home,#upload,#expenseadd,#dashboard-common,#list-rate,[data-common-expense],[data-prep-add],[data-prep-delete],[data-resource-add],[data-library-upload],[data-resource-delete],.trip-travelers-edit';
  function apply() {
    if(!document.body.classList.contains('shared-readonly'))return;
    document.querySelectorAll(edits).forEach(node=>{if(!node.hidden)node.hidden=true;});
    document.querySelectorAll('#trip-workspace-nav [data-workspace-view]').forEach(node=>{node.hidden=!options.tabs.includes(node.dataset.workspaceView);node.draggable=false;});
    document.querySelectorAll('.wrap input,.wrap textarea,.wrap select,.wrap [contenteditable],.wrap [draggable=true]').forEach(node=>{node.disabled=true;node.readOnly=true;node.draggable=false;node.removeAttribute('contenteditable');});
    document.querySelectorAll('.ledger-cell').forEach(node=>{node.disabled=true;});
    document.querySelectorAll('.wrap button').forEach(node=>{
      if(node.matches(allowed)||node.matches('[data-placedetail],[data-stop-action="details"],[data-resource-open]'))return;
      if([...node.attributes].some(attr=>/^data-(?:.*-)?(?:add|edit|delete|remove|upload|save|reimburse)(?:-|$)/.test(attr.name)))node.hidden=true;
      else node.disabled=true;
    });
  }
  function detail(index) {
    const stop=state.days[day]?.[index];if(!stop)return;
    detailContext={tripId:currentTripId,day,stopId:stop.id};
    detailPanel.hidden=false;document.body.classList.add('detail-open');
    detailPanel.innerHTML='<div class="detail-heading"><div><small>Day '+(day+1)+' · 장소 상세</small><h2>'+esc(stop.name)+'</h2></div><button type="button" data-shared-close aria-label="장소 상세 닫기">×</button></div><div class="detail-body"><p>'+esc(hasStopTime(stop)?stopStart(stop)+'–'+stopEnd(stop):'시간 미정')+' · '+esc(stop.category)+'</p>'+(options.map?'<p>'+esc(stop.query||'')+'</p><button type="button" data-detail-map>지도에서 보기</button>':'')+(options.notes&&stop.note?'<section class="detail-section"><h3>메모</h3><p class="shared-note">'+esc(stop.note)+'</p></section>':'')+(options.costs?'<section class="detail-section"><h3>지출</h3>'+stopPersonalCosts(stop)+(stop.costItems||[]).map(item=>'<p>'+esc(item.name)+' · '+money(TravelFinance.totalKRW(item,state.settings.people,won))+'</p>').join('')+'</section>':'')+'</div>';
  }
  function resource(id) {
    const item=state.resources?.find(entry=>entry.id===id);if(!item)return;
    detailPanel.hidden=false;document.body.classList.add('detail-open');
    detailPanel.innerHTML='<div class="detail-heading"><h2>'+esc(item.title)+'</h2><button type="button" data-shared-close aria-label="자료 닫기">×</button></div><div class="detail-body"><p class="shared-note">'+esc(item.note||'')+'</p>'+(item.references||[]).filter(link=>/^https?:\/\//.test(link.url)).map(link=>'<p><a href="'+esc(link.url)+'" target="_blank" rel="noopener noreferrer">'+esc(link.title||link.url)+' ↗</a></p>').join('')+'</div>';
  }
  function install() {
    if(installed)return;installed=true;
    const before=render;
    render=function(...args){
      const active=trip()?.workspaceView==='itinerary'&&trip()?.viewMode==='list'?'list':trip()?.workspaceView||'itinerary';
      if(trip()&&!options.tabs.includes(active)){const next=options.tabs[0];trip().workspaceView=next==='list'?'itinerary':next;trip().viewMode=next==='list'?'list':'map';}
      const result=before.apply(this,args);apply();return result;
    };
    openDetail=detail;
    // Window capture runs before the editor's document handlers.
    window.addEventListener('click',event=>{
      if(!document.body.classList.contains('shared-readonly'))return;
      const target=event.target;
      if(target.closest('[data-shared-close]')){event.preventDefault();event.stopImmediatePropagation();closeDetail();return;}
      const res=target.closest('[data-resource-open]');
      if(res){event.preventDefault();event.stopImmediatePropagation();resource(res.dataset.resourceOpen);return;}
      const tab=target.closest('[data-workspace-view]');
      if(tab&&!options.tabs.includes(tab.dataset.workspaceView)){event.preventDefault();event.stopImmediatePropagation();return;}
      if(target.closest(allowed))return;
      const card=target.closest('#stops [data-card-index]');
      if(card){event.preventDefault();event.stopImmediatePropagation();day=Number(card.closest('[data-group-day]')?.dataset.groupDay||day);detail(Number(card.dataset.cardIndex));return;}
      if(target.closest('button,input,textarea,select,[contenteditable],.prep-task')){event.preventDefault();event.stopImmediatePropagation();}
    },true);
    for(const name of ['input','change','submit','dragstart','drop'])window.addEventListener(name,event=>{if(document.body.classList.contains('shared-readonly')){event.preventDefault();event.stopImmediatePropagation();}},true);
    new MutationObserver(apply).observe(document.body,{childList:true,subtree:true});
  }
  function open(payload,id) {
    options=payload.trip.options;install();
    const t=structuredClone(payload.trip.planner);t.id='shared-'+id;
    t.data.settings={...DEFAULT_SETTINGS,...t.data.settings,key:payload.mapKey||''};
    tripBook={version:3,key:payload.mapKey||'',trips:[t]};currentTripId=t.id;state=t.data;
    t.data.days.flat().forEach(normalizeStop);
    window.SAPPUN_SHARED_MAP_KEY=payload.mapKey||'';
    homeOpen=false;home.hidden=true;document.querySelector('.wrap').hidden=false;
    day=0;selected=0;filter='전체';activeScheduleCard=null;lastOverviewKey='';allMapSignature='';
    document.body.classList.add('shared-readonly');
    document.body.classList.toggle('shared-hide-costs',!options.costs);
    document.body.classList.toggle('shared-hide-map',!options.map);
    document.querySelector('#cloud-gate').hidden=true;document.body.classList.remove('auth-pending');
    render();if(payload.mapKey&&!gmap)loadGoogle();
    if(!document.querySelector('.shared-readonly-label')){const badge=document.createElement('span');badge.className='shared-readonly-label';badge.textContent='공유 여행 · 읽기 전용';document.querySelector('body > header').append(badge);}
  }
  function close() {
    closeDetail();document.querySelectorAll('dialog[open]').forEach(node=>node.close());
    document.body.classList.remove('shared-readonly');
    homeOpen=true;document.body.classList.add('auth-pending');document.querySelector('#cloud-gate').hidden=false;
    document.querySelector('.wrap').hidden=true;document.querySelector('#stops').replaceChildren();
    tripBook={version:3,key:'',trips:[]};currentTripId=null;window.SAPPUN_SHARED_MAP_KEY='';
    state=newTripData(1);markers.forEach(marker=>marker.map=null);
  }
  return {open,close};
})();
