import { test, eq, ok } from './harness.js';
import { weekSummary, seasonStandings } from '../js/season.js';
import { historyTimes, winHistory } from '../js/history.js';
import { rewindEvent } from '../js/replay.js';

const team = (abbr, score = null, quarters = []) => ({ abbr, score, quarters, name: abbr, winner: false });
const fin = (id, away, home, date = '2026-11-15T18:00:00Z') => ({ id, date, state: 'post', completed: true, period: 4, clock: 0, detail: 'Final',
  away: team('AAA', away, [away, 0, 0, 0]), home: team('HHH', home, [0, home, 0, 0]), possession: null, neutral: false, line: null });
const games = [{ id: 'g0', order: 0, kickoff: '2026-11-15T18:00:00Z', away: 'AAA', home: 'HHH' },
               { id: 'g1', order: 1, kickoff: '2026-11-17T01:15:00Z', away: 'AAA', home: 'HHH' }];
const evs = (...l) => new Map(l.map(e => [e.id, e]));
const late = Date.parse('2026-11-20T00:00:00Z');

test('week winner: most correct', () => {
  const wk = { games, tiebreakGameId: 'g1', picks: { a: { g0: 'HHH', g1: 'HHH' }, b: { g0: 'AAA', g1: 'HHH' } } };
  const s = weekSummary(wk, evs(fin('g0', 3, 10), fin('g1', 20, 24)), late);
  eq([s.final, s.winners, s.total], [true, ['a'], 44]);
});
test('week tie: closest Monday total wins, either side', () => {
  const wk = { games, tiebreakGameId: 'g1', tiebreak: { a: 40, b: 47 }, picks: { a: { g0: 'HHH', g1: 'HHH' }, b: { g0: 'HHH', g1: 'HHH' } } };
  eq(weekSummary(wk, evs(fin('g0', 3, 10), fin('g1', 20, 24)), late).winners, ['b']);   // 47 is 3 away, 40 is 4
});
test('week tie with no guesses: winners split', () => {
  const wk = { games, tiebreakGameId: 'g1', picks: { a: { g0: 'HHH', g1: 'HHH' }, b: { g0: 'HHH', g1: 'HHH' } } };
  eq(weekSummary(wk, evs(fin('g0', 3, 10), fin('g1', 20, 24)), late).winners, ['a', 'b']);
});
test('unfinished week has no winner yet', () => {
  const wk = { games, tiebreakGameId: 'g1', picks: { a: { g0: 'HHH', g1: 'HHH' } } };
  const pre = { ...fin('g1', 0, 0), state: 'pre', completed: false };
  eq(weekSummary(wk, evs(fin('g0', 3, 10), pre), late).winners, []);
});
test('season: totals, split wins, average miss breaks the tie', () => {
  const w1 = { games, tiebreakGameId: 'g1', tiebreak: { a: 44, b: 54 }, picks: { a: { g0: 'HHH', g1: 'AAA' }, b: { g0: 'AAA', g1: 'HHH' } } };
  const w2 = { games, tiebreakGameId: 'g1', tiebreak: { a: 44, b: 44 }, picks: { a: { g0: 'HHH', g1: 'HHH' }, b: { g0: 'HHH', g1: 'HHH' } } };
  const e = evs(fin('g0', 3, 10), fin('g1', 20, 24));
  const st = seasonStandings([{ week: 2, data: w2, events: e }, { week: 1, data: w1, events: e }], late);
  eq(st.weeks, [1, 2]);
  eq(st.rows.map(r => [r.pid, r.total, r.wins, r.avgMiss, r.rank]), [['a', 3, 1.5, 0, 1], ['b', 3, 0.5, 5, 2]]);
  eq(st.rows[0].byWeek[1], { correct: 1, max: 1, final: true, won: true, share: 1 });
});

// ---------- win % over time ----------
const k = Date.parse('2026-11-15T18:00:00Z');
test('rewinding a game in progress keeps finished quarters only', () => {
  const live = { ...fin('g0', 14, 7), state: 'in', completed: false, period: 3, clock: 300, detail: '5:00 - 3rd',
    away: team('AAA', 14, [7, 7, 0]), home: team('HHH', 7, [0, 7, 0]) };
  const r = rewindEvent(live, k + 50 * 60e3);                  // 2nd quarter by the model
  eq([r.state, r.period, r.away.score, r.home.score], ['in', 2, 7, 0]);
  eq(rewindEvent(live, k + 150 * 60e3), live);                 // past what's been played: real state
});
test('chart moments: before kickoff, locks and quarter ends, never in the future', () => {
  const wk = { games, picks: {} };
  const board = { events: [fin('g0', 3, 10), fin('g1', 20, 24, '2026-11-17T01:15:00Z')] };
  const t = historyTimes(wk, board, k + 100 * 60e3);
  eq(t[0], Date.parse('2026-11-15T17:00:00Z') - 60e3);        // a minute before the noon ET Sunday lock
  ok(t.every((x, i) => i === 0 || x > t[i - 1]), 'sorted');
  ok(t.every(x => x <= k + 100 * 60e3), 'nothing after now');
  ok(t.includes(k + 85 * 60e3 + 1), 'halftime is a moment');
});
test('chart ends at the real result: the leader at 100%', async () => {
  const wk = { games, updatedAt: 'x', picks: { a: { g0: 'HHH', g1: 'HHH' }, b: { g0: 'AAA', g1: 'AAA' } } };
  const board = { events: [fin('g0', 3, 10), fin('g1', 20, 24, '2026-11-17T01:15:00Z')] };
  const pts = await winHistory(wk, board, late, { sims: 300 });
  eq(pts.at(-1).players, { a: 1, b: 0 });
  ok(pts[0].players.a > 0.2 && pts[0].players.a < 0.8, `before kickoff a is ${pts[0].players.a}`);
});
