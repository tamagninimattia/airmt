// Chiusura del mese e dell'anno, riconciliazione
import { test, eq, ok } from './runner.js';
import { year2027, PROVA_GIORNALE } from './fixture-2027.js';
import { EXCEL_2027 as X } from './excel-2027.js';
import { E } from './expected-2027.js';
import { round2 } from '../js/format.js';
import { computeActual, computeBudget, suggestAdjustments } from '../js/engine/year.js';
import { alignmentByMonth } from '../js/budget-model.js';
import { reconciliationRows, monthChecks, yearClosable, nextYearOpenings, alignMonthRows } from '../js/closing-model.js';
import { cardRows } from '../js/accounts-model.js';

const result = (data) => ({ actual: computeActual(data), budget: computeBudget(data) });
// saldi reali di gennaio: il portafoglio coincide, Fineco ha 3,55 € in meno del calcolato
const PORT = X.actualJanuary.closing.Portafoglio;
const FIN = year2027().openings['Conto corrente FINECO'];
const recs = [
  { month: 1, account_id: 'Portafoglio', actual_balance: PORT, note: 'contati' },
  { month: 1, account_id: 'Conto corrente FINECO', actual_balance: round2(FIN - 3.55), note: '' }
];

test('riconciliazione: coincide, differisce, non inserito', () => {
  const data = year2027({ entries: PROVA_GIORNALE, reconciliations: recs });
  const rows = new Map(reconciliationRows(data, result(data).actual, 1).map((r) => [r.account.id, r]));
  eq([rows.get('Portafoglio').status, rows.get('Portafoglio').diff, rows.get('Portafoglio').note], ['ok', 0, 'contati']);
  eq([rows.get('Conto corrente FINECO').status, rows.get('Conto corrente FINECO').diff], ['diff', -3.55], 'Fineco: 3,55 in meno');
  eq([rows.get('Paypal').status, rows.get('Paypal').real], ['missing', null], 'conto attivo a zero, non controllato');
  eq(rows.get('Carta di credito (da addebitare)').group, 'Debiti');
  eq(reconciliationRows(data, result(data).actual, 2).filter((r) => r.status !== 'missing').length, 0, 'febbraio vuoto');
});

test('controlli di gennaio con il Giornale di prova', () => {
  const data = year2027({ entries: PROVA_GIORNALE, reconciliations: recs });
  const r = result(data);
  const align = alignmentByMonth(suggestAdjustments(data), r.budget.adjustments, 12);
  const c = monthChecks(data, r, 1, align.items);
  const byLabel = new Map(c.budgetDiffs.map((d) => [d.code ?? d.label, d]));
  eq(byLabel.get('Emolumenti mensili').diff, round2(10000 - E.budgetGennaio.emolumenti), 'ricavo sotto budget');
  eq(byLabel.get('Apple Music').diff, round2(9.99 - E.sezioniGennaio.appleMusic), 'consuntivo contro budget');
  eq(byLabel.get('PREFIN').diff, -E.budgetGennaio.prefin, 'prelievo non registrato');
  ok(byLabel.get('GCCCRED').calculated, 'giroconto segnalato come calcolato');
  ok(!byLabel.has('Spese indivise non preventivate'), 'imprevisti esclusi');
  eq(c.varToAlign.length, 4, 'Var di gennaio');
  eq(c.quadratura, 0);
  eq([c.reconciled, c.mismatched.map((x) => x.account.id)], [2, ['Conto corrente FINECO']]);
});

test('mese con consuntivo uguale al budget: nessuna voce da allineare', () => {
  // gennaio chiuso: imprevisti a 0, e registrazioni identiche al budget (giroconto e addebito compresi)
  const data = year2027({ months: [{ month: 1, closed: true }] });
  const b = computeBudget(data);
  for (const a of data.accounts.filter((x) => x.type === 'economico' && !x.is_contingency)) {
    const v = b.econ.get(a.id)[0];
    if (!v) continue;
    const c = data.causali.find((x) => x.id === a.standard_causale_id);
    data.entries.push({ entry_date: '2027-01-15', causale_id: c.id, amount: v,
      debit_account_id: c.kind === 'costo' ? a.id : c.debit_account_id,
      credit_account_id: c.kind === 'ricavo' ? a.id : c.credit_account_id });
  }
  for (const c of data.causali.filter((x) => x.kind === 'finanziaria')) {
    const v = b.causali.get(c.id)[0];
    if (v) data.entries.push({ entry_date: '2027-01-20', causale_id: c.id, amount: v,
      debit_account_id: c.debit_account_id, credit_account_id: c.credit_account_id });
  }
  const r = result(data);
  eq(monthChecks(data, r, 1).budgetDiffs, [], 'budget allineato');
  eq(r.actual.closing.get('Portafoglio')[0], r.budget.closing.get('Portafoglio')[0], 'stessi saldi');
  eq(r.actual.quadratura[0], 0);
});

test('chiusura dell\'anno solo con tutti i mesi chiusi', () => {
  const all = [...Array(12).keys()].map((m) => ({ month: m + 1, closed: true }));
  eq(yearClosable(all), { closable: true, open: [] });
  eq(yearClosable(all.map((m) => (m.month === 12 || m.month === 3 ? { ...m, closed: false } : m))),
     { closable: false, open: [3, 12] });
  eq(yearClosable([]).open.length, 12);
});

test('saldi iniziali dell\'anno dopo dai saldi finali reali di dicembre', () => {
  const data = year2027({ entries: PROVA_GIORNALE });
  const rows = new Map(nextYearOpenings(data, result(data).actual, { Portafoglio: PORT }).map((r) => [r.account.id, r]));
  eq([rows.get('Portafoglio').closing, rows.get('Portafoglio').differs], [PORT, false], 'già allineato');
  eq([rows.get('Conto corrente FINECO').saved, rows.get('Conto corrente FINECO').differs], [null, true], 'da creare');
  eq(rows.get('Paypal').differs, false, 'zero e mancante: niente da fare');
  eq(rows.get('Dossier Titoli FINECO').closing, data.openings['Dossier Titoli FINECO'], 'mosso solo da INV e DIS');
});

test('scheda conto: saldo per controllo e differenza nella colonna Progr.', () => {
  const data = year2027({ entries: PROVA_GIORNALE, reconciliations: recs });
  const rows = new Map(cardRows(data, result(data), 'Conto corrente FINECO').map((r) => [r.key, r]));
  eq(rows.get('control').actual.slice(0, 2), [round2(FIN - 3.55), null], 'saldo reale');
  eq(rows.get('control-diff').actual.slice(0, 2), [-3.55, null], 'differenza');
  eq(rows.get('control').budget, null, 'nessun budget');
  ok(!new Map(cardRows(data, result(data), 'Paypal').map((r) => [r.key, r])).has('control'), 'righe solo se ci sono saldi reali');
});

test('allinea tutto il budget del mese al consuntivo', () => {
  const data = year2027({ entries: PROVA_GIORNALE });
  const c = monthChecks(data, result(data), 1);
  const out = alignMonthRows(c.budgetDiffs, 'u1', 2027, 1);
  const manual = c.budgetDiffs.filter((d) => d.edit);
  eq(out.budget_accounts.length + out.budget_causali.length, manual.length, 'una riga per voce');
  ok(out.budget_causali.some((r) => r.causale_id === 'GCCCRED'), 'anche le calcolate: il consuntivo diventa un valore scritto');
  eq(out.budget_causali.find((r) => r.causale_id === 'PREFIN')?.amount, 0, 'prelievo non registrato: budget a 0');
  // applicate al budget, non resta nessuna differenza (calcolate comprese)
  for (const [table, list] of [['budget_accounts', 'budgetAccounts'], ['budget_causali', 'budgetCausali']]) {
    const key = table === 'budget_accounts' ? 'account_id' : 'causale_id';
    for (const r of out[table]) {
      data[list] = data[list].filter((x) => !(x.month === 1 && x[key] === r[key]));
      data[list].push({ month: 1, [key]: r[key], amount: r.amount });
    }
  }
  eq(monthChecks(data, result(data), 1).budgetDiffs, [], 'tutto allineato');
});
