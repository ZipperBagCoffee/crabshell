#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');

const MEMORY_DIR = path.join(os.homedir(), '.claude', 'memory-keeper', 'sessions');
const PROJECT_NAME = path.basename(process.env.CLAUDE_PROJECT_DIR || process.cwd());

// Create directory if it doesn't exist
if (!fs.existsSync(MEMORY_DIR)) {
    fs.mkdirSync(MEMORY_DIR, { recursive: true });
    process.exit(0);
}

// Get all .md files sorted by modification time (newest first)
const files = fs.readdirSync(MEMORY_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => ({ name: f, path: path.join(MEMORY_DIR, f), mtime: fs.statSync(path.join(MEMORY_DIR, f)).mtime }))
    .sort((a, b) => b.mtime - a.mtime);

// Current project files (top 3)
const projectFiles = files.filter(f => f.name.startsWith(PROJECT_NAME + '_')).slice(0, 3);

// Other project files (top 2)
const otherFiles = files.filter(f => !f.name.startsWith(PROJECT_NAME + '_')).slice(0, 2);

if (projectFiles.length === 0 && otherFiles.length === 0) {
    console.log('🧠 Memory Keeper: No saved sessions found.');
    process.exit(0);
}

console.log('=== 🧠 SESSION MEMORY LOADED ===\n');

if (projectFiles.length > 0) {
    console.log(`📁 This Project (${PROJECT_NAME}):`);
    console.log('---');
    for (const f of projectFiles) {
        console.log(`\n### ${path.basename(f.name, '.md')}`);
        console.log(fs.readFileSync(f.path, 'utf8'));
    }
}

if (otherFiles.length > 0) {
    console.log('\n🌐 Recent from other projects:');
    console.log('---');
    for (const f of otherFiles) {
        console.log(`\n### ${path.basename(f.name, '.md')}`);
        const content = fs.readFileSync(f.path, 'utf8').split('\n').slice(0, 20).join('\n');
        console.log(content);
        console.log('...');
    }
}

console.log('\n=== END MEMORY ===');
