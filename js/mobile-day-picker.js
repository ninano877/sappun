(function installMobileDayPicker() {
  let sheet = null, origin = null, schedule = null, tripId = null;
  function createSheet() {
    sheet = document.createElement('dialog');
    sheet.className = 'mobile-day-picker';
    sheet.setAttribute('aria-labelledby','mobile-day-picker-title');
    document.body.append(sheet);
    sheet.addEventListener('close', () => {
      document.body.classList.remove('mobile-day-picker-open');
      origin?.setAttribute('aria-expanded','false');
      schedule = null;
    });
    sheet.addEventListener('click', event => {
      const choice = event.target.closest('[data-day-picker-value]');
      if (choice) {
        if (!homeOpen && currentTripId === tripId && schedule?.isConnected) selectMobileScheduleDay(Number(choice.dataset.dayPickerValue),schedule);
        sheet.close();
        return;
      }
      if (event.target.closest('[data-day-picker-close]')) { sheet.close(); return; }
      if (event.target === sheet) {
        const rect = sheet.getBoundingClientRect();
        if (event.clientY < rect.top || event.clientY > rect.bottom || event.clientX < rect.left || event.clientX > rect.right) sheet.close();
      }
    });
  }
  document.addEventListener('click',event => {
    const button = event.target.closest('[data-mobile-day-picker]');
    if (!button) return;
    event.preventDefault();
    if (!sheet) createSheet();
    origin = button;
    schedule = button.closest('.mobile-schedule');
    tripId = currentTripId;
    sheet.innerHTML = '<div class="day-picker-handle" aria-hidden="true"></div><div class="day-picker-heading"><div><h2 id="mobile-day-picker-title">날짜 선택</h2><p>총 '+state.days.length+'일의 여행</p></div><button type="button" data-day-picker-close aria-label="날짜 선택 닫기">×</button></div><div class="day-picker-list">'+state.days.map((_,d)=>'<button type="button" data-day-picker-value="'+d+'" aria-pressed="'+(d===day)+'"><span><b>Day '+(d+1)+'</b><small>'+esc(dateLabel(tripDate(d)))+'</small></span><span class="day-picker-check" aria-hidden="true">'+(d===day?'✓':'')+'</span></button>').join('')+'</div>';
    button.setAttribute('aria-expanded','true');
    document.body.classList.add('mobile-day-picker-open');
    sheet.showModal();
    const selected = sheet.querySelector('[aria-pressed="true"]');
    selected?.focus({preventScroll:true});
    selected?.scrollIntoView({block:'nearest'});
  });
})();
