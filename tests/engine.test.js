// Motore di calcolo contro l'Excel (TM27_Pers_.xlsx, foglio "Prova Bdg" e Riepilogo annuale)
import { test, eq, ok } from './runner.js';
import { EXCEL_2027 as X } from './excel-2027.js';
import { year2027, PROVA_GIORNALE } from './fixture-2027.js';
import { E } from './expected-2027.js';
import { computeYear, computeBudget, computeActual, variance,
         suggestAdjustments, adjustmentsToAlign } from '../js/engine/year.js';
import { round2 } from '../js/format.js';

const yearSum = (s) => round2(s.reduce((t, v) => t + v, 0));

// ---------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------

test('budget delle causali finanziarie, mese per mese (calcolate comprese)', () => {
  const b = computeBudget(year2027());
  for (const [code, expected] of Object.entries(X.budget.causali)) {
    eq(b.causali.get(code), expected, code);
  }
});

test('RIMMT, GCCCRED e ADDCCRED ricalcolati dalle regole come nell\'Excel', () => {
  const b = computeBudget(year2027());
  eq(b.causali.get('RIMMT'), X.budget.causali.RIMMT, 'RIMMT');
  eq(b.causali.get('GCCCRED'), X.budget.causali.GCCCRED, 'GCCCRED');
  eq(b.causali.get('ADDCCRED'), X.budget.causali.ADDCCRED, 'ADDCCRED');
  eq(yearSum(b.causali.get('GCCCRED')), E.giroconto, 'giroconto carta annuo');
});

// Codici dell'Excel rinominati qui (vedi "Errori dell'Excel già corretti" in CLAUDE.md)
const RENAMED = { RICCRED: 'RICRED', COSCRED: 'COSRED' };

test('budget per canale (righe "di cui")', () => {
  const b = computeBudget(year2027());
  for (const [code, expected] of Object.entries(X.budget.channels)) {
    const ours = RENAMED[code] ?? code;
    ok(b.channels.has(ours), 'canale mancante: ' + ours);
    eq(b.channels.get(ours), expected, ours);
  }
});

test('saldi finali di budget di ogni scheda conto, concatenati budget su budget', () => {
  const b = computeBudget(year2027());
  for (const [name, expected] of Object.entries(X.budget.closing)) {
    eq(b.closing.get(name), expected, name);
  }
});

test('ricavi e costi di periodo, posizione e quadratura di budget', () => {
  const b = computeBudget(year2027());
  eq(b.ricavi, X.budget.ricavi, 'ricavi');
  eq(b.costi, X.budget.costi, 'costi');
  eq(b.initial, E.patrimonioIniziale, 'patrimonio iniziale');
  eq(b.posizione, X.budget.posizione, 'posizione');
  eq(b.quadratura, X.budget.quadratura, 'quadratura');
  eq(b.unassigned, [], 'voci senza canale');
});

test('riepilogo annuale', () => {
  const { summary } = computeYear(year2027());
  const r = E.riepilogo;
  const expected = { ...r, quotaMensile: E.quotaImprevisti, openMonths: 12, targetRaggiungibile: true,
                     imprevisti: r.spendibile, netto: r.target };
  for (const [k, v] of Object.entries(expected)) eq(summary[k], v, k);
});

// ---------------------------------------------------------------------
// Imprevisti: voce residuale, sempre calcolata
// ---------------------------------------------------------------------

const IMPREVISTI = 'Spese indivise non preventivate';

test('imprevisti 2027: spendibile diviso 12, come nell\'Excel', () => {
  eq(computeBudget(year2027()).econ.get(IMPREVISTI), new Array(12).fill(E.quotaImprevisti));
});

// L'esempio di Mattia: 2.000 di emolumenti e 1.000 di ristoranti nell'anno, target 500
function example({ extra = 0, closed = [] } = {}) {
  const data = year2027({ months: closed.map((month) => ({ month, closed: true })) });
  data.target = 500;
  data.budgetAccounts = [
    { month: 1, account_id: 'Emolumenti mensili', amount: 2000 },
    { month: 1, account_id: 'Ristoranti', amount: 1000 },
    { month: 3, account_id: 'Ristoranti', amount: extra },
    { month: 2, account_id: IMPREVISTI, amount: 999 }       // valore salvato a mano: ignorato
  ];
  data.budgetCausali = [];
  return data;
}

test('imprevisti residuali: 2.000 − 1.000 − 500 = 500 sui mesi non chiusi', () => {
  const b = computeBudget(example());
  const plan = b.econ.get(IMPREVISTI);
  eq(plan.slice(0, 11), new Array(11).fill(41.67), 'quota mensile');
  eq(plan[11], 41.63, 'resto dell\'arrotondamento a dicembre');
  eq(yearSum(plan), 500, 'totale annuo = residuo');
  const s = computeYear(example()).summary;
  eq([s.spendibile, s.imprevisti, s.netto], [500, 500, 500], 'risultato netto = target');
});

test('50 € in più di ristoranti: gli imprevisti scendono di 50 sui mesi aperti', () => {
  const plan = computeBudget(example({ extra: 50, closed: [1, 2] })).econ.get(IMPREVISTI);
  eq(plan.slice(0, 2), [0, 0], 'mesi chiusi a zero');
  eq(plan.slice(2), new Array(10).fill(45), '450 diviso 10 mesi');
  eq(computeYear(example({ extra: 50, closed: [1, 2] })).summary.netto, 500, 'il target resta');
});

test('mesi chiusi: imprevisti a zero e residuo ridiviso sugli altri', () => {
  const data = year2027({ months: [1, 2, 3].map((month) => ({ month, closed: true })) });
  const b = computeBudget(data);
  eq(b.econ.get(IMPREVISTI).slice(0, 3), [0, 0, 0], 'gennaio–marzo');
  eq(b.econ.get(IMPREVISTI).slice(3), new Array(9).fill(round2(E.riepilogo.spendibile / 9)), 'spendibile / 9');
  eq(b.quadratura, new Array(12).fill(0), 'la quadratura resta a zero');
  eq(b.causali.get('GCCCRED')[0], round2(X.budget.causali.GCCCRED[0] - E.quotaImprevisti),
     'il giroconto carta di gennaio perde gli imprevisti del mese');
});

test('target non raggiungibile: imprevisti negativi e avviso', () => {
  const data = example();
  data.target = 1300;
  const b = computeBudget(data);
  eq(yearSum(b.econ.get(IMPREVISTI)), -300, 'residuo negativo');
  const s = computeYear(data).summary;
  eq([s.targetRaggiungibile, s.netto], [false, 1300], 'il netto resta il target, con imprevisti negativi');
});

test('tutti i mesi chiusi: imprevisti a zero', () => {
  const data = year2027({ months: [...Array(12).keys()].map((m) => ({ month: m + 1, closed: true })) });
  eq(computeBudget(data).econ.get(IMPREVISTI), new Array(12).fill(0));
  eq(computeYear(data).summary.quotaMensile, 0, 'nessuna quota');
});

// ---------------------------------------------------------------------
// Consuntivo
// ---------------------------------------------------------------------

test('consuntivo di gennaio con il Giornale di prova dell\'Excel', () => {
  const a = computeActual(year2027({ entries: PROVA_GIORNALE }));
  for (const [name, expected] of Object.entries(X.actualJanuary.closing)) {
    eq(a.closing.get(name)[0], expected, name);
  }
  eq(a.ricavi[0], X.actualJanuary.ricavi, 'ricavi');
  eq(a.costi[0], X.actualJanuary.costi, 'costi');
  eq(a.posizione[0], X.actualJanuary.posizione, 'posizione');
  eq(a.causali.get('RICPOR')[0], X.actualJanuary.channels.RICPOR, 'Progr. RICPOR');
  eq(a.causali.get('COSPOR')[0], X.actualJanuary.channels.COSPOR, 'Progr. COSPOR');
  eq(a.quadratura, new Array(12).fill(0), 'quadratura');
});

test('il consuntivo si concatena con il consuntivo (non con il budget)', () => {
  const entries = [...PROVA_GIORNALE,
    { entry_date: '2027-02-10', causale_id: 'PREFIN', debit_account_id: 'Portafoglio',
      credit_account_id: 'Conto corrente FINECO', amount: 50 },
    { entry_date: '2027-03-05', causale_id: 'COSCCRED', debit_account_id: 'Ristoranti',
      credit_account_id: 'Carta di credito (corrente)', amount: 35.5 },
    { entry_date: '2026-12-31', causale_id: 'PREFIN', debit_account_id: 'Portafoglio',
      credit_account_id: 'Conto corrente FINECO', amount: 999 }];   // altro anno: ignorata
  const data = year2027({ entries });
  const a = computeActual(data);
  const port = X.actualJanuary.closing.Portafoglio;
  const fin = data.openings['Conto corrente FINECO'];
  eq(a.closing.get('Portafoglio').slice(0, 3), [port, round2(port + 50), round2(port + 50)], 'portafoglio');
  eq(a.closing.get('Conto corrente FINECO').slice(0, 3), [fin, round2(fin - 50), round2(fin - 50)], 'Fineco');
  eq(a.closing.get('Carta di credito (corrente)').slice(0, 4), [0, 0, 35.5, 35.5], 'carta (passivo)');
  eq(a.econ.get('Ristoranti')[2], 35.5, 'costo di marzo');
  eq(a.quadratura, new Array(12).fill(0), 'quadratura');
});

// ---------------------------------------------------------------------
// Var +/- e scostamenti
// ---------------------------------------------------------------------

test('Var suggerite dagli Alert del Giornale di prova', () => {
  const s = suggestAdjustments(year2027({ entries: PROVA_GIORNALE }));
  eq(s.get('COSPOR')[0], 9.99, 'COSPOR +');
  eq(s.get('COSCCRED')[0], -9.99, 'COSCCRED −');
  eq(s.get('RICPOR')[0], 10000, 'RICPOR +');
  eq(s.get('RICTR')[0], -10000, 'RICTR −');
  eq(s.size, 4, 'solo i canali coinvolti');
});

test('le Var spostano budget tra canali e cambiano il giroconto carta, la quadratura resta 0', () => {
  const adjustments = [
    { month: 1, causale_id: 'COSPOR', amount: 9.99 },
    { month: 1, causale_id: 'COSCCRED', amount: -9.99 }
  ];
  const b = computeBudget(year2027({ adjustments }));
  const card = round2(X.budget.channels.COSCCRED[0] - 9.99);
  eq(b.channels.get('COSPOR')[0], round2(X.budget.channels.COSPOR[0] + 9.99), 'COSPOR');
  eq(b.channels.get('COSCCRED')[0], card, 'COSCCRED');
  eq(b.causali.get('GCCCRED')[0], card, 'giroconto di gennaio');
  eq(b.causali.get('ADDCCRED')[1], card, 'addebito di febbraio');
  eq(b.varCheck, new Array(12).fill(0), 'Verifica Variazioni');
  eq(b.quadratura, new Array(12).fill(0), 'quadratura');
  eq(b.closing.get('Portafoglio')[0], round2(X.budget.closing.Portafoglio[0] - 9.99), 'portafoglio: 9,99 di costi in più');
});

test('Var da allineare: confronto tra suggerite e salvate', () => {
  const data = year2027({ entries: PROVA_GIORNALE,
    adjustments: [{ month: 1, causale_id: 'COSPOR', amount: 9.99 }, { month: 1, causale_id: 'COSCCRED', amount: -9.99 }] });
  const b = computeBudget(data);
  const todo = adjustmentsToAlign(suggestAdjustments(data), b.adjustments);
  eq(todo.map((t) => t.causale_id).sort(), ['RICPOR', 'RICTR'], 'mancano le Var dei ricavi');
  ok(b.varCheck[0] === 0, 'le Var salvate sono già bilanciate');
});

test('scostamenti: positivo = favorevole', () => {
  eq(variance('ricavo', 100, 120), 20, 'ricavo sopra budget');
  eq(variance('costo', 120, 150), -30, 'costo sopra budget');
  eq(variance('finanziaria', 80, 70), 10, 'finanziaria sotto budget');
});

test('una voce con budget e senza canale standard si vede e rompe la quadratura', () => {
  const data = year2027();
  data.accounts.find((a) => a.id === 'Sushi').standard_causale_id = null;
  const b = computeBudget(data);
  eq(b.unassigned.map((a) => a.id), ['Sushi']);
  eq(b.quadratura[0], E.budgetGennaio.sushi, 'gennaio: il budget del sushi non esce da nessun conto');
});

test('causali calcolate: un valore scritto a mano vale al posto del calcolato', () => {
  const data = year2027();
  const base = computeBudget(data);
  const giro = base.causali.get('GCCCRED');
  // giroconto di febbraio scritto a mano: l'addebito di marzo lo segue; addebito di gennaio a 0
  const over = computeBudget({ ...data, budgetCausali: [...data.budgetCausali,
    { month: 2, causale_id: 'GCCCRED', amount: 123.45 }, { month: 1, causale_id: 'ADDCCRED', amount: 0 }] });
  eq(over.causali.get('GCCCRED')[1], 123.45, 'giroconto di febbraio scritto');
  eq(over.causali.get('GCCCRED')[2], giro[2], 'marzo resta calcolato');
  eq(over.causali.get('ADDCCRED')[2], 123.45, "l'addebito di marzo segue il giroconto scritto");
  eq(over.causali.get('ADDCCRED')[0], 0, 'addebito di gennaio scritto a 0');
  eq(over.overrides.get('ADDCCRED').slice(0, 2), [0, null], 'mesi scritti e calcolati');
  eq(base.overrides.size, 0, 'senza righe salvate tutto calcolato');
});

test('storni: Var suggerite e Verifica Variazioni', () => {
  // rimborso di 10 € su una voce di costo (canale standard: carta) incassato su PayPal
  const storno = { entry_date: '2027-02-10', causale_id: 'RICPAY', debit_account_id: 'Paypal', credit_account_id: 'Pokèmon', amount: 10 };
  const data = year2027({ entries: [storno] });
  const s = suggestAdjustments(data);
  eq([s.get('RICPAY')[1], s.get('COSCCRED')[1]], [10, 10], '+10 sul canale usato e +10 sul canale standard della voce');
  const check = (adjustments) => computeBudget({ ...data, adjustments }).varCheck[1];
  eq(check([{ month: 2, causale_id: 'RICPAY', amount: 10 }, { month: 2, causale_id: 'COSCCRED', amount: 10 }]), 0, 'storno: si compensa');
  eq(check([{ month: 2, causale_id: 'COSCCRED', amount: -10 }, { month: 2, causale_id: 'COSPAY', amount: 10 }]), 0, 'fuori canale: si compensa');
  eq(check([{ month: 2, causale_id: 'COSCCRED', amount: 5 }]), 5, 'Var senza contropartita');
  eq(computeBudget({ ...data, adjustments: [{ month: 2, causale_id: 'RICPAY', amount: 10 }, { month: 2, causale_id: 'COSCCRED', amount: 10 }] })
     .quadratura[1], 0, 'la quadratura del budget resta a 0');
});
