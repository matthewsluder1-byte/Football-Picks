// Minimal in-browser test runner. Open tests/index.html through the local server.
import { tests } from './harness.js';
import './parser.test.js';
import './odds.test.js';
import './store.test.js';

const out = document.getElementById('out');
let pass = 0, fail = 0;
for (const t of tests) {
  try {
    await t.fn();
    pass++;
    out.insertAdjacentHTML('beforeend', `<div class="pass">✓ ${t.name}</div>`);
  } catch (e) {
    fail++;
    const div = document.createElement('div');
    div.innerHTML = `<div class="fail">✗ ${t.name}</div><pre></pre>`;
    div.querySelector('pre').textContent = e.message;
    out.appendChild(div);
  }
}
const s = document.getElementById('summary');
s.textContent = `${pass} passed, ${fail} failed`;
s.className = fail ? 'fail' : 'pass';
window.__testResult = { pass, fail };
