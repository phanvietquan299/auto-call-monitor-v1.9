(/** Tác dụng: Khởi tạo module, đóng gói state nội bộ và đăng ký API/listener của thành phần này. */ () => {
  const safeSend = /** Tác dụng: Gửi message cho extension nếu runtime còn hoạt động; bỏ qua lỗi khi extension bị reload. */ (msg) => {
    try {
      if (!chrome?.runtime?.id) return;
      chrome.runtime.sendMessage(msg).catch(/** Tác dụng: Bỏ qua lỗi phụ của bước này để không ngắt luồng chính trong safeSend. */ () => {});
    } catch (_) {}
  };

  /** Tác dụng: Đọc giá trị số từ panel Grafana đã xác định trong DOM. */
  function readPanel(group) {
    const headers = [...document.querySelectorAll('h6[title], [data-testid*="Panel header"]')];
    const header = headers.find(/** Tác dụng: Tìm phần tử đầu tiên khớp điều kiện trong readPanel. */ el => {
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

  /** Tác dụng: Đọc các panel traffic Grafana theo nhóm và gửi mẫu tham khảo về background. */
  function sample() {
    const values = {};
    const a = readPanel("99.153");
    const b = readPanel("99.155");
    if (a !== null) values["99.153"] = a;
    if (b !== null) values["99.155"] = b;
    if (Object.keys(values).length) safeSend({type:"GRAFANA_SAMPLE", values});
  }

  sample();
  const timer = setInterval(/** Tác dụng: Chạy tác vụ lấy mẫu hoặc cập nhật theo chu kỳ. */ () => {
    if (!chrome?.runtime?.id) { clearInterval(timer); return; }
    sample();
  }, 2000);

  addEventListener("beforeunload", /** Tác dụng: Dừng timer lấy mẫu khi tab đang rời trang. */ () => {
    clearInterval(timer);
  }, {once:true});
})();