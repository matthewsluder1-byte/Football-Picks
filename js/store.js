// Data file access. Phase 1: GET from the page's own folder, save via PUT to the
// local dev server (tools/serve.ps1). Phase 3 adds saving through the GitHub API.

export async function loadJSON(path, fallback = null) {
  try {
    const r = await fetch(`${path}?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return fallback;
    return await r.json();
  } catch {
    return fallback;
  }
}

/** Returns 'saved' or 'downloaded' (when no writable server is available). */
export async function saveJSON(path, data) {
  const body = JSON.stringify(data, null, 2) + '\n';
  try {
    const r = await fetch(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body });
    if (r.ok) return 'saved';
  } catch { /* fall through */ }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
  a.download = path.split('/').pop();
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return 'downloaded';
}
