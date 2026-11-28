// Replay: rewinds a finished week's scoreboard to any moment, so the Live and Odds views
// can be tested on a Saturday. Uses real final scores and per-quarter scoring (linescores):
// a quarter's points appear when that quarter ends; the final appears at the end.
// Timing model: 170 real minutes of play plus a 20-minute halftime (190 minutes kickoff to final).

const PLAY_MS = 170 * 60e3;
const HALF_MS = 20 * 60e3;
export const GAME_MS = PLAY_MS + HALF_MS;

const blank = t => ({ ...t, score: null, winner: false });

export function rewindEvent(e, at) {
  const k = Date.parse(e.date);
  if (at < k) {
    return { ...e, state: 'pre', completed: false, detail: '', period: 0, clock: null, displayClock: '',
      away: blank(e.away), home: blank(e.home), possession: null, downDistance: '', redZone: false };
  }
  const live = e.state === 'in';
  if (!live && (e.state !== 'post' || !e.completed)) return e;
  if (at >= k + GAME_MS) return e;

  const real = at - k;
  const halftime = real >= PLAY_MS / 2 && real < PLAY_MS / 2 + HALF_MS;
  const played = real < PLAY_MS / 2 ? real : halftime ? PLAY_MS / 2 : real - HALF_MS;
  const g = Math.min(3599, (3600 * played) / PLAY_MS);       // game seconds elapsed
  const period = halftime ? 2 : Math.floor(g / 900) + 1;
  const clock = halftime ? 0 : Math.round(900 - (g % 900));
  const done = halftime ? 2 : period - 1;                     // completed quarters
  // A game still being played can only be rewound to before its last finished quarter.
  if (live && done >= (e.detail === 'Halftime' ? 2 : Math.min(4, e.period - 1))) return e;
  const scoreAt = t => (t.quarters || []).slice(0, done).reduce((a, b) => a + b, 0);
  const away = { ...e.away, score: scoreAt(e.away), winner: false };
  const home = { ...e.home, score: scoreAt(e.home), winner: false };
  const mmss = `${Math.floor(clock / 60)}:${String(clock % 60).padStart(2, '0')}`;
  const possession = halftime ? null : Math.floor(g / 150) % 2 ? home.abbr : away.abbr;
  return {
    ...e, state: 'in', completed: false, period, clock, displayClock: mmss,
    detail: halftime ? 'Halftime' : `${mmss} - ${['1st', '2nd', '3rd', '4th'][period - 1]}`,
    away, home, possession, downDistance: possession ? 'Replay' : '', redZone: false,
  };
}

export function rewindBoard(board, at) {
  return { ...board, events: board.events.map(e => rewindEvent(e, at)), fetchedAt: at };
}
