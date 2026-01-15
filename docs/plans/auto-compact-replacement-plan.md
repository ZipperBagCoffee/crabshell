# Auto-Compacting Replacement Plan

## Overview

Replace Claude Code's built-in auto-compacting with Memory Keeper's controlled memory management.

## Current State: Claude Auto-Compacting

```
Total Context: 200k tokens
├── Usable Space: ~155k tokens (77.5%)
├── Auto-compact Buffer: ~45k tokens (22.5%)
└── Trigger: Auto-compacts when approaching limit
```

**Behavior:**
- Claude automatically summarizes old conversation when context fills
- User has no control over timing or content selection
- Summarization quality: Claude with full context awareness

## Proposed State: Memory Keeper Managed

```
Total Context: 200k tokens (assumption: buffer becomes usable)
├── System Prompt: ~3k tokens
├── System Tools: ~17k tokens
├── MCP Tools: ~300 tokens (varies by config)
├── Custom Agents: ~300 tokens (varies by plugins)
├── Skills: ~800 tokens (varies by plugins)
├── Memory Files: ~400 tokens (CLAUDE.md etc)
├── Working Space: ~178k tokens
└── Trigger: Manual /clear + memory.md load
```

**Note:** Actual working space depends on installed plugins and MCP servers.

**Proposed Flow:**
1. Disable auto-compacting in Claude Code settings
2. Memory Keeper continues incremental delta saves (every 5 tool uses)
3. User monitors context with `/context` command
4. At threshold (e.g., 80%), user executes:
   - `/save-memory` (ensure latest saved)
   - `/clear` (reset context)
   - `/load-memory` (restore from memory.md)

## Architecture

### Phase 1: Manual Trigger (Current Capability)

```
┌─────────────────────────────────────────────────────────┐
│                    Session Runtime                       │
├─────────────────────────────────────────────────────────┤
│  [UserPromptSubmit]                                      │
│       │                                                  │
│       ├── inject-rules.js: Rules injection              │
│       ├── counter.js check(): Delta extraction          │
│       └── inject-rules.js: Delta trigger                │
│                                                          │
│  [Every 5 tool uses]                                     │
│       │                                                  │
│       └── delta_temp.txt created                        │
│           └── memory-delta skill triggered              │
│               └── Haiku summarizes → memory.md          │
│                                                          │
│  [Manual: User monitors /context]                        │
│       │                                                  │
│       └── At 80%: /save-memory → /clear → /load-memory  │
└─────────────────────────────────────────────────────────┘
```

### Phase 2: Semi-Automatic (Future Enhancement)

```
┌─────────────────────────────────────────────────────────┐
│  [UserPromptSubmit]                                      │
│       │                                                  │
│       ├── Estimate current context tokens               │
│       │   (Challenge: How to estimate accurately?)       │
│       │                                                  │
│       └── If > threshold:                               │
│           └── Output warning: "Context at X%. Consider   │
│               /save-memory && /clear && /load-memory"   │
└─────────────────────────────────────────────────────────┘
```

### Phase 3: Fully Automatic (Requires Anthropic Support)

```
┌─────────────────────────────────────────────────────────┐
│  [PreAutoCompact Hook] (Does not exist yet)             │
│       │                                                  │
│       ├── Extract compaction candidates                 │
│       ├── Save to memory.md with full context           │
│       └── Allow Claude to proceed with compaction       │
│           (or block and do manual clear)                │
└─────────────────────────────────────────────────────────┘
```

## Research Findings (2026-01-14)

### 1. Auto-Compact Disable Setting - VERIFIED
**Answer:** Setting EXISTS. Can be disabled.

**Methods:**
1. Edit `~/.claude.json`:
   ```json
   { "autoCompactEnabled": false }
   ```
2. Use `/config` command in session and toggle "Auto-compact enabled" OFF

**GitHub Issues Context:**
- Issue #6689: Requests `--no-auto-compact` CLI flag (not implemented)
- Issue #12053: Requests freeing 22.5% buffer when disabled
- Current limitation: Global setting only, no per-project or CLI override

**Implication:** Original proposal IS possible. Can disable auto-compact.

### 2. Hard Limit Behavior - VERIFIED
**Answer:** Validation error (not silent truncation)

**Evidence:**
- Starting with Claude Sonnet 3.7+, exceeding context returns validation error
- Full chat history preserved even after summarization
- Claude "organizes thoughts" (visible to user) during auto-compact

**Implication:** Predictable failure mode - recoverable but disruptive.

### 3. Auto-Compact Trigger Point - NEW INFO
**Finding:** Claude Code now triggers at ~75% utilization (not 95%)

**Evidence:**
- Leaves ~25% (50k tokens) for reasoning space
- More conservative than before to prevent quality degradation
- Performance degrades significantly near limits

**Implication:** Effective usable space is ~150k, not ~155k.

### 4. Context Token Estimation - SOLVED (2026-01-15)
**Answer:** Parse JSONL transcript file from `~/.claude/projects/`

**Method:**
1. Hook receives `transcript_path` via stdin JSON (or derive from project path)
2. Parse JSONL file, find last `assistant` entry with `message.usage`
3. Calculate: `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`
4. Compare against 200k context window

**Implementation:**
```javascript
const lines = fs.readFileSync(transcriptPath, 'utf8').trim().split('\n');
for (let i = lines.length - 1; i >= 0; i--) {
  const entry = JSON.parse(lines[i]);
  if (entry.type === 'assistant' && entry.message?.usage) {
    const u = entry.message.usage;
    const total = (u.input_tokens || 0) +
                  (u.cache_creation_input_tokens || 0) +
                  (u.cache_read_input_tokens || 0);
    return { total, percent: (total / 200000 * 100) };
  }
}
```

**Verified:** Working - tested on live session, accurate to /context command

### 5. Summarization Quality Comparison
**Question:** Is Memory Keeper's incremental Haiku summarization as good as Claude's auto-compact summarization?

**Considerations:**
- Auto-compact: Single pass with full context awareness (likely Sonnet/Opus)
- Memory Keeper: Incremental with Haiku, potentially fragmented
- Trade-off: Control vs quality vs cost

**Options to Improve:**
- Use Sonnet instead of Haiku for delta summarization (higher quality, higher cost)
- Batch summarization: accumulate more before summarizing (better context)
- Hybrid: Haiku for incremental, Sonnet for rotation summaries

**Verification Method:** Qualitative comparison over multiple sessions

## Implementation Considerations

### Settings Required
```json
{
  "autoCompactEnabled": false  // VERIFIED - in ~/.claude.json or via /config
}
```

### New Commands/Skills Needed
1. `/context-check` - Quick context usage display
2. `/soft-restart` - Atomic: save → clear → load
3. Context warning in UserPromptSubmit hook output

### 70% Threshold Behavior (Phase 2 Core)

**Trigger:** Context usage ≥ 70% (140k of 200k tokens)

**Detection Method:**
1. `inject-rules.js` reads current session transcript from `~/.claude/projects/`
2. Parse last `assistant` entry's `message.usage`
3. Calculate: `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`
4. If ≥ 140,000 → inject warning

**LIMITATION: Claude cannot execute /clear**
- Tested: `Skill tool` cannot invoke `/clear` ("not a prompt-based skill")
- `/clear` is user-only command
- Full automation impossible, semi-automation only

**Semi-Automatic Notification System:**

| Threshold | stderr (User Terminal) | additionalContext (Claude) |
|-----------|------------------------|---------------------------|
| 70% | `[MEMORY KEEPER] 70% - /clear 권장` | Tell user to run /clear |
| 80% | `[CRITICAL] 80% - 지금 /clear 하세요` | Strongly urge /clear |

**70% - User Warning (stderr):**
```javascript
console.error(`[MEMORY KEEPER] Context ${percent}% - /clear 권장`);
```

**70% - Claude Instruction (additionalContext):**
```
[CONTEXT_WARNING] Usage: {percent}%
Inform user: "Context at {percent}%. Recommend running /clear to free space."
```

**80% - Critical Warning (stderr):**
```javascript
console.error(`[CRITICAL] Context ${percent}% - 지금 /clear 하세요`);
```

**`/soft-restart` Skill Steps:**
1. `/save-memory` - Ensure current context saved to memory.md
2. `/clear` - Reset Claude's context window
3. `/load-memory` - Restore memory.md into fresh context

**Rationale:**
- Hook cannot force Claude to execute, only instruct
- stderr bypasses Claude, goes directly to user terminal
- Dual approach ensures user always knows, regardless of Claude compliance

**Post-Clear Memory Restoration:**
- SessionStart hook automatically runs `load-memory.js` after `/clear`
- Loads: memory.md tail (50 lines), L3 summaries, unreflected L1 content
- Verified working: memory context restored after clear
- Note: 50-line limit may truncate important content

### Risk Mitigation
- Always maintain L1 raw logs as backup
- Memory.md rotation ensures no unbounded growth
- L3 summaries provide long-term searchable history

### Graceful Degradation
If user forgets to /clear and hits hard limit:
1. **Best case:** Claude shows warning, request blocked but recoverable
2. **Worst case:** Session crash, but L1 logs preserved for recovery
3. **Mitigation:** Add persistent warning after 70% context usage

## Comparison Matrix

| Aspect | Auto-Compact | Memory Keeper |
|--------|--------------|---------------|
| User Control | None | Full |
| Timing | Automatic | Manual/Semi-auto |
| Summary Quality | High (full context) | Medium (incremental) |
| Persistence | Session only | Cross-session |
| Searchability | None | L3 summaries |
| Recovery | Lost on crash | Always saved |
| Complexity | Zero | Medium |

## Conclusion

**Strategy A: CONFIRMED (2026-01-15)**
- Auto-compact disabled via `~/.claude.json` or `/config` ✓
- Buffer freed, ~45k extra tokens usable ✓

**Current Workflow:**
1. Disable auto-compact: `"autoCompactEnabled": false`
2. Memory Keeper saves incremental deltas (every 5 tool uses)
3. User monitors context with `/context`
4. At ~80%, execute `/save-memory` → `/clear` → `/load-memory`

**Phase 2 Goal:** Semi-automate step 4:
- Hook detects 70%+ context usage
- Claude asks user: "Context at X%. Run /soft-restart?"
- User confirms → Claude executes save → clear → load

## Next Steps

### Phase 1: Complete ✓
1. [x] Verify auto-compact disable setting - DONE
2. [x] Verify hard limit behavior - DONE (validation error)
3. [x] Test `autoCompactEnabled: false` - DONE (buffer freed)

### Phase 2: Semi-Automatic (Priority Order)
4. [ ] **Prototype `/soft-restart`** - Immediate value, simple implementation
5. [x] **Investigate context token estimation** - DONE (JSONL transcript parsing)
6. [x] **Add context warning to inject-rules.js** - DONE (signal file creation at 70%+)
7. [x] **External auto-clear watcher** - DONE (PowerShell script)
8. [ ] Compare summarization quality - Long-term evaluation

### Phase 2.5: External Auto-Clear (IMPLEMENTED 2026-01-15)

**Problem:** Claude cannot execute `/clear` programmatically (not exposed as a tool)

**Solution:** External PowerShell watcher script

**Architecture:**
```
┌─────────────────────────────────────────────────────────────────┐
│  inject-rules.js (runs every prompt)                            │
│       │                                                         │
│       ├── Parse JSONL transcript for context usage              │
│       │                                                         │
│       └── If ≥70%: Create ~/.claude/clear-signal               │
│                                                                 │
│  auto-clear-watcher.ps1 (runs in separate terminal)             │
│       │                                                         │
│       ├── Polls for ~/.claude/clear-signal every 2 seconds      │
│       │                                                         │
│       └── When detected:                                        │
│           ├── Find Claude Code window by title                  │
│           ├── Activate window (SetForegroundWindow)             │
│           ├── Send "/clear" + ENTER (SendKeys)                  │
│           └── Delete signal file                                │
│                                                                 │
│  SessionStart hook (runs after /clear)                          │
│       │                                                         │
│       └── load-memory.js restores memory.md                     │
└─────────────────────────────────────────────────────────────────┘
```

**Files:**
- `scripts/inject-rules.js` - Signal file creation at 70%+
- `scripts/auto-clear-watcher.ps1` - PowerShell watcher
- `scripts/start-auto-clear.bat` - Easy startup script

**Usage:**
1. Start watcher: Double-click `start-auto-clear.bat` or run in PowerShell
2. Use Claude Code normally
3. At 70%+ context, `/clear` is automatically sent
4. Memory is automatically restored by SessionStart hook

## References

- [Claude Code auto-compact explanation](https://claudelog.com/faqs/what-is-claude-code-auto-compact/)
- [GitHub Issue #6689: --no-auto-compact flag request](https://github.com/anthropics/claude-code/issues/6689)
- [GitHub Issue #12053: Turn off buffer request](https://github.com/anthropics/claude-code/issues/12053)
- [GitHub Issue #10691: autoCompact settings request](https://github.com/anthropics/claude-code/issues/10691)
- [How Claude Code Got Better by Protecting More Context](https://hyperdev.matsuoka.com/p/how-claude-code-got-better-by-protecting)
- [Context Windows - Claude Docs](https://docs.claude.com/en/docs/build-with-claude/context-windows)
- [How to Calculate Your Claude Code Context Usage](https://codelynx.dev/posts/calculate-claude-code-context)
- [Hooks reference - Claude Code Docs](https://code.claude.com/docs/en/hooks)
- [ccusage - JSONL analysis CLI](https://github.com/ryoppippi/ccusage)
- [Token Audit MCP](https://github.com/littlebearapps/token-audit)
- Memory Keeper architecture: ./ARCHITECTURE.md
- Current implementation: ./trigger-mechanism-analysis.md
