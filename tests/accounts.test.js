// Schede conto e situazione patrimoniale, contro le schede del foglio "Prova Bdg"
import { test, eq, ok } from './runner.js';
import { EXCEL_2027 as X } from './excel-2027.js';
import { E } from './expected-2027.js';
import { year2027, PROVA_GIORNALE } from './fixture-2027.js';
import { computeActual, computeBudget } from '../js/engine/year.js';
import { cardRows, accountLedger, positionRows, causaleSide } from '../js/accounts-model.js';
import { round2 } from '../js/format.js';

const result = (data) => ({ actual: computeActual(data), budget: computeBudget(data) });
const byKey = (rows) => new Map(rows.map((r) => [r.key, r]));
const FIN = 'Conto corrente FINECO';

test('scheda Fineco: variazioni + e − di budget come nell\'Excel', () => {
  const data = year2027();
  const rows = byKey(cardRows(data, result(data), FIN));
  eq(rows.get('opening').budget.slice(0, 2), [data.openings[FIN], X.budget.closing[FIN][0]], 'saldo iniziale gen, feb');
  eq(rows.get('tot-dare').budget.slice(0, 2), E.finecoVariazioni.piu, 'Variazioni + (F143, I143)');
  eq(rows.get('tot-avere').budget.slice(0, 2), E.finecoVariazioni.meno, 'Variazioni − (F144, I144)');
  eq(rows.get('closing').budget, X.budget.closing[FIN], 'saldo finale');
  eq(rows.get('avere-ADDCCRED').budget.slice(0, 2), X.budget.causali.ADDCCRED.slice(0, 2), 'addebito carta');
  eq(rows.get('avere-COSFIN').budget[0], X.budget.channels.COSFIN[0], 'costi Fineco (canale)');
  eq(rows.get('avere-ADDCCRED').badge, 'calcolato', 'budget calcolato segnalato');
  ok(!rows.has('dare-PAYFIN'), 'causale senza movimenti nascosta');
  ok(byKey(cardRows(data, result(data), FIN, { showZero: true })).has('dare-PAYFIN'), 'mostrata a richiesta');
});

test('scheda della carta da addebitare (passivo): incrementi e decrementi', () => {
  const data = year2027();
  const rows = byKey(cardRows(data, result(data), 'Carta di credito (da addebitare)'));
  eq(rows.get('sub-avere').label, 'Incrementi', 'per un passivo gli incrementi sono in Avere');
  eq(rows.get('tot-avere').budget[0], E.cartaAddebitareGennaio.incrementi, 'Variazioni + (F317)');
  eq(rows.get('tot-dare').budget[0], E.cartaAddebitareGennaio.decrementi, 'Variazioni − (F318)');
  eq(rows.get('closing').budget, X.budget.closing['Carta di credito (da addebitare)'], 'saldo finale');
  eq(rows.get('closing').kind, 'costo', 'un debito più alto del previsto è sfavorevole');
});

test('scheda Portafoglio: consuntivo con il Giornale di prova', () => {
  const data = year2027({ entries: PROVA_GIORNALE });
  const rows = byKey(cardRows(data, result(data), 'Portafoglio'));
  eq(rows.get('dare-RICPOR').actual[0], 10000, 'entrata per ricavi');
  eq(rows.get('avere-COSPOR').actual[0], 9.99, 'uscita per costi');
  eq(rows.get('closing').actual[0], X.actualJanuary.closing.Portafoglio, 'saldo finale reale');
  eq(rows.get('opening').actual[1], X.actualJanuary.closing.Portafoglio, 'febbraio parte dal consuntivo di gennaio');
});

test('movimenti del mese con saldo progressivo', () => {
  const entries = [...PROVA_GIORNALE, { id: 'x', entry_date: '2027-02-10', causale_id: 'PREFIN',
    debit_account_id: 'Portafoglio', credit_account_id: FIN, amount: 50, note: 'bancomat' }];
  const data = year2027({ entries });
  const r = result(data);
  const port = X.actualJanuary.closing.Portafoglio;
  const jan = accountLedger(data, r.actual, 'Portafoglio', 1);
  eq([jan.start, jan.lines.length, jan.end], [data.openings.Portafoglio, 2, port], 'gennaio');
  const feb = accountLedger(data, r.actual, 'Portafoglio', 2);
  eq(feb.start, port, 'saldo iniziale di febbraio');
  eq(feb.lines[0], { id: 'x', date: '2027-02-10', code: 'PREFIN', label: FIN, note: 'bancomat',
                     plus: 50, minus: 0, balance: round2(port + 50), provisional: false }, 'prelievo');
  // movimento provvisorio: compare tra i movimenti ma non cambia saldi
  const prov = [{ id: 'p', entry_date: '2027-02-05', causale_id: 'PREFIN', debit_account_id: 'Portafoglio',
                  credit_account_id: FIN, amount: 30, note: null }];
  const withProv = accountLedger(data, r.actual, 'Portafoglio', 2, { provisional: prov });
  eq(withProv.lines.map((l) => [l.id, l.provisional, l.balance]), [['p', true, null], ['x', false, round2(port + 50)]], 'in ordine di data, senza saldo');
  eq(withProv.end, feb.end, 'saldo finale invariato');
  ok(!accountLedger(data, r.actual, 'Portafoglio', 3, { provisional: prov }).lines.some((l) => l.id === 'p'), 'solo nel suo mese');
  const fin = accountLedger(data, r.actual, FIN, 2);
  eq([fin.lines[0].plus, fin.lines[0].minus, fin.end], [0, 50, round2(data.openings[FIN] - 50)], 'stesso movimento visto da Fineco');
});

test('lato delle causali su un conto', () => {
  const { causali } = year2027();
  const c = (code) => causali.find((x) => x.code === code);
  eq(causaleSide(c('PREFIN'), 'Portafoglio'), 'dare');
  eq(causaleSide(c('PREFIN'), FIN), 'avere');
  eq(causaleSide(c('COSPOR'), 'Portafoglio'), 'avere', 'costo: il canale è in Avere');
  eq(causaleSide(c('RICPOR'), 'Portafoglio'), 'dare', 'ricavo: il canale è in Dare');
  eq(causaleSide(c('INV'), 'Portafoglio'), null);
});

test('situazione patrimoniale: totali per gruppo e quadratura come nell\'Excel', () => {
  const data = year2027();
  const rows = byKey(positionRows(data, result(data), { hrefFor: (a) => '#' + a.id }));
  const g = E.gruppiGennaio;
  eq(rows.get('tot-disponibilita').budget[0], g.disponibilita, 'Totale Disponibilità (F361)');
  eq(rows.get('tot-crediti').budget[0], g.crediti, 'Totale Crediti (F362)');
  eq(rows.get('tot-debiti').budget[0], g.debiti, 'Totale Debiti (F363)');
  eq(rows.get('tot-immobilizzato').budget[0], g.immobilizzato, 'Totale immobilizzato (F364)');
  eq(rows.get('posizione').budget, X.budget.posizione, 'posizione');
  eq(rows.get('progressivo').budget, X.budget.posizione, 'patrimonio progressivo = posizione');
  eq(rows.get('risultato').budget[11], E.riepilogo.target, 'risultato progressivo a dicembre = target');
  eq(rows.get('quadratura').budget, X.budget.quadratura, 'quadratura');
  eq(rows.get('acc-Portafoglio').href, '#Portafoglio', 'collegamento alla scheda');
  ok(rows.has('acc-Paypal'), 'conti attivi a zero visibili');
});

test('situazione patrimoniale: consuntivo di gennaio con il Giornale di prova', () => {
  const data = year2027({ entries: PROVA_GIORNALE });
  const rows = byKey(positionRows(data, result(data)));
  eq(rows.get('posizione').actual[0], X.actualJanuary.posizione, 'posizione (G365)');
  eq(rows.get('risultato').actual[0], round2(X.actualJanuary.ricavi - X.actualJanuary.costi), 'risultato progressivo (G367)');
  eq(rows.get('quadratura').actual, new Array(12).fill(0), 'quadratura');
});
