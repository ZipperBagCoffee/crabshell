# Choosing checks by what they used

Read this when one change selects many checks, or before writing a check that loads a lot of data or code when it starts. The goal: a check runs again only when something it actually used has changed, and never misses a change to something it used.

Never answer with a time target or a cap on how many checks run. A change to a part every check really uses rightly runs every check; a change to one record runs only the checks that use that record.

## Read is not used

- Read: "The check loaded every data file when the program started."
- Used: "The check looked up the price table and nothing else."

The runner chooses by what a check read — the files its own trace saw, or the `inputs` the entry declares — unless the check reports what it used. A check that reads everything but uses one record runs again on every data edit. A check whose declared list is a guess misses the files it really uses.

## First: find why each check was chosen

`node .crabshell/verification/run-verify.js --explain` prints each check a `--changed` run would run, with its first reason, and runs nothing. For each chosen check, open its record in `test-map.json` (`kind`, `files`) and sort it:

| Reason | What to do |
|---|---|
| `… changed (unknown inputs)` — the record's `kind` is `project` | Report what it used (⑧); where nothing can report, declare `inputs` (⑤) |
| A file it read when it started, but does not use | Report where a record or field is handed out (①), scan through a kind index (②), put start-up validation in a gate (③) |
| One entry that runs many child checks with its own selector | One selector, or the same rules inside it (⑨) |
| A file it uses, but only one part of it | Report items, not files (④, ⑦); split a shared core file (⑥) |
| Its own test or program changed, or it failed last time | Nothing to fix |

## ① Report at the one place that hands out data

The function that returns a record to the rest of the program reports the record it returns, when it returns it — like a cache logging its hits. Loading at start is not use.

- Wrong: "The start-up loader reports every file it reads." Every check then used everything.
- Right: "The lookup function reports the price table when a caller asks for it." Only checks that ask for prices report prices.

A lookup for a record that does not exist reports that record with an empty fingerprint (⑧), so adding it later runs the check again. Data the program reads outside that function is not reported: route such reads through it, or report them where they happen.

The finest general form is the field: when the record object hands out one field (one top-level field = one item), it reports that field. Code that loops over every record to filter on one field then reports only that field of each record, and needs no change of its own.

- Wrong: "The collection reports a record when it is fetched from the store." A test that copies every record into a modified set reads the copies, and nothing reports them.
- Right: "The record object reports a field when the field is read." Copies made from it report the same way.

## ② Scan by kind, through an index

A check that walks every record to keep those of one kind has read every record's kind, so it must report every record. Build an index keyed by kind, and let the index report what it returns.

- Wrong: "Walk all records and keep those whose kind is outfit." Any record edit runs the check.
- Right: "Ask the index for kind outfit." The index reports each outfit record it returns, plus which records belong to the kind — each file's list of item names and kinds, as one item of that file (its fingerprint changes only when an item is added, removed or changes kind) — and the folders it listed (a folder line, ⑧), so a new file of that kind runs the check. An edit inside a record of another kind runs nothing.

## ③ Put start-up validation in one gate check

When the program validates all data at start and refuses to start on a broken record, every check that starts the program depends on every record — but only through "did validation pass". Make one gate check that runs that validation, and mark it with the gate field (see [manifest fields](manifest-entries.md#fields-for-checks-that-report-what-they-used)).

- Wrong: "The gate runs a lighter validation written for the test." It passes while the real start refuses, and the reduced checks are reused on a program that cannot start.
- Right: "The gate calls the same validation function the program runs at start."

How the runner treats the gate:
- A check reduced by its report is reused only while the gate has passed on the current files.
- The gate's fingerprint is not part of the other checks' fingerprints, so a data edit does not run every check through it.
- The gate is never left out as slow or one-at-a-time.
- When the gate fails, the reduced checks report NOT_RUN, not a reused pass.

The gate proves only that each record is valid. A check that uses record B's value through record A reports B.

## ④ Code: only the functions that ran are used

For code split into items (functions), a function counts as used when it ran during the check, not when the file holding it was loaded or mentions its name. Report from the language's own coverage or call hook, or from one report call at the function's entry.

- Wrong: "The test imports the module that defines the price function, so it reports the price function." Every test that imports the module reports it.
- Right: "The price function reports itself when it runs." Only tests that called it report it.

## ⑤ A check nothing can report from: declare `inputs`

A check written in any language that the project owns can write a report (⑧). A program whose source the project does not own, a tool you cannot change, or a capture of a real app cannot. Give such an entry `inputs`: every file, folder (ending in `/`) or glob that its run opens.

- Wrong: "inputs: the rule file" — but the rule reads the price table, so a price edit never runs the check.
- Right: "inputs: the rule file and the data folder it loads." It runs more often; that is the price of not reporting. Reduce it with a report, never by leaving out a file it uses.

## ⑥ A core file that many checks call: split it

A data report does not help when the changed file is code every check loads. If one file holds several jobs, move each job to its own file so a check loads only the jobs it calls. Where the file cannot be split, item reports for its functions (④ with ⑦) do the same inside one file.

- Wrong: "Movement, pricing and saving live in one model file." A pricing edit runs the movement tests.
- Right: "Pricing lives in its own file." Movement tests never load it.

## ⑦ One function computes an item's fingerprint

When one file holds many items (records, functions), the report gives each used item a fingerprint, and the manifest's `itemIdentity` command gives the runner the current fingerprints of every item in a file, plus one fingerprint for the rest of the file outside the items (defaults, shared constants, file-level code). Both must call the same function in the project's check code.

- Wrong: "The report hashes the record as read; the identity command hashes it after removing spaces." The two never agree, so the check either runs every time or is reused when it should not be.
- Right: "The report and the identity command call one shared fingerprint function."

When the checks run in another language or runtime than the runner, the identity command runs in that same runtime and calls the program's own fingerprint function; it is never a second implementation written for the runner.

The runner adds the rest-of-file fingerprint to every check that used any item of that file. Without an `itemIdentity` command, or when it fails or gives no rest-of-file fingerprint, the whole file counts as used.

## ⑧ The report

The runner sets `CRABSHELL_USED_REPORT` to the path of the check's report file; child processes inherit it. The check appends lines; fields are separated by TAB.

```
file<TAB>path[<TAB>case]                    the whole file was used
file<TAB>folder/[<TAB>case]                 the folder's list of names was used (a path ending in "/" or naming a folder)
item<TAB>path<TAB>item<TAB>fingerprint[<TAB>case]   only that item was used; an empty fingerprint = looked up, not there
result<TAB>case<TAB>pass|fail               one line per case, for entries whose command uses {cases}
begin<TAB>writer                            optional, when several processes write
done[<TAB>writer]                           the last line; each writer name needs as many done lines as begin lines
```

- **Paths:** relative to the project root (`/` or `\`), or absolute inside the project, and they must exist. A file that is not there is reported through its folder (adding it changes the folder's names); a record that is not there is an `item` line with an empty fingerprint.
- **Every folder the check lists is reported** — test discovery included. A check that lists a folder but reports only the files it then opened never runs again when a file is added there.
- **Escapes** inside a field: `%` → `%25`, TAB → `%09`, CR → `%0D`, LF → `%0A`. `#` is not special. A field may not hold the NUL character (`%00`).
- **Write it fresh on every run.** A check that runs again reads everything it needs and reports again; never copy an earlier report.

A report is broken when its last line is not `done`, a writer name has fewer `done` lines than `begin` lines, it names nothing the check used (only `begin`/`done` lines), a field has a bad `%` escape or holds NUL, or it names a path outside the project or a file or folder that was not there before the run and is not there now. A broken report, or no report, means the check is chosen as it is today; the record keeps the reason as `reportProblem`. Only a passing run's report narrows the next choice (an entry with `{cases}` also keeps each case's result, so only failed or changed cases run next; a failing run removes no input or case — a case it was to run and did not report counts as failed — and a failing run whose report is broken or names no failed case keeps no case results, so the next run runs every case); the runner keeps it in the check's record (`files`, record kind `reported`).

The report narrows only the inputs inside the entry's `reportScope` (default: its `inputs`); files the check reads outside that scope stay inputs. An entry with no `inputs` sets `reportScope` (for example the data folder); its inputs are then its report plus every project file outside that scope. Field shapes: [manifest fields](manifest-entries.md#fields-for-checks-that-report-what-they-used).

## ⑨ A project's own selector inside one entry

Prefer one selector: when a project's command runs many child checks with its own pass records, make each child a manifest entry (or use `{cases}`), so the runner chooses them and `--explain` shows each reason. When the project keeps its own selector (for example, children it leaves out as slow would count as failed cases), that selector follows the same rules:

- it gives each child its own report file through `CRABSHELL_USED_REPORT`, replacing the path the entry inherited;
- it keeps each child's used inputs and passes, with the gate and report scope as its own settings;
- it reruns a child only when something in that child's report changed; with a missing or broken report it chooses the child as it would without a report (its declared inputs, or every project file when it declares none), as ⑧ says.

The runner then sees only the whole entry, so the selector prints the reason for each child it runs.

## ⑩ Measure one change

Before saying a change selects fewer checks, measure it: start from a run where every check has a pass on the current files, change one file (one record, one field) and nothing else, run `--explain`, read the reason for each chosen check, then put the file back. Report the number and the reasons, never an estimate.
