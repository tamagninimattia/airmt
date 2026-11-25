// Regole della griglia del Budget, sui dati 2027
import { test, eq, ok } from './runner.js';
import { year2027, PROVA_GIORNALE } from './fixture-2027.js';
import { E } from './expected-2027.js';
import { EXCEL_2027 as X } from './excel-2027.js';
import { computeActual, computeBudget, suggestAdjustments, spreadTotal } from '../js/engine/year.js';
import { buildRows, rowTotal, currentMonth, alignmentByMonth, channelName, journalPrefill } from '../js/budget-model.js';

function grid(data, opts) {
  const result = { actual: computeActual(data), budget: computeBudget(data) };
  return buildRows(data, result, opts);
}
const byKey = (rows) => new Map(rows.map((r) => [r.key, r]));

test('mese corrente = primo mese non chiuso', () => {
  eq(currentMonth([]), 1, 'nessun mese chiuso');
  eq(currentMonth([1, 2, 3].map((month) => ({ month, closed: true }))), 4, 'chiusi fino a marzo');
  eq(currentMonth([{ month: 1, closed: true }, { month: 3, closed: true }]), 2, 'buco a febbraio');
  eq(currentMonth([...Array(12).keys()].map((m) => ({ month: m + 1, closed: true }))), 12, 'tutti chiusi');
});

test('dividi il totale annuo: resto sull\'ultimo mese, mesi chiusi invariati', () => {
  eq(spreadTotal(new Array(12).fill(0), 1000), [83.33, 83.33, 83.33, 83.33, 83.33, 83.33, 83.33, 83.33, 83.33, 83.33, 83.33, 83.37]);
  const current = [100, 200, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const plan = spreadTotal(current, 1300, new Set([0, 1]));
  eq(plan.slice(0, 2), [100, 200], 'mesi chiusi');
  eq(plan.slice(2), new Array(10).fill(100), 'mesi aperti');
});

test('totali della griglia uguali al riepilogo annuale', () => {
  const rows = byKey(grid(year2027()));
  eq(rowTotal(rows.get('tot-ricavo'), rows.get('tot-ricavo').budget), E.riepilogo.ricavi, 'ricavi');
  eq(rowTotal(rows.get('tot-costo'), rows.get('tot-costo').budget), E.riepilogo.costiConImprevisti, 'costi con imprevisti');
  eq(rowTotal(rows.get('risultato'), rows.get('risultato').budget), E.riepilogo.target, 'risultato');
  eq(rowTotal(rows.get('fin-GCCCRED'), rows.get('fin-GCCCRED').budget), E.giroconto, 'giroconto carta');
  eq(rowTotal(rows.get('posizione'), rows.get('posizione').budget), X.budget.posizione[11], 'posizione di dicembre');
  eq(rowTotal(rows.get('quadratura'), rows.get('quadratura').budget), null, 'quadratura senza totale');
});

test('righe modificabili e calcolate', () => {
  const rows = byKey(grid(year2027()));
  eq(rows.get('acc-Ristoranti').edit, { table: 'budget_accounts', id: 'Ristoranti' }, 'voce economica');
  eq(rows.get('fin-PREFIN').edit, { table: 'budget_causali', id: 'PREFIN' }, 'causale finanziaria manuale');
  for (const code of ['GCCCRED', 'ADDCCRED', 'RIMMT']) {
    eq(rows.get('fin-' + code).edit, null, code + ' calcolata');
    ok(rows.get('fin-' + code).rule, code + ' con regola');
  }
  eq(rows.get('ch-COSCCRED').edit, undefined, 'riga di canale calcolata');
  eq(rows.get('var-COSCCRED').edit, { table: 'channel_adjustments', id: 'COSCCRED' }, 'Var modificabile');
  ok(rows.get('acc-Spese indivise non preventivate').contingency, 'imprevisti segnalati');
  eq(rows.get('acc-Spese indivise non preventivate').edit, null, 'imprevisti calcolati, non modificabili');
  ok(rows.get('acc-Spese indivise non preventivate').calc, 'con la spiegazione del calcolo');
});

test('righe a zero: nascoste, visibili solo a richiesta', () => {
  const rows = byKey(grid(year2027()));
  ok(!rows.has('acc-Aperitivi'), 'voce attiva a zero nascosta');
  ok(!rows.has('fin-PRETR'), 'causale finanziaria a zero nascosta');
  ok(!rows.has('ch-COSSAT'), 'canale a zero nascosto');
  ok(rows.has('ch-COSCCRED') && rows.has('var-COSCCRED'), 'canale con budget e la sua Var');
  const all = byKey(grid(year2027(), { showZero: true }));
  ok(all.has('acc-Aperitivi') && all.has('fin-PRETR') && all.has('ch-COSSAT') && all.has('var-COSSAT'), 'con «mostra righe a zero»');
  // una registrazione rende visibile anche un canale senza budget
  const withEntries = byKey(grid(year2027({ entries: [{ entry_date: '2027-02-03', causale_id: 'COSSAT',
    debit_account_id: 'Caffè', credit_account_id: 'Satispay', amount: 1.5 }] })));
  eq(withEntries.get('ch-COSSAT')?.actual[1], 1.5, 'Progr. del canale Satispay');
});

test('Progr. e intestazioni dei canali', () => {
  const data = year2027({ entries: PROVA_GIORNALE });
  const rows = byKey(grid(data));
  eq(rows.get('ch-COSPOR').actual[0], 9.99, 'Progr. COSPOR');
  eq(rows.get('acc-Apple Music').actual[0], 9.99, 'Progr. della voce');
  eq(rows.get('tot-ricavo').actual[0], 10000, 'Progr. ricavi');
  eq(rows.get('ch-COSCCRED').label, 'di cui Carta di credito (corrente)', 'nome del canale');
  eq(channelName(data.causali.find((c) => c.id === 'RICTR'), data.accounts), 'Conto corrente Trade Republic');
});

test('Var da allineare: contate solo fino al mese corrente', () => {
  const entries = [...PROVA_GIORNALE, { entry_date: '2027-05-02', causale_id: 'COSFIN', debit_account_id: 'Caffè',
                                        credit_account_id: 'Conto corrente FINECO', amount: 2 }];
  const data = year2027({ entries });
  const saved = computeBudget(data).adjustments;
  const upToMarch = alignmentByMonth(suggestAdjustments(data), saved, 3);
  eq(upToMarch.counts, [4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 'gennaio: 4 canali');
  const upToMay = alignmentByMonth(suggestAdjustments(data), saved, 5);
  eq(upToMay.counts[4], 2, 'maggio: COSFIN e COSCCRED');
  const rows = byKey(grid(data, { alignCounts: upToMarch.counts }));
  eq(rows.get('var-count').budget[0], 4, 'riga del contatore');
});

test('«+» dal Budget al Giornale: importo che manca, solo righe con budget manuale', () => {
  const budget = [10, 10, 0, ...new Array(9).fill(0)];
  const voce = { type: 'line', edit: { table: 'budget_accounts', id: 'v1' }, budget, actual: [0, 4, 0, ...new Array(9).fill(0)] };
  eq(journalPrefill(voce, 2027, 1), { amount: 10, href: '#/giornale/2027-01?voce=v1&importo=10.00' }, 'niente registrato');
  eq(journalPrefill(voce, 2027, 2).amount, 6, 'ne manca una parte');
  eq(journalPrefill({ ...voce, actual: [10, 12, ...new Array(10).fill(0)] }, 2027, 1), null, 'budget raggiunto');
  eq(journalPrefill({ ...voce, actual: [10, 12, ...new Array(10).fill(0)] }, 2027, 2), null, 'budget superato');
  eq(journalPrefill(voce, 2027, 3), null, 'budget a zero');
  const fin = { type: 'line', edit: { table: 'budget_causali', id: 'c1' }, budget, actual: new Array(12).fill(0) };
  eq(journalPrefill(fin, 2027, 12), null, 'dicembre senza budget');
  ok(journalPrefill(fin, 2027, 1).href.endsWith('#/giornale/2027-01?causale=c1&importo=10.00'.slice(1)), 'causale finanziaria');
  eq(journalPrefill({ ...voce, edit: null }, 2027, 1), null, 'riga calcolata');
  eq(journalPrefill({ ...voce, type: 'var', edit: { table: 'channel_adjustments', id: 'c1' } }, 2027, 1), null, 'riga Var');
});
