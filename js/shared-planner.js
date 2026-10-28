// The owner's actual planner renderers, with ephemeral data and read-only interactions.
const SappunSharedPlanner = (() => {
  let options={},installed=false,displayedResource=null;
  function fileRows(files) {
    return files.map(file=>'<div class="shared-file-row"><span>📄 '+esc(file.name)+'<small>'+Math.ceil(file.size/1024)+' KB</small></span><button type="button" data-shared-file="'+esc(file.id)+'" data-shared-file-mode="preview">미리보기</button><button type="button" data-shared-file="'+esc(file.id)+'" data-shared-file-mode="download">다운로드</button></div>').join('');
  }
  const allowed='[data-workspace-view],[data-dayfold],[data-mapday],[data-mobile-day],[data-mobile-day-picker],[data-day-picker-value],[data-day-picker-close],[data-schedule-map-day],.schedule-day-map,[data-mapjump],[data-card-map],[data-detail-map],#show-all-map,#toggle-map-pins,#close-place-detail,[data-shared-close],#schedule-map-dialog .schedule-map-heading button,[data-ledger-clear],.map-pin,.map-travel-label,.gm-control-active,.gm-style button';
  const edits='[data-delete],[data-add],[data-add-place],[data-edit-budget],[data-edit-travelers],[data-tabs-edit],.schedule-drag-handle,.card-inline-tools,.map-searchbox,.temp-location-lookup,#mapsetup,#mapsetup-global,#backup,#restore,#settings,#go-home,#upload,#expenseadd,#dashboard-common,#list-rate,[data-common-expense],[data-prep-add],[data-prep-delete],[data-resource-add],[data-library-upload],[data-resource-delete],.trip-travelers-edit';
  function apply() {
    if(!document.body.classList.contains('shared-readonly'))return;
    document.querySelectorAll(edits).forEach(node=>{if(!node.hidden)node.hidden=true;});
    const names={itinerary:'여행 일정',list:'시간표',settlement:'경비',preparation:'체크리스트',materials:'자료실'};
    document.querySelectorAll('#trip-workspace-nav [data-workspace-view]').forEach(node=>{node.hidden=!options.tabs.includes(node.dataset.workspaceView);node.draggable=false;const name=trip()?.workspaceTabs?.find(tab=>tab.key===node.dataset.workspaceView)?.label?.trim()||names[node.dataset.workspaceView];if(name&&node.textContent!==name)node.textContent=name;});
    document.querySelectorAll('[data-dayadd],.schedule-add-row').forEach(node=>node.hidden=true);
    document.querySelectorAll('#stops .map-stop-card').forEach(card=>{if(card.querySelector('[data-shared-stop-detail]'))return;const action=document.createElement('button');action.type='button';action.className='shared-stop-detail';action.dataset.sharedStopDetail=card.dataset.cardIndex;action.textContent='장소 상세';(card.querySelector('.map-stop-content')||card).append(action);});
    document.querySelectorAll('.wrap input,.wrap textarea,.wrap select,.wrap [contenteditable],.wrap [draggable=true]').forEach(node=>{node.disabled=true;node.readOnly=true;node.draggable=false;node.removeAttribute('contenteditable');});
    document.querySelectorAll('.ledger-cell').forEach(node=>{node.disabled=true;});
    document.querySelectorAll('.wrap button').forEach(node=>{
      if(node.matches(allowed)||node.matches('[data-placedetail],[data-stop-action="details"],[data-resource-open],[data-shared-file],[data-shared-stop-detail]'))return;
      if([...node.attributes].some(attr=>/^data-(?:.*-)?(?:add|edit|delete|remove|upload|save|reimburse)(?:-|$)/.test(attr.name)))node.hidden=true;
      else node.disabled=true;
    });
    if(trip()?.workspaceView==='materials'&&options.files){
      const host=document.querySelector('#trip-workspace-content');if(host){let files=host.querySelector('.shared-attachment-list');if(!files){files=document.createElement('section');files.className='shared-attachment-list';host.append(files);}const entries=window.SappunSharedFiles?.files||[],signature=entries.map(file=>file.id+file.updated_at).join('|');if(files.dataset.signature!==signature){files.dataset.signature=signature;files.innerHTML='<h3>공유 첨부파일</h3>'+fileRows(entries)+(entries.length?'':'<p class="note">공유된 첨부파일이 없어요.</p>');}}
    }
  }
  function detail(index) {
    displayedResource=null;
    const stop=state.days[day]?.[index];if(!stop)return;
    detailContext={tripId:currentTripId,day,stopId:stop.id};
    detailPanel.hidden=false;document.body.classList.add('detail-open');
    detailPanel.innerHTML='<div class="detail-heading"><div><small>Day '+(day+1)+' · 장소 상세</small><h2>'+esc(stop.name)+'</h2></div><button type="button" data-shared-close aria-label="장소 상세 닫기">닫기 ×</button></div><div class="detail-body"><p>'+esc(hasStopTime(stop)?stopStart(stop)+'–'+stopEnd(stop):'시간 미정')+' · '+esc(stop.category)+'</p>'+(options.map?'<p>'+esc(stop.query||'')+'</p><button type="button" data-detail-map>지도에서 보기</button>':'')+(options.notes&&stop.note?'<section class="detail-section"><h3>메모</h3><p class="shared-note">'+esc(stop.note)+'</p></section>':'')+(options.costs?'<section class="detail-section"><h3>지출</h3>'+stopPersonalCosts(stop)+(stop.costItems||[]).map(item=>'<p>'+esc(item.name)+' · '+money(TravelFinance.totalKRW(item,state.settings.people,won))+'</p>').join('')+'</section>':'')+'<button type="button" data-shared-close class="shared-sheet-close">일정으로 돌아가기</button></div>';
  }
  function resource(id) {
    const item=state.resources?.find(entry=>entry.id===id);if(!item)return;
    detailContext=null;
    displayedResource=id;
    detailPanel.hidden=false;document.body.classList.add('detail-open');
    const files=(window.SappunSharedFiles?.files||[]).filter(file=>file.resource_id===id||(file.stop_id&&(item.stopIds||[]).includes(file.stop_id)));
    detailPanel.innerHTML='<div class="detail-heading"><h2>'+esc(item.title)+'</h2><button type="button" data-shared-close aria-label="자료 닫기">닫기 ×</button></div><div class="detail-body">'+(item.cover?'<img class="shared-resource-cover" src="'+esc(item.cover)+'" alt="" />':'')+'<p class="shared-note">'+esc(item.note||'')+'</p>'+(item.references||[]).filter(link=>/^https?:\/\//.test(link.url)).map(link=>TravelMedia.link(link.url,link.title,{mode:'preview'})).join('')+fileRows(files)+'<button type="button" data-shared-close class="shared-sheet-close">자료실로 돌아가기</button></div>';
  }
  function install() {
    if(installed)return;installed=true;
    const before=render;
    render=function(...args){
      const active=trip()?.workspaceView==='itinerary'&&trip()?.viewMode==='list'?'list':trip()?.workspaceView||'itinerary';
      if(trip()&&!options.tabs.includes(active)){const next=options.tabs[0];trip().workspaceView=next==='list'?'itinerary':next;trip().viewMode=next==='list'?'list':'map';}
      const result=before.apply(this,args);apply();if(trip())document.title='공유 · 사뿐 · '+trip().title;return result;
    };
    openDetail=detail;
    renderDetail=function(){if(!detailContext)return;const context=detailContext;day=context.day;const index=state.days[day]?.findIndex(stop=>stop.id===context.stopId);if(index>=0)detail(index);else closeDetail();};
    window.addEventListener('keydown',event=>{if(event.key==='Escape'&&document.body.classList.contains('shared-readonly')&&!document.querySelector('dialog[open]')){displayedResource=null;closeDetail();}});
    // Window capture runs before the editor's document handlers.
    window.addEventListener('click',event=>{
      if(!document.body.classList.contains('shared-readonly'))return;
      const target=event.target;
      if(target.closest('#shared-file-preview'))return;
      const stopDetail=target.closest('[data-shared-stop-detail]');if(stopDetail){event.preventDefault();event.stopImmediatePropagation();day=Number(stopDetail.closest('[data-group-day]').dataset.groupDay);detail(Number(stopDetail.dataset.sharedStopDetail));return;}
      const file=target.closest('[data-shared-file]');if(file){event.preventDefault();event.stopImmediatePropagation();const record=window.SappunSharedFiles?.files.find(item=>item.id===file.dataset.sharedFile);if(record)window.SappunSharedFiles.open(record,file.dataset.sharedFileMode);return;}
      const preview=target.closest('[data-media-mode]');if(preview){event.preventDefault();event.stopImmediatePropagation();const show=preview.dataset.mediaMode==='preview';preview.closest('figure').querySelectorAll('.restored-link-preview,img,video,audio,object').forEach(node=>node.style.display=show?'':'none');preview.dataset.mediaMode=show?'mention':'preview';preview.textContent=show?'미리보기 접기':'미리보기 보기';return;}
      if(target.closest('[data-shared-close]')){event.preventDefault();event.stopImmediatePropagation();displayedResource=null;closeDetail();return;}
      const res=target.closest('[data-resource-open]');
      if(res){event.preventDefault();event.stopImmediatePropagation();resource(res.dataset.resourceOpen);return;}
      const tab=target.closest('[data-workspace-view]');
      if(tab&&!options.tabs.includes(tab.dataset.workspaceView)){event.preventDefault();event.stopImmediatePropagation();return;}
      if(target.closest(allowed))return;
      const card=target.closest('#stops [data-card-index]');
      if(card){event.preventDefault();event.stopImmediatePropagation();day=Number(card.closest('[data-group-day]')?.dataset.groupDay||day);const index=Number(card.dataset.cardIndex);if(target.closest('[data-placedetail],[data-stop-action="details"]')||!options.map||trip().viewMode==='list')detail(index);else focusCard(index);return;}
      if(target.closest('button,input,textarea,select,[contenteditable],.prep-task')){event.preventDefault();event.stopImmediatePropagation();}
    },true);
    for(const name of ['input','change','submit','dragstart','drop'])window.addEventListener(name,event=>{if(document.body.classList.contains('shared-readonly')){event.preventDefault();event.stopImmediatePropagation();}},true);
    new MutationObserver(apply).observe(document.body,{childList:true,subtree:true});
  }
  function open(payload,id,preserve=false) {
    options=payload.trip.options;install();
    const t=structuredClone(payload.trip.planner);t.id='shared-'+id;
    const previous=preserve?trip():null,previousDay=day;
    if(previous){t.workspaceView=previous.workspaceView;t.viewMode=previous.viewMode;t.closedDays=previous.closedDays;t.mapDisplay=previous.mapDisplay;}
    else {const first=options.tabs.includes('itinerary')?'itinerary':options.tabs[0];t.workspaceView=first==='list'?'itinerary':first;t.viewMode=first==='list'?'list':'map';}
    t.data.settings={...DEFAULT_SETTINGS,...t.data.settings,key:payload.mapKey||''};
    tripBook={version:3,key:payload.mapKey||'',trips:[t]};currentTripId=t.id;state=t.data;
    t.data.days.flat().forEach(normalizeStop);
    window.SAPPUN_SHARED_MAP_KEY=payload.mapKey||'';
    homeOpen=false;home.hidden=true;document.querySelector('.wrap').hidden=false;
    day=preserve?Math.min(previousDay,state.days.length-1):0;selected=0;filter='전체';activeScheduleCard=null;lastOverviewKey='';allMapSignature='';
    document.body.classList.add('shared-readonly');
    document.body.classList.toggle('shared-hide-costs',!options.costs);
    document.body.classList.toggle('shared-hide-summary',!options.members);
    document.body.classList.toggle('shared-hide-map',!options.map);
    document.querySelector('#cloud-gate').hidden=true;document.body.classList.remove('auth-pending');
    render();if(payload.mapKey&&!gmap)loadGoogle();
    const hero=document.querySelector('.hero');let cover=hero.querySelector('.shared-trip-cover');if(t.cover){if(!cover){cover=document.createElement('img');cover.className='shared-trip-cover';cover.alt='';hero.prepend(cover);}cover.src=t.cover;}else cover?.remove();
    if(!options.members)document.querySelector('.hero p').textContent=t.location+' · '+t.start+' — '+t.end+' · '+state.settings.people+'명';
    if(preserve&&displayedResource)resource(displayedResource);
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
