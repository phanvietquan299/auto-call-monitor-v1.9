const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {chromium}=require('playwright');
test('offline dashboard shows per-group picker, persists unchecking and deduplicates OS01', {timeout:60000},async()=>{
 const profile=await fs.mkdtemp(path.join(os.tmpdir(),'node-picker-'));let context;
 try{
  context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:[`--disable-extensions-except=${process.cwd()}`,`--load-extension=${process.cwd()}`,'--proxy-server=http://127.0.0.1:9','--proxy-bypass-list=<-loopback>']});await context.setOffline(true);
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  await worker.evaluate(async()=>{
   const state=structuredClone(DEFAULT_STATE);state.detectionVersion=2;state.monitoringEnabled=false;
   const nodes=[{fs:'FS01',ip:'10.10.101.176',destinationId:1,resource:'vt',groupId:2,used:30,capacity:1000},{fs:'OS01',ip:'10.10.99.140',destinationId:2,resource:'vt',groupId:0,used:0,capacity:1000}];
   state.opensips['99.153']={nodes,catalog:[...nodes,{...nodes[1],destinationId:3,groupId:1,capacity:2},{fs:null,fsHint:'FS11',ip:'10.10.101.200',destinationId:4,resource:'vt',groupId:0,used:0,capacity:1000}],updatedAt:Date.now()};
   state.opensips['99.155']={nodes:[{fs:'FS05',ip:'10.10.101.58',destinationId:5,resource:'vt',groupId:3,used:40,capacity:1000}],updatedAt:Date.now()};
   state.freeswitch.numbers=[{fs:'FS11',profile:'COLLECTION',phone:'0901',status:'BACKUP'}];
   await chrome.storage.local.set({state,fsSwitch:{enabled:false,mode:'MANUAL',history:[],handled:{},quarantined:{}}});
  });
  // All OpenSIPS requests are fulfilled locally, including the picker's fresh fetch.
  const listing='<table class="ttable"><tr><th>ID</th><th>Group</th><th>SIP URI</th><th>Resources</th><th>Description</th></tr>'+[
   [1,2,'10.10.101.176',1000,'FS01'],[2,0,'10.10.99.140',1000,'OS01'],[3,1,'10.10.99.140',2,'OS01'],[4,0,'10.10.101.200',1000,'FS11']
  ].map(([id,group,ip,cap,name])=>`<tr><td>${id}</td><td>${group}</td><td>sip:${ip}:5060</td><td>vt=0/${cap}</td><td>${name}</td></tr>`).join('')+'</table>';
  await context.route('http://10.10.99.153/**',route=>route.fulfill({status:200,contentType:'text/html',body:listing}));
  const opensips=await context.newPage();await opensips.goto('http://10.10.99.153/cp/tools/system/loadbalancer/loadbalancer.php');
  const extensionId=new URL(worker.url()).host,page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`chrome-extension://${extensionId}/src/ui/dashboard.html`);
  await page.locator('[data-add-node]').first().waitFor();assert.equal(await page.locator('[data-add-node]').count(),2);
  assert.equal(await page.locator('#groups tr').filter({hasText:'OS01'}).count(),1);
  await page.locator('[data-add-node="99.153"]').click();await page.locator('#node-picker-save:not([disabled])').waitFor();
  const osRow=page.locator('.node-picker-item').filter({hasText:'OS01'}),f1Row=page.locator('.node-picker-item').filter({hasText:'FS01'}),f2Row=page.locator('.node-picker-item').filter({hasText:'FS11'});
  assert.match(await page.locator('#node-picker-status').textContent(),/Đã tải 3 node/);
  assert.equal(await osRow.count(),1);assert.equal(await osRow.locator('input').isChecked(),true);assert.equal(await f1Row.locator('input').isChecked(),true);assert.equal(await f2Row.locator('input').isChecked(),false);
  await osRow.locator('input').uncheck();await f2Row.locator('input').check();await page.locator('#node-picker-save').click();await page.locator('#node-picker-dialog').waitFor({state:'hidden'});
  await page.waitForFunction(()=>!document.querySelector('#groups').textContent.includes('OS01')&&document.querySelector('#groups').textContent.includes('FS11'));
  assert.equal(await page.locator('#groups tr').filter({hasText:'FS05'}).count(),1);
  await page.locator('[data-add-node="99.153"]').click();await page.locator('#node-picker-save:not([disabled])').waitFor();assert.equal(await osRow.locator('input').isChecked(),false);assert.equal(await f2Row.locator('input').isChecked(),true);
  await f1Row.locator('input').uncheck();await f2Row.locator('input').uncheck();await page.locator('#node-picker-save').click();await page.locator('#node-picker-dialog').waitFor({state:'hidden'});await page.waitForFunction(()=>!document.querySelector('#groups').textContent.includes('FS01')&&!document.querySelector('#groups').textContent.includes('FS11'));
  assert.deepEqual(errors,[]);
 }finally{if(context)await context.close();await fs.rm(profile,{recursive:true,force:true});}
});
