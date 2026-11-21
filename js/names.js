// Player roster matching. Roster entries (data/players.json):
//   { id, name, key, aliases: [key...], initials }
import { cleanName, nameKey } from './parser.js';

export function levenshtein(a, b) {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

const splitKey = key => { const [last = '', first = ''] = key.split(','); return { last: last.trim(), first: first.trim() }; };

/**
 * For each pasted row: matched (exact key or alias), suggest (close to one roster player), or new.
 * Close = edit distance <= max(2, 20% of length), or same last name and same first initial.
 */
export function matchNames(rows, roster) {
  const byKey = new Map();
  for (const p of roster) { byKey.set(p.key, p); for (const a of p.aliases || []) byKey.set(a, p); }
  return rows.map(r => {
    const hit = byKey.get(r.key);
    if (hit) return { key: r.key, name: r.name, status: 'matched', playerId: hit.id };
    const me = splitKey(r.key);
    let best = null, bestD = Infinity;
    for (const p of roster) {
      const d = levenshtein(r.key, p.key);
      const o = splitKey(p.key);
      const sameLastInitial = o.last === me.last && o.first[0] && o.first[0] === me.first[0];
      const score = sameLastInitial ? Math.min(d, 1) : d;
      if (score < bestD) { bestD = score; best = p; }
    }
    const close = best && bestD <= Math.max(2, Math.floor(r.key.length * 0.2));
    return close
      ? { key: r.key, name: r.name, status: 'suggest', suggestion: best.id }
      : { key: r.key, name: r.name, status: 'new' };
  });
}

/** Default decision per match: matched -> its player, suggest -> the suggestion, new -> 'new'. */
export function defaultDecisions(matches) {
  const d = {};
  for (const m of matches) d[m.key] = m.status === 'matched' ? m.playerId : m.status === 'suggest' ? m.suggestion : 'new';
  return d;
}

const slug = s => s.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'player';

/**
 * Apply decisions ({key: playerId | 'new'}) to the roster.
 * Returns a new roster and playerIdByKey for every pasted row.
 */
export function applyDecisions(roster, matches, decisions) {
  const players = roster.map(p => ({ ...p, aliases: [...(p.aliases || [])] }));
  const ids = new Set(players.map(p => p.id));
  const playerIdByKey = {};
  for (const m of matches) {
    const d = decisions[m.key];
    if (d === 'new' || !d) {
      let id = slug(m.key), n = 2;
      while (ids.has(id)) id = `${slug(m.key)}-${n++}`;
      ids.add(id);
      players.push({ id, name: cleanName(m.name), key: m.key, aliases: [] });
      playerIdByKey[m.key] = id;
    } else {
      const p = players.find(x => x.id === d);
      if (p && p.key !== m.key && !p.aliases.includes(m.key)) p.aliases.push(m.key);
      playerIdByKey[m.key] = d;
    }
  }
  assignInitials(players);
  players.sort((a, b) => a.key.localeCompare(b.key));
  return { players, playerIdByKey };
}

function nameParts(name) {
  const [last = '', first = ''] = cleanName(name).replace(/["“”][^"“”]*["“”]/g, '').split(',');
  const words = first.replace(/[^A-Za-z& ]/g, ' ').split(/\s+/).filter(w => w && w !== '&' && w.toLowerCase() !== 'and');
  return { last: last.replace(/[^A-Za-z]/g, ''), words };
}
const cap = s => s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : '';

function initialsWith(name, fk, lk) {
  const { last, words } = nameParts(name);
  const f = words.length > 1 ? words.map(w => w[0].toUpperCase()).join('') : cap(words[0]?.slice(0, fk) || '');
  return f + cap(last.slice(0, lk));
}

/** "Sluder, Matt" -> "MS"; collisions get more letters ("MSl" / "MSm", "JenG" / "JefG"). Mutates players. */
export function assignInitials(players) {
  const combos = [[1, 1], [1, 2], [1, 3], [2, 1], [3, 1], [4, 1], [2, 2], [3, 3], [9, 9]];
  const groups = new Map();
  for (const p of players) {
    const base = initialsWith(p.name, 1, 1);
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push(p);
  }
  for (const group of groups.values()) {
    let done = false;
    for (const [fk, lk] of combos) {
      const tags = group.map(p => initialsWith(p.name, fk, lk));
      if (new Set(tags).size === tags.length) { group.forEach((p, i) => (p.initials = tags[i])); done = true; break; }
    }
    if (!done) group.forEach((p, i) => (p.initials = initialsWith(p.name, 1, 1) + (i + 1)));
  }
  return players;
}

export { nameKey };
