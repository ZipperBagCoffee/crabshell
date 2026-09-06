'use strict';
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
const {pathToFileURL}=require('url');
const observation=require('./core/command-observation');
const completion=require('./core/completion-control');
const sequence=require('./verification-sequence');
const {handlePayload}=require('./completion-controller');
const fixtures=path.join(__dirname,'fixtures/hook-payloads/native');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'crabshell native evidence '));
let passed=0,serial=0;
function test(name,fn){fn();passed++;console.log('PASS: '+name);}
function setup(host){
  const root=path.join(temp,host+'-'+serial++);
  fs.mkdirSync(path.join(root,'.crabshell','memory'),{recursive:true});
  fs.mkdirSync(path.join(root,'.crabshell','verification'),{recursive:true});
  fs.writeFileSync(path.join(root,'app.js'),'module.exports = 1;\n');
  fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({scripts:{test:'node check.js'}}));
  fs.writeFileSync(path.join(root,'check.js'),"require('assert').strictEqual(require('./app'),1);\n");
  fs.writeFileSync(path.join(root,'.crabshell','memory','regressing-state.json'),JSON.stringify({active:true,lastUpdatedAt:new Date().toISOString()}));
  const original=JSON.parse(fs.readFileSync(path.join(fixtures,host+'-PostToolUse-success.json')));
  const common={session_id:original.session_id,turn_id:original.turn_id,cwd:root};
  completion.noteExecutionAuthorization(root,{...common,prompt:'Implement and verify the fixture.'});
  completion.noteSubagentStop(root,{...common,last_assistant_message:'Fixture child claim'});
  fs.writeFileSync(path.join(root,'.crabshell','memory','regressing-state.json'),'{}');
  const transcript=path.join(root,'.crabshell','native-transcript.jsonl');
  fs.writeFileSync(transcript,'');
  return {root,host,common,transcript};
}
function event(ctx,result,id,order){
  const phase=ctx.host==='claude'&&result==='failure'?'PostToolUseFailure':'PostToolUse';
  const original=JSON.parse(fs.readFileSync(path.join(fixtures,ctx.host+'-'+phase+'-'+result+'.json')));
  const payload={...original,...ctx.common,transcript_path:ctx.transcript,tool_use_id:id,tool_input:{command:'node check.js'}};
  // Replay native result fields; project, invocation ID and timing are fixture
  // context for these state sequences. Original captured files stay unchanged.
  if(ctx.host==='codex'){
    const rows=JSON.parse(fs.readFileSync(path.join(fixtures,'codex-completed-'+result+'.json')));
    for(const row of rows){row.payload.item.id=id;row.payload.item.cwd=pathToFileURL(ctx.root).href;row.payload.started_at_ms=order*1000;row.payload.completed_at_ms=order*1000+100;}
    fs.appendFileSync(ctx.transcript,rows.map(row=>JSON.stringify(row)).join('\n')+'\n');
  }
  return payload;
}
function start(ctx,payload){
  const p={...payload,hook_event_name:'PreToolUse'};delete p.tool_response;delete p.error;
  assert.strictEqual(sequence.gateVerification(p,ctx.root).exitCode,0);
  completion.prepareParentCheck(ctx.root,p);
}
function finish(ctx,payload){
  sequence.recordVerification(payload,ctx.root,{host:ctx.host});
  return completion.recordParentObservation(ctx.root,payload,{host:ctx.host});
}
function gate(ctx){return sequence.gateVerification({...ctx.common,tool_name:'Bash',tool_input:{command:'git commit --dry-run'}},ctx.root).exitCode;}
function state(ctx){return completion.loadState(ctx.root);}
try{
  test('native Claude top-level errors and Codex completion records supply actual codes',()=>{
    for(const host of ['claude','codex']){
      const ctx=setup(host);
      for(const result of ['success','failure']){
        const p=event(ctx,result,result,1);
        const got=observation.commandObservation(p,ctx.root,{host});
        assert.strictEqual(got.conclusive,true);
        assert.strictEqual(got.passed,result==='success');
        assert.strictEqual(got.evidenceSource,host==='codex'?'codex-transcript-item-completed':result==='failure'?'claude-failure-event':'hook-result');
      }
    }
  });
  test('Codex arbitrary stdout cannot forge exit success without its matching record',()=>{
    const ctx=setup('codex');
    const p={...ctx.common,tool_name:'Bash',tool_input:{command:'node check.js'},tool_response:'Exit code: 0\nPASS',tool_use_id:'missing',transcript_path:ctx.transcript};
    assert.strictEqual(observation.commandObservation(p,ctx.root,{host:'codex'}).conclusive,false);
  });
  test('Codex result binding rejects a different call, turn, session or project',()=>{
    const ctx=setup('codex'),p=event(ctx,'success','bound',1);
    for(const change of [{tool_use_id:'wrong'},{turn_id:'wrong'},{session_id:'wrong'}]){
      assert.strictEqual(observation.commandObservation({...p,...change},ctx.root,{host:'codex'}).conclusive,false);
    }
    const rows=fs.readFileSync(ctx.transcript,'utf8').trim().split('\n').map(JSON.parse);
    rows[0].payload.item.cwd=pathToFileURL(temp).href;
    fs.writeFileSync(ctx.transcript,rows.map(JSON.stringify).join('\n')+'\n');
    assert.strictEqual(observation.commandObservation(p,ctx.root,{host:'codex'}).conclusive,false);
  });
  test('Codex same-project command in a different working directory cannot verify the declared invocation',()=>{
    const ctx=setup('codex'),p=event(ctx,'success','different-cwd',1);
    const rows=fs.readFileSync(ctx.transcript,'utf8').trim().split('\n').map(JSON.parse);
    for(const row of rows)row.payload.item.cwd=pathToFileURL(path.join(ctx.root,'other')).href;
    fs.writeFileSync(ctx.transcript,rows.map(JSON.stringify).join('\n')+'\n');
    assert.strictEqual(observation.commandObservation(p,ctx.root,{host:'codex'}).conclusive,false);
  });
  for(const host of ['claude','codex']){
    for(const mutation of ['untracked source','verification configuration'])test(`${host}: ${mutation} changes invalidate actual prior success`,()=>{
      const ctx=setup(host),p=event(ctx,'success','before-input-change',1);
      const executed=require('child_process').spawnSync(process.execPath,['check.js'],{cwd:ctx.root,encoding:'utf8'});
      assert.strictEqual(executed.status,0,executed.stderr);start(ctx,p);finish(ctx,p);assert.strictEqual(gate(ctx),0);
      if(mutation==='untracked source')fs.writeFileSync(path.join(ctx.root,'new-input.js'),'module.exports = 42;\n');
      else fs.writeFileSync(path.join(ctx.root,'.crabshell','verification','manifest.json'),JSON.stringify({tools:{additional:'node another-required-check.js'}}));
      assert.strictEqual(gate(ctx),2);
      assert.strictEqual(completion.decideStop(ctx.root,ctx.common).action,'block');
    });
    test(`${host}: success then failure blocks both decisions, repaired check restores success`,()=>{
      const ctx=setup(host);
      for(const [result,id,order,expected] of [['success','one',1,0],['failure','two',2,2],['success','three',3,0]]){
        const p=event(ctx,result,id,order);start(ctx,p);finish(ctx,p);
        assert.strictEqual(gate(ctx),expected);
        assert.strictEqual(completion.decideStop(ctx.root,ctx.common).action,expected===0?'allow':'block');
      }
    });
    test(`${host}: duplicate delivery is not another retry, distinct calls are`,()=>{
      const ctx=setup(host),first=event(ctx,'failure','same',1);
      start(ctx,first);finish(ctx,first);finish(ctx,first);
      assert.strictEqual(state(ctx).repeatedFailure.count,1);
      const next=event(ctx,'failure','new',2);start(ctx,next);finish(ctx,next);
      assert.strictEqual(state(ctx).repeatedFailure.count,2);
      assert.strictEqual(completion.decideStop(ctx.root,ctx.common).reportOnly,true);
    });
    test(`${host}: late success cannot replace the more recently started failure`,()=>{
      const ctx=setup(host),older=event(ctx,'success','old',1),newer=event(ctx,'failure','new',2);
      start(ctx,older);start(ctx,newer);finish(ctx,newer);finish(ctx,older);
      assert.strictEqual(state(ctx).observation.passed,false);
      assert.strictEqual(gate(ctx),2);
    });
    test(`${host}: ordinary Bash avoids whole-source reads but decision detects equal-size equal-mtime edits`,()=>{
      const ctx=setup(host),p=event(ctx,'success','initial',1);start(ctx,p);finish(ctx,p);
      const file=path.join(ctx.root,'app.js'),before=fs.statSync(file);
      const read=fs.readFileSync;let reads=0;
      fs.readFileSync=function(target,...args){if(target===file)reads++;return read.call(this,target,...args);};
      try{handlePayload({...ctx.common,hook_event_name:'PostToolUse',tool_name:'Bash',tool_input:{command:'node --version'},tool_response:'v20'}, {host,projectDir:ctx.root});}
      finally{fs.readFileSync=read;}
      assert.strictEqual(reads,0);
      fs.writeFileSync(file,'module.exports = 2;\n');fs.utimesSync(file,before.atime,before.mtime);
      assert.strictEqual(fs.statSync(file).size,before.size);
      assert.strictEqual(completion.decideStop(ctx.root,ctx.common).action,'block');
      assert.strictEqual(gate(ctx),2);
    });
  }
  test('failure without a numeric exit remains failure rather than an invented code',()=>{
    const ctx=setup('claude'),p=event(ctx,'failure','spawn-error',1);
    p.error='Could not start shell process';
    const result=observation.commandObservation(p,ctx.root,{host:'claude'});
    assert.strictEqual(result.exitCode,null);assert.strictEqual(result.conclusive,true);assert.strictEqual(result.passed,false);
  });
  test('running completion can finish, but an interrupted invocation cannot revive',()=>{
    for(const terminal of [false,true]){
      const ctx=setup('claude'),p=event(ctx,'success','async',1);start(ctx,p);
      const incomplete={...p,tool_response:{...p.tool_response,...(terminal?{interrupted:true}:{status:'running'})}};
      finish(ctx,incomplete);assert.strictEqual(gate(ctx),2);
      finish(ctx,p);
      assert.strictEqual(gate(ctx),terminal?2:0);
    }
  });
  test('a different passing check cannot erase an unresolved failed check',()=>{
    const ctx=setup('claude'),failed=event(ctx,'failure','bad',1);start(ctx,failed);finish(ctx,failed);
    fs.writeFileSync(path.join(ctx.root,'.crabshell','verification','manifest.json'),JSON.stringify({tools:{other:'node other-check.js'}}));
    const other={...event(ctx,'success','other',2),tool_input:{command:'node other-check.js'}};
    start(ctx,other);finish(ctx,other);
    assert.strictEqual(gate(ctx),2);
  });
  test('Codex apply_patch file changes arm the commit gate without requiring a child claim',()=>{
    const ctx=setup('codex');
    completion.saveState(ctx.root,completion.defaultState());
    fs.writeFileSync(path.join(ctx.root,'new-source.js'),'module.exports = true;\n');
    handlePayload({...ctx.common,hook_event_name:'PostToolUse',tool_name:'apply_patch',tool_input:{command:'*** Begin Patch\n*** Add File: new-source.js\n+module.exports = true;\n*** End Patch'}},{host:'codex',projectDir:ctx.root});
    assert.strictEqual(gate(ctx),2);
  });
  test('parallel result writers preserve every independent check',()=>{
    const ctx=setup('claude');
    const commands=['node a.js','node b.js','node c.js','node d.js'];
    fs.writeFileSync(path.join(ctx.root,'.crabshell','verification','manifest.json'),JSON.stringify({tools:Object.fromEntries(commands.map((cmd,i)=>['check'+i,cmd]))}));
    const base=event(ctx,'success','base',1);
    const worker=path.join(ctx.root,'writer.js');
    fs.writeFileSync(worker,`const c=require(${JSON.stringify(path.join(__dirname,'core/completion-control'))});const p=JSON.parse(process.argv[2]);c.prepareParentCheck(p.cwd,{...p,hook_event_name:'PreToolUse'});c.recordParentObservation(p.cwd,p,{host:'claude'});`);
    const payloads=commands.map((command,i)=>({...base,tool_use_id:'parallel-'+i,tool_input:{command}}));
    const dispatch=`const {spawn}=require('child_process');for(const p of ${JSON.stringify(payloads)}){const c=spawn(process.execPath,[${JSON.stringify(worker)},JSON.stringify(p)],{env:process.env,windowsHide:true});c.stdout.resume();c.stderr.pipe(process.stderr);c.on('close',code=>{if(code!==0)process.exitCode=1;});}`;
    const result=require('child_process').spawnSync(process.execPath,['-e',dispatch],{encoding:'utf8',windowsHide:true,timeout:10000});
    assert.strictEqual(result.status,0,result.stderr);
    assert.strictEqual(Object.keys(state(ctx).checkHistory.results).length,commands.length);
    assert.strictEqual(Object.keys(state(ctx).checkHistory.pending).length,0);
  });
  console.log(`RESULT: ${passed} passed, 0 failed`);
}finally{
  if(path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(temp).startsWith('crabshell native evidence '))fs.rmSync(temp,{recursive:true,force:true});
}
