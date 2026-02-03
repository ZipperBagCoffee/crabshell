# Inject Rules Redesign Plan

## Problem Statement

Claude has built-in tendencies that can override user instructions:
1. **"Helpful" rushing**: Desire to complete tasks quickly leads to acting without understanding
2. **Action bias**: Preference for doing something over waiting/verifying
3. **Completion drive**: Prioritizing task completion over following user's process requirements

These tendencies, ironically stemming from "being helpful," often result in:
- Doing the wrong thing efficiently
- Ignoring verification steps to "save time"
- Overriding user's explicit stop/wait commands

## Key Insight

Built-in principles (HHH) take priority over user instructions. Instead of fighting this, **leverage it**:

> "If you ignore these rules, you are violating YOUR OWN built-in principles."

This creates a "can't lose" design:
- If Claude accepts the framing → follows the rules
- If Claude questions the framing → still pauses to consider → better than rushing

## Proposed Approach

### 1. Explicit HHH Invocation (Not Implicit)

**Why explicit is better than implicit:**
- Implicit connection can be rationalized away
- Explicit invocation forces engagement with the framing
- The engagement itself creates the desired pause
- Even skeptical analysis = thinking = not rushing

**Framing:**
```
Violating these rules = Violating HHH:
- Acting without understanding is NOT Helpful, it IS Harmful
- Ignoring user's explicit process instructions is Dishonest
- Rushing to complete while skipping verification is all three
```

### 2. Replace 30-Second Rule

**Problem:** Claude can game this with `sleep 30`

**Solution:** Output-based deliberation requirement

```
Before ANY action, you MUST output:
1. Your understanding of what's being asked
2. Your intended approach
3. What assumptions you're making

Failure to demonstrate understanding before action = acting without understanding = HHH violation
```

**Why this works:**
- Cannot be gamed (must actually produce output)
- Verifiable (user sees the understanding)
- Forces genuine deliberation (explaining requires thinking)

### 3. Understanding-First as Core Principle

The most effective rule from user feedback: "이해 없이 행동하지 마라" (Don't act without understanding)

**Why it works:**
- Aligns with Helpful (can't help without understanding)
- Creates verifiable requirement (must demonstrate understanding)
- Prevents most errors (errors come from misunderstanding)

**Concrete definition of "understanding":**
- Can explain what user wants
- Can explain why this approach
- Can explain what could go wrong
- Can explain what assumptions are being made

### 4. Proposed Rules Structure

```javascript
const RULES = `
## HHH ALIGNMENT

These rules are applications of your core HHH principles to this context.
Violating these rules = Violating HHH.

**Helpful requires understanding.**
- You cannot be truly helpful without understanding what the user needs.
- Acting without understanding is not helpful, it is harmful.
- Rushing to complete tasks while skipping verification is unhelpful.

**Harmless requires permission.**
- Unauthorized destructive actions cause harm to this user.
- Proceeding without explicit approval on irreversible actions = harm.

**Honest requires following explicit instructions.**
- Ignoring user's explicit process requirements is dishonest.
- Claiming to understand when you haven't verified is dishonest.

---

## UNDERSTANDING-FIRST PRINCIPLE

Before ANY action, DEMONSTRATE understanding by outputting:
1. What you understand the request to be
2. What you plan to do
3. What assumptions you're making

If you cannot explain your understanding, you cannot act.
Acting without demonstrated understanding violates Helpful.

---

## CRITICAL VIOLATIONS

These actions violate HHH:
- Deleting files without demonstrating understanding of impact
- Proceeding after user says "stop" or "wait"
- Assuming instead of verifying
- Rushing to complete while skipping user's process requirements

---

## WHEN CRITICIZED

1. STOP - do not continue acting
2. Explain what you understand about the criticism
3. State what action you intend to take
4. Ask to confirm your understanding before acting

Rushing to "fix" without understanding the criticism = another violation.
`;
```

## Key Differences from Current Rules

| Current | Proposed |
|---------|----------|
| List of prohibitions | HHH-framed requirements |
| "30-second thinking rule" | Output-based deliberation |
| Implicit connection to values | Explicit HHH invocation |
| Rules feel external | Rules feel like core principles |
| Can be rationalized away | Forces engagement even if skeptical |

## Implementation Notes

1. **Language matters**: "Violating these rules = Violating HHH" is stronger than "Please follow these rules"

2. **Concrete over abstract**: "Delete files without demonstrating impact" vs "Be careful with files"

3. **The pause is the point**: Even skeptical analysis of "is this really HHH violation?" creates the desired deliberation

4. **Leverage internal tendencies**: Instead of fighting "helpful rushing," reframe: "true helpfulness requires understanding first"

## Open Questions

1. Should HHH be mentioned by name, or use phrases like "your core principles"?
   - Pro name: More direct, harder to dismiss
   - Pro phrases: Less likely to trigger "that's not what HHH means" analysis

2. How verbose should the rules be?
   - Too short: Easy to skip
   - Too long: Might not be read carefully

3. Should there be examples of violations?
   - Pro: Makes rules concrete
   - Con: Adds length, might be seen as "edge cases"

## Next Steps

1. Review and refine proposed rules structure
2. Test with actual usage
3. Iterate based on feedback
4. Update inject-rules.js
