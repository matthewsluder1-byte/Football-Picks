// Phase 2: odds of winning the week.
//
// Game model: final home margin ~ Normal(mean, sd).
//   before kickoff  mean = home spread (from the pre-game line), sd = 13.45 (NFL margin spread)
//   during the game mean = current margin + spread * (time left / 60 min) + possession bonus
//                   sd   = 13.45 * sqrt(time left / 60 min)
// Pool model: Monte Carlo over the games that are not final. Picks not known yet (HIDDEN, or
// NO PICK before the lock) are drawn from how the rest of the pool picked that game, nudged
// toward the favorite. Ties for first split the win; Monday-total guesses break ties when saved.
import { gameResult, lockTime } from './scoring.js';
import { HIDDEN, NONE } from './parser.js';
import { isTeam } from './merge.js';

const SIGMA = 13.45;
const POSSESSION_PTS = 1.5;
const HOME_FIELD = 1.5;   // used only when there is no line

export function normCdf(x) {
  // Abramowitz-Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x / 2);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/** Expected home margin before kickoff. */
export function homeSpread(ev, line) {
  if (line?.favorite === ev.home.abbr) return line.spread;
  if (line?.favorite === ev.away.abbr) return -line.spread;
  if (line) return 0;                       // EVEN / PK
  return ev.neutral ? 0 : HOME_FIELD;
}

/** Seconds of regulation left (overtime counts its own clock). */
export function secondsLeft(ev) {
  if (ev.state === 'pre') return 3600;
  if (ev.state === 'post') return 0;
  const clock = ev.clock ?? 0;
  return ev.period <= 4 ? (4 - ev.period) * 900 + clock : clock;
}

/** P(home team wins). Ties are ignored (rare). */
export function winProbHome(ev, line) {
  const res = gameResult(ev);
  if (res) return res === ev.home.abbr ? 1 : res === ev.away.abbr ? 0 : 0.5;
  const spread = homeSpread(ev, line);
  if (ev.state !== 'in') return normCdf(spread / SIGMA);
  const f = secondsLeft(ev) / 3600;
  const poss = ev.possession === ev.home.abbr ? POSSESSION_PTS : ev.possession === ev.away.abbr ? -POSSESSION_PTS : 0;
  const mean = (ev.home.score || 0) - (ev.away.score || 0) + spread * f + poss;
  const sd = SIGMA * Math.sqrt(f) + (ev.period > 4 ? 3 : 0);
  if (sd < 0.3) return mean > 0 ? 1 : mean < 0 ? 0 : 0.5;
  return normCdf(mean / sd);
}

export function rng(seed) {   // mulberry32: same numbers every refresh, so odds don't jitter
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/**
 * @returns {{
 *   players: { [pid]: { win: number, expCorrect: number } },
 *   games:   { [gameId]: { pHome: number, final: boolean } },
 *   swing:   [{ gameId, team, other, ifTeam, ifOther }]   // for opts.focus: who to root for
 *   sims: number
 * }}
 */
export function weekOdds(weekData, eventsById, { now = Date.now(), sims = 10000, seed = 7, focus = null } = {}) {
  const games = [...weekData.games].sort((a, b) => a.order - b.order);
  const pids = Object.keys(weekData.picks);
  const P = pids.length, G = games.length;
  const lines = weekData.lines || {};

  const gm = games.map(g => {
    const ev = eventsById.get(g.id);
    const line = lines[g.id] || ev?.line || null;
    const res = ev ? gameResult(ev) : null;
    const pHome = ev ? winProbHome(ev, line) : 0.5;
    const pre = ev ? normCdf(homeSpread(ev, line) / SIGMA) : 0.5;
    // How the pool picks this game: revealed share, smoothed toward "favorite at ~1.4x its edge".
    let home = 0, tot = 0;
    for (const pid of pids) { const v = weekData.picks[pid][g.id]; if (isTeam(v)) { tot++; if (v === g.home) home++; } }
    const prior = clamp(0.5 + 1.4 * (pre - 0.5), 0.05, 0.95);
    const pickHome = (home + 2 * prior) / (tot + 2);
    return { g, res, pHome, pickHome, locked: now >= lockTime(g), final: !!res };
  });

  // Per player: fixed correct count + per-game cell kinds for the undecided part.
  // kind: 0 = no chance, 1 = picked home, 2 = picked away, 3 = unknown pick (random)
  const base = new Uint8Array(P);
  const kind = new Uint8Array(P * G);
  pids.forEach((pid, i) => {
    gm.forEach((x, j) => {
      const v = weekData.picks[pid][x.g.id] ?? NONE;
      const unknown = v === HIDDEN || (v === NONE && !x.locked);
      if (x.final) {
        if (x.res === 'TIE' || x.res === 'VOID') return;
        if (isTeam(v)) { if (v === x.res) base[i]++; return; }
        if (unknown) kind[i * G + j] = 3;   // final, pick still hidden: drawn like any unknown pick
        return;
      }
      kind[i * G + j] = isTeam(v) ? (v === x.g.home ? 1 : 2) : unknown ? 3 : 0;
    });
  });

  const open = gm.map((x, j) => (x.final ? -1 : j)).filter(j => j >= 0);
  // Final games that count (not tie/void): outcome fixed, still drawn for still-hidden picks.
  const decided = gm.map((x, j) => (x.final && x.res !== 'TIE' && x.res !== 'VOID' ? j : -1)).filter(j => j >= 0);
  const loop = [...open, ...decided];
  const fi = focus ? pids.indexOf(focus) : -1;
  const win = new Float64Array(P), exp = new Float64Array(P);
  const condN = open.map(() => [0, 0]), condW = open.map(() => [0, 0]);   // [homeWon, awayWon]

  // Tiebreaker (closest to the Monday total) only when guesses were saved.
  const tbGuess = weekData.tiebreak || {};
  const tbIdx = gm.findIndex(x => x.g.id === weekData.tiebreakGameId);
  const tbEv = tbIdx >= 0 ? eventsById.get(gm[tbIdx].g.id) : null;
  const hasTb = tbEv && pids.some(p => typeof tbGuess[p] === 'number');
  const tbLine = tbIdx >= 0 ? (lines[gm[tbIdx].g.id] || tbEv?.line) : null;

  const r = rng(seed);
  const score = new Float64Array(P);
  const homeWon = new Uint8Array(G);
  for (const j of decided) homeWon[j] = gm[j].res === gm[j].g.home ? 1 : 0;
  // Unknown picks are fixed for a given player within a sim but differ between sims.
  for (let s = 0; s < sims; s++) {
    for (const j of open) homeWon[j] = r() < gm[j].pHome ? 1 : 0;
    let best = -1;
    for (let i = 0; i < P; i++) {
      let c = base[i];
      const off = i * G;
      for (const j of loop) {
        const k = kind[off + j];
        if (k === 1) c += homeWon[j];
        else if (k === 2) c += 1 - homeWon[j];
        else if (k === 3) c += (r() < gm[j].pickHome ? 1 : 0) === homeWon[j] ? 1 : 0;
      }
      score[i] = c; exp[i] += c;
      if (c > best) best = c;
    }
    let tied = [];
    for (let i = 0; i < P; i++) if (score[i] === best) tied.push(i);
    if (tied.length > 1 && hasTb) {
      let total;
      if (tbEv.state === 'post') total = (tbEv.home.score || 0) + (tbEv.away.score || 0);
      else {
        const f = secondsLeft(tbEv) / 3600;
        const now0 = (tbEv.home.score || 0) + (tbEv.away.score || 0);
        const z = Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());
        total = now0 + (tbLine?.overUnder ?? 44) * f + 10 * Math.sqrt(f) * z;
      }
      const miss = i => (typeof tbGuess[pids[i]] === 'number' ? Math.abs(tbGuess[pids[i]] - total) : Infinity);
      const m = Math.min(...tied.map(miss));
      if (m < Infinity) tied = tied.filter(i => miss(i) === m);
    }
    const share = 1 / tied.length;
    for (const i of tied) win[i] += share;
    if (fi >= 0) {
      const myShare = tied.includes(fi) ? share : 0;
      open.forEach((j, n) => { const o = homeWon[j] ? 0 : 1; condN[n][o]++; condW[n][o] += myShare; });
    }
  }

  const players = Object.fromEntries(pids.map((pid, i) => [pid, { win: win[i] / sims, expCorrect: exp[i] / sims }]));
  const gamesOut = Object.fromEntries(gm.map(x => [x.g.id, { pHome: x.pHome, final: x.final }]));
  const swing = fi < 0 ? [] : open.map((j, n) => {
    const g = gm[j].g;
    const ifHome = condN[n][0] ? condW[n][0] / condN[n][0] : null;
    const ifAway = condN[n][1] ? condW[n][1] / condN[n][1] : null;
    const homeBetter = (ifHome ?? 0) >= (ifAway ?? 0);
    return {
      gameId: g.id,
      team: homeBetter ? g.home : g.away, other: homeBetter ? g.away : g.home,
      ifTeam: homeBetter ? ifHome : ifAway, ifOther: homeBetter ? ifAway : ifHome,
    };
  }).sort((a, b) => Math.abs((b.ifTeam ?? 0) - (b.ifOther ?? 0)) - Math.abs((a.ifTeam ?? 0) - (a.ifOther ?? 0)));
  return { players, games: gamesOut, swing, sims };
}
