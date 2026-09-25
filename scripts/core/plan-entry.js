'use strict';
// A discussion carries the plan (D123): tickets are made only after the plan
// says how the work will be built, and each ticket carries its part of it.

const TEMPLATE_MARKER = /^\((?:pending|placeholder)\b/i;

// Body of a "## Name" section: the text up to the next "## " heading.
function sectionBody(content, name) {
  const match = String(content || '').match(new RegExp(`(?:^|\\n)## ${name}[ \\t]*\\r?\\n([\\s\\S]*?)(?=\\n## [^#]|$)`));
  return match ? match[1] : null;
}

function isFilled(body) {
  if (body === null) return false;
  const lines = body.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length === 0 || TEMPLATE_MARKER.test(lines[0])) return false;
  // A template left as is ("{...}" placeholders only, or "TBD") is not a plan.
  return lines.some(line => !/^(?:\*\*[^*]+:\*\*\s*)?(?:\{[^}]*\}|TBD\.?|-\s*TBD\.?)?$/i.test(line));
}

// True when the discussion says how the work will be built: a filled "## Plan"
// section, or a plan log entry ("Plan", "Plan revision", "Cycle N plan").
function discussionHasPlan(content) {
  if (isFilled(sectionBody(content, 'Plan'))) return true;
  return /^### \[[^\]]+\] (?:Plan(?: revision)?|Cycle \d+ plan)\b/im.test(String(content || ''));
}

// True when a ticket's "## Implementation Details" holds real specifics.
function ticketHasDetails(content) {
  return isFilled(sectionBody(content, 'Implementation Details'));
}

module.exports = { discussionHasPlan, ticketHasDetails, sectionBody };
