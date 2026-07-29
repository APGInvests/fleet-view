/**
 * fv_assert.js — tiny zero-dependency assertion helper for FleetView tests.
 * Groups results, counts pass/fail, prints a field-readable summary.
 */
'use strict';

function makeT() {
  const results = [];
  let group = 'general';

  const push = (ok, label, detail) => {
    results.push({ ok, group, label, detail: detail || '' });
    return ok;
  };

  const t = {
    group(name) {
      group = name;
      return t;
    },
    ok(cond, label, detail) {
      return push(!!cond, label, cond ? '' : detail || 'expected truthy');
    },
    eq(actual, expected, label) {
      const ok = Object.is(actual, expected) || String(actual) === String(expected);
      return push(ok, label, ok ? '' : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    },
    ne(actual, forbidden, label) {
      const bad = Object.is(actual, forbidden) || String(actual) === String(forbidden);
      return push(!bad, label, bad ? `must NOT equal ${JSON.stringify(forbidden)}` : '');
    },
    deep(actual, expected, label) {
      const a = JSON.stringify(actual), b = JSON.stringify(expected);
      return push(a === b, label, a === b ? '' : `expected ${b}, got ${a}`);
    },
    includes(haystack, needle, label) {
      const ok = String(haystack).includes(needle);
      return push(ok, label, ok ? '' : `"${needle}" not found in ${JSON.stringify(String(haystack).slice(0, 120))}`);
    },
    excludes(haystack, needle, label) {
      const bad = String(haystack).includes(needle);
      return push(!bad, label, bad ? `"${needle}" LEAKED into ${JSON.stringify(String(haystack).slice(0, 120))}` : '');
    },
    noThrow(fn, label) {
      try {
        fn();
        return push(true, label);
      } catch (e) {
        return push(false, label, 'threw: ' + e.message);
      }
    },
    throws(fn, label) {
      try {
        fn();
        return push(false, label, 'expected a throw, got none');
      } catch (e) {
        return push(true, label);
      }
    },
    get results() {
      return results;
    },
  };
  return t;
}

function report(t, title) {
  const rs = t.results;
  const fails = rs.filter((r) => !r.ok);
  const byGroup = {};
  rs.forEach((r) => {
    byGroup[r.group] = byGroup[r.group] || { pass: 0, fail: 0 };
    byGroup[r.group][r.ok ? 'pass' : 'fail']++;
  });

  const lines = [];
  lines.push('');
  lines.push('='.repeat(64));
  lines.push(title || 'FleetView test run');
  lines.push('='.repeat(64));
  Object.entries(byGroup).forEach(([g, c]) => {
    const mark = c.fail ? 'FAIL' : ' ok ';
    lines.push(`[${mark}] ${g.padEnd(34)} ${String(c.pass).padStart(3)} pass  ${String(c.fail).padStart(3)} fail`);
  });
  lines.push('-'.repeat(64));
  if (fails.length) {
    lines.push(`${fails.length} FAILURE(S):`);
    fails.forEach((f, i) => {
      lines.push(`  ${i + 1}. [${f.group}] ${f.label}`);
      if (f.detail) lines.push(`     -> ${f.detail}`);
    });
    lines.push('-'.repeat(64));
  }
  const total = rs.length;
  lines.push(
    fails.length
      ? `RESULT: FAIL  (${total - fails.length}/${total} passed)  ** DO NOT DEPLOY **`
      : `RESULT: PASS  (${total}/${total} passed)  safe to deploy`
  );
  lines.push('');
  process.stdout.write(lines.join('\n'));
  return fails.length === 0;
}

module.exports = { makeT, report };
