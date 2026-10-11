const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
function pageRig({failReload=false,wrongSip=false,wrongGroup=false,saveFragment=false,reloadButton=false,jsReload=false,miFailure=false,nodeFs='FS03',expectedGroup=0}={}){
 let listener;const calls=[];let applied=expectedGroup;
 const ips={FS01:'10.10.101.176',FS02:'10.10.101.170',FS03:'10.10.101.184',FS04:'10.10.101.180',FS05:'10.10.101.58',FS06:'10.10.101.87',FS07:'10.10.101.88'};
 const group=Number(nodeFs.slice(2))<=4?'99.153':'99.155',desired=expectedGroup===0?(group==='99.153'?2:3):0;
 const ip=ips[nodeFs];
 const editLink={getAttribute:()=>'?action=edit&id=186'};
 const row=value=>{const cells=[{textContent:'186'},{textContent:String(value)},{textContent:`sip:${ip}:5060`},{textContent:'vt=31/1000'},...Array.from({length:5},()=>({})),{querySelector:()=>editLink},{}];return {querySelectorAll:()=>cells};};
 const form={elements:[],getAttribute:n=>n==='action'?'?action=edit&id=186':n==='method'?'post':null};
 const inputs=[{name:'group_id',id:'',value:expectedGroup?String(expectedGroup):'',type:'text',closest:()=>form},
 {name:'sip_uri',value:wrongSip?'sip:10.10.101.999:5060':`sip:${ip}:5060`,type:'text',closest:()=>form},
 {name:'resources',value:'vt=1000',type:'text'},{name:'csrf',value:'token',type:'hidden'}];
 const save={name:'save',value:'Save',tagName:'INPUT',closest:()=>form};form.elements=inputs;form.querySelectorAll=()=>[save];
 const reloadForm={elements:[{name:'csrf',value:'reload-token',type:'hidden'}],getAttribute:n=>n==='action'?'?action=add':n==='method'?'post':null};
 const reload={type:reloadButton||jsReload?'button':'submit',getAttribute:n=>n==='onclick'&&(reloadButton||jsReload)?'apply_changes()':null,name:'reload',value:'Reload on Server',tagName:'INPUT',closest:()=>reloadForm};
 const listing={querySelectorAll:selector=>selector==='table.ttable tr'?[row(wrongGroup?99:applied)]:(reloadButton&&!selector.includes('input[type=button]')?[]:[reload])};
 const edit={querySelectorAll:selector=>selector==='input'?inputs:[]};
 const docs={listing,edit,fragment:{querySelectorAll:()=>[]}};
 const success='Sending MI command: lb_reload Sending to json:127.0.0.1:8989/mi : Success';
 const failed='Sending MI command: lb_reload Sending to json:127.0.0.1:8989/mi : Failed';
 docs[success]=listing;docs[failed]=listing;
 const context={location:{hostname:`10.10.${group}`,origin:`http://10.10.${group}`},URL,URLSearchParams,AbortSignal,
 DOMParser:class{parseFromString(html){return docs[html];}},chrome:{runtime:{onMessage:{addListener(fn){listener=fn;}}}},
 fetch:async(url,opts)=>{calls.push({url,...opts});const body=new URLSearchParams(opts.body||'');
   if(body.has('save')){assert.equal(body.get('group_id'),String(desired));assert.equal(body.get('resources'),'vt=1000');assert.equal(body.get('csrf'),'token');}
   const isReload=body.has('reload')||url.endsWith('/apply_changes.php');
   if(isReload){if(!failReload)applied=desired;}
   return {ok:true,status:200,url,text:async()=>isReload?(miFailure?failed:success):body.has('save')&&saveFragment?'fragment':url.includes('action=edit')&&opts.method!=='POST'?'edit':'listing'};}};
 vm.createContext(context);vm.runInContext(fs.readFileSync('fs-switch-opensips.js','utf8'),context);
 return {calls,read:()=>new Promise(resolve=>listener({type:'FS_SWITCH_READ_NODE',node:{fs:nodeFs,id:186,ip}},{},resolve)),send:()=>new Promise(resolve=>listener({type:'FS_SWITCH_SET_GROUP',group,node:{fs:nodeFs,id:186,ip},expected:expectedGroup,value:desired},{},resolve))};
}
test('OpenSIPS adapter discovers forms, preserves fields, Save then Reload then verifies runtime',async()=>{
 const r=pageRig();assert.equal((await r.send()).ok,true);assert.equal(r.calls.length,5);
 assert.match(r.calls[2].body,/save=Save/);assert.match(r.calls[3].body,/reload=Reload\+on\+Server/);assert.match(r.calls[4].body,/refresh=/);
});
for(const flag of ['failReload','wrongSip','wrongGroup'])test(`OpenSIPS adapter refuses ${flag}`,async()=>{
 const r=pageRig({[flag]:true});assert.equal((await r.send()).ok,false);
 if(flag!=='failReload')assert.ok(r.calls.every(c=>!new URLSearchParams(c.body).has('save')));
});

test('Save fragment falls back to listing and finds input button Reload without saving twice',async()=>{
 const r=pageRig({saveFragment:true,reloadButton:true});const result=await r.send();
 assert.equal(result.ok,true);assert.equal(r.calls.length,6);
 assert.equal(r.calls.filter(c=>new URLSearchParams(c.body).has('save')).length,1);
 assert.equal(r.calls.filter(c=>c.url.endsWith('/apply_changes.php')).length,1);
 assert.match(r.calls[3].url,/action=add/);
});

for(const nodeFs of ['FS01','FS02','FS03','FS04','FS05','FS06','FS07'])for(const direction of ['enable','disable'])test(`OpenSIPS ${nodeFs} ${direction} writes group for correct profile and reloads`,async()=>{
 const expectedGroup=direction==='enable'?0:Number(nodeFs.slice(2))<=4?2:3;
 const r=pageRig({nodeFs,expectedGroup});const result=await r.send();
 assert.equal(result.ok,true,result.error);assert.equal(result.groupId,direction==='disable'?0:Number(nodeFs.slice(2))<=4?2:3);
 assert.equal(r.calls.filter(c=>new URLSearchParams(c.body).has('save')).length,1);
 assert.equal(r.calls.filter(c=>new URLSearchParams(c.body).has('reload')).length,1);
});

test('OpenSIPS fresh read includes numeric VT for delayed target check',async()=>{
 const r=pageRig({nodeFs:'FS07',expectedGroup:3});const result=await r.read();
 assert.equal(result.ok,true);assert.equal(result.groupId,3);assert.equal(result.used,31);
 assert.ok(r.calls.every(c=>!new URLSearchParams(c.body).has('save')));
});

for(const nodeFs of ['FS03','FS06'])test(`Actual ${nodeFs} JavaScript Reload calls MI endpoint and verifies Success`,async()=>{
 const r=pageRig({jsReload:true,nodeFs});const result=await r.send();
 assert.equal(result.ok,true,result.error);const reload=r.calls.filter(c=>c.url.endsWith('/apply_changes.php'));
 assert.equal(reload.length,1);assert.equal(reload[0].body,undefined);
 assert.equal(r.calls.filter(c=>new URLSearchParams(c.body).has('reload')).length,0);
});
test('MI failure is rejected even when the saved Group ID already matches',async()=>{
 const r=pageRig({jsReload:true,miFailure:true});const result=await r.send();
 assert.equal(result.ok,false);assert.equal(result.stage,'SAVED');
 assert.match(result.error,/lb_reload Success/);
 assert.equal(r.calls.filter(c=>new URLSearchParams(c.body).has('save')).length,1);
});
