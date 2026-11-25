import { test, eq, ok } from './harness.js';
import { repoInfo, isLocal, commitFiles, checkGitHub } from '../js/store.js';

const repo = { owner: 'me', repo: 'Picks', branch: 'main' };

/** Fake GitHub API: records calls; routes map "METHOD path" -> handler returning [status, body]. */
function fakeGitHub(routes) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    const path = url.replace('https://api.github.com', '');
    const key = `${opts.method || 'GET'} ${path}`;
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ key, body, auth: opts.headers?.Authorization });
    const h = routes[key];
    const [status, out] = h ? h(body, calls) : [404, { message: 'Not Found' }];
    return { ok: status < 300, status, json: async () => out };
  };
  return { fn, calls };
}

const gitRoutes = (patch = () => [200, {}]) => ({
  'GET /repos/me/Picks/git/ref/heads/main': () => [200, { object: { sha: 'c1' } }],
  'GET /repos/me/Picks/git/commits/c1': () => [200, { tree: { sha: 't1' } }],
  'POST /repos/me/Picks/git/trees': () => [201, { sha: 't2' }],
  'POST /repos/me/Picks/git/commits': () => [201, { sha: 'c2' }],
  'PATCH /repos/me/Picks/git/refs/heads/main': patch,
});

test('repo from config wins', () => eq(repoInfo({ github: { owner: 'a', repo: 'b' } }, { hostname: 'x.github.io', pathname: '/c/' }), { branch: 'main', owner: 'a', repo: 'b' }));
test('repo worked out from a github.io address', () => eq(repoInfo({}, { hostname: 'matthewsluder1-byte.github.io', pathname: '/Football-Picks/' }), { owner: 'matthewsluder1-byte', repo: 'Football-Picks', branch: 'main' }));
test('no repo on another host', () => eq(repoInfo({}, { hostname: 'example.com', pathname: '/x/' }), null));
test('localhost is local, github.io is not', () => { ok(isLocal('localhost')); ok(isLocal('127.0.0.1')); ok(!isLocal('me.github.io')); });

test('three files saved as ONE commit on top of main', async () => {
  const gh = fakeGitHub(gitRoutes());
  const files = [{ path: 'data/2026/week-12.json', data: { week: 12 } }, { path: 'data/players.json', data: { players: [] } }, { path: 'data/index.json', data: { weeks: {} } }];
  eq(await commitFiles(repo, 'tok', files, 'Week 12 picks', gh.fn), 'c2');
  const tree = gh.calls.find(c => c.key === 'POST /repos/me/Picks/git/trees').body;
  eq(tree.base_tree, 't1');
  eq(tree.tree.map(t => t.path), files.map(f => f.path));
  eq(tree.tree[0].content, '{\n  "week": 12\n}\n');
  eq(gh.calls.find(c => c.key === 'POST /repos/me/Picks/git/commits').body, { message: 'Week 12 picks', tree: 't2', parents: ['c1'] });
  eq(gh.calls.find(c => c.key.startsWith('PATCH')).body, { sha: 'c2' });
  ok(gh.calls.every(c => c.auth === 'Bearer tok'), 'token sent on every call');
});

test('if someone saved first, it rebuilds on the new tip and retries once', async () => {
  let n = 0;
  const gh = fakeGitHub(gitRoutes(() => (n++ === 0 ? [422, { message: 'Update is not a fast forward' }] : [200, {}])));
  await commitFiles(repo, 'tok', [{ path: 'data/index.json', data: {} }], 'm', gh.fn);
  eq(gh.calls.filter(c => c.key.startsWith('PATCH')).length, 2);
});

test('a bad token fails with the GitHub status', async () => {
  const gh = fakeGitHub({ 'GET /repos/me/Picks/git/ref/heads/main': () => [401, { message: 'Bad credentials' }] });
  let err = null;
  try { await commitFiles(repo, 'bad', [{ path: 'a.json', data: 1 }], 'm', gh.fn); } catch (e) { err = e; }
  eq([err?.status, err?.message], [401, 'GitHub 401: Bad credentials']);
});

test('token check: can push', async () => {
  const gh = fakeGitHub({ 'GET /user': () => [200, { login: 'matt' }], 'GET /repos/me/Picks': () => [200, { permissions: { push: true } }] });
  eq(await checkGitHub(repo, 'tok', gh.fn), { ok: true, login: 'matt' });
});
test('token check: read-only token is refused', async () => {
  const gh = fakeGitHub({ 'GET /user': () => [200, { login: 'matt' }], 'GET /repos/me/Picks': () => [200, { permissions: { push: false } }] });
  const c = await checkGitHub(repo, 'tok', gh.fn);
  ok(!c.ok && /Read and write/.test(c.error), c.error);
});
test('token check: no access to this repo', async () => {
  const gh = fakeGitHub({ 'GET /user': () => [200, { login: 'matt' }] });
  const c = await checkGitHub(repo, 'tok', gh.fn);
  ok(!c.ok && /no access to me\/Picks/.test(c.error), c.error);
});
