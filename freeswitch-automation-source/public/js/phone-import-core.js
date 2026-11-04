/* Local XLSX reader and deterministic public-IP mapping. No uploads or formulas. */
(function(root){
  const targets=[
    ['FS01','115.84.183.10','10.10.101.176','COLLECTION'],
    ['FS02','125.212.211.239','10.10.101.170','COLLECTION'],
    ['FS03','203.113.174.24','10.10.101.184','COLLECTION'],
    ['OS01','115.84.183.24','10.10.99.140','COLLECTION'],
    ['FS04','210.211.110.186','10.10.101.180','COLLECTION'],
    ['FS05','203.113.174.31','10.10.101.58','TELESALE'],
    ['FS06','125.212.211.240','10.10.101.87','TELESALE'],
    ['FS07','125.212.211.241','10.10.101.88','TELESALE']
  ].map(([fs,publicIp,ip,profile])=>({fs,publicIp,ip,profile,group:profile==='COLLECTION'?'99.153':'99.155'}));
  const LIMIT=10000;
  /** Chuẩn hóa định danh điện thoại; chỉ thêm 0 cho đúng số 9 chữ số. */
  function phone(value){
    const raw=String(value??'').trim();
    const result=/^\d{9}$/.test(raw)?'0'+raw:raw;
    if(!/^0\d{9}$/.test(result))throw Error('Số phải có 9 chữ số hoặc 10 chữ số bắt đầu bằng 0');
    return result;
  }
  /** Gom đúng sheet coll/tls, giữ vị trí nguồn và chặn dữ liệu không map được. */
  function prepare(sheets,selectedSheet){
    if(!['coll','tls','both'].includes(selectedSheet))throw Error('Chọn COLL hoặc TLS trước khi đọc Excel');
    const batches=new Map(),seen=new Map(),errors=[];let duplicates=0,addedZero=0,total=0;
    for(const sheet of selectedSheet==='both'?['coll','tls']:[selectedSheet]){
      const profile=sheet==='coll'?'COLLECTION':'TELESALE';
      const matches=Object.keys(sheets).filter(key=>key.trim().toLowerCase()===sheet);
      if(matches.length!==1){errors.push(`Cần đúng một sheet ${sheet}`);continue;}
      for(const row of sheets[matches[0]]){
        const [value,publicIp]=row.values,ip=String(publicIp??'').trim(),raw=String(value??'').trim();
        if(!raw&&!ip)continue;
        if(row.row===1&&/^(sđt|sdt|phone|số điện thoại)$/iu.test(raw)&&/^(ip|ip public|public ip)$/i.test(ip))continue;
        if(++total>LIMIT){errors.push(`Tối đa ${LIMIT} dòng số mỗi lần`);break;}
        const location=`${sheet}!A${row.row}: `;
        try{
          const number=phone(value),target=targets.find(t=>t.publicIp===ip);
          if(!target)throw Error(`IP public chưa được map: ${ip||'(trống)'}`);
          if(target.profile!==profile)throw Error(`IP ${ip} thuộc ${target.profile}, không thuộc sheet ${sheet}`);
          if(seen.has(number)){
            if(seen.get(number)!==target.fs)throw Error('Cùng số được phân cho hai FS khác nhau');
            duplicates++;continue;
          }
          seen.set(number,target.fs);if(number!==raw)addedZero++;
          if(!batches.has(target.fs))batches.set(target.fs,{...target,phones:[]});
          batches.get(target.fs).phones.push(number);
        }catch(error){errors.push(location+error.message);}
      }
    }
    if(!total)errors.push('Không có số trong sheet đã chọn');
    return {selectedSheet,batches:[...batches.values()].sort((a,b)=>a.fs.localeCompare(b.fs)),total,duplicates,addedZero,errors};
  }
  /** Kiểm tra FS bằng cả tên, IP nội bộ, profile; không suy ra theo thứ tự dropdown. */
  function validateTarget(batch,nodes,scope){
    const canonical=targets.find(t=>t.fs===batch.fs);
    if(!canonical||['publicIp','ip','profile','group'].some(k=>canonical[k]!==batch[k]))throw Error('Mapping FS không hợp lệ');
    if(Array.isArray(scope?.[batch.group])&&!scope[batch.group].includes(batch.ip))throw Error(`${batch.fs} chưa được chọn quản lý trong Thêm node`);
    const rows=nodes.filter(n=>String(n.id)===batch.fs);
    if(rows.length!==1||rows[0].host!==batch.ip||rows[0].profile!==batch.profile)throw Error(`${batch.fs}: tên, IP nội bộ hoặc profile trên FreeSWITCH không khớp mapping`);
    return rows[0];
  }
  /** Không di chuyển hoặc tái kích hoạt số đã có; xung đột FS/profile chặn cả batch. */
  function pending(batch,numbers){
    return batch.phones.filter(number=>{
      const matches=numbers.filter(n=>String(n.phone)===number);
      if(matches.some(n=>String(n.node_id)!==batch.fs||n.profile!==batch.profile))throw Error(`${number} đã thuộc FS/profile khác; không nạp`);
      return !matches.length;
    });
  }
  /** Đọc ZIP có giới hạn kích thước, chỉ giải nén XML được workbook tham chiếu. */
  async function archive(buffer){
    if(buffer.byteLength>10*1024*1024)throw Error('File Excel vượt 10 MB');
    const bytes=new Uint8Array(buffer),view=new DataView(buffer),decoder=new TextDecoder();
    let end=-1;
    for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(view.getUint32(i,true)===0x06054b50){end=i;break;}
    if(end<0)throw Error('Không phải file XLSX hợp lệ');
    const count=view.getUint16(end+10,true),offset=view.getUint32(end+16,true),entries=new Map();
    if(count>2000||offset>=bytes.length)throw Error('Cấu trúc XLSX quá lớn hoặc không hợp lệ');
    let at=offset,total=0;
    for(let i=0;i<count;i++){
      if(at+46>bytes.length||view.getUint32(at,true)!==0x02014b50)throw Error('ZIP không hợp lệ');
      const nameLength=view.getUint16(at+28,true),extra=view.getUint16(at+30,true),comment=view.getUint16(at+32,true);
      const name=decoder.decode(bytes.subarray(at+46,at+46+nameLength));
      const entry={flags:view.getUint16(at+8,true),method:view.getUint16(at+10,true),crc:view.getUint32(at+16,true),size:view.getUint32(at+24,true),compressed:view.getUint32(at+20,true),offset:view.getUint32(at+42,true)};
      total+=entry.size;
      if(entry.size>20*1024*1024||total>60*1024*1024||entries.has(name))throw Error('XLSX quá lớn hoặc trùng entry');
      entries.set(name,entry);at+=46+nameLength+extra+comment;
    }
    const cache=new Map();
    return async name=>{
      if(cache.has(name))return cache.get(name);
      const e=entries.get(name);if(!e)throw Error('Thiếu thành phần XLSX: '+name);
      if(e.flags&1||![0,8].includes(e.method)||e.offset+30>bytes.length||view.getUint32(e.offset,true)!==0x04034b50)throw Error('XLSX mã hóa hoặc kiểu ZIP không hỗ trợ');
      const start=e.offset+30+view.getUint16(e.offset+26,true)+view.getUint16(e.offset+28,true);
      if(start+e.compressed>bytes.length)throw Error('ZIP bị cắt ngắn');
      const data=bytes.subarray(start,start+e.compressed);let result=data;
      if(e.method===8){
        const reader=new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader(),chunks=[];let size=0;
        while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>e.size){await reader.cancel();throw Error('ZIP vượt kích thước khai báo');}chunks.push(value);}
        result=new Uint8Array(size);let position=0;for(const chunk of chunks){result.set(chunk,position);position+=chunk.length;}
      }
      if(result.length!==e.size)throw Error('Kích thước ZIP không khớp');
      let crc=0xffffffff;for(const byte of result){crc^=byte;for(let n=0;n<8;n++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
      if(((crc^0xffffffff)>>>0)!==e.crc)throw Error('Checksum XLSX không khớp');
      const text=decoder.decode(result);
      if(/<!DOCTYPE|<!ENTITY/i.test(text))throw Error('XML chứa khai báo không hỗ trợ');
      const doc=new DOMParser().parseFromString(text,'application/xml');
      if(doc.querySelector('parsererror'))throw Error('XML Excel không hợp lệ');
      cache.set(name,doc);return doc;
    };
  }
  /** Đọc A/B của đúng coll/tls từ XLSX, hỗ trợ sharedStrings và inlineStr, không thực thi công thức. */
  async function readXlsx(buffer,selectedSheet){
    if(!['coll','tls','both'].includes(selectedSheet))throw Error('Chọn COLL hoặc TLS trước khi đọc Excel');
    const read=await archive(buffer),workbook=await read('xl/workbook.xml'),relationships=await read('xl/_rels/workbook.xml.rels');
    let strings;
    const sheets={};
    for(const sheet of workbook.getElementsByTagName('sheet')){
      const name=sheet.getAttribute('name');if(!(selectedSheet==='both'?['coll','tls']:[selectedSheet]).includes(name.trim().toLowerCase()))continue;
      const id=sheet.getAttribute('r:id'),matches=[...relationships.getElementsByTagName('Relationship')].filter(r=>r.getAttribute('Id')===id);
      if(matches.length!==1||matches[0].getAttribute('TargetMode')==='External')throw Error('Liên kết sheet không hợp lệ');
      const target=matches[0].getAttribute('Target'),url=new URL(target,'https://xlsx.invalid/xl/workbook.xml');
      if(url.origin!=='https://xlsx.invalid'||!url.pathname.startsWith('/xl/worksheets/'))throw Error('Đường dẫn sheet không hợp lệ');
      const xml=await read(url.pathname.slice(1)),rows=[];
      for(const row of xml.getElementsByTagName('row')){
        const values=[null,null];let used=false;
        for(const cell of row.getElementsByTagName('c')){
          const ref=cell.getAttribute('r')||'',column=/^([AB])\d+$/.exec(ref)?.[1];if(!column)continue;
          if(cell.getElementsByTagName('f').length)throw Error(`${name}!${ref}: cần giá trị số/IP, không dùng công thức`);
          const type=cell.getAttribute('t'),v=cell.getElementsByTagName('v')[0]?.textContent??'';let value=v;
          if(type==='s'){
            if(!strings){const shared=await read('xl/sharedStrings.xml');strings=[...shared.getElementsByTagName('si')].map(si=>[...si.getElementsByTagName('t')].map(t=>t.textContent).join(''));}
            if(!/^\d+$/.test(v)||strings[Number(v)]===undefined)throw Error('Shared string không hợp lệ');value=strings[Number(v)];
          }else if(type==='inlineStr')value=[...cell.getElementsByTagName('t')].map(t=>t.textContent).join('');
          else if(type==='e'||type==='b')throw Error(`${name}!${ref}: kiểu ô không hợp lệ`);
          else if(type!=='str'&&v){const number=Number(v);if(!Number.isSafeInteger(number)||number<0)throw Error(`${name}!${ref}: số không nguyên`);value=String(number);}
          values[column==='A'?0:1]=value;if(String(value).trim())used=true;
        }
        if(used)rows.push({row:Number(row.getAttribute('r')),values});
        if(rows.length>LIMIT)throw Error('Sheet vượt giới hạn số dòng');
      }
      if(Object.hasOwn(sheets,name))throw Error('Sheet trùng tên');sheets[name]=rows;
    }
    return prepare(sheets,selectedSheet);
  }
  const api={targets,phone,prepare,validateTarget,pending,readXlsx};
  if(typeof module!=='undefined')module.exports=api;else root.PhoneImport=api;
})(globalThis);
