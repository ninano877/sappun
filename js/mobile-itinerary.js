// Pick the itinerary nearest the reading line immediately below the sticky map.
function mobileScheduleCandidate(cards, focusY, viewportBottom) {
  let best = null, visibleHeight = 0;
  for (const card of cards) {
    const rect = card.getBoundingClientRect();
    if (rect.height <= 0 || rect.bottom <= focusY || rect.top >= viewportBottom) continue;
    // A previous card's clipped footer must not beat the next readable title.
    if (rect.top >= focusY - 24) return card;
    const visible = Math.min(rect.bottom,viewportBottom)-Math.max(rect.top,focusY);
    if (visible > visibleHeight) { best = card; visibleHeight = visible; }
  }
  return best;
}

(function installMobileItinerary() {
  const media = window.matchMedia('(max-width: 760px)');
  let timer = null, request = 0, lastKey = '', pauseUntil = 0;
  let desktopHasScrolled=false,followTrip=null;
  const enabled = () => !homeOpen &&
    (trip().workspaceView || 'itinerary') === 'itinerary' && trip().viewMode !== 'list';

  function refreshChrome() {
    const active = enabled();
    if(followTrip!==currentTripId){followTrip=currentTripId;desktopHasScrolled=false;lastKey='';}
    document.body.classList.toggle('mobile-itinerary', active && media.matches);
    if (!active) { clearTimeout(timer); timer = null; request++; lastKey = '';desktopHasScrolled=false; return; }
    scheduleFollow();
  }

  async function followVisiblePlace() {
    if (!enabled() || (!media.matches&&!desktopHasScrolled) || Date.now() < pauseUntil || document.body.matches('.detail-open, .resource-open') || document.querySelector('dialog[open]')) return;
    const map = document.querySelector('.layout .mapcolumn');
    if(!map || !map.getClientRects().length)return;
    const mapRect = map.getBoundingClientRect();
    if (media.matches && (mapRect.top > 10 || mapRect.bottom >= window.innerHeight - 60)) return;
    const listRect=document.querySelector('#stops').getBoundingClientRect();
    const header=document.querySelector('body > header');
    const headerBottom=header?Math.max(0,Math.min(header.getBoundingClientRect().bottom,100)):0;
    const visibleTop=Math.max(headerBottom+24,listRect.top,0),visibleBottom=Math.min(window.innerHeight,listRect.bottom);
    if(visibleBottom<=visibleTop)return;
    const focusY=media.matches?mapRect.bottom+12:visibleTop;
    const cards=[...document.querySelectorAll('#stops .map-stop-card')];
    const card = media.matches?mobileScheduleCandidate(cards,focusY,visibleBottom):cards.find(node=>{const r=node.getBoundingClientRect();return r.height>0&&r.bottom>visibleTop+Math.min(36,r.height/2)&&r.top<visibleBottom;});
    if (!card) return;
    const d = Number(card.closest('[data-group-day]').dataset.groupDay);
    const index = Number(card.dataset.cardIndex), stop = state.days[d]?.[index];
    if (!stop) return;
    const key = currentTripId + ':' + stop.id;
    if (key === lastKey) {
      const point=savedPoint(stop);if(!media.matches&&gmap&&point)centerMapOnVisiblePoint({lat:point.lat,lng:point.lng});
      return;
    }
    lastKey = key;
    const token = ++request, tripId = currentTripId;
    const valid = () => enabled() && token === request && currentTripId === tripId &&
      state.days[d]?.includes(stop) && Date.now() >= pauseUntil && !document.body.matches('.detail-open, .resource-open');
    if (!gmap) return;
    try {
      const point = savedPoint(stop);
      if (!point || !valid()) {if(token===request)lastKey='';return;}
      document.querySelectorAll('.is-map-following').forEach(item => item.classList.remove('is-map-following'));
      card.classList.add('is-map-following');
      highlightMapStop(stop.id);
      const prefs = mapDisplay();
      if (prefs.selectedDay !== null && prefs.selectedDay !== d) {
        prefs.selectedDay = d;
        prefs.showPins = true;
        requestedMapFocus = {tripId, stopId:stop.id};
        await drawGoogle();
        if (!valid()) return;
      }
      highlightMapStop(stop.id);
      const zoom = gmap.getZoom?.() || 15;
      if (zoom < 14 || zoom > 17) gmap.setZoom(15);
      centerMapOnVisiblePoint({lat:point.lat,lng:point.lng});
    } catch {
      // Keep the current map if a place has no usable location; scrolling stays uninterrupted.
      if (token === request) lastKey = '';
    }
  }

  function scheduleFollow() {
    if (!enabled() || (!media.matches&&!desktopHasScrolled) || timer !== null) return;
    timer = setTimeout(() => { timer = null; followVisiblePlace(); }, 80);
  }
  const previousRender = render;
  render = function(...args) {
    const result = previousRender.apply(this, args);
    refreshChrome();
    return result;
  };
  const previousHome = showHome;
  showHome = function(...args) {
    const result = previousHome.apply(this, args);
    refreshChrome();
    return result;
  };
  window.addEventListener('scroll', event=>{
    if(event.target?.closest?.('.mapstage,.mobile-trip-menu,.cloud-dialog'))return;
    if(!media.matches)desktopHasScrolled=true;
    scheduleFollow();
  }, {passive:true,capture:true});
  window.addEventListener('resize', refreshChrome, {passive:true});
  window.addEventListener('sappun-explicit-map-focus',event=>{
    pauseUntil=Date.now()+1600;request++;
    lastKey=currentTripId+':'+event.detail.stopId;
  });
  media.addEventListener('change', refreshChrome);
  document.addEventListener('pointerdown', event => {
    if (enabled() && event.target.closest('.mapstage')) {
      pauseUntil = Date.now() + 1800;
      request++;
      lastKey = '';
    }
  }, {capture:true, passive:true});
  refreshChrome();
})();
