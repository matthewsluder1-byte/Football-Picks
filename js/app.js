import { fetchScoreboard, fetchLine } from './espn.js';
import { parseGrid, matchSchedule, tiebreakerGameId, HIDDEN, NONE } from './parser.js';
import { matchNames, defaultDecisions, applyDecisions } from './names.js';
import { buildWeek, isTeam } from './merge.js';
import { scorePlayers, gameResult, lockTime } from './scoring.js';
import { loadJSON, saveFiles, isLocal, repoInfo, getToken, setToken, checkGitHub } from './store.js';
import { weekOdds, winProbHome } from './odds.js';
import { rewindBoard, GAME_MS } from './replay.js';
import { demoWeek, DEMO } from './demo.js';

const S = {
  config: null, roster: [], index: null,
  season: null, currentWeek: null, week: null,
  board: null, weekData: null, tab: 'live', pending: null, timer: null, feedError: null,
  // Replay mode (?replay=<week>): a finished week played back at a chosen moment. Never saves.
  replay: null,     // { at: ms, real: final board, realWeek }
  savedRoster: null, odds: null, oddsKey: '',
};
const now = () => (S.replay?.at ?? Date.now());
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtTime = iso => new Date(iso).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
const playerById = id => S.roster.find(p => p.id === id);
const display = id => { const p = playerById(id); return p ? (S.config.useInitials ? p.initials : p.name) : id; };
const meId = () => S.roster.find(p => p.key === S.config.me)?.id;
const eventsById = () => new Map((S.board?.events || []).map(e => [e.id, e]));

function setStatus(msg) { $('#status').textContent = msg; }

async function init() {
  S.config = await loadJSON('data/config.json', { season: 2026, me: 'sluder,matt', useInitials: false });
  S.roster = (await loadJSON('data/players.json', { players: [] })).players;
  S.index = await loadJSON('data/index.json', { weeks: {} });
  S.savedRoster = S.roster;
  try {
    const b = await fetchScoreboard();
    S.season = b.season; S.currentWeek = b.week;
  } catch (e) {
    S.season = S.config.season; S.currentWeek = 1; S.feedError = e.message;
  }
  const rw = parseInt(new URLSearchParams(location.search).get('replay'), 10);
  if (rw >= 1 && rw <= 18) S.replay = { at: null, real: null, realWeek: null };
  buildWeekSelect();
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => { S.tab = b.dataset.tab; render(); }));
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !S.replay) refresh(); });
  await loadWeek(S.replay ? rw : S.currentWeek);
}

// ---------- Replay ----------
const etWeekday = ms => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(new Date(ms));

function replayMarks(events) {
  const ks = [...new Set(events.map(e => Date.parse(e.date)))].sort((a, b) => a - b);
  const sun = ks.filter(k => etWeekday(k) === 'Sun');
  const marks = [];
  if (sun.length) {
    marks.push(['Sun before lock', Math.min(...sun) - 90 * 60e3]);
    for (const k of [...new Set(sun)]) marks.push([`${fmtTime(new Date(k).toISOString())} +1h`, k + 60 * 60e3]);
  }
  const mon = ks.filter(k => etWeekday(k) === 'Mon');
  if (mon.length) marks.push(['Mon 4th qtr', Math.max(...mon) + 150 * 60e3]);
  marks.push(['All final', Math.max(...ks) + GAME_MS + 60e3]);
  return marks;
}

function renderReplayBar() {
  const bar = $('#replayBar');
  if (!S.replay) { bar.hidden = true; return; }
  bar.hidden = false;
  const marks = S.replay.real ? replayMarks(S.replay.real.events) : [];
  bar.innerHTML = `<b>Replay</b> <span>${esc(new Date(S.replay.at || Date.now()).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}</span>
    ${[['−1h', -60], ['−15m', -15], ['+15m', 15], ['+1h', 60]].map(([l, m]) => `<button data-step="${m}">${l}</button>`).join('')}
    <select id="replayJump"><option value="">Jump to…</option>${marks.map(([l, t]) => `<option value="${t}">${esc(l)}</option>`).join('')}</select>
    ${S.weekData?.demo ? '<span class="muted small">Demo picks: Thursday paste is real, hidden picks filled in at random.</span>' : ''}
    <a href="./" class="small">Exit replay</a>`;
  bar.querySelectorAll('button[data-step]').forEach(b => b.onclick = () => setReplay(S.replay.at + +b.dataset.step * 60e3));
  $('#replayJump').onchange = e => { if (e.target.value) setReplay(+e.target.value); };
}

function setReplay(at) {
  S.replay.at = at;
  S.board = rewindBoard(S.replay.real, at);
  setStatus('');
  render();
}

function buildWeekSelect() {
  const sel = $('#weekSel');
  const saved = S.index?.weeks?.[S.season] || [];
  sel.innerHTML = Array.from({ length: 18 }, (_, i) => i + 1)
    .map(w => `<option value="${w}">Week ${w}${saved.includes(w) ? ' ✓' : ''}${w === S.currentWeek ? ' (now)' : ''}</option>`).join('');
  sel.value = S.week ?? S.currentWeek;
  sel.onchange = () => loadWeek(+sel.value);
}

async function loadWeek(w) {
  S.week = w;
  $('#weekSel').value = w;
  S.weekData = await loadJSON(`data/${S.season}/week-${w}.json`, null);
  S.roster = S.savedRoster;
  if (!S.weekData && S.replay && S.season === DEMO.season && w === DEMO.week) {
    const d = await demoWeek();
    S.weekData = d.week; S.roster = d.roster;
  }
  await refresh();
}

async function refresh() {
  if (S.replay) {
    try {
      if (S.replay.realWeek !== S.week) {
        S.replay.real = await fetchScoreboard(S.season, S.week);
        S.replay.realWeek = S.week;
        S.replay.at = replayMarks(S.replay.real.events)[0]?.[1] ?? Date.parse(S.replay.real.events[0].date);
      }
      S.board = rewindBoard(S.replay.real, S.replay.at);
      S.feedError = null;
    } catch (e) { S.feedError = e.message; setStatus(`Score feed error: ${e.message}`); }
    render();
    return;
  }
  try {
    S.board = await fetchScoreboard(S.season, S.week);
    S.feedError = null;
    setStatus(`Scores ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}`);
  } catch (e) {
    S.feedError = e.message;
    setStatus(`Score feed error: ${e.message}`);
  }
  if (S.tab !== 'import') render();
  schedule();
}

function schedule() {
  clearTimeout(S.timer);
  const now = Date.now();
  const busy = (S.board?.events || []).some(e => e.state === 'in' || (e.state === 'pre' && Date.parse(e.date) - now < 15 * 60e3));
  S.timer = setTimeout(refresh, busy ? 30e3 : 5 * 60e3);
}

function render() {
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === S.tab));
  renderReplayBar();
  const v = $('#view');
  if (S.tab === 'import' && S.replay) v.innerHTML = '<p class="empty">Import is off in replay mode, so test data never gets saved. <a href="./">Exit replay</a> to import.</p>';
  else if (S.tab === 'live') v.innerHTML = renderLive();
  else if (S.tab === 'picks') v.innerHTML = renderPicks();
  else renderImport(v);
}

// ---------- Odds ----------
function odds() {
  if (!S.weekData || !S.board) return null;
  const key = `${S.season}|${S.week}|${S.board.fetchedAt}|${S.weekData.updatedAt}|${Math.floor(now() / 60e3)}`;
  if (S.oddsKey !== key) {
    S.odds = weekOdds(S.weekData, eventsById(), { now: now(), focus: meId() });
    S.oddsKey = key;
  }
  return S.odds;
}

const pct = x => (x == null ? '–' : x >= 0.995 && x < 1 ? '>99%' : x > 0 && x < 0.005 ? '<1%' : `${Math.round(x * 100)}%`);
/** Win chance label: "out" only when the player's max is below someone's current correct count. */
function winLabel(win, max, bestCorrect) {
  if (max < bestCorrect) return 'out';
  return win === 0 ? '<1%' : pct(win);
}

function renderOddsCard() {
  const o = odds();
  if (!o) return '';
  const me = meId();
  const scored = scorePlayers(S.weekData, eventsById(), now());
  const mine = scored.find(s => s.pid === me);
  const best = Math.max(0, ...scored.map(s => s.correct));
  const top = Object.entries(o.players).sort((a, b) => b[1].win - a[1].win).slice(0, 5);
  const hidden = Object.values(S.weekData.picks).reduce((n, p) => n + Object.values(p).filter(v => v === HIDDEN).length, 0);
  const games = new Map(S.weekData.games.map(g => [g.id, g]));
  const roots = o.swing.filter(s => s.ifTeam != null && s.ifOther != null && s.ifTeam - s.ifOther >= 0.005).slice(0, 6);
  const meLine = me && o.players[me]
    ? `<div class="big"><b>${winLabel(o.players[me].win, mine.max, best)}</b> <span class="muted">${mine.max < best ? `can't catch the leader in week ${S.week}` : `your chance to win week ${S.week}`}</span></div>
       <div class="muted small">${mine.correct} right so far · max ${mine.max} · projected ${o.players[me].expCorrect.toFixed(1)}</div>`
    : `<div class="muted">You (${esc(S.config.me)}) are not in this week's picks.</div>`;
  return `<section class="odds">
    <div>${meLine}
      <div class="small topodds">${top.map(([pid, x]) => `<span class="${pid === me ? 'me' : ''}">${esc(display(pid))} ${pct(x.win)}</span>`).join(' · ')}</div>
      ${hidden ? `<div class="muted small">${hidden} picks still hidden: odds assume they split like the rest of the pool. Re-paste after the lock for exact odds.</div>` : ''}
    </div>
    ${roots.length ? `<div><div class="small muted">Root for</div><ul class="roots">${roots.map(s => {
      return `<li title="${esc(games.get(s.gameId)?.awayName)} at ${esc(games.get(s.gameId)?.homeName)}"><b>${esc(s.team)}</b> <span class="muted">over ${esc(s.other)}</span> <span class="num">${pct(s.ifOther)} → ${pct(s.ifTeam)}</span></li>`;
    }).join('')}</ul></div>` : ''}
  </section>`;
}

// ---------- Live ----------
function poolCounts(gameId) {
  const c = { HIDDEN: 0, NONE: 0 };
  for (const p of Object.values(S.weekData?.picks || {})) { const v = p[gameId] ?? NONE; c[v] = (c[v] || 0) + 1; }
  return c;
}

function renderLive() {
  if (!S.board) return `<p class="empty">Score feed unavailable${S.feedError ? `: ${esc(S.feedError)}` : ''}.</p>`;
  const me = meId();
  const tb = S.weekData?.tiebreakGameId;
  const o = odds();
  const cards = S.board.events.map(e => {
    const res = gameResult(e);
    const c = S.weekData ? poolCounts(e.id) : null;
    const myPick = me && S.weekData?.picks?.[me]?.[e.id];
    const lineObj = S.weekData?.lines?.[e.id] || e.line;
    let line = lineObj ? `${esc(lineObj.details || 'EVEN')}${lineObj.overUnder != null ? ` · O/U ${lineObj.overUnder}` : ''}` : '';
    if (!res) {
      const pHome = o?.games[e.id]?.pHome ?? winProbHome(e, lineObj);
      const fav = pHome >= 0.5 ? [e.home.abbr, pHome] : [e.away.abbr, 1 - pHome];
      line = `<span class="wp">Win: ${esc(fav[0])} ${pct(fav[1])}</span>${line ? ' · ' + line : ''}`;
    }
    const row = t => `
      <div class="team ${res && res === t.abbr ? 'won' : ''} ${res && res !== t.abbr && res !== 'TIE' ? 'lost' : ''}">
        ${t.logo ? `<img src="${esc(t.logo)}" alt="" width="22" height="22" loading="lazy">` : ''}
        <span class="abbr">${esc(t.abbr)}</span>
        ${e.possession === t.abbr ? '<span class="ball" title="Possession">●</span>' : ''}
        <span class="rec muted">${esc(t.record)}</span>
        <span class="score">${e.state === 'pre' ? '' : esc(t.score)}</span>
      </div>`;
    const status = e.state === 'pre' ? fmtTime(e.date) : esc(e.detail);
    let pool = '';
    if (c) {
      const parts = [`${e.away.abbr} ${c[e.away.abbr] || 0}`, `${e.home.abbr} ${c[e.home.abbr] || 0}`];
      if (c.HIDDEN) parts.push(`${c.HIDDEN} hidden`);
      if (c.NONE) parts.push(`${c.NONE} no pick`);
      const mine = myPick ? `<b class="${res ? (myPick === res ? 'ok' : 'bad') : ''}">You: ${esc(isTeam(myPick) ? myPick : myPick === HIDDEN ? 'hidden' : 'no pick')}</b>` : '';
      pool = `<div class="pool">${mine} <span class="muted">Pool: ${parts.join(' · ')}</span></div>`;
    }
    return `<article class="game ${e.state}">
      <div class="gtop"><span class="gstatus ${e.state === 'in' ? 'live' : ''}">${status}</span>${e.id === tb ? '<span class="tag">Tiebreaker</span>' : ''}<span class="muted">${esc(e.broadcast)}</span></div>
      ${row(e.away)}${row(e.home)}
      ${e.state === 'in' && e.downDistance ? `<div class="sit">${esc(e.downDistance)}${e.redZone ? ' · <b>red zone</b>' : ''}</div>` : ''}
      <div class="line muted">${line}</div>
      ${pool}
    </article>`;
  });
  const note = S.weekData ? '' : `<p class="note">No picks saved for week ${S.week}. Use <b>Import</b> to paste the grid.</p>`;
  return `${note}${renderOddsCard()}<section class="games">${cards.join('')}</section>`;
}

// ---------- Picks ----------
function picksTable(weekData, rows, opts = {}) {
  const games = [...weekData.games].sort((a, b) => a.order - b.order);
  const head = games.map(g => `<th class="g ${g.id === weekData.tiebreakGameId ? 'tb' : ''}" title="${esc(g.awayName)} at ${esc(g.homeName)}">${esc(g.away)}<br>${esc(g.home)}</th>`).join('');
  const body = rows.map(r => `<tr class="${r.isMe ? 'me' : ''}">
      <th class="pname">${esc(r.label)}</th>
      ${opts.scores ? `<td class="num">${r.correct}</td><td class="num muted">${r.max}</td><td class="num">${winLabel(r.win, r.max, opts.best ?? 0)}</td>` : ''}
      ${r.cells.map(c => `<td class="pk ${c.state || ''}">${c.value === HIDDEN ? '·' : c.value === NONE ? '—' : esc(c.value)}</td>`).join('')}
    </tr>`).join('');
  return `<div class="tablewrap"><table class="grid">
    <thead><tr><th class="pname">Player</th>${opts.scores ? '<th class="num">W</th><th class="num">Max</th><th class="num" title="Chance to win the week">Win</th>' : ''}${head}</tr></thead>
    <tbody>${body}</tbody></table></div>`;
}

function renderPicks() {
  if (!S.weekData) return `<p class="empty">No picks saved for week ${S.week}. Use <b>Import</b>.</p>`;
  const me = meId();
  const o = odds();
  const scored = scorePlayers(S.weekData, eventsById(), now()).map(s => ({ ...s, label: display(s.pid), isMe: s.pid === me, win: o?.players[s.pid]?.win ?? 0 }));
  scored.sort((a, b) => (b.isMe - a.isMe) || (b.win - a.win) || (b.correct - a.correct) || (b.max - a.max) || a.label.localeCompare(b.label));
  const last = S.weekData.log?.at(-1);
  return `<p class="muted small">${scored.length} players · last pasted ${last ? fmtTime(last.at) : '?'} ·
      <span class="pk win">right</span> <span class="pk loss">wrong</span> <span class="pk open">pending</span> · = hidden — = no pick</p>
    ${picksTable(S.weekData, scored, { scores: true, best: Math.max(0, ...scored.map(s => s.correct)) })}`;
}

// ---------- Import ----------
function renderImport(v) {
  if (S.pending) return renderConfirm(v);
  v.innerHTML = `
    <section class="import">
      <p>On footballfrenzyonline.com, select the whole picks grid (from <b>Player Name</b> to the last row), copy, and paste here.</p>
      <textarea id="paste" rows="10" placeholder="Paste the picks grid here"></textarea>
      <div class="actions"><button id="parseBtn" class="primary">Read grid</button></div>
      <div id="importMsg"></div>
    </section>
    ${isLocal() ? '' : '<section class="ghsetup" id="ghSetup"></section>'}`;
  $('#parseBtn').onclick = () => startImport($('#paste').value);
  if (!isLocal()) renderGitHubSetup();
}

// GitHub saving setup (hosted page only). The token is typed by the user and kept on this device.
async function renderGitHubSetup(checkNow = true) {
  const box = $('#ghSetup');
  if (!box) return;
  const repo = repoInfo(S.config);
  if (!repo) { box.innerHTML = '<p class="muted small">Saving is off: this address is not a GitHub Pages site and data/config.json has no "github" entry.</p>'; return; }
  const token = getToken();
  const name = `${repo.owner}/${repo.repo}`;
  if (token) {
    box.innerHTML = `<h3>Saving to GitHub</h3><p class="muted small" id="ghState">Checking the token for ${esc(name)}…</p>
      <div class="actions left"><button id="ghForget">Remove token from this device</button></div>`;
    $('#ghForget').onclick = () => { setToken(null); renderGitHubSetup(); };
    if (!checkNow) return;
    const c = await checkGitHub(repo, token);
    const st = $('#ghState');
    if (st) st.outerHTML = c.ok
      ? `<p class="ok small" id="ghState">Ready: imports save to ${esc(name)} as ${esc(c.login)}.</p>`
      : `<p class="err small" id="ghState">${esc(c.error)}</p>`;
    return;
  }
  const newTokenUrl = 'https://github.com/settings/personal-access-tokens/new';
  box.innerHTML = `<h3>Set up saving (once per device)</h3>
    <ol class="small">
      <li>Open <a href="${newTokenUrl}" target="_blank" rel="noopener">GitHub → new fine-grained token</a>.</li>
      <li>Name it "pick'em", pick an expiration, and under <b>Repository access</b> choose <b>Only select repositories</b> → <b>${esc(repo.repo)}</b>.</li>
      <li>Under <b>Permissions → Repository permissions</b>, set <b>Contents</b> to <b>Read and write</b>. Nothing else.</li>
      <li>Generate it, copy it, and paste it here.</li>
    </ol>
    <div class="tokenrow"><input id="ghToken" type="password" autocomplete="off" spellcheck="false" placeholder="github_pat_…" aria-label="GitHub token">
      <button id="ghSave" class="primary">Save token</button></div>
    <p class="muted small">The token stays in this browser only. It can change files in ${esc(name)} and nothing else.</p>
    <div id="ghMsg"></div>`;
  $('#ghSave').onclick = async () => {
    const t = $('#ghToken').value.trim();
    if (!t) return;
    $('#ghMsg').innerHTML = '<p class="muted small">Checking…</p>';
    const c = await checkGitHub(repo, t);
    if (!c.ok) { $('#ghMsg').innerHTML = `<p class="err small">${esc(c.error)}</p>`; return; }
    setToken(t);
    renderGitHubSetup(false);
    $('#ghState').outerHTML = `<p class="ok small" id="ghState">Ready: imports save to ${esc(name)} as ${esc(c.login)}.</p>`;
  };
}

async function boardForWeek(w) {
  if (w === S.week && S.board) return S.board;
  return fetchScoreboard(S.season, w);
}

async function startImport(text) {
  const msg = $('#importMsg');
  msg.innerHTML = '<p class="muted">Reading…</p>';
  const grid = parseGrid(text);
  if (!grid.rows.length) { msg.innerHTML = `<p class="err">${grid.errors.map(esc).join('<br>')}</p>`; return; }
  // Find which week this grid belongs to: the selected week, then neighbors, then ESPN's current week.
  let best = null;
  for (const w of [...new Set([S.week, S.currentWeek, S.week - 1, S.week + 1, S.currentWeek - 1, S.currentWeek + 1])].filter(w => w >= 1 && w <= 18)) {
    try {
      const board = await boardForWeek(w);
      const sched = matchSchedule(grid.matchups, board.events);
      if (!best || sched.games.length > best.sched.games.length) best = { week: w, board, sched };
      if (!sched.unmatched.length) break;
    } catch { /* try next */ }
  }
  if (!best) { msg.innerHTML = '<p class="err">Could not reach the score feed to match games.</p>'; return; }
  const existing = await loadJSON(`data/${S.season}/week-${best.week}.json`, null);
  const matches = matchNames(grid.rows, S.roster);
  S.pending = { text, grid, ...best, existing, matches, decisions: defaultDecisions(matches) };
  render();
}

function previewWeek() {
  const P = S.pending;
  const { players, playerIdByKey } = applyDecisions(S.roster, P.matches, P.decisions);
  const lines = Object.fromEntries(P.board.events.filter(e => e.line).map(e => [e.id, e.line]));
  const { week, diff } = buildWeek({ existing: P.existing, season: S.season, week: P.week, games: P.sched.games, rows: P.grid.rows, playerIdByKey, lines });
  return { players, week, diff };
}

function renderConfirm(v) {
  const P = S.pending;
  const { players, week, diff } = previewWeek();
  const nameOf = id => players.find(p => p.id === id)?.name || id;
  const errors = [...P.grid.errors];
  if (P.sched.unmatched.length) errors.push(`Games not found in week ${P.week}: ${P.sched.unmatched.map(m => `${m.away} at ${m.home}`).join(', ')}`);
  const warnings = [...P.grid.warnings, ...P.sched.warnings];
  const evs = new Map(P.board.events.map(e => [e.id, e]));
  const now = Date.now();

  const gameRows = week.games.map(g => {
    const revealed = Object.values(week.picks).filter(p => isTeam(p[g.id])).length;
    const hidden = Object.values(week.picks).filter(p => p[g.id] === HIDDEN).length;
    const none = Object.values(week.picks).filter(p => p[g.id] === NONE).length;
    const lock = lockTime(g);
    const e = evs.get(g.id);
    return `<tr><td>${g.order + 1}</td><td>${esc(g.awayName)} at ${esc(g.homeName)}${g.id === week.tiebreakGameId ? ' <span class="tag">TB</span>' : ''}</td>
      <td>${fmtTime(g.kickoff)}</td><td class="${now >= lock ? '' : 'muted'}">${now >= lock ? 'locked' : 'locks ' + fmtTime(new Date(lock).toISOString())}</td>
      <td class="num">${revealed}</td><td class="num muted">${hidden}</td><td class="num muted">${none}</td>
      <td class="muted">${e?.state === 'post' ? esc(`${e.away.abbr} ${e.away.score}-${e.home.score} ${e.home.abbr}`) : esc(e?.line?.details || '')}</td></tr>`;
  }).join('');

  const nonExact = P.matches.filter(m => m.status !== 'matched');
  const firstImport = !S.roster.length;
  const opts = sel => `<option value="new" ${sel === 'new' ? 'selected' : ''}>New player</option>` +
    S.roster.map(p => `<option value="${esc(p.id)}" ${sel === p.id ? 'selected' : ''}>Same as ${esc(p.name)}</option>`).join('');
  const namesHtml = firstImport
    ? `<p>First import: <b>${nonExact.length} players</b> will be added to the roster. You are matched as <b>${esc(players.find(p => p.key === S.config.me)?.name || 'NOT FOUND, check config.me')}</b>.</p>`
    : nonExact.length
      ? `<table class="list">${nonExact.map(m => `<tr><td>${esc(m.name)}</td><td>${m.status === 'suggest' ? '<span class="tag warn">close match</span>' : '<span class="tag">not in roster</span>'}</td>
          <td><select data-key="${esc(m.key)}">${opts(P.decisions[m.key])}</select></td></tr>`).join('')}</table>`
      : `<p>All ${P.matches.length} names match the roster.</p>`;

  const ch = [];
  if (P.existing) {
    ch.push(`<li>${diff.revealed} newly revealed picks</li>`);
    if (diff.latePicks.length) ch.push(`<li>${diff.latePicks.length} picks entered since the last paste (were NO PICK)</li>`);
    diff.changed.forEach(c => ch.push(`<li class="warnline">Changed: ${esc(nameOf(c.pid))}, ${esc(gameLabel(week, c.gameId))}: ${esc(c.from)} → ${esc(c.to)}</li>`));
    diff.removed.forEach(c => ch.push(`<li class="warnline">Pick removed: ${esc(nameOf(c.pid))}, ${esc(gameLabel(week, c.gameId))}: ${esc(c.from)} → ${esc(c.to === NONE ? 'NO PICK' : c.to)}</li>`));
    diff.missingPlayers.forEach(pid => ch.push(`<li class="warnline">${esc(nameOf(pid))} is saved for this week but not in this paste (kept)</li>`));
    diff.newPlayers.forEach(pid => ch.push(`<li>New this week: ${esc(nameOf(pid))}</li>`));
  }

  const me = players.find(p => p.key === S.config.me)?.id;
  const rows = Object.keys(week.picks)
    .map(pid => ({ pid, label: nameOf(pid), isMe: pid === me, cells: [...week.games].sort((a, b) => a.order - b.order).map(g => ({ value: week.picks[pid][g.id] ?? NONE, state: '' })) }))
    .sort((a, b) => (b.isMe - a.isMe) || a.label.localeCompare(b.label));

  v.innerHTML = `
    <section class="confirm">
      <h2>Check before saving: week ${P.week}, ${S.season}</h2>
      <p>${P.grid.rows.length} players · ${week.games.length} of ${P.grid.matchups.length} games matched${P.existing ? ' · <b>replaces the saved week</b> (merged; see changes)' : ' · new week'}</p>
      ${errors.length ? `<div class="err"><b>Fix before saving:</b><ul>${errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
      ${warnings.length ? `<div class="warn"><ul>${warnings.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
      <h3>Games</h3>
      <div class="tablewrap"><table class="list"><thead><tr><th>#</th><th>Game</th><th>Kickoff</th><th>Pick lock</th><th class="num">Picks</th><th class="num">Hidden</th><th class="num">No pick</th><th></th></tr></thead><tbody>${gameRows}</tbody></table></div>
      <h3>Names</h3>${namesHtml}
      ${ch.length ? `<h3>Changes vs saved</h3><ul>${ch.join('')}</ul>` : ''}
      <h3>Picks as read</h3>
      ${picksTable(week, rows)}
      <div class="actions sticky">
        <button id="cancelBtn">Cancel</button>
        <button id="saveBtn" class="primary" ${errors.length ? 'disabled' : ''}>Save week ${P.week}</button>
      </div>
      <div id="saveMsg"></div>
    </section>
    ${needsToken() ? '<section class="ghsetup" id="ghSetup"></section>' : ''}`;
  if (needsToken()) renderGitHubSetup();
  v.querySelectorAll('select[data-key]').forEach(s => s.onchange = () => { P.decisions[s.dataset.key] = s.value; renderConfirm(v); });
  $('#cancelBtn').onclick = () => { S.pending = null; render(); };
  $('#saveBtn').onclick = () => saveImport();
}

function gameLabel(week, id) { const g = week.games.find(x => x.id === id); return g ? `${g.away}@${g.home}` : id; }

/** Hosted page in a browser that has no GitHub token yet: Save would only download the files. */
const needsToken = () => !isLocal() && !!repoInfo(S.config) && !getToken();

async function saveImport() {
  const P = S.pending;
  if (needsToken()) {
    $('#saveMsg').innerHTML = `<p class="err">This browser isn't set up to save yet. Paste your GitHub token under <b>Set up saving</b> below, then click Save again. Your import stays here.</p>`;
    $('#ghSetup')?.scrollIntoView({ behavior: 'smooth' });
    return;
  }
  const btn = $('#saveBtn'); btn.disabled = true; btn.textContent = 'Saving…';
  const { players, week } = previewWeek();
  // Fill in any missing pre-game lines from the game summary (kept there after kickoff).
  await Promise.all(week.games.filter(g => !week.lines[g.id]).map(async g => {
    try { const l = await fetchLine(g.id); if (l) week.lines[g.id] = l; } catch { /* leave missing */ }
  }));
  const weeks = { ...(S.index?.weeks || {}) };
  weeks[S.season] = [...new Set([...(weeks[S.season] || []), P.week])].sort((a, b) => a - b);
  const files = [
    { path: `data/${S.season}/week-${P.week}.json`, data: week },
    { path: 'data/players.json', data: { players } },
    { path: 'data/index.json', data: { weeks } },
  ];
  const revealed = Object.values(week.picks).reduce((n, p) => n + Object.values(p).filter(isTeam).length, 0);
  let res;
  try {
    res = await saveFiles(files, { config: S.config, message: `Week ${P.week} picks: ${Object.keys(week.picks).length} players, ${revealed} picks revealed` });
  } catch (e) {
    btn.disabled = false; btn.textContent = `Save week ${P.week}`;
    $('#saveMsg').innerHTML = `<p class="err">Not saved: ${esc(e.message)}. Nothing was lost; fix it and click Save again${e.status === 401 || e.status === 403 || e.status === 404 ? ' (check the GitHub token on the Import tab)' : ''}.</p>`;
    return;
  }
  S.roster = S.savedRoster = players; S.index = { weeks };
  S.pending = null;
  const summary = `week ${P.week}: ${week.games.length} games, ${Object.keys(week.picks).length} players`;
  $('#view').innerHTML = `<p class="${res.how === 'downloaded' ? 'warn' : 'ok'}">${
    res.how === 'downloaded' ? (isLocal()
      ? 'No local server to save to, so the files were downloaded instead. Put them in the data folder.'
      : 'GitHub saving is not set up on this device, so the files were downloaded instead. Set it up on the Import tab, or put the files in the data folder and push.')
    : res.how === 'github' ? `Saved ${summary} to GitHub. The site updates for everyone in a minute or two.`
    : `Saved ${summary}.`}</p>`;
  buildWeekSelect();
  if (res.how !== 'downloaded') setTimeout(() => { S.tab = 'picks'; loadWeek(P.week); }, 1200);
}

init();
