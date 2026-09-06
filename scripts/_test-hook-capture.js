'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { captureHookInput } = require('./core/hook-capture');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell capture '));
const root = path.join(temp, 'project');
const captures = path.join(root, '.crabshell', 'captures');
fs.mkdirSync(path.join(root, '.crabshell'), { recursive: true });
fs.mkdirSync(path.join(root, '.git'));
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/hook-payloads/claude-posttooluse-bash-success.json'), 'utf8'));
const raw = '\n  ' + JSON.stringify({ ...fixture, cwd: root, prompt: '한국어 입력' }, null, 2) + '\n';
const env = { ...process.env, CLAUDE_PROJECT_DIR: root, CRABSHELL_HOOK_CAPTURE_DIR: captures };
delete env.HOOK_DATA;
const reader = `require(${JSON.stringify(path.join(__dirname, 'transcript-utils'))}).readStdin(200,{host:process.env.CAPTURE_TEST_HOST||'claude'}).then(x=>{process.stdout.write(JSON.stringify(x));process.exit(0)});`;
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('PASS: '+name); }
function entries() { return fs.existsSync(captures) ? fs.readdirSync(captures).filter(f=>f.endsWith('.input.json')) : []; }
function run(input, overrides = {}) {
  return spawnSync(process.execPath, ['-e', reader], { input, cwd: root, env: {...env,...overrides}, encoding: 'utf8', windowsHide: true, timeout: 5000 });
}
try {
  test('disabled capture leaves the ordinary stdin result and storage unchanged', () => {
    const result = run(raw, {CRABSHELL_HOOK_CAPTURE_DIR:''});
    assert.strictEqual(result.status,0);
    assert.deepStrictEqual(JSON.parse(result.stdout),JSON.parse(raw));
    assert.strictEqual(fs.existsSync(captures),false);
  });
  test('stdin bytes and distinct metadata survive unchanged', () => {
    const result=run(raw);
    assert.strictEqual(result.status,0,result.stderr);
    assert.deepStrictEqual(JSON.parse(result.stdout),JSON.parse(raw));
    const file=entries()[0];
    assert.strictEqual(fs.readFileSync(path.join(captures,file),'utf8'),raw);
    const meta=JSON.parse(fs.readFileSync(path.join(captures,file.replace('.input.json','.meta.json')),'utf8'));
    assert.strictEqual(meta.transport,'stdin');
    assert.strictEqual(meta.host,'claude');
    assert.strictEqual(meta.complete,true);
    assert.strictEqual(meta.inputBytes,Buffer.byteLength(raw));
    assert.strictEqual(meta.inputSha256,require('crypto').createHash('sha256').update(raw).digest('hex'));
  });
  test('HOOK_DATA is identified as a different transport', () => {
    const before=new Set(entries());
    const result=run('',{HOOK_DATA:raw});
    assert.strictEqual(result.status,0);
    const file=entries().find(x=>!before.has(x));
    assert.strictEqual(fs.readFileSync(path.join(captures,file),'utf8'),raw);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(captures,file.replace('.input.json','.meta.json')))).transport,'HOOK_DATA');
  });
  test('Codex keeps its host label and derives the project from payload cwd', () => {
    const before=new Set(entries());
    const result=run(raw,{CAPTURE_TEST_HOST:'codex',CLAUDE_PROJECT_DIR:path.join(temp,'wrong-project')});
    assert.strictEqual(result.status,0);
    const file=entries().find(x=>!before.has(x));
    assert.ok(file.startsWith('codex-'));
  });
  test('outside storage is rejected before any directory is created', () => {
    const outside=path.join(temp,'outside');
    const result=run(raw,{CRABSHELL_HOOK_CAPTURE_DIR:outside});
    assert.strictEqual(result.status,0);
    assert.deepStrictEqual(JSON.parse(result.stdout),JSON.parse(raw));
    assert.strictEqual(fs.existsSync(outside),false);
    assert.strictEqual(captureHookInput(raw,{env:{...env,CRABSHELL_HOOK_CAPTURE_DIR:root}}).captured,false);
  });
  test('directory links cannot send captured input to another directory', () => {
    const destination=path.join(temp,'link-destination');
    fs.mkdirSync(destination);
    const link=path.join(root,'.crabshell','capture-link');
    fs.symlinkSync(destination,link,process.platform==='win32'?'junction':'dir');
    const result=run(raw,{CRABSHELL_HOOK_CAPTURE_DIR:path.join(link,'nested')});
    assert.strictEqual(result.status,0);
    assert.deepStrictEqual(fs.readdirSync(destination),[]);
  });
  test('capture write errors do not affect the returned hook payload', () => {
    const file=path.join(root,'.crabshell','not-a-directory');
    fs.writeFileSync(file,'preserve');
    const result=run(raw,{CRABSHELL_HOOK_CAPTURE_DIR:path.join(file,'nested')});
    assert.strictEqual(result.status,0);
    assert.deepStrictEqual(JSON.parse(result.stdout),JSON.parse(raw));
    assert.strictEqual(fs.readFileSync(file,'utf8'),'preserve');
  });
  test('rapid captures do not overwrite earlier raw input', () => {
    const files=[];
    for(let i=0;i<20;i++) files.push(captureHookInput(raw,{env}).inputFile);
    assert.strictEqual(new Set(files).size,files.length);
    for(const file of files) assert.strictEqual(fs.readFileSync(file,'utf8'),raw);
  });
  test('malformed input remains the original failed-open result and is not rewritten', () => {
    const before=new Set(entries());
    const malformed='{ broken input\n';
    const result=run(malformed);
    assert.strictEqual(result.status,0);
    assert.deepStrictEqual(JSON.parse(result.stdout),{});
    const file=entries().find(x=>!before.has(x));
    assert.strictEqual(fs.readFileSync(path.join(captures,file),'utf8'),malformed);
  });
  test('parallel hook processes preserve separate captures', () => {
    const before=new Set(entries());
    const launch=`const {spawn}=require('child_process');for(let i=0;i<4;i++){const p=spawn(process.execPath,['-e',${JSON.stringify(reader)}],{env:process.env,windowsHide:true});p.stdout.resume();p.stderr.resume();p.stdin.end(${JSON.stringify(raw)});p.on('close',code=>{if(code!==0)process.exitCode=1;});}`;
    const result=spawnSync(process.execPath,['-e',launch],{cwd:root,env,encoding:'utf8',windowsHide:true,timeout:5000});
    assert.strictEqual(result.status,0,result.stderr);
    const added=entries().filter(x=>!before.has(x));
    assert.strictEqual(added.length,4);
    for(const file of added)assert.strictEqual(fs.readFileSync(path.join(captures,file),'utf8'),raw);
  });
  test('a timeout labels the original partial input rather than a completed envelope', () => {
    const before=new Set(entries());
    const partial='{ "partial": true';
    const launch=`const p=require('child_process').spawn(process.execPath,['-e',${JSON.stringify(reader)}],{env:process.env,windowsHide:true});p.stdout.pipe(process.stdout);p.stderr.pipe(process.stderr);p.stdin.write(${JSON.stringify(partial)});p.on('close',code=>{process.exitCode=code;});`;
    const result=spawnSync(process.execPath,['-e',launch],{cwd:root,env,encoding:'utf8',windowsHide:true,timeout:5000});
    assert.strictEqual(result.status,0,result.stderr);
    assert.deepStrictEqual(JSON.parse(result.stdout),{});
    const file=entries().find(x=>!before.has(x));
    assert.strictEqual(fs.readFileSync(path.join(captures,file),'utf8'),partial);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(captures,file.replace('.input.json','.meta.json')))).complete,false);
  });
  console.log(`RESULT: ${passed} passed, 0 failed`);
} finally {
  const expected=path.resolve(os.tmpdir())+path.sep;
  if(path.resolve(temp).startsWith(expected) && path.basename(temp).startsWith('crabshell capture ')) fs.rmSync(temp,{recursive:true,force:true});
}
