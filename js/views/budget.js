// Budget a griglia: 12 mesi (Budget, Progr., Scost.), Var +/- con allineamento, scorciatoie di riga.
// Pensato per il desktop. Le celle si salvano da sole quando escono dal fuoco o con Invio.
import { sb, rows as query } from '../db.js';
import { $, h, say, clearMsg, noYear } from '../ui.js';
import { loadYear, yearList, pickYear, loadProvisional } from '../data.js';
import { computeActual, computeBudget, budgetSummary, suggestAdjustments, spreadTotal } from '../engine/year.js';
import { buildRows, rowTotal, currentMonth, alignmentByMonth, channelName, journalPrefill, alignToActual, provisionalMarks } from '../budget-model.js';
import { loadExpanded, saveExpanded, monthHeader, columnCount, setNum, cellVariance, budgetReached } from '../grid.js';
import { MONTHS, fmtAmount, parseAmount, isoDate } from '../format.js';

// Dove sta, nei dati caricati, ogni tabella di budget modificabile
const TABLES = {
  budget_accounts:     { list: 'budgetAccounts', key: 'account_id' },
  budget_causali:      { list: 'budgetCausali',  key: 'causale_id' },
  channel_adjustments: { list: 'adjustments',    key: 'causale_id' }
};

let S = null;   // stato della vista aperta

export async function render(root, { session, params }) {
  const years = await yearList();
  if (!years.length) return noYear(root, 'Budget');
  const year = pickYear(years, params[0], +isoDate().slice(0, 4));
  const [data, provisional] = await Promise.all([loadYear(year), loadProvisional(year)]);
  const cur = currentMonth(data.months);

  S = {
    root, session, years, data, cur, provisional,
    confirmed: computeActual(data),
    // Progr. con anche i movimenti provvisori: solo da vedere, Var e controlli restano sul confermato
    withProv: computeActual({ ...data, entries: [...data.entries, ...provisional] }),
    showProv: loadShowProv(),
    suggested: suggestAdjustments(data),   // dipende solo dal Giornale: si calcola una volta
    expanded: loadExpanded(year, cur),
    showZero: false,
    cells: new Map()
  };
  recompute();
  draw();
}

// La scelta "mostra i provvisori" si ricorda nel browser
function loadShowProv() {
  try { return localStorage.getItem('budget.provvisori') === '1'; } catch { return false; }
}
function saveShowProv(on) {
  try { localStorage.setItem('budget.provvisori', on ? '1' : '0'); } catch { /* ignorato */ }
}

function recompute() {
  S.budget = computeBudget(S.data);
  S.summary = budgetSummary(S.data, S.budget);
  S.align = alignmentByMonth(S.suggested, S.budget.adjustments, S.cur);
  S.actual = S.showProv ? S.withProv : S.confirmed;
  S.rows = buildRows(S.data, { actual: S.actual, budget: S.budget },
                     { showZero: S.showZero, alignCounts: S.align.counts });
  // celle Progr. che cambiano per effetto dei provvisori: in lilla
  S.marks = S.showProv
    ? provisionalMarks(S.rows, buildRows(S.data, { actual: S.confirmed, budget: S.budget }, { showZero: true }))
    : new Map();
}

function refresh() {
  recompute();
  update();
}

// ---------------------------------------------------------------------
// Mesi esplosi: il corrente di base, gli altri a richiesta (vedi grid.js)
// ---------------------------------------------------------------------

function toggleMonth(m) {
  if (S.expanded.has(m)) S.expanded.delete(m);
  else S.expanded.add(m);
  saveExpanded(S.data.year, S.expanded);
  draw();
}

// ---------------------------------------------------------------------
// Disegno
// ---------------------------------------------------------------------

function draw() {
  const wrap = S.root.querySelector('.grid-wrap');
  const scroll = wrap ? [wrap.scrollLeft, wrap.scrollTop] : null;
  const closed = new Set(S.data.months.filter((m) => m.closed).map((m) => m.month - 1));
  const ncols = columnCount(S.expanded);
  S.cells = new Map();
  S.status = h('ul', { class: 'checks', role: 'status' });

  const table = h('table', { class: 'grid edit' },
    monthHeader({ expanded: S.expanded, cur: S.cur, closed, onToggle: toggleMonth }),
    h('tbody', null, S.rows.map((row) => rowEl(row, ncols))));

  const showZero = h('input', { type: 'checkbox', checked: S.showZero });
  showZero.addEventListener('change', () => { S.showZero = showZero.checked; recompute(); draw(); });
  const prov = h('input', { type: 'checkbox', checked: S.showProv });
  prov.addEventListener('change', () => { S.showProv = prov.checked; saveShowProv(prov.checked); recompute(); draw(); });

  S.root.replaceChildren(h('div', { class: 'budget' },
    h('div', { class: 'budget-head' },
      h('h1', null, 'Budget ' + S.data.year),
      S.years.length > 1 && h('nav', { class: 'tabs', 'aria-label': 'Anni' },
        S.years.map((y) => h('a', { href: '#/budget/' + y, 'aria-current': y === S.data.year ? 'page' : null }, y))),
      h('div', { class: 'head-checks' },
        h('label', { class: 'check' }, showZero, ' Mostra anche le righe a zero'),
        h('label', { class: 'check' }, prov, ` Mostra i movimenti provvisori (${S.provisional.length})`))),
    S.status,
    S.showProv && h('p', { class: 'hint prov-hint' }, 'Il Progr. in lilla comprende movimenti provvisori: è una previsione, non entra in Var, controlli, Dashboard e Chiusure.'),
    h('p', { class: 'hint' }, 'Clicca un mese per esploderlo. Scrivi nelle celle per cambiare il budget: si salva da solo, Invio passa alla riga sotto. Con ⋯ copi un importo su tutti i mesi o dividi il totale annuo.'),
    h('div', { class: 'grid-wrap' }, table)));

  update();
  if (scroll) [S.root.querySelector('.grid-wrap').scrollLeft, S.root.querySelector('.grid-wrap').scrollTop] = scroll;
}

function rowEl(row, ncols) {
  if (row.type === 'head' || row.type === 'sub') {
    return h('tr', { class: row.type }, h('th', { colspan: ncols, scope: 'colgroup' }, h('span', null, row.label)));
  }
  const reg = { budget: [], actual: [], scost: [], total: [], sync: [], add: [] };
  const cells = [labelCell(row)];
  // righe con budget manuale, nei mesi esplosi: "←" accanto al budget lo porta al consuntivo,
  // "+" accanto allo scostamento apre il Giornale con la registrazione già compilata
  const manual = row.edit && row.type === 'line';
  for (let m = 0; m < 12; m++) {
    const open = S.expanded.has(m);
    if (row.edit) {
      // il placeholder di uno spazio serve al CSS per colorare di grigio le celle vuote
      const input = h('input', { class: 'cell', inputmode: 'decimal', autocomplete: 'off', 'data-m': m, placeholder: ' ',
                                 'aria-label': row.label + (row.code ? ' ' + row.code : '') + ', ' + MONTHS[m] });
      input.addEventListener('focus', () => input.select());
      input.addEventListener('change', () => commit(row, m, input));
      input.addEventListener('keydown', (ev) => onKey(ev, input, row, m));
      reg.budget[m] = input;
      if (manual && open) {
        reg.sync[m] = h('button', { type: 'button', class: 'sync off', tabindex: '-1', 'aria-hidden': 'true',
                                    onclick: () => alignCell(row, m) }, '←');
      }
      cells.push(h('td', { class: 'num mstart' }, input, reg.sync[m]));
    } else {
      reg.budget[m] = h('td', { class: 'num mstart' + (row.rule ? ' calc' : '') });
      cells.push(reg.budget[m]);
    }
    if (open) {
      reg.actual[m] = h('td', { class: 'num a' });
      if (manual) reg.add[m] = h('a', { class: 'add', hidden: true }, '+');
      reg.scost[m] = manual
        ? h('td', { class: 'num s' }, h('span', { class: 'v' }), reg.add[m])
        : h('td', { class: 'num s' });
      cells.push(reg.actual[m], reg.scost[m]);
    }
  }
  reg.total = [h('td', { class: 'num mstart tot' }), h('td', { class: 'num a tot' }), h('td', { class: 'num s tot' })];
  cells.push(...reg.total);
  S.cells.set(row.key, reg);
  return h('tr', { class: row.type + (row.inactive ? ' inactive' : '') }, cells);
}

function labelCell(row) {
  return h('th', { scope: 'row', class: 'label' },
    // le voci calcolate spiegano la regola passando sopra al nome
    h('span', { class: 'name' + (row.calc ? ' calc-name' : ''), title: row.calc || null }, row.label),
    row.contingency && h('span', { class: 'badge' }, 'imprevisti'),
    row.noChannel && h('span', { class: 'badge warn-badge', title: 'Senza canale standard il budget di questa voce non muove nessun conto: impostalo nelle Impostazioni.' }, 'senza canale'),
    row.edit && row.type === 'line' && h('button', { type: 'button', class: 'row-menu',
      'aria-label': 'Compila i mesi di ' + row.label, title: 'Copia su tutti i mesi o dividi il totale annuo',
      onclick: () => openFill(row) }, '⋯'));
}

// Scrive i valori nelle celle già disegnate (dopo ogni modifica non si ridisegna la tabella)
function update() {
  for (const row of S.rows) {
    const reg = S.cells.get(row.key);
    if (!reg) continue;
    for (let m = 0; m < 12; m++) {
      const b = row.budget?.[m] ?? 0;
      const cell = reg.budget[m];
      if (row.type === 'count') fillCount(cell, m, b);
      else if (cell.tagName === 'INPUT') {
        // uno zero scritto a mano su una calcolata si vede (0,00), altrimenti la cella sembrerebbe vuota
        const shown = b || (row.rule && row.manual?.[m]) ? fmtAmount(b) : '';
        if (document.activeElement !== cell && cell.getAttribute('aria-invalid') !== 'true') cell.value = shown;
        cell.classList.toggle('reached', budgetReached(row, b, row.actual?.[m] ?? null));
        // causale calcolata: azzurra dove vale il calcolato, gialla dove il valore è scritto a mano
        cell.classList.toggle('calc', Boolean(row.rule && !row.manual?.[m]));
        cell.title = row.rule ? (row.manual?.[m] ? 'Scritto a mano: svuota la cella per tornare al calcolato' : 'Calcolato: scrivi un importo per sostituirlo') : '';
      } else setNum(cell, b, row);
      if (reg.actual[m]) {
        const a = row.actual?.[m];
        setNum(reg.actual[m], a ?? null, row);
        const prov = Boolean(S.marks.get(row.key)?.[m]);
        reg.actual[m].classList.toggle('prov', prov);
        const sync = reg.sync[m];
        if (sync) {
          // con i provvisori nel Progr. il budget non si allinea: il dato non è ancora confermato
          const x = prov ? null : alignToActual(row, m + 1, S.cur);
          // invisibile ma con il suo spazio (classe off): le celle gialle restano allineate
          sync.classList.toggle('off', !x);
          sync.tabIndex = x ? 0 : -1;
          if (x) sync.removeAttribute('aria-hidden'); else sync.setAttribute('aria-hidden', 'true');
          if (x) {
            const label = `Porta il budget di ${row.label}, ${MONTHS[m]}, da ${fmtAmount(x.from)} a ${fmtAmount(x.to)} (il consuntivo)`;
            sync.title = label;
            sync.setAttribute('aria-label', label);
          }
        }
        const add = reg.add[m];
        if (add) {
          const p = journalPrefill(row, S.data.year, m + 1);
          add.hidden = !p;
          if (p) {
            const label = `Registra nel Giornale ${row.label}, ${MONTHS[m]}: mancano ${fmtAmount(p.amount)} €`;
            add.href = p.href;
            add.title = label;
            add.setAttribute('aria-label', label);
          }
        }
        setNum(reg.scost[m], cellVariance(row, b, a ?? null), row, { scost: true });
      }
    }
    if (row.type === 'count') {
      setText(reg.total[0], rowTotal(row, row.budget) ? String(rowTotal(row, row.budget)) : '');
      continue;
    }
    const tb = rowTotal(row, row.budget);
    const ta = rowTotal(row, row.actual);
    setNum(reg.total[0], tb, row);
    setNum(reg.total[1], ta, row);
    reg.total[1].classList.toggle('prov', Boolean(S.marks.get(row.key)?.[12]));
    setNum(reg.total[2], cellVariance(row, tb, ta), row, { scost: true });
  }
  updateStatus();
}

function setText(el, text) { if (el.textContent !== text) el.textContent = text; }

// Contatore delle Var da allineare, con il pulsante per applicare il suggerimento
function fillCount(td, m, n) {
  const key = m + 1 > S.cur ? 'future' : n ? 'todo:' + n : 'ok';
  if (td.dataset.state === key) return;
  td.dataset.state = key;
  td.replaceChildren(
    key === 'future' ? '' :
    n ? h('button', { type: 'button', class: 'align', onclick: () => openAlign(m + 1),
                      'aria-label': `${n} Var da allineare in ${MONTHS[m]}: rivedi e applica il suggerimento` }, n + ' · allinea')
      : h('span', { class: 'ok-mark', title: 'Var allineate' }, '✓'));
}

function updateStatus() {
  const items = [];
  const todo = S.align.items.length;
  const months = (s) => s.map((v, m) => (v !== 0 ? MONTHS[m] : null)).filter(Boolean).join(', ');
  items.push(todo
    ? h('li', { class: 'warn' }, `${todo} Var da allineare (${months(S.align.counts)}): usa «allinea» nella riga Var da allineare.`)
    : h('li', { class: 'ok' }, 'Var allineate con gli Alert del Giornale.'));
  items.push(S.budget.varCheck.some((v) => v !== 0)
    ? h('li', { class: 'warn' }, `Verifica Variazioni: le Var non fanno 0 in ${months(S.budget.varCheck)}. Ogni importo spostato va tolto da un altro canale; per uno storno va aggiunto anche al canale standard della voce.`)
    : h('li', { class: 'ok' }, 'Verifica Variazioni: 0.'));
  items.push(S.budget.quadratura.some((v) => v !== 0)
    ? h('li', { class: 'warn' }, `Quadratura del budget diversa da 0 in ${months(S.budget.quadratura)}.`)
    : h('li', { class: 'ok' }, 'Quadratura del budget: 0.'));
  if (!S.summary.targetRaggiungibile) {
    items.push(h('li', { class: 'warn' },
      `Target non raggiungibile con questo budget: mancano ${fmtAmount(-S.summary.spendibile)} €, gli imprevisti sono negativi.`));
  }
  if (S.budget.unassigned.length) {
    items.push(h('li', { class: 'warn' }, 'Voci con budget ma senza canale standard: ',
      S.budget.unassigned.map((a) => a.name).join(', '), '. ', h('a', { href: '#/impostazioni/economici' }, 'Impostale'), '.'));
  }
  S.status.replaceChildren(...items);
}

// ---------------------------------------------------------------------
// Modifica e salvataggio
// ---------------------------------------------------------------------

// Valore salvato per una cella: null se non c'è riga (per le causali calcolate: vale il calcolato)
function localRaw(edit, m) {
  const t = TABLES[edit.table];
  const r = S.data[t.list].find((x) => x.month === m + 1 && x[t.key] === edit.id);
  return r ? Number(r.amount) : null;
}
const localValue = (edit, m) => localRaw(edit, m) ?? 0;
// amount null: si elimina la riga (una causale calcolata torna al valore calcolato)
function setLocal(edit, m, amount) {
  const t = TABLES[edit.table];
  const list = S.data[t.list];
  const i = list.findIndex((x) => x.month === m + 1 && x[t.key] === edit.id);
  if (amount === null) { if (i >= 0) list.splice(i, 1); }
  else if (i >= 0) list[i].amount = amount;
  else list.push({ month: m + 1, [t.key]: edit.id, amount });
}

// Salva un gruppo di modifiche [{ edit, m, amount }]: prima nei dati locali (la griglia si
// aggiorna subito), poi su Supabase. Se il salvataggio fallisce, i valori tornano come prima.
async function apply(changes, inputs = []) {
  if (!changes.length) return true;
  const before = changes.map((c) => localRaw(c.edit, c.m));
  changes.forEach((c) => setLocal(c.edit, c.m, c.amount));
  refresh();
  inputs.forEach((i) => i.classList.add('saving'));
  try {
    const byTable = new Map();
    for (const c of changes) {
      const t = TABLES[c.edit.table];
      // amount null: si elimina la riga (causale calcolata che torna al calcolato)
      if (c.amount === null) {
        await query(sb.from(c.edit.table).delete().eq('year', S.data.year).eq('month', c.m + 1).eq(t.key, c.edit.id));
        continue;
      }
      if (!byTable.has(c.edit.table)) byTable.set(c.edit.table, []);
      byTable.get(c.edit.table).push({ user_id: S.session.user.id, year: S.data.year, month: c.m + 1,
                                       [t.key]: c.edit.id, amount: c.amount });
    }
    for (const [table, list] of byTable) {
      await query(sb.from(table).upsert(list, { onConflict: 'user_id,year,month,' + TABLES[table].key }));
    }
    return true;
  } catch (e) {
    changes.forEach((c, i) => setLocal(c.edit, c.m, before[i]));
    refresh();
    say('Budget non salvato: ' + e.message + '. Ho rimesso i valori di prima: riprova.', true);
    return false;
  } finally {
    inputs.forEach((i) => i.classList.remove('saving'));
  }
}

// "=": il budget del mese prende il valore del consuntivo, con "Annulla" nel messaggio
async function alignCell(row, m) {
  const x = alignToActual(row, m + 1, S.cur);
  if (!x) return;
  const where = `«${row.label}», ${MONTHS[m]}`;
  const prev = localRaw(row.edit, m);   // per Annulla: null = era il valore calcolato
  if (!await apply([{ edit: row.edit, m, amount: x.to }])) return;
  say(`Budget di ${where}: da ${fmtAmount(x.from)} a ${fmtAmount(x.to)}. `);
  const undo = h('button', { type: 'button', class: 'link' }, 'Annulla');
  undo.addEventListener('click', async () => {
    undo.disabled = true;
    if (await apply([{ edit: row.edit, m, amount: row.rule ? prev : x.from }])) say(`Budget di ${where} riportato a ${fmtAmount(x.from)}.`);
  });
  $('msg').append(undo);
}

function commit(row, m, input) {
  const text = input.value.trim();
  // causale calcolata: cella vuota = di nuovo il valore calcolato
  const amount = text === '' ? (row.rule ? null : 0) : parseAmount(text);
  if (Number.isNaN(amount)) {
    input.setAttribute('aria-invalid', 'true');
    say(`Importo non valido in «${row.label}», ${MONTHS[m]}: scrivilo come 12,50.`, true);
    return;
  }
  input.removeAttribute('aria-invalid');
  input.value = amount ? fmtAmount(amount) : '';
  if (amount === (row.rule ? localRaw(row.edit, m) : localValue(row.edit, m))) {
    if (amount === null) update();   // ricompare il valore calcolato
    return;
  }
  clearMsg();
  apply([{ edit: row.edit, m, amount }], [input]);
}

// Invio / Maiusc+Invio: riga sotto / sopra nello stesso mese. Esc: annulla la modifica.
function onKey(ev, input, row, m) {
  if (ev.key === 'Escape') {
    const v = row.budget?.[m] ?? 0;   // il valore mostrato (scritto o calcolato)
    input.value = v ? fmtAmount(v) : '';
    input.removeAttribute('aria-invalid');
    input.select();
    return;
  }
  if (ev.key !== 'Enter') return;
  ev.preventDefault();
  const column = [...S.root.querySelectorAll(`input.cell[data-m="${m}"]`)];
  const next = column[column.indexOf(input) + (ev.shiftKey ? -1 : 1)];
  if (next) next.focus();
  else input.blur();
}

// ---------------------------------------------------------------------
// Dialoghi: scorciatoie di riga e allineamento delle Var
// ---------------------------------------------------------------------

function sheet(title, ...content) {
  const dlg = h('dialog', { class: 'sheet' }, h('h2', null, title), ...content);
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

function openFill(row) {
  const closed = new Set(S.data.months.filter((x) => x.closed).map((x) => x.month - 1));
  const current = row.budget;
  const amount = h('input', { id: 'fill-amount', inputmode: 'decimal', autocomplete: 'off',
                              value: fmtAmount(current[S.cur - 1] || current.find((v) => v) || 0) });
  const total = h('input', { id: 'fill-total', inputmode: 'decimal', autocomplete: 'off',
                             value: fmtAmount(rowTotal(row, current)) });
  const keep = h('input', { type: 'checkbox', checked: true });
  const error = h('p', { class: 'form-error', role: 'alert', hidden: true });

  function run(build, what) {
    const locked = closed.size && keep.checked ? closed : new Set();
    const values = build(locked);
    if (!values) return;
    const changes = values.map((v, m) => ({ edit: row.edit, m, amount: v })).filter((c) => c.amount !== current[c.m]);
    dlg.close();
    apply(changes).then((ok) => ok && say(`«${row.label}»: ${what}.`));
  }
  const parsed = (input) => {
    const v = parseAmount(input.value);
    if (Number.isNaN(v)) { error.textContent = 'Scrivi l\'importo come 12,50.'; error.hidden = false; return null; }
    return v;
  };

  const dlg = sheet('Compila «' + row.label + '»',
    h('div', { class: 'field' }, h('label', { for: 'fill-amount' }, 'Importo mensile'),
      h('div', { class: 'row' }, amount,
        h('button', { type: 'button', onclick: () => run((locked) => {
          const v = parsed(amount);
          return v == null ? null : current.map((x, m) => (locked.has(m) ? x : v));
        }, 'importo copiato su tutti i mesi') }, 'Copia su tutti i mesi'))),
    h('div', { class: 'field' }, h('label', { for: 'fill-total' }, 'Totale annuo'),
      h('div', { class: 'row' }, total,
        h('button', { type: 'button', onclick: () => run((locked) => {
          const v = parsed(total);
          return v == null ? null : spreadTotal(current, v, locked);
        }, 'totale annuo diviso sui mesi') }, 'Dividi il totale annuo')),
      h('p', { class: 'hint' }, 'Il resto dell\'arrotondamento va sull\'ultimo mese.')),
    closed.size > 0 && h('label', { class: 'check' }, keep, ` Lascia invariati i mesi chiusi (${closed.size})`),
    error,
    h('div', { class: 'actions' }, h('button', { type: 'button', class: 'quiet', onclick: () => dlg.close() }, 'Annulla')));
}

function openAlign(month) {
  const items = S.align.items.filter((x) => x.month === month);
  const causale = (id) => S.data.causali.find((c) => c.id === id);
  const inputs = items.map((x) => h('input', { class: 'amount', inputmode: 'decimal', autocomplete: 'off',
                                               value: fmtAmount(x.suggested),
                                               'aria-label': 'Var di ' + (causale(x.causale_id)?.code ?? '') }));
  const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const save = h('button', { type: 'button' }, 'Salva Var');

  const dlg = sheet('Allinea le Var di ' + MONTHS[month - 1],
    h('p', null, 'Le registrazioni fuori canale del mese spostano il budget dal canale standard a quello usato. ' +
                 'Gli importi proposti vengono dagli Alert del Giornale: correggili se serve, poi salva.'),
    h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
      h('thead', null, h('tr', null, h('th', null, 'Canale'), h('th', { class: 'num' }, 'Var attuale'), h('th', { class: 'num' }, 'Var da salvare'))),
      h('tbody', null, items.map((x, i) => {
        const c = causale(x.causale_id);
        return h('tr', null,
          h('td', null, c ? channelName(c, S.data.accounts) : x.causale_id, ' ', c && h('code', null, c.code)),
          h('td', { class: 'num' }, fmtAmount(x.saved)),
          h('td', { class: 'num' }, inputs[i]));
      })))),
    error,
    h('div', { class: 'actions' }, save, h('button', { type: 'button', class: 'quiet', onclick: () => dlg.close() }, 'Annulla')));

  save.addEventListener('click', () => {
    const values = inputs.map((i) => parseAmount(i.value.trim() === '' ? '0' : i.value));
    const bad = values.findIndex((v) => Number.isNaN(v));
    if (bad >= 0) {
      error.textContent = 'Importo non valido nella riga ' + (bad + 1) + ': scrivilo come 12,50.';
      error.hidden = false;
      return;
    }
    const changes = items.map((x, i) => ({ edit: { table: 'channel_adjustments', id: x.causale_id }, m: month - 1, amount: values[i] }));
    dlg.close();
    apply(changes).then((ok) => ok && say('Var di ' + MONTHS[month - 1] + ' salvate.'));
  });
}
