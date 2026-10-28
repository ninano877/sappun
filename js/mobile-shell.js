// Mobile keeps navigation and infrequent trip tools in one clearly labeled menu.
(function installMobileShell() {
  const media = window.matchMedia('(max-width: 760px)');
  const header = document.querySelector('body > header');
  const tools = header.querySelector('.tools');
  const toolsHome = document.createComment('trip tools');
  tools.before(toolsHome);
  let navHome = null, menu = null, lastTrip = '';

  function restore() {
    document.body.classList.remove('mobile-shell','trip-menu-shell');
    if (menu) menu.open = false;
    const nav = document.querySelector('#trip-workspace-nav');
    if (navHome && nav) navHome.after(nav);
    toolsHome.after(tools);
    const back = document.querySelector('#go-home');
    if (back) (document.querySelector('#header-left-v10') || tools).prepend(back);
    if (menu) menu.hidden = true;
  }

  function sync() {
    if (homeOpen) { restore(); return; }
    document.body.classList.add('trip-menu-shell');
    document.body.classList.toggle('mobile-shell',media.matches);
    const nav = document.querySelector('#trip-workspace-nav');
    if (!nav) return;
    if (!navHome) { navHome = document.createComment('trip navigation'); nav.before(navHome); }
    if (!menu) {
      menu = document.createElement('details');
      menu.className = 'mobile-trip-menu';
      menu.innerHTML = '<summary aria-label="여행 메뉴"><span class="mobile-current-tab"></span><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg></summary><div class="mobile-trip-menu-panel"><small>여행 보기</small><div class="mobile-menu-nav"></div><small>여행 관리</small><div class="mobile-menu-tools"></div></div>';
      header.append(menu);
    }
    menu.hidden = false;
    menu.querySelector('.mobile-current-tab').textContent = sharedViewMode ? '여행 메뉴' : media.matches ? nav.querySelector('[aria-pressed="true"]')?.textContent.trim() || '여행 메뉴' : '여행 관리';
    if (media.matches) menu.querySelector('.mobile-menu-nav').append(nav);
    else navHome.after(nav);
    menu.querySelector('.mobile-menu-tools').append(tools);

    if (lastTrip !== currentTripId) { menu.open = false; lastTrip = currentTripId; }
  }

  const previousRender = render;
  render = function(...args) { const result = previousRender.apply(this,args); sync(); return result; };
  const previousHome = showHome;
  showHome = function(...args) { const result = previousHome.apply(this,args); sync(); return result; };
  media.addEventListener('change',sync);
  document.addEventListener('click',event => {
    if (!menu?.open) return;
    if (!menu.contains(event.target) || event.target.closest('.mobile-trip-menu-panel button')) menu.open = false;
  },true);
  document.addEventListener('keydown',event => { if (event.key === 'Escape' && menu) menu.open = false; });
  sync();
})();
