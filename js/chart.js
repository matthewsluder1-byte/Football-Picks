// Win-% over time line chart (inline SVG) with a legend and a hover crosshair.
// Moments are spaced evenly (Thursday to Sunday would otherwise be one long flat line);
// a faint divider and label mark each new day. Colors: --s1..--s5 in style.css, by series slot.

const W = 640, H = 220, L = 34, R = 10, T = 10, B = 22;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const day = ms => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(new Date(ms));
const when = ms => new Date(ms).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
const pct = x => (x >= 0.995 && x < 1 ? '>99%' : x > 0 && x < 0.005 ? '<1%' : `${Math.round(x * 100)}%`);

/**
 * @param points [{ at, players: { pid: win }, now? }]
 * @param series [{ pid, label, slot (1-5), me? }]
 */
export function lineChart(points, series) {
  if (points.length < 2) return '<p class="muted small">The chart starts once the first game kicks off.</p>';
  const n = points.length;
  // Scale to the data: with 50 players nobody gets near 100%, so a fixed 0-100% would flatten every line.
  const peak = Math.max(...points.flatMap(p => series.map(s => p.players[s.pid] ?? 0)));
  const top = [0.1, 0.2, 0.4, 0.6, 0.8, 1].find(v => v >= peak * 1.08) ?? 1;
  const x = i => L + ((W - L - R) * i) / (n - 1);
  const y = v => T + (H - T - B) * (1 - v / top);
  const grid = [0, 0.25, 0.5, 0.75, 1].map(f => f * top).map(v =>
    `<line class="gl" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 4}" y="${y(v) + 3}" text-anchor="end">${Math.round(v * 100)}%</text>`).join('');
  let days = '';
  points.forEach((p, i) => {
    const d = day(p.at);
    if (i === 0 || d !== day(points[i - 1].at)) {
      if (i) days += `<line class="dl" x1="${x(i) - 0.5}" x2="${x(i) - 0.5}" y1="${T}" y2="${H - B}"/>`;
      days += `<text class="ax" x="${x(i) + 2}" y="${H - 6}">${d}</text>`;
    }
  });
  const lines = series.map(s => {
    const pts = points.map((p, i) => `${x(i).toFixed(1)},${y(p.players[s.pid] ?? 0).toFixed(1)}`).join(' ');
    const last = points[n - 1].players[s.pid] ?? 0;
    return `<polyline class="ln s${s.slot}${s.me ? ' me' : ''}" points="${pts}"/>
      <circle class="dot s${s.slot}" cx="${x(n - 1)}" cy="${y(last)}" r="4"/>`;
  }).join('');
  const legend = series.map(s => `<span class="lg"><i class="sw s${s.slot}"></i>${esc(s.label)} <b>${pct(points[n - 1].players[s.pid] ?? 0)}</b></span>`).join('');
  const data = esc(JSON.stringify({ at: points.map(p => p.at), now: points.map(p => !!p.now), s: series.map(s => ({ l: s.label, k: s.slot, v: points.map(p => p.players[s.pid] ?? 0) })) }));
  return `<div class="chart" data-chart="${data}">
    <div class="legend small">${legend}</div>
    <div class="plot">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Chance to win the week over time">${grid}${days}${lines}
        <line class="xh" x1="0" x2="0" y1="${T}" y2="${H - B}" visibility="hidden"/></svg>
      <div class="tip" hidden></div>
    </div>
  </div>`;
}

/** Hover / touch crosshair for every chart inside root. */
export function attachChartHover(root) {
  root.querySelectorAll('.chart[data-chart]').forEach(c => {
    const d = JSON.parse(c.dataset.chart);
    const svg = c.querySelector('svg'), xh = c.querySelector('.xh'), tip = c.querySelector('.tip'), plot = c.querySelector('.plot');
    const n = d.at.length;
    const move = ev => {
      const r = svg.getBoundingClientRect();
      const vx = ((ev.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(n - 1, Math.round(((vx - L) / (W - L - R)) * (n - 1))));
      const px = L + ((W - L - R) * i) / (n - 1);
      xh.setAttribute('x1', px); xh.setAttribute('x2', px); xh.setAttribute('visibility', 'visible');
      const rows = d.s.map(s => ({ ...s, x: s.v[i] })).sort((a, b) => b.x - a.x)
        .map(s => `<div><i class="sw s${s.k}"></i>${esc(s.l)} <b>${pct(s.x)}</b></div>`).join('');
      tip.innerHTML = `<div class="muted">${d.now[i] ? 'Now' : when(d.at[i])}</div>${rows}`;
      tip.hidden = false;
      const left = (px / W) * r.width;
      tip.style.left = `${Math.min(Math.max(0, left + 12), r.width - tip.offsetWidth)}px`;
    };
    const leave = () => { tip.hidden = true; xh.setAttribute('visibility', 'hidden'); };
    plot.addEventListener('pointermove', move);
    plot.addEventListener('pointerdown', move);
    plot.addEventListener('pointerleave', leave);
  });
}
