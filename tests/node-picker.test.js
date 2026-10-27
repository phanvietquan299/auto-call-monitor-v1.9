const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const F=require('../src/core/fs-switch');
function fixture(){
 const os={fs:'OS01',ip:'10.10.99.140',destinationId:10,groupId:0,capacity:1000,used:0,resource:'vt'};
 const f1={fs:'FS01',ip:'10.10.101.176',destinationId:1,groupId:2,capacity:1000,used:50,resource:'vt'};
 return {opensips:{'99.153':{nodes:[f1,os],catalog:[f1,os,{...os,destinationId:11,groupId:1,capacity:2},{fs:null,ip:'10.10.101.200',destinationId:20,groupId:0,resource:'vt',fsHint:'FS11'}]},'99.155':{nodes:[]}},freeswitch:{numbers:[{fs:'FS11',profile:'COLLECTION'}]}};
}
test('OS01 has one displayed row, preferring Collection runtime group over other groups',()=>{
 const s=fixture();assert.equal(F.displayRows(s,'99.153').filter(n=>n.fs==='OS01').length,1);assert.equal(F.displayRows(s,'99.153').find(n=>n.fs==='OS01').groupId,0);
 const rows=s.opensips['99.153'].catalog;rows.push({...rows[1],destinationId:12,groupId:2});assert.equal(F.catalogRows(rows,'99.153').find(n=>n.fs==='OS01').destinationId,12);
});
test('same-priority destinations remain ambiguous after repeated normalization',()=>{
 const s=fixture(),rows=s.opensips['99.153'].catalog;rows.push({...rows[1],destinationId:12});const first=F.catalogRows(rows,'99.153');assert.equal(F.catalogRows(first,'99.153').find(n=>n.fs==='OS01').ambiguous,true);
});
test('checkbox selection hides unchecked nodes and supports an empty group without touching routing',()=>{
 const s=fixture(),before=JSON.stringify(s.opensips);s.nodeDisplay={'99.153':['10.10.99.140']};assert.deepEqual(F.displayRows(s,'99.153').map(n=>n.fs),['OS01']);assert.equal(JSON.stringify(s.opensips),before);
 s.nodeDisplay['99.153']=[];assert.deepEqual(F.displayRows(s,'99.153'),[]);
});
test('catalog lists IPs outside original target list and matches FreeSWITCH names within profile',()=>{
 const s=fixture();assert.equal(F.nodeCatalog(s,'99.153').find(n=>n.ip==='10.10.101.200').fs,'FS11');s.freeswitch.numbers[0].profile='TELESALE';assert.equal(F.nodeCatalog(s,'99.153').find(n=>n.ip==='10.10.101.200').fs,null);
 s.freeswitch.nodeMappings=[{ip:'10.10.101.200',fs:'OS02'}];assert.equal(F.nodeCatalog(s,'99.153').find(n=>n.ip==='10.10.101.200').fs,'OS02');
});
test('display-only additions do not enter automatic rotation or change existing node identity',()=>{
 const s=fixture();s.nodeDisplay={'99.153':['10.10.101.200']};const row=F.displayRows(s,'99.153')[0];assert.equal(row.displayOnly,true);assert.ok(!F.groups['99.153'].fs.includes(row.fs));
});
test('validate selections per group, reject injected IP, preserve temporarily missing selection',()=>{
 const s=fixture();assert.deepEqual(F.validateDisplayIps(s,'99.153',['10.10.99.140','10.10.99.140']),['10.10.99.140']);assert.throws(()=>F.validateDisplayIps(s,'99.155',['10.10.99.140']));assert.throws(()=>F.validateDisplayIps(s,'99.153',['1.2.3.4']));assert.deepEqual(F.validateDisplayIps(s,'99.153',['10.10.101.210'],['10.10.101.210']),['10.10.101.210']);
});
test('display command persists group selections without running lock reconciliation or changing modes',async()=>{
 const source=fs.readFileSync('src/background/fs-switch-worker.js','utf8');const body=source.slice(source.indexOf('async function processSwitch(msg)'),source.indexOf("chrome.runtime.onMessage.addListener",source.indexOf('async function processSwitch(msg)')));
 let feature={enabled:true,mode:'AUTOMATIC',operation:{id:'running',status:'RUNNING'},displayNodes:{'99.155':['sale-ip']}};
 const state=fixture();const ctx={FsSwitch:F,getState:async()=>state,chrome:{storage:{local:{get:async()=>({fsSwitch:feature})}}},switchSave:async f=>{feature=f;}};vm.createContext(ctx);vm.runInContext(body,ctx);
 const r=await ctx.processSwitch({type:'FS_SWITCH_SETTINGS',displayGroup:'99.153',displayIps:['10.10.99.140']});assert.equal(r.ok,true);assert.equal(feature.enabled,true);assert.equal(feature.mode,'AUTOMATIC');assert.equal(feature.operation.status,'RUNNING');assert.deepEqual(feature.displayNodes['99.155'],['sale-ip']);assert.deepEqual(feature.displayNodes['99.153'],['10.10.99.140']);
});
