# Choosing checks by what they used

Read this when one change selects many checks, or before writing a check that loads a lot of data or code when it starts. Goal: a check runs again only when something it actually used has changed, and never misses a change to something it used.

Never answer with a time target or a cap on how many checks run. A change to a part every check really uses rightly runs every check; a change to one record runs only the checks that use that record.

Where a section lists ways in order, use the first one the project can do. Taking a later way needs the reason each earlier one cannot be done, and its measured cost (⑩, [check cost](check-cost.md)).

## Read is not used

- Read: "The check loaded every data file when the program started."
- Used: "The check looked up the price table and nothing else."

The runner chooses by what a check read: the files its own trace saw, or the `inputs` the entry declares. A check that reports what it used is chosen by its report instead. A check that reads everything but uses one record runs again on every data edit. A check whose declared list is a guess misses the files it really uses.

Only what can change the result is used. Handing out a whole collection or file only to copy it or to overwrite part of it (a test that copies every record to change a few, or sets one value in a loaded table) is not use: that accessor reports nothing, and the accessors that hand out single records or fields report what is then read. A value the check overwrites before reading never came from the file. A stamp is not use either: a whole-content hash or version that the program writes into its outputs (output files, logs) and no program code compares. Report nothing for it, the way build systems treat volatile stamps.

A value built from many inputs uses all of them: a whole-content hash or validity verdict, a list of everything, a snapshot. A check that reads one runs again when any of those inputs changes. Three ways out:
- read only the parts the check needs, reported where they are handed out (①);
- prove the whole-content fact once in the gate (③), so other checks rely on its pass;
- leave out a value that cannot change the result, such as a stamp.

## First: find why each check was chosen

Before fixing anything, list the kinds of thing this project's checks use. Examples: data files, code in each kind of process that runs it (a test runner, an engine a script starts, a tool), files another check writes, settings. Take the processes from one real run, not from reading the code. Run the user's example once while the operating system logs every program that starts, and list each program the run started. For example, use `strace -f -e trace=execve -o exec.log <command>` on Linux, `sudo eslogger exec` on macOS, or Process Monitor filtered to Process Start on Windows. A list written from memory misses the program a script starts, such as an engine. For each kind, name the way its use gets recorded (①–⑧). A kind with no way yet counts as used whole. Every check it chooses stays in the measurement (⑩) as waste left, with that kind as the reason. Fixing one kind at a time without this list finds the next kind only at the next measurement.

`node .crabshell/verification/run-verify.js --explain` prints each check a `--changed` run would run, with its reason and every other input that changed (`; also …`), and runs nothing. A check chosen for two inputs needs both fixed: fixing one only shows the other. For each chosen check, open its record in `test-map.json` (`kind`, `files`) and sort each of its reasons:

| Reason | What to do |
|---|---|
| `… changed (unknown inputs)` — the record's `kind` is `project` | Report what it used (⑧); where nothing can report, declare `inputs` (⑤) |
| A file it read when it started, but does not use | Report where a record or field is handed out (①), scan through a kind index (②), put start-up validation in a gate (③) |
| A value built from many files: a whole-content hash or verdict, a list of everything | The three ways out under "Read is not used" |
| One entry that runs many child checks with its own selector | One selector, or the same rules inside it (⑨) |
| A file it uses, but only one part of it | Report items, not files (④, ⑦); split a shared core file (⑥) |
| Every loaded file, because the tracer cannot see constant reads | "What the tracer cannot see" under ④ |
| A case that ran after the case that used the change, in one process | "Cases in one process" under ⑧ |
| A file another check writes | Declare it in the writer's `outputs`. The runner then judges the reader after the writer ran, by what it wrote: reused when the content is what it passed with |
| Code run in a process another program starts, such as an engine a script launches | Turn on the same coverage or report there (④) |
| Its own test or program changed, or it failed last time | Nothing to fix |

Start where the time goes: measure (⑩) which kind of change makes the longest real run, and fix that kind first. Where a code file selects hundreds of checks and a data file a few, ④, ⑥ and `{cases}` save the time, and ①–③ mainly add checks the declared inputs missed.

## ① Report at the one place that hands out data

The function that returns a record to the rest of the program reports that record when it returns it. Loading at start is not use.

- Wrong: "The start-up loader reports every file it reads." Every check then used everything.
- Right: "The lookup function reports the price table when a caller asks for it." Only checks that ask for prices report prices.

A lookup for a record that does not exist reports that record with an empty fingerprint (⑧), so adding it later runs the check again. Data the program reads outside that function is not reported: route those reads through it, or report them where they happen.

The finest general form is the field. When the record object hands out a field, it reports that field; one top-level field is one item. Code that loops over every record to filter on one field then reports only that field of each record, with no change of its own. Report on the record object, not where the collection fetches it from the store, so copies made from a record report the same way.

## ② Scan by kind, through an index

A check that walks every record to keep those of one kind has read every record's kind, so it must report every record. Build an index keyed by kind, and let the index report what it returns:
- each record of that kind it returns;
- which records belong to the kind: each file's list of item names and kinds, as one item of that file, whose fingerprint changes only when an item is added, removed or changes kind;
- the folders it listed, as folder lines (⑧), so a new file of that kind runs the check.

An edit inside a record of another kind then runs nothing.

## ③ Put start-up validation in one gate check

When the program validates all data at start and refuses to start on a broken record, every check that starts the program depends on every record, but only through "did validation pass". Make one gate check that runs that validation, and mark it with the gate field (see [manifest fields](manifest-entries.md#fields-for-checks-that-report-what-they-used)). The gate calls the same validation function the program runs at start, never a lighter one written for the test; otherwise the gate passes while the real start refuses.

Code narrowed to the functions that ran (④) needs the same kind of gate: a syntax or compile error inside a function no check ran still breaks every check that loads its file. One gate check compiles or loads every source file the way the program does.

How the runner treats the gate:
- A check reduced by its report is reused only while the gate has passed on the current files.
- The gate's fingerprint is not part of the other checks' fingerprints, so a data edit does not run every check through it.
- The gate is never left out as slow or one-at-a-time.
- When the gate fails, the reduced checks report NOT_RUN, not a reused pass.

The gate proves only that each record is valid. A check that uses record B's value through record A reports B.

## ④ Code: only the functions that ran are used

For code split into items (functions), a function counts as used when it ran during the check. Loading the file that holds it, or mentioning its name, is not use. Report from the language's own coverage or call hook, or from one report call at the function's entry.

The part of a code file outside its function bodies is different: constants, signatures, defaults and the class declaration run or compile when the file loads, and a compiler may fold another file's constant into it. Every check that loads a code file uses that part: report a `rest` line (⑧) for each code file the check loaded, and items only for the functions that ran.

- Wrong: "The test imports the module that defines the price function, so it reports the price function."
- Right: "The price function reports itself when it runs." Only tests that called it report it.

Every process that runs project code reports, including one that another program starts, such as an engine a script launches or a tool that runs the game. The report path reaches it through the environment (⑧). Turn on there the same coverage or call hook the direct launch uses. Until then, report each code file that process can load as a `file`, and name those files as waste left in the measurement (⑩).

What the tracer cannot see: a coverage or call hook sees the functions that ran, not reads of constants, enums or static fields. A use it cannot see must still not be missed. From the most precise way to the least:
1. Read the source of each function that ran and the part outside the functions of each loaded file. For each constant, enum or static field they name, directly, through an alias, or inherited through what its file extends, report that member as an `item` of the file that declares it. The identity command (⑦) then lists those members as items too, not only functions, so a new or changed constant runs only the checks whose code names it. Access by a computed name or string goes to way 3.
2. Move constants that many files read into a small file of their own (⑥).
3. As the last resort, report every file loaded in the process as a `file`. Loading is not use (①), but when nothing can tell the uses apart, the check must not miss.

## ⑤ A check nothing can report from: declare `inputs`

A check in any language that the project owns can write a report (⑧). A program whose source the project does not own, a tool you cannot change, or a capture of a real app cannot. Give such an entry `inputs`: every file, folder (ending in `/`) or glob that its run opens. Leave out no file it uses; reduce reruns with a report instead.

- Wrong: "inputs: the rule file" — but the rule reads the price table, so a price edit never runs the check.
- Right: "inputs: the rule file and the data folder it loads."

## ⑥ A core file that many checks call: split it

A data report does not help when the changed file is code every check loads. If one file holds several jobs, move each job to its own file, so a check loads only the jobs it calls. Where the file cannot be split, item reports for its functions (④ with ⑦) do the same inside one file.

- Wrong: "Movement, pricing and saving live in one model file." A pricing edit runs the movement tests.
- Right: "Pricing lives in its own file." Movement tests never load it.

## ⑦ One function computes an item's fingerprint

When one file holds many items (records, functions), the report gives each used item a fingerprint. The manifest's `itemIdentity` command gives the runner the current fingerprint of every item in a file, plus one fingerprint for the rest of the file outside the items: defaults, constants not listed as items (④), file-level code. The report and the identity command must call the same fingerprint function in the project's check code. Two different functions never agree, so the check either runs every time or is reused when it should not be.

A fingerprint covers only what can change the result (see "Read is not used"). Leave out comment-only and blank lines, in the items and in the rest of the file; then a comment edit runs nothing. Keep the content of strings, and keep a comment that the language or a tool in the check reads, such as a compiler directive or a type-checker pragma.

When the checks run in another language or runtime than the runner, the identity command runs in that same runtime and calls the program's own fingerprint function. It is never a second implementation written for the runner. A `file` containing a slash must be inside the project; a bare name is found on PATH. For an engine installed elsewhere, use a project wrapper script. The runner appends the file paths after `args`, so an engine that parses its own flags needs `--` at the end of `args`.

The runner adds the rest-of-file fingerprint to every check that used any item of that file or reported its `rest` (⑧). Without an `itemIdentity` command, or when it fails or gives no rest-of-file fingerprint, the whole file counts as used.

## ⑧ The report

The runner sets `CRABSHELL_USED_REPORT` to the path of the check's report file; child processes inherit it. The check appends lines, with fields separated by TAB.

```
file<TAB>path[<TAB>case]                    the whole file was used
file<TAB>folder/[<TAB>case]                 the folder's list of names was used (a path ending in "/" or naming a folder)
item<TAB>path<TAB>item<TAB>fingerprint[<TAB>case]   only that item was used; an empty fingerprint = looked up, not there
rest<TAB>path[<TAB>case]                    only the file's part outside its items was used (code that runs when the file loads)
result<TAB>case<TAB>pass|fail               one line per case, for entries whose command uses {cases}
begin<TAB>writer                            optional, when several processes write
done[<TAB>writer]                           the last line; each writer name needs as many done lines as begin lines
```

- **Paths:** relative to the project root (`/` or `\`), or absolute inside the project. They must exist. Report a file that is not there through its folder; adding it changes the folder's names. A record that is not there is an `item` line with an empty fingerprint.
- **Report every folder the check lists**, test discovery included. Otherwise a file added there never runs the check again.
- **Case setup:** a file the check's program reads to set up cases is one file per case, read only for the cases being run and reported as that case's `file`. A file read for every case, or an input no case reported, is used by every case: a change to it runs every case. Report a case's own inputs per case, not in the entry's `inputs`.
- **Cases in one process:** each case reports what it used. A value an earlier case left behind, such as a cache or a static table built on first use, is used by every later case that reads it: the later case used what the value was built from. In order of preference:
  1. The cache keeps, with each value, the `item` and `file` lines reported while the value was built, and reports them again each time it hands the value out (①). This is exact and needs no extra run.
  2. Where the cache cannot do that, clear it in the per-case setup, so each case builds and reports its own.
  3. Reporting the union of every earlier case in the process never misses, but every later case runs again when one earlier case's input changes.
  4. One process per case is exact but pays the start-up once per case (check-cost ①).

  When only some cases run again, each case's report comes from that run, so it reflects only the cases that ran before it there.
- **Files the check writes and reads back in the same run** (test scratch, generated fixtures) are outputs, not inputs. Keep them under one scratch folder and have the check's reporting code leave that folder out; reported, they break it (outside the project, or not there before the run).
- **Escapes** inside a field: `%` → `%25`, TAB → `%09`, CR → `%0D`, LF → `%0A`. `#` is not special. A field may not hold the NUL character (`%00`).
- **Write the report fresh on every run.** A check that runs again reads everything it needs and reports again; never copy an earlier report.
- **A report built from coverage** gets its `done` line only with evidence that the coverage source delivered everything: its final summary arrived and every function it counted has a name. Sources drop data when a process ends early or a message queue overflows. Without that evidence, leave `done` out: the report is then broken, and the check is chosen as it would be without a report, never as "used nothing".

A report is broken when:
- its last line is not `done`;
- a writer name has fewer `done` lines than `begin` lines;
- it names nothing the check used (only `begin`/`done` lines);
- a field has a bad `%` escape or holds NUL;
- it names a path outside the project, or a file or folder that was not there before the run and is not there now.

With a broken report or no report, the check is chosen as it would be without reports; the record keeps the reason as `reportProblem`. Only a passing run's report narrows the next choice; the runner keeps it in the check's record (`files`, record kind `reported`). An entry with `{cases}` also keeps each case's result, so only failed or changed cases run next. A failing run removes no input or case. A case it was to run and did not report counts as failed. When a failing run's report is broken or names no failed case, no case results are kept, so the next run runs every case.

The report narrows only the inputs inside the entry's `reportScope`, which defaults to its `inputs`. Files the check reads outside that scope stay inputs. An entry with no `inputs` sets `reportScope`, for example to the data folder; its inputs are then its report plus every project file outside that scope. Field shapes: [manifest fields](manifest-entries.md#fields-for-checks-that-report-what-they-used).

## ⑨ A project's own selector inside one entry

Prefer one selector. When a project's command runs many child checks with its own pass records, make each child a manifest entry (or use `{cases}`), so the runner chooses them and `--explain` shows each reason. When the project keeps its own selector, for example because children it leaves out as slow would count as failed cases, that selector follows the same rules:

- it gives each child its own report file through `CRABSHELL_USED_REPORT`, replacing the path the entry inherited;
- it keeps each child's used inputs and passes, with the gate and report scope as its own settings;
- it settles the gate first, in its own synchronous step, before deciding any child's reuse; a selector that plans every child up front and runs groups side by side otherwise reuses children while the gate is still unknown;
- it reruns a child only when something in that child's report changed. With a missing or broken report, it chooses the child as it would without a report: its declared inputs, or every project file when it declares none (⑧);
- it judges a child that reads files another child writes after that child ran, by what it wrote. The writer being chosen is not a change to the reader. The runner does the same for entries: a check that reads files in another check's `outputs` waits for that check and is reused when the content is what it passed with.

The runner then sees only the whole entry: `--explain` and the run summary show one check however many children run, and its time is all of theirs. So the selector prints the reason for each child it runs, and measuring (⑩) counts its children.

## ⑩ Measure each kind of change

Before saying the checks cost less, measure the time each kind of change costs. What counts is the time the user waits for the run, not how many checks a preview picks. One kind never stands for another: a data edit can run a few checks while a one-line code edit still runs most of them. The kinds, where the project has them:
- a line inside a function of the code file the most checks load;
- a comment-only line, and a blank line;
- a new function in that file;
- a file-level constant;
- a line in one test file;
- one value in one data record;
- an asset: a picture, sound or scene;
- a new test file, and a new data file;
- a project or engine setting, or a dependency version;
- regenerating the manifest, when a script builds it;
- the change the user complained about, as they described it.

For each kind:
1. Start from a run where every check has a pass on the current files.
2. Make that one change and nothing else. For the user's example, make the real fix they described.
3. Run `--explain` and read every reason of each chosen check: its reason and each `also` input. For an entry with its own selector (⑨), count the children its own output says it would run, with their reasons.
4. Run `--changed` for real and keep the total time it prints.
   - From `last-run.json`, take each chosen check's `durationMs`.
   - Split it into start-up, waiting and the work itself ([check cost](check-cost.md), "First").
   - Compare the total with the sum of the checks' times: the difference shows how much ran side by side.
5. Put the file back, unless the change is a fix the user asked for.

Report each kind with its total run time and its number of checks, both measured, never estimated. For each check, give its time split, every reason, and whether the check used the change (needed) or not (waste). A lower count with the same total time fixed nothing for the user. Name each kind not measured. Until every kind the project has is measured, the report reads "partial: measured … / not measured …", not done. A kind that still runs checks that did not use the change is the next fix.

A cause is fixed only when the same kind, measured again, chooses none of the checks it chose for that cause. Otherwise write "partly fixed: N still chosen, because …". Before handing over a list of causes, fixes or feedback, put it next to the question it answers and the conclusions you stated. Each of them belongs in the list or is named as left out.

A miss counts too. When a `--changed` run reused a check's pass and the same check catches a bug once it really runs, the check used something it did not report or declare. Find it and report it (⑧) or add it to `inputs` (⑤); routine full runs do not fix a miss.

A timing assertion that fails only with reporting on: rerun it alone before blaming reporting overhead; side-by-side runs slow timing tests too.
