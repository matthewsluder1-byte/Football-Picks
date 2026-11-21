import { test, eq, ok } from './harness.js';
import { winProbHome, weekOdds, normCdf, secondsLeft } from '../js/odds.js';
import { rewindEvent, GAME_MS } from '../js/replay.js';

const team = (abbr, score = null, quarters = []) => ({ abbr, score, quarters, name: abbr, winner: false });
const ev = (o = {}) => ({
  id: 'g1', date: '2026-11-15T18:00:00Z', state: 'pre', completed: false, period: 0, clock: null,
  away: team('AAA'), home: team('HHH'), possession: null, neutral: false, line: null, ...o,
});
const fav = (abbr, spread) => ({ favorite: abbr, spread, overUnder: 44, details: `${abbr} -${spread}` });
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg}: ${a.toFixed(3)} not within ${tol} of ${b}`);

// ---------- game model ----------
test('normal CDF', () => { near(normCdf(0), 0.5, 1e-6, 'Φ(0)'); near(normCdf(1.96), 0.975, 1e-3, 'Φ(1.96)'); });
test('pick-em neutral game is 50%', () => near(winProbHome(ev({ neutral: true })), 0.5, 1e-6, 'p'));
test('home -7 before kickoff is about 70%', () => near(winProbHome(ev(), fav('HHH', 7)), 0.70, 0.02, 'p'));
test('away -3 makes home the underdog', () => ok(winProbHome(ev(), fav('AAA', 3)) < 0.45));
test('final game is 1 or 0', () => {
  const f = ev({ state: 'post', completed: true, away: team('AAA', 10), home: team('HHH', 20) });
  eq(winProbHome(f), 1);
});
test('up 14 with 2:00 left is >99%', () => {
  const e = ev({ state: 'in', period: 4, clock: 120, away: team('AAA', 10), home: team('HHH', 24) });
  ok(winProbHome(e, fav('AAA', 7)) > 0.99);
});
test('tied, last seconds: possession tips it', () => {
  const e = ev({ state: 'in', period: 4, clock: 20, away: team('AAA', 17), home: team('HHH', 17), possession: 'HHH' });
  ok(winProbHome(e) > 0.6);
});
test('halftime counts 30 minutes left', () => eq(secondsLeft(ev({ state: 'in', period: 2, clock: 0 })), 1800));

// ---------- pool odds ----------
const games = [0, 1].map(i => ({ id: `g${i}`, order: i, kickoff: '2026-11-15T18:00:00Z', away: 'AAA', home: 'HHH' }));
const evMap = list => new Map(list.map(e => [e.id, e]));
const pre = evMap(games.map(g => ev({ id: g.id, neutral: true })));
const sat = Date.parse('2026-11-14T12:00:00Z');

test('win odds add up to 100%', () => {
  const wk = { games, picks: { a: { g0: 'HHH', g1: 'HHH' }, b: { g0: 'AAA', g1: 'HHH' }, c: { g0: 'HIDDEN', g1: 'NONE' } } };
  const o = weekOdds(wk, pre, { now: sat, sims: 4000 });
  near(Object.values(o.players).reduce((s, x) => s + x.win, 0), 1, 1e-9, 'sum');
});
test('identical picks split the win', () => {
  const wk = { games, picks: { a: { g0: 'HHH', g1: 'AAA' }, b: { g0: 'HHH', g1: 'AAA' } } };
  const o = weekOdds(wk, pre, { now: sat, sims: 2000 });
  near(o.players.a.win, 0.5, 1e-9, 'a');
});
test('all final: the leader wins 100%', () => {
  const fin = evMap(games.map(g => ev({ id: g.id, state: 'post', completed: true, away: team('AAA', 3), home: team('HHH', 10) })));
  const wk = { games, picks: { a: { g0: 'HHH', g1: 'HHH' }, b: { g0: 'AAA', g1: 'HHH' } } };
  const o = weekOdds(wk, fin, { now: Date.parse('2026-11-18T00:00:00Z'), sims: 500 });
  eq([o.players.a.win, o.players.b.win], [1, 0]);
});
test('locked NO PICK everywhere: 0%', () => {
  const wk = { games, picks: { a: { g0: 'HHH', g1: 'HHH' }, z: { g0: 'NONE', g1: 'NONE' } } };
  const m = new Map(pre); m.set('g0', ev({ id: 'g0', state: 'post', completed: true, away: team('AAA', 3), home: team('HHH', 10) }));
  const o = weekOdds(wk, m, { now: Date.parse('2026-11-15T17:30:00Z'), sims: 1000 });
  eq(o.players.z.win, 0);
});
test('root-for: the game where you differ decides it', () => {
  const wk = { games, picks: { me: { g0: 'HHH', g1: 'HHH' }, b: { g0: 'AAA', g1: 'HHH' } } };
  const o = weekOdds(wk, pre, { now: sat, sims: 4000, focus: 'me' });
  const s = o.swing[0];
  eq([s.gameId, s.team], ['g0', 'HHH']);
  near(s.ifTeam, 1, 1e-9, 'if HHH'); near(s.ifOther, 0, 1e-9, 'if AAA');
});
test('tiebreak guesses decide a tie', () => {
  const tb = ev({ id: 'g1', state: 'post', completed: true, away: team('AAA', 20), home: team('HHH', 24) });
  const m = evMap([ev({ id: 'g0', state: 'post', completed: true, away: team('AAA', 3), home: team('HHH', 10) }), tb]);
  const wk = { games, tiebreakGameId: 'g1', tiebreak: { a: 40, b: 50 }, picks: { a: { g0: 'HHH', g1: 'HHH' }, b: { g0: 'HHH', g1: 'HHH' } } };
  eq(weekOdds(wk, m, { now: Date.parse('2026-11-18T00:00:00Z'), sims: 200 }).players.a.win, 1);
});

// ---------- replay ----------
const done = ev({ state: 'post', completed: true, detail: 'Final',
  away: team('AAA', 20, [7, 3, 0, 10]), home: team('HHH', 24, [0, 14, 7, 3]) });
const k = Date.parse(done.date);
test('replay: before kickoff is pre with no score', () => {
  const r = rewindEvent(done, k - 60e3);
  eq([r.state, r.away.score, r.home.score], ['pre', null, null]);
});
test('replay: halftime shows first-half points', () => {
  const r = rewindEvent(done, k + 90 * 60e3);
  eq([r.state, r.detail, r.away.score, r.home.score], ['in', 'Halftime', 10, 14]);
});
test('replay: early 4th quarter has three quarters of points', () => {
  const r = rewindEvent(done, k + GAME_MS - 40 * 60e3);
  eq([r.period, r.away.score, r.home.score], [4, 10, 21]);
});
test('replay: after the game it is the real final', () => eq(rewindEvent(done, k + GAME_MS), done));
