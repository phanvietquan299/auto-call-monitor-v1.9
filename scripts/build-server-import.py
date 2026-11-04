"""Package the extension's Excel policy/UI for the standalone FreeSWITCH server."""
from pathlib import Path
root=Path(__file__).resolve().parent.parent
out=root/'freeswitch-automation-source'
policy=(root/'src/core/phone-import.js').read_text()
(out/'lib/phone-import-policy.js').write_text(policy)
(out/'public/js/phone-import-core.js').write_text(policy)
ui=(root/'src/ui/dashboard-phone-import.js').read_text()
ui=ui.replace('chrome.runtime.sendMessage(message)','globalThis.ServerPhoneImport.send(message)')
ui=ui.replace('crypto.randomUUID()', 'globalThis.ServerPhoneImport.requestId()')
ui=ui.replace('<button id="open" type="button">Nạp số</button>','<button id="open" type="button" style="display:none">Import</button>')
ui=ui.replace(':host{display:inline-block;', ':host{display:contents;')
ui=ui.replace('Cần reload extension trên máy nguồn để cập nhật bảng xem trước.','Bảng xem trước không hợp lệ; chọn lại file.')
ui=ui.replace('đang chờ máy tính nạp và xác minh…','đang nạp và xác minh…')
ui=ui.replace('Kết quả đã được máy tính xác minh trên FreeSWITCH.','Kết quả đã được xác minh trong kho số server.')
ui=ui.replace('đã có trên đúng FS.', 'đã có trong kho số.')
# Inherit theme variables from the server shell, while keeping extension/PWA defaults intact.
ui=ui.replace('</style>',"""
:host{color:var(--fs-text,#19283b)}
dialog,#footer{background:var(--fs-surface,#fff);color:var(--fs-text,#19283b)}
.secondary,pre,#results>p{background:var(--fs-soft,#f2f5f8);color:var(--fs-text,#19283b)}
fieldset,th,td{border-color:var(--fs-border,#c9d6e3)}
input[type=checkbox]:not(:checked){background:var(--fs-surface,#fff);border-color:var(--fs-muted,#60758a)}
#completion,#results>p.success{background:var(--fs-success-bg,#e6f5eb);color:var(--fs-success,#125b31)}
#results>p.error{background:var(--fs-error-bg,#fff0f1);color:var(--fs-error,#a31524)}
#status.ok{color:var(--fs-success,#12683b)}#status.error{color:var(--fs-error,#a31524)}
.drop.over{background:var(--fs-hover,#e8f5fa)}
</style>""",1)
(out/'public/js/phone-import-ui.js').write_text(ui)
print('Server Excel policy/UI built from shared extension sources')
