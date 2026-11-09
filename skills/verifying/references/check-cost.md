# Making each check cheaper

Read this when a check run takes long even though it runs only the checks the change touched (choosing those: [select-by-use](select-by-use.md)). Goal: the same checks catch the same problems in less time. A long run usually comes from a few checks that start a program for every case, wait in real time, run one at a time when they could run side by side, or do heavy work by nature.

Never answer with a time target, a cap on how many checks run, or by deleting or weakening a check because it is slow.

## First: find where the time goes

Start from a real run of the user's example ([select-by-use](select-by-use.md) ⑩). Its total time is what the user waits for. Each check's record in `.crabshell/verification/test-map.json` keeps `durations`, the times of its passing runs in milliseconds; `last-run.json` gives each check's `durationMs` in the last run. Sort the checks by their median duration and start with the longest. Time how long its program takes to start and exit with nothing to do, such as an empty test. Then sort it:

| Where the time goes | Fix |
|---|---|
| Starting the program, engine or data, once per case | ① |
| Sleeping, or waiting for a timeout | ② |
| Each check is short, but they finish one after another | ③ |
| The work itself: renders, recordings, benchmarks, long simulations | ④ |
| One entry runs many child checks with its own selector; its time is all of theirs | Measure and fix its children ([select-by-use](select-by-use.md) ⑨) |

## ① Start once, run many cases

A check that starts the program for each case pays the start-up once per case.

- Wrong: "Thirty entries each start the game engine to run one scene test."
- Right: "One entry starts the engine once and runs the thirty scene tests inside it."

Put such cases in one entry whose command takes `{cases}` ([manifest fields](manifest-entries.md)) and report each case's result (select-by-use ⑧). The runner passes only the cases to run again, and the program starts once for all of them. Reset each case's state inside the process, with the test framework's per-test setup, not by starting again. State that leaks from one case to the next makes results depend on order.

## ② Wait for the event, not the clock

A real wait costs the same on every run and still fails on a slow machine.

- Wrong: "The test sleeps two seconds so the save can finish."
- Right: "The test waits for the save-finished signal" or "advances a fake clock that the code reads its time from."

Code that reads the time through one replaceable clock lets a test run its timers at once.

## ③ Run side by side

Without `jobs` in the manifest, the runner runs a check alone unless its last run traced it as a check on the runner's own Node. A check in another language, an engine, a check with declared `inputs` and a first run therefore run one at a time. Set `"exclusive": false` on each entry that shares nothing with other checks. Checks that share a file, port or database also get `"exclusive": false` plus the same `"group"`, so only they wait for each other; a `group` alone does not let a check share.

- Wrong: "Every test entry runs alone because none says otherwise."
- Right: "Tests that use their own temporary folders set `exclusive: false`; the two that use the one test database also share `group: \"db\"`."

## ④ Heavy by nature: `slow`

When the work itself is long, mark the entry `slow: true`; the verifying skill lists the kinds. Routine runs leave it out unless a `riskPaths` file and the check's own inputs changed ([manifest fields](manifest-entries.md)). It also runs with `--slow`, on a full run the user asked for, and at the release step.

## Measure the change

Run the changed check once before the fix and once after, on the same files, and report both times. Every case must give the same result as before; a fix that changes one changed what the check catches. Report each check you measured and name the long checks not yet fixed. Then run the user's example again and report the run's total time before and after: one faster check is not a faster run.
