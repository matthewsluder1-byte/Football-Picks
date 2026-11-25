// Data file access.
//   Local (localhost): GET from the page's folder, save via PUT to tools/serve.ps1.
//   Hosted (GitHub Pages): GET from the site, save as ONE commit to the repo through the GitHub
//     API, using a fine-grained token the user pastes in once per device (kept in localStorage).
//   Neither: save falls back to downloading the files.
// GitHub Pages takes a minute or so to publish a new commit, so files saved from this device are
// also kept locally for 15 minutes and served instead of an older copy from the site.

const API = 'https://api.github.com';
const TOKEN_KEY = 'pickem.githubToken';
const RECENT_KEY = 'pickem.recentSaves';
const RECENT_MS = 15 * 60e3;

export const isLocal = (host = location.hostname) => /^(localhost|127\.0\.0\.1|\[::1\])$/.test(host);

/** Repo to save to: config.github, else worked out from a *.github.io address. */
export function repoInfo(config, loc = location) {
  if (config?.github?.owner && config?.github?.repo) return { branch: 'main', ...config.github };
  const m = /^([^.]+)\.github\.io$/i.exec(loc.hostname);
  const repo = loc.pathname.split('/').filter(Boolean)[0];
  return m && repo ? { owner: m[1], repo, branch: 'main' } : null;
}

const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } },
};
export const getToken = () => ls.get(TOKEN_KEY);
export const setToken = t => ls.set(TOKEN_KEY, t ? t.trim() : null);

function recent() {
  try {
    const all = JSON.parse(ls.get(RECENT_KEY) || '{}');
    const now = Date.now();
    for (const k of Object.keys(all)) if (now - all[k].at > RECENT_MS) delete all[k];
    return all;
  } catch { return {}; }
}
function remember(files) {
  const all = recent();
  for (const f of files) all[f.path] = { at: Date.now(), data: f.data };
  ls.set(RECENT_KEY, JSON.stringify(all));
}

export async function loadJSON(path, fallback = null) {
  const mine = recent()[path];
  try {
    const r = await fetch(`${path}?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return mine ? mine.data : fallback;
    const data = await r.json();
    if (mine) {
      // Prefer this device's just-saved copy until the site catches up, then forget it.
      if (JSON.stringify(data) !== JSON.stringify(mine.data)) return mine.data;
      const all = recent(); delete all[path]; ls.set(RECENT_KEY, JSON.stringify(all));
    }
    return data;
  } catch {
    return mine ? mine.data : fallback;
  }
}

const body = data => JSON.stringify(data, null, 2) + '\n';

async function gh(fetchFn, token, method, url, payload) {
  const r = await fetchFn(`${API}${url}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(payload ? { 'Content-Type': 'application/json' } : {}),
    },
    body: payload ? JSON.stringify(payload) : undefined,
    cache: 'no-store',
  });
  if (!r.ok) {
    let msg = '';
    try { msg = (await r.json()).message || ''; } catch { /* no body */ }
    const err = new Error(`GitHub ${r.status}${msg ? `: ${msg}` : ''}`);
    err.status = r.status;
    throw err;
  }
  return r.status === 204 ? null : r.json();
}

/** Checks the token can push to the repo. Returns { ok, login?, error? }. */
export async function checkGitHub(repo, token, fetchFn = fetch) {
  try {
    const [user, info] = await Promise.all([
      gh(fetchFn, token, 'GET', '/user'),
      gh(fetchFn, token, 'GET', `/repos/${repo.owner}/${repo.repo}`),
    ]);
    if (!info.permissions?.push) return { ok: false, login: user.login, error: `This token can read ${repo.repo} but not write to it. Give it "Contents: Read and write".` };
    return { ok: true, login: user.login };
  } catch (e) {
    return { ok: false, error: e.status === 401 ? 'GitHub did not accept this token (wrong, expired or revoked).' : e.status === 404 ? `This token has no access to ${repo.owner}/${repo.repo}.` : e.message };
  }
}

/** Writes all files as one commit on the branch. Retries once if the branch moved meanwhile. */
export async function commitFiles(repo, token, files, message, fetchFn = fetch) {
  const base = `/repos/${repo.owner}/${repo.repo}`;
  for (let attempt = 0; ; attempt++) {
    const ref = await gh(fetchFn, token, 'GET', `${base}/git/ref/heads/${repo.branch}`);
    const parent = await gh(fetchFn, token, 'GET', `${base}/git/commits/${ref.object.sha}`);
    const tree = await gh(fetchFn, token, 'POST', `${base}/git/trees`, {
      base_tree: parent.tree.sha,
      tree: files.map(f => ({ path: f.path, mode: '100644', type: 'blob', content: body(f.data) })),
    });
    const commit = await gh(fetchFn, token, 'POST', `${base}/git/commits`, { message, tree: tree.sha, parents: [ref.object.sha] });
    try {
      await gh(fetchFn, token, 'PATCH', `${base}/git/refs/heads/${repo.branch}`, { sha: commit.sha });
      return commit.sha;
    } catch (e) {
      if (e.status !== 422 || attempt >= 1) throw e;   // 422 = not a fast-forward: someone else saved first
    }
  }
}

function download(path, data) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([body(data)], { type: 'application/json' }));
  a.download = path.split('/').pop();
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/**
 * Saves [{ path, data }]. Returns { how: 'local' | 'github' | 'downloaded', sha? }.
 * Throws if GitHub saving is set up but fails, so the caller can keep the import and retry.
 */
export async function saveFiles(files, { message = 'Update picks', config = null } = {}) {
  if (isLocal()) {
    try {
      for (const f of files) {
        const r = await fetch(f.path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: body(f.data) });
        if (!r.ok) throw new Error(`local server HTTP ${r.status}`);
      }
      return { how: 'local' };
    } catch { /* no writable server: fall through to download */ }
  } else {
    const repo = repoInfo(config), token = getToken();
    if (repo && token) {
      const sha = await commitFiles(repo, token, files, message);
      remember(files);
      return { how: 'github', sha };
    }
  }
  files.forEach(f => download(f.path, f.data));
  return { how: 'downloaded' };
}
