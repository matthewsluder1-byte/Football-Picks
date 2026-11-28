# NFL Pick'em Tracker

A static page (HTML + JavaScript, no backend) that tracks a straight-up pick'em pool from
footballfrenzyonline.com: picks pasted in, live scores from ESPN, and (Phase 2) live odds of
winning the week.

Status: **Phase 3** (picks, scores, odds, hosted on GitHub Pages with saving from any device). Phase 4 adds my own picks.

Live site: https://matthewsluder1-byte.github.io/Football-Picks/

## Setup (this computer)

Nothing to install. Windows PowerShell runs the local server.

```
powershell -ExecutionPolicy Bypass -File tools\serve.ps1
```

Then open http://localhost:8787. Tests: http://localhost:8787/tests/ (all should pass).

The local server serves the folder and lets the Import screen save `data/*.json`. It accepts
writes only to `.json` files under `data/`.

## Weekly routine

The site hides each game's picks until it locks, so you paste twice a week:

1. **Thursday, after kickoff:** copy the whole grid (from "Player Name" to the last row) and paste it on the
   **Import** tab. Check the confirmation screen and click **Save**.
2. **Sunday, after picks lock:** paste again. The new paste is merged in: newly revealed picks fill in,
   anything already known stays, and corrections are listed before you save.

Re-pasting is always safe. Paste a corrected grid any time and the confirmation screen lists exactly
what changed.

## Data files

| File | What |
|---|---|
| `data/config.json` | season, which player is you (`me`, a name key like `sluder,matt`), `useInitials` |
| `data/players.json` | roster: id, name, matching key, aliases, initials |
| `data/index.json` | which weeks are saved |
| `data/<season>/week-<n>.json` | games, every pick, Monday tiebreaker guesses, pre-game lines, paste log |

Pick values: team code (`WSH`), `HIDDEN` (not revealed yet), `NONE` (no pick).

## Assumptions (pool rules as I understood them)

- **Scoring:** 1 point per correct straight-up pick. A missing pick is wrong.
- **NFL tie:** nobody gets the point. A postponed or canceled game is treated the same way.
- **Pick locks:** Thursday and Saturday games lock at kickoff. Every Sunday and Monday game locks at
  **noon ET Sunday**, or at kickoff if that is earlier (London games). *Needs your confirmation; see open questions.*
- **"NO PICK" before a game locks** means the player hasn't picked yet. It counts as possibly right until the lock.
- **Weekly tiebreaker:** closest to the combined score of the Monday night game, either direction. If it is
  still tied, the winners split. With two Monday games the second-listed one counts; with one, that
  one; with none, the last game in the grid.
- **Season prize:** most correct picks for the season. Tiebreaker: the lowest average miss on the Monday
  night total across the season.
- **Names:** matched on last name and first name, ignoring case, spacing, and nicknames in quotes. A new
  name close to a known player (typo, "Dan" vs "Daniel") is flagged for you to decide. It is never merged
  silently.
- **Week detection:** the grid's matchups are matched to the ESPN schedule by team nickname. The page tries
  the selected week first, then the weeks next to it.

## Score feed (and what breaks if it changes)

Source: ESPN's public JSON, no key, free. Checked 2026-11-14: it allows browser requests from any site
(`Access-Control-Allow-Origin: *`).

- Scoreboard: `site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=2026&seasontype=2&week=10`
  gives the score, quarter, clock, status, possession and down & distance (during live games), and the
  DraftKings spread and over/under (before kickoff).
- Summary: `.../summary?event=<id>` keeps the pre-game line (`pickcenter`) after kickoff and after the final.
  It is used to fill in missing lines when you save.

This is an **undocumented** feed. ESPN can change or block it without notice. If that happens:

- **Field names change:** scores and lines show blank or wrong. All parsing is in `normEvent()` in
  `js/espn.js`; fix the field paths there. `tests/fixtures/scoreboard-2026-w10.json` is a saved
  example of the old shape.
- **Cross-site requests blocked:** the status line shows "Score feed error" and the Live tab is empty. A
  free fix would need a small proxy (for example a free Cloudflare Worker) or another feed.
- **URL changes or removed:** same as above.
- **Possession missing:** the in-game model (Phase 2) still works, just without the possession bonus.

Your saved picks never depend on the feed. They are your own files.

## Pool site grid format (what breaks if it changes)

`js/parser.js` expects the clipboard copy seen in week 10, 2026:

- Header: one team nickname per line, away then home for each game.
- Rows: name, then one cell per game, then Total, separated by tabs.
- Cells: a nickname, `HIDDEN`, or `NO PICK`.

Once games have started (week 12, 2026), the copy adds a Rank column before each name, a Correct column
after it, and a score next to each team in the header (`Packers 13`, `Saints -`). Both layouts work.

A two-row header (as it looks on screen) also works. If the site changes the layout, the Import screen
shows an error instead of saving bad data. Add the new paste as a fixture in `tests/fixtures/` and adjust
`parseGrid()`.

## Files

```
index.html, css/style.css
js/app.js       UI: Live, Picks, Season, Import + confirmation, player card
js/parser.js    grid parsing, schedule matching, tiebreaker game
js/names.js     roster matching, aliases, initials
js/merge.js     week file format + re-paste merge rules
js/scoring.js   correct / max possible, pick lock times
js/espn.js      score feed client
js/store.js     load/save data files (local server, or one GitHub commit when hosted)
js/odds.js      game win chances + week win odds (Monte Carlo)
js/replay.js    rewinds a finished week to any moment (replay mode)
js/demo.js      demo picks for week 10 replay (never saved)
js/season.js    week winners and season standings
js/history.js   win % over time (odds recomputed at each lock and quarter end)
js/chart.js     the line chart (inline SVG) and its hover readout
tools/serve.ps1 local server
tests/          browser test page + real fixtures
```

## Trackers

- **Season tab:** total right for every saved week, weeks won, and each week's count (green = won it,
  grey = still being played). Tap any column to sort. Week winner: most right, then closest to the
  Monday-night total (either side), else split. Season tiebreaker: lowest average Monday miss. The
  pasted grid shows guesses as `XX`, so for now tied weeks split and the season tiebreaker is blank.
  Totals only cover weeks saved here: to add an older week, choose it in the week menu, then paste
  that week's grid on Import.
- **Player card:** tap any name. Right so far, max possible, chance to win the week, projected total,
  whether they're out, the games they need (their chance if that game goes wrong → right, with
  "must win" when losing it ends their week), their line on the chart next to yours, and their season line.
- **Win % over time (Live tab):** you plus the four players most likely to win. Worked out after the
  fact by replaying the week up to now (each pick lock and each quarter end, using the feed's quarter
  scores), so it fills in even if no one had the page open. Points are evenly spaced, with a divider
  for each day. It uses the picks saved now, so after the Sunday re-paste the whole line is redrawn
  with everyone's real picks.

## Odds (Phase 2)

- **Each game:** chance to win from the pre-game spread, then during the game from the score, time
  left and possession. Shown as "Win: BUF 89%" on each game card.
- **The week:** 10,000 simulated finishes of the games still to play. Ties for first split the win.
  Picks still hidden (or NO PICK before the lock) are guessed from how the rest of the pool picked
  that game, so re-paste after the Sunday lock for exact odds. "out" means that player's max is
  below someone's current total.
- **Root for:** for each game left, your chance if each team wins. Biggest swings first.

## Replay mode (testing on a non-game day)

Open http://localhost:8787/?replay=10 to play back a finished week. Use the buttons or "Jump to…"
to move the clock (before the lock, during the Sunday games, Monday night, all final). Real
final scores come in quarter by quarter. With no saved week 10, it uses demo picks: the real
Thursday paste, with hidden picks filled in at random. Import is turned off in replay, so nothing
gets saved.

## Hosted site and saving (Phase 3)

The site is served by GitHub Pages from the `main` branch of
`matthewsluder1-byte/Football-Picks` (set in `data/config.json` → `github`). Every push updates it
in a minute or two.

**Saving from the hosted page:** each device needs a GitHub token once. The Import tab walks
through it: a *fine-grained* token, only this repo, **Contents: Read and write**, nothing else.
The token is kept in that browser only (localStorage) and is never put in the repo. Each import
saves the week, roster and index as **one commit**. If two devices save at once, the second one
rebuilds on top of the first and retries.

Pages takes a minute or two to publish a save. Until then, the device that saved shows its own
copy (kept for 15 minutes), so the page doesn't jump back to the old data.

If the token expires or is revoked, saving shows an error and keeps the import on screen. Make
a new token, remove the old one from the Import tab, paste the new one, and click Save again.

**Local server** (`tools\serve.ps1`) still saves straight to the `data` folder. Commit and push
those files to put them on the site.
