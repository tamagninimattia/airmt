// Giornale: registrazioni del mese con l'Alert di canale. Pensato per il telefono.
import { sb, rows } from '../db.js';
import { h, say, clearMsg, confirmBox } from '../ui.js';
import * as J from '../journal-model.js';
import { sortByOrder, groupBy } from '../settings-model.js';
import { fmtAmount, fmtDay, parseAmount, isoDate, monthLabel } from '../format.js';

const KIND_GROUPS = [
  { kind: 'costo', label: 'Costi' },
  { kind: 'ricavo', label: 'Ricavi' },
  { kind: 'finanziaria', label: 'Finanziarie' }
];

export async function render(root, { params }) {
  const [accounts, causali, years, months] = await Promise.all([
    rows(sb.from('accounts').select('*')),
    rows(sb.from('causali').select('*')),
    rows(sb.from('years').select('year, status').order('year')),
    rows(sb.from('months').select('year, month, closed'))
  ]);
  const today = isoDate();
  const view = J.parseMonthParam(params[0]) ?? J.defaultMonth(years, months, today);
  if (!view) {
    root.replaceChildren(h('div', { class: 'narrow' },
      h('h1', null, 'Giornale'),
      h('p', null, 'Non hai ancora creato nessun anno. ', h('a', { href: '#/avvio' }, 'Crea il primo anno'), '.')));
    return;
  }

  const ctx = {
    root, view, today, years: years.map((y) => y.year),
    accounts, causali,
    account: (id) => accounts.find((a) => a.id === id),
    causale: (id) => causali.find((c) => c.id === id),
    entries: [], list: h('ul', { class: 'entries' }), summary: h('p', { class: 'alert-summary', hidden: true }),
    form: null
  };

  const closed = months.some((m) => m.year === view.year && m.month === view.month && m.closed);
  ctx.form = entryForm(ctx);

  root.replaceChildren(h('div', { class: 'journal' },
    h('h1', null, 'Giornale'),
    h('nav', { class: 'month-nav', 'aria-label': 'Mese' },
      h('a', { href: '#/giornale/' + J.monthParam(J.shiftMonth(view, -1)), 'aria-label': 'Mese precedente' }, '‹'),
      h('span', null, monthLabel(view.year, view.month), closed && h('span', { class: 'badge muted' }, 'chiuso')),
      h('a', { href: '#/giornale/' + J.monthParam(J.shiftMonth(view, 1)), 'aria-label': 'Mese successivo' }, '›')),
    ctx.form.el,
    ctx.summary,
    h('h2', null, 'Registrazioni del mese'),
    ctx.list));

  await loadEntries(ctx);
}

async function loadEntries(ctx) {
  const { from, to } = J.monthBounds(ctx.view.year, ctx.view.month);
  ctx.entries = await rows(sb.from('entries_enriched').select('*')
    .gte('entry_date', from).lt('entry_date', to)
    .order('entry_date', { ascending: false }).order('created_at', { ascending: false }));
  drawList(ctx);
}

function drawList(ctx) {
  const alerts = ctx.entries.filter((e) => e.channel_alert).length;
  ctx.summary.hidden = !alerts;
  ctx.summary.textContent = alerts === 1
    ? '1 registrazione fuori canale questo mese: ricorda le Var +/- nel Budget.'
    : `${alerts} registrazioni fuori canale questo mese: ricorda le Var +/- nel Budget.`;

  if (!ctx.entries.length) {
    ctx.list.replaceChildren(h('li', { class: 'empty' }, 'Nessuna registrazione in questo mese.'));
    return;
  }
  ctx.list.replaceChildren(...ctx.entries.map((e) => {
    const c = ctx.causale(e.causale_id);
    const title = e.economic_account_name || c?.description || e.causale_code;
    const sign = e.causale_kind === 'ricavo' ? '+' : e.causale_kind === 'costo' ? '−' : '';
    return h('li', { class: 'entry ' + e.causale_kind + (e.id === ctx.form.editingId() ? ' editing' : '') },
      h('button', { type: 'button', 'aria-label': 'Modifica ' + title + ' del ' + fmtDay(e.entry_date),
                    onclick: () => ctx.form.edit(e) },
        h('span', { class: 'day' }, fmtDay(e.entry_date)),
        h('span', { class: 'what' },
          h('strong', null, title),
          h('small', null, e.causale_code, e.note && ' · ' + e.note)),
        h('span', { class: 'amt' }, sign + fmtAmount(e.amount)),
        e.channel_alert && h('span', { class: 'badge alert' }, 'Alert')));
  }));
}

// Form di inserimento e modifica. Restituisce { el, edit(entry), editingId() }.
function entryForm(ctx) {
  let editing = null;

  const causaleSel = h('select', { id: 'j-causale', name: 'causale' });
  const fixedInfo = h('p', { class: 'hint fixed' });
  const accountSel = h('select', { id: 'j-account', name: 'account' });
  const accountField = h('div', { class: 'field' }, h('label', { for: 'j-account' }, 'Conto economico'), accountSel);
  const date = h('input', { id: 'j-date', type: 'date', required: true });
  const amount = h('input', { id: 'j-amount', inputmode: 'decimal', autocomplete: 'off', placeholder: '0,00' });
  const note = h('input', { id: 'j-note', autocomplete: 'off' });
  const alertBox = h('p', { class: 'alert-box', role: 'status', hidden: true });
  const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const title = h('h2', null);
  const save = h('button', { type: 'submit' });
  const cancel = h('button', { type: 'button', class: 'quiet', onclick: () => reset(true) }, 'Annulla');
  const del = h('button', { type: 'button', class: 'danger quiet push', onclick: remove }, 'Elimina');

  // nei menu compaiono le voci attive, più quella della registrazione in modifica
  const usable = (x, keepId) => x.active || x.id === keepId;

  function fillCausali(keepId) {
    const list = sortByOrder(ctx.causali.filter((c) => usable(c, keepId)), 'code');
    causaleSel.replaceChildren(h('option', { value: '' }, 'Scegli la causale'),
      ...KIND_GROUPS.map((g) => h('optgroup', { label: g.label },
        list.filter((c) => c.kind === g.kind).map((c) => h('option', { value: c.id }, c.code + ' · ' + c.description)))));
  }

  function fillAccounts(kind, keepId) {
    const current = accountSel.value || keepId || '';
    const list = sortByOrder(ctx.accounts.filter((a) => a.type === 'economico' && a.kind === kind && usable(a, keepId)));
    accountSel.replaceChildren(h('option', { value: '' }, 'Scegli il conto'),
      ...[...groupBy(list, (a) => a.budget_section || 'Senza sezione')].map(([section, items]) =>
        h('optgroup', { label: section }, items.map((a) => h('option', { value: a.id }, a.name)))));
    accountSel.value = list.some((a) => a.id === current) ? current : '';
  }

  // lato fisso della causale, conto economico se serve, Alert
  function sync(keepAccountId) {
    const c = ctx.causale(causaleSel.value);
    const name = (id) => ctx.account(id)?.name ?? '–';
    accountField.hidden = !J.needsEconomic(c);
    if (J.needsEconomic(c)) fillAccounts(c.kind, keepAccountId);
    fixedInfo.textContent = !c ? ''
      : c.kind === 'costo' ? 'Avere: ' + name(c.credit_account_id) + ' · Dare: il conto economico'
      : c.kind === 'ricavo' ? 'Dare: ' + name(c.debit_account_id) + ' · Avere: il conto economico'
      : 'Dare: ' + name(c.debit_account_id) + ' · Avere: ' + name(c.credit_account_id);
    syncAlert();
  }

  function syncAlert() {
    const c = ctx.causale(causaleSel.value);
    const a = ctx.account(accountSel.value);
    const show = J.channelAlert(c, a) && date.value;
    alertBox.hidden = !show;
    if (show) alertBox.textContent = J.alertText(a, ctx.causale(a.standard_causale_id)?.code ?? '?', date.value);
  }

  causaleSel.addEventListener('change', () => sync());
  accountSel.addEventListener('change', syncAlert);
  date.addEventListener('change', syncAlert);

  // keepCausale: dopo un inserimento restano causale e data, per registrare di fila
  function reset(full) {
    const keep = !full && !editing ? { causale: causaleSel.value, date: date.value } : null;
    editing = null;
    fillCausali();
    causaleSel.value = keep?.causale ?? '';
    date.value = keep?.date || J.defaultDate(ctx.view, ctx.today);
    amount.value = '';
    note.value = '';
    accountSel.value = '';
    error.hidden = true;
    title.textContent = 'Nuova registrazione';
    save.textContent = 'Registra';
    cancel.hidden = true;
    del.hidden = true;
    sync();
    if (ctx.entries.length) drawList(ctx);
  }

  function edit(e) {
    editing = e;
    fillCausali(e.causale_id);
    causaleSel.value = e.causale_id;
    accountSel.value = '';
    sync(e.economic_account_id);
    date.value = e.entry_date;
    amount.value = fmtAmount(e.amount);
    note.value = e.note || '';
    error.hidden = true;
    title.textContent = 'Modifica registrazione';
    save.textContent = 'Salva modifiche';
    cancel.hidden = false;
    del.hidden = false;
    syncAlert();
    drawList(ctx);
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    amount.focus({ preventScroll: true });
  }

  async function submit(ev) {
    ev.preventDefault();
    clearMsg();
    error.hidden = true;
    const c = ctx.causale(causaleSel.value);
    const a = J.needsEconomic(c) ? ctx.account(accountSel.value) : null;
    const value = parseAmount(amount.value);
    const errors = J.validateEntry({ causale: c, account: a, date: date.value, amount: value }, ctx.years);
    if (errors.length) {
      error.textContent = errors.join(' ');
      error.hidden = false;
      return;
    }
    const rec = J.buildEntry(c, a?.id ?? null, date.value, value, note.value);
    save.disabled = true;
    try {
      if (editing) await rows(sb.from('entries').update(rec).eq('id', editing.id));
      else await rows(sb.from('entries').insert(rec));
      const elsewhere = !date.value.startsWith(J.monthParam(ctx.view));
      const wasEditing = Boolean(editing);
      reset(false);
      await loadEntries(ctx);
      say((wasEditing ? 'Modifica salvata' : 'Registrazione salvata') +
          (elsewhere ? ' in ' + monthLabel(+rec.entry_date.slice(0, 4), +rec.entry_date.slice(5, 7)) : '') + '.');
    } catch (e) {
      error.textContent = 'Registrazione non salvata: ' + e.message + '.';
      error.hidden = false;
    } finally {
      save.disabled = false;
    }
  }

  async function remove() {
    const e = editing;
    const ok = await confirmBox({ title: 'Eliminare la registrazione?',
      lines: [fmtDay(e.entry_date) + ' · ' + (e.economic_account_name || e.causale_code) + ' · ' + fmtAmount(e.amount) + ' €',
              'L\'operazione non si può annullare.'],
      ok: 'Elimina', danger: true });
    if (!ok) return;
    try {
      await rows(sb.from('entries').delete().eq('id', e.id));
      reset(true);
      await loadEntries(ctx);
      say('Registrazione eliminata.');
    } catch (err) {
      error.textContent = 'Eliminazione non riuscita: ' + err.message + '.';
      error.hidden = false;
    }
  }

  const el = h('form', { class: 'entry-form', novalidate: true, onsubmit: submit },
    title,
    h('div', { class: 'field' }, h('label', { for: 'j-causale' }, 'Causale'), causaleSel, fixedInfo),
    accountField,
    h('div', { class: 'pair' },
      h('div', { class: 'field' }, h('label', { for: 'j-date' }, 'Data'), date),
      h('div', { class: 'field' }, h('label', { for: 'j-amount' }, 'Importo (€)'), amount)),
    h('div', { class: 'field' }, h('label', { for: 'j-note' }, 'Note'), note),
    alertBox,
    error,
    h('div', { class: 'actions' }, save, cancel, del));

  reset(true);
  return { el, edit, editingId: () => editing?.id };
}
