'use strict';
function formatMemoryEntry(summary,date=new Date()){
  const p=value=>String(value).padStart(2,'0');
  const utc=`${date.getUTCFullYear()}-${p(date.getUTCMonth()+1)}-${p(date.getUTCDate())}_${p(date.getUTCHours())}${p(date.getUTCMinutes())}`;
  const local=`${p(date.getMonth()+1)}-${p(date.getDate())}_${p(date.getHours())}${p(date.getMinutes())}`;
  const header=`## ${utc} (local ${local})`;
  return {header,text:`\n${header}\n${summary}\n`};
}
module.exports={formatMemoryEntry};
