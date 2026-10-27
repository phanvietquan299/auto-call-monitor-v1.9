/* This rollback intentionally pins the stable 1.17.24 operational policy.
 * Authorized exceptions: scheduling/resume hooks, OS01 mapping and the read-only node catalog.
 */
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{execFileSync}=require('node:child_process');
const D=require('../src/core/detection');
const stable=name=>execFileSync('git',['show','b2ecdf1:'+name],{encoding:'utf8'});
test('Restored detection functions and defaults match stable 1.17.24; only authorized scheduling/resume hooks differ',()=>{
 const context={};vm.runInNewContext(stable('detection.js'),context);
 for(const [key,value] of Object.entries(context.Detection)){
  if(['applySchedule','activationBlockReady','updateCdrStates','cdrGate'].includes(key))continue;
  if(typeof value==='function')assert.equal(D[key].toString(),value.toString(),key);
  else assert.equal(JSON.stringify(D[key]),JSON.stringify(value),key);
 }
});
test('Restored CDR, routing and page adapters preserve the stable source across the new folder layout',()=>{
 const paths={
  'cdr.js':'src/core/cdr.js','fs-switch.js':'src/core/fs-switch.js',
  'cdr-worker.js':'src/background/cdr-worker.js',
  'freeswitch.js':'src/content/freeswitch.js','opensips.js':'src/content/opensips.js',
  'opensips-page.js':'src/content/opensips-page.js','cdr-viewer.js':'src/content/cdr-viewer.js',
  'fs-switch-opensips.js':'src/content/fs-switch-opensips.js','grafana.js':'src/content/grafana.js',
 };
 for(const [original,current] of Object.entries(paths)){
  let actual=fs.readFileSync(current,'utf8'),expected=stable(original);
  // Normalize only explicitly authorized node mappings; retain full equality of operational code.
  actual=actual.replaceAll("OS01:'10.10.99.140',",'').replaceAll(",'OS01'",'');
  if(original==='fs-switch.js'){
   actual=actual.slice(0,actual.indexOf('  // A destination is identified by ID'))+actual.slice(actual.indexOf('  const api='));
   actual=actual.replace('api={catalogRows,nodeCatalog,displayRows,validateDisplayIps,','api={');
  }
  if(original==='freeswitch.js'){
   actual=actual.slice(0,actual.indexOf('  function parseNodeMappings()'))+actual.slice(actual.indexOf('  function publish()'));
   actual=actual.replace(',nodeMappings:parseNodeMappings()','').replaceAll('^(?:FS|OS)\\d+$','^FS\\d+$');
  }
  if(original==='cdr-viewer.js')actual=actual.replace("(msg.fs==='OS01'||Number(msg.fs.slice(2))<=4)",'(Number(msg.fs.slice(2))<=4)');
  if(original==='opensips.js'){
   // Parsing/catalog selection is covered by the offline Chrome test. Pin the polling transport.
   const ts=require('typescript');
   const functions=source=>{const out={};const file=ts.createSourceFile('adapter.js',source,ts.ScriptTarget.Latest,true);function visit(n){if(ts.isFunctionDeclaration(n)&&n.name)out[n.name.text]=n.getText(file);ts.forEachChild(n,visit);}visit(file);return out;};
   const a=functions(actual),b=functions(expected);
   for(const name of ['send','poll'])assert.equal(a[name].replace(/        catalog:parsed.catalog,\n/,''),b[name],current+' '+name);
   continue;
  }
  if(original==='fs-switch-opensips.js'){
   actual=actual.split('\n').filter(line=>line.trim()).join('\n');expected=expected.split('\n').filter(line=>line.trim()).join('\n');
  }
  assert.equal(actual,expected,current);
 }

});
