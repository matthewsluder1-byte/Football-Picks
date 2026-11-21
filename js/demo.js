// Demo picks for replay testing (week 10, 2026). Uses the real Thursday paste from
// tests/fixtures; every HIDDEN pick is filled in at random, leaning toward the favorite the way
// a pool usually does. NO PICK stays NO PICK. Nothing here is ever saved.
import { parseGrid, matchSchedule, HIDDEN } from './parser.js';
import { matchNames, defaultDecisions, applyDecisions } from './names.js';
import { buildWeek } from './merge.js';
import { normScoreboard } from './espn.js';
import { normCdf, homeSpread, rng } from './odds.js';

export const DEMO = { season: 2026, week: 10 };

export async function demoWeek() {
  const text = await (await fetch('tests/fixtures/grid-2026-w10-thu.txt')).text();
  const fx = normScoreboard(await (await fetch('tests/fixtures/scoreboard-2026-w10.json')).json());
  const grid = parseGrid(text);
  const sched = matchSchedule(grid.matchups, fx.events);
  const matches = matchNames(grid.rows, []);
  const { players, playerIdByKey } = applyDecisions([], matches, defaultDecisions(matches));
  const evs = new Map(fx.events.map(e => [e.id, e]));
  const lines = Object.fromEntries(fx.events.filter(e => e.line).map(e => [e.id, e.line]));
  const byOrder = new Map(sched.games.map(g => [g.order, g]));
  const r = rng(2026);
  const rows = grid.rows.map(row => ({
    ...row,
    picks: row.picks.map((c, order) => {
      if (c.status !== HIDDEN) return c;
      const g = byOrder.get(order), ev = evs.get(g.id);
      const pHome = Math.min(0.95, Math.max(0.05, 0.5 + 1.4 * (normCdf(homeSpread(ev, lines[g.id]) / 13.45) - 0.5)));
      return { status: 'PICK', side: r() < pHome ? 'home' : 'away', raw: 'demo' };
    }),
  }));
  const { week } = buildWeek({ season: DEMO.season, week: DEMO.week, games: sched.games, rows, playerIdByKey, lines, now: '2026-11-15T17:00:00Z' });
  week.demo = true;
  return { roster: players, week };
}
