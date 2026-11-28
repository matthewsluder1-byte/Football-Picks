// Season standings from the saved weeks.
//
// Pool rules (from the commissioner's answers):
//   Week winner: most correct. Tie -> closest to the Monday-night combined score (either side).
//                Still tied (same distance, or no guesses saved) -> the winners split.
//   Season:      total correct over the year. Tie -> lowest average miss on the Monday totals.
// A wrong pick, a NO PICK and a tied game all count as not correct.
import { scorePlayers, gameResult } from './scoring.js';

/** Monday total for a final tiebreak game, else null. */
function tiebreakTotal(weekData, eventsById) {
  const ev = eventsById.get(weekData.tiebreakGameId);
  return ev && gameResult(ev) ? (ev.home.score || 0) + (ev.away.score || 0) : null;
}

/** One week: scores, whether every game is final, the winner(s) and each player's tiebreak miss. */
export function weekSummary(weekData, eventsById, nowMs = Date.now()) {
  const scored = scorePlayers(weekData, eventsById, nowMs);
  const final = weekData.games.every(g => gameResult(eventsById.get(g.id)));
  const total = tiebreakTotal(weekData, eventsById);
  const guesses = weekData.tiebreak || {};
  const miss = pid => (total != null && typeof guesses[pid] === 'number' ? Math.abs(guesses[pid] - total) : null);
  const players = Object.fromEntries(scored.map(s => [s.pid, { correct: s.correct, max: s.max, miss: miss(s.pid) }]));
  let winners = [];
  if (final && scored.length) {
    const best = Math.max(...scored.map(s => s.correct));
    winners = scored.filter(s => s.correct === best).map(s => s.pid);
    const misses = winners.map(miss).filter(m => m != null);
    if (winners.length > 1 && misses.length) {
      const m = Math.min(...misses);
      winners = winners.filter(p => miss(p) === m);
    }
  }
  return { final, total, winners, players };
}

/**
 * @param weeks [{ week, data, events: Map }]
 * @returns { weeks: number[], rows: [{ pid, total, played, wins, avgMiss, byWeek: { [w]: { correct, final, won, max } } }] }
 * rows sorted: total desc, then average tiebreak miss asc (players with no guesses last).
 */
export function seasonStandings(weeks, nowMs = Date.now()) {
  const sorted = [...weeks].sort((a, b) => a.week - b.week);
  const rows = new Map();
  const row = pid => {
    if (!rows.has(pid)) rows.set(pid, { pid, total: 0, played: 0, wins: 0, missSum: 0, missN: 0, byWeek: {} });
    return rows.get(pid);
  };
  for (const w of sorted) {
    const s = weekSummary(w.data, w.events, nowMs);
    for (const [pid, p] of Object.entries(s.players)) {
      const r = row(pid);
      const won = s.winners.includes(pid);
      r.byWeek[w.week] = { correct: p.correct, max: p.max, final: s.final, won, share: won ? 1 / s.winners.length : 0 };
      r.total += p.correct;
      r.played++;
      if (won) r.wins += 1 / s.winners.length;
      if (s.final && p.miss != null) { r.missSum += p.miss; r.missN++; }
    }
  }
  const out = [...rows.values()].map(({ missSum, missN, ...r }) => ({ ...r, avgMiss: missN ? missSum / missN : null }));
  out.sort((a, b) => b.total - a.total || (a.avgMiss ?? Infinity) - (b.avgMiss ?? Infinity) || a.pid.localeCompare(b.pid));
  // Rank with ties: same total and same average miss share a rank.
  out.forEach((r, i) => {
    const p = out[i - 1];
    r.rank = p && p.total === r.total && p.avgMiss === r.avgMiss ? p.rank : i + 1;
  });
  return { weeks: sorted.map(w => w.week), rows: out };
}
