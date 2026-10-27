/* Remote commands pass through the same validated handlers as dashboard actions. */
(()=>{
 const config=globalThis.SupabaseHistoryConfig;if(!config?.historyToken)return;
 const allowed=new Set(['MANUAL_FS_STATUS','DISMISS_CDR_WARNING','SET_MONITORING','SET_AUTO','SET_AUTO_BLOCK_MODE','CONFIRM_AUTO_BLOCK','CANCEL_AUTO_BLOCK','RECHECK_AUTO_BLOCK','ACK_MANUAL_AFTER_FAILURE','REPORT_MANUAL_SWAP','CLEAR_HISTORY','FS_SWITCH_SETTINGS','FS_SWITCH_THRESHOLD','FS_SWITCH_PRESET','FS_SWITCH_RELOAD','FS_SWITCH_TOGGLE_NODE','FS_SWITCH_CONFIRM','FS_SWITCH_RELEASE']);
 let busy=false,lastNoticeAt=0,publishing=false,devicePromise;
 let lastSyncError='',lastPublishedAt=0;
 function remoteUrl(){
  if(typeof config.anonKey!=='string'||!config.anonKey.trim())throw Error('Thiếu public API key Supabase; kiểm tra config/supabase-config.js');
  const url=new URL(config.url+'/rest/v1/rpc/call_monitor_remote');
  // Public anon key fallback for gateways that omit custom request headers.
  url.searchParams.set('apikey',config.anonKey);return url.href;
 }
 async function syncError(response){const details=await response.json().catch(()=>({}));throw Error(details.message||'Supabase HTTP '+response.status);}
 async function health(error){lastSyncError=error?String(error.message||error):'';if(!error)lastPublishedAt=Date.now();await chrome.storage.local.set({remoteSync:{error:lastSyncError,lastPublishedAt,at:Date.now()}});}
 async function request(body){
  const r=await fetch(config.url+'/functions/v1/telegram-control/device',{method:'POST',headers:{apikey:config.anonKey,Authorization:'Bearer '+config.historyToken,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw Error('Telegram bridge HTTP '+r.status);const data=await r.json();if(data.ok===false)throw Error('Telegram bridge failed');return data;
 }
 function snapshot(s,feature){
  feature={enabled:false,mode:'MANUAL',backupThreshold:10,...feature};
  const at=Date.now(),candidates=FsSwitch.plans(s,feature,at).map(p=>({...p,identity:FsSwitch.identity(p)}));
  const dashboard={nodeDisplay:s.nodeDisplay,collectionEvening:s.collectionEvening,importantFailures:s.importantFailures,fsSwitchOperation:feature.operation,monitoringEnabled:s.monitoringEnabled,autoEnabled:s.autoEnabled,autoBlockMode:s.autoBlockMode,config:s.config,opensips:s.opensips,grafana:s.grafana,pendingAutoActions:s.pendingAutoActions,alerts:s.alerts,processingStatus:s.processingStatus,schedule:s.schedule,fsSwitchEnabled:feature.enabled,freeswitch:{nodeMappings:s.freeswitch?.nodeMappings,displayNumbers:s.freeswitch?.displayNumbers,backupCounts:s.freeswitch?.backupCounts,updatedAt:s.freeswitch?.updatedAt,numbers:(s.freeswitch?.numbers||[]).filter(n=>n.status==='ACTIVE').map(n=>({fs:n.fs,profile:n.profile,phone:n.phone,status:n.status,hasStatusControl:n.hasStatusControl}))},fsStates:Object.fromEntries(Object.entries(s.fsStates||{}).map(([key,f])=>[key,{...f,history:[],cdrUsedCallIds:undefined,cdr:f.cdr?{...f.cdr,traffic:undefined,records:(f.cdr.records||[]).slice(0,3)}:null}])),cdrWarnings:(s.cdrWarnings||[]).filter(w=>at-w.at<15000),events:[]};
  return {capturedAt:at,dashboard,monitoring:s.monitoringEnabled,auto:s.autoEnabled,blockMode:s.autoBlockMode,feature:{enabled:feature.enabled,mode:feature.mode,backupThreshold:feature.backupThreshold,nextSwitch:feature.nextSwitch,operation:feature.operation,history:[]},pending:s.pendingAutoActions||[],candidates,
   fs:Object.values(s.fsStates||{}).filter(f=>f.fs==='OS01'||Number(f.fs?.slice(2))<=7).map(f=>({fs:f.fs,key:f.key,group:f.group,groupId:f.groupId,vt:f.currentVt,state:f.state,baseline:f.baseline,drop:f.dropPercent,cdrCount:f.cdr?.decision?.count,records:(f.cdr?.records||[]).slice(0,3).map(r=>`${r.sipCode}-${r.setupTime}-${r.duration}`),backups:s.freeswitch?.backupCounts?.[f.fs]?.count,incidentId:f.incident?.id})),
   schedule:s.schedule?.groups||{},alerts:s.alerts||[],warnings:(s.cdrWarnings||[]).filter(w=>at-w.at<15000),events:(s.events||[]).filter(e=>['AUTO_BLOCKED','MANUAL_SWITCH','BLOCKED_OBSERVED','FS_TRANSFERRED','FS_ENABLED','FS_DISABLED'].includes(e.type)&&at-e.at<30000).slice(0,8)};
 }
 async function complete(bridge){
  const ack=bridge.ack;if(!ack)return;
  const response=await fetch(remoteUrl(),{method:'POST',headers:{apikey:config.anonKey,Authorization:'Bearer '+config.anonKey,'Content-Type':'application/json'},body:JSON.stringify({p_token:config.historyToken,p_action:'complete',p_payload:{...ack,device:bridge.device}}),signal:AbortSignal.timeout(30000)});
  if(!response.ok)await syncError(response);
  request({action:'result-notify',device:bridge.device,id:ack.id}).catch(()=>{});
  delete bridge.ack;
 }
 async function dispatch(command){
  if(!allowed.has(command?.type))return {ok:false,error:'Lệnh Telegram không được hỗ trợ'};
  if(command.type.startsWith('FS_SWITCH_'))return new Promise(resolve=>{messageQueue=messageQueue.then(async()=>resolve(await processSwitch(command))).catch(error=>resolve({ok:false,error:String(error.message||error)}));});
  return new Promise(resolve=>handleMainMessage(command,{},resolve));
 }
 function device(){
  if(!devicePromise)devicePromise=chrome.storage.local.get('telegramBridge').then(async stored=>{if(stored.telegramBridge?.device)return stored.telegramBridge.device;const id=crypto.randomUUID();await chrome.storage.local.set({telegramBridge:{device:id}});return id;}).catch(error=>{devicePromise=null;throw error;});
  return devicePromise;
 }
 async function publish(){
  if(publishing)return;publishing=true;
  try{
   const id=await device(),s=await getState(),feature=await rotationFeature(),data=snapshot(s,feature);
   const response=await fetch(remoteUrl(),{method:'POST',headers:{apikey:config.anonKey,Authorization:'Bearer '+config.anonKey,'Content-Type':'application/json'},body:JSON.stringify({p_token:config.historyToken,p_action:'publish',p_payload:{device:id,snapshot:data}}),signal:AbortSignal.timeout(30000)});
   if(!response.ok)await syncError(response);await health(null);
  }catch(error){await health(error).catch(()=>{});}
  finally{publishing=false;}
 }
 async function tick(){
  if(busy)return;busy=true;
  try{
   await device();
   const stored=await chrome.storage.local.get('telegramBridge');
   const bridge=stored.telegramBridge||{device:crypto.randomUUID()};
   if(bridge.inFlight){
    bridge.ack={id:bridge.inFlight.id,label:bridge.inFlight.payload.type,result:{ok:false,error:'Extension bị gián đoạn giữa thao tác; kiểm tra trên máy. Không tự thực hiện lại.'}};delete bridge.inFlight;
   }
   if(bridge.ack)await complete(bridge);
   await chrome.storage.local.set({telegramBridge:bridge});
   const s=await getState(),feature=await rotationFeature();
   const data=snapshot(s,feature);
   const r=await fetch(remoteUrl(),{method:'POST',headers:{apikey:config.anonKey,Authorization:'Bearer '+config.anonKey,'Content-Type':'application/json'},body:JSON.stringify({p_token:config.historyToken,p_action:'claim',p_payload:{device:bridge.device}}),signal:AbortSignal.timeout(30000)});
   if(!r.ok)await syncError(r);const command=await r.json();
   if(Date.now()-lastNoticeAt>5000){lastNoticeAt=Date.now();request({action:'notify',device:bridge.device,snapshot:data}).catch(()=>{});}
   if(!command)return;
   if(Date.now()-command.created_at>90000){bridge.ack={id:command.id,label:command.payload?.type,result:{ok:false,error:'Lệnh đã hết hạn'}};}
   else{
    bridge.inFlight=command;await chrome.storage.local.set({telegramBridge:bridge});
    const result=await dispatch(command.payload);
    bridge.ack={id:command.id,label:command.payload.type,result:{ok:!!result?.ok,error:result?.error||null,fs:result?.fs,groupId:result?.groupId,deleted:result?.deleted,reloaded:result?.reloaded,nodePicker:result?.nodePicker}};delete bridge.inFlight;
   }
   await chrome.storage.local.set({telegramBridge:bridge});
   await complete(bridge);await chrome.storage.local.set({telegramBridge:bridge});
  }catch(error){await health(error).catch(()=>{});}
  finally{busy=false;}
 }
 globalThis.TelegramBridge={snapshot,dispatch,tick,publish,status:()=>({error:lastSyncError,lastPublishedAt})};
 chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='telegram-control'){publish();tick();}});
 chrome.alarms.create('telegram-control',{periodInMinutes:0.5});
 setInterval(publish,2000);setInterval(tick,2000);publish();tick();
})();
