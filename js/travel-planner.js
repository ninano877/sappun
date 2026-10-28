// 1. world-currency-core

/* ============================================================
 * 공통 통화 계산
 * - 총예산·지출·잔액의 기본 표시는 원화(KRW)입니다.
 * - currencyRates에는 '외화 1단위 = 원화 몇 원'을 저장합니다.
 * - 기존 rate 필드는 과거 엔화 데이터 호환용으로 유지합니다.
 * ============================================================ */
function travelCurrency(settings = state.settings) {
  return settings.travelCurrency || "KRW";
}

function serializeTripBook(value) {
  return JSON.stringify(value, (name, item) =>
    name === 'key' && ['itinerary','list','settlement','preparation','materials'].includes(item) ? item : name === 'key' || /^(?:api[_-]?key|access[_-]?token|secret|password|authorization)$/i.test(name) ? '' : item);
}
function sessionMapKey() {
  if (sharedViewMode) return window.SAPPUN_SHARED_MAP_KEY || '';
  try { return sessionStorage.getItem('sappun-map-key') || ''; } catch { return ''; }
}
function storeSessionMapKey(key) {
  if (sharedViewMode) { window.SAPPUN_SHARED_MAP_KEY = key || ''; return; }
  try {
    if (key) sessionStorage.setItem('sappun-map-key',key);
    else sessionStorage.removeItem('sappun-map-key');
  } catch {}
}

function supportedCurrencies() {
  return WORLD_CURRENCY_CODES;
}

function currencyName(code) {
  try {
    return new Intl.DisplayNames(["ko"], { type: "currency" }).of(code) || code;
  } catch {
    return code;
  }
}

function formatWon(amount) {
  if (amount === null || amount === undefined || !Number.isFinite(Number(amount))) return "—";
  const rounded = Math.round(Number(amount)), sign = rounded < 0 ? "-" : "";
  let value = Math.abs(rounded);
  if (value < 100000) return sign + value.toLocaleString("ko-KR") + "원";
  const parts = [];
  for (const [unit, label] of [[1e12,"조"],[1e8,"억"],[1e4,"만"]]) {
    const count = Math.floor(value / unit);
    if (count) { parts.push(String(count) + label); value %= unit; }
  }
  if (value) parts.push(value.toLocaleString("ko-KR"));
  return sign + parts.join(" ") + "원";
}
function formatCurrency(amount, code = travelCurrency()) {
  if (amount === null || amount === undefined || !Number.isFinite(Number(amount)))
    return "—";
  if (code === "KRW") return formatWon(amount);
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: code,
    currencyDisplay: "code",
    maximumFractionDigits: ["KRW", "JPY", "VND", "CLP", "IDR"].includes(code) ? 0 : 2,
  }).format(Number(amount));
}

function currencyRate(code, settings = state.settings) {
  if (code === "KRW") return 1;
  const saved = settings.currencyRates?.[code];
  if (Number.isFinite(saved) && saved > 0) return saved;
  // 업로드한 기존 파일의 엔화 환율을 그대로 사용합니다.
  if (code === "JPY" && Number.isFinite(settings.rate) && settings.rate > 0)
    return settings.rate;
  throw Error(`${code} 환율을 먼저 입력해 주세요. (환율 설정 버튼)`);
}

function convertToWon(amount, code = "JPY") {
  if (amount === null || amount === undefined || amount === "") return 0;
  return Number(amount) * currencyRate(code);
}

function expenseCurrencyOptions() {
  return [...new Set([travelCurrency(), "KRW"])];
}

function usedCurrencies(data) {
  const result = new Set();
  data.days.forEach((stops) =>
    stops.forEach((s) => {
      (s.costItems || []).forEach((e) => {
        if (e.actual !== null && e.actual !== undefined) result.add(e.currency || "JPY");
      });
      if (s.actualFare !== null && s.actualFare !== undefined)
        result.add(s.actualFareCurrency || s.fareCurrency || "JPY");
    }),
  );
  (data.expenses || []).forEach((e) => {
    if (e.actual !== null && e.actual !== undefined) result.add(e.currency || "JPY");
  });
  return [...result];
}

// 2. 기존 기능
const $ = (s) => document.querySelector(s),
  esc = TravelComponents.escape,
  uid = () => crypto.randomUUID();

let resetStoredTravelFiles = false;
const seed = {
  version: 2,
  settings: { ...DEFAULT_SETTINGS },
  days: [[]],
  expenses: [],
};
let state;
try {
  state = sharedViewMode ? seed : JSON.parse(localStorage.getItem("sappun-blue-v2")) || seed;
} catch {
  state = seed;
}
state.settings.key = sessionMapKey();
try { if (!sharedViewMode) localStorage.setItem('sappun-blue-v2',serializeTripBook(state)); } catch {}
let day = 0,
  selected = 0,
  filter = "전체",
  submitHandler,
  db,
  gmap,
  markers = [],
  polyline,
  renderToken = 0;

function toast(t, tone = "info") {
  $("#toast").dataset.tone = tone;
  $("#toast").textContent = t;
  $("#toast").hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ($("#toast").hidden = true), 3500);
}

const n = (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
  won = (a, c = "JPY") => convertToWon(a, c),
  money = (a) => formatWon(a),
  yen = (a) => "¥" + Number(a).toLocaleString("ko-KR");

function route(a, b) {
  return (
    "https://www.google.com/maps/dir/?api=1&origin=" +
    encodeURIComponent(a.query || a.name) +
    "&destination=" +
    encodeURIComponent(b.query || b.name) +
    "&travelmode=" +
    (a.mode === "도보" ? "walking" : a.mode === "택시" ? "driving" : "transit")
  );
}
$("#days").onclick = (e) => {
  let b = e.target.closest("[data-day]");
  if (b) {
    day = +b.dataset.day;
    selected = 0;
    filter = "전체";
    render();
  }
};
$("#filters").onclick = (e) => {
  let b = e.target.closest("[data-filter]");
  if (b) {
    filter = b.dataset.filter;
    render();
  }
};
document.onclick = (e) => {
  let b = e.target.closest("[data-select]");
  if (b) {
    selected = +b.dataset.select;
    render();
  }
  b = e.target.closest("[data-edit]");
  if (b) edit(+b.dataset.edit);
  b = e.target.closest("[data-leg]");
  if (b) leg(+b.dataset.leg);
  b = e.target.closest("[data-delete]");
  if (b && confirm("이 장소와 출발 구간 정보를 삭제할까요?")) {
    state.days[day].splice(+b.dataset.delete, 1);
    selected = Math.max(0, Math.min(selected, state.days[day].length - 1));
    save();
    render();
  }
  b = e.target.closest("[data-expdel]");
  if (b && confirm("이 공통 비용을 삭제할까요?")) {
    state.expenses.splice(+b.dataset.expdel, 1);
    save();
    render();
  }
};
function input(...args) {
  return TravelComponents.input(...args);
}
function select(label, id, values, selected) {
  if (id === "currency" || id === "farecurrency") {
    const options = [...new Set([...expenseCurrencyOptions(), selected])].filter(Boolean);
    return TravelComponents.choices(label, id, currencyChoices(options), selected);
  }
  const labels={음식:'식사·카페',관광:'관광·체험'};
  return TravelComponents.choices(label, id, values===categories?values.map(value=>({value,label:labels[value]||value})):values, selected);
}
const val = (id) => $("#f-" + id).value;
function modal(html, fn, { closeButton = false } = {}) {
  $("#formbody").innerHTML = html;
  $("#modal").classList.toggle("has-close-button", closeButton);
  $("#modal-close").hidden = !closeButton;
  $("#cancel").hidden = closeButton;
  submitHandler = fn;
  $("#modal").showModal();
  $("#formbody").scrollTop = 0;
}
$("#cancel").onclick = () => $("#modal").close();
$("#modal-close").onclick = () => $("#modal").close();
$("#form").onsubmit = async (e) => {
  e.preventDefault();
  try {
    if ((await submitHandler()) !== false) {
      save();
      $("#modal").close();
      render();
    }
  } catch (e) {
    toast("저장하지 못했습니다: " + e.message);
  }
};

function settings() {
  let s = state.settings;
  modal(
    /* HTML */ `<h2>여행 · 예산 설정</h2>
      <div class="fields">
        ${input(
          "여행 인원",
          "people",
          s.people,
          "number",
          'min="1" max="50" required',
        )}${input("1인 예산 · 원", "budget", s.budget || "", "number", 'min="0"')}
      </div>
      ${input(
        "계획 환율 · 1엔당 원 (실시간 환율 아님)",
        "rate",
        s.rate,
        "number",
        'min="0.01" step="0.01" required',
      )}
      <p class="note">
        기기 간 자동 동기화는 지원하지 않습니다. 첨부 파일까지 포함된 백업으로 이동할 수
        있어요.
      </p>`,
    () => {
      state.settings = {
        ...s,
        people: Number(val("people")),
        budget: Number(val("budget")),
        rate: Number(val("rate")),
      };
    },
  );
}

function openDb() {
  return new Promise((resolve, reject) => {
    let r = indexedDB.open("sappun-blue-files", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("files", { keyPath: "id" });
    r.onsuccess = () => {
      db = r.result;
      resolve(db);
    };
    r.onerror = () => reject(r.error);
  });
}
function dbop(mode, fn) {
  return new Promise((resolve, reject) => {
    let t = db.transaction("files", mode),
      r = fn(t.objectStore("files"));
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
const allFiles = () => sharedViewMode ? Promise.resolve([]) : dbop("readonly", (s) => s.getAll());

$("#upload").onclick = () => {trip().workspaceView="materials";save();render();};

function download(blob, name) {
  let u = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 10000);
}
let attachmentPreviewDialog=null,attachmentPreviewUrl='',attachmentPreviewRequest=0;
function clearAttachmentPreview(){
  attachmentPreviewRequest++;
  if(attachmentPreviewDialog){attachmentPreviewDialog.innerHTML='';if(attachmentPreviewDialog.open)attachmentPreviewDialog.close();}
  if(attachmentPreviewUrl){URL.revokeObjectURL(attachmentPreviewUrl);attachmentPreviewUrl='';}
}
async function openAttachmentPreview(id){
  const request=++attachmentPreviewRequest,tripId=currentTripId;
  try{
    const file=await dbop('readonly',store=>store.get(id));
    if(request!==attachmentPreviewRequest||tripId!==currentTripId)return;
    if(!file?.blob||!fileBelongs(file)){toast('파일을 찾을 수 없어요.','warning');return;}
    if(!attachmentPreviewDialog){
      attachmentPreviewDialog=document.createElement('dialog');attachmentPreviewDialog.id='attachment-preview-dialog';
      attachmentPreviewDialog.setAttribute('aria-labelledby','attachment-preview-title');document.body.append(attachmentPreviewDialog);
      attachmentPreviewDialog.addEventListener('close',()=>{if(!attachmentPreviewDialog.open)clearAttachmentPreview();});
      attachmentPreviewDialog.addEventListener('cancel',event=>{event.preventDefault();clearAttachmentPreview();});
      attachmentPreviewDialog.onclick=event=>{
        if(event.target.closest('[data-preview-close]')){clearAttachmentPreview();return;}
        if(event.target===attachmentPreviewDialog){const rect=attachmentPreviewDialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)clearAttachmentPreview();}
      };
    }
    if(attachmentPreviewUrl)URL.revokeObjectURL(attachmentPreviewUrl);
    attachmentPreviewUrl=URL.createObjectURL(file.blob);
    attachmentPreviewDialog.innerHTML='<div class="attachment-preview-heading"><div><small>예약서 · 여행 파일</small><h2 id="attachment-preview-title">'+esc(file.name)+'</h2></div><button type="button" data-preview-close aria-label="파일 미리보기 닫기" autofocus>×</button></div><div class="attachment-preview-body">'+TravelMedia.file(file,attachmentPreviewUrl)+'</div>';
    if(!attachmentPreviewDialog.open)attachmentPreviewDialog.showModal();
  }catch(error){if(request===attachmentPreviewRequest)toast('미리보기를 열지 못했어요. '+error.message,'warning');}
}
$("#files").onclick = async (e) => {
  const preview=e.target.closest('[data-filepreview]');
  if(preview){await openAttachmentPreview(preview.dataset.filepreview);return;}
  let b = e.target.closest("[data-download]");
  if (b) {
    let f = await dbop("readonly", (s) => s.get(b.dataset.download));
    if (f) download(f.blob, f.name);
  }
  b = e.target.closest("[data-filedelete]");
  if (b && confirm("첨부 파일을 삭제할까요?")) {
    await dbop("readwrite", (s) => s.delete(b.dataset.filedelete));
    renderFiles();
  }
};
function toData(blob) {
  return new Promise((res, rej) => {
    let r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}

$("#restore").onclick = () => $("#jsonfile").click();

function loadGoogle() {
  if (document.body.classList.contains('auth-pending')) return;
  if (gmap) {
    drawGoogle();
    return;
  }
  if (document.getElementById("google-api")) {
    toast("API 키를 변경했다면 페이지를 새로고침해 주세요");
    return;
  }
  window.initTripMap = async () => {
    try {
      await google.maps.importLibrary("marker");
      gmap = new google.maps.Map($("#gmap"), {
        center: { lat: 34.68, lng: 135.5 },
        zoom: 12,
        mapId: "DEMO_MAP_ID",
        mapTypeControl: false,
        streetViewControl: false,
        gestureHandling: "greedy",
        scrollwheel: true,
      });
      $("#embed").hidden = true;
      $("#gmap").hidden = false;
      drawGoogle();
    } catch {
      toast("Google 지도 연결에 실패했습니다");
    }
  };
  window.gm_authFailure = () => {};
  let script = document.createElement("script");
  script.id = "google-api";
  script.src =
    "https://maps.googleapis.com/maps/api/js?key=" +
    encodeURIComponent(state.settings.key) +
    "&loading=async&callback=initTripMap&libraries=marker&language=ko";
  script.onerror = () => toast("Google 지도 스크립트를 불러오지 못했습니다");
  document.head.append(script);
}
const geocache = new Map();

openDb()
  .then(async () => {
    if (resetStoredTravelFiles) await dbop("readwrite", store => store.clear());
    await renderFiles();
    if (homeOpen) renderHome();
  })
  .catch(() => {
    $("#files").innerHTML =
      '<p class="note">이 브라우저에서 첨부 저장소를 사용할 수 없습니다.</p>';
  });
if (state.settings.key) loadGoogle();

// 3. auto-routes-upgrade
// Google Maps demo-compatible Places (New) + Routes integration.
const resolvedPlaces = new Map(),
  placeJobs = new Map(),
  routeResults = new Map(),
  routeJobs = new Map();
let shownRouteLines = [],
  routeRefreshTimer = null,
  keyAtLoad = state.settings.key;

function stayMinutes(s) {
  return Number.isFinite(s.stay) ? s.stay : 60;
}
function clockAdd(time, minutes) {
  let [h, m] = String(time).split(":").map(Number),
    v = h * 60 + m + minutes;
  if (!Number.isFinite(v)) return "시간 확인";
  let days = Math.floor(v / 1440);
  v = ((v % 1440) + 1440) % 1440;
  return (
    (days > 0 ? "익일 " : "") +
    String(Math.floor(v / 60)).padStart(2, "0") +
    ":" +
    String(v % 60).padStart(2, "0")
  );
}

function currentRoute(d, i) {
  let x = routeResults.get(routeSignature(d, i));
  return x && Date.now() - x.fetched < 600000 ? x : null;
}
function routeMoney(f) {
  if (!f) return null;
  let value = Number(f.units || 0) + Number(f.nanos || 0) / 1e9;
  return Number.isFinite(value) && supportedCurrencies().includes(f.currencyCode)
    ? { value, currency: f.currencyCode }
    : null;
}
function effectiveLeg(d, i) {
  let s = state.days[d][i],
    r = currentRoute(d, i);
  if (s.manualRoute)
    return {
      minutes: s.minutes,
      fare: s.fare,
      currency: s.actualFareCurrency || s.fareCurrency || travelCurrency(),
      source: "수동",
      route: r,
    };
  return {
    minutes: r?.status === "ok" ? r.minutes : s.minutes,
    fare: r?.status === "ok" ? (r.fare?.value ?? null) : s.fare,
    currency: r?.fare?.currency || travelCurrency(),
    source: r?.status === "ok" ? "Google 자동" : "미조회",
    route: r,
  };
}

function errorText(e) {
  let code = String(e?.code || e?.status || ""),
    msg = String(e?.message || e || "알 수 없는 오류");
  if (
    /REQUEST_DENIED|PERMISSION_DENIED|not authorized|ApiNotActivated|403/i.test(
      code + " " + msg,
    )
  )
    return "API 권한 거부: 키에서 Places API (New)·Routes API 지원 여부와 웹사이트 제한을 확인하세요.";
  if (/quota|RESOURCE_EXHAUSTED|OVER_QUERY_LIMIT|429/i.test(code + " " + msg))
    return "API 사용 한도 도달: 데모 키는 한도 초기화 후 다시 시도하세요.";
  if (/ZERO_RESULTS|NOT_FOUND/i.test(code + " " + msg))
    return "검색 결과 없음: 정확한 장소 또는 주소를 선택해 주세요.";
  if (/Failed to fetch|network/i.test(msg))
    return "네트워크 연결 또는 로컬 파일 실행 제한을 확인하세요.";
  return (code ? code + " · " : "") + msg.slice(0, 220);
}
async function lookupPlaces(query) {
  let { Place } = await google.maps.importLibrary("places");
  let { places } = await Place.searchByText({
    textQuery: query,
    fields: ["id", "displayName", "location", "formattedAddress"],
    language: "ko",
    maxResultCount: 5,
  });
  return places || [];
}
function linkedLodging(stop, data = state) {
  if (!stop?.lodgingStopId) return stop;
  return data.days.flat().find(candidate=>candidate.id===stop.lodgingStopId && candidate.id!==stop.id && candidate.category==='숙소' && !candidate.lodgingStopId) || stop;
}
function syncLodgingLinks(data) {
  for (const stop of data.days.flat()) {
    if (!stop.lodgingStopId) continue;
    const lodging=linkedLodging(stop,data);
    if(lodging===stop){delete stop.lodgingStopId;continue;}
    stop.query=lodging.query||'';stop.mapsUrl=lodging.mapsUrl||'';stop.category='숙소';
    stop.chosenPlace=lodging.placeQuery===lodging.query?lodging.chosenPlace:undefined;
    stop.placeQuery=stop.chosenPlace?stop.query:undefined;
  }
}
function lodgingLinkFields(stop, prefix='') {
  const options=state.days.flatMap((stops,d)=>stops.filter(candidate=>candidate.id!==stop?.id&&candidate.category==='숙소'&&!candidate.lodgingStopId).map(candidate=>({candidate,d})))
    .sort((a,b)=>Number(scheduleEndDate(b.candidate,b.d)>(b.candidate.startDate||tripDate(b.d)))-Number(scheduleEndDate(a.candidate,a.d)>(a.candidate.startDate||tripDate(a.d))));
  if(!options.length)return '';
  return '<label class="lodging-link-field">같은 숙소 연결<select id="f-'+prefix+'lodging"><option value="">연결 안 함 · 직접 입력</option>'+options.map(({candidate,d})=>'<option value="'+esc(candidate.id)+'" '+(stop?.lodgingStopId===candidate.id?'selected':'')+'>'+esc(candidate.name)+' · '+(candidate.startDate||tripDate(d)).slice(5).replace('-','/')+' ~ '+esc(scheduleEndDate(candidate,d).slice(5).replace('-','/'))+'</option>').join('')+'</select><small>숙소 복귀·취침 일정에 기존 숙소를 연결해요. 시간은 이 일정의 시간을 유지합니다.</small></label>';
}
function applyLodgingLink(stop, id) {
  if(!id){delete stop.lodgingStopId;return;}
  const target=state.days.flat().find(candidate=>candidate.id===id&&candidate.id!==stop.id&&candidate.category==='숙소'&&!candidate.lodgingStopId);
  if(!target)throw Error('연결할 숙소를 다시 선택해 주세요.');
  stop.lodgingStopId=id;stop.category='숙소';stop.query=target.query||'';stop.mapsUrl=target.mapsUrl||'';
  stop.chosenPlace=target.placeQuery===target.query?target.chosenPlace:undefined;stop.placeQuery=stop.chosenPlace?stop.query:undefined;
}
document.addEventListener('change',event=>{
  const prefix=event.target.id==='f-detaillodging'?'detail':event.target.id==='f-lodging'?'':null;
  if(prefix===null)return;
  const target=state.days.flat().find(stop=>stop.id===event.target.value);
  const query=$("#f-"+prefix+"query");
  if(query){query.readOnly=Boolean(target);if(target)query.value=target.query||'';}
  if(target){$("#f-"+prefix+"category").value='숙소';if(!prefix)$("#f-maplink").value=target.mapsUrl||'';}
  if(prefix==='detail'){
    const stop=detailStop();if(!stop)return;
    applyLodgingLink(stop,event.target.value);allMapSignature='';save();render();
    toast(target?'같은 숙소로 연결했어요. 복귀 시간은 유지됩니다.':'숙소 연결을 해제했어요.','success');
  }
});
async function resolvePlace(s, refresh = false) {
  if(sharedViewMode){const point=savedPoint(s);if(point)return point;throw Error('이 장소에는 저장된 지도 위치가 없어요.');}
  s = linkedLodging(s);
  if (!refresh && s.placeQuery === s.query && s.chosenPlace?.lat !== undefined) return s.chosenPlace;
  if (!s.query) throw Error("위치 미입력");
  const query = s.query;
  const persist = point => {
    if (s.query === query) { s.chosenPlace = point; s.placeQuery = query; save(); }
    return point;
  };
  if (!refresh && resolvedPlaces.has(query)) return persist(resolvedPlaces.get(query));
  if (placeJobs.has(query)) return persist(await placeJobs.get(query));
  let job = (async () => {
    let list = await lookupPlaces(query);
    let p = list.find(place=>place.id===s.chosenPlace?.id) || list[0];
    if (!p?.location) throw Error("ZERO_RESULTS");
    let v = {
      id: p.id,
      lat: p.location.lat(),
      lng: p.location.lng(),
      name: p.displayName,
      address: p.formattedAddress,
    };
    resolvedPlaces.set(query, v);
    return v;
  })();
  placeJobs.set(query, job);
  try {
    return persist(await job);
  } finally {
    placeJobs.delete(query);
  }
}
function extractRoute(r, mode) {
  const steps=(r.legs||[]).flatMap(leg=>(leg.steps||[]).map(step=>{const t=step.transitDetails||{},line=t.transitLine||{};return {
    mode:step.travelMode,text:step.navigationInstruction?.instructions||'',distance:step.distanceMeters||0,
    minutes:Math.ceil(Number(step.staticDurationMillis||0)/60000),line:line.nameShort||line.shortName||line.name||'',
    from:t.departureStop?.name||'',to:t.arrivalStop?.name||'',headsign:t.headsign||'',stopCount:t.stopCount??null,
    departureText:t.localizedValues?.departureTime?.time?.text||'',arrivalText:t.localizedValues?.arrivalTime?.time?.text||''
  };}));
  return {status:'ok',minutes:Math.ceil(Number(r.durationMillis||0)/60000),distance:r.distanceMeters||0,
    fare:mode==='도보'?{value:0,currency:'JPY'}:routeMoney(r.travelAdvisory?.transitFare),
    summary:r.description||steps.filter(s=>s.line).map(s=>s.line).join(' → '),steps,path:r.path||[],warnings:r.warnings||[],fetched:Date.now()};
}
async function lookupSegmentRoute(d, a, b, mode = a.mode, options = {}) {
  if (!state.settings.key || !gmap) throw Error("먼저 헤더의 지도 연결에서 Google 지도를 연결해 주세요.");
  if (!["대중교통", "도보", "택시"].includes(mode))
    throw Error(mode === "없음" ? "구간 없음을 선택했어요." : "이 이동 수단은 Google 경로를 제공하지 않아요. 소요 시간을 직접 입력해 주세요.");
  const departureTime = options.departureBasis==='now'?new Date():departAt(d, a);
  const travelMode = mode === "도보" ? "WALKING" : mode === "택시" ? "DRIVING" : "TRANSIT";
  if (travelMode === "TRANSIT") {
    if (options.departureBasis!=='now'&&!hasStopTime(a)) throw Error("대중교통 경로를 조회하려면 출발 장소에 시간을 먼저 추가해 주세요.");
    const delta = departureTime - Date.now();
    if (delta > 100 * 86400000 || delta < -7 * 86400000)
      throw Error("이 여행 날짜는 Google 대중교통 조회 가능 기간(과거 7일~미래 100일) 밖이에요. Google 길찾기에서 확인하거나 시간을 직접 입력해 주세요.");
  }
  const [origin, destination] = await Promise.all([resolvePlace(a), resolvePlace(b)]);
  const { Route } = await google.maps.importLibrary("routes");
  const request = {
    origin: { lat: origin.lat, lng: origin.lng }, destination: { lat: destination.lat, lng: destination.lng },
    travelMode, computeAlternativeRoutes: travelMode==='TRANSIT', fields: ["durationMillis", "distanceMeters", "path", "legs", "travelAdvisory", "localizedValues", "description", "warnings"],
  };
  if (travelMode === "TRANSIT") request.departureTime = departureTime;
  const response = await Route.computeRoutes(request);
  const result = response.routes?.[0];
  if (!result) throw Error("이 구간의 경로가 제공되지 않아요. Google 길찾기에서 확인해 주세요.");
  const departureLabel=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'short'}).format(departureTime);
  const alternatives=response.routes.map(route=>({...extractRoute(route,mode),departureLabel,departureBasis:options.departureBasis||'schedule',originName:origin.name||a.query||a.name||'',destinationName:destination.name||b.query||b.name||''}));
  return {...alternatives[0],alternatives};
}

async function getLeg(d, i, force = false, geometryOnly = false) {
  let a = state.days[d][i],
    b = state.days[d][i + 1],
    sig = routeSignature(d, i);
  if (!b || a.noTravel || (a.manualRoute && !geometryOnly)) return;
  if (routeJobs.has(sig)) return routeJobs.get(sig);
  if (!force && currentRoute(d, i)) return;
  if (["투어 버스", "항공", "기타"].includes(a.mode)) {
    routeResults.set(sig, {
      status: "manual",
      error: "예약한 교통편의 시간·요금을 입력하세요.",
      fetched: Date.now(),
    });
    return;
  }
  if (!a.query || !b.query) {
    routeResults.set(sig, {
      status: "error",
      error: "출발지·도착지의 지도 검색어가 필요해요.",
      fetched: Date.now(),
    });
    return;
  }
  let key = state.settings.key,
    mode = a.mode;
  let job = (async () => {
    try {
      const result = await lookupSegmentRoute(d, a, b, mode);
      if (key === state.settings.key) routeResults.set(sig, result);
    } catch (e) {
      if (key === state.settings.key)
        routeResults.set(sig, {
          status: "error",
          error: errorText(e),
          fetched: Date.now(),
        });
    } finally {
      routeJobs.delete(sig);
    }
  })();
  routeJobs.set(sig, job);
  return job;
}

async function refreshDay(force = false) {
  if (!state.settings.key || !gmap) {
    if (force) $("#mapsetup").click();
    return;
  }
  let d = day,
    items = state.days[d];
  for (let i = 0; i < items.length - 1; i++) {
    let sig = routeSignature(d, i);
    if (force) routeResults.delete(sig);
    if (items[i].manualRoute) continue;
    if (!currentRoute(d, i) && !routeJobs.has(sig)) {
      let job = getLeg(d, i, force);
      if (d === day) {
        let el = [...$("#stops").querySelectorAll(".leg")].find(
          (el) => Number(el.querySelector("[data-leg]")?.dataset.leg) === i,
        );
        if (el) el.innerHTML = renderLeg(d, i);
      }
      await job;
      if (d === day) render();
      if (day !== d) break;
    }
  }
}
document.addEventListener("change", (e) => {
  let b = e.target.closest("[data-legmode]");
  if (!b) return;
  let i = +b.dataset.legmode,
    s = state.days[day][i];
  s.mode = b.value;
  s.manualRoute = false;
  save();
  render();
});
document.addEventListener("click", (e) => {
  let b = e.target.closest("[data-routeauto]");
  if (b) {
    let i = +b.dataset.routeauto;
    state.days[day][i].manualRoute = false;
    routeResults.delete(routeSignature(day, i));
    save();
    render();
  }
  b = e.target.closest("[data-routedetail]");
  if (b) showRoute(+b.dataset.routedetail);
});
function showRoute(i) {
  let a = state.days[day][i],
    b = state.days[day][i + 1],
    r = currentRoute(day, i),
    l = effectiveLeg(day, i);
  modal(
    /* HTML */ `<h2>${esc(a.name)} → ${esc(b.name)}</h2>
      <p class="route-note">
        ${esc(a.mode)} · ${l.minutes === null ? "시간 미확인" : l.minutes + "분"} ·
        ${l.fare === null
          ? "요금 확인 필요"
          : (l.currency === "JPY" ? yen(l.fare) : money(l.fare)) + " / 인"}
      </p>
      ${r?.status === "ok"
        ? r.steps
            .map(
              (s) =>
                /* HTML */ `<div class="route-step">
                  <b
                    >${esc(
                      s.line ||
                        { WALKING: "도보", TRANSIT: "대중교통", DRIVING: "차량" }[
                          s.mode
                        ] ||
                        s.mode,
                    )}</b
                  >
                  <div>
                    ${esc(
                      s.from && s.to
                        ? s.from + " → " + s.to
                        : s.text.replace(/<[^>]*>/g, ""),
                    )}
                  </div>
                  <small
                    >${s.minutes ? s.minutes + "분 · " : ""}${s.distance
                      ? Math.round(s.distance) + "m"
                      : ""}</small
                  >
                </div>`,
            )
            .join("") || '<p class="note">상세 이동 단계가 제공되지 않았어요.</p>'
        : /* HTML */ `<p class="route-error">
            ${esc(r?.error || "경로 조회 전입니다.")}
          </p>`}
      <p class="note">
        체류 종료 ${hasStopTime(a) ? (a.endDate && a.endDate !== tripDate(day) ? a.endDate + " " : "") + stopEnd(a) : "시간 미입력"} 출발 기준 · 미래 운행 시간표·운임은
        바뀔 수 있어요. 요금 미제공 구간을 0원으로 계산하지 않습니다.
      </p>
      <a href="${route(a, b)}" target="_blank" rel="noopener">Google 지도에서 보기 ↗</a>`,
    () => {},
  );
  if (mapDayVisible(day) && r?.status === "ok" && r.path?.length) {
    shownRouteLines.forEach((p) => p.setMap(null));
    shownRouteLines = [
      new google.maps.Polyline({
        map: gmap,
        path: r.path.map(routePathPoint),
        strokeColor: dayColor(day),
        strokeWeight: 5,
        strokeOpacity: 0.85,
      }),
    ];
    let bounds = new google.maps.LatLngBounds();
    r.path.forEach((p) => bounds.extend(routePathPoint(p)));
    gmap.fitBounds(bounds, 50);
  }
}

$("#mapsetup").onclick = () =>
  modal(
    /* HTML */ `<h2>데모 API 키로 연결</h2>
      <p class="route-note">
        데모 키는 지도·번호 핀·지원되는 장소 및 경로 조회를 무료 한도 안에서 시험하는
        용도예요. 일반 키는 Google Cloud의 사용량 요금 정책이 적용됩니다.
      </p>
      ${input("API 키 · 채팅에 보낼 필요 없어요", "key", state.settings.key, "password")}
      <p class="note">
        이 버전은 Places (New)와 Routes를 사용합니다. 기존 Geocoder 방식과 달라요. 키는
        현재 탭 세션에서만 보관하고 영구 저장·백업에서 제외합니다. 기본 위치는 검색 첫 결과이므로 같은
        이름의 가게는 장소 수정 → 위치 검색·선택으로 확정하세요.
      </p>
      <a
        href="https://developers.google.com/maps/demo-key?hl=ko"
        target="_blank"
        rel="noopener"
        >데모 키 공식 안내 ↗</a
      >`,
    () => {
      let key = val("key").trim();
      state.settings.key = key;
      save();
      if (key !== keyAtLoad) {
        location.reload();
        return;
      }
      if (key) loadGoogle();
    },
  );

// 4. layout-search-upgrade
const mapSearchState = { results: [], token: 0 };
let overviewLines = [],
  lastOverviewKey = "";
function decodeMapsLink(value) {
  let text = value.trim();
  const pastedLink=text.match(/https?:\/\/[^\s<>"']+/i);
  if(pastedLink)text=pastedLink[0];
  if (!/^https?:\/\//i.test(text)) return { query: text };
  let url;
  try {
    url = new URL(text);
  } catch {
    throw Error("올바른 링크를 입력해 주세요.");
  }
  let host = url.hostname.toLowerCase();
  if (
    !/(^|\.)google\.(com|co\.jp|co\.kr)$/.test(host) &&
    !["maps.app.goo.gl", "goo.gl"].includes(host)
  )
    throw Error("Google 지도 링크 또는 장소 이름을 입력해 주세요.");
  if (host === "maps.app.goo.gl" || host === "goo.gl")
    return { short: true, url: url.href };
  let path;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    path = url.pathname;
  }
  let data;
  try {
    data = decodeURIComponent(url.href);
  } catch {
    data = url.href;
  }
  let q = url.searchParams.get("query") || url.searchParams.get("q") || "",
    id = url.searchParams.get("query_place_id") || "";
  if (q.startsWith("place_id:")) {
    id = q.slice(9);
    q = "";
  }
  let exact = data.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/),
    coord = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/),
    name = path.match(/\/maps\/place\/([^/]+)/)?.[1]?.replace(/\+/g, " ") || q;
  let location = exact
    ? { lat: Number(exact[1]), lng: Number(exact[2]) }
    : coord
      ? { lat: Number(coord[1]), lng: Number(coord[2]) }
      : null;
  if (location && (Math.abs(location.lat) > 90 || Math.abs(location.lng) > 180))
    throw Error("지도 링크의 좌표를 확인해 주세요.");
  if (!location && !id && !name)
    throw Error(
      "이 링크에서 장소를 읽을 수 없어요. 장소 상세 페이지의 긴 주소 또는 장소 이름을 입력해 주세요.",
    );
  return {
    query: name || "",
    id,
    location,
    name: name || "지도에서 가져온 장소",
    url: url.href,
  };
}
async function searchMapInput(value) {
  let parsed = decodeMapsLink(value);
  if (parsed.short) {
    const apiBase=(window.SAPPUN_CLOUD?.apiBase || '').replace(/\/$/,'');
    if (!apiBase) throw Error('공유 링크를 불러오지 못했어요. 장소 이름이나 긴 지도 주소를 입력해 주세요.');
    const response=await fetch(apiBase+'/api/maps/resolve',{
      method:'POST',credentials:'omit',referrerPolicy:'no-referrer',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({url:parsed.url}),signal:AbortSignal.timeout(15000)
    });
    const result=await response.json();
    if (!response.ok) throw Error(result.error || '공유 링크를 불러오지 못했어요.');
    parsed=decodeMapsLink(result.url);
    if (parsed.short) throw Error('장소 링크를 확인해 주세요.');
  }
  if (parsed.location)
    return [
      {
        ...parsed.location,
        id: parsed.id,
        name: parsed.name,
        address: parsed.query,
        url: parsed.url,
      },
    ];
  if (!gmap) throw Error("먼저 ‘지도 연결’에서 API 키를 연결해 주세요.");
  if (parsed.id) {
    let { Place } = await google.maps.importLibrary("places"),
      p = new Place({ id: parsed.id });
    await p.fetchFields({
      fields: ["id", "displayName", "location", "formattedAddress"],
    });
    if (!p.location) throw Error("이 장소의 위치 정보가 없어요.");
    return [
      {
        id: p.id,
        name: p.displayName,
        address: p.formattedAddress,
        lat: p.location.lat(),
        lng: p.location.lng(),
        url: parsed.url,
      },
    ];
  }
  let places = await lookupPlaces(parsed.query);
  return places
    .filter((p) => p.location)
    .map((p) => ({
      id: p.id,
      name: p.displayName,
      address: p.formattedAddress,
      lat: p.location.lat(),
      lng: p.location.lng(),
    }));
}
function installSearch() {
  if ($("#map-search")) return;
  let box = document.createElement("section");
  box.className = "map-searchbox";
  box.innerHTML =
    '<form id="map-search"><label for="map-search-input">장소 이름 · 주소 · Google 지도 링크</label><div class="map-searchrow"><input id="map-search-input" placeholder="예: 장소 이름 또는 Google 지도 링크" autocomplete="off" required><button class="primary" type="submit">검색</button></div></form><div id="map-search-results" aria-live="polite"></div>';
  $("#gmap").parentElement.before(box);
  const runSearch = async () => {
    if (!$("#map-search-input").value.trim()) return;
    $("#map-search-results").hidden = false;
    let token = ++mapSearchState.token;
    $("#map-search-results").textContent = "장소를 찾고 있어요…";
    try {
      let results = await searchMapInput($("#map-search-input").value);
      if (token !== mapSearchState.token) return;
      mapSearchState.results = results;
      $("#map-search-results").innerHTML =
        results
          .map(
            (p, i) =>
              /* HTML */ `<div class="search-result">
                <button type="button" class="map-search-option" data-searchview="${i}">
                  <b>${esc(p.name)}</b
                  ><small>${esc(p.address || "링크의 좌표 위치")}</small>
                </button>
                <div class="tools">
                  <button type="button" class="primary" data-searchadd="${i}">
                    일정에 추가
                  </button>
                </div>
              </div>`,
          )
          .join("") ||
        '<p class="note">검색 결과가 없어요. 정확한 장소 이름이나 주소로 검색해 주세요.</p>';
    } catch (e) {
      if (token === mapSearchState.token)
        $("#map-search-results").textContent = errorText(e);
    }
  };
  let searchTimer;
  const searchInput = $("#map-search-input");
  const resultBox = $("#map-search-results");
  resultBox.hidden = true;
  const closeResults = () => {
    clearTimeout(searchTimer);
    mapSearchState.token++;
    resultBox.hidden = true;
  };
  $("#map-search").onsubmit = (event) => {
    event.preventDefault();
    clearTimeout(searchTimer);
    runSearch();
  };
  searchInput.oninput = () => {
    clearTimeout(searchTimer);
    mapSearchState.token++;
    if (searchInput.value.trim().length < 2) {
      resultBox.hidden = true;
      return;
    }
    if (gmap) {
      resultBox.hidden = false;
      resultBox.textContent = "장소를 찾고 있어요…";
      searchTimer = setTimeout(runSearch, 500);
    } else {
      const keyword = searchInput.value.trim().toLocaleLowerCase();
      mapSearchState.results = state.days
        .flat()
        .map((stop) => {
          const point = savedPoint(stop);
          return point
            ? { ...point, name: stop.name, address: point.address || stop.query }
            : null;
        })
        .filter(
          (place) =>
            place &&
            (place.name + " " + place.address).toLocaleLowerCase().includes(keyword),
        );
      resultBox.hidden = false;
      resultBox.innerHTML =
        mapSearchState.results
          .map(
            (place, index) =>
              '<button type="button" class="map-search-option" data-searchview="' +
              index +
              '"><b>' +
              esc(place.name) +
              "</b><small>" +
              esc(place.address) +
              "</small></button>",
          )
          .join("") ||
        '<p class="note">저장된 장소가 없어요. 지도 연결 후 새 장소를 검색할 수 있어요.</p>';
    }
  };
  searchInput.onfocus = () => {
    if (resultBox.textContent.trim()) resultBox.hidden = false;
  };
  box.addEventListener("keydown", (event) => {
    const buttons = [...resultBox.querySelectorAll("[data-searchview]")];
    const index = buttons.indexOf(document.activeElement);
    if (event.key === "Escape") {
      event.preventDefault();
      closeResults();
      searchInput.focus();
      resultBox.hidden = true;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      resultBox.hidden = false;
      const next =
        event.key === "ArrowDown"
          ? index + 1
          : index < 0
            ? buttons.length - 1
            : index - 1;
      buttons[Math.max(0, Math.min(next, buttons.length - 1))]?.focus();
    }
  });
  document.addEventListener("click", (event) => {
    if (!box.contains(event.target)) closeResults();
  });
  $("#map-search-results").onclick = (e) => {
    let b = e.target.closest("[data-searchview]");
    if (b) {
      let p = mapSearchState.results[+b.dataset.searchview];
      $("#map-search-input").value = p.name;
      closeResults();
      if (gmap) {
        gmap.panTo({ lat: p.lat, lng: p.lng });
        gmap.setZoom(Math.max(18,gmap.getZoom?.()||0));
        if (mapSearchState.marker) mapSearchState.marker.map = null;
        mapSearchState.marker = new google.maps.marker.AdvancedMarkerElement({
          map: gmap,
          position: { lat: p.lat, lng: p.lng },
          title: p.name,
        });
      } else {
        $("#embed").src =
          "https://maps.google.com/maps?q=" +
          encodeURIComponent(p.lat + "," + p.lng) +
          "&output=embed";
      }
    }
    b = e.target.closest("[data-searchadd]");
    if (b) {
      let p = mapSearchState.results[+b.dataset.searchadd],
        targetDay = day;
      edit(-1);
      $("#f-name").value = p.name;
      $("#f-query").value = p.address || p.lat + "," + p.lng;
      let original = submitHandler;
      submitHandler = () => {
        let v = original();
        if (v === false) return false;
        let s = state.days[targetDay].at(-1);
        s.chosenPlace = { ...p };
        s.placeQuery = s.query;
        s.mapsUrl = p.url || "";
      };
    }
  };
}

// 5. multi-trips-v3
// Multi-trip home, green split planner, and button controls.
let tripBook;
try {
  tripBook = sharedViewMode ? null : JSON.parse(localStorage.getItem("sappun-trips-v3"));
} catch {}
if (!tripBook || !Array.isArray(tripBook.trips)) {
  tripBook = { version: 3, key: "", trips: [] };
}
let currentTripId = tripBook.trips[0]?.id || null,
  homeOpen = true;
tripBook.key = sessionMapKey();
tripBook.trips.forEach(t => { t.data.settings.key = tripBook.key; });
function trip() {
  return tripBook.trips.find((t) => t.id === currentTripId);
}
function dayDates(start, end) {
  let a = new Date(start + "T00:00:00Z"),
    b = new Date(end + "T00:00:00Z");
  if (!Number.isFinite(+a) || !Number.isFinite(+b) || b < a)
    throw Error("여행 시작일과 종료일을 확인해 주세요.");
  let count = Math.round((b - a) / 86400000) + 1;
  if (count > 90) throw Error("한 여행은 최대 90일까지 만들 수 있어요.");
  return Array.from({ length: count }, (_, i) =>
    new Date(+a + i * 86400000).toISOString().slice(0, 10),
  );
}
function tripDate(d = day) {
  return dayDates(trip().start, trip().end)[d];
}
function dateLabel(value) {
  return new Date(value + "T12:00:00Z").toLocaleDateString("ko-KR", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}
function newTripData(count, people = 1) {
  return {
    version: 2,
    settings: { ...DEFAULT_SETTINGS, currencyRates: {...DEFAULT_SETTINGS.currencyRates}, members: [], people, key: tripBook.key },
    days: Array.from({ length: count }, () => []),
    expenses: [],
  };
}
state = trip()?.data || newTripData(1);
state.settings.key = tripBook.key;
function save() {
  if (sharedViewMode) return true;
  try {
    if (trip()) trip().data = state;
    tripBook.trips.forEach(t=>syncLodgingLinks(t.data));
    tripBook.key = state.settings.key || "";
    tripBook.trips.forEach((t) => (t.data.settings.key = tripBook.key));
    storeSessionMapKey(tripBook.key);
    localStorage.setItem("sappun-trips-v3", serializeTripBook(tripBook));
    return true;
  } catch {
    toast("저장 공간이 부족해요. 백업을 다운로드해 주세요.");
    return false;
  }
}

function routeSignature(d, i) {
  let a = state.days[d][i],
    b = state.days[d][i + 1];
  return JSON.stringify([
    currentTripId,
    linkedLodging(a).query,
    b ? linkedLodging(b).query : undefined,
    a.mode,
    a.timeUnset,
    a.chosenPlace?.lat, a.chosenPlace?.lng,
    b?.chosenPlace?.lat, b?.chosenPlace?.lng,
    state.settings.key,
    departAt(d, a).toISOString(),
  ]);
}
// Keep normal form value access, replace dropdowns with explicit buttons.

document.addEventListener("click", (e) => {
  let b = e.target.closest("[data-value-target]");
  if (!b) return;
  let target = document.getElementById(b.dataset.valueTarget);
  target.value = b.dataset.value;
  b.parentElement.querySelectorAll("button").forEach((el) => {
    el.classList.toggle("chosen", el === b);
    el.setAttribute("aria-pressed", el === b ? "true" : "false");
  });
});
const oldLookup = lookupPlaces;
lookupPlaces = async function (query) {
  let suffix = /(?:日本|대한민국)/.test(query) ? "" : trip()?.location || "";
  return oldLookup(query + (suffix ? " " + suffix : ""));
};
function tripShape(i) {
  return `<svg viewBox="0 0 400 170" aria-hidden="true"><circle cx="330" cy="20" r="110" fill="${i % 2 ? "#F2ECFF" : "#EAF2FF"}"/><circle cx="100" cy="180" r="120" fill="#EAF2FF"/><path d="M-20 140 C80 140 100 25 210 65 S310 170 420 40" fill="none" stroke="#3182F6" stroke-width="2" stroke-dasharray="6 7"/><circle cx="180" cy="61" r="6" fill="#3182F6"/><circle cx="315" cy="106" r="6" fill="#3182F6"/><path d="M206 38l25 9-14 5-4 14-7-28z" fill="#3182F6"/></svg>`;
}
const home = document.createElement("main");
home.id = "trip-home";
document.querySelector(".wrap").before(home);
const homeBtn = document.createElement("button");
homeBtn.id = "go-home";
homeBtn.textContent = "← 내 여행";
document.querySelector("header .tools").prepend(homeBtn);
homeBtn.onclick = () => showHome();
const apiBtn = document.createElement("button");
apiBtn.textContent = "지도 연결";
apiBtn.onclick = () => $("#mapsetup").click();
document.querySelector("header .tools").append(apiBtn);
$(".brand").innerHTML =
  '사뿐<span style="color:#8dac95">.</span><small>여행의 모든 순간을 차곡차곡</small>';
const layout = $(".layout"),
  schedule = document.createElement("div");
schedule.className = "schedule-column";
layout.insertBefore(schedule, layout.firstElementChild);
schedule.append(layout.querySelector(":scope > section"));
const mapColumn = $(".mapcolumn");
mapColumn.querySelectorAll(".below").forEach((p) => schedule.append(p));
layout.prepend($("#days"));
function showHome() {
  homeOpen = true;
  clearTimeout(routeRefreshTimer);
  renderHome();
  $(".wrap").hidden = true;
  home.hidden = false;
  $("#go-home").hidden = true;
  $("#settings").textContent = "＋ 새 여행";
  $("#settings").hidden = true;
  $("#mapsetup").textContent = "지도 연결";
}
function openTrip(id) {
  let target = tripBook.trips.find((t) => t.id === id);
  if (!target) return;
  save();
  currentTripId = id;
  state = target.data;
  state.settings.key = tripBook.key;
  day = 0;
  selected = 0;
  filter = "전체";
  homeOpen = false;
  home.hidden = true;
  $(".wrap").hidden = false;
  $("#go-home").hidden = false;
  $("#settings").hidden = false;
  $("#settings").textContent = "여행 정보 수정";
  lastOverviewKey = "";
  render();
  window.scrollTo({ top: 0 });
  if (state.settings.key && !gmap) loadGoogle();
  if (gmap) {
    google.maps.event.trigger(gmap, "resize");
    gmap.setOptions({ gestureHandling: "greedy", scrollwheel: true });
  }
}
const tripCoverUrls = new Map();
let tripCoverLoadKey = "";
function loadTripCovers() {
  if (!db) return;
  const key = tripBook.trips.map(t=>t.coverFileId||'').join('|');
  if (key === tripCoverLoadKey) return;
  tripCoverLoadKey = key;
  allFiles().then(files=>{
    const wanted = new Set(tripBook.trips.map(t=>t.coverFileId).filter(Boolean));
    for (const [id,url] of tripCoverUrls) if(!wanted.has(id)){URL.revokeObjectURL(url);tripCoverUrls.delete(id);}
    for (const file of files) if(wanted.has(file.id)&&file.blob&&!tripCoverUrls.has(file.id))tripCoverUrls.set(file.id,URL.createObjectURL(file.blob));
    if(homeOpen)renderHome();
  }).catch(()=>{tripCoverLoadKey='';});
}
function renderHome() {
  home.innerHTML = /* HTML */ `<section class="home-hero">
      <div>
        <span class="eyebrow">YOUR NEXT CHAPTER</span>
        <h1>어디로 떠나볼까요?</h1>
        <p>새로운 여행을 만들고, 나만의 동선을 그려보세요.</p>
      </div>
      <button class="primary" id="create-trip">＋ 새 여행 만들기</button>
    </section>
    <section class="home-heading">
      <h2>나의 여행 <span>${tripBook.trips.length}</span></h2>
    </section>
    <section class="trip-grid">
      ${tripBook.trips
        .slice().sort((a,b)=>b.start.localeCompare(a.start))
        .map(
          (t, i) =>
            /* HTML */ `<article class="trip-tile">
              <button class="trip-open" data-opentrip="${esc(t.id)}">
                <div class="trip-art">
                  ${t.coverFileId && tripCoverUrls.has(t.coverFileId) || t.cover ? '<img class="trip-cover-image" src="'+esc(tripCoverUrls.get(t.coverFileId)||t.cover)+'" alt="" />' : tripShape(i)}<span class="trip-duration"
                    >${t.data.days.length} DAYS</span
                  >
                </div>
                <div class="trip-copy">
                  <small>⌖ ${esc(t.location)}</small>
                  <h2>${esc(t.title)}</h2>
                  <p>
                    ${esc(t.start.replaceAll("-", "."))} —
                    ${esc(t.end.replaceAll("-", "."))}
                  </p>
                  <div class="trip-tile-bottom">
                    <span
                      >${t.data.settings.people}명 · ${t.data.days.flat().length}개의
                      일정</span
                    ><b>여행 열기 ↗</b>
                  </div>
                </div>
              </button>
              <div class="trip-edit-row">
                <button data-tripedit="${esc(t.id)}">여행 정보 수정</button>
                <button data-tripcover="${esc(t.id)}">커버 변경</button>
                <button data-tripdelete="${esc(t.id)}">여행 삭제</button>
              </div>
            </article>`,
        )
        .join("")}
    </section>
    <p class="home-note">
      일정은 이 기기에 저장하고, 계정 로그인 시 서버와 동기화해요.
      첨부파일을 다른 기기로 옮길 때는 백업을 이용하세요.
    </p>`;
  $("#create-trip").onclick = () => tripForm();
  loadTripCovers();
  home.onclick = (e) => {
    let b = e.target.closest("[data-opentrip]");
    if (b) openTrip(b.dataset.opentrip);
    b = e.target.closest("[data-tripedit]");
    if (b) tripForm(b.dataset.tripedit);
    b = e.target.closest("[data-tripcover]");
    if (b) tripForm(b.dataset.tripcover);
    if (e.target.closest("[data-tripdelete]")) deleteTripClick(e);
  };
}
function tripForm(id = null) {
  let t = tripBook.trips.find((t) => t.id === id),
    today = new Date().toLocaleDateString("en-CA", {
      timeZone: "Asia/Seoul",
    }),
    start = t?.start || today,
    end = t?.end || today;
  modal(
    /* HTML */ `<h2>${t ? "여행 정보 수정" : "새 여행 만들기"}</h2>
      <p class="note">서울 하루 나들이부터 대만, 오사카 여행까지 자유롭게 만들어요.</p>
      ${input(
        "여행 제목",
        "triptitle",
        t?.title || "",
        "text",
        'required maxlength="100" placeholder="예: 주말 서울 산책"',
      )}${input(
        "여행지 · 도시 또는 국가",
        "location",
        t?.location || "",
        "text",
        'required maxlength="150" placeholder="서울, 대한민국 / 타이베이, 대만 / 오사카, 일본"',
      )}
      <div class="fields">
        ${input("여행 시작일", "start", start, "date", "required")}${input(
          "여행 종료일",
          "end",
          end,
          "date",
          "required",
        )}${input(
          "여행 인원",
          "people",
          t?.data.settings.people || 1,
          "number",
          'min="1" max="50" required',
        )}${input(
          "1인 예산 · 원",
          "budget",
          t?.data.settings.budget || "",
          "number",
          'min="0"',
        )}
      </div>
      <p class="note">
        일정이 있는 날짜를 제외하도록 기간을 줄이면 저장되지 않아요. 장소는 여행을 연 뒤
        추가하면 돼요.
      </p>`,
    () => {
      let title = val("triptitle").trim(),
        location = val("location").trim(),
        start = val("start"),
        end = val("end"),
        dates = dayDates(start, end);
      if (!title || !location) return false;
      if (t) {
        let oldDates = dayDates(t.start, t.end);
        if (oldDates.some((date, i) => !dates.includes(date) && t.data.days[i].length))
          throw Error(
            "제외되는 날짜에 일정이 있어요. 일정을 옮긴 뒤 기간을 변경해 주세요.",
          );
        let mapped = new Map(oldDates.map((date, i) => [date, t.data.days[i]]));
        t.data.days = dates.map((date) => mapped.get(date) || []);
        Object.assign(t, { title, location, start, end });
        t.data.settings.people = Number(val("people"));
        t.data.settings.budget = Number(val("budget"));
        if (t.id === currentTripId) {
          state = t.data;
          day = Math.min(day, state.days.length - 1);
        }
      } else {
        let data = newTripData(dates.length, Number(val("people")));
        data.settings.budget = Number(val("budget"));
        t = { id: uid(), title, location, start, end, data };
        tripBook.trips.push(t);
      }
      save();
      if (homeOpen) renderHome();
      else render();
      if (!id) setTimeout(() => openTrip(t.id), 0);
    },
  );
}
$("#settings").onclick = () => (homeOpen ? tripForm() : tripForm(currentTripId));

document.addEventListener("click", (e) => {
  let b = e.target.closest("[data-mode-button]");
  if (!b) return;
  let i = +b.dataset.modeButton;
  state.days[day][i].mode = b.dataset.mode;
  state.days[day][i].manualRoute = false;
  save();
  render();
});

function fileBelongs(f) {
  return (f.tripId || "legacy-kansai") === currentTripId;
}

$("#backup").onclick = async () => {
  try {
    save();
    let files = db ? await allFiles() : [],
      copy = JSON.parse(serializeTripBook(tripBook));
    copy.key = "";
    copy.trips.forEach((t) => (t.data.settings.key = ""));
    let packed = await Promise.all(
      files.map(async (f) => ({
        id: f.id,
        tripId: f.tripId || "legacy-kansai",
        day: f.day,
        stopId: f.stopId || null,
        resourceId: f.resourceId || null,
        kind: f.kind || "file",
        name: f.name,
        data: await toData(f.blob),
      })),
    );
    download(
      new Blob(
        [
          JSON.stringify({
            format: "sappun-trips-v3",
            book: copy,
            files: packed,
          }),
        ],
        { type: "application/json" },
      ),
      "sappun-all-trips-backup.json",
    );
    toast("모든 여행과 첨부 파일을 백업했어요. API 키는 제외돼요.");
  } catch (e) {
    toast("백업 실패: " + e.message);
  }
};
function validTrip(t) {
  try {
    return (
      typeof t.id === "string" &&
      typeof t.title === "string" &&
      t.title.length <= 100 &&
      typeof t.location === "string" &&
      t.location.length <= 150 &&
      dayDates(t.start, t.end).length === t.data.days.length &&
      validAnyData(t.data)
    );
  } catch {
    return false;
  }
}
function validAnyData(s) {
  return (
    s &&
    s.settings &&
    Number.isInteger(s.settings.people) &&
    s.settings.people > 0 &&
    s.settings.people <= 50 &&
    (s.settings.rate === undefined || (Number.isFinite(s.settings.rate) && s.settings.rate > 0)) &&
    Number.isFinite(s.settings.budget) &&
    s.settings.budget >= 0 &&
    Array.isArray(s.days) &&
    s.days.length <= 90 &&
    s.days.every(
      (d) =>
        Array.isArray(d) &&
        d.length <= 200 &&
        d.every(
          (x) =>
            x &&
            typeof x.name === "string" &&
            typeof x.query === "string" &&
            typeof x.note === "string" &&
            /^([01]\d|2[0-3]):[0-5]\d$/.test(x.time) &&
            categories.includes(x.category) &&
            supportedCurrencies().includes(x.currency) &&
            [x.amount, x.minutes, x.fare].every(
              (v) => v === null || (Number.isFinite(v) && v >= 0),
            ) &&
            (x.stay === undefined ||
              (Number.isFinite(x.stay) && x.stay >= 0 && x.stay <= 527040)),
        ),
    ) &&
    Array.isArray(s.expenses) &&
    s.expenses.every(
      (e) =>
        typeof e.name === "string" &&
        Number.isFinite(e.amount) &&
        e.amount >= 0 &&
        supportedCurrencies().includes(e.currency) &&
        ["1인", "전체"].includes(e.scope),
    )
  );
}
$("#jsonfile").onchange = async (e) => {
  try {
    let file = e.target.files[0];
    if (!file) return;
    if (file.size > 100 * 1024 * 1024) throw Error("100MB 이하 백업을 선택해 주세요.");
    let p = JSON.parse(await file.text());
    if (
      p.format === "sappun-blue-v2" &&
      validAnyData(p.state) &&
      p.state.days.length === 6
    )
      p = {
        format: "sappun-trips-v3",
        book: {
          version: 3,
          key: "",
          trips: [
            {
              id: "legacy-kansai",
              title: "오사카에서, 교토까지",
              location: "오사카 · 교토, 일본",
              start: "2026-12-11",
              end: "2026-12-16",
              data: p.state,
            },
          ],
        },
        files: (p.files || []).map((f) => ({
          ...f,
          tripId: "legacy-kansai",
        })),
      };
    if (
      p.format !== "sappun-trips-v3" ||
      !Array.isArray(p.book?.trips) ||
      !p.book.trips.length ||
      p.book.trips.length > 100 ||
      !p.book.trips.every(validTrip) ||
      new Set(p.book.trips.map((t) => t.id)).size !== p.book.trips.length ||
      !Array.isArray(p.files)
    )
      throw Error("올바른 여행 백업이 아니에요.");
    let files = await Promise.all(
      p.files.map(async (f) => {
        let t = p.book.trips.find((t) => t.id === f.tripId);
        if (
          !t ||
          !Number.isInteger(f.day) ||
          f.day < 0 ||
          f.day >= t.data.days.length ||
          typeof f.name !== "string" ||
          typeof f.data !== "string" ||
          !/^data:[^,]*;base64,/.test(f.data)
        )
          throw Error("첨부 데이터가 올바르지 않아요.");
        let blob = await (await fetch(f.data)).blob();
        if (blob.size > 20 * 1024 * 1024) throw Error("첨부 파일이 20MB를 초과해요.");
        return {
          id: uid(),
          tripId: f.tripId,
          day: f.day,
          stopId: f.stopId || null,
          resourceId: f.resourceId || null,
          kind: f.kind || "file",
          name: f.name,
          blob,
        };
      }),
    );
    if (files.length && !db) throw Error("브라우저 파일 저장소를 사용할 수 없어요.");
    if (!confirm("모든 여행과 첨부 파일을 백업 내용으로 교체할까요?")) return;
    if (db)
      await dbop("readwrite", (s) => {
        s.clear();
        files.forEach((f) => s.put(f));
      });
    let key = tripBook.key;
    tripBook = p.book;
    tripBook.key = key;
    currentTripId = tripBook.trips[0]?.id || null;
    state = trip()?.data || newTripData(1);
    state.settings.key = key;
    day = 0;
    save();
    lastOverviewKey = "";
    showHome();
    toast("모든 여행을 불러왔어요.", "success");
  } catch (e) {
    toast(e.message);
  }
  e.target.value = "";
};
$(".foot").textContent =
  "사뿐";
$("#mapsetup").parentElement.querySelector("h2").textContent = "여행 지도";
save();
showHome();

// 6. planner-v4
let requestedMapFocus = null;
function timeMinutes(time) {
  let m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!m) throw Error("시간을 확인해 주세요.");
  return Number(m[1]) * 60 + Number(m[2]);
}
function betweenTimes(from, to) {
  let delta = timeMinutes(to) - timeMinutes(from);
  return delta < 0 ? delta + 1440 : delta;
}
function plainClock(time, minutes) {
  return clockAdd(time, minutes).replace(/^익일 /, "");
}

const priorEffectiveLeg = effectiveLeg;
effectiveLeg = function (d, i) {
  let l = priorEffectiveLeg(d, i),
    s = state.days[d][i];
  if (s.manualRoute || !l.route || l.route.status !== "ok")
    l.currency = s.fareCurrency || "JPY";
  return l;
};
function dualMoney(amount, code = travelCurrency()) {
  if (amount === null || amount === undefined) return "비용 미입력";
  return `${formatCurrency(amount, code)} <small>≈ ${money(won(amount, code))}</small>`;
}

function rateDialog() {
  const settings = state.settings;
  let code = travelCurrency();
  modal(
    /* HTML */ `<h2>여행 통화 · 환율 설정</h2>
      ${currencySelector("travelcurrency", code)}
      <div id="world-exchange-fields">${exchangeFields(code, settings, "fx")}</div>
      <div id="other-currency-rates"></div>
      <p class="note">
        입력한 지출의 원금과 통화는 유지돼요. 통화를 바꾸면 아래 보조 금액의 통화가
        바뀌고, 환율을 바꾸면 원화 지출 합계·잔액이 다시 계산돼요.
      </p>`,
    () => {
      const selected = val("travelcurrency");
      const rate = readExchange("fx", selected);
      const extra = [...document.querySelectorAll("[data-other-currency]")].map((el) => {
        const value = Number(el.value);
        if (!Number.isFinite(value) || value <= 0)
          throw Error("각 통화의 환율을 0보다 크게 입력해 주세요.");
        return [el.dataset.otherCurrency, value];
      });
      saveCurrencySettings(settings, selected, rate);
      Object.assign(settings.currencyRates, Object.fromEntries(extra));
      settings.rate = settings.currencyRates.JPY;
      allMapSignature = "";
      setTimeout(refreshDetailIfOpen, 0);
    },
  );
  const update = () => {
    code = val("travelcurrency");
    $("#world-exchange-fields").innerHTML = exchangeFields(code, settings, "fx");
    prefillExchange(code, settings, "fx");
    $("#world-exchange-fields").hidden = code === "KRW";
    $("#world-exchange-fields")
      .querySelectorAll("input")
      .forEach((el) => {
        el.disabled = code === "KRW";
      });
    const others = usedCurrencies(state).filter((c) => c !== code && c !== "KRW");
    $("#other-currency-rates").innerHTML = others.length
      ? "<h3>기존 지출 통화의 환율</h3>" +
        others
          .map((c) => {
            let rate = "";
            try {
              rate = currencyRate(c);
            } catch {}
            return /* HTML */ `<label
              >1 ${c} = 원화 · KRW<input
                type="number"
                data-other-currency="${c}"
                value="${rate}"
                required
                min="0.000001"
                step="any"
            /></label>`;
          })
          .join("")
      : "";
  };
  $("#f-travelcurrency").onchange = update;
  update();
}

let mapFocusRequest = 0;
async function focusCard(i) {
  let s = state.days[day][i];
  if (!s) return;
  if (!s.query && !savedPoint(s)) {
    toast(s.locationNote || "이 일정의 위치를 먼저 입력해 주세요.", "warning");
    return;
  }
  const request = ++mapFocusRequest, tripId = currentTripId, targetDay = day;
  selected = i;
  activeScheduleCard = {tripId: currentTripId, day, stopId: s.id};
  mapDisplay().selectedDay = day;
  mapDisplay().showPins = true;
  requestedMapFocus = null;
  trip().viewMode = "map";
  save();
  render();
  requestAnimationFrame(() => $(".mapcolumn")?.scrollIntoView({block: "start", behavior: "smooth"}));
  if (!gmap) return;
  try {
    const point = savedPoint(s) || await resolvePlace(s);
    if (request !== mapFocusRequest || currentTripId !== tripId || day !== targetDay ||
        selected !== state.days[targetDay]?.indexOf(s) || homeOpen || trip().viewMode !== "map") return;
    s.chosenPlace = point; s.placeQuery = s.query;
    requestedMapFocus = {tripId, stopId: s.id};
    save();
    await drawGoogle();
  } catch (error) {
    if (request === mapFocusRequest) toast("장소 위치를 불러오지 못했어요. " + error.message, "warning");
  }
}
document.addEventListener("click", (e) => {
  let button = e.target.closest("[data-viewmode]");
  if (button) {
    trip().viewMode = button.dataset.viewmode;
    save();
    render();
    if (gmap && !$(".layout").classList.contains("list-layout"))
      google.maps.event.trigger(gmap, "resize");
    return;
  }
  button = e.target.closest("[data-collapse]");
  if (button) {
    let s = state.days[day][+button.dataset.collapse];
    s.collapsed = s.collapsed === false;
    save();
    render();
    return;
  }
  let card = e.target.closest("[data-card-index]");
  if (card && e.target.closest("[data-stop-map]") && !e.target.closest("button,a,input,textarea,select")) {
    day = Number(card.closest("[data-group-day]").dataset.groupDay);
    activateScheduleCard(card);
    return;
  }
  if (card && !e.target.closest("button,a,input,textarea,select"))
    activateScheduleCard(card);
});
document.addEventListener("keydown", (e) => {
  let card = e.target.closest("[data-card-index]");
  if (card && e.target.closest("[data-stop-map]") && (e.key === "Enter" || e.key === " ")) {
    e.preventDefault();
    day = Number(card.closest("[data-group-day]").dataset.groupDay);
    activateScheduleCard(card);
    return;
  }
  if (card && e.target === card && (e.key === "Enter" || e.key === " ")) {
    e.preventDefault();
    activateScheduleCard(card);
  }
});
async function deleteTripClick(e) {
  let button = e.target.closest("[data-tripdelete]");
  if (!button) {

    return;
  }
  let id = button.dataset.tripdelete,
    t = tripBook.trips.find((t) => t.id === id);
  if (!t) return;
  if (
    !confirm(
      "“" + t.title + "” 여행과 첨부 파일을 삭제할까요? 필요하면 먼저 백업해 주세요.",
    )
  ) {

    return;
  }
  try {
    if (db) {
      let files = (await allFiles()).filter((f) => (f.tripId || "legacy-kansai") === id);
      await dbop("readwrite", (store) => files.forEach((f) => store.delete(f.id)));
    }
    tripBook.trips = tripBook.trips.filter((t) => t.id !== id);
    if (currentTripId === id) {
      currentTripId = tripBook.trips[0]?.id || null;
      state = trip()?.data || newTripData(1);
      state.settings.key = tripBook.key;
    }
    requestedMapFocus = null;
    save();
    showHome();
    toast("여행을 삭제했어요.");
  } catch (e) {
    toast("삭제하지 못했어요: " + e.message);

  }
}
showHome();

// 7. daily-fix

document.addEventListener(
  "click",
  (e) => {
    let group = e.target.closest("[data-group-day]");
    if (group) day = +group.dataset.groupDay;
    let fold = e.target.closest("[data-dayfold]");
    if (fold) {
      e.stopImmediatePropagation();
      trip().closedDays ??= {};
      let d = +fold.dataset.dayfold;
      trip().closedDays[d] = !trip().closedDays[d];
      save();
      render();
      return;
    }
    const mobileDayButton = e.target.closest('[data-mobile-day]');
    if (mobileDayButton) {
      e.stopImmediatePropagation();
      const schedule = mobileDayButton.closest('.mobile-schedule');
      selectMobileScheduleDay(Number(mobileDayButton.dataset.mobileDay), schedule);
      return;
    }
    let add = e.target.closest("[data-dayadd]");
    if (add) {
      e.stopImmediatePropagation();
      day = +add.dataset.dayadd;
      edit(-1);
    }
  },
  true,
);
document.addEventListener(
  "keydown",
  (e) => {
    let group = e.target.closest("[data-group-day]");
    if (group) day = +group.dataset.groupDay;
  },
  true,
);

showHome();

// 8. api-limit-fix
// Never request Places or Routes from render, accordion, mode or card changes.
let safeMapStamp = "",
  safeLoadBusy = false;
const autoRefreshBefore = refreshDay;
refreshDay = async function (force = false) {
  if (!force || homeOpen) return;
  return autoRefreshBefore(true);
};

document.addEventListener(
  "click",
  async (e) => {
    let b = e.target.closest("[data-routeauto]");
    if (!b) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    let group = b.closest("[data-group-day]");
    if (group) day = +group.dataset.groupDay;
    let i = +b.dataset.routeauto;
    if (!gmap) {
      toast("먼저 지도 연결을 해주세요.", "warning");
      return;
    }
    let s = state.days[day][i];
    s.manualRoute = false;
    save();
    b.disabled = true;
    try {
      await getLeg(day, i, true);
    } finally {
      render();
    }
  },
  true,
);

// 9. time-budget-v5

function spendingCategory(category) {
  return (
    {
      음식: "식비",
      교통: "교통비",
      관광: "입장료",
      쇼핑: "쇼핑",
      숙소: "숙박",
    }[category] || "기타"
  );
}
function normalizeStop(s) {
  if (!s.endDate && s.sourceEnd) {
    const source = new Date(s.sourceEnd);
    if (!Number.isNaN(source.getTime())) s.endDate = new Date(source.getTime() + (String(s.sourceEnd).includes("T") ? 9*3600000 : 0)).toISOString().slice(0,10);
  }
  if (s.timeUnset === undefined) s.timeUnset = !(s.startTime || s.time);
  if (!s.startTime) s.startTime = s.time || "09:00";
  if (!s.endTime) s.endTime = plainClock(s.startTime, stayMinutes(s));
  s.time = s.startTime;
  if (!Array.isArray(s.costItems))
    s.costItems =
      s.amount === null || s.amount === undefined
        ? []
        : [
            {
              id: uid(),
              name: "기존 장소 비용",
              category: spendingCategory(s.category),
              planned: s.amount,
              actual: null,
              currency: s.currency || "JPY",
            },
          ];
  return s;
}
tripBook.trips.forEach((t) => t.data.days.flat().forEach(normalizeStop));
function hasStopTime(s) {
  return s.timeUnset !== true && Boolean(s.startTime || s.time);
}
function applyStopTime(s, start, end) {
  const normalize = value => { const raw = String(value || "").trim(); const digits = raw.replace(/:/g, ""); return /^\d{3,4}$/.test(digits) ? digits.padStart(4,"0").replace(/(\d{2})(\d{2})/, "$1:$2") : raw; };
  start = normalize(start); end = normalize(end);
  if (Boolean(start) !== Boolean(end)) throw Error("시작 시간과 종료 시간을 함께 입력해 주세요.");
  if (start && (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(end))) throw Error("올바른 시간을 입력해 주세요.");
  s.timeUnset = !start;
  s.startTime = start || "09:00"; s.endTime = end || "10:00"; s.time = s.startTime;
  s.stay = start ? betweenTimes(start, end) : 60;
}
function stopStart(s) {
  return s.startTime || s.time || "09:00";
}
function stopEnd(s) {
  return s.endTime || plainClock(stopStart(s), stayMinutes(s));
}
function scheduleEndDate(stop, d) {
  if (stop?.endDate) return stop.endDate;
  const date = new Date((stop?.startDate || tripDate(d)) + "T00:00:00Z");
  if (stop && hasStopTime(stop) && stopEnd(stop) < stopStart(stop)) date.setUTCDate(date.getUTCDate()+1);
  return date.toISOString().slice(0,10);
}
function scheduleDateFields(prefix, d, stop) {
  return '<div class="fields schedule-date-fields">' + input("시작 날짜", prefix + "date", tripDate(d), "date", 'required min="' + trip().start + '" max="' + trip().end + '"') + input("종료 날짜 · 체크아웃", prefix + "enddate", scheduleEndDate(stop,d), "date", 'required min="' + trip().start + '" max="' + trip().end + '"') + '</div>';
}
function applyScheduleRange(stop, startDate, endDate, start, end) {
  const valid = date => /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date + "T00:00:00Z")) && new Date(date + "T00:00:00Z").toISOString().slice(0,10) === date;
  if (!valid(startDate) || !valid(endDate) || endDate < startDate) throw Error("종료 날짜는 시작 날짜와 같거나 이후로 선택해 주세요.");
  const draft = {...stop}; applyStopTime(draft, start, end);
  if (!draft.timeUnset && endDate === startDate && draft.endTime < draft.startTime) throw Error("종료 시간이 더 이르면 다음 날 종료 날짜를 선택해 주세요.");
  draft.startDate = startDate; draft.endDate = endDate;
  if (!draft.timeUnset) draft.stay = Math.round((Date.parse(endDate + "T" + draft.endTime + ":00Z") - Date.parse(startDate + "T" + draft.startTime + ":00Z")) / 60000);
  Object.assign(stop, draft);
}
function shiftScheduleDates(stop, from, to) {
  if (!stop.startDate && !stop.endDate) return;
  const delta = Date.parse(tripDate(to)) - Date.parse(tripDate(from));
  const shift = date => new Date(Date.parse(date) + delta).toISOString().slice(0,10);
  stop.startDate = tripDate(to);
  if (stop.endDate) stop.endDate = shift(stop.endDate);
}
function saveScheduleRange(stop, d, prefix, start, end) {
  const startDate = val(prefix + "date"), endDate = val(prefix + "enddate");
  const targetDay = state.days.findIndex((_, index) => tripDate(index) === startDate);
  if (targetDay < 0 || endDate > trip().end) throw Error("여행 기간 안에서 날짜를 선택해 주세요.");
  applyScheduleRange(stop, startDate, endDate, start, end);
  return targetDay;
}
function departAt(d, s) {
  let date = new Date(`${s.endDate || tripDate(d)}T${stopEnd(s)}:00+09:00`);
  if (!s.endDate && timeMinutes(stopEnd(s)) < timeMinutes(stopStart(s)))
    date.setDate(date.getDate() + 1);
  return date;
}
function syncFollowingSchedule(d, index, minutes) {
  const stops = state.days[d], first = stops[index];
  if (!first || !hasStopTime(first) || minutes === null || !Number.isFinite(Number(minutes))) return false;
  const changes = [];
  let departure = Date.parse(scheduleEndDate(first, d) + "T" + stopEnd(first) + ":00Z");
  let travel = Number(minutes);
  for (let j = index + 1; j < stops.length; j++) {
    const stop = stops[j];
    const arrival = departure + travel * 60000;
    const oldStart = Date.parse((stop.startDate || tripDate(d)) + "T" + stopStart(stop) + ":00Z");
    const oldEnd = Date.parse(scheduleEndDate(stop, d) + "T" + stopEnd(stop) + ":00Z");
    const duration = hasStopTime(stop) && Number.isFinite(oldEnd - oldStart) && oldEnd >= oldStart ? oldEnd - oldStart : (stop.stay ?? 60) * 60000;
    const finish = arrival + duration;
    if (!Number.isFinite(arrival) || !Number.isFinite(finish) || new Date(arrival).toISOString().slice(0,10) > trip().end || new Date(finish).toISOString().slice(0,10) > trip().end) {
      toast("이동 후 일정이 여행 기간을 벗어나 시간은 변경하지 않았어요. 여행 기간을 먼저 늘려 주세요.", "warning");
      return false;
    }
    changes.push({stop, arrival, finish, duration});
    if (!hasSegment(stop) || stop.minutes == null || !Number.isFinite(Number(stop.minutes))) break;
    departure = finish; travel = Number(stop.minutes);
  }
  for (const {stop, arrival, finish, duration} of changes) {
    const start = new Date(arrival).toISOString(), end = new Date(finish).toISOString();
    Object.assign(stop, {startDate:start.slice(0,10), endDate:end.slice(0,10), startTime:start.slice(11,16), time:start.slice(11,16), endTime:end.slice(11,16), timeUnset:false, stay:duration/60000});
  }
  return changes.length > 0;
}

function cascadeScheduleEdit(d,index,previousEnd){
  const stops=state.days[d],first=stops?.[index];if(!first||!hasStopTime(first)||!Number.isFinite(previousEnd))return;
  const end=Date.parse(scheduleEndDate(first,d)+'T'+stopEnd(first)+':00Z'),delta=end-previousEnd;
  const changes=[];for(const stop of stops.slice(index+1)){if(!hasStopTime(stop))continue;const start=Date.parse((stop.startDate||tripDate(d))+'T'+stopStart(stop)+':00Z')+delta,finish=Date.parse(scheduleEndDate(stop,d)+'T'+stopEnd(stop)+':00Z')+delta;if(!Number.isFinite(start)||!Number.isFinite(finish)||new Date(start).toISOString().slice(0,10)>trip().end||new Date(finish).toISOString().slice(0,10)>trip().end||new Date(start).toISOString().slice(0,10)<tripDate(0)){toast('뒤 일정이 여행 기간을 벗어나요. 여행 기간을 먼저 확인해 주세요.','warning');return;}changes.push({stop,start,finish});}
  for(const {stop,start,finish} of changes){const a=new Date(start).toISOString(),b=new Date(finish).toISOString();Object.assign(stop,{startDate:a.slice(0,10),startTime:a.slice(11,16),time:a.slice(11,16),endDate:b.slice(0,10),endTime:b.slice(11,16)});}
  if(first.minutes!==null&&first.minutes!==undefined&&hasSegment(first))syncFollowingSchedule(d,index,Number(first.minutes));
}
function legTimes(d, i) {
  let a = state.days[d][i],
    l = effectiveLeg(d, i),
    departure = stopEnd(a);
  return {
    departure,
    arrival: l.minutes === null ? null : plainClock(departure, l.minutes),
    minutes: l.minutes,
  };
}

function displayTravelMoney(krw) {
  return formatCurrency(Number(krw) / currencyRate(travelCurrency()), travelCurrency());
}

function edit(i = -1) {
  let original = i < 0 ? null : normalizeStop(state.days[day][i]),
    chosen = null;
  modal(
    /* HTML */ `<h2>${i < 0 ? "장소 추가" : "장소 수정"}</h2>
${input(
        "장소 이름",
        "name",
        original?.name || "",
        "text",
        'required maxlength="150"',
      )}
      <p class="note">한 일정에는 한 장소를 적어 주세요. 예: ‘인천공항’, ‘간사이공항’을 각각 추가하고 두 장소 사이에 ‘항공’ 이동을 넣어요.</p>
      ${scheduleDateFields("", day, original)}
      <details class="optional-place-time" ${original && hasStopTime(original) ? "open" : ""}><summary>시간 추가 · 선택</summary>
      <div class="fields">
        ${input(
          "장소 시작 시간",
          "start",
          original && hasStopTime(original) ? stopStart(original) : "",
          "time",
        )}${input(
          "장소 종료 시간",
          "end",
          original && hasStopTime(original) ? stopEnd(original) : "",
          "time",
        )}
      </div>
      <p class="note">
        이 장소에서 머무르는 시간이에요. 종료 시간이 다음 이동의 출발 시간이 됩니다. 다른
        장소의 시작·종료 시간은 바뀌지 않아요.
      </p></details>
      ${select(
        "장소 분류",
        "category",
        categories,
        original?.category || "관광",
       )}${lodgingLinkFields(original)}${input("지도 검색어 · 주소", "query", original?.query || "")}
      <div class="tools"><button id="search-place" type="button">장소 검색</button></div>
      <div id="place-results"></div>
      ${input("Google 지도 링크", "maplink", original?.mapsUrl || "", "url")}<button
        id="apply-maplink"
        type="button"
      >
        링크에서 위치 가져오기
      </button>
      <div id="maplink-feedback" class="note"></div>
      <label
        >메모<textarea id="f-note" maxlength="1000">
${esc(original?.note || "")}</textarea
        >
      </label>
      <p class="note">
        식비·쇼핑 등 실제 지출은 저장 후 카드의 ‘비용 추가’에서 입력하세요. 결제 총액과 지출자·나눌 대상을 함께 기록할 수 있어요.
      </p>`,
    () => {
      const previousDay=day,previousEnd=original&&hasStopTime(original)?Date.parse(scheduleEndDate(original,day)+"T"+stopEnd(original)+":00Z"):NaN;
      let record = {
        ...(original || {
          id: uid(),
          mode: "대중교통",
          minutes: null,
          fare: null,
          manualRoute: true,
          costItems: [],
          amount: null,
          currency: "JPY",
        }),
        name: val("name").trim(),
        category: val("category"),
        query: val("query").trim() || val("name").trim(),
        note: val("note"),
        regions: original?.regions || [],

      };
      if (!record.name) return false;
      const targetDay = saveScheduleRange(record, day, "", val("start"), val("end"));
      if (chosen) {
        record.chosenPlace = chosen;
        record.placeQuery = record.query;
      }
      record.mapsUrl = val("maplink");
      applyLodgingLink(record, $("#f-lodging")?.value || '');
      if (i >= 0 && targetDay !== day) state.days[day].splice(i, 1);
      if (i < 0 || targetDay !== day) {
        day = targetDay;
        state.days[day].push(record);
        selected = state.days[day].length - 1;
        activeScheduleCard = {tripId: currentTripId, day, stopId: record.id};
      } else {state.days[day][i] = record;cascadeScheduleEdit(previousDay,i,previousEnd);}
      lastOverviewKey = "";
      safeMapStamp = "";
    },
    { closeButton: true },
  );
  $("#search-place").onclick = async () => {
    $("#place-results").textContent = "검색 중…";
    try {
      let results = await searchMapInput(val("query") || val("name"));
      if (!Array.isArray(results))
        throw Error("긴 지도 주소 또는 장소 이름을 입력해 주세요.");
      $("#place-results").innerHTML =
        results
          .map(
            (p, k) =>
              /* HTML */ `<button
                class="place-choice"
                type="button"
                data-place-option="${k}"
              >
                ${esc(p.name)}<small>${esc(p.address)}</small>
              </button>`,
          )
          .join("") || "검색 결과가 없어요.";
      $("#place-results").onclick = (e) => {
        let b = e.target.closest("[data-place-option]");
        if (!b) return;
        chosen = results[+b.dataset.placeOption];
        $("#f-query").value = chosen.address || chosen.lat + "," + chosen.lng;
        $("#place-results").textContent = "선택됨: " + chosen.name;
      };
    } catch (e) {
      $("#place-results").textContent = errorText(e);
    }
  };
  $("#apply-maplink").onclick = async () => {
    const button=$("#apply-maplink");button.disabled=true;
    $("#maplink-feedback").textContent='링크에서 장소를 확인하고 있어요…';
    try {
      let list = await searchMapInput(val("maplink"));
      if (!Array.isArray(list))
        throw Error("장소 링크를 확인해 주세요.");
      if (!list.length) throw Error("위치를 찾지 못했어요.");
      chosen = list[0];
      if(chosen.url)$("#f-maplink").value=chosen.url;
      $("#f-query").value = chosen.address || chosen.lat + "," + chosen.lng;
      if (!val("name").trim()) $("#f-name").value = chosen.name;
      $("#maplink-feedback").textContent = "위치 적용: " + chosen.name;
    } catch (e) {
      $("#maplink-feedback").textContent = errorText(e);
    } finally {button.disabled=false;}
  };
}
// Main map search uses the same field IDs as this form; selected coordinates are retained.

function stopCostList(i) {
  let s = normalizeStop(state.days[day][i]);
  modal(
    /* HTML */ `<h2>${esc(s.name)} · 지출 내역</h2>
      <p class="note">
        한 장소에 식비·입장료·쇼핑 등을 따로 추가하고, 항목마다 나눌 사람을 선택할 수 있어요.
      </p>
      <div class="cost-item-list">
        ${s.costItems
          .map(
            (e, k) =>
              /* HTML */ `<div>
                <b>${categoryIcon[e.category]} ${esc(e.name)}</b
                ><small
                  >${esc(e.category)} · 예상 ${dualMoney(e.planned, e.currency)} / 실제
                  ${dualMoney(e.actual, e.currency)}</small
                >
                <div class="tools">
                  <button type="button" data-costedit="${k}">수정</button
                  ><button type="button" data-costdelete="${k}">삭제</button>
                </div>
              </div>`,
          )
          .join("") || '<p class="note">아직 지출 항목이 없어요.</p>'}
      </div>
      <button class="primary" id="new-cost-item" type="button">
        ＋ 지출 항목 추가
      </button>`,
    () => {},
  );
  $("#new-cost-item").onclick = () => editCostItem(i);
  $(".cost-item-list").onclick = (e) => {
    let b = e.target.closest("[data-costedit]");
    if (b) editCostItem(i, +b.dataset.costedit);
    b = e.target.closest("[data-costdelete]");
    if (b && confirm("이 지출 항목을 삭제할까요?")) {
      s.costItems.splice(+b.dataset.costdelete, 1);
      save();
      render();
      stopCostList(i);
    }
  };
}

document.addEventListener("click", (e) => {
  let b = e.target.closest("[data-stopcost]");
  if (b) stopCostList(+b.dataset.stopcost);
  b = e.target.closest("[data-commonedit]");
  if (b) commonCostForm(+b.dataset.commonedit);
});
let travelLabelMarkers = [];

const validDataBeforeCosts = validAnyData;
validAnyData = function (s) {
  return (
    validDataBeforeCosts(s) &&
    s.days
      .flat()
      .every(
        (x) =>
          (x.timeUnset === undefined || typeof x.timeUnset === "boolean") &&
          (x.startTime === undefined || /^([01]\d|2[0-3]):[0-5]\d$/.test(x.startTime)) &&
          (x.startDate === undefined || /^\d{4}-\d{2}-\d{2}$/.test(x.startDate)) &&
          (x.endDate === undefined || /^\d{4}-\d{2}-\d{2}$/.test(x.endDate)) &&
          (x.endTime === undefined || /^([01]\d|2[0-3]):[0-5]\d$/.test(x.endTime)) &&
          (x.costItems === undefined ||
            (Array.isArray(x.costItems) &&
              x.costItems.length <= 200 &&
              x.costItems.every(
                (e) =>
                  typeof e.name === "string" &&
                  spendCategories.includes(e.category) &&
                  supportedCurrencies().includes(e.currency) &&
                  [e.planned, e.actual].every(
                    (v) => v === null || (Number.isFinite(v) && v >= 0),
                  ),
              ))),
      )
  );
};
save();
showHome();

// 10. actual-details-v6

function dayColor(d) {
  return dayPalette[d % dayPalette.length];
}
function ensureGoal(t) {
  t.totalBudget = Math.round((t.data.settings.budget || 0) * t.data.settings.people);
  return t.totalBudget;
}
tripBook.trips.forEach(ensureGoal);
function hasSegment(s) {
  return (
    !s.noTravel &&
    (s.segmentEnabled === true ||
      (s.minutes !== null && s.minutes !== undefined) ||
      (s.fare !== null && s.fare !== undefined) ||
      (s.actualFare !== null && s.actualFare !== undefined))
  );
}
function knownActual(e) {
  return e.actual !== null && e.actual !== undefined && Number.isFinite(Number(e.actual));
}
function stopActual(s) {
  normalizeStop(s);
  return [...s.costItems,...state.expenses.filter(e=>e.stopIds?.includes(s.id))].filter(knownActual).reduce((sum,entry) => sum + TravelFinance.totalKRW(entry,state.settings.people,won),0);
}
function stopPersonalCosts(stop) {
  const result=TravelFinance.calculate(state,won), rows=result.rows.filter(row=>row.stopId===stop.id || row.entry.stopIds?.includes(stop.id));
  const amounts=new Map();
  for(const row of rows) for(const share of row.shares) amounts.set(share.id,(amounts.get(share.id)||0)+share.amount);
  return [...amounts].map(([id,amount])=>'<span class="person-expense"><small>'+esc(state.settings.members.find(p=>p.id===id)?.name || '')+'</small> <b>'+money(amount)+'</b></span>').join('') + (rows.some(row=>row.needsReview)?'<small class="warning">부담할 사람 확인 필요</small>':'');
}
function actualStats() {
  const category = Object.fromEntries(spendCategories.map(c => [c,0])), days = state.days.map(() => 0);
  let total=0, common=0;
  for (const row of TravelFinance.collect(state)) {
    const entry=row.entry, amount=TravelFinance.totalKRW(entry,state.settings.people,won,row.source === "common" && entry.scope === "전체" ? "total" : "perPerson");
    const cat=spendCategories.includes(entry.category)?entry.category:"기타";
    category[cat]+=amount; total+=amount;
    if(row.day === null) common+=amount; else days[row.day]+=amount;
  }
  return {total,category,days,common};
}

function krwFirst(value) {
  return `<b>${money(value)}</b>${travelCurrency() === "KRW" ? "" : `<small>약 ${displayTravelMoney(value)}</small>`}`;
}
function goalDialog() {
  modal(
    '<h2>여행 총예산 설정</h2><p class="note">한 사람이 사용할 예산을 입력하세요. 인원을 곱해 여행 총예산을 계산해요.</p>' +
      input(
        "1인 예산 · 원",
        "goal",
        state.settings.budget || "",
        "number",
        'required min="0" step="1"',
      ),
    () => {
      state.settings.budget = Number(val("goal"));
      ensureGoal(trip());
    },
  );
}
const tripFormBeforeGoal = tripForm;
tripForm = function (id = null) {
  tripFormBeforeGoal(id);
  let t = tripBook.trips.find((t) => t.id === id);
  $("#f-budget").closest("label").firstChild.textContent =
    "1인 예산 · 원";
  $("#f-budget").value = t ? t.data.settings.budget || "" : "";
  let original = submitHandler;
  submitHandler = () => {
    let budget = Number(val("budget"));
    let result = original();
    if (result === false) return false;
    let t = id ? tripBook.trips.find((t) => t.id === id) : tripBook.trips.at(-1);
    if (t) {
      t.data.settings.budget = budget;
      ensureGoal(t);
    }
    return result;
  };
};
function actualDashboard() {
  const stats=actualStats(),people=Math.max(1,state.settings.people),goal=ensureGoal(trip()),remaining=goal-stats.total;
  return '<section class="expense-overview"><div class="expense-overview-heading"><div><small>이번 여행의 지출</small><h2>예산 한눈에</h2></div><div class="tools"><button type="button" data-edit-budget>예산 수정</button><button id="list-rate" type="button">환율</button></div></div><div class="expense-metrics">'+
    [['총예산',goal,money(state.settings.budget)+' × '+people+'명'],['실제 지출',stats.total,'입력한 전체 지출'],['1인당 사용금액',Math.round(stats.total/people),'전체 지출 ÷ '+people+'명'],[remaining<0?'예산 초과':'남은 예산',Math.abs(remaining),goal?'총예산 기준':'예산을 설정해 주세요']].map(([label,amount,note])=>'<div><small>'+label+'</small><strong>'+money(amount)+'</strong><span>'+note+'</span></div>').join('')+
    '</div><div class="expense-budget-track"><i style="width:'+Math.min(100,goal?stats.total/goal*100:0)+'%"></i></div><details class="expense-breakdown"><summary>분류별 지출 보기</summary><div>'+spendCategories.filter(c=>stats.category[c]>0).map(c=>'<p><span>'+esc(c)+'</span><b title="전체 지출 ÷ '+people+'명">인당 '+money(Math.round(stats.category[c]/people))+'</b></p>').join('')+(stats.total?'':'<p>아직 입력한 지출이 없어요.</p>')+'</div></details><button id="dashboard-common" type="button" hidden>지출 추가</button></section>';
}
function actualTags(s) {
  return [...s.costItems,...state.expenses.filter(e=>e.stopIds?.includes(s.id))]
    .filter(knownActual)
    .map(
      (e) =>
        /* HTML */ `<span class="expense-tag" title="${esc(e.name)} · ${money(TravelFinance.totalKRW(e,state.settings.people,won))}">${categoryIcon[e.category] || "＋"} ${esc(e.name)}</span>`,
    )
    .join("");
}
let scheduleMapRequest=0;
async function openScheduleMap(d,index=null){
  if(d!==null&&!state.days[d])return;
  const tripId=currentTripId,request=++scheduleMapRequest;closeDetail();if(d!==null)day=d;selected=Number.isInteger(index)?index:0;
  trip().workspaceView='itinerary';trip().viewMode='map';mapDisplay().selectedDay=d;mapDisplay().showPins=true;
  requestedMapFocus=null;mapViewportSelection='';allMapSignature='';save();render();
  requestAnimationFrame(()=>document.querySelector('.mapcolumn')?.scrollIntoView?.({block:'start',behavior:'smooth'}));
  const stop=d!==null&&Number.isInteger(index)?state.days[d][index]:null;
  if(stop&&gmap){try{const point=savedPoint(stop)||await resolvePlace(stop);if(request!==scheduleMapRequest||tripId!==currentTripId||homeOpen)return;stop.chosenPlace=point;stop.placeQuery=stop.query;requestedMapFocus={tripId,stopId:stop.id};save();}catch(error){if(request===scheduleMapRequest)toast('장소 위치를 확인해 주세요.','warning');}}
  if(gmap){google.maps.event.trigger(gmap,'resize');allMapSignature='';await drawGoogle();const days=d===null?state.days.map((_,i)=>i):[d];if(typeof loadSelectedDays==='function'&&days.some(i=>state.days[i].some(s=>s.query&&!savedPoint(s))))await loadSelectedDays(days);}
  else {const query=stop?.query||stop?.name||(d!==null?state.days[d].find(s=>s.query)?.query:'')||trip().location;document.querySelector('#embed').src='https://www.google.com/maps?q='+encodeURIComponent(query)+'&output=embed';}
}
document.addEventListener('click',event=>{const dayButton=event.target.closest('[data-schedule-map-day]'),placeButton=event.target.closest('[data-detail-map]');if(dayButton){event.preventDefault();openScheduleMap(Number(dayButton.dataset.scheduleMapDay));}else if(placeButton&&detailContext){event.preventDefault();openScheduleMap(detailContext.day,state.days[detailContext.day].findIndex(stop=>stop.id===detailContext.stopId));}});
function segmentBlock(d, i) {
  const s = state.days[d][i], next = state.days[d][i + 1];
  if (!next) return "";
  const entered = hasSegment(s), route = currentRoute(d, i);
  const minutes = entered ? (s.minutes ?? (route?.status === "ok" ? route.minutes : null)) : null;
  const distance = entered && route?.status === "ok" && route.distance > 0
    ? (route.distance < 1000 ? Math.round(route.distance) + "m" : (route.distance / 1000).toLocaleString("ko-KR", {maximumFractionDigits: 1}) + "km") : "";
  const summary = entered ? [s.mode, minutes !== null ? minutes + "분" : "", distance].filter(Boolean).join(" · ") : "이동 추가";
  return `<div class="itinerary-connection${entered ? "" : " is-empty"}">
    <details class="segment-popover" data-segment-day="${d}" data-segment-index="${i}">
      <summary aria-label="${esc(s.name)}에서 ${esc(next.name)}까지 이동 설정">${entered ? transportIcon[s.mode] || "↳" : "＋"} <span>${esc(summary)}</span><span class="segment-chevron" aria-hidden="true">⌄</span></summary>
      <div class="segment-menu" role="group" aria-label="이동 수단과 경로 설정">
        <p class="segment-menu-heading">이동 수단</p>
        ${["도보","대중교통","택시"].map(mode => `<button type="button" data-segment-mode="${mode}" aria-pressed="${entered && s.mode === mode}">${transportIcon[mode]} ${mode}${entered && s.mode === mode ? '<span class="segment-check">✓</span>' : ""}</button>`).join("")}
        <button type="button" data-segment-lookup>⌕ Google 소요 시간 조회</button>
        <a class="segment-external-directions" href="https://www.google.com/maps/dir/?api=1&amp;origin=${encodeURIComponent(s.query||s.name)}&amp;destination=${encodeURIComponent(next.query||next.name)}&amp;travelmode=${s.mode==='도보'?'walking':s.mode==='택시'?'driving':'transit'}" target="_blank" rel="noopener">↗ Google 지도에서 길찾기</a>
        <div class="segment-menu-divider"></div>
        <button type="button" data-segment-settings>◷ 시간·교통비 직접 입력</button>
        ${entered ? '<button type="button" data-segment-hide>⊘ 이동 숨기기</button>' : ""}
        <p class="segment-menu-status" role="status">${route?.status === "error" ? esc(route.error) : route?.departureLabel?esc(route.departureLabel)+' 출발 기준':''}</p>
        ${route?.status==='ok'&&route.steps?.some(step=>step.line)?'<div class="segment-transit-summary">'+route.steps.filter(step=>step.line).map(step=>'<p><b>'+esc(step.line)+'</b><small>'+esc([step.from,step.to].filter(Boolean).join(' → '))+'</small></p>').join('')+'</div>':''}
      </div>
    </details>
    ${entered && s.actualFare !== null && s.actualFare !== undefined ? '<span class="segment-fare">' + money(won(s.actualFare, s.actualFareCurrency || s.fareCurrency || travelCurrency())) + '</span>' : ""}
  </div>`;
}

function scheduleGridEntries() {
  return state.days.map((_,column) => {
    const date = tripDate(column), dayStart = Date.parse(date + "T00:00:00Z");
    const timed = [], untimed = [];
    state.days.forEach((stops,d) => stops.forEach((s,i) => {
      normalizeStop(s);
      const startDate = s.startDate || tripDate(d);
      if (!hasStopTime(s)) { if (startDate === date) untimed.push({s,d,i}); return; }
      // A lodging booking is a check-in card, not an all-day reservation of the timetable.
      const lodging = s.category === "숙소";
      if (lodging && startDate !== date) return;
      const start = Date.parse(startDate + "T" + stopStart(s) + ":00Z");
      const end = Date.parse(scheduleEndDate(s,d) + "T" + stopEnd(s) + ":00Z");
      if (start >= dayStart + 86400000 || end < dayStart || (end === dayStart && start < end)) return;
      timed.push({s,d,i,start:Math.max(0,(start-dayStart)/60000),end:Math.min(1440,lodging ? (start-dayStart)/60000+1 : Math.max((end-dayStart)/60000,(start-dayStart)/60000+1))});
    }));
    return {timed:timed.sort((a,b)=>a.start-b.start),untimed};
  });
}
function fullScheduleTable() {
  const columns = scheduleGridEntries();
  const firstHour = Math.min(6,...columns.flatMap(c=>c.timed.map(e=>Math.floor(e.start/60))));
  const occupied = columns.map(()=>-1);
  const event = ({s,d,i}) => {
    const active = activeScheduleCard?.tripId === currentTripId && activeScheduleCard.stopId === s.id;
    const start = hasStopTime(s) ? stopStart(s) : "";
    const time = start ? start + " → " + (s.endDate && s.endDate !== (s.startDate || tripDate(d)) ? s.endDate.slice(5).replace("-","/") + " " : "") + stopEnd(s) : "시간 미정";
    const expenses = actualTags(s);
    const resources = (state.resources || []).filter(r=>r.stopIds?.includes(s.id)).map(r=>'<button type="button" class="grid-resource-link" data-resource-open="'+esc(r.id)+'">📄 '+esc(r.title)+'</button>').join('');
    return '<article class="grid-event'+(s.category==='숙소'?' grid-lodging-card':'')+(active?' is-editing':'')+'" data-group-day="'+d+'" data-card-index="'+i+'" data-stop-id="'+esc(s.id)+'" data-category="'+esc(s.category||'')+'" tabindex="0" role="button" aria-expanded="'+active+'">' +
      '<div class="grid-event-top"><span class="grid-category-icon" aria-hidden="true">'+({숙소:'🏨',음식:'🍽️',관광:'📷',쇼핑:'🛍️',교통:'🚆',기타:'📍'}[s.category]||'📍')+'</span><b title="'+esc(s.name)+'">'+esc(s.name)+'</b><button type="button" class="grid-detail-button" data-stop-action="details" aria-label="'+esc(s.name)+' 전체 내용 보기"></button></div><span class="grid-event-time">'+esc(time)+'</span>'+
      (s.lodgingStopId&&linkedLodging(s)!==s?'<small class="lodging-linked-label">↗ '+esc(linkedLodging(s).name)+'</small>':'')+
      (s.note?'<p class="grid-event-note" title="'+esc(s.note)+'">'+esc(s.note)+'</p>':'')+
      (expenses?'<div class="grid-linked-items">'+expenses+'</div>':'')+resources+
      '</article>';
  };
  const mobileTimetable = column => {
    const startHour = Math.min(9,...column.timed.map(e=>Math.floor(e.start/60)));
    const endHour = Math.min(24,Math.max(18,...column.timed.map(e=>Math.ceil(e.end/60))));
    let body = '';
    for(let minute=startHour*60;minute<endHour*60;minute+=30){
      const label = String(Math.floor(minute/60)).padStart(2,'0')+':'+(minute%60?'30':'00');
      body += '<div class="mobile-time-tick '+(minute%60?'mobile-half-hour':'mobile-hour')+'" style="top:'+((minute-startHour*60)*88/60)+'px"><span>'+label+'</span></div>';
    }
    // Only intersecting bookings share width. Short bookings reserve enough room for text.
    const placed = [], groups = [];
    let group = null;
    for(const entry of [...column.timed].sort((a,b)=>a.start-b.start)) {
      const height = Math.max(68,(entry.end-entry.start)*88/60-4);
      const visualEnd = entry.start+(height+4)*60/88;
      if(!group || entry.start>=group.end) {
        group={end:visualEnd,laneEnds:[],items:[]};
        groups.push(group);
      }
      let lane=group.laneEnds.findIndex(end=>end<=entry.start);
      if(lane<0)lane=group.laneEnds.length;
      group.laneEnds[lane]=visualEnd;
      group.end=Math.max(group.end,visualEnd);
      group.items.push({entry,lane,height});
    }
    for(const group of groups)for(const item of group.items)placed.push({...item,lanes:group.laneEnds.length});
    const cards=placed.map(({entry,lane,height,lanes})=>'<div class="mobile-time-booking" style="top:'+((entry.start-startHour*60)*88/60)+'px;height:'+height+'px;left:'+lane*100/lanes+'%;width:'+100/lanes+'%">'+event(entry)+'</div>').join('');
    const gridHeight=Math.max((endHour-startHour)*88,...placed.map(({entry,height})=>(entry.start-startHour*60)*88/60+height));
    return '<div class="mobile-time-scroll"><div class="mobile-time-grid" style="height:'+gridHeight+'px">'+body+'<div class="mobile-time-bookings">'+cards+'</div></div></div>';
  };
  const mobileDay = Math.max(0,Math.min(day,columns.length-1));
  const dayPicker = '<nav class="mobile-day-compact" aria-label="시간표 날짜 선택"><button type="button" data-mobile-prev data-mobile-day="'+(mobileDay-1)+'" aria-label="이전 날짜" '+(mobileDay===0?'disabled':'')+'>‹</button><button type="button" class="mobile-day-current" data-mobile-day-picker aria-haspopup="dialog" aria-expanded="false"><span>D'+(mobileDay+1)+' · '+esc(dateLabel(tripDate(mobileDay)))+'</span><span aria-hidden="true">⌄</span></button><button type="button" data-mobile-next data-mobile-day="'+(mobileDay+1)+'" aria-label="다음 날짜" '+(mobileDay===columns.length-1?'disabled':'')+'>›</button></nav>';
  const mobile = '<div class="mobile-schedule">'+dayPicker+columns.map((column,d)=>
    '<section class="mobile-schedule-day" id="mobile-timetable-day-'+d+'" data-mobile-day-panel="'+d+'" style="--day-color:'+dayColor(d)+'" '+(d===mobileDay?'':'hidden')+'><div class="mobile-day-heading"><b>Day '+(d+1)+'</b><span>'+esc(dateLabel(tripDate(d)))+'</span></div><div class="mobile-schedule-events">'+
    '<button type="button" class="schedule-day-map" data-schedule-map-day="'+d+'">🗺️ 지도 보기</button>'+
    mobileTimetable(column)+
    (column.untimed.length?'<section class="mobile-untimed"><h3>시간 미정</h3>'+column.untimed.map(event).join('')+'</section>':'')+
    '<button type="button" class="schedule-add-card" data-dayadd="'+d+'">일정 추가</button></div></section>'
  ).join('')+'</div>';
  let rows = '';
  for (let minute=firstHour*60;minute<1440;minute+=30) {
    rows += '<tr class="'+(minute%60?'half-hour':'hour-start')+'"><th scope="row">'+(minute%60?'<span class="sr-only">'+String(Math.floor(minute/60)).padStart(2,'0')+':30</span>':String(Math.floor(minute/60)).padStart(2,'0')+':00')+'</th>';
    columns.forEach((column,d)=>{
      if (occupied[d]>minute) return;
      const entries=column.timed.filter(e=>Math.floor(e.start/30)*30===minute);
      let span=1;
      if(entries.length){
        const endMinute=Math.min(1440,Math.ceil(Math.max(...entries.map(e=>e.end))/30)*30);
        const next=column.timed.find(e=>Math.floor(e.start/30)*30>minute);
        span=Math.max(1,(Math.min(endMinute,next?Math.floor(next.start/30)*30:1440)-minute)/30);
      }
      occupied[d]=minute+span*30;
      rows += '<td'+(span>1?' rowspan="'+span+'"':'')+' class="'+(entries.length?'grid-span-cell':'grid-empty-cell')+'" style="--day-color:'+dayColor(d)+'">'+entries.map(event).join('')+'</td>';
    });
    rows+='</tr>';
  }
  rows+='<tr class="schedule-grid-band"><th scope="row">시간 미정</th>'+columns.map((c,d)=>'<td style="--day-color:'+dayColor(d)+'">'+c.untimed.map(event).join('')+'</td>').join('')+'</tr>';
  rows+='<tr class="schedule-add-row"><th scope="row"><span class="sr-only">일정 추가</span></th>'+columns.map((_,d)=>'<td style="--day-color:'+dayColor(d)+'"><button type="button" class="schedule-add-card" data-dayadd="'+d+'">일정 추가</button></td>').join('')+'</tr>';
  return mobile + '<div class="schedule-grid-wrap" tabindex="0" role="region" aria-label="날짜별 시간표 · 좌우로 스크롤해 다른 날짜 보기"><table class="schedule-grid-table" style="--trip-days:'+state.days.length+'"><caption class="sr-only">날짜별 여행 시간표</caption><thead><tr><th scope="col">시간</th>'+columns.map((_,d)=>'<th scope="col"><b>Day '+(d+1)+'</b><small>'+esc(dateLabel(tripDate(d)))+'</small><button type="button" class="schedule-day-map" data-schedule-map-day="'+d+'">🗺️ 지도 보기</button></th>').join('')+'</tr></thead><tbody>'+rows+'</tbody></table></div>';
}
let activeScheduleCard = null;
function selectMobileScheduleDay(value, schedule) {
  if (!schedule || !Number.isInteger(value) || value<0 || value>=state.days.length) return;
  day = value;
  schedule.querySelectorAll('.mobile-day-toggle [data-mobile-day]').forEach(button => button.setAttribute('aria-pressed',String(Number(button.dataset.mobileDay)===day)));
  schedule.querySelectorAll('[data-mobile-day-panel]').forEach(panel => { panel.hidden = Number(panel.dataset.mobileDayPanel)!==day; });
  const picker = schedule.querySelector('[data-mobile-day-picker] > span');
  if (picker) picker.textContent = 'D'+(day+1)+' · '+dateLabel(tripDate(day));
  const prev = schedule.querySelector('[data-mobile-prev]'), next = schedule.querySelector('[data-mobile-next]');
  if (prev) { prev.dataset.mobileDay = String(day-1); prev.disabled = day===0; }
  if (next) { next.dataset.mobileDay = String(day+1); next.disabled = day===state.days.length-1; }
}
function actualSchedule(list) {
  if (list) return fullScheduleTable();
  const stats = list ? actualStats() : null;
  const people = state.settings.people;
  return state.days
    .map((stops, d) => {
      const rows = stops
        .map((s, i) => {
          normalizeStop(s);
          const props = {
            index: i,
            id: s.id,
            day: d,
            date: dateLabel(s.startDate || tripDate(d)),
            start: hasStopTime(s) ? stopStart(s) : "",
            end: hasStopTime(s) ? ((s.endDate && s.endDate !== tripDate(d) ? s.endDate.slice(5).replace("-", "/") + " " : "") + stopEnd(s)) : "",
            active: activeScheduleCard?.tripId === currentTripId && activeScheduleCard.day === d && activeScheduleCard.stopId === s.id,
            hasNext: i < stops.length - 1,
            name: s.name,
            category: s.category,
            regions: s.regions || [],
            note: s.note,
            resourcesHtml: '<div class="schedule-resource-links">'+(state.resources||[]).filter(resource=>resource.stopIds?.includes(s.id)).map(resource=>'<button type="button" data-resource-open="'+esc(resource.id)+'">📁 '+esc(resource.title)+'</button>').join('')+'</div>',
            costsHtml: TravelComponents.stopCosts({
              tagsHtml: actualTags(s),
              amountHtml: stopPersonalCosts(s),
              card: !list,
              emptyHtml: "",
            }),
          };
          const place = list
            ? TravelComponents.stopRow({
                ...props,
                mapHtml: TravelComponents.mapButton(i, s.name, mapIconV9),
              })
            : TravelComponents.stopCard({
                ...props,
                count: stops.length,
                color: dayColor(d),
              });
          const segment = i < stops.length - 1 ? segmentBlock(d, i) : "";
          return list
            ? place + (segment ? '<tr class="list-segment-row"><td colspan="5">' + segment + "</td></tr>" : "")
            : '<div class="schedule-stop-block">' + place + segment + '</div>';
        })
        .join("");
      const bodyHtml = list
        ? TravelComponents.scheduleTable(rows) +
          '<div class="day-spend-v9"><div><small>Day ' +
          (d + 1) +
          " · " +
          people +
          '인 전체</small><b>일별 실제 지출</b></div><div class="currency-stack">' +
          krwFirst(stats.days[d]) +
          "</div></div>"
        : rows + '<button type="button" class="schedule-add-card" data-dayadd="'+d+'">일정 추가</button>';
      return TravelComponents.dayGroup({
        day: d,
        date: dateLabel(tripDate(d)),
        color: dayColor(d),
        closed: trip().closedDays?.[d] === true,
        list,
        bodyHtml,
        toolsHtml: '<button type="button" class="temp-location-lookup" data-load-day="'+d+'" '+(locationLoadBusy?'disabled':'')+'>⌕ Google 위치 검색</button>',
      });
    })
    .join("");
}
let locationLoadBusy = false,
  allMapSignature = "";
function tripSummaryStatus(t, now = new Date()) {
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const start = Date.parse(t.start + 'T00:00:00Z'), end = Date.parse(t.end + 'T00:00:00Z');
  const until = Math.round((start - today) / 86400000);
  const duration = Math.round((end - start) / 86400000) + 1;
  return {
    label: until > 0 ? '여행까지' : today <= end ? '여행 중' : '여행을 마치고',
    value: until > 0 ? 'D-' + until : today <= end ? 'Day ' + (1 - until) : '다녀온 여행',
    dates: t.start.slice(5).replace('-', '.') + '–' + t.end.slice(5).replace('-', '.') + ' · ' + (duration > 1 ? (duration - 1) + '박 ' : '') + duration + '일'
  };
}
function travelerPhotoSource(value) {
  return typeof value === 'string' && value.length <= 60000 && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value) ? value : '';
}
async function travelerPhotoData(file) {
  if (!file || !file.type.startsWith('image/') || file.size > 10*1024*1024) throw Error('10MB 이하 사진을 선택해 주세요.');
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
    const context = canvas.getContext('2d');
    const size = Math.min(bitmap.width, bitmap.height);
    context.fillStyle = '#ffffff'; context.fillRect(0,0,128,128);
    context.drawImage(bitmap,(bitmap.width-size)/2,(bitmap.height-size)/2,size,size,0,0,128,128);
    const result = canvas.toDataURL('image/jpeg',.8);
    if (!travelerPhotoSource(result)) throw Error('사진을 처리하지 못했어요. 다른 사진을 선택해 주세요.');
    return result;
  } finally { bitmap.close(); }
}
async function travelCoverData(file) {
  const bitmap=await createImageBitmap(file);
  try{const scale=Math.min(1,800/bitmap.width,500/bitmap.height),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/jpeg',.76);}finally{bitmap.close();}
}
function tripSummaryHtml(t, total) {
  const people = Math.max(1, Number(state.settings.people) || 1), status = tripSummaryStatus(t);
  const members = (state.settings.members || []).filter(member => member.active !== false);
  const avatars = Array.from({length:Math.min(people, 4)}, (_, index) => {
    const name = members[index]?.name?.trim() || (people === 1 ? '나' : '여행자 ' + (index + 1));
    const initial = members[index]?.name?.trim() ? [...name][0] : people === 1 ? '나' : String(index + 1);
    const photo = travelerPhotoSource(members[index]?.photo);
    return '<span class="trip-traveler-person"><span class="trip-traveler-avatar" aria-hidden="true">'+(photo?'<img src="'+photo+'" alt="" />':esc(initial))+'</span><span class="trip-traveler-name">'+esc(name)+'</span></span>';
  }).join('') + (people > 4 ? '<span class="trip-traveler-more">외 '+(people - 4)+'명</span>' : '');
  return '<div class="stat trip-countdown"><small>'+status.label+'</small><strong>'+status.value+'</strong><small>'+status.dates+'</small></div>' +
    '<div class="stat trip-personal-spend"><small>인당 사용금액</small><strong>'+money(Math.round(total / people))+'</strong><div class="trip-travelers"><div class="trip-traveler-stack">'+avatars+'</div><button type="button" class="trip-travelers-edit" data-edit-travelers>이름·사진 수정</button></div></div>';
}
document.addEventListener('click', event => {
  if (event.target.closest('[data-edit-travelers]') && trip()) tripForm(currentTripId);
});
function render() {
  if (homeOpen) {
    renderHome();
    return;
  }
  let t = trip(),
    f = actualStats(),
    people = state.settings.people,
    list = t.viewMode === "list",
    goal = ensureGoal(t);
  $(".hero h1").textContent = t.title;
  $(".hero .eyebrow").textContent = '';
  $(".hero p").textContent = `${t.location} · ${people}명`;
  $("title").textContent = "사뿐";
  $(".tripbadge").textContent = '';
  $(".tripbadge").hidden = true;
  $("#summary").classList.add('trip-summary');
  $("#summary").innerHTML = tripSummaryHtml(t, f.total);
  $("#days").hidden = true;
  $("#days").innerHTML = "";
  $(".layout").classList.toggle("list-layout", list);
  $("#daylabel").textContent = t.start + " — " + t.end;
  $("#daytitle").textContent = list ? "여행 시간표" : "전체 여행 일정";
  if(!list){$("#daytitle").insertAdjacentHTML("beforeend",'<button type="button" id="show-all-map" aria-pressed="'+(mapDisplay().selectedDay===null)+'">전체</button><button type="button" class="temp-location-lookup" id="search-all-map-locations" '+(locationLoadBusy?'disabled':'')+'>'+(locationLoadBusy?'검색 중…':'⌕ 전체 일정 Google 위치 검색')+'</button>');$("#show-all-map").onclick=()=>openScheduleMap(null);$('#search-all-map-locations').onclick=()=>{mapDisplay().selectedDay=null;mapDisplay().showPins=true;requestedMapFocus=null;allMapSignature='';save();loadSelectedDays(state.days.map((_,i)=>i));}; }
  $("#filters").hidden = true;
  $("#stops").innerHTML = actualSchedule(list);
  document.querySelectorAll(".day-cost").forEach((el) => el.remove());
  let bar = $("#planner-controls");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "planner-controls";
    $(".layout").before(bar);
  }
  bar.hidden = true;
  let dash = $("#budget-dashboard");
  if (!dash) {
    dash = document.createElement("div");
    dash.id = "budget-dashboard";
    $(".schedule-column").prepend(dash);
  }
  dash.hidden = true;
  dash.innerHTML = '';
  $("#budget").closest(".panel").hidden = true;
  renderMapDayControls();

  installSearch();
  let apibar = $("#api-call-controls");
  if (!apibar) {
    apibar = document.createElement("div");
    apibar.id = "api-call-controls";
    $(".map-searchbox").after(apibar);
  }
  apibar.innerHTML='';
  installMapDisplayControls(apibar);
  if (gmap) {
    gmap.setOptions({ gestureHandling: "greedy", scrollwheel: true });
    drawGoogle();
  } else {
    $("#embed").src =
      "https://maps.google.com/maps?q=" +
      encodeURIComponent(activeScheduleCard?.tripId === currentTripId ? state.days[day]?.[selected]?.query || t.location : t.location) +
      "&output=embed";
  }
  renderFiles();
  clearTimeout(routeRefreshTimer);
}
function savedPoint(s) {
  s = linkedLodging(s);
  return (s.placeQuery === s.query ? s.chosenPlace : null) || resolvedPlaces.get(s.query);
}
// Each trip keeps independent map visibility preferences.
function mapDisplay() {
  const prefs = trip().mapDisplay ??= {};
  if (prefs.selectedDay !== null && (!Number.isInteger(prefs.selectedDay) || prefs.selectedDay < 0 || prefs.selectedDay >= state.days.length)) prefs.selectedDay = 0;
  prefs.showPins ??= true;
  delete prefs.hiddenDays;
  delete prefs.showRoutes;
  return prefs;
}
function mapDayVisible(d) {
  const selected = mapDisplay().selectedDay;
  return selected === null || selected === d;
}
function renderMapDayControls() {
  $('#mapstrip').innerHTML='';$('#mapstrip').hidden=true;
  document.querySelectorAll('#stops [data-mapday]').forEach(button=>button.setAttribute('aria-pressed',String(mapDisplay().selectedDay===Number(button.dataset.mapday))));
}
function installMapDisplayControls(bar) {
  const prefs = mapDisplay();
  bar.insertAdjacentHTML("beforeend", `<div class="map-display-controls" role="group" aria-label="장소 핀 표시 설정">
    <button type="button" id="toggle-map-pins" aria-pressed="${prefs.showPins}">${prefs.showPins ? "핀 숨기기" : "핀 보이기"}</button>
    </div><p id="map-route-status" class="map-route-status" role="status" aria-live="polite"></p>`);
  updateMapRouteStatus();
}
let mapViewportSelection = "";
let mapDrawVersion = 0;
let mapRouteStatus = "";
function updateMapRouteStatus(message = mapRouteStatus) {
  mapRouteStatus = message;
  const el = $("#map-route-status");
  if (el) el.textContent = !gmap ? "지도 연결 후 선택한 날짜의 장소와 이동 경로를 볼 수 있어요." : message;
}
document.addEventListener("click", (event) => {
  const button = event.target.closest("#toggle-map-pins, [data-mapday]");
  if (!button) return;
  const prefs = mapDisplay();
  if (button.id === "toggle-map-pins") prefs.showPins = !prefs.showPins;
  else {
    const selected = button.dataset.mapday === "all" ? null : Number(button.dataset.mapday);
    if (selected !== null && (!Number.isInteger(selected) || selected < 0 || selected >= state.days.length)) return;
    prefs.selectedDay = selected;
    if (selected !== null) day = selected;
    requestedMapFocus = null;
  }
  save(); allMapSignature = "";
  render();
  if(button.dataset.mapday!==undefined&&gmap&&typeof loadSelectedDays==='function'){const days=prefs.selectedDay===null?state.days.map((_,i)=>i):[prefs.selectedDay];if(days.some(d=>state.days[d].some(stop=>stop.query&&!savedPoint(stop))))loadSelectedDays(days);}
});

async function resolveSegmentLocations(d, i) {
  if (!gmap || !state.settings.key) return;
  const tripId = currentTripId, stops = [state.days[d]?.[i], state.days[d]?.[i + 1]];
  await Promise.allSettled(stops.filter(stop => stop?.query && !savedPoint(stop)).map(async stop => {
    const point = await resolvePlace(stop);
    if (currentTripId !== tripId || !state.days[d]?.includes(stop)) return;
    stop.chosenPlace = point; stop.placeQuery = stop.query;
  }));
  if (currentTripId === tripId && !homeOpen) { allMapSignature = ""; save(); drawGoogle(); }
}

function routePathPoint(point) {
  return { lat: typeof point.lat === "function" ? point.lat() : point.lat,
    lng: typeof point.lng === "function" ? point.lng() : point.lng };
}
function routeMidpoint(path) {
  const points = path.map(routePathPoint);
  if (points.length < 2) return points[0];
  const radians = degrees => degrees * Math.PI / 180;
  const longitudeDelta = (a,b) => ((b-a+540)%360)-180;
  const lengths = points.slice(1).map((b,i)=>{
    const a=points[i],lat=radians(b.lat-a.lat),lng=radians(longitudeDelta(a.lng,b.lng));
    const h=Math.sin(lat/2)**2+Math.cos(radians(a.lat))*Math.cos(radians(b.lat))*Math.sin(lng/2)**2;
    return 2*Math.atan2(Math.sqrt(Math.min(1,h)),Math.sqrt(Math.max(0,1-h)));
  });
  let remaining=lengths.reduce((sum,length)=>sum+length,0)/2;
  for(let i=0;i<lengths.length;i++){
    if(remaining<=lengths[i]){
      const ratio=lengths[i]?remaining/lengths[i]:0,a=points[i],b=points[i+1];
      return {lat:a.lat+(b.lat-a.lat)*ratio,lng:((a.lng+longitudeDelta(a.lng,b.lng)*ratio+540)%360)-180};
    }
    remaining-=lengths[i];
  }
  return points.at(-1);
}
async function drawMapRoutes(version) {
  const prefs = mapDisplay();
  const valid = () => version === mapDrawVersion && !homeOpen && (!trip().workspaceView || trip().workspaceView === "itinerary");
  let total = 0, drawn = 0, manual = 0, transit = 0, direct = 0, missing = 0;
  for (let d = 0; d < state.days.length; d++) {
    if (!mapDayVisible(d)) continue;
    const stops = state.days[d];
    for (let i = 0; i < stops.length - 1; i++) {
      if (!valid()) return;
      const stop = stops[i];
      if (!hasSegment(stop)) continue;
      total++;
      if (!savedPoint(stop) || !savedPoint(stops[i + 1])) { missing++; continue; }
      if (!valid()) return;
      const result = currentRoute(d, i);
      const actual = result?.status === "ok" && result.path?.length >= 2;
      const entered = stop.minutes!==null&&stop.minutes!==undefined&&stop.minutes!==''&&Number.isFinite(Number(stop.minutes))&&Number(stop.minutes)>=0;
      const solid = actual || entered || stop.mode === "대중교통";
      const path = actual ? result.path.map(routePathPoint) : [savedPoint(stop), savedPoint(stops[i + 1])].map(routePathPoint);
      overviewLines.push(new google.maps.Polyline({ map: gmap, path,
        strokeColor: dayColor(d), strokeOpacity: actual ? 1 : solid ? 0.95 : 0, strokeWeight: actual ? 6 : 5,
        icons: solid ? [{ icon: { path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 2 }, offset: "60%" }]
          : [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 0.8, scale: 3 }, offset: "0", repeat: "12px" }],
      }));
      if (actual) drawn++; else if(entered) manual++; else if(stop.mode==="대중교통") transit++; else direct++;
      const label = document.createElement("button");
      label.type = "button";
      label.className = "map-travel-label";
      label.style.borderColor = dayColor(d);
      const minutes = stop.minutes ?? result?.minutes;
      label.textContent = (transportIcon[stop.mode] || "🚐") + " " + stop.mode + (minutes != null ? " · " + minutes + "분" : "");
      label.title = stop.name + " → " + stops[i + 1].name + (!actual&&entered?' · 시간 직접 입력 · 장소 간 연결선':'');
      label.onclick = () => { day = d; leg(i); };
      if (prefs.showPins) travelLabelMarkers.push(new google.maps.marker.AdvancedMarkerElement({ map: gmap,
        position: routeMidpoint(path), content: label, zIndex: 20,
      }));
    }
  }
  if (!valid()) return;
  updateMapRouteStatus(!total ? "표시할 이동 구간이 없어요. 날짜와 장소를 선택해 주세요." :
    [drawn ? "실제 이동 경로 " + drawn + "개 표시" : "",
      transit ? "대중교통 " + transit + "개 · 장소 간 실선 연결" : "",
      manual ? "직접 입력한 이동 " + manual + "개 · 장소 간 실선 연결" : "",
      direct ? "점선 연결 " + direct + "개 · 실제 길찾기 경로 아님" : "",
      missing ? "위치 미조회 " + missing + "개 · 일정 지도 조회를 눌러 주세요." : "",
      ].filter(Boolean).join(" · "));
}
let highlightedMapSelection = null;
function highlightMapStop(stopId) {
  highlightedMapSelection = stopId ? {tripId:currentTripId,stopId} : null;
  updateMapPinSelection();
}
function updateMapPinSelection() {
  const stopId = highlightedMapSelection?.tripId === currentTripId ? highlightedMapSelection.stopId : null;
  for (const marker of markers) {
    const pin = marker.sappunPin;
    if (!pin) continue;
    const visit = pin.visits.find(visit => visit.stop.id === stopId);
    pin.badge.classList.toggle('is-selected-map-pin',Boolean(visit));
    pin.badge.classList.toggle('is-muted-map-pin',Boolean(stopId && !visit));
    pin.badge.setAttribute('aria-pressed',String(Boolean(visit)));
    marker.zIndex = visit ? 100000 : pin.baseZIndex;
    const selectedStopId = visit?.stop.id || null;
    if (pin.selectedStopId !== selectedStopId) {
      pin.badge.innerHTML = visit
        ? '<span class="pin-head"><b>'+esc(visit.index+1)+'</b></span><span class="pin-place-name">'+esc(visit.stop.name)+'</span>'
        : pin.defaultHtml;
      pin.selectedStopId = selectedStopId;
    }
    pin.badge.style.setProperty('--pin-color',dayColor(visit ? visit.day : pin.visits[0].day));
  }
}
async function drawGoogle() {
  if (homeOpen || !gmap || (trip().workspaceView && trip().workspaceView !== "itinerary")) return;
  const prefs = mapDisplay();
  const signature = JSON.stringify([currentTripId, prefs, state.days, [...routeResults].map(([key, r]) => [key, r.fetched])]);
  const viewportSelection = JSON.stringify([currentTripId, prefs.selectedDay,
    state.days.flatMap((stops, d) => mapDayVisible(d) ? stops.map(savedPoint).filter(Boolean).map(p => [p.lat, p.lng]) : []).sort()]);
  const focus = requestedMapFocus;
  if (signature === allMapSignature && !focus) return;
  allMapSignature = signature;
  const version = ++mapDrawVersion;
  markers.forEach((m) => (m.map = null)); markers = [];
  overviewLines.forEach((p) => p.setMap(null)); overviewLines = [];
  shownRouteLines.forEach((p) => p.setMap(null)); shownRouteLines = [];
  travelLabelMarkers.forEach((m) => (m.map = null)); travelLabelMarkers = [];
  const bounds = new google.maps.LatLngBounds(),pinGroups=[];
  let count = 0;
  state.days.forEach((stops,d)=>{if(!mapDayVisible(d))return;stops.forEach((stop,index)=>{
    const p=savedPoint(stop);if(!p||!Number.isFinite(p.lat)||!Number.isFinite(p.lng))return;
    const point={lat:p.lat,lng:p.lng};bounds.extend(point);count++;
    let group=pinGroups.find(group=>{const north=(group.point.lat-point.lat)*111320,east=(group.point.lng-point.lng)*111320*Math.cos(point.lat*Math.PI/180);return north*north+east*east<=18*18;});
    if(!group){group={point,visits:[]};pinGroups.push(group);}group.visits.push({stop,day:d,index});
  });});
  if(prefs.showPins)for(const group of pinGroups){
    const visits=group.visits,first=visits[0],multiple=visits.length>1,crossDay=new Set(visits.map(v=>v.day)).size>1;
    const numbers=visits.map(v=>crossDay?'D'+(v.day+1)+'·'+(v.index+1):String(v.index+1)).join(' · ');
    const badge=document.createElement('button');badge.type='button';badge.className='named-map-pin'+(multiple?' grouped-map-pin':'');badge.style.setProperty('--pin-color',dayColor(first.day));
    badge.innerHTML='<span class="pin-head"><b>'+esc(numbers)+'</b></span><span class="pin-place-name">'+esc(first.stop.name)+(multiple?' <small>'+visits.length+'회 방문</small>':'')+'</span>';
    badge.title=visits.map(v=>'Day '+(v.day+1)+' · '+(v.index+1)+'번 · '+v.stop.name).join(' / ');
    badge.onclick=()=>{
      if(!multiple){day=first.day;focusCard(first.index);return;}
      modal('<h2>같은 위치의 방문 일정</h2><div class="pin-visit-list">'+visits.map((visit,index)=>'<button type="button" data-pin-visit="'+index+'"><b>Day '+(visit.day+1)+' · '+(visit.index+1)+'번</b><span>'+esc(visit.stop.name)+'</span><small>'+esc(hasStopTime(visit.stop)?stopStart(visit.stop)+' → '+stopEnd(visit.stop):'시간 미정')+'</small></button>').join('')+'</div>',()=>{}, {closeButton:true});
      $('#form button[type="submit"]').textContent='닫기';document.querySelectorAll('[data-pin-visit]').forEach(button=>{button.onclick=()=>{const visit=visits[Number(button.dataset.pinVisit)];$('#modal').close();day=visit.day;openDetail(visit.index);};});
    };
    const baseZIndex=multiple?2000+visits.length:1000+first.index;
    const marker=new google.maps.marker.AdvancedMarkerElement({map:gmap,position:group.point,content:badge,title:badge.title,zIndex:baseZIndex});
    marker.sappunPin={badge,visits,baseZIndex,defaultHtml:badge.innerHTML};
    markers.push(marker);
  }
  if (focus?.tripId === currentTripId) highlightedMapSelection = {tripId:currentTripId,stopId:focus.stopId};
  updateMapPinSelection();
  if (focus && focus.tripId === currentTripId) {
    const s = state.days.flat().find((s) => s.id === focus.stopId), p = s && savedPoint(s);
    if (p) { gmap.panTo({ lat: p.lat, lng: p.lng }); gmap.setZoom(Math.max(18,gmap.getZoom?.()||0)); }
    else toast("저장된 위치가 없어요. 해당 날짜의 위치 조회 버튼을 이용해 주세요.", "warning");
    requestedMapFocus = null;
  } else if (count && mapViewportSelection !== viewportSelection) {
    gmap.fitBounds(bounds, 55); if (count === 1) gmap.setZoom(15);
  }
  mapViewportSelection = count ? viewportSelection : "";
  try {
    await drawMapRoutes(version);
  } catch (error) {
    if (version === mapDrawVersion && !homeOpen)
      updateMapRouteStatus("경로를 표시하지 못했어요. " + errorText(error));
  }
}

async function refreshGoogleSegments(indices){
  const tripId=currentTripId;let refreshed=0,failed=0;
  for(const d of indices){const stops=state.days[d];for(let i=0;i<stops.length-1;i++){
    if(tripId!==currentTripId||homeOpen)return {refreshed,failed};
    const stop=stops[i],next=stops[i+1];if(stop.manualRoute||stop.noTravel||!['도보','택시','대중교통'].includes(stop.mode))continue;
    const known=stop.googleRouteRequested||currentRoute(d,i)?.status==='ok'||(stop.manualRoute===false&&Number.isFinite(stop.minutes));if(!known)continue;
    const signature=routeSignature(d,i),mode=stop.mode;
    try{const result=await lookupSegmentRoute(d,stop,next,mode,{departureBasis:stop.googleRouteDepartureBasis||'schedule'});
      if(tripId!==currentTripId||state.days[d][i]!==stop||state.days[d][i+1]!==next||stop.mode!==mode||signature!==routeSignature(d,i)||stop.manualRoute)continue;
      routeResults.set(signature,result);stop.minutes=result.minutes;stop.googleRouteRequested=true;syncFollowingSchedule(d,i,result.minutes);refreshed++;
    }catch(error){failed++;}
  }}return {refreshed,failed};
}
async function loadSelectedDays(indices, refreshRoutes=false) {
  if (locationLoadBusy) return;
  if (!gmap) {
    toast("지도 키를 먼저 연결해 주세요.", "warning");
    return;
  }
  mapDisplay().showPins = true;
  let id = currentTripId,
    success = 0,
    error = "";
  locationLoadBusy = true;
  const searchedQueries=new Set();
  render();
  try {
    outer: for (let d of indices)
      for (let s of state.days[d]) {
        if (homeOpen || id !== currentTripId) break outer;
        if (!s.query || (!refreshRoutes&&s.placeQuery === s.query && s.chosenPlace)) continue;
        try {
          s.chosenPlace = searchedQueries.has(s.query)&&resolvedPlaces.has(s.query)?resolvedPlaces.get(s.query):await resolvePlace(s,refreshRoutes);
          searchedQueries.add(s.query);
          s.placeQuery = s.query;
          success++;
        } catch (e) {
          error = errorText(e);
          if (/한도|권한|quota|denied/i.test(error)) break outer;
        }
      }
    if(refreshRoutes&&id===currentTripId&&!homeOpen){const routes=await refreshGoogleSegments(indices);if(routes.refreshed||routes.failed)error=[error,routes.refreshed+"개 이동 구간 갱신"+(routes.failed?" · "+routes.failed+"개는 기존 시간 유지":"")].filter(Boolean).join(" · ");}
    save();
  } finally {
    locationLoadBusy = false;
    allMapSignature = "";
    if (!homeOpen && id === currentTripId) render();
    toast(success + "개 위치 저장" + (error ? " · " + error : ""));
  }
}
function leg(i) {
  const d = day, tripId = currentTripId;
  const s = state.days[d][i], next = state.days[d][i + 1];
  if (!s || !next) return;
  let draftRoute = null, requestVersion = 0, appliedRoute = null;
  modal(
    `<h2>이동 구간 설정</h2>
    <p class="note">${esc(s.name)} → ${esc(next.name)}</p>
    ${TravelComponents.choices("이동 수단", "mode", [...modes, "없음"], s.noTravel ? "없음" : s.mode).replace(">없음</button>", ">구간 없음</button>")}
    <details class="segment-route-search" aria-label="Google 경로 조회"><summary>Google 경로 조회 · 선택</summary>
      <div class="segment-route-search-heading"><b>Google 길찾기</b><button type="button" id="segment-route-search" class="primary">경로·소요 시간 조회</button></div>
      <p id="segment-route-status" class="note" role="status" aria-live="polite">이동 수단을 선택하고 예상 시간과 경로를 확인해 보세요.</p>
      ${TravelComponents.choices("조회 출발 기준","routebasis",[{value:"schedule",label:"일정 출발 시각"},{value:"now",label:"현재 시각"}],"schedule")}
      <div id="segment-route-result" hidden></div>
      <a id="segment-route-external" target="_blank" rel="noopener">Google 길찾기에서 열기 ↗</a>
    </details>
    ${input("소요 시간 · 분", "minutes", effectiveLeg(d, i).minutes ?? "", "number", 'min="0" max="2880"')}
    <section id="segment-expense-fields">
    ${select("지출 입력 통화", "farecurrency", ["JPY", "KRW"], s.actualFareCurrency || s.fareCurrency || travelCurrency())}
    ${input("실제 교통비 / 1인 · 없으면 비워두기", "actualfare", s.actualFare ?? "", "number", 'min="0" step="any"')}
    </section>
    <p class="note">${hasStopTime(s) ? esc(stopEnd(s)) + " 출발 · 장소 종료 시간 기준이에요." : "출발 시간은 아직 입력하지 않았어요."} 저장하면 종료 시간 + 이동시간으로 다음 장소 시작을 맞추고, 머무르는 시간은 유지해요. 이어지는 이동시간이 있으면 뒤 일정도 함께 맞춰요.</p>`,
    () => {
      if (currentTripId !== tripId || state.days[d][i] !== s || state.days[d][i + 1] !== next) throw Error("일정이 변경됐어요. 이동 설정을 다시 열어 주세요.");
      const mode = val("mode"), minutes = n(val("minutes")), actualFare = n(val("actualfare"));
      if (minutes !== null && (!Number.isFinite(minutes) || minutes < 0 || minutes > 2880)) throw Error("소요 시간은 0~2880분으로 입력해 주세요.");
      if (mode!=='도보'&&mode!=='없음'&&actualFare !== null && (!Number.isFinite(actualFare) || actualFare < 0)) throw Error("실제 교통비를 확인해 주세요.");
      s.noTravel = mode === "없음"; s.segmentEnabled = !s.noTravel;
      if (!s.noTravel) s.mode = mode;
      s.minutes = minutes;if(mode!=='도보'&&mode!=='없음'){s.actualFare = actualFare; s.actualFareCurrency = val("farecurrency");}
      const useGoogle = !s.noTravel && appliedRoute?.mode === mode && appliedRoute.result.minutes === minutes;
      s.manualRoute = !useGoogle;s.googleRouteRequested=useGoogle;if(useGoogle)s.googleRouteDepartureBasis=appliedRoute.result.departureBasis||"schedule";
      if (!s.noTravel && minutes !== null) syncFollowingSchedule(d, i, minutes);
      if (useGoogle) routeResults.set(routeSignature(d, i), appliedRoute.result);
      // Manual time/fare entry never triggers a location or route lookup.
      allMapSignature = "";
    },
  );
  const panel = $(".segment-route-search"), status = $("#segment-route-status"), resultBox = $("#segment-route-result"), search = $("#segment-route-search"), external = $("#segment-route-external");
  const active = () => currentTripId === tripId && panel.isConnected && $("#modal").open;
  const updateMode = () => {
    requestVersion++; draftRoute = null; appliedRoute = null;
    resultBox.hidden = true; resultBox.innerHTML = "";
    const mode = val("mode"), supported = ["대중교통", "도보", "택시"].includes(mode);
    $('#segment-expense-fields').hidden=mode==='도보'||mode==='없음';
    search.hidden=!supported;
    search.disabled = !supported||search.hidden; search.textContent = "경로·소요 시간 조회";
    external.hidden = !supported; external.href = route({ ...s, mode }, next);
    status.textContent = supported ? mode + " 기준 · " + (hasStopTime(s) ? stopEnd(s) + " 출발" : "장소 사이") + " 경로를 조회해요." : mode === "없음" ? "이 구간은 표시하지 않아요." : "예약한 교통편의 소요 시간을 직접 입력해 주세요.";
    status.classList.toggle("warning", !supported);
  };
  const onModeChange = event => {
    if (!event.target.closest('[data-value-target="f-mode"], [data-value-target="f-routebasis"]')) return;
    queueMicrotask(() => { if (active()) updateMode(); });
  };
  const body = panel.parentElement;
  body.addEventListener("click", onModeChange);
  $("#modal").addEventListener("close", () => body.removeEventListener("click", onModeChange), { once: true });
  search.onclick = async () => {
    const mode = val("mode"), version = ++requestVersion;
    search.disabled = true; search.textContent = "조회 중…";
    resultBox.hidden = true; draftRoute = null;
    status.classList.remove("warning"); status.textContent = mode + " 경로를 찾고 있어요…";
    try {
      const result = await lookupSegmentRoute(d, s, next, mode,{departureBasis:val("routebasis")||"schedule"});
      if (!active() || version !== requestVersion || val("mode") !== mode) return;
      const showResult=result=>{
        draftRoute={mode,result};const alternatives=result.alternatives||[result];
        const lines=(result.steps||[]).filter(step=>step.line||step.text).map(step=>step.line?[step.line,step.from&&step.to?step.from+' → '+step.to:'',step.headsign?step.headsign+' 방면':'',step.stopCount!==null&&step.stopCount!==undefined?step.stopCount+'개 정류장':'',step.departureText||''].filter(Boolean).join(' · '):(step.mode==='WALKING'?'도보 '+step.minutes+'분 · ':'')+step.text);
        resultBox.innerHTML='<div class="segment-route-estimate"><div><small>'+esc(mode)+' · Google 예상</small><strong>'+result.minutes+'분</strong><span>'+((result.distance||0)/1000).toLocaleString('ko-KR',{maximumFractionDigits:1})+' km</span></div><button id="segment-route-apply" type="button">이 경로·시간 적용</button></div>'+
          (result.departureLabel?'<p class="route-query-context">'+esc(result.departureLabel)+' 출발 · '+(result.departureBasis==='now'?'현재 시각 기준':'일정 시각 기준')+'<br>'+esc(result.originName||s.name)+' → '+esc(result.destinationName||next.name)+'</p>':'')+
          (alternatives.length>1?'<div class="route-alternatives">'+alternatives.map((option,index)=>'<button type="button" data-route-choice="'+index+'" aria-pressed="'+(option.minutes===result.minutes&&option.summary===result.summary)+'">'+option.minutes+'분 · '+esc(option.summary||'경로 '+(index+1))+'</button>').join('')+'</div>':'')+
          (lines.length?'<ol class="segment-route-steps">'+lines.map(line=>'<li>'+esc(line)+'</li>').join('')+'</ol>':'<p class="note">이 경로는 상세 노선 정보가 제공되지 않았어요.</p>');
        resultBox.hidden=false;
        $('#segment-route-apply').onclick=()=>{if(!draftRoute||draftRoute.mode!==val('mode'))return;$('#f-minutes').value=draftRoute.result.minutes;appliedRoute=draftRoute;status.textContent='경로와 시간을 적용했어요. 저장하면 일정과 지도에 반영돼요.';};
        resultBox.onclick=event=>{const choice=event.target.closest('[data-route-choice]');if(choice){const option=alternatives[Number(choice.dataset.routeChoice)];if(option)showResult({...option,alternatives});}};
      };
      showResult(result);status.textContent='출발 기준과 노선을 확인하고 사용할 경로를 선택해 주세요.';
    } catch (error) {
      if (!active() || version !== requestVersion) return;
      status.textContent = errorText(error); status.classList.add("warning");
    } finally {
      if (active() && version === requestVersion) { search.disabled = false; search.textContent = "다시 조회"; }
    }
  };
  updateMode();
}

function editCostItem(stopIndex, costIndex = -1) {
  let s = normalizeStop(state.days[day][stopIndex]),
    e = costIndex < 0 ? null : s.costItems[costIndex];
  modal(
    /* HTML */ "<h2>실제 지출 " +
      (e ? "수정" : "추가") +
      '</h2><p class="note">' +
      esc(s.name) +
      " · 결제한 총액을 입력해 주세요.</p>" +
      expenseFormFields(e, false, spendingCategory(s.category)) +
      '<div id="actual-money-preview" class="note"></div>',
    () => {
      let item = {
        ...(e || {}),
        id: e?.id || uid(),
        ...readExpenseFields("costname"),
        planned: e?.planned ?? null,
      };
      if (costIndex < 0) s.costItems.push(item);
      else s.costItems[costIndex] = item;
      setTimeout(() => refreshDetailIfOpen(), 0);
    },
  );
  let preview = () => {
    $("#actual-money-preview").innerHTML = krwFirst(
      won(n(val("actual")), val("currency")),
    );
  };
  $("#f-actual").oninput = preview;
  $("#formbody").onclick = () => {
    if ($("#f-actual") && $("#f-currency")) preview();
  };
  preview();
}
function commonCostForm(i = -1) {
  let e = i < 0 ? null : state.expenses[i];
  modal(/* HTML */ "<h2>공통 실제 지출</h2>" + expenseFormFields(e, true), () => {
    let item = {
      ...(e || {}),
      ...readExpenseFields("name"),
      scope: val("scope"),
      amount: e?.amount || 0,
      planned: e?.planned ?? null,
    };
    if (i < 0) state.expenses.push(item);
    else state.expenses[i] = item;
  });
}
$("#expenseadd").onclick = () => commonCostForm();
let detailContext = null,
  detailObjectUrls = [];
const detailPanel = document.createElement("aside");
detailPanel.id = "place-detail-panel";
detailPanel.hidden = true;
detailPanel.setAttribute("aria-label", "장소 상세");
document.body.append(detailPanel);
function detailStop() {
  if (!detailContext || detailContext.tripId !== currentTripId) return null;
  return state.days[detailContext.day]?.find((s) => s.id === detailContext.stopId);
}
function revokeDetailUrls() {
  detailObjectUrls.forEach((u) => URL.revokeObjectURL(u));
  detailObjectUrls = [];
}
function closeDetail() {
  detailContext = null;
  detailPanel.hidden = true;
  revokeDetailUrls();
  document.body.classList.remove("detail-open");
}
function openDetail(i) {
  let s = state.days[day][i];
  if (!s) return;
  detailContext = { tripId: currentTripId, day, stopId: s.id };
  renderDetail();
}
function refreshDetailIfOpen() {
  if (detailContext && detailStop()) renderDetail();
}
function safeLink(value) {
  let u;
  try {
    u = new URL(value);
  } catch {
    throw Error("올바른 웹 주소를 입력해 주세요.");
  }
  if (!["http:", "https:"].includes(u.protocol))
    throw Error("http 또는 https 링크만 사용할 수 있어요.");
  return u.href;
}
function renderDetail() {
  let s = detailStop();
  if (!s) {
    closeDetail();
    return;
  }
  revokeDetailUrls();
  normalizeStop(s);
  detailPanel.hidden = false;
  document.body.classList.add("detail-open");
  detailPanel.innerHTML = /* HTML */ `<div class="detail-heading">
      <div>
        <small>Day ${detailContext.day + 1} · 장소 상세</small><button type="button" class="place-location-button" data-detail-map>📍 위치 보기</button>
        <input id="f-detailname" class="place-title-editor" form="detail-place-form" aria-label="장소 제목" placeholder="제목 없음" maxlength="150" required value="${esc(s.name)}" />
      </div>
      <button id="close-place-detail" aria-label="장소 상세 닫기">×</button>
    </div>
    <div class="detail-body">
      <form id="detail-place-form" class="place-content-editor"><span id="place-save-status" role="status">저장됨</span><section class="place-schedule-settings"><h3>날짜 · 시간 · 장소</h3>
        <div class="fields">
          ${scheduleDateFields("detail", detailContext.day, s)}
          ${input("시작 시간", "detailstart", hasStopTime(s) ? stopStart(s) : "", "time")}${input(
            "종료 시간",
            "detailend",
            hasStopTime(s) ? stopEnd(s) : "",
            "time",
          )}
        </div>
${select("장소 분류", "detailcategory", categories, s.category)}${lodgingLinkFields(s,'detail')}${input(
          "주소 · 지도 검색어",
          "detailquery",
          s.query,
         )}</section><label
          >메모<textarea id="detail-note" maxlength="1000">${esc(s.note || "")}</textarea
          ></label
        >
      </form>
      <section class="detail-section">
        <div class="detail-section-heading">
          <h3>실제 지출</h3>
          <button id="detail-add-cost">＋ 추가</button>
        </div>
        ${stopPersonalCosts(s) ? '<div class="detail-spent-total">' + stopPersonalCosts(s) + '</div>' : ''}
        ${s.costItems
          .filter(knownActual)
          .map(
            (e) =>
              /* HTML */ `<div class="detail-cost">
                <b
                  >${categoryIcon[e.category]} ${esc(e.name)}<small
                    >${esc(e.category)}</small
                  ></b
                ><span class="currency-stack"
                  >${krwFirst(TravelFinance.totalKRW(e,state.settings.people,won,e.scope === "전체" ? "total" : "perPerson"))}<button
                    data-detailcostedit="${esc(e.id)}"
                  >
                    수정</button
                  ><button data-detailcostdelete="${esc(e.id)}">삭제</button></span
                >
              </div>`,
          )
          .join("")}
      </section>
    </div>`;
  $("#close-place-detail").onclick = () => {closeDetail();render();};
  $("#detail-place-form").onsubmit = (e) => {
    e.preventDefault();
    if(!val("detailname").trim()){$("#place-save-status").textContent="제목을 입력해 주세요";return;}
    const previousDay=detailContext.day,previousEnd=hasStopTime(s)?Date.parse(scheduleEndDate(s,previousDay)+"T"+stopEnd(s)+":00Z"):NaN;
    let targetDay;
    try { targetDay = saveScheduleRange(s, detailContext.day, "detail", val("detailstart"), val("detailend")); }
    catch (error) { toast(error.message, "warning"); return; }
    s.name = val("detailname").trim();
    s.category = val("detailcategory");
    s.query = val("detailquery").trim();
    applyLodgingLink(s, $("#f-detaillodging")?.value || '');
    s.note = $("#detail-note").value;
    if (Number.isInteger(targetDay) && state.days[targetDay] && targetDay !== detailContext.day) {
      const oldDay = detailContext.day;
      state.days[oldDay].splice(state.days[oldDay].indexOf(s), 1);
      state.days[targetDay].push(s);
      detailContext.day = targetDay; day = targetDay; selected = state.days[targetDay].length - 1;
    }
    if(targetDay===previousDay)cascadeScheduleEdit(previousDay,state.days[previousDay].indexOf(s),previousEnd);
    allMapSignature = "";
    save();
    render();
    renderDetail();

  };
  $("#detail-add-cost").onclick = () => {
    day = detailContext.day;
    editCostItem(state.days[day].findIndex((x) => x.id === s.id));
  };
  const markSaved=()=>{$('#place-save-status').textContent='저장됨';};
  $('#f-detailname').oninput=event=>{const name=event.target.value.trim();if(!name){$('#place-save-status').textContent='제목을 입력해 주세요';return;}s.name=name.slice(0,150);save();markSaved();};
  $('#f-detailname').onkeydown=event=>{if(event.key==='Enter'&&!event.isComposing){event.preventDefault();event.target.blur();}};
  $('#f-detailname').onchange=()=>render();
  $('#f-detailname').onblur=event=>{if(!event.target.value.trim()){event.target.value=s.name;markSaved();}};
  $('#detail-note').oninput=event=>{s.note=event.target.value;save();markSaved();};
  $('#detail-place-form').onkeydown=event=>{if(event.key==='Enter'&&!event.isComposing&&event.target.tagName!=='TEXTAREA'&&event.target.tagName!=='BUTTON'){event.preventDefault();event.target.blur();}};
  $('#detail-place-form').onchange=event=>{if(event.target.id==='f-detailname'||event.target.id==='detail-note'){render();return;}$('#detail-place-form').onsubmit({preventDefault(){}});};
  detailPanel.onclick = (e) => {
    if(e.target.closest('[data-value-target="f-detailcategory"]')){queueMicrotask(()=>{if(detailStop()===s)$("#detail-place-form").onsubmit({preventDefault(){}});});return;}
    let b = e.target.closest("[data-detailcostedit]");
    if (b) {
      day = detailContext.day;
      editCostItem(
        state.days[day].findIndex((x) => x.id === s.id),
        s.costItems.findIndex((x) => x.id === b.dataset.detailcostedit),
      );
    }
    b = e.target.closest("[data-detailcostdelete]");
    if (b && confirm("지출 항목을 삭제할까요?")) {
      s.costItems = s.costItems.filter((x) => x.id !== b.dataset.detailcostdelete);
      save();
      render();
      renderDetail();
    }
    b = e.target.closest("[data-linkdelete]");
    if (b) {
      s.links = (s.links || []).filter((l) => l.id !== b.dataset.linkdelete);
      save();
      renderDetail();
    }
    b = e.target.closest("[data-detailfiledownload]");
    if (b) downloadDetailFile(b.dataset.detailfiledownload);
    b = e.target.closest("[data-detailfiledelete]");
    if (b) deleteDetailFile(b.dataset.detailfiledelete);
  };

}
function safeStoredLink(url) {
  try {
    return safeLink(url);
  } catch {
    return "#";
  }
}
function chooseDetailUpload(kind) {
  let input = $("#detail-upload-input");
  input.dataset.kind = kind;
  input.accept = kind === "image" ? "image/*" : "";
  input.click();
}
async function uploadDetailFiles(e) {
  let context = { ...detailContext },
    kind = e.target.dataset.kind;
  try {
    if (!db) throw Error("브라우저 파일 저장소를 사용할 수 없어요.");
    for (let file of e.target.files) {
      if (file.size > 20 * 1024 * 1024) {
        toast("20MB 이하 파일을 선택해 주세요.", "warning");
        continue;
      }
      if (kind === "image" && !file.type.startsWith("image/")) continue;
      await dbop("readwrite", (store) =>
        store.put({
          id: uid(),
          tripId: context.tripId,
          day: context.day,
          stopId: context.stopId,
          kind,
          name: file.name,
          blob: file,
        }),
      );
    }
    if (detailContext?.stopId === context.stopId) renderDetail();
    toast("파일을 저장했어요.", "success");
  } catch (e) {
    toast(e.message);
  }
}
async function loadDetailFiles() {
  let context = { ...detailContext };
  if (!db) return;
  try {
    let files = (await allFiles()).filter(
      (f) => f.tripId === context.tripId && f.stopId === context.stopId,
    );
    if (!detailContext || detailContext.stopId !== context.stopId) return;
    $("#detail-images").innerHTML = files
      .filter((f) => f.kind === "image")
      .map((f) => {
        let url = URL.createObjectURL(f.blob);
        detailObjectUrls.push(url);
        return /* HTML */ `<div>
          <img src="${url}" alt="${esc(f.name)}" /><small>${esc(f.name)}</small
          ><button data-detailfiledownload="${f.id}">저장</button
          ><button data-detailfiledelete="${f.id}">삭제</button>
        </div>`;
      })
      .join("");
    $("#detail-files").innerHTML = files.filter(f=>f.kind!=='image').map(f=>{const url=URL.createObjectURL(f.blob);detailObjectUrls.push(url);return '<div class="detail-file-preview">'+TravelMedia.file(f,url)+'<button type="button" data-detailfiledelete="'+esc(f.id)+'">삭제</button></div>';}).join('');
  } catch {
    toast("파일을 불러오지 못했어요.");
  }
}
async function downloadDetailFile(id) {
  let f = await dbop("readonly", (s) => s.get(id));
  if (f) download(f.blob, f.name);
}
async function deleteDetailFile(id) {
  if (!confirm("첨부 파일을 삭제할까요?")) return;
  await window.SappunCloudFiles?.remove(id);
  await dbop("readwrite", (s) => s.delete(id));
  refreshDetailIfOpen();
}
const homeBeforeDetail = showHome;
showHome = function () {
  closeDetail();
  homeBeforeDetail();
};
const openBeforeDetail = openTrip;
openTrip = function (id) {
  closeDetail();
  allMapSignature = "";
  openBeforeDetail(id);
};
document.addEventListener(
  "click",
  (e) => {
    let b = e.target.closest("[data-load-day]");
    if (b) {
      e.stopImmediatePropagation();
      mapDisplay().selectedDay=+b.dataset.loadDay;mapDisplay().showPins=true;requestedMapFocus=null;allMapSignature='';save();
      loadSelectedDays([+b.dataset.loadDay]);
      return;
    }
    b = e.target.closest("[data-placedetail]");
    if (b) {
      e.stopImmediatePropagation();
      openDetail(+b.dataset.placedetail);
      return;
    }
    b = e.target.closest("[data-addsegment]");
    if (b) {
      e.stopImmediatePropagation();
      leg(+b.dataset.addsegment);
      return;
    }
    b = e.target.closest("[data-removesegment]");
    if (b) {
      e.stopImmediatePropagation();
      let s = state.days[day][+b.dataset.removesegment];
      s.noTravel = true;
      s.segmentEnabled = false;
      allMapSignature = "";
      save();
      render();
    }
  },
  true,
);
save();
showHome();

// 11. labels-v7
const attachmentDays = new Map();
function attachmentDay() {
  return Math.min(attachmentDays.get(currentTripId) ?? 0, state.days.length - 1);
}
function originalFare(s) {
  if (s.actualFare === null || s.actualFare === undefined || s.actualFare === "")
    return "";
  return formatCurrency(s.actualFare, s.actualFareCurrency || s.fareCurrency || "JPY");
}
async function renderFiles() {
  if (!db || homeOpen) return;
  let id = currentTripId,
    d = attachmentDay();
  try {
    let files = (await allFiles()).filter(fileBelongs);
    if (id !== currentTripId || d !== attachmentDay()) return;
    $("#files").innerHTML = /* HTML */ `<div
        class="attachment-days"
        role="group"
        aria-label="첨부파일 날짜"
      >
        ${state.days
          .map(
            (_, i) =>
              /* HTML */ `<button
                type="button"
                data-attachmentday="${i}" style="--day-color:${dayColor(i)};--day-bg:${dayBackgrounds[i % dayBackgrounds.length]}"
                class="${d === i ? "active" : ""}"
                aria-pressed="${d === i}"
              >
                <b>Day ${i + 1}</b><small>${dateLabel(tripDate(i))}</small
                ><span>${files.filter((f) => f.day === i).length}개</span>
              </button>`,
          )
          .join("")}
      </div>
      <div class="attachment-list">
        ${files
          .filter((f) => f.day === d)
          .map((f) => {
            let place = state.days[d]?.find((s) => s.id === f.stopId);
            return /* HTML */ `<div class="fileitem">
              <button type="button" class="attachment-open" data-filepreview="${esc(f.id)}" aria-label="${esc(f.name)} 미리보기">
                <b>${f.kind === "image" ? "🖼️" : "📎"} ${esc(f.name)}</b
                ><small
                  >${place ? esc(place.name) : "여행 공통 첨부"} ·
                  ${Math.ceil(f.blob.size / 1024)} KB</small
                >
              </button>
              <div>
                <button type="button" data-filepreview="${esc(f.id)}">미리보기</button><button data-download="${esc(f.id)}">다운로드</button
                >
              </div>
            </div>`;
          })
          .join("") || '<div class="empty">이 날짜에 등록한 첨부파일이 없어요.</div>'}
      </div>`;
    let note = $("#files").parentElement.querySelector("p.note");
    if (note)
      note.textContent =
        "파일을 누르면 미리 볼 수 있어요. 추가·수정은 여행 자료실에서 관리해 주세요.";
  } catch {
    toast("첨부파일을 불러오지 못했어요.");
  }
}
$("#files").addEventListener("click", (e) => {
  let b = e.target.closest("[data-attachmentday]");
  if (b) {
    attachmentDays.set(currentTripId, +b.dataset.attachmentday);
    renderFiles();
  }
});
const detailUploadBeforeV7 = uploadDetailFiles;
uploadDetailFiles = async function (e) {
  let context = { ...detailContext };
  await detailUploadBeforeV7(e);
  if (context.tripId === currentTripId) {
    attachmentDays.set(currentTripId, context.day);
    await renderFiles();
  }
};
const detailDeleteBeforeV7 = deleteDetailFile;
deleteDetailFile = async function (id) {
  await detailDeleteBeforeV7(id);
  await renderFiles();
};
$("#uploads").onchange = async (e) => {
  let id = currentTripId,
    d = attachmentDay();
  try {
    if (!db) throw Error("브라우저 파일 저장소를 사용할 수 없어요.");
    for (let f of e.target.files) {
      if (f.size > 20 * 1024 * 1024) {
        toast(f.name + ": 20MB 이하 파일을 선택해 주세요.");
        continue;
      }
      await dbop("readwrite", (s) =>
        s.put({
          id: uid(),
          tripId: id,
          day: d,
          kind: "file",
          name: f.name,
          blob: f,
        }),
      );
    }
    await renderFiles();
    toast("첨부파일을 저장했어요.", "success");
  } catch (error) {
    toast(error.message);
  }
  e.target.value = "";
};

const renderBeforeV7 = render;
render = function () {
  renderBeforeV7();
  if (homeOpen) return;
  document.querySelectorAll(".day-group").forEach((group) => {
    let d = +group.dataset.groupDay;
    group.querySelectorAll("[data-card-index]").forEach((card) => {
      let i = +card.dataset.cardIndex,
        s = state.days[d]?.[i],
        name =
          card.querySelector(".map-stop-content h3") ||
          card.querySelector("td:nth-child(3)>b");
      if (!s || !name) return;
      let pill = document.createElement("button");
      pill.type = "button";
      pill.className = "place-category-pill";
      pill.textContent = ({음식:"식사·카페",관광:"관광·체험"}[s.category]||s.category);
      pill.title = "장소 분류 보기 및 수정";
      pill.onclick = (e) => {
        e.stopPropagation();
        day = d;
        openDetail(i);
      };
      const heading = card.querySelector('.stop-card-heading');
      if (heading) {
        const metadata = document.createElement('div');
        metadata.className = 'stop-category-meta';
        metadata.append(pill);
        heading.after(metadata);
      } else name.append(pill);
    });
  });
};
const legBeforeV7 = leg;
leg = function (i) {
  legBeforeV7(i);
  document.querySelectorAll(".transport-choice [data-value]").forEach((b) => {
    b.innerHTML = /* HTML */ `<span>${transportIcon[b.dataset.value] || "🚐"}</span
      ><small>${esc(b.dataset.value === "없음" ? "구간 없음" : b.dataset.value)}</small>`;
  });
};


// 12. scroll-search-v8
const renderBeforeV8 = render;
render = function () {
  renderBeforeV8();
  if (homeOpen) return;
  const stage = $(".mapstage"),
    bar = $("#api-call-controls");
  if (stage && bar) stage.before(bar);
  const footer = $(".mapfooter");
  if (stage && footer) (bar || stage).before(footer);
  const search = $(".map-searchbox");
  if (stage && search) stage.prepend(search);
};

// 13. ui-v9
const mapIconV9 =
  /* HTML */ '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2Z"/><path d="M9 3v16m6-14v16"/></svg>';

const focusBeforeV9 = focusCard;
focusCard = function (i) {
  if (trip().viewMode === "list") {
    openDetail(i);
    return;
  }
  focusBeforeV9(i);
};
document.addEventListener(
  "click",
  (e) => {
    let b = e.target.closest("[data-mapjump]");
    if (!b) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    let group = b.closest("[data-group-day]");
    if (group) day = +group.dataset.groupDay;
    closeDetail();
    focusBeforeV9(+b.dataset.mapjump);
    requestAnimationFrame(() =>
      $(".mapcolumn")?.scrollIntoView({
        block: "start",
        behavior: "smooth",
      }),
    );
  },
  true,
);
const renderBeforeV9 = render;
render = function () {
  renderBeforeV9();
  if (homeOpen) return;
  const box = $(".map-searchbox"),
    stage = $(".mapstage"),
    bar = $("#api-call-controls");
  if (box && stage) {
    stage.prepend(box);
    if (bar) stage.before(bar);
  }
  document.querySelectorAll(".map-stop-card [data-placedetail]").forEach((b) => {
    b.removeAttribute("data-placedetail");
    b.dataset.mapjump = b.closest("[data-card-index]").dataset.cardIndex;
    b.innerHTML = mapIconV9;
    b.className = "place-map-button";
    b.title = "지도에서 보기";
    b.setAttribute("aria-label", "지도에서 보기");
  });
  let dashboard = $("#budget-dashboard");
  if (dashboard && !dashboard.hidden) {
    let daily = dashboard.querySelector(".daily-expenses");
    if (daily) {
      let title = daily.previousElementSibling;
      if (title?.tagName === "H3") title.remove();
      daily.remove();
    }
  }
};

// 14. ui-v10
function iconV10(name) {
  let paths = {
    back: '<path d="m12 5-7 7 7 7M5 12h15"/>',
    info: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 3v4M12 3v4M16 3v4M8 11h8M8 15h8"/>',
    list: '<path d="M9 6h12M9 12h12M9 18h12M3 6h1M3 12h1M3 18h1"/>',
    up: '<path d="m6 14 6-6 6 6"/>',
    down: '<path d="m6 10 6 6 6-6"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5"/>',
    settings:
      '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="currentColor"/><circle cx="15" cy="17" r="3" fill="currentColor"/>',
    link: '<path d="m9 15 6-6M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m4 2 1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0" transform="translate(1 0) scale(.9)"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
  };
  return (
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    (paths[name] || paths.info) +
    "</svg>"
  );
}
function decorateV10() {
  let homeButton = $("#go-home"),
    brand = $("header .brand");
  if (homeButton && brand) {
    let left = $("#header-left-v10");
    if (!left) {
      left = document.createElement("div");
      left.id = "header-left-v10";
      brand.before(left);
      left.append(brand);
    }
    left.prepend(homeButton);
    homeButton.innerHTML = iconV10("back");
    homeButton.setAttribute("aria-label", "전체 일정으로 돌아가기");
  }
  [
    ["settings", "settings", "여행 설정"],
    ["backup", "download", "백업"],
    ["restore", "upload", "불러오기"],
    ["mapsetup", "link", "지도 연결"],
  ].forEach(([id, icon, label]) => {
    let b = $("#" + id);
    if (b) b.innerHTML = iconV10(icon) + "<span>" + label + "</span>";
  });
  document.querySelectorAll("[data-viewmode]").forEach((b) => {
    b.innerHTML =
      (b.dataset.viewmode === "map" ? mapIconV9 : iconV10("list")) +
      "<span>" +
      (b.dataset.viewmode === "map" ? "지도 모드" : "리스트·경비") +
      "</span>";
  });
  if (homeOpen) return;
  document.querySelectorAll(".map-stop-card [data-mapjump]").forEach((b) => {
    b.dataset.detailicon = b.dataset.mapjump;
    b.removeAttribute("data-mapjump");
    b.className = "place-detail-icon";
    b.innerHTML = iconV10("info");
    b.title = "장소 상세";
    b.setAttribute("aria-label", "장소 상세");
  });
  let stats = actualStats();
  document.querySelectorAll(".day-group").forEach((group) => {
    let d = +group.dataset.groupDay,
      heading = group.querySelector(".day-group-heading"),
      tools = heading?.querySelector(".tools");
    if (trip().viewMode === "list" && tools) {
      let amount = document.createElement("div");
      amount.className = "heading-spend-v10 currency-stack";
      amount.innerHTML =
        "<span>실제 지출</span>" + krwFirst(stats.days[d]);
      tools.prepend(amount);
      group.querySelector(".day-spend-v9")?.remove();
    }
    let fold = group.querySelector(".day-fold");
    if (fold) {
      let em = fold.querySelector("em");
      if (em) em.textContent = fold.getAttribute("aria-expanded") === "true" ? "−" : "＋";
    }
  });

  document.querySelectorAll("[data-dayadd]").forEach((b) => {
    if (!b.classList.contains("schedule-add-card")) b.innerHTML = iconV10("plus");
    b.title = "이 날짜에 장소 추가";
    b.setAttribute("aria-label", "이 날짜에 장소 추가");
  });
}
document.addEventListener(
  "click",
  (e) => {
    let b = e.target.closest("[data-detailicon]");
    if (!b) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    day = +b.closest("[data-group-day]").dataset.groupDay;
    openDetail(+b.dataset.detailicon);
  },
  true,
);
const renderBeforeV10 = render;
render = function () {
  renderBeforeV10();
  decorateV10();
};
const homeBeforeV10 = showHome;
showHome = function () {
  homeBeforeV10();
  decorateV10();
};
decorateV10();

// 15. world-currency-ui
/* ============================================================
 * 전 세계 여행 통화 / 직접 입력하는 환율
 * 이 아래를 수정하면 통화 선택창·환율 안내를 바꿀 수 있습니다.
 * ============================================================ */
function currencyChoices(codes) {
  return codes.map((code) => ({ value: code, label: code + " · " + currencyName(code) }));
}
function currencySelector(id, selected) {
  return TravelComponents.currencyPicker(
    "여행 통화",
    id,
    currencyChoices(supportedCurrencies()),
    selected,
  );
}

function exchangeFields(code, settings, prefix) {
  let rate = "";
  try {
    rate = currencyRate(code, settings);
  } catch {}
  return (
    input(
      "환율 · 1 " + code + " = 원화(KRW)",
      prefix + "value",
      rate,
      "number",
      'required min="0.000001" step="any"',
    ) +
    `<div class="exchange-rate-note"><span id="${prefix}-rate-status" role="status"></span> <a href="https://www.exchangerate-api.com" target="_blank" rel="noopener">Rates By Exchange Rate API</a></div>`
  );
}

function prefillExchange(code, settings, prefix) {
  ExchangeRates.prefill(
    code,
    $("#f-" + prefix + "value"),
    $("#" + prefix + "-rate-status"),
    settings.travelCurrency === code && Number(settings.currencyRates?.[code]) > 0,
  );
}

function readExchange(prefix, code) {
  if (code === "KRW") return 1;
  const value = Number(val(prefix + "value"));
  if (!Number.isFinite(value) || value <= 0)
    throw Error("1 " + code + "에 해당하는 환율을 0보다 큰 숫자로 입력해 주세요.");
  return value;
}

function saveCurrencySettings(settings, code, rate) {
  settings.travelCurrency = code;
  settings.currencyRates = {
    JPY: settings.rate || 9,
    ...(settings.currencyRates || {}),
    KRW: 1,
    [code]: rate,
  };
  if (code === "JPY") settings.rate = rate;
}

// 모든 지출 입력창에서 여행 통화와 원화를 선택할 수 있습니다.

// 여행 생성·수정 화면에도 통화와 환율을 넣습니다.
const tripFormBeforeWorld = tripForm;
tripForm = function (id = null) {
  tripFormBeforeWorld(id);
  const target = tripBook.trips.find((t) => t.id === id);
  const settings = target?.data.settings || {
    travelCurrency: "KRW",
    currencyRates: { KRW: 1 },
  };
  $("#formbody").insertAdjacentHTML(
    "beforeend",
    /* HTML */ `<section class="world-currency-settings">
      ${currencySelector("tripcurrency", travelCurrency(settings))}
      <div id="trip-exchange-fields"></div>
    </section>`,
  );
  const update = () => {
    const code = val("tripcurrency");
    $("#trip-exchange-fields").innerHTML = exchangeFields(code, settings, "tripfx");
    prefillExchange(code, settings, "tripfx");
    $("#trip-exchange-fields").hidden = code === "KRW";
    $("#trip-exchange-fields")
      .querySelectorAll("input")
      .forEach((el) => {
        el.disabled = code === "KRW";
      });
  };
  $("#f-tripcurrency").onchange = update;
  update();
  const original = submitHandler;
  submitHandler = async () => {
    const code = val("tripcurrency"),
      rate = readExchange("tripfx", code);
    // 기존 submit에서 즉시 렌더링하므로 수정 중인 여행은 먼저 설정합니다.
    const previous = target ? structuredClone(target.data.settings) : null;
    if (target) saveCurrencySettings(target.data.settings, code, rate);
    try {
      const result = await original();
      if (result === false) {
        if (target) target.data.settings = previous;
        return false;
      }
      const saved = target || tripBook.trips.at(-1);
      saveCurrencySettings(saved.data.settings, code, rate);
      save();
      allMapSignature = "";
      return result;
    } catch (error) {
      if (target) target.data.settings = previous;
      throw error;
    }
  };
};

// 원화가 기본 표시이며, 아래에 여행 통화로 환산한 금액이 표시됩니다.

if (!homeOpen) render();

function renderLeg(d, i) {
  let a = state.days[d][i],
    l = effectiveLeg(d, i),
    r = l.route,
    times = legTimes(d, i),
    loading = routeJobs.has(routeSignature(d, i));
  return /* HTML */ `<div class="leg-time-line">
      <span><small>출발</small> ${esc(times.departure)}</span
      ><span class="leg-travel-duration"
        >${times.minutes === null ? "소요 시간 미입력" : times.minutes + "분"}</span
      ><span><small>도착</small> ${esc(times.arrival)}</span>
    </div>
    <div class="transport-options">
      ${modes
        .map(
          (m) =>
            /* HTML */ `<button
              type="button"
              class="${a.mode === m ? "active" : ""}"
              data-mode-button="${i}"
              data-mode="${m}"
            >
              ${m}
            </button>`,
        )
        .join("")}
    </div>
    <div class="legmain">
      <span class="legmetric">${dualMoney(l.fare, l.currency)} / 인</span
      ><button data-leg="${i}">시간·비용 수정</button>
    </div>
    <div class="legmeta">
      ${a.manualRoute
        ? "직접 입력한 교통편"
        : loading
          ? "Google 경로 조회 중…"
          : r?.status === "ok"
            ? "Google 조회 결과"
            : esc(r?.error || "이동 수단과 소요 시간을 입력할 수 있어요.")}
    </div>
    <div class="legtools">
      <button data-routedetail="${i}">상세 경로</button
      ><button data-routeauto="${i}">경로 조회</button
      ><a href="${route(a, state.days[d][i + 1])}" target="_blank" rel="noopener"
        >Google 길찾기 ↗</a
      >
    </div>`;
}

function expenseFormFields(entry, common, category = "기타") {
  const display = entry ? {...entry, actual: entry.payerId === "self" ? TravelFinance.perPersonOriginal(entry,state.settings.people) : TravelFinance.totalOriginal(entry,state.settings.people,common && entry.scope === "전체" ? "total" : "perPerson")} : null;
  return TravelComponents.expenseFields({entry:display,common,category,currency:travelCurrency(),categories:spendCategories,renderSelect:select}) + (common ? expenseScheduleFields(entry) : "") + expenseAllocationFields(entry);
}
function readExpenseFields(nameId) {
  const actual=Number(val("actual")), name=val(nameId).trim();
  if(!name || !val("actual").trim() || !Number.isFinite(actual) || actual<0) throw Error("항목 이름과 0 이상의 총액을 입력해 주세요.");
  return {name,category:val("spendcategory"),currency:val("currency"),actual,amountBasis:"total",...(nameId === "name" ? {stopIds:[...document.querySelectorAll('input[name="expense-stop"]:checked')].map(input=>input.value)} : {}),...readExpenseAllocation()};
}

// Reordering uses stable stop IDs; time and expense values stay with each place.
function reorderScheduleStop(d, stopId, boundary, targetDay = d) {
  const stops = state.days[d], destination = state.days[targetDay];
  if (!stops || !destination || !Number.isInteger(boundary) || boundary < 0 || boundary > destination.length) return false;
  const from = stops.findIndex(stop => String(stop.id) === String(stopId));
  if (from < 0) return false;
  const to = targetDay === d && boundary > from ? boundary - 1 : boundary;
  if (targetDay === d && from === to) return false;
  const [stop] = stops.splice(from, 1);
  if (targetDay !== d && typeof shiftScheduleDates === "function") shiftScheduleDates(stop, d, targetDay);
  destination.splice(to, 0, stop);
  if (typeof detailContext !== "undefined" && detailContext?.stopId === stop.id) detailContext.day = targetDay;
  day = targetDay; selected = to; requestedMapFocus = null;
  allMapSignature = "";
  save(); render();
  return true;
}
function installScheduleReordering() {
  const host = $("#stops");
  const help = document.createElement("p");
  help.id = "schedule-reorder-help"; help.className = "schedule-reorder-help";
  help.textContent = "⋮⋮ 핸들을 잡고 원하는 위치로 옮겨요. 다른 날짜로도 옮길 수 있어요.";
  host.before(help);
  const live = document.createElement("div");
  live.className = "visually-hidden"; live.setAttribute("role", "status"); live.setAttribute("aria-live", "polite"); host.after(live);
  let dragging = null, frame = 0;
  const animations = new Map();
  function blockFor(row) { return row.closest(".schedule-stop-block") || row; }
  function companions(row) {
    const block = blockFor(row);
    return block === row && row.nextElementSibling?.matches(".list-segment-row") ? [block, row.nextElementSibling] : [block];
  }
  function stableRect(element) {
    const rect = element.getBoundingClientRect();
    const transform = getComputedStyle(element).transform;
    let shift = 0;
    if (transform && transform !== "none") {
      const values = transform.match(/matrix(?:3d)?\(([^)]+)\)/)?.[1]?.split(",").map(Number);
      if (values) shift = values.length === 16 ? values[13] : values[5];
    }
    return { top: rect.top - (shift || 0), bottom: rect.bottom - (shift || 0), left: rect.left, width: rect.width, height: rect.height };
  }
  function restore(drag) {
    for (const row of drag.originalRows) for (const node of drag.bundles.get(row)) drag.container.append(node);
  }
  function cleanup(restoreOrder = true) {
    const drag = dragging;
    if (!drag) return;
    dragging = null; cancelAnimationFrame(frame); frame = 0;
    if (restoreOrder) restore(drag);
    host.querySelectorAll(".day-drop-target").forEach(node => node.classList.remove("day-drop-target"));
    drag.row.classList.remove("schedule-dragging"); drag.block.classList.remove("schedule-drag-placeholder");
    drag.handle.setAttribute("aria-pressed", "false"); drag.preview.remove();
    document.body.classList.remove("schedule-reordering");
    if (host.hasPointerCapture?.(drag.pointerId)) host.releasePointerCapture(drag.pointerId);
    animations.forEach(animation => animation.cancel()); animations.clear();
  }
  function previewOrder(drag, before) {
    const rows = [...drag.group.querySelectorAll("[data-stop-id]")];
    const remaining = rows.filter(row => row !== drag.row);
    const target = before ? remaining.indexOf(before) : remaining.length;
    if (target === rows.indexOf(drag.row)) return;
    const positions = new Map(rows.map(row => [blockFor(row), blockFor(row).getBoundingClientRect().top]));
    const anchor = before ? blockFor(before) : null;
    for (const node of drag.bundles.get(drag.row)) drag.container.insertBefore(node, anchor);
    for (const row of rows) {
      const block = blockFor(row), oldTop = positions.get(block);
      animations.get(block)?.cancel();
      const delta = oldTop - block.getBoundingClientRect().top;
      if (delta && block.animate && !window.matchMedia("(prefers-reduced-motion: reduce)").matches)
        animations.set(block, block.animate([{transform: "translateY(" + delta + "px)"}, {transform: "translateY(0)"}], {duration: 180, easing: "cubic-bezier(.2,.8,.2,1)"}));
    }
  }
  function tick() {
    const drag = dragging;
    if (!drag || !drag.started) return;
    if (homeOpen || drag.tripId !== currentTripId || !drag.row.isConnected) { cleanup(); return; }
    drag.preview.style.transform = "translate3d(" + (drag.x - drag.offsetX) + "px," + (drag.y - drag.offsetY) + "px,0) rotate(0.5deg)";
    const targetGroup = [...host.querySelectorAll("[data-group-day]")].find(group => {
      const rect = group.getBoundingClientRect();
      return drag.x >= rect.left - 36 && drag.x <= rect.right + 36 && drag.y >= rect.top && drag.y <= rect.bottom;
    });
    drag.valid = Boolean(targetGroup);
    drag.preview.classList.toggle("outside-drop-zone", !targetGroup);
    host.querySelectorAll(".day-drop-target").forEach(node => node.classList.remove("day-drop-target"));
    if (targetGroup) {
      drag.targetDay = Number(targetGroup.dataset.groupDay);
      const rows = [...targetGroup.querySelectorAll("[data-stop-id]")].filter(row => row !== drag.row);
      const before = rows.find(row => { const rect = stableRect(blockFor(row)); return drag.y < rect.top + rect.height / 2; });
      drag.targetBoundary = before ? rows.indexOf(before) : rows.length;
      if (targetGroup === drag.group) previewOrder(drag, before);
      else targetGroup.classList.add("day-drop-target");
    }
    const edge = 90, y = drag.y;
    const scrollBox = host.closest(".schedule-column");
    const scrollingPanel = scrollBox && scrollBox.scrollHeight > scrollBox.clientHeight && /auto|scroll/.test(getComputedStyle(scrollBox).overflowY);
    const viewport = scrollingPanel ? scrollBox.getBoundingClientRect() : {top: 0, bottom: window.innerHeight};
    const speed = y < viewport.top + edge ? -Math.min(20, (viewport.top + edge - y) / 4) : y > viewport.bottom - edge ? Math.min(20, (y - viewport.bottom + edge) / 4) : 0;
    if (speed) (scrollingPanel ? scrollBox : window).scrollBy(0, speed);
    frame = requestAnimationFrame(tick);
  }
  host.addEventListener("pointerdown", event => {
    const handle = event.target.closest(".schedule-drag-handle");
    if (!handle || event.button !== 0 || dragging) return;
    const row = handle.closest("[data-stop-id]"), group = row?.closest("[data-group-day]");
    if (!row || !group) return;
    event.preventDefault(); event.stopPropagation();
    const rect = row.getBoundingClientRect(), block = blockFor(row);
    const originalRows = [...group.querySelectorAll("[data-stop-id]")];
    const preview = document.createElement("div"); preview.className = "schedule-drag-preview"; preview.hidden = true;
    preview.setAttribute("aria-hidden", "true"); preview.style.width = rect.width + "px";
    const clone = row.cloneNode(true);
    if (row.matches("tr")) { const table = document.createElement("table"), tbody = document.createElement("tbody"); table.className = "itinerary-table list-table-v9"; tbody.append(clone); table.append(tbody); preview.append(table); }
    else preview.append(clone);
    document.body.append(preview);
    dragging = {handle, row, block, group, container: block.parentElement, originalRows, bundles: new Map(originalRows.map(row => [row, companions(row)])),
      d: Number(group.dataset.groupDay), stopId: row.dataset.stopId, tripId: currentTripId, pointerId: event.pointerId,
      startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top, started: false, valid: false, preview};
    host.setPointerCapture(event.pointerId);
  });
  host.addEventListener("pointermove", event => {
    const drag = dragging;
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.x = event.clientX; drag.y = event.clientY;
    if (!drag.started && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < 4) return;
    event.preventDefault();
    if (!drag.started) {
      drag.started = true; drag.preview.hidden = false;
      drag.handle.setAttribute("aria-pressed", "true"); drag.row.classList.add("schedule-dragging"); drag.block.classList.add("schedule-drag-placeholder");
      document.body.classList.add("schedule-reordering"); frame = requestAnimationFrame(tick);
    }
  }, {passive: false});
  host.addEventListener("pointerup", event => {
    const drag = dragging;
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.x = event.clientX; drag.y = event.clientY;
    if (drag.started) { cancelAnimationFrame(frame); tick(); }
    const rows = [...drag.group.querySelectorAll("[data-stop-id]")];
    const to = rows.indexOf(drag.row), from = drag.originalRows.indexOf(drag.row);
    const valid = drag.started && drag.valid && currentTripId === drag.tripId && !homeOpen;
    const targetDay = drag.targetDay ?? drag.d;
    const boundary = targetDay === drag.d ? (to > from ? to + 1 : to) : drag.targetBoundary;
    const d = drag.d, stopId = drag.stopId;
    const dropRects = new Map(rows.map(row => [row.dataset.stopId, row.getBoundingClientRect().top]));
    cleanup();
    if (valid && reorderScheduleStop(d, stopId, boundary, targetDay)) {
      live.textContent = "Day " + (d + 1) + " 일정 순서를 변경했어요.";
      const group = [...host.querySelectorAll("[data-group-day]")].find(group => Number(group.dataset.groupDay) === d);
      for (const row of group?.querySelectorAll("[data-stop-id]") || []) {
        const delta = (dropRects.get(row.dataset.stopId) ?? row.getBoundingClientRect().top) - row.getBoundingClientRect().top;
        if (delta && row.animate && !window.matchMedia("(prefers-reduced-motion: reduce)").matches)
          row.animate([{transform: "translateY(" + delta + "px)"}, {transform: "translateY(0)"}], {duration: 180, easing: "ease-out"});
      }
    }
  });
  host.addEventListener("pointercancel", () => cleanup());
  host.addEventListener("lostpointercapture", () => cleanup());
  host.addEventListener("click", event => { if (event.target.closest(".schedule-drag-handle")) { event.preventDefault(); event.stopPropagation(); } });
  host.addEventListener("keydown", event => {
    const handle = event.target.closest(".schedule-drag-handle");
    if (event.key === "Escape" && dragging) { event.preventDefault(); cleanup(); return; }
    if (!handle || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const row = handle.closest("[data-stop-id]"), d = Number(row.closest("[data-group-day]").dataset.groupDay), index = Number(row.dataset.cardIndex);
    const boundary = event.key === "ArrowUp" ? index - 1 : index + 2;
    if (reorderScheduleStop(d, row.dataset.stopId, boundary)) {
      const moved = [...host.querySelectorAll("[data-stop-id]")].find(item => item.dataset.stopId === row.dataset.stopId);
      moved?.querySelector(".schedule-drag-handle")?.focus(); live.textContent = "Day " + (d + 1) + " 일정 순서를 변경했어요.";
    }
  });
}

installScheduleReordering();

// Progressive editing: only the selected place exposes empty-field actions.
function activateScheduleCard(card) {
  const d = Number(card.closest("[data-group-day]").dataset.groupDay);
  const stop = state.days[d]?.find(stop => String(stop.id) === card.dataset.stopId);
  if (!stop) return;
  if(card.matches('.grid-event') || window.matchMedia('(max-width: 760px)').matches){day=d;selected=state.days[d].indexOf(stop);openDetail(selected);return;}
  day = d; selected = state.days[d].indexOf(stop);
  closeDetail();
  focusBeforeV9(selected);
}
function quickStopTime(d, index) {
  const stop = state.days[d][index], tripId = currentTripId;
  modal(`<h2>${esc(stop.name)} · 날짜와 시간</h2>${scheduleDateFields("quick", d, stop)}<div class="fields">${input("시작 시간", "quickstart", hasStopTime(stop) ? stopStart(stop) : "", "time")}${input("종료 시간", "quickend", hasStopTime(stop) ? stopEnd(stop) : "", "time")}</div><button type="button" id="clear-quick-time">시간 지우기</button><p class="note">이 장소의 시간을 바꾸면 뒤 일정도 함께 맞춰요. 이동시간과 체류시간은 유지합니다.</p>`, () => {
    if (tripId !== currentTripId || !state.days[d].includes(stop)) throw Error("일정이 변경됐어요. 다시 열어 주세요.");
    const previousEnd=hasStopTime(stop)?Date.parse(scheduleEndDate(stop,d)+"T"+stopEnd(stop)+":00Z"):NaN;
    const targetDay = saveScheduleRange(stop, d, "quick", val("quickstart"), val("quickend"));
    if (targetDay !== d) { state.days[d].splice(state.days[d].indexOf(stop),1); state.days[targetDay].push(stop); day = targetDay; selected = state.days[targetDay].length - 1; }
    else cascadeScheduleEdit(d,index,previousEnd);
    allMapSignature = "";
  });
  $("#clear-quick-time").onclick = () => { $("#f-quickstart").value = ""; $("#f-quickend").value = ""; };
}
function quickStopNote(d, index) {
  const stop = state.days[d][index], tripId = currentTripId;
  modal(`<h2>${esc(stop.name)} · 메모</h2><label>메모<textarea id="f-quicknote" maxlength="1000" autofocus>${esc(stop.note || "")}</textarea></label>`, () => {
    if (tripId !== currentTripId || !state.days[d].includes(stop)) throw Error("일정이 변경됐어요. 다시 열어 주세요.");
    stop.note = val("quicknote").trim();
  });
}
function positionSegmentMenu(details) {
  if (!details.open) return;
  const summary = details.querySelector("summary"), menu = details.querySelector(".segment-menu"), rect = summary.getBoundingClientRect();
  const width = Math.min(260, window.innerWidth - 24);
  menu.style.width = width + "px";
  menu.style.left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)) + "px";
  menu.style.maxHeight = Math.max(120, window.innerHeight - 24) + "px";
  const height = menu.getBoundingClientRect().height;
  menu.style.top = Math.max(12, Math.min(rect.bottom + 5, window.innerHeight - height - 12)) + "px";
}
function openSegmentMenu(d, index, message = "") {
  const menu = [...$("#stops").querySelectorAll(".segment-popover")].find(menu => Number(menu.dataset.segmentDay) === d && Number(menu.dataset.segmentIndex) === index);
  if (!menu) return;
  menu.open = true;
  if (message) menu.querySelector(".segment-menu-status").textContent = message;
  requestAnimationFrame(() => positionSegmentMenu(menu));
}
function closeSegmentMenus(except = null) {
  document.querySelectorAll(".segment-popover[open]").forEach(menu => { if (menu !== except) menu.open = false; });
}
document.addEventListener("toggle", event => {
  const details = event.target;
  if (!details.matches?.(".segment-popover") || !details.open) return;
  closeSegmentMenus(details); positionSegmentMenu(details);
}, true);
document.addEventListener("click", event => { if (!event.target.closest(".segment-popover")) closeSegmentMenus(); });
window.addEventListener("resize", () => closeSegmentMenus());
window.addEventListener("scroll", event => { if (!event.target?.closest?.(".segment-menu")) closeSegmentMenus(); }, true);
document.addEventListener("keydown", event => { if (event.key === "Escape") closeSegmentMenus(); });
document.addEventListener("click", async event => {
  const action = event.target.closest("[data-stop-action]");
  if (action) {
    event.preventDefault(); event.stopImmediatePropagation();
    const card = action.closest("[data-stop-id]"), d = Number(card.closest("[data-group-day]").dataset.groupDay), index = Number(card.dataset.cardIndex);
    day = d;
    if (action.dataset.stopAction === "time") quickStopTime(d, index);
    if (action.dataset.stopAction === "note") quickStopNote(d, index);
    if (action.dataset.stopAction === "cost") editCostItem(index);
    if (action.dataset.stopAction === "details") openDetail(index);
    if (action.dataset.stopAction === "move") openSegmentMenu(d, index);
    return;
  }
  const button = event.target.closest("[data-segment-mode], [data-segment-lookup], [data-segment-settings], [data-segment-hide]");
  if (!button) return;
  event.preventDefault(); event.stopImmediatePropagation();
  const menu = button.closest(".segment-popover"), d = Number(menu.dataset.segmentDay), index = Number(menu.dataset.segmentIndex), stop = state.days[d][index], next = state.days[d][index + 1];
  if (!stop || !next) return;
  day = d;
  if (button.hasAttribute("data-segment-settings")) { menu.open = false; leg(index); return; }
  if (button.hasAttribute("data-segment-hide")) { stop.noTravel = true; stop.segmentEnabled = false; allMapSignature = ""; save(); render(); return; }
  const mode = button.dataset.segmentMode || stop.mode || "도보", tripId = currentTripId;
  const previousMode=stop.mode,previousMinutes=stop.minutes,previousManual=stop.manualRoute;
  stop.mode = mode; stop.noTravel = false; stop.segmentEnabled = true; stop.manualRoute = false; stop.minutes = mode===previousMode?previousMinutes:null;
  routeResults.delete(routeSignature(d, index)); allMapSignature = ""; save(); render();
  if (button.dataset.segmentMode) { stop.manualRoute = true; stop.googleRouteRequested = false; save(); return; }
  await resolveSegmentLocations(d, index);
  if (currentTripId !== tripId || state.days[d]?.[index] !== stop || stop.mode !== mode) return;
  if (!gmap || !state.settings.key) { if(mode===previousMode){stop.manualRoute=previousManual;save();}openSegmentMenu(d, index, "지도 연결 후 Google 소요 시간을 조회할 수 있어요. 직접 입력도 가능해요."); return; }
  openSegmentMenu(d, index, "Google 소요 시간을 조회하고 있어요…");
  await getLeg(d, index, true, true);
  if (homeOpen || currentTripId !== tripId || state.days[d]?.[index] !== stop || state.days[d]?.[index + 1] !== next || stop.mode !== mode) return;
  const result = currentRoute(d, index);
  if (result?.status === "ok") { stop.googleRouteRequested=true;stop.googleRouteDepartureBasis="schedule";stop.minutes = result.minutes; syncFollowingSchedule(d, index, result.minutes); }
  else if(mode===previousMode){stop.minutes=previousMinutes;stop.manualRoute=previousManual;}
  allMapSignature = ""; save(); render();
  if (result?.status !== "ok") openSegmentMenu(d, index, result?.error || "경로를 찾지 못했어요. 시간을 직접 입력할 수 있어요.");
}, true);

// Direct time entry avoids the browser's scrolling time picker.
document.addEventListener("click", event => {
  const button = event.target.closest("[data-time-target]");
  if (!button) return;
  const field = document.getElementById(button.dataset.timeTarget);
  if (field) { field.value = button.dataset.timeValue; field.dispatchEvent(new Event("input", {bubbles:true})); field.focus(); }
});
document.addEventListener("focusout", event => {
  const field = event.target;
  if (!field.matches?.(".time-entry input")) return;
  const digits = field.value.trim().replace(/[^0-9]/g, "");
  if (/^\d{3,4}$/.test(digits)) field.value = digits.padStart(4,"0").replace(/(\d{2})(\d{2})/, "$1:$2");
});

// Explicit map navigation on mobile leaves the itinerary stationary until requested.
document.addEventListener('click', event => {
  const button = event.target.closest('[data-card-map]');
  if (!button) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const card = button.closest('[data-card-index]');
  day = Number(card.closest('[data-group-day]').dataset.groupDay);
  closeDetail();
  focusBeforeV9(Number(card.dataset.cardIndex));
}, true);

// Browser :active feedback is inconsistent while a touch scroll container is present.
(function installScheduleTouchFeedback() {
  let press = null, releaseTimer = null;
  function clearPress() {
    clearTimeout(releaseTimer);
    press?.card.classList.remove('is-touch-pressed');
    press = null;
  }
  document.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
    clearPress();
    const card = event.target.closest('#stops .map-stop-card, #stops .grid-event');
    if (!card || event.target.closest('.schedule-drag-handle')) return;
    press = {card, id:event.pointerId, x:event.clientX, y:event.clientY};
    card.classList.add('is-touch-pressed');
  }, {capture:true, passive:true});
  document.addEventListener('pointermove', event => {
    if (press && event.pointerId === press.id && Math.hypot(event.clientX-press.x,event.clientY-press.y)>10) clearPress();
  }, {capture:true, passive:true});
  document.addEventListener('pointerup', event => {
    if (press && event.pointerId === press.id) releaseTimer = setTimeout(clearPress,180);
  }, {capture:true, passive:true});
  document.addEventListener('pointercancel', clearPress, {capture:true, passive:true});
  document.addEventListener('scroll', clearPress, {capture:true, passive:true});
  window.addEventListener('blur', clearPress);
})();
