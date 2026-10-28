/* Login gate, owner-only private sync, and independent password-protected read-only view. */
(function installCloudAccess() {
  'use strict';
  const gate = document.getElementById('cloud-gate');
  const apiBase = (window.SAPPUN_CLOUD?.apiBase || '').replace(/\/$/, '');
  const shareId = new URLSearchParams(location.search).get('share');
  const pageAddress = new URL(location.href);
  const localPreview = !shareId && (pageAddress.protocol === 'file:' ||
    ['localhost', '127.0.0.1', '[::1]'].includes(pageAddress.hostname));
  let token = sessionStorage.getItem('sappun-owner-session') || '';
  let revision = 0, ready = false, paused = false, timer, inFlight, statusNode, shareButton;
  let lastSaved = '';
  const el = (tag, className, content) => {
    const node = document.createElement(tag); if (className) node.className = className;
    if (content !== undefined) node.textContent = content; return node;
  };
  const button = (label, action, secondary = false) => {
    const node = el('button', 'cloud-button' + (secondary ? ' secondary' : ''), label);
    node.type = 'button'; if (action) node.onclick = action; return node;
  };
  function message(error) { return error?.message || '연결하지 못했어요. 다시 시도해 주세요.'; }
  async function api(path, {method = 'GET', body, auth = token} = {}) {
    if (!/^https:\/\//.test(apiBase) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(apiBase)) throw Error('아직 서버 주소가 연결되지 않았어요. 배포 설정을 먼저 완료해 주세요.');
    const response = await fetch(apiBase + path, {
      method, credentials:'omit', cache:'no-store', referrerPolicy:'no-referrer',
      headers:{...(body ? {'Content-Type':'application/json'} : {}), ...(auth ? {Authorization:'Bearer ' + auth} : {})},
      ...(body ? {body:JSON.stringify(body)} : {}), signal:AbortSignal.timeout(20000)
    });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error || '요청을 처리하지 못했어요.'), {status:response.status});
    return data;
  }
  function entry(title, copy) {
    document.body.classList.add('auth-pending'); gate.hidden = false; gate.replaceChildren();
    const outer = el('div','cloud-entry'), card = el('section','cloud-card');
    const brand = el('div','cloud-brand','사뿐'); brand.append(el('span','','.'));
    const error = el('p','cloud-error'); error.setAttribute('role','status');
    card.append(brand, el('h1','',title), el('p','',copy)); outer.append(card); gate.append(outer);
    return {card,error};
  }
  function passwordEye(input, beforeReveal) {
    const toggle=button('',null,true);toggle.className='cloud-password-eye';
    function draw(){const shown=input.type==='text';toggle.setAttribute('aria-label',shown?'비밀번호 숨기기':'비밀번호 보기');toggle.setAttribute('aria-pressed',String(shown));toggle.innerHTML='<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'+(shown?'<path d="m3 3 18 18"/>':'')+'</svg>';}
    toggle.onclick=async()=>{if(input.type==='password'&&beforeReveal&&!await beforeReveal())return;input.type=input.type==='password'?'text':'password';draw();};draw();return toggle;
  }
  function field(label, type, name, autocomplete, beforeReveal) {
    const node = el('label','',label), input = el('input'); input.type = type; input.name = name;
    input.required = true; input.maxLength = type === 'password' ? 128 : 100;
    input.autocomplete = autocomplete;
    if(type==='password'){const wrap=el('div','cloud-password-field'),toggle=passwordEye(input,beforeReveal);wrap.append(input,toggle);node.append(wrap);return {node,input,toggle};}
    node.append(input); return {node,input};
  }
  function login(errorText = '') {
    ready = false; token = ''; sessionStorage.removeItem('sappun-owner-session');
    const {card,error} = entry('나의 여행에 로그인', '내 계정으로 일정을 저장하고, 원하는 여행만 친구에게 공유해요.');
    const form = el('form','cloud-form');
    const user = field('아이디','text','username','username'), pass = field('비밀번호','password','password','current-password');
    if (localPreview) {
      user.input.required = false; pass.input.required = false;
      user.input.autocomplete = 'off'; pass.input.autocomplete = 'off';
    }
    const submit = button('로그인'); submit.type = 'submit';
    form.append(user.node,pass.node,submit,error);
    card.append(form,el('p','cloud-help',localPreview ? '화면 미리보기예요. 입력 없이 로그인 버튼을 눌러도 들어갈 수 있어요.' : '계정은 운영자가 미리 설정해요. 공유받은 친구는 공유 링크로 접속해 주세요.'));
    if (!apiBase && !localPreview) { error.textContent = '로그인 화면은 준비됐어요. Cloudflare 서버 연결 후 사용할 수 있어요.'; submit.disabled = true; }
    else error.textContent = errorText;
    form.onsubmit = async event => {
      event.preventDefault(); submit.disabled = true; error.textContent = '';
      if (localPreview) {
        user.input.value = ''; pass.input.value = '';
        gate.hidden = true; document.body.classList.remove('auth-pending'); showHome();
        return;
      }
      try {
        const result = await api('/api/login', {method:'POST', body:{username:user.input.value.trim(), password:pass.input.value}, auth:''});
        pass.input.value = ''; token = result.token; sessionStorage.setItem('sappun-owner-session',token);
        await initializeOwner();
      } catch (err) { error.textContent = message(err); } finally { submit.disabled = false; }
    };
  }
  function bookString() { return serializeTripBook(tripBook); }
  function replaceBook(book) {
    if (!book || !Array.isArray(book.trips) || !book.trips.every(t => t.id && t.data && validAnyData(t.data))) throw Error('저장된 여행 데이터 형식을 확인해 주세요.');
    const previous = bookString();
    // Preserve this device's previous book locally before the user explicitly selects cloud data.
    if (tripBook.trips.length && previous !== JSON.stringify(book)) localStorage.setItem('sappun-device-before-cloud', previous);
    tripBook = book; tripBook.key = sessionMapKey();
    tripBook.trips.forEach(t => {t.data.settings.key = tripBook.key;});
    currentTripId = tripBook.trips[0]?.id || null;
    state = trip()?.data || newTripData(1); day = 0; selected = 0;
    localStorage.setItem('sappun-trips-v3', bookString()); showHome();
  }
  async function chooseInitial(remote) {
    const local = bookString();
    if (!tripBook.trips.length || local === JSON.stringify(remote.book)) { if (remote.book) replaceBook(remote.book); return 'remote'; }
    return new Promise(resolve => {
      const {card,error} = entry('어떤 일정으로 시작할까요?', remote.book ? '이 기기와 서버에 저장된 일정이 달라요. 사용할 쪽을 골라 주세요.' : '이 기기의 여행을 내 계정의 비공개 저장소에 저장할까요?');
      const actions = el('div','cloud-form');
      actions.append(button('이 기기 일정 서버에 저장', () => resolve('local')));
      if (remote.book) actions.append(button('서버 일정 불러오기', () => {
        try { replaceBook(remote.book); resolve('remote'); } catch(err) { error.textContent = message(err); }
      },true));
      card.append(actions,el('p','cloud-help','서버에 저장해도 친구에게 공개되지 않아요. 공유는 여행별로 따로 만들어요. 첨부파일은 이 기기에만 남아요.'),error);
    });
  }
  async function initializeOwner() {
    const remote = await api('/api/book'); revision = remote.revision;
    if (remote.mapKey) { storeSessionMapKey(remote.mapKey); tripBook.key = remote.mapKey; state.settings.key = remote.mapKey; }
    const choice = await chooseInitial(remote);
    paused = false; ready = true;
    lastSaved = choice === 'remote' ? bookString() : '';
    installOwnerTools(); gate.hidden = true; document.body.classList.remove('auth-pending');
    if (statusNode) statusNode.textContent = '서버에 저장됨';
    if (choice === 'local') {
      try { await syncNow(); } catch (err) { if (ready) toast(message(err)); }
    }
  }
  function setStatus(value) { if (statusNode) statusNode.textContent = value; }
  // New uploads sync only the files just selected; sharing syncs this trip's files.
  async function prepareSharedCovers(tripId){
    if(!db)return;const target=tripBook.trips.find(item=>item.id===tripId);if(!target)return;
    const files=await allFiles(),items=[target,...(target.data.resources||[])];let changed=false;
    for(const item of items){if(!item.coverFileId||item.sharedCoverId===item.coverFileId)continue;const file=files.find(file=>file.id===item.coverFileId&&file.tripId===tripId);if(!file?.blob)continue;item.sharedCover=await travelCoverData(file.blob);item.sharedCoverId=item.coverFileId;changed=true;}
    if(changed)save();
  }
  async function syncShareFiles(tripId, selectedIds = null) {
    if(sharedViewMode||!ready||!db)return;
    const files=(await allFiles()).filter(file=>file.tripId===tripId&&file.blob&&(!selectedIds||selectedIds.includes(file.id))&&!['trip-cover','resource-cover'].includes(file.kind));
    const remote=(await api('/api/attachments')).files;
    for(const file of files){
      if(remote.some(item=>item.id===file.id&&item.size===file.blob.size))continue;
      if(file.blob.size>5*1024*1024)throw Error(file.name+' · 공유 첨부파일은 5MB 이하로 올려 주세요.');
      const form=new FormData();form.append('metadata',JSON.stringify({id:file.id,tripId,resourceId:file.resourceId,stopId:file.stopId}));form.append('file',file.blob,file.name);
      const response=await fetch(apiBase+'/api/attachments',{method:'POST',credentials:'omit',headers:{Authorization:'Bearer '+token},body:form,signal:AbortSignal.timeout(60000)});
      if(!response.ok){const result=await response.json();throw Error(result.error||'첨부파일을 저장하지 못했어요.');}
    }
  }
  window.SappunCloudFiles={upload:async(tripId,ids)=>{if(ready&&ids.length){await syncNow();await syncShareFiles(tripId,ids);}},remove:async id=>{if(ready)await api('/api/attachments/'+encodeURIComponent(id),{method:'DELETE'});}};
  async function syncNow() {
    clearTimeout(timer);
    if (!ready || paused) throw Error('서버 연결을 확인하거나 일정을 다시 불러와 주세요.');
    if (inFlight) { await inFlight; return syncNow(); }
    const packed = bookString(); if (packed === lastSaved) return;
    setStatus('저장 중…');
    inFlight = api('/api/book',{method:'PUT',body:{book:JSON.parse(packed),revision}})
      .then(result => {revision = result.revision; lastSaved = packed; setStatus('서버에 저장됨');})
      .catch(err => {
        if (err.status === 409) {paused = true; setStatus('다른 기기에서 수정됨 · 저장 확인 필요');}
        else if (err.status === 401) {paused = true; login('로그인 시간이 지났어요. 이 기기의 변경 내용은 보관되어 있어요.');}
        else setStatus('이 기기에 저장됨 · 서버 저장 재시도 필요');
        throw err;
      }).finally(() => {inFlight = null;});
    await inFlight;
    if (ready && !paused && bookString() !== lastSaved) return syncNow();
  }
  function queueSync() {
    if (!ready || paused) return;
    setStatus('변경 내용 저장 대기…'); clearTimeout(timer);
    timer = setTimeout(() => syncNow().catch(() => {}), 1200);
  }
  function dialog(title) {
    const node = el('dialog','cloud-dialog');
    const close = button('×', () => node.close(),true); close.className = 'cloud-close'; close.setAttribute('aria-label','닫기');
    node.append(close,el('h2','',title)); document.body.append(node);
    node.addEventListener('close',() => node.remove(),{once:true}); node.showModal(); return node;
  }
  function installOwnerTools() {
    if (document.querySelector('.cloud-account')) return;
    const account = el('div','cloud-account'); statusNode = el('span','cloud-status','서버에 저장됨'); statusNode.setAttribute('role','status');
    const manage = button('내 계정', () => accountDialog(), true); account.append(statusNode,manage);
    document.querySelector('body > header').append(account);
    shareButton = button('공유', () => shareDialog(), true); document.querySelector('body > header .tools').append(shareButton);
  }
  function accountDialog() {
    const panel = dialog('내 계정'), error = el('p','cloud-error');
    const saveButton = button('내 일정 서버에 저장',async () => {
      saveButton.disabled = true;
      try { await syncNow(); error.textContent = '서버에 저장했어요.'; } catch(err) { error.textContent = message(err); }
      finally {saveButton.disabled = false;}
    });
    const reload = button('서버 일정 다시 불러오기', async () => {
      if (!confirm('이 기기의 변경 내용을 대신해 서버 일정을 불러올까요? 현재 내용은 이 기기에 별도로 보관해요.')) return;
      try {
        const remote = await api('/api/book');
        if (remote.book) replaceBook(remote.book);
        revision = remote.revision; lastSaved = remote.book ? bookString() : ''; paused = false; queueSync(); panel.close();
      } catch(err) {error.textContent = message(err);}
    }, true);
    const logout = button('로그아웃',async () => {
      try { if (!paused) await syncNow(); else throw Error('서버에 저장되지 않은 변경이 있어요.'); }
      catch(err) {error.textContent = message(err); return;}
      try { await api('/api/logout',{method:'POST'}); panel.close(); ready = false; clearTimeout(timer); login(); }
      catch(err) {error.textContent = message(err);}
    },true);
    panel.append(el('p','','내 일정은 비공개로 저장해요. 로그아웃해도 이 기기에 저장한 일정은 남아요.'),saveButton,reload,logout,error);
  }
  async function shareDialog() {
    if (!trip() || homeOpen) { toast('공유할 여행을 먼저 열어 주세요.'); return; }
    const targetId = currentTripId, title = trip().title;
    const panel = dialog('여행 공유'), info = el('p','',title), form = el('form','cloud-form'), error = el('p','cloud-error');
    const password = field('친구에게 알려줄 비밀번호 (8자 이상)','password','share-password','new-password'); password.input.minLength = 8;
    const expiry = field('공유 만료일','datetime-local','expires','off');
    const localDate = date => new Date(date.getTime() - date.getTimezoneOffset()*60000).toISOString().slice(0,16);
    expiry.input.value = localDate(new Date(Date.now()+7*86400000));
    expiry.input.min = localDate(new Date()); expiry.input.max = localDate(new Date(Date.now()+90*86400000));
    const submit = button('공유 링크 만들기'); submit.type = 'submit';
    const selections=el('fieldset','cloud-share-options');selections.append(el('legend','','보여줄 탭'));
    const tabChecks=new Map(),optionChecks=new Map();
    const check=(parent,label,checked)=>{const row=el('label','cloud-share-check'),input=el('input');input.type='checkbox';input.checked=checked;row.append(input,el('span','',label));parent.append(row);return input;};
    for(const [key,label] of [['itinerary','여행 일정'],['list','시간표'],['settlement','경비'],['preparation','체크리스트'],['materials','자료실 · 내용과 링크']])tabChecks.set(key,check(selections,trip().workspaceTabs?.find(tab=>tab.key===key)?.label||label,['itinerary','list'].includes(key)));
    const details=el('fieldset','cloud-share-options');details.append(el('legend','','함께 보여줄 정보'));
    for(const [key,label,checked] of [['map','연결한 지도와 장소 핀',true],['notes','일정 메모',false],['costs','비용 · 예산 · 이동 교통비',false],['members','여행자 이름과 사진 · 메인 요약 카드',false]])optionChecks.set(key,check(details,label,checked));
    tabChecks.get('settlement').onchange=()=>{if(tabChecks.get('settlement').checked)optionChecks.get('costs').checked=true;};
    optionChecks.get('costs').onchange=()=>{if(!optionChecks.get('costs').checked)tabChecks.get('settlement').checked=false;};
    const shareSettings=()=>({tripId:targetId,options:{tabs:[...tabChecks].filter(([,input])=>input.checked).map(([key])=>key),...Object.fromEntries([...optionChecks].map(([key,input])=>[key,input.checked])),files:tabChecks.get('materials').checked},mapKey:optionChecks.get('map').checked?(state.settings.key||sessionMapKey()):''});
    let optionsEdited=false;selections.addEventListener('change',()=>{optionsEdited=true;});details.addEventListener('change',()=>{optionsEdited=true;});
    const protection=el('fieldset','cloud-share-options');protection.append(el('legend','','링크 보호'));
    const passwordEnabled=check(protection,'비밀번호 사용',true);
    protection.append(el('p','cloud-help','끄면 링크를 가진 누구나 선택한 일정과 첨부파일을 볼 수 있어요. 기존 링크의 비밀번호는 유지돼요.'));
    passwordEnabled.onchange=()=>{password.input.disabled=!passwordEnabled.checked;password.input.required=passwordEnabled.checked;password.node.hidden=!passwordEnabled.checked;};
    form.append(protection,password.node,expiry.node,selections,details,submit,error);
    panel.append(info,el('p','cloud-help','공유 내용 업데이트로 최신 일정을 저장해요. 자동 조회는 하지 않아요. 친구는 링크를 다시 열거나 브라우저를 새로고침하면 최신 내용을 볼 수 있어요. 자료실 첨부파일은 파일당 5MB, 전체 200MB까지 가능해요.'),form);
    const list = el('div'); panel.append(list);
    const linkFor = id => {const link = new URL('travel-planner.html', location.href); link.search = ''; link.hash = ''; link.searchParams.set('share',id); return link.href;};
    const copy = async (value, note) => {
      try { await navigator.clipboard.writeText(value); note.textContent = '링크를 복사했어요. 비밀번호를 설정했다면 따로 알려 주세요.'; }
      catch {note.textContent = value;}
    };
    async function refresh() {
      const {shares} = await api('/api/shares'); list.replaceChildren(el('h3','','공유 중인 링크'));
      const visible=shares.filter(item=>(item.tripId?item.tripId===targetId:item.title===title)&&!item.revoked&&item.expires_at*1000>Date.now());
      for (const item of visible) {
        const row = el('div','cloud-share-item');
        const active = !item.revoked && item.expires_at*1000 > Date.now();
        const note = el('p','cloud-help');
        row.append(el('strong','',item.title),el('small','',active ? new Date(item.expires_at*1000).toLocaleString('ko-KR')+'까지' : '공유 종료'));
        if (active) {
          if(item.passwordRequired===false){row.append(el('p','cloud-help','비밀번호 없음 · 링크를 가진 누구나 볼 수 있어요.'));}
          else if(item.hasPassword){
            let loaded=false;
            const saved=field('설정한 비밀번호','password','saved-share-password','off',async()=>{
              if(loaded)return true;
              try{const result=await api('/api/shares/'+item.id+'/password');if(!result.password){note.textContent='이전 비밀번호는 다시 설정해 주세요.';return false;}saved.input.value=result.password;loaded=true;return true;}
              catch(err){error.textContent=message(err);return false;}
            });saved.input.required=false;saved.input.readOnly=true;saved.input.placeholder='••••••••';saved.node.classList.add('cloud-saved-password');row.append(saved.node);
          }else{
            const reset=el('div','cloud-password-reset'),next=field('새 공유 비밀번호','password','reset-share-password','new-password');next.input.minLength=8;next.input.required=false;
            const apply=button('비밀번호 다시 설정',async event=>{
              event.currentTarget.disabled=true;
              try{await api('/api/shares/'+item.id+'/password',{method:'PUT',body:{password:next.input.value}});next.input.value='';await refresh();}
              catch(err){error.textContent=message(err);}finally{event.currentTarget.disabled=false;}
            },true);
            reset.append(el('p','cloud-help','이전 링크의 비밀번호는 확인할 수 없어요. 다시 설정하면 이후에는 여기서 볼 수 있어요.'),next.node,apply);row.append(reset);
          }
          const actions = el('div','cloud-share-actions');
          actions.append(button('링크 복사',() => copy(linkFor(item.id),note),true),button('공유 내용 업데이트',async event=>{
            event.currentTarget.disabled=true;
            try{const settings=shareSettings();if(!optionsEdited&&item.options)settings.options=item.options;await prepareSharedCovers(targetId);await syncNow();if(settings.options.tabs.includes('materials'))await syncShareFiles(targetId);await api('/api/shares/'+item.id,{method:'PATCH',body:settings});note.textContent='공유 내용을 업데이트했어요. 친구는 링크를 다시 열거나 브라우저를 새로고침하면 확인할 수 있어요.';}
            catch(err){error.textContent=message(err);}finally{event.currentTarget.disabled=false;}
          },true),button('공유 취소',async event => {
            event.currentTarget.disabled = true;
            try {await api('/api/shares/'+item.id,{method:'DELETE'}); await refresh();}
            catch(err) {error.textContent = message(err); event.currentTarget.disabled = false;}
          },true)); row.append(actions);
        }
        row.append(note); list.append(row);
      }
      if (!visible.length) list.append(el('p','','공유 중인 링크가 없어요.'));
    }
    form.onsubmit = async event => {
      event.preventDefault(); submit.disabled = true; error.textContent = '';
      try {
        await prepareSharedCovers(targetId);
        await syncNow();
        if(tabChecks.get('materials').checked)await syncShareFiles(targetId);
        const result = await api('/api/shares',{method:'POST',body:{...shareSettings(),password:passwordEnabled.checked?password.input.value:'',passwordRequired:passwordEnabled.checked,expiresAt:Math.floor(new Date(expiry.input.value).getTime()/1000)}});
        password.input.value = '';
        const resultBox = el('div','cloud-share-result'), note = el('p','cloud-help',linkFor(result.id));
        resultBox.append(note,button('링크 복사',() => copy(linkFor(result.id),note))); form.after(resultBox); await refresh();
      } catch(err) {error.textContent = message(err);} finally {submit.disabled = false;}
    };
    try { await refresh(); } catch(err) {error.textContent = message(err);}
  }
  function sharedLogin(errorText = '') {
    const {card,error} = entry('함께 보는 여행', '공유받은 비밀번호를 입력해 주세요. 일정은 읽기만 할 수 있어요.');
    const form = el('form','cloud-form'), password = field('공유 비밀번호','password','password','off');
    const submit = button('일정 보기'); submit.type = 'submit'; error.textContent = errorText;
    form.append(password.node,submit,error); card.append(form);
    if (!apiBase) {error.textContent = '아직 공유 서버가 연결되지 않았어요.'; submit.disabled = true;}
    form.onsubmit = async event => {
      event.preventDefault(); submit.disabled = true; error.textContent = '';
      try {
        const result = await api(`/api/shared/${shareId}/unlock`,{method:'POST',body:{password:password.input.value},auth:''});
        password.input.value = ''; await showShared(result.token);
      } catch(err) {error.textContent = message(err);} finally {submit.disabled = false;}
    };
  }
  async function showShared(shareToken) {
    let payload = await api('/api/shared/'+shareId,{auth:shareToken});
    if(payload.trip.planner){
      window.SappunSharedFiles={files:payload.files||[],open:async(file,mode)=>{
        let panel=null,viewer=null,download=null,url='';
        const save=()=>{const anchor=document.createElement('a');anchor.href=url;anchor.download=file.name;document.body.append(anchor);anchor.click();anchor.remove();};
        if(mode!=='download'){
          panel=dialog(file.name);panel.id='shared-file-preview';
          viewer=el('div','shared-file-viewer','파일을 불러오는 중…');viewer.setAttribute('role','status');
          download=button('다운로드',save);download.disabled=true;
          const actions=el('div','shared-file-preview-actions');actions.append(download);panel.append(viewer,actions);
          panel.addEventListener('close',()=>{if(url)URL.revokeObjectURL(url);},{once:true});
        }
        try{
          const response=await fetch(apiBase+'/api/shared/'+shareId+'/files/'+encodeURIComponent(file.id),{headers:{Authorization:'Bearer '+shareToken},credentials:'omit',cache:'no-store'});
          if(!response.ok)throw Error('파일을 열지 못했어요. 공유 상태를 확인해 주세요.');
          const raw=await response.blob(),ext=file.name.split('.').pop().toLowerCase();
          const mime=raw.type&&!['application/octet-stream',''].includes(raw.type)?raw.type:({pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',txt:'text/plain',mp4:'video/mp4',mp3:'audio/mpeg'}[ext]||'application/octet-stream');
          const safe=/^(application\/pdf|image\/(png|jpeg|webp|gif)|text\/plain|video\/mp4|audio\/(mpeg|wav))$/.test(mime);
          url=URL.createObjectURL(new Blob([raw],{type:safe?mime:'application/octet-stream'}));
          if(mode==='download'){save();setTimeout(()=>URL.revokeObjectURL(url),60000);return;}
          if(!panel.isConnected){URL.revokeObjectURL(url);return;}
          download.disabled=false;viewer.replaceChildren();
          if(/^image\/(png|jpeg|webp|gif)$/.test(mime)){const image=el('img');image.src=url;image.alt=file.name;viewer.append(image);}
          else if(mime==='application/pdf'){const frame=el('iframe');frame.src=url;frame.title=file.name+' PDF 미리보기';viewer.append(frame,el('p','cloud-help','미리보기가 표시되지 않는 기기에서는 다운로드해 확인해 주세요.'));}
          else if(mime==='text/plain'){const text=el('pre');text.textContent=await raw.text();viewer.append(text);}
          else if(/^(video|audio)\//.test(mime)&&safe){const media=el(mime.startsWith('video')?'video':'audio');media.src=url;media.controls=true;viewer.append(media);}
          else viewer.append(el('p','','이 파일 형식은 미리보기를 지원하지 않아요. 다운로드해서 확인해 주세요.'));
        }catch(error){if(viewer)viewer.textContent=message(error);else toast(message(error));}
      }};
      SappunSharedPlanner.open(payload,shareId);
      setTimeout(()=>{SappunSharedPlanner.close();sharedLogin('공유가 만료되었어요.');},Math.max(0,payload.expiresAt*1000-Date.now()));
      return;
    }
    let activeDay = 0, map, markers = [], stopsObserver;
    gate.replaceChildren();
    const page = el('main','shared-page'), heading = el('header','shared-header');
    heading.append(el('div','cloud-brand','사뿐.'),el('h1','',payload.trip.title),el('p','',payload.trip.location+' · 읽기 전용'));
    const mapArea = el('div','shared-map'), mapNote = el('p','shared-map-note','저장된 위치가 있는 일정만 지도에 표시해요.');
    const bar = el('nav','shared-daybar'), list = el('div','shared-list'), status = el('p','shared-map-note');
    const choose = button('',openDates,true), prev = button('‹',() => selectDay(activeDay-1),true), next = button('›',() => selectDay(activeDay+1),true);
    prev.setAttribute('aria-label','이전 날짜'); next.setAttribute('aria-label','다음 날짜'); choose.classList.add('shared-day-choice');
    bar.append(prev,choose,next); page.append(heading,mapArea,mapNote,bar,list,status); gate.append(page);
    function focusStop(index, pan = true) {
      const target = markers.find(marker => marker.stopIndex === index);
      list.querySelectorAll('.shared-stop').forEach((node,i) => node.setAttribute('aria-pressed',String(i===index)));
      for (const marker of markers) {
        const active = marker === target;
        if (marker.pin.classList.contains('active') !== active) marker.pin.classList.toggle('active',active);
        marker.pin.style.opacity = target && !active ? '.35' : '1'; marker.object.zIndex = active ? 100000 : marker.stopIndex;
      }
      if (target && pan) map.panTo(target.object.position);
    }
    function drawPins() {
      markers.forEach(marker => {marker.object.map = null;}); markers = [];
      if (!map) return;
      const bounds = new google.maps.LatLngBounds();
      (payload.trip.days[activeDay] || []).forEach((stop,i) => {
        if (!stop.point) return;
        const pin = el('div','shared-pin',String(i+1)); pin.style.setProperty('--pin-color',dayPalette[activeDay % dayPalette.length]);
        const marker = new google.maps.marker.AdvancedMarkerElement({map,position:stop.point,title:stop.name,content:pin});
        marker.addListener('click',() => { list.children[i]?.scrollIntoView({block:'center',behavior:'smooth'}); focusStop(i); });
        markers.push({object:marker,pin,stopIndex:i}); bounds.extend(stop.point);
      });
      if (markers.length > 1) map.fitBounds(bounds,40);
      else if (markers.length) {map.setCenter(markers[0].object.position);map.setZoom(15);}
      mapNote.textContent = markers.length ? '일정을 누르면 해당 핀이 강조돼요. 저장된 위치만 사용해요.' : '이 날짜에는 저장된 지도 위치가 없어요.';
    }
    function dateLabelShared(index) {
      const start = new Date(payload.trip.start+'T00:00:00Z'); start.setUTCDate(start.getUTCDate()+index);
      return start.toLocaleDateString('ko-KR',{timeZone:'UTC',month:'long',day:'numeric',weekday:'short'});
    }
    function selectDay(index) {
      if (index < 0 || index >= payload.trip.days.length) return;
      activeDay = index; prev.disabled = !index; next.disabled = index === payload.trip.days.length-1;
      choose.textContent = `Day ${index+1} · ${dateLabelShared(index)} ⌄`; list.replaceChildren();
      list.style.background = dayBackgrounds[index % dayBackgrounds.length];
      stopsObserver?.disconnect();
      payload.trip.days[index].forEach((stop,i) => {
        const card = el('button','shared-stop'); card.type = 'button'; card.setAttribute('aria-pressed','false'); card.dataset.index = i;
        const number = el('b','',String(i+1)); number.style.color = dayPalette[index % dayPalette.length];
        const content = el('div'); content.append(el('strong','',stop.name));
        content.append(el('small','',stop.startTime ? stop.startTime+'–'+stop.endTime : '시간 미정'));
        if (stop.category) content.append(el('small','',stop.category)); card.append(number,content); card.onclick = () => focusStop(i); list.append(card);
      });
      if (!list.children.length) list.append(el('p','','아직 일정이 없어요.'));
      drawPins();
      // Observe the top part of the visible itinerary instead of a clipped previous card.
      stopsObserver = new IntersectionObserver(entries => {
        const candidates = [...list.querySelectorAll('.shared-stop')].filter(node => {
          const rect = node.getBoundingClientRect(); return rect.top >= bar.getBoundingClientRect().bottom-20 && rect.top < innerHeight*.65;
        });
        if (candidates[0]) focusStop(Number(candidates[0].dataset.index));
      },{root:gate,threshold:[0,.5,1]});
      list.querySelectorAll('.shared-stop').forEach(node => stopsObserver.observe(node));
    }
    function openDates() {
      const sheet = dialog('날짜 선택'); sheet.classList.add('day-sheet');
      const grid = el('div','cloud-date-grid');
      payload.trip.days.forEach((_,i) => {
        const item = button(`D${i+1} · ${dateLabelShared(i)}`,() => {selectDay(i); sheet.close();},true);
        item.setAttribute('aria-pressed',String(i===activeDay)); grid.append(item);
      }); sheet.append(grid);
    }
    function closeShared(text) {
      stopsObserver?.disconnect(); markers.forEach(marker => {marker.object.map=null;}); markers = []; payload = null;
      document.querySelectorAll('.cloud-dialog').forEach(node => node.remove()); sharedLogin(text);
    }
    setTimeout(()=>closeShared('공유가 만료되었어요.'),Math.max(0,payload.expiresAt*1000-Date.now()));
    selectDay(0); status.textContent = '공유 만료: '+new Date(payload.expiresAt*1000).toLocaleString('ko-KR');
    if (!payload.mapKey) {mapNote.textContent = '지도 연결이 아직 설정되지 않았어요. 일정은 아래에서 볼 수 있어요.'; return;}
    try {
      if (!window.google?.maps?.Map) await new Promise((resolve,reject) => {
        const script = document.createElement('script'); window.sappunSharedMapsReady = resolve;
        script.src = 'https://maps.googleapis.com/maps/api/js?key='+encodeURIComponent(payload.mapKey)+'&libraries=marker&loading=async&callback=sappunSharedMapsReady&language=ko';
        script.onerror = () => reject(Error('지도를 불러오지 못했어요.')); document.head.append(script);
      });
      if (!payload) return;
      map = new google.maps.Map(mapArea,{center:{lat:0,lng:0},zoom:2,mapId:'DEMO_MAP_ID',streetViewControl:false,mapTypeControl:false}); drawPins();
    } catch(err) {mapNote.textContent = message(err);}
  }
  if (shareId) {
    document.title='공유 · 사뿐';
    token = ''; // Shared mode never uses an owner's session or owner endpoints.
    if (!/^[a-f0-9]{64}$/.test(shareId)) entry('공유 링크 확인','올바른 공유 링크로 다시 접속해 주세요.');
    else {
      entry('함께 보는 여행','공유 링크를 확인하고 있어요.');
      api('/api/shared/'+shareId+'/access',{auth:''}).then(async access=>{
        if(access.passwordRequired){sharedLogin();return;}
        const result=await api('/api/shared/'+shareId+'/unlock',{method:'POST',body:{},auth:''});
        await showShared(result.token);
      }).catch(err=>sharedLogin(message(err)));
    }
    return;
  }
  // Local UI preview has no fake account/session and never starts cloud sync.
  if (localPreview) { login(); return; }
  // Subscribe only after all original app extensions have installed their save wrappers.
  const originalSave = save;
  save = function(...args) { const result = originalSave.apply(this,args); if (result !== false) queueSync(); return result; };
  window.addEventListener('sappun-book-changed',queueSync);
  window.addEventListener('online',() => {if (ready && !paused) queueSync();});
  window.addEventListener('beforeunload',event => {
    if (ready && bookString() !== lastSaved) { event.preventDefault(); event.returnValue = ''; }
  });
  if (token) initializeOwner().catch(err => login(message(err))); else login();
})();
