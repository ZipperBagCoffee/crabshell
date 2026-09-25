'use strict';
// v21.123.0 turned the memory-save notice into an option and the logbook stopped
// getting entries; these checks pin the directive, its cadence, and the input split.
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert'),{spawnSync}=require('child_process');
const {prepareDelta}=require('./core/delta-transaction');
const base=fs.mkdtempSync(path.join(os.tmpdir(),'memory-save-directive-'));let passed=0,failed=0;
function test(name,fn){try{fn();passed++;console.log('PASS '+name);}catch(e){failed++;console.error('FAIL '+name+' '+e.stack);}}
function project(delta,index){const root=fs.mkdtempSync(path.join(base,'case-')),memory=path.join(root,'.crabshell','memory');fs.mkdirSync(memory,{recursive:true});fs.writeFileSync(path.join(memory,'memory-index.json'),JSON.stringify(index||{deltaReady:true}));if(delta!==null)fs.writeFileSync(path.join(memory,'delta_temp.txt'),delta);return {root,memory};}
function inject(f,prompt){const r=spawnSync(process.execPath,[path.join(__dirname,'inject-rules.js')],{cwd:f.root,env:{...process.env,CLAUDE_PROJECT_DIR:f.root,CRABSHELL_BACKGROUND:'',HOOK_DATA:''},input:JSON.stringify({cwd:f.root,session_id:'directive-test',hook_event_name:'UserPromptSubmit',prompt}),encoding:'utf8'});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout).hookSpecificOutput.additionalContext;}
const MIN_DELTA=20*1024;

test('a question turn with queued memory gets the save directive, not an option',()=>{
  const context=inject(project('input '.repeat(MIN_DELTA/6+100)),'됐나?');
  assert(context.includes('[CRABSHELL_DELTA]'));
  assert(context.includes('skill="memory-delta"'));
  assert(/Invoke the Skill tool now/.test(context));
  assert(/questions included/.test(context));
  assert(!/when compatible/.test(context));
});
test('queued memory below the 20KB threshold stays silent (cadence unchanged)',()=>{
  const context=inject(project('x'.repeat(MIN_DELTA-1024)),'진행해');
  assert(!context.includes('[CRABSHELL_DELTA]'));
});
test('a pending archive summary gets the rotation directive',()=>{
  const context=inject(project(null,{rotatedFiles:[{file:'logbook_20260101_000000.md',summaryGenerated:false}]}),'진행해');
  assert(context.includes('skill="memory-rotate"'));
  assert(!/when compatible/.test(context));
});
test('prepared input is split into contiguous parts that cover every line once',()=>{
  const lines=[];for(let i=0;i<4000;i++)lines.push(i%500===7?'L'.repeat(90000):'line '+i+' '+'y'.repeat(i%120));
  const text=lines.join('\n')+'\n',f=project(text);
  const job=prepareDelta(f.root);
  assert.equal(job.inputBytes,Buffer.byteLength(text));
  assert(job.parts.length>1);
  let next=1;
  for(const part of job.parts){
    assert.equal(part.offset,next);assert(part.limit>=1&&part.limit<=1500);
    const bytes=lines.slice(part.offset-1,part.offset-1+part.limit).reduce((sum,line)=>sum+Buffer.byteLength(line)+1,0);
    assert(part.limit===1||bytes<=150000,`part at ${part.offset} holds ${bytes} bytes`);
    next+=part.limit;
  }
  assert.equal(next-1,lines.length);
  const again=prepareDelta(f.root);
  assert.equal(again.reused,true);assert.deepEqual(again.parts,job.parts);
});
test('memory skills no longer tell the model it may skip the save',()=>{
  const read=name=>fs.readFileSync(path.join(__dirname,'..','skills',name,'SKILL.md'),'utf8');
  const delta=read('memory-delta'),rotate=read('memory-rotate');
  for(const text of [delta,rotate])assert(!/does not (?:supply|grant) (?:user authorization|permission)|when compatible/.test(text));
  assert(/every kind of turn/.test(delta)&&/every kind of turn/.test(rotate));
  assert(/`parts`/.test(delta)&&/reused:true/.test(delta));
});
console.log(`${passed} passed, ${failed} failed; retained evidence: ${base}`);process.exitCode=failed?1:0;
