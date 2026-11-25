// Impostazioni: conti patrimoniali, conti economici e causali, con l'aggancio al Budget
import { sb, rows, countRows } from '../db.js';
import { h, say, clearMsg, confirmBox } from '../ui.js';
import * as M from '../settings-model.js';

const TABS = [
  { id: 'patrimoniali', label: 'Conti patrimoniali' },
  { id: 'economici',    label: 'Conti economici' },
  { id: 'causali',      label: 'Causali' }
];

// Dati caricati all'apertura della vista e ricaricati dopo ogni modifica
const state = { accounts: [], causali: [], tab: 'patrimoniali', body: null };

const accountById = (id) => state.accounts.find((a) => a.id === id);
const accountName = (id) => accountById(id)?.name ?? '–';
const patrimoniali = () => M.sortByOrder(state.accounts.filter((a) => a.type === 'patrimoniale'));
const economici = () => M.sortByOrder(state.accounts.filter((a) => a.type === 'economico'));

export async function render(root, { params }) {
  state.tab = TABS.some((t) => t.id === params[0]) ? params[0] : 'patrimoniali';
  state.body = h('div');
  root.replaceChildren(
    h('h1', null, 'Impostazioni'),
    h('p', { class: 'lede' }, 'Aggiungi, modifica o elimina conti e causali. Il Budget, il Giornale e le schede conto si aggiornano di conseguenza.'),
    h('nav', { class: 'tabs', 'aria-label': 'Sezioni delle impostazioni' },
      TABS.map((t) => h('a', { href: '#/impostazioni/' + t.id,
                               'aria-current': t.id === state.tab ? 'page' : null }, t.label))),
    state.body);
  await reload();
}

async function reload() {
  const [accounts, causali] = await Promise.all([
    rows(sb.from('accounts').select('*')),
    rows(sb.from('causali').select('*'))
  ]);
  state.accounts = accounts;
  state.causali = causali;
  draw();
}

function draw() {
  const views = { patrimoniali: drawPatrimoniali, economici: drawEconomici, causali: drawCausali };
  state.body.replaceChildren(...views[state.tab]());
}

// ---------------------------------------------------------------------
// Elenchi
// ---------------------------------------------------------------------

function toolbar(label, onclick) {
  return h('div', { class: 'toolbar' }, h('button', { type: 'button', onclick }, label));
}

function table(head, bodyRows) {
  return h('div', { class: 'table-wrap' },
    h('table', { class: 'list' },
      h('thead', null, h('tr', null, head.map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', null, bodyRows)));
}

function editButton(label, onclick) {
  return h('td', { class: 'act' },
    h('button', { type: 'button', class: 'quiet small', 'aria-label': 'Modifica ' + label, onclick }, 'Modifica'));
}

function nameCell(text, active) {
  return h('td', null, text, !active && h('span', { class: 'badge muted' }, 'disattivato'));
}

function drawPatrimoniali() {
  const list = patrimoniali();
  const out = [toolbar('Aggiungi conto patrimoniale', () => editAccount('patrimoniale'))];
  for (const g of M.GROUPS) {
    const items = list.filter((a) => a.grp === g.value);
    if (!items.length) continue;
    out.push(h('h2', { class: 'group' }, g.label, h('span', { class: 'sub' }, ' · ' + g.side)));
    out.push(table(['Conto', 'Ordine', ''], items.map((a) =>
      h('tr', { class: a.active ? null : 'inactive' },
        nameCell(a.name, a.active),
        h('td', { class: 'num' }, a.sort_order),
        h('td', { class: 'act' },
          h('button', { type: 'button', class: 'quiet small', 'aria-label': 'Crea le causali di ' + a.name,
                        title: 'Crea le causali di costo, ricavo e trasferimento di questo conto',
                        onclick: () => openCausaliWizard(a) }, 'Causali'),
          ' ',
          h('button', { type: 'button', class: 'quiet small', 'aria-label': 'Modifica ' + a.name,
                        onclick: () => editAccount('patrimoniale', a) }, 'Modifica'))))));
  }
  return out;
}

function drawEconomici() {
  const code = (id) => state.causali.find((c) => c.id === id)?.code;
  const out = [toolbar('Aggiungi conto economico', () => editAccount('economico'))];
  for (const [section, items] of M.groupBy(economici(), (a) => a.budget_section || 'Senza sezione')) {
    out.push(h('h2', { class: 'group' }, section));
    out.push(table(['Voce', 'Tipo', 'Canale standard', ''], items.map((a) =>
      h('tr', { class: a.active ? null : 'inactive' },
        h('td', null, a.name,
          a.is_contingency && h('span', { class: 'badge' }, 'imprevisti'),
          !a.active && h('span', { class: 'badge muted' }, 'disattivato')),
        h('td', null, a.kind),
        h('td', null, code(a.standard_causale_id) || h('span', { class: 'warn' }, 'nessuno')),
        editButton(a.name, () => editAccount('economico', a))))));
  }
  return out;
}

function drawCausali() {
  const out = [toolbar('Aggiungi causale', () => editCausale())];
  const list = M.sortByOrder(state.causali, 'code');
  for (const k of M.CAUSALE_KINDS) {
    const items = list.filter((c) => c.kind === k.value);
    if (!items.length) continue;
    const chosen = h('em', { class: 'muted' }, 'conto economico');
    out.push(h('h2', { class: 'group' }, k.plural));
    out.push(table(['Codice', 'Descrizione', 'Dare', 'Avere', 'Gruppo', 'Budget', ''], items.map((c) =>
      h('tr', { class: c.active ? null : 'inactive' },
        h('td', null, h('code', null, c.code)),
        nameCell(c.description, c.active),
        h('td', null, c.kind === 'costo' ? chosen.cloneNode(true) : accountName(c.debit_account_id)),
        h('td', null, c.kind === 'ricavo' ? chosen.cloneNode(true) : accountName(c.credit_account_id)),
        h('td', null, c.grp || '–'),
        h('td', null, c.kind === 'finanziaria' ? M.ruleShort(c.budget_rule) : 'per canale'),
        editButton(c.code, () => editCausale(c))))));
  }
  return out;
}

// ---------------------------------------------------------------------
// Controlli dei form
// ---------------------------------------------------------------------

let uid = 0;

function field(label, control, hint) {
  control.id ||= 'f' + (++uid);
  return h('div', { class: 'field' },
    h('label', { for: control.id }, label),
    control,
    hint && h('p', { class: 'hint' }, hint));
}

const input = (name, value, attrs) => h('input', { name, value: value ?? '', ...attrs });

function select(name, options, value, attrs) {
  return h('select', { name, ...attrs },
    options.map((o) => h('option', { value: o.value, selected: o.value === (value ?? '') }, o.label)));
}

const checkbox = (name, label, checked) =>
  h('label', { class: 'check' }, h('input', { type: 'checkbox', name, checked }), ' ', label);

function datalist(id, values) {
  return h('datalist', { id }, [...new Set(values.filter(Boolean))].map((v) => h('option', { value: v })));
}

// Legge il form; i campi disabilitati non arrivano in FormData e prendono il valore di fallback
function formValues(form, fallback = {}) {
  const fd = new FormData(form);
  const v = { ...fallback };
  for (const [k, val] of fd.entries()) v[k] = val;
  for (const cb of form.querySelectorAll('input[type=checkbox]')) v[cb.name] = cb.checked;
  return v;
}

// Dialogo di modifica con Salva / Annulla / Elimina.
// onSave(form, fail) e onDelete(fail) restituiscono true se hanno modificato i dati.
// after: chiamata dopo un salvataggio riuscito, a dati ricaricati (es. la finestra delle causali)
function openEditor({ title, note, fields, onSave, onDelete, after }) {
  const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const save = h('button', { type: 'submit' }, 'Salva');
  const del = onDelete && h('button', { type: 'button', class: 'danger quiet push' }, 'Elimina');
  const form = h('form', { novalidate: true },
    h('h2', null, title),
    note && h('p', { class: 'hint' }, note),
    fields,
    error,
    h('div', { class: 'actions' },
      save,
      h('button', { type: 'button', class: 'quiet', onclick: () => shut() }, 'Annulla'),
      del));
  const dlg = h('dialog', { class: 'sheet' }, form);
  const fail = (msg) => { error.textContent = msg; error.hidden = false; return false; };
  // rimuove subito il dialogo; l'evento close copre la chiusura con Esc
  const shut = () => { dlg.close(); dlg.remove(); };

  async function attempt(button, fn, what) {
    error.hidden = true;
    button.disabled = true;
    try {
      if (await fn()) {
        shut();
        await reload();
        say(what);
      }
    } catch (e) {
      fail('Operazione non riuscita: ' + e.message + '.');
    } finally {
      button.disabled = false;
    }
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    await attempt(save, () => onSave(form, fail), 'Modifiche salvate.');
    if (!dlg.isConnected) after?.();
  });
  del?.addEventListener('click', () => attempt(del, () => onDelete(fail), 'Eliminazione completata.'));
  dlg.addEventListener('close', () => dlg.remove());

  clearMsg();
  document.body.append(dlg);
  dlg.showModal();
  return form;
}

// ---------------------------------------------------------------------
// Conti
// ---------------------------------------------------------------------

async function accountUsage(a) {
  const id = a.id;
  const [entries, budget, opening] = await Promise.all([
    countRows('entries', (q) => q.or(`debit_account_id.eq.${id},credit_account_id.eq.${id}`)),
    countRows('budget_accounts', (q) => q.eq('account_id', id).neq('amount', 0)),
    a.type === 'patrimoniale'
      ? countRows('opening_balances', (q) => q.eq('account_id', id).neq('amount', 0))
      : 0
  ]);
  const causali = state.causali.filter((c) => c.debit_account_id === id || c.credit_account_id === id);
  return { entries, budget, opening, causali };
}

async function editAccount(type, a) {
  let usage = null;
  try {
    usage = a ? await accountUsage(a) : null;
  } catch (e) {
    say('Non riesco a leggere l\'uso del conto: ' + e.message + '.', true);
    return;
  }
  const locks = M.accountLocks(a, usage);
  const sameType = state.accounts.filter((x) => x.type === type);
  const v = a ?? { name: '', grp: 'disponibilita', kind: 'costo', active: true,
                   sort_order: M.nextOrder(sameType) };

  const fields = type === 'patrimoniale' ? patrimonialeFields(v, locks) : economicoFields(v, locks);
  fields.push(
    field('Ordine', input('sort_order', v.sort_order, { type: 'number', step: 1, inputmode: 'numeric' }),
      'Posizione nell\'elenco e nel Budget, dal più piccolo.'),
    checkbox('active', 'Attivo (compare nei menu del Giornale)', v.active));

  let created = null;   // nuovo conto patrimoniale: dopo il salvataggio si propongono le sue causali
  openEditor({
    title: a ? 'Modifica «' + a.name + '»' : 'Nuovo conto ' + type,
    note: usage && M.usageSummary(usage),
    fields,
    onSave: async (form, fail) => {
      const rec = M.buildAccount(type, formValues(form, { kind: v.kind }));
      const errors = M.validateAccount(rec, a?.id, state.accounts, state.causali);
      if (errors.length) return fail(errors.join(' '));
      if (a) await rows(sb.from('accounts').update(rec).eq('id', a.id));
      else created = await rows(sb.from('accounts').insert(rec).select().single());
      return true;
    },
    after: () => { if (created?.type === 'patrimoniale') openCausaliWizard(created); },
    onDelete: a && (async (fail) => {
      const block = M.accountDeleteBlock(usage);
      if (block) return fail(block);
      const ok = await confirmBox({ title: 'Eliminare «' + a.name + '»?',
        lines: M.deleteConsequences(usage), ok: 'Elimina', danger: true });
      if (!ok) return false;
      await rows(sb.from('accounts').delete().eq('id', a.id));
      return true;
    })
  });
}

function patrimonialeFields(v, locks) {
  // con registrazioni o causali collegate si può cambiare gruppo solo restando nella stessa natura
  const side = M.sideOfGroup(v.grp);
  const groups = M.GROUPS.filter((g) => !locks.side || g.side === side)
    .map((g) => ({ value: g.value, label: g.label + ' (' + g.side + ')' }));
  return [
    field('Nome', input('name', v.name, { required: true, autocomplete: 'off' })),
    field('Gruppo', select('grp', groups, v.grp),
      locks.side
        ? 'Il conto ha già movimenti o causali: puoi spostarlo solo tra gruppi della stessa natura.'
        : 'I debiti sono passivi, gli altri gruppi attivi. Il saldo iniziale si inserisce all\'apertura dell\'anno.')
  ];
}

function economicoFields(v, locks) {
  const sections = economici().map((a) => a.budget_section);
  const kindSelect = select('kind', [{ value: 'ricavo', label: 'Ricavo' }, { value: 'costo', label: 'Costo' }],
    v.kind, { disabled: locks.kind });
  const channel = h('select', { name: 'standard_causale_id' });
  const contingency = checkbox('is_contingency',
    'Voce degli imprevisti (solo budget, quota mensile calcolata dal target)', v.is_contingency);

  // il canale standard deve essere una causale dello stesso tipo della voce
  function syncKind() {
    const kind = kindSelect.value;
    const current = channel.value || v.standard_causale_id || '';
    const options = [{ value: '', label: 'Nessuno' }].concat(
      M.sortByOrder(state.causali.filter((c) => c.kind === kind), 'code')
        .map((c) => ({ value: c.id, label: c.code + ' · ' + c.description })));
    channel.replaceChildren(...options.map((o) =>
      h('option', { value: o.value, selected: o.value === current }, o.label)));
    contingency.hidden = kind !== 'costo';
  }
  kindSelect.addEventListener('change', syncKind);
  syncKind();

  return [
    field('Nome', input('name', v.name, { required: true, autocomplete: 'off' })),
    field('Tipo', kindSelect, locks.kind ? 'La voce ha già registrazioni: il tipo non si può cambiare.' : null),
    field('Sezione del Budget', input('budget_section', v.budget_section, { list: 'dl-sections', autocomplete: 'off' }),
      'La voce compare nel Budget sotto questa sezione, con un valore per ogni mese.'),
    datalist('dl-sections', sections),
    field('Canale standard', channel,
      'Il budget della voce entra nella riga «di cui» di questo canale. Se registri la voce con un\'altra causale, il Giornale mostra l\'Alert per le Var +/-.'),
    contingency
  ];
}

// ---------------------------------------------------------------------
// Causali
// ---------------------------------------------------------------------

async function causaleUsage(c) {
  const [entries, budget, adjustments] = await Promise.all([
    countRows('entries', (q) => q.eq('causale_id', c.id)),
    countRows('budget_causali', (q) => q.eq('causale_id', c.id).neq('amount', 0)),
    countRows('channel_adjustments', (q) => q.eq('causale_id', c.id).neq('amount', 0))
  ]);
  const standardFor = state.accounts.filter((a) => a.standard_causale_id === c.id);
  return { entries, budget, adjustments, standardFor };
}

async function editCausale(c) {
  let usage = null;
  try {
    usage = c ? await causaleUsage(c) : null;
  } catch (e) {
    say('Non riesco a leggere l\'uso della causale: ' + e.message + '.', true);
    return;
  }
  const locks = M.causaleLocks(usage);
  const v = c ?? { code: '', description: '', kind: 'costo', active: true,
                   sort_order: M.nextOrder(state.causali) };

  const accounts = [{ value: '', label: 'Scegli un conto' }].concat(patrimoniali().map((a) =>
    ({ value: a.id, label: a.name + (a.active ? '' : ' (disattivato)') })));
  const kindSelect = select('kind', M.CAUSALE_KINDS, v.kind, { disabled: locks.kind });
  const debit = select('debit_account_id', accounts, v.debit_account_id, { disabled: locks.accounts });
  const credit = select('credit_account_id', accounts, v.credit_account_id, { disabled: locks.accounts });
  const lockHint = locks.accounts ? 'La causale ha già registrazioni: i conti fissi non si possono cambiare.' : null;
  const debitField = field('Conto Dare', debit, lockHint);
  const creditField = field('Conto Avere', credit, lockHint);
  const ruleField = field('Budget', select('budget_rule', M.BUDGET_RULES, v.budget_rule || ''),
    'Le causali con budget calcolato non si inseriscono a mano nel Budget.');
  const channelInfo = h('p', { class: 'hint box' });

  // mostra solo i campi che servono per il tipo scelto
  function syncKind() {
    const kind = kindSelect.value;
    debitField.hidden = kind === 'costo';
    creditField.hidden = kind === 'ricavo';
    debitField.querySelector('label').textContent = kind === 'ricavo' ? 'Conto Dare (il canale)' : 'Conto Dare';
    creditField.querySelector('label').textContent = kind === 'costo' ? 'Conto Avere (il canale)' : 'Conto Avere';
    ruleField.hidden = kind !== 'finanziaria';
    channelInfo.hidden = kind === 'finanziaria';
    const n = usage?.standardFor.length || 0;
    channelInfo.textContent =
      `Il lato ${kind === 'ricavo' ? 'Avere' : 'Dare'} è il conto economico scelto nel Giornale. ` +
      'Nel Budget, la riga di questo canale è la somma delle voci che lo hanno come canale standard, più le Var +/-. ' +
      (n ? 'Voci con questo canale standard: ' + usage.standardFor.map((a) => a.name).join(', ') + '.'
         : 'Nessuna voce lo ha ancora come canale standard: lo imposti nei conti economici.');
  }
  kindSelect.addEventListener('change', syncKind);
  syncKind();

  openEditor({
    title: c ? 'Modifica ' + c.code : 'Nuova causale',
    note: usage && M.usageSummary(usage),
    fields: [
      field('Tipo', kindSelect, locks.kind
        ? 'La causale ha registrazioni o è canale standard di qualche voce: il tipo non si può cambiare.'
        : null),
      field('Codice', input('code', v.code, { required: true, autocomplete: 'off', class: 'code',
                                              maxlength: 12, autocapitalize: 'characters' })),
      field('Descrizione', input('description', v.description, { required: true, autocomplete: 'off' })),
      debitField,
      creditField,
      channelInfo,
      field('Gruppo del Budget', input('grp', v.grp, { list: 'dl-cgroups', autocomplete: 'off' }),
        'Raggruppamento delle righe nel Budget (es. Prelievi, Trasferimenti).'),
      datalist('dl-cgroups', state.causali.map((x) => x.grp)),
      ruleField,
      field('Ordine', input('sort_order', v.sort_order, { type: 'number', step: 1, inputmode: 'numeric' })),
      checkbox('active', 'Attiva (compare nel menu del Giornale)', v.active)
    ],
    onSave: async (form, fail) => {
      const rec = M.buildCausale(formValues(form, {
        kind: v.kind, debit_account_id: v.debit_account_id, credit_account_id: v.credit_account_id
      }));
      const errors = M.validateCausale(rec, c?.id, state.causali, state.accounts);
      if (errors.length) return fail(errors.join(' '));
      if (c) await rows(sb.from('causali').update(rec).eq('id', c.id));
      else await rows(sb.from('causali').insert(rec));
      return true;
    },
    onDelete: c && (async (fail) => {
      const block = M.causaleDeleteBlock(usage);
      if (block) return fail(block);
      const ok = await confirmBox({ title: 'Eliminare la causale ' + c.code + '?',
        lines: M.deleteConsequences(usage), ok: 'Elimina', danger: true });
      if (!ok) return false;
      await rows(sb.from('causali').delete().eq('id', c.id));
      return true;
    })
  });
}

// ---------------------------------------------------------------------
// Causali di un conto patrimoniale: costi, ricavi, trasferimenti, crediti e debiti
// ---------------------------------------------------------------------

function openCausaliWizard(account) {
  const abbr = h('input', { id: 'cw-abbr', value: M.accountAbbr(account, state.causali), maxlength: 6,
                            autocomplete: 'off', class: 'code', style: 'width: 7rem' });
  const checked = new Map();          // key -> spunta scelta dall'utente (sopravvive al cambio di sigla)
  const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const body = h('div');
  const create = h('button', { type: 'submit' });
  let proposals = [];

  const isOn = (p) => (checked.has(p.key) ? checked.get(p.key) : p.on);
  const chosen = () => proposals.filter((p) => !p.existing && isOn(p));

  function box(p, text) {
    const cb = h('input', { type: 'checkbox', checked: Boolean(p.existing) || isOn(p), disabled: Boolean(p.existing),
                            'aria-label': p.rec.code + ' · ' + p.rec.description });
    cb.addEventListener('change', () => { checked.set(p.key, cb.checked); count(); });
    return h('label', { class: 'check cw-item' + (p.existing ? ' muted' : '') }, cb, ' ',
      h('code', null, p.existing || p.rec.code), ' ', text,
      p.existing && h('span', { class: 'badge muted' }, 'esiste già'));
  }

  function count() {
    const n = chosen().length;
    create.textContent = n === 0 ? 'Nessuna causale da creare' : n === 1 ? 'Crea 1 causale' : `Crea ${n} causali`;
    create.disabled = n === 0;
  }

  function paint() {
    const a = abbr.value.trim().toUpperCase();
    proposals = M.causaleProposals(account, a || '?', state.accounts, state.causali);
    const by = (s) => proposals.filter((p) => p.section === s);
    const transfers = by('trasferimenti');
    const others = [...new Map(transfers.map((p) => [p.key.slice(p.key.indexOf(':') + 1), true])).keys()];
    const find = (dir, id) => transfers.find((p) => p.key === dir + ':' + id);

    // h() appiattisce le liste annidate, replaceChildren no: si passa da un contenitore
    body.replaceChildren(h('div', null,
      h('h3', null, 'Costi e ricavi'),
      by('canale').map((p) => box(p, p.label)),
      h('h3', null, 'Trasferimenti'),
      others.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'list cw-table' },
        h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Conto'),
          h('th', { scope: 'col' }, 'da ' + account.name + ' a…'), h('th', { scope: 'col' }, 'da … a ' + account.name))),
        h('tbody', null, others.map((id) => h('tr', null,
          h('td', null, state.accounts.find((x) => x.id === id)?.name),
          h('td', null, box(find('out', id), '')), h('td', null, box(find('in', id), '')))))))
        : h('p', { class: 'muted' }, 'Non ci sono altri conti patrimoniali attivi.'),
      by('crediti').length > 0 && [h('h3', null, 'Crediti e debiti'),
        by('crediti').map((p) => box(p, p.label + ' via ' + account.name))]));
    count();
  }

  abbr.addEventListener('input', () => { abbr.value = abbr.value.toUpperCase(); paint(); });

  const form = h('form', { novalidate: true },
    h('h2', null, 'Crea le causali per «' + account.name + '»'),
    h('p', { class: 'hint' }, 'Spunta le causali da creare: Dare, Avere, descrizione e gruppo si compilano da soli. ' +
      'Quelle che esistono già non si ricreano. Potrai sempre modificarle o aggiungerne altre dalle Causali.'),
    h('div', { class: 'field' }, h('label', { for: 'cw-abbr' }, 'Sigla del conto'), abbr,
      h('p', { class: 'hint' }, 'Serve per i codici: COS+sigla, RIC+sigla, sigla+sigla per i trasferimenti.')),
    body,
    error,
    h('div', { class: 'actions' }, create,
      h('button', { type: 'button', class: 'quiet', onclick: () => shut() }, 'Non ora')));
  const dlg = h('dialog', { class: 'sheet wide' }, form);
  const shut = () => { dlg.close(); dlg.remove(); };
  dlg.addEventListener('close', () => dlg.remove());

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    error.hidden = true;
    const list = chosen();
    const errors = M.validateProposals(abbr.value.trim().toUpperCase(), list, state.causali);
    if (errors.length) {
      error.textContent = errors.join(' ');
      error.hidden = false;
      return;
    }
    create.disabled = true;
    try {
      let order = M.nextOrder(state.causali);
      await rows(sb.from('causali').insert(list.map((p) => ({ ...p.rec, sort_order: order++ }))));
      shut();
      await reload();
      say(`Create ${list.length} causali per «${account.name}»: ${list.map((p) => p.rec.code).join(', ')}.`);
    } catch (e) {
      error.textContent = 'Causali non create: ' + e.message + '.';
      error.hidden = false;
      create.disabled = false;
    }
  });

  paint();
  clearMsg();
  document.body.append(dlg);
  dlg.showModal();
}
