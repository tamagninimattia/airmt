// Dashboard: periodo di confronto, riepilogo, numeri chiave e scostamenti
import { test, eq, ok } from './runner.js';
import { EXCEL_2027 as X } from './excel-2027.js';
import { E } from './expected-2027.js';
import { year2027, PROVA_GIORNALE } from './fixture-2027.js';
import { computeActual, computeBudget } from '../js/engine/year.js';
import { comparisonPeriod, summaryColumns, keyFigures, sectionVariances, topVariances, wealthSeries } from '../js/dashboard-model.js';
import { round2 } from '../js/format.js';

const result = (data) => ({ actual: computeActual(data), budget: computeBudget(data) });
const closed = (...ms) => ms.map((month) => ({ month, closed: true }));

test('periodo di confronto: mesi chiusi, altrimenti il mese in corso', () => {
  eq(comparisonPeriod([]), { idx: [0], partial: true, label: 'gennaio (mese in corso, nessun mese chiuso)' });
  eq(comparisonPeriod(closed(1, 2, 3)), { idx: [0, 1, 2], partial: false, label: 'mesi chiusi: gennaio–marzo' });
  eq(comparisonPeriod(closed(1, 3)).label, 'mesi chiusi: gennaio, marzo', 'mesi non consecutivi');
  eq(comparisonPeriod(closed(2)).label, 'mesi chiusi: febbraio');
});

test('riepilogo: anno come nell\'Excel, periodo con il Giornale di prova', () => {
  const data = year2027({ entries: PROVA_GIORNALE });
  const s = summaryColumns(data, result(data), comparisonPeriod(data.months));
  eq([s.year.ricavi, s.year.costiEsclusi, s.year.lordo, s.year.spendibile, s.year.netto],
     [E.riepilogo.ricavi, E.riepilogo.costiEsclusi, E.riepilogo.lordo, E.riepilogo.spendibile, E.riepilogo.target], 'anno');
  eq([s.budget.ricavi, s.budget.costiEsclusi, s.budget.imprevisti],
     [E.budgetGennaio.ricavi, E.budgetGennaio.costiEsclusi, E.quotaImprevisti], 'budget di gennaio');
  eq([s.actual.ricavi, s.actual.costiEsclusi, s.actual.imprevisti, s.actual.netto], [10000, 9.99, 0, 9990.01], 'consuntivo di gennaio (Giornale di prova)');
});

test('riepilogo con mesi chiusi: nel periodo gli imprevisti di budget sono 0', () => {
  const data = year2027({ months: closed(1, 2) });
  const s = summaryColumns(data, result(data), comparisonPeriod(data.months));
  eq(s.budget.imprevisti, 0, 'imprevisti dei mesi chiusi');
  eq(s.year.quotaMensile, round2(E.riepilogo.spendibile / 10), 'spendibile sui 10 mesi aperti');
  eq(s.year.openMonths, 10);
});

test('numeri chiave al mese corrente', () => {
  const data = year2027({ entries: PROVA_GIORNALE });
  const k = keyFigures(data, result(data), comparisonPeriod(data.months));
  eq(k.month, 1);
  eq(k.patrimonio, X.actualJanuary.posizione, 'patrimonio (G365)');
  eq(k.patrimonioIniziale, E.patrimonioIniziale);
  eq(k.liquidita, E.liquiditaRealeGennaio, 'disponibilità reali (G361)');
  eq(k.liquiditaBudget, E.gruppiGennaio.disponibilita, 'disponibilità di budget (F361)');
  eq([k.risultato, k.risultatoBudget], [9990.01, E.risultatoBudgetGennaio], 'risultato di gennaio (G367, F367)');
  eq(k.imprevistiMese, E.quotaImprevisti);
});

test('scostamenti per sezione e voci più sfavorevoli', () => {
  const data = year2027({ entries: PROVA_GIORNALE });
  const r = result(data);
  const p = comparisonPeriod(data.months);
  const sections = new Map(sectionVariances(data, r, p).map((x) => [x.section, x]));
  const sz = E.sezioniGennaio;
  eq(sections.get('Ristorazione'), { section: 'Ristorazione', budget: sz.Ristorazione, actual: 0, variance: sz.Ristorazione });
  eq(sections.get('Abbonamenti'), { section: 'Abbonamenti', budget: sz.Abbonamenti, actual: 9.99,
                                    variance: round2(sz.Abbonamenti - 9.99) });
  ok(!sections.has('Imprevisti'), 'imprevisti esclusi');
  const top = topVariances(data, r, p);
  eq(top.map((x) => [x.account.name, x.variance]), [['Emolumenti mensili', round2(10000 - E.budgetGennaio.emolumenti)],
                                                    ['Interessi Attivi su c/c TR', -E.budgetGennaio.interessi]]);
});

test('serie del patrimonio: traguardo = patrimonio iniziale + target', () => {
  const data = year2027({ entries: PROVA_GIORNALE, months: closed(1) });
  const w = wealthSeries(data, result(data));
  eq(w.goal, round2(E.patrimonioIniziale + E.riepilogo.target), 'traguardo');
  eq(w.goal, w.budget[11], 'il budget di dicembre arriva al traguardo');
  const jan = X.actualJanuary.posizione;
  eq(w.actual.slice(0, 3), [jan, jan, null], 'consuntivo fino al mese corrente (febbraio)');
});
