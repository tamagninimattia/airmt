// Dashboard: avvisi, numeri chiave, riepilogo annuale con il target, due grafici e gli scostamenti principali
import { sb, rows } from '../db.js';
import { h, say, busy, noYear } from '../ui.js';
import { loadYear, yearList, pickYear } from '../data.js';
import { computeActual, computeBudget, suggestAdjustments, variance } from '../engine/year.js';
import { currentMonth, alignmentByMonth } from '../budget-model.js';
import { comparisonPeriod, summaryColumns, keyFigures, sectionVariances, topVariances, wealthSeries } from '../dashboard-model.js';
import { lineChart, barChart } from '../charts.js';
import { MONTHS, fmtAmount, fmtEuro, parseAmount, isoDate } from '../format.js';

let S = null;

export async function render(root, { params }) {
  const years = await yearList();
  if (!years.length) return noYear(root, 'Dashboard');
  const year = pickYear(years, params[0], +isoDate().slice(0, 4));
  S = { root, years, data: await loadYear(year) };
  compute();
  draw();
}

function compute() {
  const { data } = S;
  S.result = { actual: computeActual(data), budget: computeBudget(data) };
  S.cur = currentMonth(data.months);
  S.period = comparisonPeriod(data.months);
  S.align = alignmentByMonth(suggestAdjustments(data), S.result.budget.adjustments, S.cur);
}

const signed = (v) => (v > 0 ? '+' : '') + fmtAmount(v);

function draw() {
  const { data, result, period } = S;
  const summary = summaryColumns(data, result, period);
  const k = keyFigures(data, result, period);
  const monthName = MONTHS[k.month - 1];

  S.root.replaceChildren(h('div', { class: 'dash' },
    h('div', { class: 'budget-head' },
      h('h1', null, 'Dashboard ' + data.year),
      S.years.length > 1 && h('nav', { class: 'tabs', 'aria-label': 'Anni' },
        S.years.map((y) => h('a', { href: '#/dashboard/' + y, 'aria-current': y === data.year ? 'page' : null }, y)))),
    alerts(summary.year),
    h('div', { class: 'tiles' },
      tile('Patrimonio a fine ' + monthName, k.patrimonio,
        `${signed(k.patrimonio - k.patrimonioIniziale)} € da inizio anno · budget ${fmtAmount(k.patrimonioBudget)} €`),
      tile('Risultato, ' + period.label.replace(/ \(.*\)$/, ''), k.risultato,
        `budget ${fmtAmount(k.risultatoBudget)} € · scostamento ${signed(variance('ricavo', k.risultatoBudget, k.risultato))} €`,
        variance('ricavo', k.risultatoBudget, k.risultato) < 0),
      tile('Liquidità a fine ' + monthName, k.liquidita, `budget ${fmtAmount(k.liquiditaBudget)} €`, k.liquidita < 0),
      tile('Imprevisti di ' + monthName, k.imprevistiMese,
        summary.year.targetRaggiungibile ? `quota dei ${summary.year.openMonths} mesi non chiusi` : 'negativi: target non raggiungibile',
        k.imprevistiMese < 0)),
    h('div', { class: 'dash-cols' },
      h('section', { class: 'card', 'aria-labelledby': 'riep-title' },
        h('h2', { id: 'riep-title' }, 'Riepilogo annuale'),
        summaryTable(summary),
        targetForm(summary.year)),
      h('section', { class: 'card' },
        lineChart({ title: 'Andamento del patrimonio', ...wealthChartData(),
                    caption: 'Saldi a fine mese. Il traguardo è patrimonio iniziale + target.' }),
        h('p', { class: 'hint' }, h('a', { href: '#/patrimonio/' + data.year }, 'Apri la situazione patrimoniale'), ' per i valori mese per mese.'))),
    h('div', { class: 'dash-cols' },
      h('section', { class: 'card' }, sectionChart()),
      h('section', { class: 'card', 'aria-labelledby': 'top-title' },
        h('h2', { id: 'top-title' }, 'Scostamenti principali'),
        h('p', { class: 'hint' }, 'Le voci più sfavorevoli, ' + period.label + '.'),
        topTable()))));
}

function wealthChartData() {
  const w = wealthSeries(S.data, S.result);
  return { budget: w.budget, actual: w.actual, goal: { value: w.goal, label: 'traguardo' } };
}

function sectionChart() {
  const items = sectionVariances(S.data, S.result, S.period).map((x) => ({ ...x, label: x.section }));
  if (!items.length) {
    return h('div', null, h('h2', null, 'Costi per sezione'), h('p', { class: 'muted' }, 'Nessun costo nel periodo.'));
  }
  return barChart({ title: 'Costi per sezione', items,
                    caption: S.period.label + '. A destra lo scostamento: ▲ dove il consuntivo supera il budget.' });
}

function topTable() {
  const items = topVariances(S.data, S.result, S.period);
  if (!items.length) return h('p', { class: 'muted' }, 'Nessuna voce sfavorevole nel periodo.');
  return h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
    h('thead', null, h('tr', null,
      h('th', { scope: 'col' }, 'Voce'),
      h('th', { scope: 'col', class: 'num' }, 'Budget'),
      h('th', { scope: 'col', class: 'num' }, 'Consuntivo'),
      h('th', { scope: 'col', class: 'num' }, 'Scost.'))),
    h('tbody', null, items.map((x) => h('tr', null,
      h('td', null, h('a', { href: '#/budget/' + S.data.year }, x.account.name),
        h('span', { class: 'muted' }, ' · ' + x.account.kind)),
      h('td', { class: 'num' }, fmtAmount(x.budget)),
      h('td', { class: 'num' }, fmtAmount(x.actual)),
      h('td', { class: 'num neg' }, '▲ ' + signed(x.variance)))))));
}

function tile(label, value, sub, bad = false) {
  return h('div', { class: 'tile' + (bad ? ' bad' : '') },
    h('span', { class: 'tile-label' }, label),
    h('strong', { class: 'tile-value' }, fmtEuro(value)),
    h('span', { class: 'tile-sub' }, sub));
}

function alerts(year) {
  const { result, period } = S;
  const items = [];
  const months = (s) => s.map((v, m) => (v !== 0 ? MONTHS[m] : null)).filter(Boolean).join(', ');
  if (!year.targetRaggiungibile) {
    items.push(h('li', { class: 'warn' }, `Target non raggiungibile: con il budget attuale mancano ${fmtAmount(-year.spendibile)} € e gli imprevisti sono negativi. `,
      h('a', { href: '#/budget/' + S.data.year }, 'Rivedi il budget')));
  }
  if (S.align.items.length) {
    items.push(h('li', { class: 'warn' }, `${S.align.items.length} Var da allineare (${months(S.align.counts)}). `,
      h('a', { href: '#/budget/' + S.data.year }, 'Allineale nel Budget')));
  }
  if (result.budget.unassigned.length) {
    items.push(h('li', { class: 'warn' }, 'Voci con budget ma senza canale standard: ',
      result.budget.unassigned.map((a) => a.name).join(', '), '. ', h('a', { href: '#/impostazioni/economici' }, 'Impostale')));
  }
  for (const [label, s] of [['consuntivo', result.actual.quadratura], ['budget', result.budget.quadratura]]) {
    if (s.some((v) => v !== 0)) {
      items.push(h('li', { class: 'warn' }, `Quadratura del ${label} diversa da 0 in ${months(s)}. `,
        h('a', { href: '#/patrimonio/' + S.data.year }, 'Controlla')));
    }
  }
  if (!items.length) items.push(h('li', { class: 'ok' }, 'Tutto in ordine: target raggiungibile, Var allineate, quadrature a 0.'));
  if (period.partial) items.push(h('li', { class: 'info' }, 'Nessun mese chiuso: i confronti usano ' + MONTHS[S.cur - 1] + ', che è ancora in corso.'));
  return h('ul', { class: 'checks', role: 'status' }, items);
}

function summaryTable({ year, budget, actual }) {
  const { period } = S;
  const money = (v) => (v == null ? '' : fmtAmount(v));
  const row = (label, kind, y, b, a, strong = false) => {
    const v = kind && b != null && a != null ? variance(kind, b, a) : null;
    return h('tr', { class: strong ? 'strong' : null },
      h('th', { scope: 'row' }, label),
      h('td', { class: 'num' }, money(y)),
      h('td', { class: 'num' }, money(b)),
      h('td', { class: 'num' }, money(a)),
      h('td', { class: 'num' + (v != null && v < 0 ? ' neg' : '') }, v == null ? '' : signed(v)));
  };
  return h('div', { class: 'table-wrap' }, h('table', { class: 'list summary' },
    h('caption', { class: 'hint' }, 'Periodo: ' + period.label + '.'),
    h('thead', null, h('tr', null,
      h('th', { scope: 'col' }, ''),
      h('th', { scope: 'col', class: 'num' }, 'Budget anno'),
      h('th', { scope: 'col', class: 'num', title: period.label }, 'Budget periodo'),
      h('th', { scope: 'col', class: 'num', title: period.label }, 'Consuntivo'),
      h('th', { scope: 'col', class: 'num' }, 'Scost.'))),
    h('tbody', null,
      row('Ricavi', 'ricavo', year.ricavi, budget.ricavi, actual.ricavi),
      row('Costi esclusi imprevisti', 'costo', year.costiEsclusi, budget.costiEsclusi, actual.costiEsclusi),
      row('Risultato lordo', 'ricavo', year.lordo, budget.lordo, actual.lordo, true),
      row('Target', null, year.target, null, null),
      row('Spendibile indiviso (imprevisti)', null, year.spendibile, budget.imprevisti, actual.imprevisti),
      row(`Quota mensile (${year.openMonths} mesi non chiusi)`, null, year.quotaMensile, null, null),
      row('Costi con imprevisti', 'costo', year.costiConImprevisti, budget.costiConImprevisti, actual.costiConImprevisti),
      row('Risultato netto', 'ricavo', year.netto, budget.netto, actual.netto, true))));
}

function targetForm(year) {
  const input = h('input', { id: 'target', inputmode: 'decimal', autocomplete: 'off', value: fmtAmount(year.target) });
  const save = h('button', { type: 'submit' }, 'Salva target');
  const form = h('form', { class: 'target-form' },
    h('label', { for: 'target' }, 'Target di risparmio annuo (€)'),
    h('div', { class: 'row' }, input, save),
    h('p', { class: 'hint' }, 'Cambiando il target gli imprevisti si ricalcolano sui mesi non chiusi.'));
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const v = parseAmount(input.value);
    if (Number.isNaN(v) || v < 0) {
      say('Target non valido: scrivi un importo positivo, come 10.000.', true);
      return;
    }
    busy(save, 'Salvataggio del target', async () => {
      await rows(sb.from('years').update({ target: v }).eq('year', S.data.year));
      S.data.target = v;
      compute();
      draw();
      say('Target salvato: imprevisti ricalcolati.');
    });
  });
  return form;
}
