const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const F=require('../src/core/fs-switch'),D=require('../src/core/detection');
for(const [group,name,ip,on] of [['99.153','FS01','10.10.101.176',2],['99.155','FS06','10.10.101.87',3]])for(const expected of [0,on])test(`Manual ${name} Group ID ${expected} toggle verifies Reload without BLOCK`,async()=>{
 const commands=[];let saved;
 const state={opensips:{[group]:{nodes:[{fs:name,ip,destinationId:10,groupId:expected}]}},fsStates:{x:{group,fs:name,ip,groupId:expected,incident:{id:'old'}}},pendingAutoActions:[]};
 const ctx={FsSwitch:F,Detection:{...D,refreshAlerts(){}},Date,structuredClone,chrome:{alarms:{create(){},onAlarm:{addListener(){}}},runtime:{onMessage:{addListener(){}}}},getState:async()=>state,saveState:async s=>{saved=s;}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync('src/background/fs-switch-worker.js','utf8'),ctx);
 ctx.switchTab=async()=>1;ctx.switchCommand=async(_,msg)=>{commands.push(msg);return msg.type==='FS_SWITCH_READ_NODE'?{groupId:expected}:{reloaded:true,groupId:msg.value,pageId:'old'};};
 ctx.refreshSwitchPage=async(_,node,value)=>{commands.push({type:'REFRESH_VERIFY',value});return {groupId:value};};
 const value=expected===0?on:0;
 const r=await ctx.toggleFsNode({group,fs:name,expected},{},state);
 assert.equal(r.groupId,value);assert.deepEqual(commands.map(m=>m.type),['FS_SWITCH_READ_NODE','FS_SWITCH_SET_GROUP','REFRESH_VERIFY']);
 assert.equal(saved.fsStates.x.groupId,value);assert.equal(saved.fsStates.x.incident,null);
 commands.length=0;ctx.switchCommand=async()=>({groupId:99});
 await assert.rejects(ctx.toggleFsNode({group,fs:name,expected},{},state),/Group ID đã thay đổi/);
});
for(const success of [true,false])test(`Dashboard server Reload refreshes Load Balancer only after MI success (${success})`,async()=>{
 const commands=[];
 const ctx={FsSwitch:F,Detection:D,Date,structuredClone,chrome:{tabs:{reload:async(id,opts)=>commands.push({id,opts})},alarms:{create(){},onAlarm:{addListener(){}}},runtime:{onMessage:{addListener(){}}}}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync('src/background/fs-switch-worker.js','utf8'),ctx);
 ctx.switchState=async()=>({});ctx.switchSnapshot=async()=>({});ctx.switchTab=async()=>153;
 ctx.switchCommand=async(id,msg)=>{assert.equal(msg.type,'FS_SWITCH_RELOAD_SERVER');assert.equal(msg.group,'99.153');return {reloaded:success};};
 if(success){const result=await ctx.processSwitch({type:'FS_SWITCH_RELOAD',group:'99.153'});assert.equal(result.pageRefreshed,true);assert.equal(commands.length,1);assert.equal(commands[0].id,153);}
 else{await assert.rejects(ctx.processSwitch({type:'FS_SWITCH_RELOAD',group:'99.153'}),/lb_reload/);assert.equal(commands.length,0);}
});

for(const stage of ['MONITORING_TARGET','WAITING_CDR','BLOCK_TARGET'])test(`Hybrid old lock recovery ${stage} verifies routing and preserves uncertain number writes`,()=>{
 const ctx={Detection:D,FsSwitch:F,Date,structuredClone,chrome:{alarms:{create(){},onAlarm:{addListener(){}}},runtime:{onMessage:{addListener(){}}}}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync('src/background/fs-switch-worker.js','utf8'),ctx);
 const p={group:'99.155',groupId:3,source:{fs:'FS06',ip:'six',id:107},target:{fs:'FS07',ip:'seven',id:109}};
 const op={id:'rotation',status:'FAILED',stage,plan:p,targetWatchPending:true};
 const feature={operation:op,history:[],quarantined:{'99.155|FS06':'rotation','99.155|FS07':'rotation'}};
 const s={config:{detectionSource:'CDR',cdrRequireVtDrop:true},opensips:{'99.155':{updatedAt:Date.now(),nodes:[{fs:'FS06',ip:'six',destinationId:107,groupId:0},{fs:'FS07',ip:'seven',destinationId:109,groupId:3}]}}};
 ctx.reconcileSwitchLocks(feature,s);
 assert.equal(op.status,stage==='BLOCK_TARGET'?'FAILED':'DONE');
 assert.equal(Object.keys(feature.quarantined).length,stage==='BLOCK_TARGET'?2:0);
 if(stage!=='BLOCK_TARGET'){
  const reverse={...p,source:p.target,target:p.source};feature.operation={id:'reverse',status:'DONE',stage:'ROUTING_VERIFIED',plan:reverse};
  feature.quarantined={'99.155|FS06':'reverse','99.155|FS07':'reverse'};
  s.opensips['99.155'].nodes[0].groupId=3;s.opensips['99.155'].nodes[1].groupId=0;
  ctx.reconcileSwitchLocks(feature,s);assert.equal(Object.keys(feature.quarantined).length,0);
 }
});
