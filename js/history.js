// Win-% over time: odds recomputed at the moments they change during the week.
//
// Moments: just before the first kickoff, each pick lock, and the end of each quarter of each
// game (quarter scores come from the score feed). The board is rewound to each moment with the
// replay model, so a quarter's points show up when that quarter ends. The picks are the ones
// saved now, so hidden picks revealed later are used for earlier moments too.
import { weekOdds } from './odds.js';
import { rewindBoard, GAME_MS } from './replay.js';
import { lockTime } from './scoring.js';

const QUARTER_ENDS = [42.5, 85, 147.5].map(m => m * 60e3).concat(GAME_MS);

/** Sorted, de-duplicated moments up to nowMs. */
export function historyTimes(weekData, board, nowMs) {
  const kicks = board.events.map(e => Date.parse(e.date)).filter(Number.isFinite);
  if (!kicks.length) return [];
  const locks = weekData.games.map(lockTime);
  const t = new Set([Math.min(...kicks, ...locks) - 60e3]);   // just before the first lock or kickoff
  for (const l of locks) t.add(l + 1);
  for (const k of kicks) for (const q of QUARTER_ENDS) t.add(k + q + 1);
  return [...t].filter(x => x <= nowMs).sort((a, b) => a - b);
}

/**
 * Win chances at each moment. `cache` (a Map) keeps points already worked out, so a live
 * refresh only adds the new ones. Yields to the page between points.
 * @returns [{ at, players: { pid: win } }]
 */
export async function winHistory(weekData, board, nowMs, { sims = 2000, cache = new Map(), current = board } = {}) {
  const out = [];
  for (const at of historyTimes(weekData, board, nowMs)) {
    const key = `${weekData.updatedAt}|${at}`;
    let players = cache.get(key);
    if (!players) {
      const b = rewindBoard(board, at);
      const o = weekOdds(weekData, new Map(b.events.map(e => [e.id, e])), { now: at, sims });
      players = Object.fromEntries(Object.entries(o.players).map(([p, x]) => [p, x.win]));
      // A game still being played may not have reached this moment yet: work it out again later.
      if (!board.events.some(e => e.state === 'in' && Date.parse(e.date) <= at)) cache.set(key, players);
      await new Promise(r => setTimeout(r, 0));
    }
    out.push({ at, players });
  }
  // The current moment from the board as it is now (not cached: it changes every refresh).
  const o = weekOdds(weekData, new Map(current.events.map(e => [e.id, e])), { now: nowMs, sims });
  out.push({ at: nowMs, players: Object.fromEntries(Object.entries(o.players).map(([p, x]) => [p, x.win])), now: true });
  return out;
}
