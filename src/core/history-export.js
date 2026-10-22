/* Local XLSX export: no CDN, credentials, formulas, or network uploads. */
(function(root){
 const labels={AUTO_BLOCKED:'Đã chuyển BLOCKED',MANUAL_SWITCH:'Đã đổi số tay',BLOCKED_OBSERVED:'Đã xác minh BLOCKED',FS_TRANSFERRED:'Đã chuyển FS',FS_ENABLED:'Đã bật FS',FS_DISABLED:'Đã tắt FS',MANUAL_FS_STATUS:'Đổi trạng thái tay'};
 const blockTypes=new Set(['AUTO_BLOCKED','MANUAL_SWITCH','BLOCKED_OBSERVED']);
 const vnDate=at=>new Date(at+25200000).toISOString().slice(0,10);
 function records(events,date){
  const seen=new Set();
  return [...events].filter(e=>labels[e.type]&&e.fs&&Number.isFinite(e.at)&&(!date||vnDate(e.at)===date)).sort((a,b)=>a.at-b.at).filter(e=>{
   if(e.type==='MANUAL_FS_STATUS'&&/→ BLOCKED/.test(e.detail||'')&&events.some(x=>blockTypes.has(x.type)&&x.fs===e.fs&&x.group===e.group&&x.phone===e.phone&&Math.abs(x.at-e.at)<=5000))return false;
   const key=e.incidentId?`${e.group}|${e.fs}|${e.incidentId}`:`${e.type}|${e.group}|${e.fs}|${e.phone||''}|${e.at}`;
   if(seen.has(key))return false;seen.add(key);return true;
  });
 }
 const xml=s=>String(s??'').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
 function sheet(rows){return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="8" customWidth="1"/><col min="2" max="3" width="16" customWidth="1"/><col min="4" max="7" width="25" customWidth="1"/><col min="8" max="14" width="32" customWidth="1"/></cols><sheetData>'+rows.map((row,i)=>'<row r="'+(i+1)+'">'+row.map((value,j)=>{
  let col='',n=j+1;while(n){n--;col=String.fromCharCode(65+n%26)+col;n=Math.floor(n/26);}
  const ref=col+(i+1);return typeof value==='number'&&Number.isFinite(value)?`<c r="${ref}"><v>${value}</v></c>`:`<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
 }).join('')+'</row>').join('')+'</sheetData></worksheet>';}
 function zip(files){
  const encoder=new TextEncoder(),parts=[],central=[];let offset=0;
  const crc=bytes=>{let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;};
  for(const [name,text] of Object.entries(files)){
   const path=encoder.encode(name),data=encoder.encode(text),sum=crc(data);
   const local=new Uint8Array(30+path.length),v=new DataView(local.buffer);v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(10,0,true);v.setUint16(12,33,true);v.setUint32(14,sum,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,path.length,true);local.set(path,30);
   const head=new Uint8Array(46+path.length),h=new DataView(head.buffer);h.setUint32(0,0x02014b50,true);h.setUint16(4,20,true);h.setUint16(6,20,true);h.setUint16(14,33,true);h.setUint32(16,sum,true);h.setUint32(20,data.length,true);h.setUint32(24,data.length,true);h.setUint16(28,path.length,true);h.setUint32(42,offset,true);head.set(path,46);
   parts.push(local,data);central.push(head);offset+=local.length+data.length;
  }
  const size=central.reduce((n,b)=>n+b.length,0),end=new Uint8Array(22),v=new DataView(end.buffer);v.setUint32(0,0x06054b50,true);v.setUint16(8,central.length,true);v.setUint16(10,central.length,true);v.setUint32(12,size,true);v.setUint32(16,offset,true);
  const all=[...parts,...central,end],out=new Uint8Array(all.reduce((n,b)=>n+b.length,0));let at=0;for(const b of all){out.set(b,at);at+=b.length;}return out;
 }
 function workbook(events,date){
  const logs=records(events,date),rows=[['STT','Ngày (VN)','Giờ (VN)','Nhóm','FS','Số điện thoại','Kết quả','Dự phòng','FS đích','VT','Baseline','Mã sự cố','Chi tiết']];
  const counts=new Map();
  logs.forEach((e,i)=>{
   const local=new Date(e.at+25200000).toISOString();rows.push([i+1,local.slice(0,10).split('-').reverse().join('/'),local.slice(11,19),e.group==='99.153'?'Collection':e.group==='99.155'?'Sale':e.group||'',e.fs,String(e.phone||''),labels[e.type],e.isBackup?'Có':'',e.targetFs||'',e.currentVt??e.recentMedian??'',e.baselineVt??'',e.incidentId||'',e.detail||'']);
   const key=(e.group||'')+'|'+e.fs;const c=counts.get(key)||{group:e.group==='99.153'?'Collection':'Sale',fs:e.fs,blocks:0,backup:0,fsChanges:0};
   if(blockTypes.has(e.type)||e.type==='MANUAL_FS_STATUS'&&/→ BLOCKED/.test(e.detail||'')){c.blocks++;if(e.isBackup)c.backup++;}else c.fsChanges++;counts.set(key,c);
  });
  const summary=[['Ngày xuất','FS','Nhóm','Số lượt BLOCK','Trong đó dự phòng','Thao tác khác'],...[...counts.values()].map(c=>[date||'Tất cả',c.fs,c.group,c.blocks,c.backup,c.fsChanges])];
  const ns='http://schemas.openxmlformats.org/';
  return {count:logs.length,bytes:zip({
   '[Content_Types].xml':`<Types xmlns="${ns}package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
   '_rels/.rels':`<Relationships xmlns="${ns}package/2006/relationships"><Relationship Id="rId1" Type="${ns}officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
   'xl/workbook.xml':`<workbook xmlns="${ns}spreadsheetml/2006/main" xmlns:r="${ns}officeDocument/2006/relationships"><sheets><sheet name="Lịch sử" sheetId="1" r:id="rId1"/><sheet name="Thống kê" sheetId="2" r:id="rId2"/></sheets></workbook>`,
   'xl/_rels/workbook.xml.rels':`<Relationships xmlns="${ns}package/2006/relationships"><Relationship Id="rId1" Type="${ns}officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${ns}officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`,
   'xl/worksheets/sheet1.xml':sheet(rows),'xl/worksheets/sheet2.xml':sheet(summary)
  })};
 }
 const api={records,workbook};if(typeof module!=='undefined')module.exports=api;else root.HistoryExport=api;
})(globalThis);
