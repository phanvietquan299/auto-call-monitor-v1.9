/* CDR evidence policy shared by the page adapter, worker and tests. */
(/** Tác dụng: Khởi tạo module, đóng gói state nội bộ và đăng ký API/listener của thành phần này. */ function(root){
  const IPS={OS01:'10.10.99.140',FS01:'10.10.101.176',FS02:'10.10.101.170',FS03:'10.10.101.184',FS04:'10.10.101.180',FS05:'10.10.101.58',FS06:'10.10.101.87',FS07:'10.10.101.88',FS09:'10.10.101.89',FS10:'10.10.101.90'};
  /** Tác dụng: Đổi thời gian CDR theo UTC+7 thành timestamp và từ chối ngày giờ không hợp lệ. */
  function timestamp(value){
    const m=String(value||'').trim().match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})$/);
    if(!m)return NaN;const time=Date.parse(m[1]+'T'+m[2]+'+07:00');
    return Number.isFinite(time)&&new Date(time+7*3600000).toISOString().slice(0,19)===m[1]+'T'+m[2]?time:NaN;
  }
  /** Tác dụng: Nhận diện bảng CDR theo header và chuyển từng dòng thành bản ghi có kiểu dữ liệu rõ ràng. */
  function parseDocument(doc){
    const table=[...doc.querySelectorAll('table.ttable')].find(/** Tác dụng: Tìm phần tử đầu tiên khớp điều kiện trong parseDocument. */ t=>[...t.querySelectorAll('th')].some(/** Tác dụng: Kiểm tra có phần tử nào thỏa điều kiện trong parseDocument. */ h=>h.textContent.trim()==='Sip Code'));
    if(!table)throw Error('Không tìm thấy bảng CDR; kiểm tra đăng nhập và CDR Viewer.');
    const heads=[...table.querySelectorAll('th')].filter(/** Tác dụng: Giữ các phần tử thỏa điều kiện kiểm tra trong parseDocument. */ h=>!h.closest||h.closest('table')===table).map(/** Tác dụng: Chuyển từng phần tử sang cấu trúc kết quả cần dùng trong parseDocument. */ x=>x.textContent.replace(/\s+/g,' ').trim().toLowerCase());
    const names=['time','method','sip call id','sip code','setup time','duration','destination'];
    const indexes=names.map(/** Tác dụng: Chuyển từng phần tử sang cấu trúc kết quả cần dùng trong parseDocument. */ n=>heads.indexOf(n));
    if(indexes.some(/** Tác dụng: Kiểm tra có phần tử nào thỏa điều kiện trong parseDocument. */ i=>i<0))throw Error('Bảng CDR thiếu cột cần thiết.');
    return [...table.querySelectorAll('tr')].filter(/** Tác dụng: Giữ các phần tử thỏa điều kiện kiểm tra trong parseDocument. */ r=>r.querySelectorAll('td').length>Math.max(...indexes)).map(/** Tác dụng: Chuyển từng phần tử sang cấu trúc kết quả cần dùng trong parseDocument. */ r=>{
      const cells=[...r.querySelectorAll('td')],v=indexes.map(/** Tác dụng: Chuyển từng phần tử sang cấu trúc kết quả cần dùng trong parseDocument. */ i=>cells[i].textContent.replace(/\s+/g,' ').trim());
      const numeric=/** Tác dụng: Chỉ chuyển chuỗi số nguyên không âm hợp lệ thành number; trả null cho giá trị khác. */ x=>/^\d+$/.test(x)?Number(x):null;
      return {time:timestamp(v[0]),method:v[1],callId:v[2],sipCode:numeric(v[3]),setupTime:numeric(v[4]),duration:numeric(v[5]),ip:v[6]};
    });
  }
  /** Tác dụng: Lọc CDR theo IP/INVITE, thời gian và Call ID; xác định chuỗi lỗi mới nhất 480-0/1-0 đủ 5 cuộc. */
  function evaluate(records,{ip,after,now,usedCallIds=[],observation=false}){
    const seen=new Set(),used=new Set(usedCallIds),calls=[];
    for(const r of records||[]){
      if(r.ip!==ip||r.method!=='INVITE')continue;
      if((!observation&&!Number.isFinite(r.time))||!r.callId)return {locked:false,count:0,reason:'CDR thiếu thời gian hoặc Call ID hợp lệ'};
      if(!observation&&r.time>now+2000)return {locked:false,count:0,reason:'Thời gian CDR lệch về tương lai'};
      if(seen.has(r.callId))continue;seen.add(r.callId);
      if(!observation&&(r.time<=after||r.time<now-30000||used.has(r.callId)))continue;
      calls.push(r);
    }
    // Preserve server order within the same second. Reject reversed order.
    if(!observation&&calls.some(/** Tác dụng: Kiểm tra có phần tử nào thỏa điều kiện trong evaluate. */ (r,i)=>i&&r.time>calls[i-1].time))return {locked:false,count:0,reason:'CDR không theo thứ tự mới nhất trước'};
    let count=0,hasZeroSetup=false;
    for(const r of calls){
      if(r.sipCode!==480||![0,1].includes(r.setupTime)||r.duration!==0)break;
      if(r.setupTime===0)hasZeroSetup=true;
      count++;
    }
    return {eligibleCount:calls.length,newestCallTime:calls[0]?.time||0,hasZeroSetup,observation,locked:count>=5,count:Math.min(count,5),consecutiveTotal:count,callIds:calls.slice(0,Math.min(count,5)).map(/** Tác dụng: Chuyển từng phần tử sang cấu trúc kết quả cần dùng trong evaluate. */ r=>r.callId),
      reason:count>=5?'5 cuộc mới nhất liên tiếp 480-0-0 hoặc 480-1-0':`CDR ${count}/5 cuộc liên tiếp 480-0-0 / 480-1-0`};
  }
  // Counts observed CDRs by their server timestamp, not by Search response time.
  /** Tác dụng: Khử trùng Call ID trong 60 giây và gom theo giây; kết quả là lượng cuộc gọi đã quan sát được. */
  function measureTraffic(records,previous,{ip,now}){
    const seen=new Map();
    for(const r of [...(previous?.observed||[]),...(records||[])]){
      if(r.ip!==ip||r.method!=='INVITE'||!r.callId||!Number.isFinite(r.time)||r.time<now-60000||r.time>now+2000)continue;
      seen.set(r.callId,{callId:r.callId,time:r.time,ip,method:'INVITE'});
    }
    const observed=[...seen.values()].sort(/** Tác dụng: So sánh hai phần tử để xác định thứ tự ưu tiên trong measureTraffic. */ (a,b)=>b.time-a.time).slice(0,2000),seconds=new Map();
    for(const r of observed){const second=Math.floor(r.time/1000)*1000;seconds.set(second,(seconds.get(second)||0)+1);}
    const buckets=[...seconds].sort(/** Tác dụng: So sánh hai phần tử để xác định thứ tự ưu tiên trong measureTraffic. */ (a,b)=>b[0]-a[0]).map(/** Tác dụng: Chuyển từng phần tử sang cấu trúc kết quả cần dùng trong measureTraffic. */ ([time,count])=>({time,count}));
    return {observed,buckets,latest:buckets[0]||null,lowerBound:true};
  }
  /** Tác dụng: Phát hiện chuỗi CDR mới cùng mẫu lỗi đặc biệt để cảnh báo, không tự đổi trạng thái số. */
  function specialWarning(records,{ip,now,after=0,threshold=5}){
    const seen=new Set(),calls=[];
    for(const r of records||[]){
      if(r.ip!==ip||r.method!=='INVITE'||!r.callId||!Number.isFinite(r.time)||r.time<=after||r.time<now-30000||r.time>now+2000||seen.has(r.callId))continue;
      seen.add(r.callId);calls.push(r);
    }
    if(calls.some(/** Tác dụng: Kiểm tra có phần tử nào thỏa điều kiện trong specialWarning. */ (r,i)=>i&&r.time>calls[i-1].time))return null;
    const first=calls[0];if(!first)return null;
    const pattern=`${first.sipCode}-${first.setupTime}-${first.duration}`;
    if(!['480-30-0','408-30-0','487-32-0'].includes(pattern))return null;
    let count=0;for(const r of calls){if(`${r.sipCode}-${r.setupTime}-${r.duration}`!==pattern)break;count++;}
    return count>=threshold?{pattern,count,callIds:calls.slice(0,threshold).map(/** Tác dụng: Chuyển từng phần tử sang cấu trúc kết quả cần dùng trong specialWarning. */ r=>r.callId)}:null;
  }
  const api={IPS,timestamp,parseDocument,evaluate,measureTraffic,specialWarning};root.Cdr=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
