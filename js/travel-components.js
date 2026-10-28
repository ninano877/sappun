// 공통 화면 컴포넌트. 데이터 저장과 이벤트 처리는 travel-planner.js에서 담당합니다.
const TravelComponents = (() => {
  const escape = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (character) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
          character
        ],
    );

  function input(label, id, value = "", type = "text", attributes = "") {
    if (type === "time") return `<div class="time-entry"><label>${escape(label)}<input id="f-${escape(id)}" type="text" inputmode="numeric" placeholder="09:30" maxlength="5" pattern="(?:[01]?[0-9]|2[0-3]):[0-5][0-9]" value="${escape(value)}" autocomplete="off" ${attributes} /></label><button class="time-clear" type="button" data-time-target="f-${escape(id)}" data-time-value="" aria-label="${escape(label)} 지우기">지우기</button></div>`;
    return `<label>${escape(label)}<input id="f-${escape(id)}" type="${escape(type)}"
      value="${escape(value)}" ${attributes} /></label>`;
  }

  function select(label, id, options, selected) {
    return `<label>${escape(label)}<select id="f-${escape(id)}">${options
      .map((option) => {
        const { value, label: text } =
          typeof option === "string" ? { value: option, label: option } : option;
        return `<option value="${escape(value)}" ${value === selected ? "selected" : ""}>${escape(text)}</option>`;
      })
      .join("")}</select></label>`;
  }

  function currencyPicker(label, id, options, selected) {
    const current = options.find((option) => option.value === selected);
    const selectedLabel = current?.label || selected;
    return `<div class="currency-picker">
      <span class="currency-picker-label" id="currency-label-${escape(id)}">${escape(label)}</span>
      <input type="hidden" id="f-${escape(id)}" value="${escape(selected)}" />
      <input type="text" class="currency-picker-search" value="${escape(selectedLabel)}"
        data-selected-label="${escape(selectedLabel)}" placeholder="통화명 또는 코드 검색"
        role="combobox" aria-expanded="false" aria-controls="currency-options-${escape(id)}"
        aria-label="${escape(label)} 검색" autocomplete="off" />
        <div class="currency-picker-panel" hidden>
          <div id="currency-options-${escape(id)}" class="currency-picker-options" role="group" aria-label="통화 선택">
            ${options
              .map(
                ({ value, label: text }) => `<button type="button"
              class="currency-picker-option" data-currency-code="${escape(value)}"
              data-currency-label="${escape(text)}" aria-pressed="${value === selected}">
              <span class="currency-option-code">${escape(value)}</span>
              <span class="currency-option-name">${escape(text.replace(value + " · ", ""))}</span>
              <span class="currency-option-check" aria-hidden="true">✓</span>
            </button>`,
              )
              .join("")}
          </div>
          <p class="currency-picker-empty" role="status" hidden>검색 결과가 없어요. 다른 이름이나 코드를 입력해 주세요.</p>
        </div>
    </div>`;
  }

  function choices(label, id, values, selected) {
    return `<div class="button-field"><span>${escape(label)}</span><input type="hidden" id="f-${escape(id)}" value="${escape(selected)}" /><div class="choice-buttons">${values.map(option => {
      const value = typeof option === "string" ? option : option.value, text = typeof option === "string" ? option : option.label;
      return `<button type="button" data-value-target="f-${escape(id)}" data-value="${escape(value)}" class="${value === selected ? "chosen" : ""}" aria-pressed="${value === selected}">${escape(text)}</button>`;
    }).join("")}</div></div>`;
  }

  function dayDot(color) {
    return `<i class="day-dot" style="background:${escape(color)}"></i>`;
  }

  function stat(label, value, detail = "") {
    return `<div class="stat${label === "예산 초과" ? " is-over-budget" : ""}"><small>${escape(label)}</small>
      <strong>${escape(value)}</strong>${detail ? `<small>${escape(detail)}</small>` : ""}</div>`;
  }

  function progress(percent, exceeded) {
    return `<div class="progress${exceeded ? " is-over-budget" : ""}"><div style="width:${Math.max(0, Math.min(percent, 100))}%;background:${exceeded ? "#F04452" : "#3182F6"}"></div></div>`;
  }

  function mapButton(index, name, iconHtml) {
    return `<button class="place-map-button" data-mapjump="${index}"
      title="지도에서 보기" aria-label="${escape(name)} 지도에서 보기">${iconHtml}</button>`;
  }

  function stopCosts({ tagsHtml, amountHtml, card = false, emptyHtml = "" }) {
    if (!tagsHtml) return emptyHtml;
    return `<div class="stop-costs${card ? " card-costs" : ""}"><div class="currency-stack card-money">${amountHtml}</div><div class="expense-tags">${tagsHtml}</div></div>`;
  }

  function dragHandle(name) {
    return `<button type="button" class="schedule-drag-handle" draggable="false"
      aria-label="${escape(name)} 일정 순서 변경" aria-keyshortcuts="ArrowUp ArrowDown"
      title="끌어서 순서 변경 · 방향키로도 이동" aria-describedby="schedule-reorder-help">
      <svg width="16" height="20" viewBox="0 0 16 20" fill="currentColor" aria-hidden="true"><circle cx="5" cy="5" r="1.5"/><circle cx="11" cy="5" r="1.5"/><circle cx="5" cy="10" r="1.5"/><circle cx="11" cy="10" r="1.5"/><circle cx="5" cy="15" r="1.5"/><circle cx="11" cy="15" r="1.5"/></svg>
    </button>`;
  }
  function inlineTools({ start, note, hasNext, active = false }) {
    return `<div class="card-inline-tools" ${active ? "" : "hidden"}>
      <button type="button" data-stop-action="time">◷ ${start ? "시간 수정" : "시간 추가"}</button>
      <button type="button" data-stop-action="cost">₩ 비용 추가</button>
      <button type="button" data-stop-action="note">✎ ${note ? "메모 수정" : "메모 추가"}</button>
      ${hasNext ? '<button type="button" data-stop-action="move">↳ 이동 추가·수정</button>' : ""}
    </div>`;
  }
  function stopCard({ index, id, color, start, end, name, category = "", note, costsHtml, resourcesHtml = "", regions = [], hasNext = false, active = false }) {
    return `<article class="map-stop-card${active ? " is-editing" : ""}" data-card-index="${index}" data-stop-id="${escape(id)}" data-category="${escape(category)}" tabindex="0" role="button" aria-label="${escape(name)} 일정 선택" aria-expanded="${active}">
      <div class="stop-drag-rail">${dragHandle(name)}<span class="list-number" style="border-color:${escape(color)};color:${escape(color)}">${index + 1}</span></div>
      <div class="map-stop-content">
        <div class="stop-card-heading"><h3 data-stop-map tabindex="0" role="button" aria-label="${escape(name)} 지도에서 보기" title="지도에서 보기">${escape(name)}${regions.length ? `<span class="place-region">${escape(regions.join(" · "))}</span>` : ""}</h3>
          ${start ? `<span class="time">${escape(start)}${end ? "–" + escape(end) : ""}</span>` : ""}
          <div class="actions"><button type="button" data-placedetail="${index}">장소 상세</button><button type="button" data-delete="${index}">삭제</button></div>
        </div>
        ${note ? `<p class="note" title="${escape(note)}">${escape(note)}</p>` : ""}
        ${costsHtml}${resourcesHtml}<button type="button" class="mobile-place-map" data-card-map="${index}" aria-label="${escape(name)} 지도에서 보기">지도 보기 ↗</button>${inlineTools({start, note, hasNext, active})}
      </div></article>`;
  }

  function stopRow({ index, id, day, date, start, end, name, note, costsHtml, mapHtml, regions = [], hasNext = false, active = false }) {
    return `<tr class="table-place${active ? " is-editing" : ""}" data-card-index="${index}" data-stop-id="${escape(id)}" tabindex="0" role="button" aria-expanded="${active}"
      aria-label="${escape(name)} 장소 상세">
      <td><div class="table-drag-day">${dragHandle(name)}<span class="list-number">${index + 1}</span></div></td>
      <td class="table-time">${start ? escape(start) + (end ? "–" + escape(end) : "") : ""}</td>
      <td><b>${escape(name)}${regions.length ? `<span class="place-region">${escape(regions.join(" · "))}</span>` : ""}</b>${note ? `<small title="${escape(note)}">${escape(note)}</small>` : ""}${inlineTools({start, note, hasNext, active})}</td>
      <td>${costsHtml}</td><td>${mapHtml}</td></tr>`;
  }

  function scheduleTable(rowsHtml) {
    return `<div class="itinerary-table-wrap"><table class="itinerary-table list-table-v9">
      <thead><tr>${["순서", "시간", "장소명", "실제 지출", "지도"]
        .map((heading) => `<th>${heading}</th>`)
        .join("")}</tr></thead>
      <tbody>${rowsHtml || '<tr><td colspan="5" class="empty">장소를 추가해 주세요.</td></tr>'}</tbody>
    </table></div>`;
  }

  function dayGroup({ day, date, color, closed, list, toolsHtml, bodyHtml }) {
    return `<section class="day-group${list ? " list-day-v9" : ""}" data-group-day="${day}"
      style="--day-color:${escape(color)};--day-bg:${dayBackgrounds[day % dayBackgrounds.length]}">
      <div class="day-group-heading"><button class="day-fold" type="button"
        data-mapday="${day}" aria-label="Day ${day + 1} 지도 보기">
        ${dayDot(color)}<b>Day ${day + 1}</b><span>${escape(date)}</span>
        </button>
        <div class="tools"><button type="button" class="day-fold-toggle" data-dayfold="${day}" aria-expanded="${!closed}" aria-controls="day-content-${day}" aria-label="Day ${day + 1} 일정 ${closed ? "펼치기" : "접기"}">${closed ? "펼치기 ▾" : "접기 ▴"}</button>${toolsHtml}</div>
      </div><div id="day-content-${day}" class="day-group-content" ${closed ? "hidden" : ""}>${bodyHtml}</div>
    </section>`;
  }

  function expenseFields({
    entry,
    common,
    category,
    currency,
    categories,
    renderSelect,
  }) {
    return (
      input(
        common ? "항목 이름" : "무엇에 썼나요?",
        common ? "name" : "costname",
        entry?.name || "",
        "text",
        'required maxlength="150"',
      ) +
      renderSelect("카테고리", "spendcategory", categories, entry?.category || category) +
      (common
        ? '<input type="hidden" id="f-scope" value="전체" />'
        : "") +
      renderSelect("입력 통화", "currency", ["JPY", "KRW"], entry?.currency || currency) +
      input(
        common ? "실제 지출" : "실제 지출 금액",
        "actual",
        entry?.actual ?? "",
        "number",
        'required min="0" step="any"',
      )
    );
  }

  return {
    escape,
    input,
    select,
    choices,
    currencyPicker,
    dayDot,
    stat,
    progress,
    mapButton,
    stopCosts,
    stopCard,
    stopRow,
    dragHandle,
    inlineTools,
    scheduleTable,
    dayGroup,
    expenseFields,
  };
})();
