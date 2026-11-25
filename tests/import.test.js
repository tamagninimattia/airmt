// Importazione del Giornale da Excel (import-model.js), con dati sintetici
import { test, eq, ok } from './runner.js';
import * as I from '../js/import-model.js';

const accounts = [
  { id: 'fin', name: 'Conto corrente FINECO', type: 'patrimoniale' },
  { id: 'por', name: 'Portafoglio', type: 'patrimoniale' },
  { id: 'cc', name: 'Carta di credito (corrente)', type: 'patrimoniale' },
  { id: 'ris', name: 'Ristoranti', type: 'economico', kind: 'costo', standard_causale_id: 'COSCCRED' },
  { id: 'emo', name: 'Emolumenti mensili', type: 'economico', kind: 'ricavo', standard_causale_id: 'RICFIN' }
];
const causali = [
  { id: 'COSFIN', code: 'COSFIN', kind: 'costo', credit_account_id: 'fin' },
  { id: 'COSCCRED', code: 'COSCCRED', kind: 'costo', credit_account_id: 'cc' },
  { id: 'RICFIN', code: 'RICFIN', kind: 'ricavo', debit_account_id: 'fin' },
  { id: 'PREFIN', code: 'PREFIN', kind: 'finanziaria', debit_account_id: 'por', credit_account_id: 'fin' }
];
const ctx = { accounts, causali, years: [2026, 2027] };

test('importazione: date, importi e righe', () => {
  eq(I.parseDate('03/01/2026'), '2026-01-03');
  eq(I.parseDate('3/1/2026'), '2026-01-03');
  eq(I.parseDate('2026-01-03'), '2026-01-03');
  eq(I.parseDate(new Date(2026, 0, 3)), '2026-01-03', 'data di Excel');
  eq(I.parseDate(46025), '2026-01-03', 'numero di serie di Excel');
  eq(I.parseDate('31/02/2026'), null, 'giorno inesistente');
  eq(I.parseImportAmount('1.800,00'), 1800);
  eq(I.parseImportAmount(42.499999), 42.5, 'numero di Excel arrotondato');
  eq(I.parseImportAmount('10,990000'), 10.99);
  ok(Number.isNaN(I.parseImportAmount('abc')));
  eq(I.splitRows('Data;Da\n\n03/01/2026;Portafoglio').map((r) => r.line), [1, 3], 'CSV: righe vuote saltate');
  eq(I.splitRows('a\tb;c').at(0).cells, ['a', 'b;c'], 'tabulazioni prima del punto e virgola');
});

test('importazione: causale dalla coppia di conti', () => {
  const by = (id) => accounts.find((a) => a.id === id);
  eq(I.matchCausale(by('fin'), by('ris'), causali).causale.code, 'COSFIN', 'costo pagato da Fineco');
  eq(I.matchCausale(by('emo'), by('fin'), causali).causale.code, 'RICFIN', 'ricavo su Fineco');
  eq(I.matchCausale(by('fin'), by('por'), causali).causale.code, 'PREFIN', 'prelievo');
  ok(/è un ricavo/.test(I.matchCausale(by('fin'), by('emo'), causali).error), 'ricavo dalla parte sbagliata');
  ok(/Non esiste una causale/.test(I.matchCausale(by('por'), by('ris'), causali).error), 'causale mancante');
  ok(/due voci economiche/.test(I.matchCausale(by('emo'), by('ris'), causali).error));
  // due causali di costo sullo stesso conto: vale il canale standard, oppure la colonna Causale
  const two = [...causali, { id: 'COSFIN2', code: 'COSFIN2', kind: 'costo', credit_account_id: 'fin' }];
  ok(/Più causali possibili/.test(I.matchCausale(by('fin'), by('ris'), two).error), 'ambigua');
  eq(I.matchCausale(by('fin'), by('ris'), two, 'cosfin2').causale.code, 'COSFIN2', 'scelta con la colonna Causale');
  eq(I.matchCausale(by('cc'), by('ris'), [...two, { id: 'X', code: 'COSCC2', kind: 'costo', credit_account_id: 'cc' }]).causale.code,
     'COSCCRED', 'tra due, il canale standard');
});

test('importazione: dal file alle registrazioni, con abbinamento dei nomi', () => {
  const table = I.sheetRows([
    ['Data', 'Da', 'A', 'Importo', 'Note'],
    [new Date(2026, 0, 3), 'Fineco', 'Ristoranti', 42.5, 'cena'],
    ['27/01/2026', 'Emolumenti mensili', 'Fineco', '1.800,00'],
    ['12/02/2026', 'fineco', 'portafoglio', 250],
    ['10/03/2025', 'Fineco', 'Ristoranti', 10],
    [],
    ['xx', 'Fineco', 'Ristoranti', 10]
  ]);
  eq(I.unknownNames(table, accounts), ['Fineco'], 'nomi da abbinare, una volta sola');
  const { rows } = I.parseImport(table, { ...ctx, mapping: { fineco: 'fin' } });
  eq(rows.length, 5, 'intestazione e righe vuote saltate');
  eq(rows[0].rec, { entry_date: '2026-01-03', causale_id: 'COSFIN', amount: 42.5, note: 'cena', provisional: false,
                    debit_account_id: 'ris', credit_account_id: 'fin' }, 'costo');
  eq([rows[1].rec.debit_account_id, rows[1].rec.credit_account_id, rows[1].rec.note], ['fin', 'emo', null], 'ricavo');
  eq(rows[2].causale.code, 'PREFIN', 'nomi senza badare alle maiuscole');
  ok(/2025 non esiste/.test(rows[3].error), 'anno non creato');
  ok(/Data non valida/.test(rows[4].error) && rows[4].line === 7, 'riga con il suo numero');
  ok(/Conto sconosciuto/.test(I.parseImport(table, ctx).rows[0].error), 'senza abbinamento');
  eq(I.monthSummary(rows), [
    { month: '2026-01', count: 2, ricavi: 1800, costi: 42.5, finanziarie: 0 },
    { month: '2026-02', count: 1, ricavi: 0, costi: 0, finanziarie: 250 }]);
  eq(I.dupKey(rows[0].rec), '2026-01-03|ris|fin|42.5');
});
