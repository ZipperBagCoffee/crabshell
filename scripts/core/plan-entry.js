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

// True when a "**<label>:**" line in the Plan or a Plan revision is filled: it, or the
// lines under it, hold something other than a template placeholder, TBD, pending or a
// bare "none"; "none: <reason>" counts. This only sees that the line is filled in; the
// user judges its content when they confirm the plan.
function planFieldFilled(content, label) {
  const pattern = new RegExp(`^\\s*\\*\\*${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\*\\*\\s*(.*)$`);
  const lines = String(content || '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(pattern);
    if (!match) continue;
    const value = [match[1]];
    for (let j = i + 1; j < lines.length && lines[j].trim() && !/^\s*(?:\*\*|#|---)/.test(lines[j]); j++) value.push(lines[j]);
    const filled = value.map(line => line.trim()).filter(Boolean).some(line =>
      !/^\{.*\}$/.test(line) && !/^(?:TBD|pending)\.?$/i.test(line) && !/^\((?:pending|placeholder)\b/i.test(line) && !/^none\s*:?$/i.test(line));
    if (filled) return true;
  }
  return false;
}

// D133: how the result is structured for the person who gets it.
const discussionHasReaderStructure = content => planFieldFilled(content, 'Reader Structure');

// D145: the design is checked before building, once per discussion. Each line's
// meaning goes into the block message so the writer knows what belongs there.
const DESIGN_FIELD_MEANING = {
  Values: 'every name, list and number the work puts into code, and where each comes from (what the project declares, or a parameter with a default)',
  Structure: 'which modules and functions change, and why no special case or second copy of code is added',
  'Start state': 'what existing data, callers or users see right after the change, and how they keep working',
  'User burden': 'what the user has to do',
  'Design review': 'a reviewer of the same or a higher model tier who did not write the plan reads only the plan and its files; write "findings → fixes"',
};
const DESIGN_FIELDS = Object.keys(DESIGN_FIELD_MEANING);

function missingDesignFields(content) {
  return DESIGN_FIELDS.filter(field => !planFieldFilled(content, field));
}

// How a host names a skill to run: Claude's Skill tool call by default.
const claudeSkillRef = (name, args) => (args ? `skill="${name}", args="${args}"` : `skill="${name}"`);

// The first problem that blocks a new ticket under this discussion, as a sentence that
// says how to fix it, or null when the plan is ready. The Claude guard and the Codex
// ticket command both use it, so the check and its words exist once; only the way a
// skill is named differs per host (skillRef).
function planProblem(content, parentId, { skillRef = claudeSkillRef } = {}) {
  const discussing = skillRef('discussing', parentId);
  if (!discussionHasPlan(content)) {
    return `the discussion has no plan yet. Write its ## Plan first — how it will be built, files and functions, order, rejected alternatives, risks — show it to the user and record their confirmation (${discussing}), then create the ticket.`;
  }
  if (!discussionHasReaderStructure(content)) {
    return `its plan has no **Reader Structure:** line. If a person will see or read the result, list what they will do (task → where they look → the words there) and every visible text (${skillRef('structuring')}), then show the user. If nobody will, write "none: <reason>". Add it to ## Plan, or as a Plan revision log entry once tickets exist (${discussing}).`;
  }
  const missing = missingDesignFields(content);
  if (missing.length) {
    return `its plan has no design check yet — missing ${missing.map(field => `**${field}:**`).join(', ')}. ${missing.map(field => `${field}: ${DESIGN_FIELD_MEANING[field]}.`).join(' ')} "none: <reason>" counts when a line does not apply or the risk is low. Add the lines to ## Plan, or as a Plan revision log entry once tickets exist (${discussing}).`;
  }
  return null;
}

module.exports = {
  discussionHasPlan, discussionHasReaderStructure, ticketHasDetails, sectionBody,
  planFieldFilled, DESIGN_FIELDS, missingDesignFields, planProblem,
};
