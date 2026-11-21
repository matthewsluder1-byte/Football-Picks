// ESPN public scoreboard feed (no key). Verified 2026-11-14: responses carry
// "Access-Control-Allow-Origin: *", so the browser can call it from any origin.
// If ESPN changes these field names, normEvent() is the only place to fix.
const BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';

/** No args = ESPN's current week. Season types: 2 regular season, 3 postseason. */
export async function fetchScoreboard(season, week, seasontype = 2) {
  const u = new URL(`${BASE}/scoreboard`);
  if (week) {
    u.searchParams.set('dates', season);
    u.searchParams.set('seasontype', seasontype);
    u.searchParams.set('week', week);
  }
  const r = await fetch(u, { cache: 'no-store' });
  if (!r.ok) throw new Error(`score feed HTTP ${r.status}`);
  return normScoreboard(await r.json());
}

export function normScoreboard(j) {
  return {
    season: j.season?.year ?? j.leagues?.[0]?.season?.year,
    seasonType: j.season?.type,
    week: j.week?.number,
    events: (j.events || []).map(normEvent),
    fetchedAt: Date.now(),
  };
}

/** Parse "DET -3" / "EVEN" / "PK" into { favorite, spread (points, >= 0), overUnder, details }. */
export function parseLine(details, overUnder, provider) {
  if (!details && overUnder == null) return null;
  const m = /^([A-Z]{2,4})\s*(-?\d+(?:\.\d+)?)$/.exec(String(details || '').trim());
  return {
    favorite: m ? m[1] : null,
    spread: m ? Math.abs(parseFloat(m[2])) : 0,
    overUnder: overUnder == null || overUnder === '' ? null : Number(overUnder),
    details: details || '',
    provider: provider || '',
  };
}

export function normEvent(e) {
  const c = e.competitions?.[0] || {};
  const st = c.status || e.status || {};
  const team = side => {
    const t = (c.competitors || []).find(x => x.homeAway === side) || {};
    return {
      id: t.team?.id, abbr: t.team?.abbreviation, name: t.team?.name, displayName: t.team?.displayName,
      logo: t.team?.logo, score: t.score == null || t.score === '' ? null : Number(t.score),
      record: t.records?.[0]?.summary || '', winner: !!t.winner,
      quarters: (t.linescores || []).map(l => Number(l.value) || 0),   // points per period (OT = 5th)
    };
  };
  const away = team('away'), home = team('home');
  const sit = c.situation || {};
  const possId = sit.possession;
  const o = (c.odds || [])[0];
  return {
    id: e.id, date: e.date, name: e.shortName,
    neutral: !!c.neutralSite,
    state: st.type?.state,            // 'pre' | 'in' | 'post'
    completed: !!st.type?.completed,
    detail: st.type?.shortDetail || '',
    period: st.period || 0,
    clock: st.clock ?? null,          // seconds left in the quarter
    displayClock: st.displayClock || '',
    away, home,
    possession: possId ? (possId === away.id ? away.abbr : possId === home.id ? home.abbr : null) : null,
    downDistance: sit.shortDownDistanceText || sit.downDistanceText || '',
    yardLine: sit.yardLine ?? null,
    redZone: !!sit.isRedZone,
    lastPlay: sit.lastPlay?.text || '',
    line: o ? parseLine(o.details, o.overUnder, o.provider?.name) : null,
    broadcast: c.broadcasts?.[0]?.names?.[0] || '',
  };
}

/** Pre-game line from the game summary; ESPN keeps it there after kickoff and after the final. */
export async function fetchLine(eventId) {
  const r = await fetch(`${BASE}/summary?event=${encodeURIComponent(eventId)}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`summary HTTP ${r.status}`);
  const j = await r.json();
  const p = (j.pickcenter || [])[0];
  return p ? parseLine(p.details, p.overUnder, p.provider?.name) : null;
}
