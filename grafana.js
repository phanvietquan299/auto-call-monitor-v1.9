(() => {
  const safeSend = (msg) => {
    try {
      if (!chrome?.runtime?.id) return;
      chrome.runtime.sendMessage(msg).catch(() => {});
    } catch (_) {}
  };

  function readPanel(group) {
    const headers = [...document.querySelectorAll('h6[title], [data-testid*="Panel header"]')];
    const header = headers.find(el => {
      const s = `${el.getAttribute("title") || ""} ${el.getAttribute("data-testid") || ""} ${el.textContent || ""}`;
      return s.includes(group) && s.includes("NOW");
    });
    if (!header) return null;
    const panel = header.closest(".react-grid-item") ||
      header.closest('[data-testid*="panel-content"]') ||
      header.parentElement?.parentElement;
    const gauge = panel?.querySelector(".flot-temp-elem, [class*='flot-temp']");
    if (!gauge) return null;
    const raw=(gauge.textContent || "").trim();
    if(!/\d/.test(raw))return null;
    const n = Number(raw.replace(/[^\d.-]/g, ""));
    return Number.isFinite(n) ? n : null;
  }

  function sample() {
    const values = {};
    const a = readPanel("99.153");
    const b = readPanel("99.155");
    if (a !== null) values["99.153"] = a;
    if (b !== null) values["99.155"] = b;
    if (Object.keys(values).length) safeSend({type:"GRAFANA_SAMPLE", values});
  }

  sample();
  const timer = setInterval(() => {
    if (!chrome?.runtime?.id) { clearInterval(timer); return; }
    sample();
  }, 2000);

  addEventListener("beforeunload", () => {
    clearInterval(timer);
  }, {once:true});
})();