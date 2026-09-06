'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert');
const {spawnSync}=require('child_process');
const {prepareDelta,finalizeDelta}=require('./core/delta-transaction');
const {INDEX_FILE,DELTA_TEMP_FILE,MEMORY_FILE,SESSIONS_DIR}=require('./constants');
let passed=0,failed=0;
const evidence=fs.mkdtempSync(path.join(os.tmpdir(),'delta-transaction-'));
function fixture(){const root=fs.mkdtempSync(path.join(evidence,'case-')),dir=path.join(root,'.crabshell','memory');fs.mkdirSync(dir,{recursive:true});const index=path.join(dir,INDEX_FILE),queue=path.join(dir,DELTA_TEMP_FILE),log=path.join(dir,MEMORY_FILE);fs.writeFileSync(index,JSON.stringify({pendingLastProcessedTs:'2026-09-01T00:00:00Z',lastMemoryUpdateTs:'2026-08-01T00:00:00Z',deltaReady:true,unrelated:'keep'}));fs.writeFileSync(queue,'original input 한글');return {root,dir,index,queue,log};}
function read(f){return JSON.parse(fs.readFileSync(f.index));}
function test(name,fn){try{fn();passed++;console.log('PASS '+name);}catch(e){failed++;console.error('FAIL '+name+' '+e.stack);}}
function ready(f){const job=prepareDelta(f.root);fs.writeFileSync(job.summaryFile,'unique summary');return job;}
function finish(f,j){return finalizeDelta(f.root,j.jobId,j.summaryFile);}
test('prepare moves exact bytes; retry shares immutable input but has a fresh summary path',()=>{const f=fixture(),bytes=fs.readFileSync(f.queue),a=prepareDelta(f.root),b=prepareDelta(f.root);assert.deepEqual(fs.readFileSync(a.inputFile),bytes);assert(!fs.existsSync(f.queue));assert.equal(a.jobId,b.jobId);assert.notEqual(a.summaryFile,b.summaryFile);assert.equal(read(f).deltaReady,false);});
test('one finalize appends, advances only captured cutoff, preserves fields and cleans owned files',()=>{const f=fixture(),j=ready(f),r=finish(f,j);assert(r.completed);assert(fs.readFileSync(f.log,'utf8').includes('unique summary'));assert.equal(read(f).lastMemoryUpdateTs,j.processedThrough);assert.equal(read(f).unrelated,'keep');assert(!fs.existsSync(j.inputFile));assert(!fs.existsSync(j.summaryFile));assert.equal(read(f).deltaReady,false);});
test('new queue and later timestamp survive finalization and become next prepared input',()=>{const f=fixture(),j=ready(f);fs.writeFileSync(f.queue,'later input');const i=read(f);i.pendingLastProcessedTs='2026-09-02T00:00:00Z';fs.writeFileSync(f.index,JSON.stringify(i));assert(finish(f,j).newInputPending);assert.equal(fs.readFileSync(f.queue,'utf8'),'later input');assert.equal(read(f).pendingLastProcessedTs,i.pendingLastProcessedTs);assert.equal(read(f).lastMemoryUpdateTs,j.processedThrough);const next=prepareDelta(f.root);assert.notEqual(next.jobId,j.jobId);assert.equal(fs.readFileSync(next.inputFile,'utf8'),'later input');});
test('completed retry adds no duplicate entry',()=>{const f=fixture(),j=ready(f);finish(f,j);const before=fs.readFileSync(f.log);assert(finish(f,j).alreadyCompleted);assert.deepEqual(fs.readFileSync(f.log),before);});
test('failure after durable append retries using commit evidence without duplicate',()=>{const f=fixture(),j=ready(f),write=fs.writeFileSync;let injected=false;fs.writeFileSync=function(file,data,...args){if(typeof file==='string'&&file.startsWith(f.index)&&String(data).includes('"appended"')){injected=true;throw Error('injected index write failure');}return write.call(fs,file,data,...args);};try{assert.throws(()=>finish(f,j),/injected/);}finally{fs.writeFileSync=write;}assert(injected);const before=fs.readFileSync(f.log);assert(finish(f,j).completed);assert.deepEqual(fs.readFileSync(f.log),before);});
test('missing and empty summaries preserve snapshot and committed timestamp',()=>{const f=fixture(),j=prepareDelta(f.root),before=read(f).lastMemoryUpdateTs;assert.throws(()=>finish(f,j),/not found/);fs.writeFileSync(j.summaryFile,' ');assert.throws(()=>finish(f,j),/empty/);assert(fs.existsSync(j.inputFile));assert.equal(read(f).lastMemoryUpdateTs,before);assert(!fs.existsSync(f.log));});
test('changed input and wrong job or summary paths fail without discarding data',()=>{const f=fixture(),j=ready(f);assert.throws(()=>finalizeDelta(f.root,'wrong',j.summaryFile),/match/);assert.throws(()=>finalizeDelta(f.root,j.jobId,f.queue),/prepared file/);fs.writeFileSync(j.inputFile,'changed');assert.throws(()=>finish(f,j),/changed/);assert(fs.existsSync(j.summaryFile));assert(!fs.existsSync(f.log));});
test('legacy markers cannot clean prepared input or advance its timestamp',()=>{const f=fixture(),j=ready(f);for(const command of ['mark-appended','mark-updated','cleanup']){const r=spawnSync(process.execPath,[path.join(__dirname,'extract-delta.js'),command,'--project-dir='+f.root],{encoding:'utf8'});assert.equal(r.status,1,r.stdout+r.stderr);}assert(fs.existsSync(j.inputFile));assert.equal(read(f).lastMemoryUpdateTs,'2026-08-01T00:00:00Z');});
test('no captured cutoff never advances to wall clock',()=>{const f=fixture(),i=read(f);delete i.pendingLastProcessedTs;fs.writeFileSync(f.index,JSON.stringify(i));finish(f,ready(f));assert.equal(read(f).lastMemoryUpdateTs,i.lastMemoryUpdateTs);});
test('CLI prepare and single finalize expose parseable outcomes',()=>{const f=fixture(),script=path.join(__dirname,'append-memory.js'),call=args=>spawnSync(process.execPath,[script,...args,'--project-dir='+f.root],{encoding:'utf8'});const p=call(['--prepare-delta']);assert.equal(p.status,0,p.stderr);const j=JSON.parse(p.stdout);fs.writeFileSync(j.summaryFile,'CLI summary');const r=call(['--finalize-delta','--job-id='+j.jobId,'--summary-file='+j.summaryFile]);assert.equal(r.status,0,r.stderr);assert(JSON.parse(r.stdout).completed);assert(fs.readFileSync(f.log,'utf8').includes('CLI summary'));});
test('extract skips retained queued entries and leaves newer entries outside the snapshot',()=>{
  const f=fixture(),sessions=path.join(f.root,'.crabshell',SESSIONS_DIR);
  fs.mkdirSync(sessions,{recursive:true});
  const l1=path.join(sessions,'20260902_test.l1.jsonl');
  const entry=(ts,text)=>JSON.stringify({ts,role:'user',text})+'\n';
  fs.writeFileSync(l1,entry('2026-09-02T00:00:00Z','first'));
  const run=()=>JSON.parse(spawnSync(process.execPath,[path.join(__dirname,'extract-delta.js'),'extract','--project-dir='+f.root],{encoding:'utf8'}).stdout);
  const initial=run();assert(initial.success,JSON.stringify(initial));
  const j=ready(f);assert.equal(run().success,false);
  fs.appendFileSync(l1,entry('2026-09-03T00:00:00Z','second'));
  const newer=run();assert(newer.success,JSON.stringify(newer));
  assert(!fs.readFileSync(j.inputFile,'utf8').includes('second'));
  assert(fs.readFileSync(f.queue,'utf8').includes('second'));
  assert(!fs.readFileSync(f.queue,'utf8').includes('first'));
  finish(f,j);assert(fs.existsSync(f.queue));
});
console.log(`${passed} passed, ${failed} failed; retained evidence: ${evidence}`);process.exitCode=failed?1:0;
