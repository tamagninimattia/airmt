// Mini runner per i test nel browser: test(nome, fn), eq(ottenuto, atteso, messaggio).
// Il titolo della pagina diventa "OK n/n" oppure "FALLITI k/n", comodo anche da headless.

const results = [];

export function test(name, fn) {
  results.push({ name, fn });
}

export function eq(actual, expected, message = '') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\n  atteso:   ${e}\n  ottenuto: ${a}`);
}

export function ok(value, message = '') {
  if (!value) throw new Error(message || 'condizione falsa');
}

export async function run(out) {
  let failed = 0;
  for (const { name, fn } of results) {
    const li = document.createElement('li');
    try {
      await fn();
      li.textContent = '✓ ' + name;
      li.className = 'pass';
    } catch (e) {
      failed++;
      li.textContent = '✗ ' + name + ': ' + e.message;
      li.className = 'fail';
    }
    out.append(li);
  }
  document.title = failed ? `FALLITI ${failed}/${results.length}` : `OK ${results.length}/${results.length}`;
  return failed;
}
