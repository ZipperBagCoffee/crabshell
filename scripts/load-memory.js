const path = require('path');
const { getProjectDir, getProjectName, readFileOrDefault } = require('./utils');

function loadMemory() {
  const projectDir = getProjectDir();
  const memoryPath = path.join(projectDir, 'memory.md');
  const projectName = getProjectName();

  const memory = readFileOrDefault(memoryPath, null);

  if (memory) {
    console.log(`\n--- Memory Keeper: Loading context for ${projectName} ---\n`);
    console.log(memory);
    console.log(`\n--- End of Memory ---\n`);
  } else {
    console.log(`\n--- Memory Keeper: No previous memory for ${projectName} ---\n`);
  }
}

loadMemory();
