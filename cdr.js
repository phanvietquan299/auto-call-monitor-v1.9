/* CDR evidence policy shared by the page adapter, worker and tests. */
(function(root){
  const IPS={FS01:'10.10.101.176',FS02:'10.10.101.170',FS03:'10.10.101.184',FS04:'10.10.101.180',FS05:'10.10.101.58',FS06:'10.10.101.87',FS07:'10.10.101.88',FS09:'10.10.101.89',FS10:'10.10.101.90'};
  function timestamp(value){
    const m=String(value||'').trim().match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})$/);
    if(!m)return NaN;const time=Date.parse(m[1]+'T'+m[2]+'+07:00');
    return Number.isFinite(time)&&new Date(time+7*3600000).toISOString().slice(0,19)===m[1]+'T'+m[2]?time:NaN;
  }
  function parseDocument(doc){
    const table=[...doc.querySelectorAll('table.ttable')].find(t=>[...t.querySelectorAll('th')].some(h=>h.textContent.trim()==='Sip Code'));
    if(!table)throw Error('Không tìm thấy bảng CDR; kiểm tra đăng nhập và CDR Viewer.');
    const heads=[...table.querySelectorAll('th')].filter(h=>!h.closest||h.closest('table')===table).map(x=>x.textContent.replace(/\s+/g,' ').trim().toLowerCase());
    const names=['time','method','sip call id','sip code','setup time','duration','destination'];
    const indexes=names.map(n=>heads.indexOf(n));
    if(indexes.some(i=>i<0))throw Error('Bảng CDR thiếu cột cần thiết.');
    return [...table.querySelectorAll('tr')].filter(r=>r.querySelectorAll('td').length>Math.max(...indexes)).map(r=>{
      const cells=[...r.querySelectorAll('td')],v=indexes.map(i=>cells[i].textContent.replace(/\s+/g,' ').trim());
      const numeric=x=>/^\d+$/.test(x)?Number(x):null;
      return {time:timestamp(v[0]),method:v[1],callId:v[2],sipCode:numeric(v[3]),setupTime:numeric(v[4]),duration:numeric(v[5]),ip:v[6]};
    });
  }
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
    if(!observation&&calls.some((r,i)=>i&&r.time>calls[i-1].time))return {locked:false,count:0,reason:'CDR không theo thứ tự mới nhất trước'};
    let count=0,hasZeroSetup=false;
    for(const r of calls){
      if(r.sipCode!==480||![0,1].includes(r.setupTime)||r.duration!==0)break;
      if(r.setupTime===0)hasZeroSetup=true;
      count++;
    }
    return {eligibleCount:calls.length,newestCallTime:calls[0]?.time||0,hasZeroSetup,observation,locked:count>=5,count:Math.min(count,5),consecutiveTotal:count,callIds:calls.slice(0,Math.min(count,5)).map(r=>r.callId),
      reason:count>=5?'5 cuộc mới nhất liên tiếp 480-0-0 hoặc 480-1-0':`CDR ${count}/5 cuộc liên tiếp 480-0-0 / 480-1-0`};
  }
  // Counts observed CDRs by their server timestamp, not by Search response time.
  function measureTraffic(records,previous,{ip,now}){
    const seen=new Map();
    for(const r of [...(previous?.observed||[]),...(records||[])]){
      if(r.ip!==ip||r.method!=='INVITE'||!r.callId||!Number.isFinite(r.time)||r.time<now-60000||r.time>now+2000)continue;
      seen.set(r.callId,{callId:r.callId,time:r.time,ip,method:'INVITE'});
    }
    const observed=[...seen.values()].sort((a,b)=>b.time-a.time).slice(0,2000),seconds=new Map();
    for(const r of observed){const second=Math.floor(r.time/1000)*1000;seconds.set(second,(seconds.get(second)||0)+1);}
    const buckets=[...seconds].sort((a,b)=>b[0]-a[0]).map(([time,count])=>({time,count}));
    return {observed,buckets,latest:buckets[0]||null,lowerBound:true};
  }
  function specialWarning(records,{ip,now,after=0,threshold=5}){
    const seen=new Set(),calls=[];
    for(const r of records||[]){
      if(r.ip!==ip||r.method!=='INVITE'||!r.callId||!Number.isFinite(r.time)||r.time<=after||r.time<now-30000||r.time>now+2000||seen.has(r.callId))continue;
      seen.add(r.callId);calls.push(r);
    }
    if(calls.some((r,i)=>i&&r.time>calls[i-1].time))return null;
    const first=calls[0];if(!first)return null;
    const pattern=`${first.sipCode}-${first.setupTime}-${first.duration}`;
    if(!['480-30-0','408-30-0','487-32-0'].includes(pattern))return null;
    let count=0;for(const r of calls){if(`${r.sipCode}-${r.setupTime}-${r.duration}`!==pattern)break;count++;}
    return count>=threshold?{pattern,count,callIds:calls.slice(0,threshold).map(r=>r.callId)}:null;
  }
  const api={IPS,timestamp,parseDocument,evaluate,measureTraffic,specialWarning};root.Cdr=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
