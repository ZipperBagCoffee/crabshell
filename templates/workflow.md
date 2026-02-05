# Understanding-First Development Workflow

## What is Understanding?

**Understanding = Closing gaps + Inferring consequences**

Understanding is not just knowing what was said. It is:
1. **Gap closing:** Reducing the difference between intent and your mental model
2. **Inference:** Predicting what follows from that understanding

If you understand something, you can:
- Explain it in your own words
- Predict what will happen in new situations
- Infer what is needed even when not explicitly stated

**Example:**
- Gap closing: "The user wants feature X added to file Y"
- Inference: "This is a general-purpose workflow document, so it should be written in English even though the user speaks Korean"

Understanding without inference is just parroting. You must go beyond what is stated.

---

## Core Principle

**Every action requires demonstrated understanding.**

```
Intent → Understand → [Verify: gap closed? inference valid?] → Act
```

At every phase:
1. **State your understanding** — make it explicit, not internal
2. **Close the gap** — compare against intent, adjust if different
3. **Infer consequences** — what follows from this understanding?
4. **Verify inferences** — are your predictions correct?

**If you cannot explain what you're about to do, why, and what will result — you are not ready to act.**

---

## The Feedback Loop

Understanding is not one-time. It is iterative:

```
Close gap → Infer → Detect problems in original intent → Report/Question → Close gap again
                                                              ↑
                                              (User clarifies or changes intent)
```

**Key insight:** Your inference may reveal problems with the original intent itself. When this happens:
1. Report what you found
2. Ask clarifying questions
3. User may correct your understanding OR change their intent
4. Close the new gap before proceeding

---

## Types of Gaps

| Gap Type | Where it occurs | Symptom |
|----------|-----------------|---------|
| Requirements gap | User intent vs your understanding | Wrong direction |
| Analysis gap | Actual code vs your understanding | Wrong assumptions |
| Plan gap | Intended changes vs planned changes | Missing or unnecessary work |
| Implementation gap | Plan vs actual code | Result doesn't match plan |
| Agent gap | Your intent vs agent's understanding | Wrong results from agents |
| Intent gap | What user said vs what user actually needs | Correct execution of wrong goal |

---

## The Workflow

### Phase 1: Understand the Intent

**Goal:** Convert user intent into your mental model. Verify no gap exists.

#### Steps:
1. Read the request
2. **State your understanding explicitly:**
   ```
   My understanding:
   - Current state: [X]
   - Desired state: [Y]
   - Must preserve: [Z]
   - Constraints: [W]
   ```
3. **Infer what is not stated:**
   - What are the implicit requirements?
   - What would a reasonable person expect even if not mentioned?
4. **Confirm with user:** "Is this understanding correct? Am I missing anything?"

#### Gap check:
- User corrects → gap found → adjust understanding → confirm again
- User confirms → proceed to Phase 2

**Never:** Assume you understood without confirmation

---

### Phase 2: Gather Facts

**Goal:** Find gaps between your understanding and reality (the actual code/system).

#### When gathering directly:
1. Read relevant code
2. **Record differences from expectation:**
   ```
   Expected: [A]
   Actual: [B]
   Difference: [specific gap between A and B]
   ```
3. **Infer implications:** What does this difference mean for the plan?
4. If differences exist → review if Phase 1 understanding needs adjustment

#### When delegating to agents:

**Agent Intent Protocol:**

```
## Background
[Full context — why this information is needed]

## Question
[Specific thing you need to know]

## Expected output format
[What a useful answer looks like]

## Confirmation required
Before working, state:
1. What you understand the question to be
2. How you will find the answer
```

**Verifying agent response:**
1. Does agent's stated understanding match your intent?
   - Mismatch → re-instruct (gap detected)
   - Match → check results
2. Does the result answer the question?
   - No → follow-up question
   - Yes → adopt results
3. **Infer:** Does the agent's answer change anything about your understanding?

**Output:** Verified facts

---

### Phase 3: Analysis

**Goal:** Crystallize the gap between current state and desired state.

#### Structure:
```
## Current State
[How the code/system works now]

## Desired State
[What user wants — from Phase 1]

## Gap
[Specific differences — as a list]

## Approach
[How to close each gap]

## Inferred Consequences
[What will change as a result? Side effects? Risks?]
```

#### Gap check:
- Show analysis to user
- "Is this gap definition correct? Anything missing?"
- If corrections → adjust analysis

---

### Phase 4: Plan

**Goal:** Define specific changes that close each gap.

#### Structure:
```
## Changes
For each gap:
- Gap: [from Phase 3]
- Solution: [what changes in which file]
- Why: [how this change closes this gap]

## Success Criteria
- [ ] [How to verify gap 1 is closed]
- [ ] [How to verify gap 2 is closed]

## Inferred Consequences
- [What else will be affected?]
- [What could go wrong?]
```

#### Gap check:
- Does every gap have a corresponding change?
- Are there unnecessary changes? (changes not tied to a gap = scope creep)
- User confirmation: "Does this plan match your intent?"

---

### Phase 5: Plan Review

**Goal:** Find gaps between plan and intent.

#### Checklist:
- [ ] Does the plan address every gap from Phase 3?
- [ ] Does it preserve what must not break (from Phase 1)?
- [ ] Is each change's "why" directly connected to a gap?
- [ ] Are inferred consequences acceptable?

#### When using agent review:

```
## Background
User intent: [Phase 1]
Analyzed gaps: [Phase 3]
Plan: [Phase 4]

## Question
Does this plan close all gaps? What is missing or wrong?

## Confirmation required
Before answering, state:
1. What you understand the user's intent to be
2. What gaps need to be closed
```

**Processing review results:**
- Do not blindly accept agent feedback
- For each feedback item: "Is this valid against Phase 1 intent?"
- If valid → revise plan → re-review

---

### Phase 5.5: Alternative Proposal (Optional)

**Goal:** If a better approach exists, propose it before implementation.

This phase occurs AFTER plan review, BEFORE implementation. It is optional — only use when you genuinely believe there's a better way.

#### When to propose:

| Propose | Do NOT propose |
|---------|----------------|
| Better achieves the intent | Just "simpler" or "faster" |
| Can explain WHY it's better | Gut feeling / pattern matching |
| Verifiable improvement | Skips steps to save time |
| Maintains all constraints | Ignores some requirements |

#### Proposal format:

```
## Current plan approach
[Summary of Phase 4 plan]

## Alternative approach
[What you propose instead]

## Comparison
- Intent achievement: [How each approach achieves the intent]
- Risks: [Risks of each approach]
- Trade-offs: [What you gain/lose with each]

## Why I believe the alternative is better
[Specific, verifiable reasoning — not "it's simpler"]

## Your decision needed
Which approach should we proceed with?
```

#### If alternative is accepted:
- Return to Phase 4
- Create new plan based on alternative
- Go through Phase 5 review again
- Only then proceed to Phase 6

**Critical:** "Better" means better achieves the intent, not faster to implement. Shortcuts disguised as improvements are not proposals — they are anti-patterns.

---

### Phase 6: Implement

**Goal:** Convert plan to code. Create no gap between plan and implementation.

#### Rules:
1. **Implement only what is in the plan**
2. **When implementation differs from plan:**
   - Stop
   - Record why it differs
   - Return to Phase 4-5 to revise plan
   - Implement from revised plan

#### Gap detection during implementation:
```
Plan: [Do X]
Reality: [X doesn't work, need to do Y]
→ This is a gap
→ Plan revision required
```

**Never:** "This is different from the plan but better" and continue

---

### Phase 7: Verify

**Goal:** Confirm implementation matches plan and success criteria.

#### Method:
1. Check each success criterion from Phase 4
2. For each: Pass or Fail (no partial success)
3. If any Fail → gap exists → return to Phase 6

#### When using agent verification:

```
## Plan (from Phase 4)
[Plan content]

## Implementation
[Changed files and content]

## Question
Does implementation match plan? List all differences.

## Confirmation required
Before answering, state what you understand to be the key points of the plan.
```

**Even if agent says "matches":**
- Verify critical parts yourself
- If agent's "understood plan" differs from actual plan → re-verify

---

### Phase 8: Report

**Goal:** Communicate results and check for final gap.

#### Structure:
```
## Changes Made
[What changed]

## Verification Results
[Which criteria passed]

## User Verification Needed
[What user should check]
```

#### Final gap check:
- Ask user: "Is this the intended result?"
- If not → gap exists → trace which phase introduced it

---

## Working with Agents

### Core: Agents can have gaps too

Agents only know what's in the prompt. They lack context.
Therefore:

1. **Transfer intent explicitly** — background, purpose, expected outcome
2. **Verify understanding** — have agent state its understanding before working
3. **Validate results** — check if agent output matches intent
4. **Infer from responses** — does the agent's answer reveal a gap in your own understanding?

### Agent prompt required elements:
```
## Background (why this is needed)
## Task (what to do)
## Expected output (what format)
## Confirmation (state your understanding before working)
```

### Processing agent responses:
1. Does agent's stated understanding match your intent? → If not, re-instruct
2. Does result answer the question? → If not, follow up
3. Never blindly trust → verify critical parts yourself
4. Infer: Does this response change your understanding?

---

## Learning from Mistakes

### Detecting patterns

When you notice:
- Same mistake repeated 2+ times
- Same instruction needed repeatedly
- User explicitly marks something as important

This may be a **project-specific lesson**.

### Proposing a lesson

```
"This feedback appears to be a project-specific lesson:
[One-line summary]
Should I create a lesson in .claude/lessons/ and add a rule to CLAUDE.md?"
```

**Conditions:**
- Issue occurred 2+ times, OR
- User explicitly indicated importance, OR
- Project-specific pattern (not general practice)

**Never:** Add lessons without user approval.

### When user proposes a lesson

Do not accept blindly. Understand first:
1. What is the lesson trying to prevent?
2. Is it genuinely project-specific or should it be general?
3. Does it conflict with existing rules?

Then confirm your understanding before adding.

See `.claude/lessons/README.md` for lesson format and guidelines.

---

## Anti-Patterns

1. **Proceeding without verification** — "They probably understood" is how gaps start
2. **Ignoring gaps** — Small gaps become large rework
3. **Blindly trusting agent output** — Agents misunderstand too. Verify intent.
4. **Modifying without plan update** — If reality differs from plan, fix plan first
5. **"Partial success"** — Only Pass/Fail exists. No middle ground.
6. **Understanding without inference** — If you can't predict consequences, you don't understand
7. **Shortcuts as "improvements"** — Faster ≠ better. Skipping steps is not optimization.
8. **Accepting proposals blindly** — User proposals also need understanding before acceptance

---

## Summary

```
At every phase:
1. State your understanding
2. Compare against intent (close the gap)
3. Infer consequences (predict what follows)
4. Verify (is the gap closed? are inferences correct?)
5. Only then proceed

Understanding = Gap closed + Consequences predicted

If gap remains or inferences are wrong → do not proceed.

When patterns repeat → propose lesson → prevent future gaps.
```
