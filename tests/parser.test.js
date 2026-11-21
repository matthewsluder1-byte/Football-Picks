import { test, eq, ok } from './harness.js';
import { parseGrid, matchSchedule, tiebreakerGameId, cleanName, nameKey, HIDDEN, NONE } from '../js/parser.js';
import { matchNames, defaultDecisions, applyDecisions } from '../js/names.js';
import { buildWeek } from '../js/merge.js';
import { scorePlayers, lockTime, gameResult } from '../js/scoring.js';
import { normScoreboard, parseLine } from '../js/espn.js';

const gridText = await (await fetch('fixtures/grid-2026-w10-thu.txt')).text();
const board = normScoreboard(await (await fetch('fixtures/scoreboard-2026-w10.json')).json());
const grid = parseGrid(gridText);
const sched = matchSchedule(grid.matchups, board.events);
const row = name => grid.rows.find(r => r.name === name);

// ---------- parser ----------
test('header: 14 games, away/home in order', () => {
  eq(grid.matchups.length, 14);
  eq(grid.matchups[0], { away: 'Commanders', home: 'Giants' });
  eq(grid.matchups[13], { away: 'Chargers', home: 'Ravens' });
});
test('52 players, no errors', () => { eq(grid.rows.length, 52); eq(grid.errors, []); });
test('odd spacing and nickname: Gilkey  , Jeff "Gick"', () => {
  eq(cleanName('Gilkey  , Jeff "Gick"'), 'Gilkey, Jeff "Gick"');
  eq(nameKey('Gilkey  , Jeff "Gick"'), 'gilkey,jeff');
  ok(row('Gilkey, Jeff "Gick"'), 'row found by cleaned name');
});
test('Branom, Amanda: Commanders, then 12 NO PICK, then HIDDEN', () => {
  const p = row('Branom, Amanda').picks;
  eq(p[0], { status: 'PICK', side: 'away', raw: 'Commanders' });
  ok(p.slice(1, 13).every(c => c.status === NONE));
  eq(p[13].status, HIDDEN);
});
test('Gilkey, Jenn: Giants, HIDDEN, then NO PICK', () => {
  const p = row('Gilkey, Jenn').picks;
  eq(p[0].side, 'home'); eq(p[1].status, HIDDEN); ok(p.slice(2).every(c => c.status === NONE));
});
test('5 Commanders picks on Thursday', () => eq(grid.rows.filter(r => r.picks[0].side === 'away').length, 5));
test('two-row on-screen header also parses', () => {
  const t = 'Player Name\tCommanders\tPatriots\tTotal\n\tGiants\tLions\tPoints\nDoe, Jane\tGiants\tLions\tXX\n';
  const g = parseGrid(t);
  eq(g.matchups, [{ away: 'Commanders', home: 'Giants' }, { away: 'Patriots', home: 'Lions' }]);
  eq(g.rows[0].picks.map(c => c.side), ['home', 'home']);
});
test('a pick that is neither team is an error', () => {
  const g = parseGrid('Player Name\nCommanders\nGiants\nTotal\nDoe, Jane\tEagles\tXX\n');
  eq(g.rows[0].picks[0].status, 'BAD'); eq(g.errors.length, 1);
});
test('short row is an error', () => {
  const g = parseGrid('Player Name\nCommanders\nGiants\nPatriots\nLions\nDoe, Jane\tGiants\n');
  ok(g.errors.some(e => e.includes('expected 2')));
});
test('duplicate player is an error', () => {
  const g = parseGrid('Player Name\nCommanders\nGiants\nDoe, Jane\tGiants\tXX\nDoe ,  Jane\tGiants\tXX\n');
  ok(g.errors.some(e => e.includes('twice')));
});
test('garbage paste gives a clear error', () => ok(parseGrid('hello world').errors[0].includes('No player rows')));

// ---------- schedule ----------
test('all 14 games match ESPN week 10', () => { eq(sched.unmatched, []); eq(sched.games.length, 14); });
test('London game NE vs DET matched', () => {
  const g = sched.games.find(x => x.awayName === 'Patriots' || x.homeName === 'Patriots');
  ok(g && [g.away, g.home].includes('DET'));
});
test('tiebreaker = LAC@BAL (only Monday game)', () => {
  eq(sched.games.find(g => g.id === tiebreakerGameId(sched.games)).home, 'BAL');
});
test('tiebreaker with two Monday games = the second listed', () => {
  const games = [
    { id: 'a', order: 0, kickoff: '2026-11-15T18:00Z' },
    { id: 'b', order: 1, kickoff: '2026-11-17T01:15Z' },   // Mon 8:15 PM ET
    { id: 'c', order: 2, kickoff: '2026-11-17T00:00Z' },   // Mon 7:00 PM ET, listed second
  ];
  eq(tiebreakerGameId(games), 'c');
});

// ---------- names ----------
const first = matchNames(grid.rows, []);
const { players: roster, playerIdByKey } = applyDecisions([], first, defaultDecisions(first));
test('first import: every name is new; roster has 52', () => { ok(first.every(m => m.status === 'new')); eq(roster.length, 52); });
test('re-paste matches every name exactly', () => ok(matchNames(grid.rows, roster).every(m => m.status === 'matched')));
test('name without nickname still matches', () => eq(matchNames([{ key: nameKey('Gilkey, Jeff'), name: 'Gilkey, Jeff' }], roster)[0].status, 'matched'));
test('"Martin, Dan" suggests Martin, Daniel', () => {
  const m = matchNames([{ key: nameKey('Martin, Dan'), name: 'Martin, Dan' }], roster)[0];
  eq(m.status, 'suggest'); eq(roster.find(p => p.id === m.suggestion).name, 'Martin, Daniel');
});
test('"Sluder, Mat" (typo) suggests Sluder, Matt not Stan', () => {
  const m = matchNames([{ key: nameKey('Sluder, Mat'), name: 'Sluder, Mat' }], roster)[0];
  eq(roster.find(p => p.id === m.suggestion).name, 'Sluder, Matt');
});
test('a brand-new person is new', () => eq(matchNames([{ key: nameKey('Zimmer, Quinn'), name: 'Zimmer, Quinn' }], roster)[0].status, 'new'));
test('mapping to an existing player records an alias', () => {
  const m = matchNames([{ key: nameKey('Martin, Dan'), name: 'Martin, Dan' }], roster);
  const { players } = applyDecisions(roster, m, defaultDecisions(m));
  ok(players.find(p => p.name === 'Martin, Daniel').aliases.includes('martin,dan')); eq(players.length, 52);
});
test('initials are unique', () => {
  const tags = roster.map(p => p.initials);
  eq(new Set(tags).size, tags.length, 'duplicate initials');
  eq(roster.find(p => p.name === 'Sluder, Matt').initials, 'MSl');
  eq(roster.find(p => p.name === 'Smokov, Matt').initials, 'MSm');
});

// ---------- merge ----------
const base = buildWeek({ season: 2026, week: 10, games: sched.games, rows: grid.rows, playerIdByKey, now: '2026-11-14T00:00:00Z' }).week;
const pidOf = name => playerIdByKey[nameKey(name)];
const wsh = sched.games.find(g => g.order === 0).id;
const det = sched.games.find(g => g.order === 1).id;
test('picks stored as team codes', () => { eq(base.picks[pidOf('Sluder, Matt')][wsh], 'WSH'); eq(base.picks[pidOf('Baca, Ryan')][wsh], 'NYG'); });
test('Sunday paste reveals picks; HIDDEN never erases a known pick', () => {
  const sunday = gridText.replace(/^(Sluder, Matt\tCommanders\t)HIDDEN/m, '$1Lions');
  const g2 = parseGrid(sunday);
  const { week, diff } = buildWeek({ existing: base, season: 2026, week: 10, games: sched.games, rows: g2.rows, playerIdByKey });
  eq(week.picks[pidOf('Sluder, Matt')][det], 'DET'); eq(diff.revealed, 1);
  const g3 = parseGrid(gridText); // older paste with HIDDEN again
  const again = buildWeek({ existing: week, season: 2026, week: 10, games: sched.games, rows: g3.rows, playerIdByKey }).week;
  eq(again.picks[pidOf('Sluder, Matt')][det], 'DET');
});
test('corrected grid: changed pick is reported', () => {
  const fixed = gridText.replace(/^(Baca, Ryan\t)Giants/m, '$1Commanders');
  const { week, diff } = buildWeek({ existing: base, season: 2026, week: 10, games: sched.games, rows: parseGrid(fixed).rows, playerIdByKey });
  eq(week.picks[pidOf('Baca, Ryan')][wsh], 'WSH');
  eq(diff.changed.length, 1); eq(diff.changed[0].from, 'NYG');
});
test('NO PICK that later becomes a pick is a late pick, not a correction', () => {
  const late = gridText.replace(/^(Gilkey, Jenn\tGiants\tHIDDEN\t)NO PICK/m, '$1Chiefs');
  const { diff } = buildWeek({ existing: base, season: 2026, week: 10, games: sched.games, rows: parseGrid(late).rows, playerIdByKey });
  eq(diff.latePicks.length, 1); eq(diff.changed.length, 0);
});
test('player missing from a re-paste is kept and reported', () => {
  const fewer = gridText.replace(/^Wilson, Jim.*\n/m, '');
  const { week, diff } = buildWeek({ existing: base, season: 2026, week: 10, games: sched.games, rows: parseGrid(fewer).rows, playerIdByKey });
  eq(diff.missingPlayers, [pidOf('Wilson, Jim')]); ok(week.picks[pidOf('Wilson, Jim')]);
});

// ---------- scoring ----------
const evs = new Map(board.events.map(e => [e.id, e]));
const sat = Date.parse('2026-11-14T20:00:00Z');
const tue = Date.parse('2026-11-18T12:00:00Z');
const byPid = (rows, name) => rows.find(r => r.pid === pidOf(name));
test('TNF final in fixture: WSH 24, NYG 21', () => eq(gameResult(evs.get(wsh)), 'WSH'));
test('Saturday: Matt 1 correct, max 14; Giants pickers 0, max 13', () => {
  const s = scorePlayers(base, evs, sat);
  eq([byPid(s, 'Sluder, Matt').correct, byPid(s, 'Sluder, Matt').max], [1, 14]);
  eq([byPid(s, 'Baca, Ryan').correct, byPid(s, 'Baca, Ryan').max], [0, 13]);
});
test('before lock, NO PICK can still be right (Branom, Amanda max 14)', () => eq(byPid(scorePlayers(base, evs, sat), 'Branom, Amanda').max, 14));
test('after lock, NO PICK is wrong (Branom, Amanda max 2)', () => eq(byPid(scorePlayers(base, evs, tue), 'Branom, Amanda').max, 2));
test('NFL tie counts for nobody', () => {
  const tied = new Map(evs); const e = { ...evs.get(wsh), home: { ...evs.get(wsh).home, score: 24 } }; tied.set(wsh, e);
  eq(gameResult(e), 'TIE'); eq(byPid(scorePlayers(base, tied, sat), 'Sluder, Matt').correct, 0);
});

// ---------- locks ----------
const iso = ms => new Date(ms).toISOString();
test('Thursday game locks at kickoff', () => eq(iso(lockTime({ kickoff: '2026-11-13T01:15Z' })), '2026-11-13T01:15:00.000Z'));
test('Sunday 1 PM game locks at noon ET Sunday', () => eq(iso(lockTime({ kickoff: '2026-11-15T18:00Z' })), '2026-11-15T17:00:00.000Z'));
test('Monday game locks at noon ET Sunday', () => eq(iso(lockTime({ kickoff: '2026-11-17T01:15Z' })), '2026-11-15T17:00:00.000Z'));
test('London 9:30 AM ET game locks at its kickoff', () => eq(iso(lockTime({ kickoff: '2026-11-15T14:30Z' })), '2026-11-15T14:30:00.000Z'));
test('September (EDT) noon lock is 16:00 UTC', () => eq(iso(lockTime({ kickoff: '2026-09-13T17:00Z' })), '2026-09-13T16:00:00.000Z'));

// ---------- feed ----------
test('line parsing', () => {
  eq(parseLine('DET -3', 49.5, 'DraftKings'), { favorite: 'DET', spread: 3, overUnder: 49.5, details: 'DET -3', provider: 'DraftKings' });
  eq(parseLine('EVEN', 44, '').spread, 0);
});
test('feed normalizes teams, lines and state', () => {
  const e = board.events.find(x => x.home.abbr === 'BAL');
  eq([e.away.abbr, e.state], ['LAC', 'pre']); eq(e.line.favorite, 'BAL'); eq(e.line.overUnder, 38.5);
});
