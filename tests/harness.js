export const tests = [];
export const test = (name, fn) => tests.push({ name, fn });
export function eq(actual, expected, msg = '') {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n  expected ${e}\n  actual   ${a}`);
}
export function ok(cond, msg = 'expected true') { if (!cond) throw new Error(msg); }
