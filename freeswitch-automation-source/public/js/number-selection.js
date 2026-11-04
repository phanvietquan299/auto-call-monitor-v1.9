/* Selection is scoped to the visible filter and never used by the separate Delete by filter action. */
(function(){
  window.NumberSelection = { create({ onDeleted, request = fetch, confirmDelete = text => window.confirm(text) }) {
    const selected = new Map();let visible = [], filterKey, busy = false;
    const body = document.getElementById('numbers-tbody'), all = document.getElementById('select-all-numbers');
    const remove = document.getElementById('delete-selected-numbers'), clear = document.getElementById('clear-number-selection'), status = document.getElementById('number-selection-status');
    const identity = row => JSON.stringify([row.id,row.phone,row.node_id,row.profile,row.status]);
    function notice(text, error = false) { status.textContent = text;status.className = error ? 'text-xs text-red-600' : 'text-xs text-emerald-700'; }
    const actions = document.getElementById('number-selection-actions'), anchor = document.getElementById('number-selection-anchor');
    function positionActions() {
      if (!actions || !anchor) return;
      const floating = (selected.size > 0 || busy) && anchor.getBoundingClientRect().bottom <= 0;
      actions.style.cssText = floating
        ? 'display:flex;position:fixed;bottom:max(16px,env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);z-index:30;width:max-content;max-width:calc(100vw - 24px);align-items:center;justify-content:center;flex-wrap:wrap;gap:8px;padding:12px;background:white;border:1px solid #e2e8f0;border-radius:14px;box-shadow:0 8px 30px #0003'
        : 'display:flex;align-items:center;flex-wrap:wrap;gap:8px';
      const spacer = document.getElementById('number-selection-spacer');
      if (spacer) spacer.style.display = floating ? 'block' : 'none';
    }
    if (anchor) {
      window.addEventListener('scroll', positionActions, {passive:true, capture:true});
      window.addEventListener('resize', positionActions, {passive:true});
    }
    function update() {
      document.getElementById('number-selection-count').textContent = selected.size;
      positionActions();
      remove.disabled = busy || !selected.size;clear.disabled = busy || !selected.size;
      all.disabled = busy || !visible.length;all.checked = !!visible.length && selected.size === visible.length;all.indeterminate = selected.size > 0 && selected.size < visible.length;
      for (const input of body.querySelectorAll('[data-number-select]')) { const id = Number(input.dataset.numberSelect);input.checked = selected.has(id);input.disabled = busy; }
    }
    body.addEventListener('change', event => {
      const input = event.target.closest('[data-number-select]');if (!input || busy) return;
      const row = visible.find(n => n.id === Number(input.dataset.numberSelect));if (!row) return;
      if (input.checked) selected.set(row.id, identity(row));else selected.delete(row.id);
      notice('');update();
    });
    all.onchange = () => { if (busy) return;selected.clear();if (all.checked) for (const row of visible) selected.set(row.id, identity(row));notice('');update(); };
    clear.onclick = () => { if (!busy) { selected.clear();notice('');update(); } };
    remove.onclick = async () => {
      if (busy || !selected.size) return;
      const ids = [...selected.keys()], active = visible.filter(n => selected.has(n.id) && n.status === 'ACTIVE').length;
      if (!confirmDelete(`Xóa ${ids.length} số đã chọn${active ? ' (gồm '+active+' số ACTIVE)' : ''}? Chỉ xóa khỏi kho dữ liệu, không đổi số trên FS.`)) return;
      busy = true;update();notice('Đang xóa số đã chọn…');
      try {
        const response = await request('/api/numbers/delete-selected', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ ids }) });
        const result = await response.json();if (!response.ok || !result.success) throw Error(result.error || 'Không xóa được số đã chọn');
        selected.clear();notice(`Đã xóa ${result.deleted} số${result.missing ? '; '+result.missing+' số không còn trong kho' : ''}.`);
        try { await onDeleted(); } catch (_) { notice(`Đã xóa ${result.deleted} số; tải lại trang để cập nhật bảng.`); }
      } catch (error) { notice(error.message, true); }
      finally { busy = false;update(); }
    };
    return { render(rows, key) {
      if (filterKey !== key) selected.clear();filterKey = key;
      visible = rows.filter(n => Number.isSafeInteger(n.id) && n.id > 0);
      for (const [id, snapshot] of selected) if (!visible.some(n => n.id === id && identity(n) === snapshot)) selected.delete(id);
      update();
    } };
  } };
})();
