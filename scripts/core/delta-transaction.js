'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {INDEX_FILE,MEMORY_FILE,DELTA_TEMP_FILE,DELTA_JOBS_DIR,ARCHIVE_PREFIX}=require('../constants');
const {writeJson}=require('../utils');
const {withMemoryIndex,withMemoryRotation,readMemoryIndex,regularFile}=require('./memory-lock');
const {formatMemoryEntry}=require('./memory-entry');
const digest=data=>crypto.createHash('sha256').update(data).digest('hex');

function paths(directory,id){
  if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id||''))throw Error('Invalid delta job id.');
  const jobs=path.join(directory,DELTA_JOBS_DIR),job=path.join(jobs,id);
  for(const folder of [jobs,job])if(fs.existsSync(folder)&&fs.lstatSync(folder).isSymbolicLink())throw Error('Linked delta job directory is not allowed.');
  return {directory:job,input:path.join(job,'input.txt')};
}
function summaryPath(jobDirectory,file){
  const resolved=path.resolve(file||'');
  if(path.dirname(resolved)!==jobDirectory||!/^summary-[0-9a-f-]+\.txt$/i.test(path.basename(resolved)))throw Error('Summary must be a prepared file for this delta job.');
  regularFile(resolved);return resolved;
}
function prepared(directory,job,reused){
  const location=paths(directory,job.id);
  const summary=path.join(location.directory,`summary-${crypto.randomUUID()}.txt`);
  return {jobId:job.id,inputFile:location.input,summaryFile:summary,processedThrough:job.processedThrough,reused};
}
function prepareDelta(projectDir){
  return withMemoryIndex(projectDir,directory=>{
    const index=readMemoryIndex(directory),indexPath=path.join(directory,INDEX_FILE);
    let job=index.deltaJob;
    if(job&&job.status!=='complete'){
      const location=paths(directory,job.id);
      if(fs.existsSync(location.input)){
        regularFile(location.input);
        if(digest(fs.readFileSync(location.input))!==job.inputSha256)throw Error('Prepared delta input changed; nothing was discarded.');
        if(job.status==='preparing'){job.status='ready';writeJson(indexPath,index);}
        return prepared(directory,job,true);
      }
      if(job.status!=='preparing')throw Error('Prepared delta input is missing; queue and metadata were preserved.');
    }
    const source=path.join(directory,DELTA_TEMP_FILE);regularFile(source);
    if(!fs.existsSync(source)||fs.statSync(source).size===0)return {pending:false};
    const input=fs.readFileSync(source);
    job={id:job?.status==='preparing'?job.id:crypto.randomUUID(),status:'preparing',inputSha256:digest(input),inputBytes:input.length,
      processedThrough:index.pendingLastProcessedTs||null,preparedAt:new Date().toISOString()};
    const location=paths(directory,job.id);fs.mkdirSync(location.directory,{recursive:true});
    index.deltaJob=job;writeJson(indexPath,index);
    fs.renameSync(source,location.input);
    job.status='ready';index.deltaReady=false;index.deltaProcessing=false;writeJson(indexPath,index);
    return prepared(directory,job,false);
  });
}
function marker(job){return `<!-- crabshell-delta:${job.id}:${job.summarySha256} -->`;}
function hasCommit(directory,job){
  const names=[MEMORY_FILE,...fs.readdirSync(directory).filter(name=>name.startsWith(ARCHIVE_PREFIX)&&name.endsWith('.md'))];
  return names.some(name=>{const file=path.join(directory,name);regularFile(file);return fs.existsSync(file)&&fs.readFileSync(file,'utf8').includes(marker(job));});
}
function cleanupOwned(directory,job,extraSummary){
  const location=paths(directory,job.id),remaining=[];
  const files=[location.input];
  if(job.summaryFile)files.push(summaryPath(location.directory,path.join(location.directory,job.summaryFile)));
  if(extraSummary)files.push(summaryPath(location.directory,extraSummary));
  for(const file of new Set(files)){
    try{regularFile(file);if(fs.existsSync(file))fs.unlinkSync(file);}catch{remaining.push(file);}
  }
  return remaining;
}
function finalizeDelta(projectDir,id,submittedSummary){
  return withMemoryIndex(projectDir,directory=>withMemoryRotation(directory,()=>{
    const index=readMemoryIndex(directory),indexPath=path.join(directory,INDEX_FILE),job=index.deltaJob;
    if(!job||job.id!==id)throw Error('Delta job does not match the current prepared input.');
    const location=paths(directory,id);
    const submitted=summaryPath(location.directory,submittedSummary);
    if(job.status==='complete')return {completed:true,alreadyCompleted:true,cleanupRemaining:cleanupOwned(directory,job,submitted)};
    regularFile(location.input);
    if(!fs.existsSync(location.input)||digest(fs.readFileSync(location.input))!==job.inputSha256)throw Error('Prepared input is missing or changed; nothing was discarded.');
    const logbook=path.join(directory,MEMORY_FILE);regularFile(logbook);
    let committed=false;
    if(['appending','appended'].includes(job.status))committed=hasCommit(directory,job);
    if(!committed){
      if(job.status==='appended')throw Error('Previously committed summary is missing; input was preserved.');
      const source=job.summaryFile?summaryPath(location.directory,path.join(location.directory,job.summaryFile)):submitted;
      if(!fs.existsSync(source))throw Error('Prepared summary file not found.');
      const summary=fs.readFileSync(source,'utf8').trim();
      if(!summary)throw Error('Prepared summary is empty.');
      if(job.summarySha256&&job.summarySha256!==digest(summary))throw Error('Summary changed during finalization; original input was preserved.');
      job.summaryFile=path.basename(source);job.summarySha256=digest(summary);job.status='appending';writeJson(indexPath,index);
      const entry=formatMemoryEntry(summary).text+marker(job)+'\n';
      const fd=fs.openSync(logbook,'a');try{fs.writeFileSync(fd,entry);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
      job.status='appended';writeJson(indexPath,index);
    }
    if(job.processedThrough&&(!index.lastMemoryUpdateTs||job.processedThrough>index.lastMemoryUpdateTs))index.lastMemoryUpdateTs=job.processedThrough;
    const queue=path.join(directory,DELTA_TEMP_FILE);
    index.deltaReady=fs.existsSync(queue)&&fs.statSync(queue).size>0;
    index.deltaProcessing=false;delete index.memoryAppendedInThisRun;
    if(!index.deltaReady&&index.pendingLastProcessedTs&&job.processedThrough&&index.pendingLastProcessedTs<=job.processedThrough)delete index.pendingLastProcessedTs;
    job.status='complete';job.completedAt=new Date().toISOString();writeJson(indexPath,index);
    return {completed:true,alreadyCompleted:committed,newInputPending:index.deltaReady,cleanupRemaining:cleanupOwned(directory,job,submitted)};
  }));
}
function preparedInputExists(directory,job){
  try{if(!job||job.status==='complete')return false;const file=paths(directory,job.id).input;regularFile(file);return fs.existsSync(file);}catch{return false;}
}
module.exports={prepareDelta,finalizeDelta,preparedInputExists};
