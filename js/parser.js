// Parses the picks grid copied from footballfrenzyonline.com.
//
// Clipboard format observed (2026 week 10):
//   "Player Name \t"            <- header start
//   Commanders                  <- one team per line: away, home, away, home, ...
//   Giants
//   ...
//   " Total " / " Points "      <- header end
//   Name<TAB>pick<TAB>...<TAB>XX   <- one row per player, one cell per game, then Total
// Cell values: a team nickname, "HIDDEN" (picks hidden until lock), "NO PICK".
// Once games have started the copy changes (2026 week 12):
//   "Rank \t Player Name \tCorrect" / "Picks\t"   <- header start
//   Packers<TAB>13 / Saints<TAB>-     <- each team line carries its score ("-" = not played yet)
//   1<TAB>Garcia, Emma<TAB>4<TAB>pick...<TAB>XX   <- rank and correct-count around the name
// Also accepted: a two-row header (away teams on row 1, home teams on row 2, tab-separated),
// which is how the grid looks on screen.

export const HIDDEN = 'HIDDEN';
export const NONE = 'NONE';

export const NICKNAMES = {
  Cardinals: 'ARI', Falcons: 'ATL', Ravens: 'BAL', Bills: 'BUF', Panthers: 'CAR', Bears: 'CHI',
  Bengals: 'CIN', Browns: 'CLE', Cowboys: 'DAL', Broncos: 'DEN', Lions: 'DET', Packers: 'GB',
  Texans: 'HOU', Colts: 'IND', Jaguars: 'JAX', Chiefs: 'KC', Raiders: 'LV', Chargers: 'LAC',
  Rams: 'LAR', Dolphins: 'MIA', Vikings: 'MIN', Patriots: 'NE', Saints: 'NO', Giants: 'NYG',
  Jets: 'NYJ', Eagles: 'PHI', Steelers: 'PIT', '49ers': 'SF', Seahawks: 'SEA', Buccaneers: 'TB',
  Titans: 'TEN', Commanders: 'WSH',
};
const NICK_LOWER = new Set(Object.keys(NICKNAMES).map(n => n.toLowerCase()));
const HEADER_WORDS = /^(player\s*name|total|points|total\s*points|tie\s*breaker|tiebreaker|rank|correct|picks)$/i;
const isScore = s => /^(-|\d+)$/.test(String(s).trim());   // a team's score in the header, or "-"
const isRank = s => /^T?\d+$/i.test(String(s).trim());     // "1", "21", maybe "T4"

/** Display form: collapse spaces, no space before a comma, one space after it. */
export function cleanName(raw) {
  return String(raw).replace(/\s+/g, ' ').replace(/\s+,/g, ',').replace(/,\s*/, ', ').trim();
}

/** Matching key: lower case, nicknames in quotes dropped, punctuation dropped. "Gilkey  , Jeff "Gick"" -> "gilkey,jeff" */
export function nameKey(raw) {
  return cleanName(raw)
    .toLowerCase()
    .replace(/["“”][^"“”]*["“”]/g, ' ')
    .replace(/[^a-z0-9,&]+/g, ' ')
    .replace(/\s*,\s*/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
}

const isTeamWord = s => NICK_LOWER.has(String(s).trim().toLowerCase());

/** Splits a player row: an optional rank before the name, and an optional correct-count after it. */
function rowCells(line) {
  let cells = line.split('\t');
  let rank = '', correct = '';
  if (cells.length > 2 && isRank(cells[0]) && /[a-z]/i.test(cells[1])) {
    rank = cells[0].trim();
    cells = cells.slice(1);
    if (cells.length > 2 && /^\d+$/.test(cells[1].trim())) { correct = cells[1].trim(); cells = [cells[0], ...cells.slice(2)]; }
  }
  return { cells, rank, correct };
}

function isDataRow(line) {
  const { cells } = rowCells(line);
  if (cells.length < 2) return false;
  const first = cells[0].trim();
  if (!/[a-z]/i.test(first) || HEADER_WORDS.test(first) || isTeamWord(first)) return false;
  return cells.slice(1).some(c => c.trim() !== '');
}

function parseHeader(headerLines, warnings) {
  // Two-row on-screen layout: two lines that each hold 2+ team names separated by tabs.
  const teamRows = headerLines
    .map(l => l.split('\t').map(c => c.trim()).filter(c => c && !HEADER_WORDS.test(c) && !isScore(c)))
    .filter(cells => cells.length >= 2 && cells.every(isTeamWord));
  if (teamRows.length === 2 && teamRows[0].length === teamRows[1].length) {
    return teamRows[0].map((away, i) => ({ away, home: teamRows[1][i] }));
  }
  const tokens = headerLines
    .flatMap(l => l.split('\t'))
    .map(c => c.trim())
    .filter(c => c && !HEADER_WORDS.test(c) && !isScore(c));
  for (const t of tokens) if (!isTeamWord(t)) warnings.push(`Header: "${t}" is not a known team nickname`);
  if (tokens.length % 2) warnings.push(`Header has ${tokens.length} team names (expected an even number)`);
  const out = [];
  for (let i = 0; i + 1 < tokens.length; i += 2) out.push({ away: tokens[i], home: tokens[i + 1] });
  return out;
}

function parseCell(raw, m) {
  const v = String(raw ?? '').trim();
  const up = v.toUpperCase();
  if (up === 'HIDDEN') return { status: HIDDEN, raw: v };
  if (up === 'NO PICK' || up === '' || up === '-') return { status: NONE, raw: v };
  const low = v.toLowerCase();
  if (low === m.away.toLowerCase()) return { status: 'PICK', side: 'away', raw: v };
  if (low === m.home.toLowerCase()) return { status: 'PICK', side: 'home', raw: v };
  return { status: 'BAD', raw: v };
}

/**
 * @returns {{matchups:{away:string,home:string}[], rows:object[], errors:string[], warnings:string[]}}
 * rows[i] = { name, key, picks:[{status:'PICK'|'HIDDEN'|'NONE'|'BAD', side?, raw}], total, extras }
 */
export function parseGrid(text) {
  const errors = [], warnings = [];
  const lines = String(text).replace(/\r/g, '').split('\n');
  const first = lines.findIndex(isDataRow);
  if (first < 0) return { matchups: [], rows: [], errors: ['No player rows found. Copy the whole grid, from "Player Name" to the last row.'], warnings };

  const matchups = parseHeader(lines.slice(0, first), warnings);
  if (!matchups.length) errors.push('No games found in the header.');
  const G = matchups.length;
  const rows = [];
  const seen = new Set();

  lines.slice(first).forEach((line, i) => {
    if (!line.trim()) return;
    if (!isDataRow(line)) { warnings.push(`Skipped line ${first + i + 1}: "${line.slice(0, 40)}"`); return; }
    const { cells, rank, correct } = rowCells(line);
    const name = cleanName(cells[0]);
    const key = nameKey(cells[0]);
    if (cells.length - 1 < G) errors.push(`${name}: ${cells.length - 1} cells, expected ${G} picks`);
    const picks = matchups.map((m, g) => parseCell(cells[1 + g], m));
    picks.forEach((p, g) => {
      if (p.status === 'BAD') errors.push(`${name}: "${p.raw}" is not ${matchups[g].away} or ${matchups[g].home}`);
    });
    if (seen.has(key)) errors.push(`${name} appears twice`);
    seen.add(key);
    const rest = cells.slice(1 + G).map(c => c.trim());
    rows.push({ name, key, picks, total: rest[0] ?? '', extras: rest.slice(1).filter(Boolean), rank, correct });
  });
  if (rows.some(r => r.extras.length)) warnings.push('Some rows have extra columns after Total. They are kept but not used yet.');
  return { matchups, rows, errors, warnings };
}

/** Match grid matchups to ESPN events (normalized by espn.js) by team nickname. */
export function matchSchedule(matchups, events) {
  const warnings = [];
  const lc = s => String(s).toLowerCase();
  const games = [], unmatched = [];
  matchups.forEach((m, order) => {
    let ev = events.find(e => lc(e.away.name) === lc(m.away) && lc(e.home.name) === lc(m.home));
    if (!ev) {
      ev = events.find(e => lc(e.away.name) === lc(m.home) && lc(e.home.name) === lc(m.away));
      if (ev) warnings.push(`${m.away} / ${m.home}: home and away are reversed vs the score feed (fine for neutral sites)`);
    }
    if (!ev) { unmatched.push(m); return; }
    games.push({
      id: ev.id, order, kickoff: ev.date,
      away: ev.away.abbr, home: ev.home.abbr,
      awayName: ev.away.name, homeName: ev.home.name,
      // grid side -> team abbreviation (handles reversed neutral-site listings)
      gridAway: lc(ev.away.name) === lc(m.away) ? ev.away.abbr : ev.home.abbr,
      gridHome: lc(ev.home.name) === lc(m.home) ? ev.home.abbr : ev.away.abbr,
    });
  });
  return { games, unmatched, warnings };
}

const etWeekday = iso => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(new Date(iso));

/** Tiebreaker game: the 2nd Monday game in grid order; if only one Monday game, that one; no Monday game -> the last game. */
export function tiebreakerGameId(games) {
  const sorted = [...games].sort((a, b) => a.order - b.order);
  const mon = sorted.filter(g => etWeekday(g.kickoff) === 'Mon');
  return (mon[1] || mon[0] || sorted[sorted.length - 1])?.id ?? null;
}
