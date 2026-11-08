---
name: structuring
description: Use before making or changing anything a person will see or read, such as a screen, menu, app, document, report or message, and when someone says it is confusing, badly organized, hard to find, too long or not intuitive. Sets who it is for, what belongs where, what comes first and what is cut, before anything is built. Not for internal code structure.
---

# Structuring

Build for the person who receives the result, not in the order the code or material produced it. Do these steps in order before building, for screens and writing alike.

## 1. Write what the person is trying to do

List their tasks in their words, not a list of features or contents.

- Wrong: "Audio module, account module, display module."
- Right: "Turn the sound down. Change my password."

## 2. Decide what belongs under what

Before placing an item under a parent, ask all three:

- Does the parent's name describe this item's scope?
- Is it as specific as its siblings?
- Would a person look here using only the parent's name?

If any answer is no, it does not belong there. Importance is no reason to nest. Link things that are merely used together; do not nest them.

- Wrong: Account inside Sound, because that screen was open.
- Right: Sound and Account side by side under Settings, with a shortcut where it helps.

In writing, a heading or opening sentence summarizes what is under it, and one group holds one kind of thing.

- Wrong: "Three things to note" above a date, a warning and a price.
- Right: "It costs 12 and must be paid by Friday", with the details below.

## 3. Decide what stays, what waits and what goes

Keep what the person needs to decide and finish the current task. Move rare detail behind a tab, a link or a later section. Cut the rest. Never hide a cost or a required condition. Show nothing for an empty state.

## 4. Set the reading order, then position and size

Write the order in which the person should take in the parts. Then match position, size and contrast to it. If everything is the same size, the order is not decided yet.

In writing, the fact the reader must not miss comes first. Assume they stop after one sentence.

- Wrong: "We looked at the logs, then the settings, and in the end the upload failed."
- Right: "The upload failed because the disk is full."

## 5. Use the person's words

Show no internal names, code identifiers, or numbers without a unit or meaning. Read every visible text aloud as a sentence. If a person would not say it, rewrite it. Say each thing once.

## 6. Show the lists before building

Put these in the plan's `**Reader Structure:**` line and show the user before building:

- Tasks: task → where they look → the words there.
- Every text that will be visible.

A new task goes through step 2 against the existing structure before it gets a place. Never attach it to whatever is open.

## 7. Check it, and say who checked it

Give a person the purpose only, not the steps, and watch where they go. For structure, use a bare text menu without design.

A fresh reviewer worker can find defects in the real result: the rendered capture, or the text as it will be read. It cannot pass the result. Record who actually tried it in the ticket's `## Reader Check`. If nobody did, report "own checks passed, not tried by a person", not "done".

## When corrected

One correction is a defect type, not one spot.

1. Write the user's words and the defect type in one line.
2. Search the whole work for that type and fix every case.
3. Open the reply with the number of places found, fixed and left.
4. Record the same in the ticket's `## Reader Check`.
