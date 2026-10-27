const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
for(const role of ['LOAD_BALANCER','CDR'])test(`Reload ${role} frame preserves main.php and skips ongoing operations`,()=>{
 const origin='http://10.10.99.153';let listener,reloads=0;
 const form={querySelector:()=>({})};
 const child={URL:origin+`/cp/tools/system/${role==='CDR'?'cdrviewer/cdrviewer':'loadbalancer/loadbalancer'}.php`,defaultView:{location:{reload(){reloads++;},replace(){throw Error('Unexpected navigation');}}},querySelector:()=>null,querySelectorAll:q=>q==='form'&&role==='CDR'?[form]:[]};
 const parent={URL:origin+'/cp/main.php',querySelector:()=>null,querySelectorAll:q=>q==='iframe,frame'?[{contentDocument:child}]:[]};
 const ctx={document:parent,location:{origin,hostname:'10.10.99.153'},URL,setTimeout:()=>{throw Error('Reload must not depend on throttled timers');},chrome:{runtime:{onMessage:{addListener(fn){listener=fn;}}}}};
 vm.runInNewContext(fs.readFileSync('src/content/opensips-page.js','utf8'),ctx);
 const send=()=>{let reply;listener({type:'OPENSIPS_REFRESH_TOOL',role},{},r=>reply=r);return reply;};
 assert.equal(send().ok,true);assert.equal(reloads,1);assert.equal(parent.URL,origin+'/cp/main.php');
 ctx.cdrReadBusy=true;assert.equal(send().skipped,true);assert.equal(reloads,1);
 ctx.cdrReadBusy=false;assert.equal(ctx.OpenSipsPage.flushRefresh().ok,true);assert.equal(reloads,2);
 ctx.fsSwitchBusy=true;assert.equal(send().skipped,true);assert.equal(reloads,2);
});

test('Assigned tab returns to its tool when the other tool is currently visible',()=>{
 const origin='http://10.10.99.153';let listener,destination;
 const form={querySelector:()=>({})};
 const child={URL:origin+'/cp/tools/system/cdrviewer/cdrviewer.php',defaultView:{location:{replace:url=>destination=url,reload(){throw Error('Must restore assigned tool');}}},querySelector:()=>null,querySelectorAll:q=>q==='form'?[form]:[]};
 const parent={querySelector:()=>null,querySelectorAll:q=>q==='iframe,frame'?[{contentDocument:child}]:[]};
 const ctx={document:parent,location:{origin,hostname:'10.10.99.153'},URL,setTimeout:()=>{throw Error('Reload must not depend on throttled timers');},chrome:{runtime:{onMessage:{addListener(fn){listener=fn;}}}}};
 vm.runInNewContext(fs.readFileSync('src/content/opensips-page.js','utf8'),ctx);
 let reply;listener({type:'OPENSIPS_REFRESH_TOOL',role:'LOAD_BALANCER'},{},r=>reply=r);
 assert.equal(reply.ok,true);assert.equal(destination,origin+'/cp/tools/system/loadbalancer/loadbalancer.php');
});
