'use strict';
const fs=require('fs');
const path=require('path');
const {STORAGE_ROOT,MEMORY_DIR,INDEX_FILE}=require('../constants');
const {acquireIndexLock,releaseIndexLock,ownsIndexLock,acquireLock,releaseLock}=require('../utils');

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
  const owned=ownsIndexLock(directory);
  const acquired=owned?false:acquireIndexLock(directory);
  if(!owned&&!acquired)throw Error('Memory index is busy; data was preserved for retry.');
  try{return action(directory);}finally{if(acquired)releaseIndexLock(directory);}
}
// Runs action under the memory index lock of a memory directory. When another
// process holds the lock past waitMs it skips instead of throwing and returns
// { ran: false } — hooks fail open; otherwise { ran: true, value }.
function tryWithMemoryIndex(directory,action,{waitMs}={}){
  if(!acquireIndexLock(directory,waitMs))return {ran:false};
  try{return {ran:true,value:action()};}finally{releaseIndexLock(directory);}
}
// Same for the rotation lock: { ran: false } when another rotation holds it.
function tryWithMemoryRotation(directory,action){
  if(!acquireLock(directory))return {ran:false};
  try{return {ran:true,value:action()};}finally{releaseLock(directory);}
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
module.exports={withMemoryIndex,tryWithMemoryIndex,withMemoryRotation,tryWithMemoryRotation,memoryDirectory,readMemoryIndex,regularFile};
