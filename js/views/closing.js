// Chiusure: riconciliazione con il saldo reale di banca, chiusura del mese e dell'anno,
// passaggio dei saldi finali all'anno dopo.
import { sb, rows } from '../db.js';
import { h, say, busy, confirmBox, noYear } from '../ui.js';
import { loadYear, yearList, pickYear } from '../data.js';
import { computeActual, computeBudget, suggestAdjustments } from '../engine/year.js';
import { currentMonth, alignmentByMonth } from '../budget-model.js';
import { reconciliationRows, monthChecks, yearClosable, nextYearOpenings, alignMonthRows } from '../closing-model.js';
import { MONTHS, fmtAmount, parseAmount, isoDate, round2 } from '../format.js';

const SHORT = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
let S = null;

export async function render(root, { session, params }) {
  const years = await yearList();
  if (!years.length) return noYear(root, 'Chiusure');
  const year = pickYear(years, params[0], +isoDate().slice(0, 4));
  const data = await loadYear(year);
  const next = await loadNextYear(year + 1, years);
  const cur = currentMonth(data.months);
  const month = +params[1] >= 1 && +params[1] <= 12 ? +params[1] : cur;
  S = { root, session, years, data, next, month };
  compute();
  draw();
}

async function loadNextYear(year, years) {
  if (!years.includes(year)) return null;
  const [y, openings] = await Promise.all([
    rows(sb.from('years').select('year, status').eq('year', year).maybeSingle()),
    rows(sb.from('opening_balances').select('account_id, amount').eq('year', year))
  ]);
  return { year, status: y.status, openings: Object.fromEntries(openings.map((o) => [o.account_id, Number(o.amount)])) };
}

function compute() {
  const { data } = S;
  S.result = { actual: computeActual(data), budget: computeBudget(data) };
  S.cur = currentMonth(data.months);
  S.align = alignmentByMonth(suggestAdjustments(data), S.result.budget.adjustments, 12);
}

const monthRow = (m) => S.data.months.find((x) => x.month === m);
const href = (year, month) => `#/chiusure/${year}/${month}`;

function draw() {
  const { data, month } = S;
  S.root.replaceChildren(h('div', { class: 'dash' },
    h('div', { class: 'budget-head' },
      h('h1', null, 'Chiusure ' + data.year),
      S.years.length > 1 && h('nav', { class: 'tabs', 'aria-label': 'Anni' },
        S.years.map((y) => h('a', { href: href(y, month), 'aria-current': y === data.year ? 'page' : null }, y)))),
    h('nav', { class: 'month-strip', 'aria-label': 'Mesi' },
      SHORT.map((label, i) => {
        const m = i + 1;
        const closed = monthRow(m)?.closed;
        return h('a', { href: href(data.year, m), 'aria-current': m === month ? 'page' : null,
                        class: closed ? 'closed' : m === S.cur ? 'current' : null,
                        title: closed ? 'chiuso' : m === S.cur ? 'mese corrente' : 'aperto' },
          label, closed ? ' ✓' : '');
      })),
    h('div', { class: 'dash-cols' },
      h('section', { class: 'card', 'aria-labelledby': 'close-title' }, closeCard()),
      h('section', { class: 'card', 'aria-labelledby': 'year-title' }, yearCard())),
    h('section', { class: 'card', 'aria-labelledby': 'rec-title' }, reconciliationCard())));
}

// ---------------------------------------------------------------------
// Riconciliazione
// ---------------------------------------------------------------------

function reconciliationCard() {
  const { data, month, result } = S;
  const list = reconciliationRows(data, result.actual, month);
  let group = null;
  const body = [];
  for (const r of list) {
    if (r.group !== group) {
      group = r.group;
      body.push(h('tr', { class: 'group-row' }, h('th', { colspan: 5, scope: 'colgroup' }, group)));
    }
    body.push(recRow(r));
  }
  return [
    h('h2', { id: 'rec-title' }, 'Riconciliazione di ' + MONTHS[month - 1]),
    h('p', { class: 'hint' }, 'Scrivi il saldo reale a fine mese (estratto conto, app della banca, contanti contati): ' +
      'lo confronto con il saldo calcolato dalle registrazioni. Lascia vuoto per i conti che non controlli.'),
    h('div', { class: 'table-wrap' }, h('table', { class: 'list rec' },
      h('thead', null, h('tr', null,
        h('th', { scope: 'col' }, 'Conto'), h('th', { scope: 'col', class: 'num' }, 'Calcolato'),
        h('th', { scope: 'col', class: 'num' }, 'Saldo reale'), h('th', { scope: 'col', class: 'num' }, 'Differenza'),
        h('th', { scope: 'col' }, 'Nota'))),
      h('tbody', null, body)))
  ];
}

function recRow(r) {
  const real = h('input', { class: 'amount', inputmode: 'decimal', autocomplete: 'off',
                            value: r.real == null ? '' : fmtAmount(r.real), 'aria-label': 'Saldo reale ' + r.account.name });
  const note = h('input', { class: 'note', autocomplete: 'off', value: r.note, 'aria-label': 'Nota ' + r.account.name });
  const diff = h('td', { class: 'num' });
  const show = (row) => {
    diff.className = 'num ' + row.status;
    diff.textContent = row.status === 'missing' ? '–' : row.status === 'ok' ? '✓ coincide' : '✗ ' + fmtAmount(row.diff);
  };
  show(r);
  const save = () => saveReconciliation(r.account, real, note).then((row) => row && show(row));
  real.addEventListener('change', save);
  note.addEventListener('change', save);
  return h('tr', null,
    h('th', { scope: 'row' }, r.account.name),
    h('td', { class: 'num' + (r.calculated < 0 ? ' neg' : '') }, fmtAmount(r.calculated)),
    h('td', { class: 'num' }, real), diff, h('td', null, note));
}

// Salva (o cancella, se il saldo è vuoto) il saldo reale di un conto per il mese scelto
async function saveReconciliation(account, realInput, noteInput) {
  const { data, month } = S;
  const text = realInput.value.trim();
  const value = text === '' ? null : parseAmount(text);
  if (Number.isNaN(value)) {
    realInput.setAttribute('aria-invalid', 'true');
    say(`Saldo reale non valido per «${account.name}»: scrivilo come 1.234,56 (con il meno se negativo).`, true);
    return null;
  }
  realInput.removeAttribute('aria-invalid');
  const key = { year: data.year, month, account_id: account.id };
  try {
    if (value == null) {
      await rows(sb.from('reconciliations').delete().match(key));
    } else {
      await rows(sb.from('reconciliations').upsert({ user_id: S.session.user.id, ...key, actual_balance: value,
        note: noteInput.value.trim() || null }, { onConflict: 'user_id,year,month,account_id' }));
      realInput.value = fmtAmount(value);
    }
  } catch (e) {
    say('Saldo reale non salvato: ' + e.message + '. Riprova.', true);
    return null;
  }
  data.reconciliations = data.reconciliations.filter((r) => !(r.month === month && r.account_id === account.id));
  if (value != null) data.reconciliations.push({ month, account_id: account.id, actual_balance: value, note: noteInput.value.trim() });
  // aggiorna i controlli della chiusura senza ridisegnare la tabella (dove si sta scrivendo)
  S.root.querySelector('[aria-labelledby="close-title"]').replaceChildren(...closeCard());
  return reconciliationRows(data, S.result.actual, month).find((r) => r.account.id === account.id);
}

// ---------------------------------------------------------------------
// Chiusura del mese
// ---------------------------------------------------------------------

function closeCard() {
  const { data, month, result } = S;
  const row = monthRow(month);
  const closed = Boolean(row?.closed);
  const c = monthChecks(data, result, month, S.align.items);
  const contingency = data.accounts.find((a) => a.is_contingency);
  const imprevisti = contingency ? result.budget.econ.get(contingency.id)[month - 1] : 0;
  const name = MONTHS[month - 1];
  const money = (v) => fmtAmount(v);

  const item = (ok, title, ...detail) => h('li', { class: ok ? 'ok' : 'warn' },
    h('span', { class: 'mark', 'aria-hidden': 'true' }, ok ? '✓' : '!'), h('div', null, h('strong', null, title), ...detail));

  const diffs = c.budgetDiffs.length
    ? h('details', null, h('summary', null, 'Vedi le voci'),
        h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
          h('thead', null, h('tr', null, h('th', null, 'Voce'), h('th', { class: 'num' }, 'Budget'),
            h('th', { class: 'num' }, 'Consuntivo'), h('th', { class: 'num' }, 'Differenza'))),
          h('tbody', null, c.budgetDiffs.map((d) => h('tr', null,
            h('td', null, d.label, d.code && h('code', null, d.code), d.calculated && h('span', { class: 'badge' }, 'calcolato')),
            h('td', { class: 'num' }, money(d.budget)), h('td', { class: 'num' }, money(d.actual)),
            h('td', { class: 'num' }, (d.diff > 0 ? '+' : '') + money(d.diff))))))))
    : null;

  const manual = c.budgetDiffs.filter((d) => d.edit);
  const alignBtn = h('button', { type: 'button', class: 'quiet small' }, 'Allinea il budget al consuntivo');
  alignBtn.addEventListener('click', () => alignMonth(alignBtn, manual));

  const button = h('button', { type: 'button', class: closed ? 'quiet' : null }, closed ? 'Riapri mese' : 'Chiudi mese');
  button.addEventListener('click', () => toggleMonth(button, !closed, c, imprevisti));

  return [
    h('h2', { id: 'close-title' }, 'Chiusura di ' + name),
    h('p', { class: 'lede-small' }, closed
      ? `Mese chiuso${row.closed_at ? ' il ' + new Date(row.closed_at).toLocaleDateString('it-IT') : ''}. Si può riaprire.`
      : 'Mese aperto. Prima di chiuderlo allinea il budget del mese al consuntivo: l\'app non lo riscrive.'),
    h('ul', { class: 'checklist' },
      item(!c.budgetDiffs.length, c.budgetDiffs.length
        ? `${c.budgetDiffs.length} voci con budget diverso dal consuntivo`
        : 'Budget allineato al consuntivo',
        c.budgetDiffs.length > 0 && h('p', { class: 'hint' }, 'Le causali calcolate si allineano da sole quando lo sono voci, canali e Var. ',
          h('a', { href: '#/budget/' + data.year }, 'Apri il Budget')),
        manual.length > 0 && h('div', { class: 'actions tight' }, alignBtn), diffs),
      item(!c.varToAlign.length, c.varToAlign.length ? `${c.varToAlign.length} Var da allineare` : 'Var allineate con gli Alert',
        c.varToAlign.length > 0 && h('p', { class: 'hint' }, h('a', { href: '#/budget/' + data.year }, 'Allineale nel Budget'))),
      item(c.quadratura === 0, c.quadratura === 0 ? 'Quadratura del consuntivo a 0' : 'Quadratura del consuntivo: ' + money(c.quadratura)),
      item(!c.mismatched.length && c.reconciled > 0,
        c.reconciled === 0 ? 'Nessun saldo reale inserito'
          : `${c.reconciled} conti su ${c.accounts} con saldo reale` + (c.mismatched.length ? `, ${c.mismatched.length} non coincidono` : ', tutti coincidono'),
        c.mismatched.length > 0 && h('p', { class: 'hint' }, c.mismatched.map((r) => `${r.account.name}: ${money(r.diff)}`).join(' · '))),
      !closed && contingency && h('li', { class: 'info' }, h('span', { class: 'mark', 'aria-hidden': 'true' }, 'i'),
        h('div', null, `Alla chiusura gli imprevisti di ${name} (${money(imprevisti)} €) vanno a 0 e il residuo si ridivide sui mesi ancora aperti.`))),
    h('div', { class: 'actions' }, button)
  ];
}

// Tutte le voci manuali del mese prendono come budget il consuntivo. Le causali calcolate
// si sistemano da sole; la differenza tra ricavi e costi passa agli imprevisti dei mesi aperti.
async function alignMonth(button, diffs) {
  const { data, month } = S;
  const name = MONTHS[month - 1];
  const sign = (v) => (v > 0 ? '+' : '') + fmtAmount(v);
  const toContingency = round2(diffs.reduce((t, d) => t + (d.kind === 'ricavo' ? d.diff : d.kind === 'costo' ? -d.diff : 0), 0));
  const shown = diffs.slice(0, 10).map((d) => `${d.label}: ${fmtAmount(d.budget)} → ${fmtAmount(d.actual)}`);
  const ok = await confirmBox({ title: `Allineare il budget di ${name} al consuntivo?`,
    lines: [`${diffs.length} voci prenderanno come budget il consuntivo del mese:`,
            ...shown, ...(diffs.length > 10 ? [`… e altre ${diffs.length - 10}.`] : []),
            toContingency !== 0 ? `Gli imprevisti dei mesi non chiusi cambiano in tutto di ${sign(toContingency)} €.` : null,
            'Il budget originale non si conserva: per tornare indietro va riscritto a mano.'].filter(Boolean),
    ok: 'Allinea' });
  if (!ok) return;
  busy(button, 'Allineamento del budget', async () => {
    const out = alignMonthRows(diffs, S.session.user.id, data.year, month);
    if (out.budget_accounts.length) {
      await rows(sb.from('budget_accounts').upsert(out.budget_accounts, { onConflict: 'user_id,year,month,account_id' }));
    }
    if (out.budget_causali.length) {
      await rows(sb.from('budget_causali').upsert(out.budget_causali, { onConflict: 'user_id,year,month,causale_id' }));
    }
    S.data = await loadYear(data.year);
    compute();
    draw();
    say(`Budget di ${name} allineato al consuntivo (${diffs.length} voci).`);
  });
}

async function toggleMonth(button, close, checks, imprevisti) {
  const { data, month } = S;
  const name = MONTHS[month - 1];
  if (close) {
    const open = [];
    if (checks.budgetDiffs.length) open.push(`${checks.budgetDiffs.length} voci hanno ancora il budget diverso dal consuntivo.`);
    if (checks.varToAlign.length) open.push(`${checks.varToAlign.length} Var sono da allineare.`);
    if (checks.mismatched.length) open.push(`${checks.mismatched.length} conti non coincidono con il saldo reale.`);
    const ok = await confirmBox({ title: `Chiudere ${name}?`,
      lines: [...open, open.length ? 'Puoi chiudere lo stesso e sistemare dopo: il mese si può riaprire.' : 'Tutti i controlli sono a posto.',
              `Gli imprevisti di ${name} (${fmtAmount(imprevisti)} €) andranno a 0.`],
      ok: 'Chiudi mese' });
    if (!ok) return;
  } else {
    const ok = await confirmBox({ title: `Riaprire ${name}?`,
      lines: ['Il mese tornerà tra quelli aperti e riceverà di nuovo la sua quota di imprevisti.'], ok: 'Riapri mese' });
    if (!ok) return;
  }
  busy(button, close ? 'Chiusura del mese' : 'Riapertura del mese', async () => {
    const closedAt = close ? new Date().toISOString() : null;
    await rows(sb.from('months').update({ closed: close, closed_at: closedAt }).eq('year', data.year).eq('month', month));
    const row = monthRow(month);
    row.closed = close;
    row.closed_at = closedAt;
    compute();
    draw();
    say(close ? `${name[0].toUpperCase() + name.slice(1)} chiuso.` : `${name[0].toUpperCase() + name.slice(1)} riaperto.`);
  });
}

// ---------------------------------------------------------------------
// Chiusura dell'anno e anno successivo
// ---------------------------------------------------------------------

function yearCard() {
  const { data, next, result } = S;
  const { closable, open } = yearClosable(data.months);
  const closedYear = data.status === 'chiuso';
  const STATUS = { bozza: 'in bozza', attivo: 'attivo', chiuso: 'chiuso' };
  const out = [
    h('h2', { id: 'year-title' }, 'Chiusura dell\'anno ' + data.year),
    // l'Apertura anno non è nel menu: ci si arriva da qui
    h('p', { class: 'hint' }, `Anno ${STATUS[data.status] ?? data.status}. `,
      h('a', { href: '#/apertura/' + data.year }, `Saldi iniziali del ${data.year}`),
      data.status === 'bozza' ? ': controllali e attiva l\'anno.' : '.')
  ];

  if (closedYear) {
    const reopen = h('button', { type: 'button', class: 'quiet' }, 'Riapri anno');
    reopen.addEventListener('click', () => setYearStatus(reopen, 'attivo'));
    out.push(h('p', null, 'Anno chiuso.'), h('div', { class: 'actions' }, reopen));
  } else {
    const close = h('button', { type: 'button', disabled: !closable }, 'Chiudi anno');
    close.addEventListener('click', () => setYearStatus(close, 'chiuso'));
    out.push(h('p', null, closable ? 'Tutti i mesi sono chiusi: puoi chiudere l\'anno.'
      : `Per chiudere l'anno chiudi prima tutti i mesi. Mancano: ${open.map((m) => MONTHS[m - 1]).join(', ')}.`),
      h('div', { class: 'actions' }, close));
  }

  // anno prima del primo: si può aggiungere, i suoi saldi finali diventano gli iniziali di questo
  if (data.year === Math.min(...S.years)) out.push(...previousYearSection());

  // anno dopo: si crea dai saldi finali; finché è in bozza i suoi saldi iniziali si possono riallineare
  const nextYear = data.year + 1;
  if (!next) {
    const create = h('button', { type: 'button', class: closedYear ? null : 'quiet' }, 'Crea il ' + nextYear);
    create.addEventListener('click', () => busy(create, 'Creazione del ' + nextYear, async () => {
      const { data: msg, error } = await sb.rpc('init_year', { p_year: nextYear });
      if (error) throw error;
      S.years = await yearList();
      S.next = await loadNextYear(nextYear, S.years);
      draw();
      say(msg);
    }));
    out.push(h('h3', null, 'Anno ' + nextYear),
      h('p', { class: 'hint' }, `Il ${nextYear} parte dai saldi finali reali di dicembre ${data.year}.`),
      h('div', { class: 'actions' }, create));
    return out;
  }

  const diffs = nextYearOpenings(data, result.actual, next.openings).filter((r) => r.differs);
  out.push(h('h3', null, h('a', { href: '#/apertura/' + nextYear }, 'Saldi iniziali del ' + nextYear)));
  if (!diffs.length) {
    out.push(h('p', { class: 'ok-line' }, `✓ Coincidono con i saldi finali reali di dicembre ${data.year}.`));
    return out;
  }
  out.push(h('p', null, `${diffs.length} saldi iniziali del ${nextYear} non coincidono con i saldi finali di dicembre ${data.year}.`),
    h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
      h('thead', null, h('tr', null, h('th', null, 'Conto'), h('th', { class: 'num' }, `Finale ${data.year}`),
        h('th', { class: 'num' }, `Iniziale ${nextYear}`))),
      h('tbody', null, diffs.map((r) => h('tr', null, h('td', null, r.account.name),
        h('td', { class: 'num' }, fmtAmount(r.closing)), h('td', { class: 'num' }, r.saved == null ? '–' : fmtAmount(r.saved))))))));
  if (next.status === 'bozza') {
    const update = h('button', { type: 'button' }, `Aggiorna i saldi iniziali del ${nextYear}`);
    update.addEventListener('click', () => updateNextOpenings(update, diffs));
    out.push(h('div', { class: 'actions' }, update));
  } else {
    out.push(h('p', { class: 'hint' }, `Il ${nextYear} non è in bozza, quindi i suoi saldi iniziali sono bloccati. `,
      h('a', { href: '#/apertura/' + nextYear }, 'Riportalo in bozza dall\'Apertura anno'), ' per aggiornarli.'));
  }
  return out;
}

// Crea l'anno precedente al primo: 12 mesi aperti e saldi iniziali a zero, da compilare nell'Apertura.
// Dalle sue Chiusure i saldi finali di dicembre si riportano poi su questo anno.
function previousYearSection() {
  const year = S.data.year;
  const prev = year - 1;
  const create = h('button', { type: 'button', class: 'quiet' }, 'Crea il ' + prev);
  create.addEventListener('click', async () => {
    const ok = await confirmBox({ title: `Creare il ${prev}?`, ok: 'Crea il ' + prev,
      lines: [`Il ${prev} nasce in bozza, con i 12 mesi aperti e i saldi iniziali a zero: li compili nell'Apertura (saldi al 1/1/${prev}).`,
              `I saldi iniziali del ${year} per ora non cambiano. Quando il ${prev} è completo li riallinei dalle Chiusure del ${prev}, con il ${year} in bozza.`] });
    if (!ok) return;
    busy(create, 'Creazione del ' + prev, async () => {
      // si apre l'Apertura del nuovo anno, che spiega cosa fare (il cambio di pagina cancella i messaggi)
      const { error } = await sb.rpc('init_year', { p_year: prev });
      if (error) throw error;
      location.hash = '#/apertura/' + prev;
    });
  });
  return [h('h3', null, 'Anno ' + prev),
    h('p', { class: 'hint' }, `Puoi aggiungere il ${prev}: i suoi saldi finali di dicembre diventeranno gli iniziali del ${year}.`),
    h('div', { class: 'actions' }, create)];
}

async function setYearStatus(button, status) {
  const { data } = S;
  const ok = await confirmBox(status === 'chiuso'
    ? { title: `Chiudere il ${data.year}?`, lines: ['L\'anno resta consultabile e si può riaprire.'], ok: 'Chiudi anno' }
    : { title: `Riaprire il ${data.year}?`, lines: ['L\'anno tornerà attivo.'], ok: 'Riapri anno' });
  if (!ok) return;
  busy(button, status === 'chiuso' ? 'Chiusura dell\'anno' : 'Riapertura dell\'anno', async () => {
    await rows(sb.from('years').update({ status }).eq('year', data.year));
    data.status = status;
    draw();
    say(status === 'chiuso' ? `Anno ${data.year} chiuso.` : `Anno ${data.year} riaperto.`);
  });
}

async function updateNextOpenings(button, diffs) {
  const { next } = S;
  const ok = await confirmBox({ title: `Aggiornare i saldi iniziali del ${next.year}?`,
    lines: [`${diffs.length} saldi prenderanno il valore finale reale di dicembre ${S.data.year}.`], ok: 'Aggiorna' });
  if (!ok) return;
  busy(button, 'Aggiornamento dei saldi iniziali', async () => {
    const list = diffs.map((r) => ({ user_id: S.session.user.id, year: next.year, account_id: r.account.id, amount: r.closing }));
    await rows(sb.from('opening_balances').upsert(list, { onConflict: 'user_id,year,account_id' }));
    for (const r of list) next.openings[r.account_id] = r.amount;
    draw();
    say(`Saldi iniziali del ${next.year} aggiornati.`);
  });
}
