/* Authenticated same-origin transport; Excel parsing stays in this browser. */
(function(){
  const openButton=document.getElementById('server-import-open');
  if(openButton)openButton.onclick=()=>document.getElementById('monitor-phone-import')?.shadowRoot?.getElementById('open')?.click();
  window.ServerPhoneImport = { requestId() {
    const bytes = new Uint8Array(16); crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  }, async send(message) {
    const routes = { PHONE_IMPORT_PREVIEW: '/api/numbers/import/preview', PHONE_IMPORT_EXECUTE: '/api/numbers/import/execute' };
    const url = routes[message.type];
    if (!url) throw Error('Lệnh nạp không hợp lệ');
    const response = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(message), signal: AbortSignal.timeout(30000) });
    const data = await response.json().catch(() => ({ error: 'Server từ chối yêu cầu · HTTP ' + response.status }));
    if (!response.ok) throw Error(data.error || 'Không kết nối được server');
    return data;
  } };
})();
