// Correct / max-possible counts and pick locks.
import { HIDDEN, NONE } from './parser.js';
import { isTeam } from './merge.js';

/** Winner abbreviation, 'TIE', 'VOID' (postponed/canceled: counts for nobody), or null if not final. */
export function gameResult(ev) {
  if (!ev || ev.state !== 'post') return null;
  if (!ev.completed) return 'VOID';
  if (ev.away.score === ev.home.score) return 'TIE';
  return ev.away.score > ev.home.score ? ev.away.abbr : ev.home.abbr;
}

function nyParts(ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short', hour: 'numeric', hourCycle: 'h23',
  }).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, wd: p.weekday, h: +p.hour };
}

/** UTC ms for 12:00 noon New York time on the given NY calendar date. */
export function nyNoon(y, m, d) {
  for (const off of [4, 5]) {
    const t = Date.UTC(y, m - 1, d, 12 + off);
    if (nyParts(t).h === 12) return t;
  }
  return Date.UTC(y, m - 1, d, 17);
}

/**
 * Pool rule: Thursday/Saturday games lock at kickoff; every Sunday and Monday game
 * locks at noon ET Sunday (or at kickoff if earlier, e.g. a 9:30 ET London game).
 */
export function lockTime(game) {
  const k = Date.parse(game.kickoff);
  const p = nyParts(k);
  if (p.wd !== 'Sun' && p.wd !== 'Mon') return k;
  const sunday = p.wd === 'Mon' ? nyParts(k - 24 * 3600e3) : p;
  return Math.min(k, nyNoon(sunday.y, sunday.m, sunday.d));
}

/**
 * Per player, per game cell state:
 *   win / loss            final, decided
 *   open                  pick known, game not final
 *   hidden                pick not revealed yet (could still be right)
 *   pending-none          no pick yet and the game is not locked (they can still pick)
 *   none                  no pick and locked: cannot be right
 *   unknown               game final but pick still HIDDEN: re-paste to reveal
 */
export function scorePlayers(weekData, eventsById, nowMs = Date.now()) {
  const games = [...weekData.games].sort((a, b) => a.order - b.order);
  const results = Object.fromEntries(games.map(g => [g.id, gameResult(eventsById.get(g.id))]));
  return Object.entries(weekData.picks).map(([pid, picks]) => {
    let correct = 0, possible = 0;
    const cells = games.map(g => {
      const v = picks[g.id] ?? NONE;
      const res = results[g.id];
      const locked = nowMs >= lockTime(g);
      let st;
      if (res) st = v === HIDDEN ? 'unknown' : v === res ? 'win' : 'loss';
      else if (isTeam(v)) st = 'open';
      else if (v === HIDDEN) st = 'hidden';
      else st = locked ? 'none' : 'pending-none';
      if (st === 'win') correct++;
      if (st === 'open' || st === 'hidden' || st === 'pending-none' || st === 'unknown') possible++;
      return { gameId: g.id, value: v, state: st };
    });
    return { pid, correct, max: correct + possible, cells };
  });
}
