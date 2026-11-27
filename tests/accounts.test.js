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
  eq(rows.get('avere-ADDCCRED').calc, true, 'budget calcolato segnalato');
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

test('movimenti dell\'anno con saldo progressivo', () => {
  const entries = [...PROVA_GIORNALE, { id: 'x', entry_date: '2027-02-10', causale_id: 'PREFIN',
    debit_account_id: 'Portafoglio', credit_account_id: FIN, amount: 50, note: 'bancomat' }];
  const data = year2027({ entries });
  const r = result(data);
  const port = X.actualJanuary.closing.Portafoglio;
  const all = accountLedger(data, 'Portafoglio');
  eq([all.start, all.lines.length], [data.openings.Portafoglio, 3], 'tutto l\'anno');
  eq(all.lines[1].balance, port, 'saldo a fine gennaio');
  eq(all.lines[2], { id: 'x', date: '2027-02-10', label: FIN, note: 'bancomat',
                     plus: 50, minus: 0, balance: round2(port + 50), provisional: false }, 'prelievo');
  eq(all.end, r.actual.closing.get('Portafoglio')[11], 'saldo finale = saldo di dicembre');
  // movimento provvisorio: compare tra i movimenti ma non cambia saldi
  const prov = [{ id: 'p', entry_date: '2027-02-05', causale_id: 'PREFIN', debit_account_id: 'Portafoglio',
                  credit_account_id: FIN, amount: 30, note: null }];
  const withProv = accountLedger(data, 'Portafoglio', { provisional: prov });
  eq(withProv.lines.slice(2).map((l) => [l.id, l.provisional, l.balance]), [['p', true, null], ['x', false, round2(port + 50)]], 'in ordine di data, senza saldo');
  eq(withProv.end, all.end, 'saldo finale invariato');
  const fin = accountLedger(data, FIN);
  const last = fin.lines.at(-1);
  eq([last.plus, last.minus, fin.end], [0, 50, r.actual.closing.get(FIN)[11]], 'stesso movimento visto da Fineco');
});

test('movimenti di un conto economico: totale progressivo da 0', () => {
  const data = year2027({ entries: PROVA_GIORNALE });
  const r = result(data);
  const voce = data.accounts.find((a) => a.type === 'economico' && a.kind === 'costo'
    && data.entries.some((e) => e.debit_account_id === a.id));
  const l = accountLedger(data, voce.id);
  eq(l.start, 0, 'parte da 0');
  ok(l.lines.length > 0 && l.lines.every((x) => x.plus > 0 && x.minus === 0), 'costi nel lato +');
  eq(l.end, round2(r.actual.econ.get(voce.id).reduce((t, v) => t + v, 0)), 'totale = consuntivo dell\'anno');
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
