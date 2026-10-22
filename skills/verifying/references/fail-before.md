# Verifying — fail-before: a changed test must fail on HEAD

Moved out of SKILL.md so the skill body stays within what Claude Code re-attaches after compaction (the first 5,000 tokens of each skill). Read this file when the body points here.

A check that passes does not show that it checks the change: a test that also passes on the old source does not. So in a `--changed` run (not `--dry-run`), a changed test that passes now and reads a changed file that is not a test — source, or a document it checks — also runs on HEAD:
- HEAD is written into a temporary folder through a temporary git index; the repository, its index and the working tree are not touched. Files git ignores that the test reads are copied in as they are now; new files are part of the change and stay out.
- The HEAD version of the test runs there first and must pass, so a failure there comes from the change and not from the copy. Then the changed test runs there and must fail.
- The result `FAIL_BEFORE:<id>` is PASS when the changed test fails on HEAD (it catches the change), FAIL when it passes there too (it does not), and manual when the HEAD version already fails on HEAD or a new test file cannot run there (missing file). A new test file has no HEAD version, so only the second run happens.
- Cost: two more runs per such test, one for a new test file; a run whose changed tests read no changed source costs nothing.

**Exemptions.** A change that keeps behavior on purpose (a refactor) is exempted in `fail-before-exempt.json` beside the manifest: `{ "<test file>": { "sha256": "<sha256 of the test file>", "reason": "<why>" } }`. The FAIL message prints this line with the hash. The exemption holds only while the test keeps that content; the next edit to the test needs a new one.

**Skipping.** `--no-fail-before` skips the comparison. verify-guard passes it, because its hook has a time limit. The commit gate accepts only the declared command, so a run with this flag does not unlock a commit.

**Limits.** Tests that need ignored folders such as `node_modules` get manual results. A test helper changed together with a test is rolled back with the source, so a test that needs the new helper fails on HEAD and passes this check. Without the project's `verify-classify.js`, a new test that cannot load on HEAD is classified by the fallback rules and may count as PASS instead of manual.
