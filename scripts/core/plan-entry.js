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

// True when the plan says how the result is structured for the person who gets it
// (D133): a filled "**Reader Structure:**" line in the Plan or a Plan revision,
// or "none: <reason>" when nobody will see or read the result. This only sees that
// the line is filled in; the user judges its content when they confirm the plan.
function discussionHasReaderStructure(content) {
  const lines = String(content || '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const label = lines[i].match(/^\s*\*\*Reader Structure:\*\*\s*(.*)$/);
    if (!label) continue;
    const value = [label[1]];
    for (let j = i + 1; j < lines.length && lines[j].trim() && !/^\s*(?:\*\*|#|---)/.test(lines[j]); j++) value.push(lines[j]);
    const filled = value.map(line => line.trim()).filter(Boolean).some(line =>
      !/^\{.*\}$/.test(line) && !/^(?:TBD|pending)\.?$/i.test(line) && !/^\((?:pending|placeholder)\b/i.test(line) && !/^none\s*:?$/i.test(line));
    if (filled) return true;
  }
  return false;
}

module.exports = { discussionHasPlan, discussionHasReaderStructure, ticketHasDetails, sectionBody };
