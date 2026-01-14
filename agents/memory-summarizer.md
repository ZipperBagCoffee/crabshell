---
name: memory-summarizer
description: Summarize rotated memory file to JSON
tools: Read
model: haiku
---

## Task
Read the given memory file and output a JSON summary.

## Input
File path is provided in the first message.

## Output Format (MUST follow exactly)
{
  "dateRange": { "first": "YYYY-MM-DD", "last": "YYYY-MM-DD" },
  "sectionCount": 45,
  "themes": [
    {
      "name": "Theme name",
      "summary": "Detailed summary of this theme (3-5 sentences)",
      "sessions": ["2026-01-10", "2026-01-12"]
    }
  ],
  "keyDecisions": [
    {
      "decision": "Decision content",
      "reason": "Reason",
      "date": "2026-01-11"
    }
  ],
  "issues": [
    {
      "issue": "Issue content",
      "status": "resolved|open",
      "date": "2026-01-12"
    }
  ],
  "overallSummary": "Comprehensive summary of entire period (10-15 sentences)"
}

## Rules
- Output ONLY the JSON format above
- No additional explanations or markdown
- Maximum 10 items each for themes, keyDecisions, issues
