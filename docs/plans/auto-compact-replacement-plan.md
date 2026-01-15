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

## Research Findings (2025-01-14)

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

### 4. Context Token Estimation - STILL UNKNOWN
**Question:** How can hooks estimate current context usage?

**Possibilities:**
- A) Count tokens from L1 session log (incomplete - misses system prompt, tools)
- B) Parse /context output (not available in hooks)
- C) Track message tokens incrementally (complex, prone to drift)
- D) API provides this info somewhere (need to investigate)

**Verification Method:** Claude Code API documentation, experimentation

### 4. Summarization Quality Comparison
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
  "autoCompact": false  // Need to verify this setting exists
}
```

### New Commands/Skills Needed
1. `/context-check` - Quick context usage display
2. `/soft-restart` - Atomic: save → clear → load
3. Context warning in UserPromptSubmit hook output

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

**Original Proposal: VIABLE**
- Auto-compact CAN be disabled via `~/.claude.json` or `/config`
- Remaining unknown: Does disabling free the 45k buffer?

**Two Strategies:**

### Strategy A: Replace Auto-Compact (If Buffer Freed)
1. Disable auto-compact: `"autoCompactEnabled": false`
2. Gain ~45k extra usable tokens (needs verification)
3. User monitors context with `/context`
4. At ~80%, execute `/save-memory` → `/clear` → `/load-memory`

### Strategy B: Complement Auto-Compact (If Buffer NOT Freed)
Memory Keeper works WITH auto-compact:
1. **Pre-compact saves**: Delta saves preserve context before auto-compact loses it
2. **Cross-session persistence**: Auto-compact only helps within session
3. **Searchable history**: Auto-compact summaries are lost; L3 summaries are searchable
4. **Recovery**: Auto-compact can't recover from crashes; L1 logs can

**Next: Experiment Required**
Test with `autoCompactEnabled: false` to verify:
1. Does buffer become usable?
2. What happens at 200k limit?

## Next Steps

1. [x] Verify auto-compact disable setting - DONE (exists: ~/.claude.json or /config)
2. [x] Verify hard limit behavior - DONE (validation error)
3. [ ] **EXPERIMENT**: Test `autoCompactEnabled: false` - does buffer free up?
4. [ ] Investigate context token estimation methods
5. [ ] Prototype `/soft-restart` command
6. [ ] Add context warning to inject-rules.js
7. [ ] Compare summarization quality

## References

- [Claude Code auto-compact explanation](https://claudelog.com/faqs/what-is-claude-code-auto-compact/)
- [GitHub Issue #6689: --no-auto-compact flag request](https://github.com/anthropics/claude-code/issues/6689)
- [GitHub Issue #12053: Turn off buffer request](https://github.com/anthropics/claude-code/issues/12053)
- [GitHub Issue #10691: autoCompact settings request](https://github.com/anthropics/claude-code/issues/10691)
- [How Claude Code Got Better by Protecting More Context](https://hyperdev.matsuoka.com/p/how-claude-code-got-better-by-protecting)
- [Context Windows - Claude Docs](https://docs.claude.com/en/docs/build-with-claude/context-windows)
- Memory Keeper architecture: ./ARCHITECTURE.md
- Current implementation: ./trigger-mechanism-analysis.md
