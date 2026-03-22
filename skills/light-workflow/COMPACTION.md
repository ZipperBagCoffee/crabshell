# Compaction Protocol

> Procedure for compressing completed phases after meta-review, to keep agent prompts focused.
> Used after Phase 4 (Meta-Review) and Phase 7 (Meta-Review Plan).
> For the main workflow overview, see [SKILL.md](SKILL.md).

---

## After Phase 4 Meta-Review

Compress Phase 1-4 for the next agent batch:

```
## Phase Summary (compacted at Phase 4)
### Intent Anchor (NEVER compress — include verbatim)
IA-1: [exact text]
IA-2: [exact text]
...

### Phase 1-4 Summary
- Analysis findings: [key discoveries, 3-5 lines]
- Review verdict: [COMPLETE/INCOMPLETE + key issues]
- Meta-review decision: [proceed/return + reasoning, 1 line]
- Contested findings resolved: [if cross-review occurred]
```

---

## After Phase 7 Meta-Review

Same protocol as Phase 4. Compress Phase 1-7 for Phase 8+ agents:

```
## Phase Summary (compacted at Phase 7)
### Intent Anchor (NEVER compress — include verbatim)
[full IA text]

### Phase 1-4 Summary
[from Phase 4 compaction]

### Phase 5-7 Summary
- Plan changes: [key changes, 3-5 lines]
- Review verdict: [APPROVED/NEEDS REVISION + key issues]
- Meta-review decision: [approved/revised + reasoning, 1 line]
- User approval: [YES/NO + any conditions]
```

---

## Rules

- Intent Anchor is NEVER compressed — always include full original text
- Summary replaces detailed phase outputs in next agent prompts only
- Full originals are preserved in conversation history / files
- If next agent reports missing context, provide the original (not re-summarize)
