// Regole pure di formati, Impostazioni e Giornale
import { test, eq, ok } from './runner.js';
import * as F from '../js/format.js';
import * as M from '../js/settings-model.js';
import * as J from '../js/journal-model.js';

test('lettura degli importi scritti a mano', () => {
  eq(F.parseAmount('12,50'), 12.5, 'virgola');
  eq(F.parseAmount('1.234,56'), 1234.56, 'migliaia e virgola');
  eq(F.parseAmount('12.5'), 12.5, 'punto decimale');
  eq(F.parseAmount('1.234'), 1234, 'punto delle migliaia');
  eq(F.parseAmount(' 10 € '), 10, 'simbolo dell\'euro');
  eq(F.parseAmount('−3'), -3, 'segno meno tipografico');
  ok(Number.isNaN(F.parseAmount('1,234')), 'tre decimali');
  ok(Number.isNaN(F.parseAmount('abc')), 'testo');
  ok(Number.isNaN(F.parseAmount('')), 'vuoto');
});

test('formato degli importi', () => {
  eq(F.fmtAmount(12345.67), '12.345,67');
  eq(F.fmtAmount(-2468.24), '−2.468,24');
  eq(F.fmtAmount(0.1 + 0.2), '0,30');
  eq(F.fmtAmount(1234567), '1.234.567,00');
  eq(F.parseAmount(F.fmtAmount(-2468.24)), -2468.24, 'andata e ritorno');
});

const accs = [
  { id: 'fin', name: 'Conto corrente FINECO', type: 'patrimoniale', sort_order: 2 },
  { id: 'cc', name: 'Carta di credito (corrente)', type: 'patrimoniale', sort_order: 11 },
  { id: 'imp', name: 'Spese indivise non preventivate', type: 'economico', kind: 'costo', is_contingency: true, sort_order: 199 }
];
const caus = [
  { id: 'c1', code: 'COSFIN', description: 'Costi Fineco', kind: 'costo', credit_account_id: 'fin', sort_order: 402 },
  { id: 'c2', code: 'GCCCRED', description: 'Giroconto', kind: 'finanziaria', budget_rule: 'card_giroconto', sort_order: 17 },
  { id: 'c3', code: 'RICFIN', description: 'Ricavi Fineco', kind: 'ricavo', debit_account_id: 'fin', sort_order: 302 }
];

test('impostazioni: conti', () => {
  const a = M.buildAccount('economico', { name: ' Bar ', kind: 'costo', budget_section: '', standard_causale_id: 'c1',
                                          sort_order: '200', active: true, is_contingency: true });
  eq([a.name, a.budget_section, a.sort_order], ['Bar', null, 200], 'costruzione');
  ok(/imprevisti/.test(M.validateAccount(a, null, accs, caus).join()), 'imprevisti unico');
  eq(M.validateAccount({ ...a, is_contingency: true }, 'imp', accs, caus), [], 'stesso conto degli imprevisti');
  const r = M.buildAccount('economico', { name: 'Bar', kind: 'ricavo', standard_causale_id: 'c1', sort_order: '1', active: true });
  ok(/causale di ricavo/.test(M.validateAccount(r, null, accs, caus).join()), 'canale dello stesso tipo');
  ok(/Esiste già/.test(M.validateAccount({ ...r, name: 'conto corrente fineco' }, null, accs, caus).join()), 'nome doppio');
  const p = M.buildAccount('patrimoniale', { name: 'Mutuo', grp: 'debiti', sort_order: '15', active: true });
  eq(p.side, 'passivo', 'natura dal gruppo');
  eq(M.validateAccount(p, null, accs, caus), [], 'patrimoniale valido');
});

test('impostazioni: causali', () => {
  const c = M.buildCausale({ code: 'cosx', description: 'X', kind: 'costo', debit_account_id: 'fin',
                             credit_account_id: 'cc', budget_rule: 'mt_rimborso', sort_order: '5', active: true });
  eq([c.code, c.debit_account_id, c.budget_rule], ['COSX', null, null], 'costruzione');
  eq(M.validateCausale(c, null, caus, accs), [], 'valida');
  const g = M.buildCausale({ code: 'GIRO2', description: 'Y', kind: 'finanziaria', debit_account_id: 'fin',
                             credit_account_id: 'fin', budget_rule: 'card_giroconto', sort_order: '5' });
  const e = M.validateCausale(g, null, caus, accs).join(' ');
  ok(/diversi/.test(e) && /GCCCRED/.test(e), 'Dare = Avere e regola già usata');
  ok(/2–12/.test(M.validateCausale({ ...g, code: 'COS FIN' }, null, caus, accs).join()), 'codice');
  ok(/patrimoniali/.test(M.validateCausale({ ...g, credit_account_id: 'imp' }, null, caus, accs).join()), 'conti fissi patrimoniali');
  ok(M.accountDeleteBlock({ entries: 0, causali: [caus[0]] }).includes('COSFIN'), 'eliminazione bloccata');
  ok(M.causaleLocks({ entries: 0, standardFor: [{}] }).kind, 'tipo bloccato se canale standard');
});

test('giornale: mesi e date', () => {
  eq(J.monthBounds(2027, 12), { from: '2027-12-01', to: '2028-01-01' });
  eq(J.shiftMonth({ year: 2027, month: 1 }, -1), { year: 2026, month: 12 });
  eq(J.parseMonthParam('2027-13'), null);
  eq(J.defaultMonth([{ year: 2027 }], [{ year: 2027, month: 1, closed: true }], '2026-10-15'), { year: 2027, month: 2 });
  eq(J.defaultMonth([{ year: 2026 }], [], '2026-10-15'), { year: 2026, month: 10 });
  eq(J.defaultDate({ year: 2027, month: 2 }, '2026-10-15'), '2027-02-01');
});

test('giornale: Alert, costruzione e validazione', () => {
  const cos = { id: 'COSFIN', kind: 'costo', credit_account_id: 'fin' };
  const ccred = { id: 'COSCCRED', kind: 'costo', credit_account_id: 'cc' };
  const am = { id: 'am', name: 'Apple Music', type: 'economico', kind: 'costo', standard_causale_id: 'COSCCRED' };
  ok(J.channelAlert(cos, am), 'fuori canale');
  ok(!J.channelAlert(ccred, am), 'canale standard');
  eq(J.buildEntry(cos, 'am', '2027-03-04', 10.99, ' '),
     { entry_date: '2027-03-04', causale_id: 'COSFIN', debit_account_id: 'am', credit_account_id: 'fin', amount: 10.99, note: null,
       provisional: false });
  eq(J.buildEntry(cos, 'am', '2027-03-04', 10.99, '', true).provisional, true, 'movimento provvisorio');
  const fin = { id: 'PREFIN', kind: 'finanziaria', debit_account_id: 'por', credit_account_id: 'fin' };
  eq(J.validateEntry({ causale: fin, account: null, date: '2027-01-02', amount: 50 }, [2027]), []);
  const errs = J.validateEntry({ causale: cos, account: null, date: '2026-01-02', amount: NaN }, [2027]).join(' ');
  ok(/conto economico/.test(errs) && /2026/.test(errs) && /12,50/.test(errs), errs);
});

test('giornale: movimenti provvisori maturati', () => {
  const list = [
    { id: 1, entry_date: '2027-03-10', provisional: true },
    { id: 2, entry_date: '2027-03-05', provisional: true },
    { id: 3, entry_date: '2027-03-01', provisional: false },
    { id: 4, entry_date: '2027-03-11', provisional: true }
  ];
  eq(J.maturedProvisional(list, '2027-03-10').map((e) => e.id), [2, 1], 'solo provvisori con data ≤ oggi, dal più vecchio');
  eq(J.maturedProvisional(list, '2027-02-28'), [], 'nessuno ancora maturato');
});

test('giornale: preferiti', () => {
  const cos = { id: 'COSFIN', kind: 'costo', description: 'Costi via Fineco', credit_account_id: 'fin' };
  const fin = { id: 'PREFIN', kind: 'finanziaria', description: 'Prelievo', debit_account_id: 'por', credit_account_id: 'fin' };
  const voce = { id: 'v', name: 'Voce di costo', type: 'economico', kind: 'costo' };
  const ricavo = { id: 'r', name: 'Voce di ricavo', type: 'economico', kind: 'ricavo' };
  eq(J.validateFavorite({ name: 'Spesa', causale: cos, account: voce, amount: 10 }), [], 'completo');
  eq(J.validateFavorite({ name: 'Spesa', causale: cos, account: null, amount: null }), [], 'senza conto né importo');
  const errs = J.validateFavorite({ name: ' ', causale: cos, account: ricavo, amount: NaN }).join(' ');
  ok(/nome/.test(errs) && /costo/.test(errs) && /12,50/.test(errs), errs);
  ok(J.validateFavorite({ name: 'x', causale: null, account: null, amount: -1 }).length === 2, 'causale mancante e importo negativo');
  eq(J.buildFavorite(' Spesa ', cos, 'v', null, ' '),
     { name: 'Spesa', causale_id: 'COSFIN', economic_account_id: 'v', amount: null, note: null });
  eq(J.buildFavorite('Prelievo', fin, 'v', 50, 'bancomat').economic_account_id, null, 'causale finanziaria senza conto economico');
  eq(J.favoriteName(cos, voce), 'Voce di costo');
  eq(J.favoriteName(fin, null), 'Prelievo');
});

test('giornale: registrazione proposta dal Budget', () => {
  const accounts = [
    { id: 'v', name: 'Voce', type: 'economico', kind: 'costo', standard_causale_id: 'COSCCRED' },
    { id: 'n', name: 'Senza canale', type: 'economico', kind: 'costo', standard_causale_id: null },
    { id: 'p', name: 'Conto', type: 'patrimoniale' }
  ];
  const causali = [{ id: 'COSCCRED', kind: 'costo' }, { id: 'PREFIN', kind: 'finanziaria' }];
  const q = (s) => new URLSearchParams(s);
  const p = J.prefillFromQuery(q('voce=v&importo=10.00'), accounts, causali);
  eq([p.causale.id, p.account.id, p.amount, p.warning], ['COSCCRED', 'v', 10, null], 'voce con canale standard');
  const n = J.prefillFromQuery(q('voce=n&importo=4.5'), accounts, causali);
  ok(n.causale === null && n.account.id === 'n' && /canale standard/.test(n.warning), 'voce senza canale');
  const f = J.prefillFromQuery(q('causale=PREFIN&importo=250'), accounts, causali);
  eq([f.causale.id, f.account, f.amount], ['PREFIN', null, 250], 'causale finanziaria');
  eq(J.prefillFromQuery(q('voce=p'), accounts, causali), null, 'conto non economico');
  eq(J.prefillFromQuery(q('causale=COSCCRED'), accounts, causali), null, 'solo causali finanziarie');
  eq(J.prefillFromQuery(q('voce=v&importo=abc'), accounts, causali).amount, null, 'importo non valido');
});

test('impostazioni: causali proposte per un nuovo conto patrimoniale', () => {
  const accounts = [
    { id: 'fin', name: 'Conto corrente FINECO', type: 'patrimoniale', grp: 'disponibilita', sort_order: 2, active: true },
    { id: 'sat', name: 'Satispay', type: 'patrimoniale', grp: 'disponibilita', sort_order: 5, active: true },
    { id: 'cre', name: 'Altri crediti', type: 'patrimoniale', grp: 'crediti', sort_order: 10, active: true },
    { id: 'deb', name: 'Altri debiti', type: 'patrimoniale', grp: 'debiti', sort_order: 14, active: true },
    { id: 'new', name: 'Conto Arancio', type: 'patrimoniale', grp: 'disponibilita', sort_order: 20, active: true }
  ];
  const causali = [
    { id: 'c1', code: 'COSFIN', description: 'Costi Fineco', kind: 'costo', credit_account_id: 'fin' },
    { id: 'c2', code: 'RICSAT', description: 'Ricavi Satispay', kind: 'ricavo', debit_account_id: 'sat' },
    { id: 'c3', code: 'FINSAT', description: 'Trasferimenti Fineco -> Satispay', kind: 'finanziaria', debit_account_id: 'sat', credit_account_id: 'fin' }
  ];
  const acc = (id) => accounts.find((a) => a.id === id);
  eq(M.accountAbbr(acc('fin'), causali), 'FIN', 'dalla causale di costo');
  eq(M.accountAbbr(acc('sat'), causali), 'SAT', 'dalla causale di ricavo');
  eq(M.accountAbbr(acc('new'), causali), 'ARA', 'dal nome, saltando «Conto»');
  eq(M.accountAbbr(acc('cre'), causali), 'ALT', 'senza parole significative: la prima');

  const p = new Map(M.causaleProposals(acc('new'), 'ARA', accounts, causali).map((x) => [x.key, x]));
  eq([p.get('cos').rec.code, p.get('cos').rec.credit_account_id, p.get('cos').rec.grp], ['COSARA', 'new', 'Costi']);
  eq([p.get('ric').rec.code, p.get('ric').rec.debit_account_id], ['RICARA', 'new']);
  eq([p.get('out:fin').rec.code, p.get('out:fin').rec.debit_account_id, p.get('out:fin').rec.credit_account_id], ['ARAFIN', 'fin', 'new'], 'da Arancio a Fineco');
  eq([p.get('in:sat').rec.code, p.get('in:sat').rec.debit_account_id, p.get('in:sat').rec.credit_account_id], ['SATARA', 'new', 'sat'], 'da Satispay ad Arancio');
  ok(p.get('out:fin').on && p.get('in:fin').on && !p.get('out:sat').on, 'trasferimenti con il conto principale spuntati');
  eq([p.get('icred').rec.code, p.get('icred').rec.debit_account_id, p.get('icred').rec.credit_account_id], ['ICREDARA', 'cre', 'new']);
  eq([p.get('ddeb').rec.debit_account_id, p.get('ddeb').rec.credit_account_id], ['deb', 'new']);
  ok([...p.values()].every((x) => x.existing === null), 'niente esiste ancora');
  ok(!p.has('out:cre') && !p.has('in:deb'), 'Altri crediti e debiti non sono trasferimenti');

  // per Satispay le causali con gli stessi conti esistono già
  const s = new Map(M.causaleProposals(acc('sat'), 'SAT', accounts, causali).map((x) => [x.key, x]));
  eq([s.get('ric').existing, s.get('in:fin').existing, s.get('cos').existing], ['RICSAT', 'FINSAT', null]);
  // un conto di credito: niente spuntato
  ok(M.causaleProposals(acc('cre'), 'CRE', accounts, causali).every((x) => !x.on), 'crediti: niente di base');

  const chosen = [p.get('cos'), p.get('out:fin')];
  eq(M.validateProposals('ARA', chosen, causali), []);
  ok(/sigla/.test(M.validateProposals('A R', chosen, causali).join(' ')), 'sigla non valida');
  const clash = M.causaleProposals(acc('new'), 'FIN', accounts, causali).find((x) => x.key === 'cos');
  ok(/COSFIN è già usato/.test(M.validateProposals('FIN', [clash], causali).join(' ')), 'codice già usato');
});
