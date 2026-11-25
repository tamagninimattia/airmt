// Griglia a 12 mesi condivisa da Budget, schede conto e situazione patrimoniale:
// ogni mese mostra il Budget e, se esploso, anche Progr. e Scost.
import { h } from './ui.js';
import { variance } from './engine/year.js';
import { MONTHS, fmtAmount } from './format.js';
import { rowTotal } from './budget-model.js';

const SHORT = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

// Mesi esplosi (indici 0–11): il corrente di base, poi quelli scelti, ricordati per anno
export function loadExpanded(year, cur) {
  try {
    const saved = JSON.parse(localStorage.getItem('budget.expanded.' + year));
    if (Array.isArray(saved)) return new Set(saved);
  } catch { /* memoria del browser non disponibile: si parte dal mese corrente */ }
  return new Set([cur - 1]);
}

export function saveExpanded(year, expanded) {
  try { localStorage.setItem('budget.expanded.' + year, JSON.stringify([...expanded])); } catch { /* ignorato */ }
}

export function columnCount(expanded) {
  return 1 + [...Array(12).keys()].reduce((n, m) => n + (expanded.has(m) ? 3 : 1), 0) + 3;
}

// Le due righe di intestazione: mesi (pulsanti che esplodono) e Budget / Progr. / Scost.
export function monthHeader({ expanded, cur, closed, onToggle, label = 'Voce' }) {
  const head1 = [h('th', { class: 'label corner', rowspan: 2, scope: 'col' }, label)];
  const head2 = [];
  for (let m = 0; m < 12; m++) {
    const open = expanded.has(m);
    head1.push(h('th', { colspan: open ? 3 : 1, scope: 'colgroup',
                         class: 'month mstart' + (closed.has(m) ? ' closed' : '') + (m === cur - 1 ? ' current' : '') },
      h('button', { type: 'button', 'aria-expanded': String(open), onclick: () => onToggle(m),
                    title: open ? 'Mostra solo il budget' : 'Mostra anche Progr. e Scost.' },
        (open ? '▾ ' : '▸ ') + (open ? MONTHS[m] : SHORT[m])),
      closed.has(m) && h('span', { class: 'tag' }, 'chiuso')));
    head2.push(h('th', { class: 'sub mstart' }, 'Budget'));
    if (open) head2.push(h('th', { class: 'sub' }, 'Progr.'), h('th', { class: 'sub' }, 'Scost.'));
  }
  head1.push(h('th', { colspan: 3, scope: 'colgroup', class: 'month mstart total-col' }, 'Totale anno'));
  head2.push(h('th', { class: 'sub mstart' }, 'Budget'), h('th', { class: 'sub' }, 'Progr.'), h('th', { class: 'sub' }, 'Scost.'));
  return h('thead', null, h('tr', null, head1), h('tr', null, head2));
}

// Testo e colori di una cella numerica. Nelle righe di dettaglio lo zero resta vuoto.
// Rosso: scostamento sfavorevole, controllo diverso da 0, saldo negativo (righe con negRed).
// Verde: scostamento favorevole (ricavi sopra il budget, costi sotto), controllo a 0.
// Se la cella ha uno span .v (accanto ad altri elementi, come il "+" del Budget) il numero va lì.
export function setNum(td, v, row, { scost = false } = {}) {
  const quiet = row.type === 'line' || row.type === 'var';
  const text = v == null || (v === 0 && quiet) ? '' : fmtAmount(v);
  const target = td.querySelector(':scope > .v') ?? td;
  if (target.textContent !== text) target.textContent = text;
  // toggle con un secondo argomento non booleano inverte la classe: va sempre forzato a true/false
  td.classList.toggle('bad', Boolean(v != null && ((scost && v < 0) || (row.type === 'check' && v !== 0) || (!scost && row.negRed && v < 0))));
  td.classList.toggle('good', Boolean(v != null && ((scost && v > 0) || (row.type === 'check' && v === 0))));
}

// Scostamento di una cella, null se la riga non lo prevede
export const cellVariance = (row, b, a) => (a == null || b == null || !row.kind ? null : variance(row.kind, b, a));

// Budget raggiunto: il consuntivo coincide con un budget diverso da zero (scostamento 0).
// Nel Budget la cella da digitare passa da gialla a verde.
export const budgetReached = (row, b, a) => Boolean(b && cellVariance(row, b, a) === 0);

// Griglia in sola lettura. rows: { key, type, label, code?, href?, kind?, budget, actual?, total, negRed?, badge? }
// type: 'head' | 'sub' | 'line' | 'total' | 'check'
export function readGrid({ rows, expanded, cur, closed, onToggle, label }) {
  const ncols = columnCount(expanded);
  const body = rows.map((row) => {
    if (row.type === 'head' || row.type === 'sub') {
      return h('tr', { class: row.type }, h('th', { colspan: ncols, scope: 'colgroup' }, h('span', null, row.label)));
    }
    const cells = [h('th', { scope: 'row', class: 'label' },
      row.href ? h('a', { href: row.href, class: 'name' }, row.label) : h('span', { class: 'name' }, row.label),
      row.code && h('code', null, row.code),
      row.badge && h('span', { class: 'badge' }, row.badge))];
    for (let m = 0; m < 12; m++) {
      const b = row.budget?.[m] ?? null;
      const td = h('td', { class: 'num mstart' });
      setNum(td, b, row);
      cells.push(td);
      if (expanded.has(m)) {
        const a = row.actual?.[m] ?? null;
        const ta = h('td', { class: 'num a' + (m + 1 > cur ? ' future' : '') });
        const ts = h('td', { class: 'num s' });
        setNum(ta, a, row);
        setNum(ts, cellVariance(row, b, a), row, { scost: true });
        cells.push(ta, ts);
      }
    }
    const tb = rowTotal(row, row.budget);
    const ta = rowTotal(row, row.actual);
    const tds = [h('td', { class: 'num mstart tot' }), h('td', { class: 'num a tot' }), h('td', { class: 'num s tot' })];
    setNum(tds[0], tb, row);
    setNum(tds[1], ta, row);
    setNum(tds[2], cellVariance(row, tb, ta), row, { scost: true });
    cells.push(...tds);
    return h('tr', { class: row.type + (row.inactive ? ' inactive' : '') }, cells);
  });
  return h('table', { class: 'grid' }, monthHeader({ expanded, cur, closed, onToggle, label }), h('tbody', null, body));
}
