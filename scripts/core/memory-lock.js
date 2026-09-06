'use strict';
const fs=require('fs');
const path=require('path');
const {STORAGE_ROOT,MEMORY_DIR,INDEX_FILE,INDEX_LOCK_FILE}=require('../constants');
const {acquireIndexLock,releaseIndexLock,acquireLock,releaseLock}=require('../utils');

function memoryDirectory(projectDir){
  const root=path.resolve(projectDir),directory=path.join(root,STORAGE_ROOT,MEMORY_DIR);
  let current=directory;
  while(current!==root){
    if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())throw Error('Linked memory storage is not supported for this write.');
    current=path.dirname(current);
  }
  fs.mkdirSync(directory,{recursive:true});
  return directory;
}
function withMemoryIndex(projectDir,action){
  const directory=memoryDirectory(projectDir);
  let owned=false;
  try{owned=fs.readFileSync(path.join(directory,INDEX_LOCK_FILE),'utf8').trim()===String(process.pid);}catch{}
  const acquired=owned?false:acquireIndexLock(directory);
  if(!owned&&!acquired)throw Error('Memory index is busy; data was preserved for retry.');
  try{return action(directory);}finally{if(acquired)releaseIndexLock(directory);}
}
function withMemoryRotation(directory,action){
  if(!acquireLock(directory))throw Error('Memory rotation is busy; data was preserved for retry.');
  try{return action();}finally{releaseLock(directory);}
}
function regularFile(file){
  if(fs.existsSync(file)&&(!fs.lstatSync(file).isFile()||fs.lstatSync(file).isSymbolicLink()))throw Error('Expected an ordinary project memory file: '+path.basename(file));
}
function readMemoryIndex(directory){
  const file=path.join(directory,INDEX_FILE);regularFile(file);
  if(!fs.existsSync(file))return {};
  const value=JSON.parse(fs.readFileSync(file,'utf8'));
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid memory index; original data preserved.');
  return value;
}
module.exports={withMemoryIndex,withMemoryRotation,memoryDirectory,readMemoryIndex,regularFile};
