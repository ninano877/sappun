// 선택란을 누르면 같은 입력란에서 통화를 검색합니다.
(() => {
  const options = (picker) => [...picker.querySelectorAll("[data-currency-code]")];
  function filter(picker, query) {
    const keyword = query.trim().toLocaleLowerCase();
    let count = 0;
    options(picker).forEach((button) => {
      button.hidden = !button.dataset.currencyLabel.toLocaleLowerCase().includes(keyword);
      if (!button.hidden) count++;
    });
    picker.querySelector(".currency-picker-empty").hidden = count > 0;
  }
  function close(picker) {
    const search = picker.querySelector(".currency-picker-search");
    search.value = search.dataset.selectedLabel;
    search.setAttribute("aria-expanded", "false");
    picker.querySelector(".currency-picker-panel").hidden = true;
  }
  document.addEventListener("focusin", (event) => {
    if (!event.target.matches(".currency-picker-search")) return;
    const picker = event.target.closest(".currency-picker");
    if (event.target.getAttribute("aria-expanded") === "true") return;
    event.target.value = "";
    event.target.setAttribute("aria-expanded", "true");
    picker.querySelector(".currency-picker-panel").hidden = false;
    filter(picker, "");
    picker.querySelector(".currency-picker-options").scrollTop = 0;
  });
  document.addEventListener("input", (event) => {
    if (event.target.matches(".currency-picker-search"))
      filter(event.target.closest(".currency-picker"), event.target.value);
  });
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-currency-code]");
    if (button) {
      const picker = button.closest(".currency-picker");
      const field = picker.querySelector('input[type="hidden"]');
      const search = picker.querySelector(".currency-picker-search");
      field.value = button.dataset.currencyCode;
      search.dataset.selectedLabel = button.dataset.currencyLabel;
      options(picker).forEach((option) =>
        option.setAttribute("aria-pressed", String(option === button)),
      );
      search.focus();
      close(picker);
      field.dispatchEvent(new Event("change", { bubbles: true }));
    }
    document.querySelectorAll(".currency-picker").forEach((picker) => {
      if (!picker.contains(event.target)) close(picker);
    });
  });
  document.addEventListener("focusout", (event) => {
    const picker = event.target.closest(".currency-picker");
    if (picker && !picker.contains(event.relatedTarget)) close(picker);
  });
  document.addEventListener("keydown", (event) => {
    const picker = event.target.closest(".currency-picker");
    if (!picker) return;
    const search = picker.querySelector(".currency-picker-search");
    if (search.getAttribute("aria-expanded") !== "true") {
      if (event.key === "ArrowDown" || event.key === "Enter") {
        event.preventDefault();
        search.value = "";
        search.setAttribute("aria-expanded", "true");
        picker.querySelector(".currency-picker-panel").hidden = false;
        filter(picker, "");
      }
      return;
    }
    const visible = options(picker).filter((option) => !option.hidden);
    const index = visible.indexOf(document.activeElement);
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      search.focus();
      close(picker);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next =
        event.key === "ArrowDown"
          ? index + 1
          : index < 0
            ? visible.length - 1
            : index - 1;
      visible[Math.max(0, Math.min(next, visible.length - 1))]?.focus();
    } else if (event.key === "Enter" && event.target === search) {
      event.preventDefault();
      visible[0]?.click();
    }
  });
})();
