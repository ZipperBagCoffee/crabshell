# Verifying — fail-before: a changed test must fail on HEAD

A passing check does not show that it checks the change; a test that also passes on the old source does not. The comparison is opt-in. In a `--changed --fail-before` run (not `--dry-run`), a changed test that passes now and reads a changed file that is not a test (source, or a document it checks) also runs on HEAD:
- HEAD is written into a temporary folder through a temporary git index. The repository, its index and the working tree are not touched. Files git ignores that the test reads are copied in as they are now. New files are part of the change and stay out.
- The HEAD version of the test runs there first and must pass, so a failure there comes from the change and not from the copy. Then the changed test runs there and must fail.
- The result `FAIL_BEFORE:<id>` is PASS when the changed test fails on HEAD, so it catches the change. It is FAIL when the test passes there too. It is manual when the HEAD version already fails on HEAD, or when a new test file cannot run there (missing file). A new test file has no HEAD version, so only the second run happens.
- Cost: two more runs per such test, one for a new test file. A run whose changed tests read no changed source costs nothing.

**Exemptions.** Exempt a change that keeps behavior on purpose (a refactor) in `fail-before-exempt.json` beside the manifest: `{ "<test file>": { "sha256": "<sha256 of the test file>", "reason": "<why>" } }`. The FAIL message prints this line with the hash. The exemption holds only while the test keeps that content; the next edit to the test needs a new one.

**Default.** Without `--fail-before` the comparison does not run. `--no-fail-before` is still accepted and also marks a guard's run: no saved results, and the array is printed.

**Limits.** Tests that need ignored folders such as `node_modules` get manual results. A test helper changed together with a test is rolled back with the source, so a test that needs the new helper fails on HEAD and passes this check. Without the project's `verify-classify.js`, a new test that cannot load on HEAD is classified by the fallback rules and may count as PASS instead of manual.
