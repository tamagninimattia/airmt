// Situazione patrimoniale: saldi di fine mese di tutti i conti patrimoniali, posizione e quadratura
import { h, noYear } from '../ui.js';
import { loadYear, yearList, pickYear } from '../data.js';
import { computeActual, computeBudget } from '../engine/year.js';
import { currentMonth } from '../budget-model.js';
import { positionRows, negativeBudgets } from '../accounts-model.js';
import { loadExpanded, saveExpanded, readGrid } from '../grid.js';
import { MONTHS, isoDate } from '../format.js';

let S = null;

export async function render(root, { params }) {
  const years = await yearList();
  if (!years.length) return noYear(root, 'Situazione patrimoniale');
  const year = pickYear(years, params[0], +isoDate().slice(0, 4));
  const data = await loadYear(year);
  const cur = currentMonth(data.months);
  S = { root, years, data, cur,
        result: { actual: computeActual(data), budget: computeBudget(data) },
        expanded: loadExpanded(year, cur) };
  draw();
}

function draw() {
  const { data, result } = S;
  const closed = new Set(data.months.filter((m) => m.closed).map((m) => m.month - 1));
  const href = (a) => '#/partitario/' + data.year + '/' + encodeURIComponent(a.id);
  const rows = positionRows(data, result, { hrefFor: href });
  const negatives = negativeBudgets(data, result.budget);
  const grid = readGrid({ rows, expanded: S.expanded, cur: S.cur, closed, label: 'Conto',
    onToggle: (m) => {
      if (S.expanded.has(m)) S.expanded.delete(m); else S.expanded.add(m);
      saveExpanded(data.year, S.expanded);
      draw();
    } });

  const months = (s) => s.map((v, m) => (v !== 0 ? MONTHS[m] : null)).filter(Boolean).join(', ');
  const check = (label, s) => (s.some((v) => v !== 0)
    ? h('li', { class: 'warn' }, `${label}: diversa da 0 in ${months(s)}. Controlla i conti economici senza canale e le Var.`)
    : h('li', { class: 'ok' }, `${label}: 0 in tutti i mesi.`));

  S.root.replaceChildren(h('div', { class: 'budget' },
    h('div', { class: 'budget-head' },
      h('h1', null, 'Situazione patrimoniale ' + data.year),
      S.years.length > 1 && h('nav', { class: 'tabs', 'aria-label': 'Anni' },
        S.years.map((y) => h('a', { href: '#/patrimonio/' + y, 'aria-current': y === data.year ? 'page' : null }, y)))),
    h('ul', { class: 'checks', role: 'status' },
      check('Quadratura del consuntivo', result.actual.quadratura),
      check('Quadratura del budget', result.budget.quadratura),
      // un conto che a budget va sotto zero anche in un solo mese va segnalato
      negatives.length
        ? negatives.map(({ account, months: ms }) => h('li', { class: 'warn' },
            h('a', { href: href(account) }, account.name), ': budget negativo a fine ' +
            (ms.length === 12 ? 'di tutti i mesi' : ms.map((m) => MONTHS[m]).join(', ')) + '.'))
        : h('li', { class: 'ok' }, 'Nessun conto con budget negativo.')),
    h('p', { class: 'hint' }, 'Saldi a fine mese: Budget concatenato con il budget, Progr. con il consuntivo. Clicca un conto per aprirne la scheda.'),
    h('div', { class: 'grid-wrap' }, grid)));
}
