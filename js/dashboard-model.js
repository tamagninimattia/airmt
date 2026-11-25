// Dashboard: riepilogo annuale, numeri chiave e scostamenti. Funzioni pure.
// I confronti "da inizio anno" usano i soli mesi chiusi: il mese corrente è a metà e,
// messo contro il budget intero, sembrerebbe sempre in risparmio. Se nessun mese è chiuso
// si usa il mese corrente, segnalandolo come parziale.
import { round2, MONTHS } from './format.js';
import { budgetSummary, variance } from './engine/year.js';
import { currentMonth } from './budget-model.js';
import { sortByOrder, groupBy } from './settings-model.js';

const sumOver = (series, idx) => round2(idx.reduce((t, m) => t + (series?.[m] ?? 0), 0));

// Mesi del confronto (indici 0–11) e descrizione
export function comparisonPeriod(months) {
  const closed = months.filter((m) => m.closed).map((m) => m.month - 1).sort((a, b) => a - b);
  if (closed.length) {
    const label = closed.length === 1 ? MONTHS[closed[0]]
      : closed.every((m, i) => i === 0 || m === closed[i - 1] + 1)
        ? `${MONTHS[closed[0]]}–${MONTHS[closed.at(-1)]}`
        : closed.map((m) => MONTHS[m]).join(', ');
    return { idx: closed, partial: false, label: 'mesi chiusi: ' + label };
  }
  const cur = currentMonth(months) - 1;
  return { idx: [cur], partial: true, label: MONTHS[cur] + ' (mese in corso, nessun mese chiuso)' };
}

// Ricavi, costi e risultato su un insieme di mesi, da una mappa voce -> 12 valori
function totalsOver(accounts, econ, idx) {
  const of = (pred) => round2(accounts.filter((a) => a.type === 'economico' && pred(a))
    .reduce((t, a) => t + sumOver(econ.get(a.id), idx), 0));
  const ricavi = of((a) => a.kind === 'ricavo');
  const costiEsclusi = of((a) => a.kind === 'costo' && !a.is_contingency);
  const imprevisti = of((a) => a.kind === 'costo' && a.is_contingency);
  return { ricavi, costiEsclusi, lordo: round2(ricavi - costiEsclusi), imprevisti,
           costiConImprevisti: round2(costiEsclusi + imprevisti),
           netto: round2(ricavi - costiEsclusi - imprevisti) };
}

// Riepilogo annuale: budget dell'anno, e per il periodo budget contro consuntivo
export function summaryColumns(data, { actual, budget }, period) {
  return {
    year: budgetSummary(data, budget),
    budget: totalsOver(data.accounts, budget.econ, period.idx),
    actual: totalsOver(data.accounts, actual.econ, period.idx)
  };
}

// Numeri chiave al mese corrente (consuntivo: tutte le registrazioni fino a oggi)
export function keyFigures(data, { actual, budget }, period) {
  const m = currentMonth(data.months) - 1;
  const liquid = data.accounts.filter((a) => a.type === 'patrimoniale' && a.grp === 'disponibilita');
  const at = (closing) => round2(liquid.reduce((t, a) => t + (closing.get(a.id)?.[m] ?? 0), 0));
  const contingency = data.accounts.find((a) => a.is_contingency);
  const totals = summaryColumns(data, { actual, budget }, period);
  return {
    month: m + 1,
    patrimonio: actual.posizione[m],
    patrimonioIniziale: actual.initial,
    patrimonioBudget: budget.posizione[m],
    liquidita: at(actual.closing),
    liquiditaBudget: at(budget.closing),
    risultato: totals.actual.netto,
    risultatoBudget: totals.budget.netto,
    imprevistiMese: contingency ? budget.econ.get(contingency.id)?.[m] ?? 0 : 0
  };
}

// Scostamenti dei costi per sezione del Budget nel periodo (imprevisti esclusi: non hanno consuntivo)
export function sectionVariances(data, { actual, budget }, period) {
  const costs = sortByOrder(data.accounts.filter((a) => a.type === 'economico' && a.kind === 'costo' && !a.is_contingency));
  const out = [];
  for (const [section, items] of groupBy(costs, (a) => a.budget_section || 'Senza sezione')) {
    const b = round2(items.reduce((t, a) => t + sumOver(budget.econ.get(a.id), period.idx), 0));
    const ac = round2(items.reduce((t, a) => t + sumOver(actual.econ.get(a.id), period.idx), 0));
    if (b === 0 && ac === 0) continue;
    out.push({ section, budget: b, actual: ac, variance: variance('costo', b, ac) });
  }
  return out;
}

// Le voci più sfavorevoli nel periodo (ricavi sotto budget, costi sopra), imprevisti esclusi
export function topVariances(data, { actual, budget }, period, n = 5) {
  return data.accounts
    .filter((a) => a.type === 'economico' && !a.is_contingency)
    .map((a) => {
      const b = sumOver(budget.econ.get(a.id), period.idx);
      const ac = sumOver(actual.econ.get(a.id), period.idx);
      return { account: a, budget: b, actual: ac, variance: variance(a.kind, b, ac) };
    })
    .filter((x) => x.variance < 0)
    .sort((x, y) => x.variance - y.variance)
    .slice(0, n);
}

// Serie del grafico del patrimonio: budget su 12 mesi, consuntivo fino al mese corrente,
// e il punto d'arrivo del target (patrimonio iniziale + target)
export function wealthSeries(data, { actual, budget }) {
  const cur = currentMonth(data.months);
  return {
    budget: budget.posizione,
    actual: actual.posizione.map((v, m) => (m < cur ? v : null)),
    goal: round2(budget.initial + Number(data.target || 0)),
    initial: budget.initial
  };
}
