# Regressing — user interaction

Moved out of SKILL.md so the skill body stays within what Claude Code re-attaches after compaction (the first 5,000 tokens of each skill). Read this file when the body points here.

## User Interaction

- **At start**: Confirm topic. Cap is 10 unless user explicitly wrote a number. Do not infer cap from context, memory, or past sessions. Print the goal-mode handoff line (Step 2.6) so the user can run the session under host goal mode.
- **During**: Fully autonomous. Terminates on convergence (Rule 7) or when cap is reached. At every 10-cycle boundary (when cap was defaulted), present progress report — user approves raising cap by 10 or stops.
- **At end**: Present final report in D → user requests raising cap or terminates
