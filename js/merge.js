// Builds/merges a week file from a parsed paste.
//
// Week file (data/<season>/week-<n>.json):
// {
//   season, week, updatedAt,
//   games: [{ id, order, kickoff, away, home, awayName, homeName, gridAway, gridHome }],
//   tiebreakGameId,
//   picks: { playerId: { gameId: "WSH" | "HIDDEN" | "NONE" } },
//   tiebreak: { playerId: number },          // Monday-night total guesses (when the site shows them)
//   lines: { gameId: { favorite, spread, overUnder, details, provider } },
//   log: [{ at, players, revealed }]
// }
//
// Merge rules for a re-paste:
//   - A revealed value (team or NO PICK) in the new paste wins: that is how corrections get in.
//   - HIDDEN never erases a pick we already know.
//   - Players in the saved week but missing from the new paste are kept and reported.
import { HIDDEN, NONE, tiebreakerGameId } from './parser.js';

export const isTeam = v => !!v && v !== HIDDEN && v !== NONE;

export function buildWeek({ existing, season, week, games, rows, playerIdByKey, lines = {}, now = new Date().toISOString() }) {
  const prev = existing || {};
  const out = {
    season, week, updatedAt: now,
    games,
    tiebreakGameId: tiebreakerGameId(games),
    picks: JSON.parse(JSON.stringify(prev.picks || {})),
    tiebreak: { ...(prev.tiebreak || {}) },
    lines: { ...(prev.lines || {}), ...lines },
    log: [...(prev.log || [])],
  };
  const diff = { revealed: 0, changed: [], removed: [], latePicks: [], missingPlayers: [], newPlayers: [] };
  const pasted = new Set();

  for (const r of rows) {
    const pid = playerIdByKey[r.key];
    if (!pid) continue;
    pasted.add(pid);
    if (!prev.picks?.[pid]) diff.newPlayers.push(pid);
    const cur = (out.picks[pid] ||= {});
    games.forEach(g => {
      const cell = r.picks[g.order];
      if (!cell) return;
      const nv = cell.status === 'PICK' ? (cell.side === 'away' ? g.gridAway : g.gridHome) : cell.status === HIDDEN ? HIDDEN : NONE;
      const pv = cur[g.id];
      const final = nv === HIDDEN && isTeam(pv) ? pv : nv;
      if (isTeam(final) && !isTeam(pv)) {
        if (pv === NONE) diff.latePicks.push({ pid, gameId: g.id, to: final });
        else diff.revealed++;
      } else if (isTeam(pv) && final !== pv) {
        (isTeam(final) ? diff.changed : diff.removed).push({ pid, gameId: g.id, from: pv, to: final });
      }
      cur[g.id] = final;
    });
  }
  for (const pid of Object.keys(prev.picks || {})) if (!pasted.has(pid)) diff.missingPlayers.push(pid);

  const revealedNow = Object.values(out.picks).reduce((n, p) => n + Object.values(p).filter(isTeam).length, 0);
  out.log.push({ at: now, players: rows.length, revealed: revealedNow });
  return { week: out, diff };
}
