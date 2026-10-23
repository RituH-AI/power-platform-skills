'use strict';

function planSection(plan, heading) {
  if (!plan) return null;
  const lines = plan.split('\n');
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const startRe = new RegExp(`^##\\s+${escaped}\\s*$`, 'i');
  let i = 0;
  while (i < lines.length && !startRe.test(lines[i])) i++;
  if (i >= lines.length) return null;
  i++;
  const out = [];
  while (i < lines.length && !/^##\s/.test(lines[i])) out.push(lines[i++]);
  return out.join('\n').trim();
}

function findMarkdownTable(sectionText, requiredColumns) {
  const lines = sectionText.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*\|.*\|\s*$/.test(lines[i])) continue;
    const headers = lines[i].split('|').slice(1, -1).map((header) => header.trim().toLowerCase());
    if (requiredColumns.every((column) => headers.includes(column.toLowerCase()))) {
      return { lineIndex: i, headers, lines: lines.slice(i) };
    }
  }
  return null;
}

function parseMarkdownRows(sectionText, requiredColumns) {
  const table = findMarkdownTable(sectionText, requiredColumns);
  if (!table) return [];
  const rows = [];
  for (const line of table.lines.slice(2)) {
    if (!/^\s*\|.*\|\s*$/.test(line)) break;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length === 0 || cells.every((cell) => cell === '')) continue;
    const row = {};
    for (let i = 0; i < table.headers.length; i++) row[table.headers[i]] = cells[i] || '';
    rows.push(row);
  }
  return rows;
}

// The step that starts a plan write: genpage-plan-provenance.js quarantines the old plan before the approved one is written.
const PROVENANCE_PREPARE = /\bgenpage-plan-provenance\.js\b[^\n]*\bprepare\b/;

// Plan presentations and their outcomes, in log order. Shapes recorded by the skill:
//   - EnterPlanMode called with the initial plan:
//   - ExitPlanMode called → changes requested (revised): "add a search box in addition to …"
//   - Task genpage-planner re-invoked with the revision request …
//   - ExitPlanMode called → approved
//   - `node scripts\genpage-plan-provenance.js prepare --plan genpage-plan.md`   (the plan write starts)
function planModeEvents(log) {
  const events = [];
  String(log || '').split(/\r?\n/).forEach((line, at) => {
    if (/\bEnterPlanMode\b/.test(line) && !/\bnot\b/i.test(line)) events.push({ at, kind: 'present', line });
    else if (/\bExitPlanMode\b/.test(line)) {
      const kind = /changes?\s+requested|\brevis|\breject/i.test(line) ? 'changes' : /\bapproved\b/i.test(line) ? 'approved' : 'unknown';
      events.push({ at, kind, line });
    } else if (PROVENANCE_PREPARE.test(line)) events.push({ at, kind: 'write', line });
    else if (/\bgenpage-planner\b/.test(line) && /\b(?:re-?invoked|Task|Dispatched)\b/i.test(line)) events.push({ at, kind: 'planner', line });
  });
  return events;
}

module.exports = { planSection, findMarkdownTable, parseMarkdownRows, planModeEvents, PROVENANCE_PREPARE };
