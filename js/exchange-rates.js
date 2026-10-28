// 원화 기준 시세를 하루 동안 캐시하고, 선택한 통화 1단위의 원화 환율로 변환합니다.
const ExchangeRates = (() => {
  const cacheKey = "sappun-exchange-rates";
  let pending;

  async function latest() {
    let cached;
    try {
      cached = JSON.parse(localStorage.getItem(cacheKey));
      if (cached?.rates?.KRW === 1 && Date.now() < cached.expiresAt) return cached;
    } catch {}
    if (!pending) {
      pending = (async () => {
        try {
          const response = await fetch("https://open.er-api.com/v6/latest/KRW", {
            signal: AbortSignal.timeout(10000),
          });
          if (!response.ok) throw Error("환율 조회 실패");
          const data = await response.json();
          if (
            data.result !== "success" ||
            data.base_code !== "KRW" ||
            data.rates?.KRW !== 1
          )
            throw Error("환율 응답 오류");
          const result = {
            rates: data.rates,
            updatedAt: data.time_last_update_unix * 1000,
            expiresAt: Date.now() + 24 * 60 * 60 * 1000,
          };
          try {
            localStorage.setItem(cacheKey, JSON.stringify(result));
          } catch {}
          return result;
        } catch (error) {
          if (cached?.rates?.KRW === 1) return { ...cached, stale: true };
          throw error;
        } finally {
          pending = null;
        }
      })();
    }
    return pending;
  }

  async function prefill(code, input, status, preserveSaved) {
    if (!input || code === "KRW") return;
    let edited = false;
    const onEdit = () => {
      edited = true;
    };
    input.addEventListener("input", onEdit);
    status.textContent = preserveSaved
      ? "저장한 환율을 사용하고 있어요."
      : "최근 환율을 불러오는 중…";
    try {
      const data = await latest();
      if (!input.isConnected || edited) return;
      const rate = 1 / data.rates[code];
      if (!Number.isFinite(rate) || rate <= 0) throw Error("지원하지 않는 통화");
      if (!preserveSaved) input.value = Number(rate.toPrecision(8));
      const date = new Date(data.updatedAt).toLocaleDateString("ko-KR", {
        timeZone: "Asia/Seoul",
      });
      status.textContent = preserveSaved
        ? "저장한 환율 · 직접 수정할 수 있어요."
        : `${date} ${data.stale ? "마지막 저장" : "기준"} 환율 · 직접 수정할 수 있어요.`;
    } catch {
      if (input.isConnected && !edited)
        status.textContent = input.value
          ? "자동 조회가 안 되어 기존 환율을 표시해요. 직접 수정할 수 있어요."
          : "자동 조회가 안 되는 통화예요. 환율을 직접 입력해 주세요.";
    } finally {
      input.removeEventListener("input", onEdit);
    }
  }

  return { prefill };
})();
