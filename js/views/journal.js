// Giornale: registrazioni del mese con l'Alert di canale, movimenti provvisori e preferiti.
// Pensato per il telefono.
import { sb, rows } from '../db.js';
import { h, say, clearMsg, confirmBox, promptBox } from '../ui.js';
import * as J from '../journal-model.js';
import { sortByOrder, groupBy } from '../settings-model.js';
import { fmtAmount, fmtDay, parseAmount, isoDate, monthLabel } from '../format.js';

const KIND_GROUPS = [
  { kind: 'costo', label: 'Costi' },
  { kind: 'ricavo', label: 'Ricavi' },
  { kind: 'finanziaria', label: 'Finanziarie' }
];

export async function render(root, { params, query = new URLSearchParams() }) {
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
    matured: h('div', { class: 'alert-summary matured', role: 'status', hidden: true }),
    favorites: [], favList: h('div', { class: 'fav-list' }),
    form: null
  };

  const closed = months.some((m) => m.year === view.year && m.month === view.month && m.closed);
  ctx.form = entryForm(ctx);

  // due colonne sugli schermi larghi: a sinistra inserimento e registrazioni, a destra i preferiti
  root.replaceChildren(h('div', { class: 'journal-cols' },
    h('div', { class: 'journal' },
      h('h1', null, 'Giornale'),
      h('nav', { class: 'month-nav', 'aria-label': 'Mese' },
        h('a', { href: '#/giornale/' + J.monthParam(J.shiftMonth(view, -1)), 'aria-label': 'Mese precedente' }, '‹'),
        h('span', null, monthLabel(view.year, view.month), closed && h('span', { class: 'badge muted' }, 'chiuso')),
        h('a', { href: '#/giornale/' + J.monthParam(J.shiftMonth(view, 1)), 'aria-label': 'Mese successivo' }, '›')),
      ctx.matured,
      ctx.form.el,
      ctx.summary,
      h('h2', null, 'Registrazioni del mese'),
      ctx.list),
    h('aside', { class: 'journal-side' },
      h('section', { class: 'card', 'aria-labelledby': 'fav-title' },
        h('h2', { id: 'fav-title' }, 'Preferiti'),
        ctx.favList))));

  await Promise.all([loadEntries(ctx), loadMatured(ctx), loadFavorites(ctx)]);

  // arrivo dal "+" del Budget: si compila il form e si toglie la richiesta dall'indirizzo,
  // così ricaricando la pagina non si ricompila (replaceState non fa scattare il router)
  if ([...query.keys()].length) {
    history.replaceState(null, '', '#/giornale/' + J.monthParam(view));
    const p = J.prefillFromQuery(query, accounts, causali);
    if (p) ctx.form.applyPrefill(p);
    else say('Non trovo la voce da registrare: forse è stata eliminata. Compila la registrazione a mano.', true);
  }
}

async function loadEntries(ctx) {
  const { from, to } = J.monthBounds(ctx.view.year, ctx.view.month);
  ctx.entries = await rows(sb.from('entries_enriched').select('*')
    .gte('entry_date', from).lt('entry_date', to)
    .order('entry_date', { ascending: false }).order('created_at', { ascending: false }));
  drawList(ctx);
}

const entryTitle = (ctx, e) => e.economic_account_name || ctx.causale(e.causale_id)?.description || e.causale_code;
const entrySign = (e) => (e.causale_kind === 'ricavo' ? '+' : e.causale_kind === 'costo' ? '−' : '');

function drawList(ctx) {
  const alerts = ctx.entries.filter((e) => e.channel_alert).length;
  ctx.summary.hidden = !alerts;
  ctx.summary.textContent = alerts === 1
    ? '1 registrazione fuori canale o storno questo mese: ricorda le Var +/- nel Budget.'
    : `${alerts} registrazioni fuori canale o storni questo mese: ricorda le Var +/- nel Budget.`;

  if (!ctx.entries.length) {
    ctx.list.replaceChildren(h('li', { class: 'empty' }, 'Nessuna registrazione in questo mese.'));
    return;
  }
  ctx.list.replaceChildren(...ctx.entries.map((e) => {
    const title = entryTitle(ctx, e);
    const cls = 'entry ' + e.causale_kind + (e.provisional ? ' provisional' : '') +
      (e.id === ctx.form.editingId() ? ' editing' : '');
    return h('li', { class: cls },
      h('button', { type: 'button', class: 'entry-open', 'aria-label': 'Modifica ' + title + ' del ' + fmtDay(e.entry_date) +
                      (e.provisional ? ' (provvisorio)' : ''),
                    onclick: () => ctx.form.edit(e) },
        h('span', { class: 'day' }, fmtDay(e.entry_date)),
        h('span', { class: 'what' },
          h('strong', null, title),
          h('small', null, e.causale_code, e.note && ' · ' + e.note)),
        h('span', { class: 'amt' }, entrySign(e) + fmtAmount(e.amount)),
        e.provisional
          ? h('span', { class: 'badge prov' }, 'provvisorio')
          : e.channel_alert && h('span', { class: 'badge alert' }, 'Alert')),
      // duplica: stessa registrazione come nuova, da modificare prima di registrare
      h('button', { type: 'button', class: 'entry-dup', title: 'Duplica',
                    'aria-label': 'Duplica ' + title + ' del ' + fmtDay(e.entry_date), onclick: () => ctx.form.duplicate(e) },
        icon('i-copia')));
  }));
}

// Movimenti provvisori con data ormai raggiunta, di qualsiasi mese: si aprono in modifica
// per togliere la spunta (o eliminarli)
async function loadMatured(ctx) {
  const list = J.maturedProvisional(await rows(sb.from('entries_enriched').select('*')
    .eq('provisional', true).lte('entry_date', ctx.today).order('entry_date')), ctx.today);
  ctx.matured.hidden = !list.length;
  if (!list.length) return ctx.matured.replaceChildren();
  ctx.matured.replaceChildren(
    h('p', null, list.length === 1
      ? '1 movimento provvisorio è arrivato alla sua data. Aprilo e togli la spunta «Movimento provvisorio» per confermarlo, oppure eliminalo.'
      : `${list.length} movimenti provvisori sono arrivati alla loro data. Aprili e togli la spunta «Movimento provvisorio» per confermarli, oppure eliminali.`),
    h('ul', null, list.map((e) => h('li', null,
      h('button', { type: 'button', class: 'link', onclick: () => ctx.form.edit(e) },
        fmtDay(e.entry_date) + '/' + e.entry_date.slice(0, 4) + ' · ' + entryTitle(ctx, e) + ' · ' + entrySign(e) + fmtAmount(e.amount) + ' €')))));
}

// --- Preferiti ---

async function loadFavorites(ctx) {
  ctx.favorites = await rows(sb.from('favorites').select('*').order('name'));
  drawFavorites(ctx);
}

function favoriteDetail(ctx, f) {
  const c = ctx.causale(f.causale_id);
  return [c?.code, f.amount != null && fmtAmount(f.amount) + ' €', f.note].filter(Boolean).join(' · ');
}

function drawFavorites(ctx) {
  if (!ctx.favorites.length) {
    ctx.favList.replaceChildren(h('p', { class: 'muted' },
      'Nessun preferito. Compila una registrazione e premi la stella ☆ per salvarla qui.'));
    return;
  }
  ctx.favList.replaceChildren(h('ul', { class: 'favs' }, ctx.favorites.map((f) => h('li', { class: 'fav' },
    h('button', { type: 'button', class: 'fav-use', title: 'Compila la registrazione con «' + f.name + '»',
                  onclick: () => ctx.form.applyFavorite(f) },
      h('strong', null, f.name),
      h('small', null, favoriteDetail(ctx, f))),
    h('button', { type: 'button', class: 'fav-menu', 'aria-label': 'Rinomina o elimina «' + f.name + '»',
                  onclick: () => manageFavorite(ctx, f) }, '⋯')))));
}

async function manageFavorite(ctx, f) {
  const res = await promptBox({ title: 'Preferito «' + f.name + '»', lines: [favoriteDetail(ctx, f)],
    label: 'Nome', value: f.name, ok: 'Salva nome', alt: { label: 'Elimina', danger: true } });
  if (!res) return;
  clearMsg();
  try {
    if (res.alt) {
      const ok = await confirmBox({ title: 'Eliminare il preferito?',
        lines: ['«' + f.name + '» sparirà dai preferiti. Le registrazioni già fatte non cambiano.'],
        ok: 'Elimina', danger: true });
      if (!ok) return;
      await rows(sb.from('favorites').delete().eq('id', f.id));
      say('Preferito «' + f.name + '» eliminato.');
    } else if (res.value !== f.name) {
      await rows(sb.from('favorites').update({ name: res.value }).eq('id', f.id));
      say('Preferito rinominato in «' + res.value + '».');
    }
    await loadFavorites(ctx);
  } catch (e) {
    say('Preferito non aggiornato: ' + e.message + '.', true);
  }
}

// Form di inserimento e modifica. Restituisce { el, edit(entry), applyFavorite(fav), applyPrefill(p), editingId() }.
function entryForm(ctx) {
  let editing = null;

  const causaleSel = h('select', { id: 'j-causale', name: 'causale' });
  const fixedInfo = h('p', { class: 'hint fixed' });
  const accountSel = h('select', { id: 'j-account', name: 'account' });
  const accountField = h('div', { class: 'field' }, h('label', { for: 'j-account' }, 'Conto economico'), accountSel);
  const date = h('input', { id: 'j-date', type: 'date', required: true });
  // scorciatoia per la data di oggi, più veloce del calendario
  const todayBtn = h('button', { type: 'button', class: 'quiet today', title: 'Metti la data di oggi',
                                 onclick: () => { date.value = ctx.today; syncAlert(); amount.focus(); } }, 'Oggi');
  const amount = h('input', { id: 'j-amount', inputmode: 'decimal', autocomplete: 'off', placeholder: '0,00' });
  const note = h('input', { id: 'j-note', autocomplete: 'off' });
  const provisional = h('input', { id: 'j-prov', type: 'checkbox' });
  const provHint = h('p', { class: 'hint', hidden: true },
    'Resta nel Giornale ma non entra in Budget, Partitario, Patrimonio e Dashboard finché non togli la spunta.');
  const alertBox = h('p', { class: 'alert-box', role: 'status', hidden: true });
  const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const title = h('h2', null);
  const star = h('button', { type: 'button', class: 'star quiet', onclick: saveFavorite,
                             title: 'Salva tra i preferiti', 'aria-label': 'Salva tra i preferiti' }, icon('i-stella'));
  const repeat = h('button', { type: 'button', class: 'star repeat quiet', onclick: () => openPeriodic(),
                               title: 'Registra ogni mese (periodica)', 'aria-label': 'Registra ogni mese (periodica)' }, icon('i-ripeti'));
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
    // la voce di uno storno (di tipo opposto alla causale) resta nel menu della sua registrazione
    const list = sortByOrder(ctx.accounts.filter((a) => a.type === 'economico' && ((a.kind === kind && usable(a, keepId)) || a.id === keepId)));
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

  // i provvisori non danno Alert: non entrano nei calcoli, le Var si decidono alla conferma
  function syncAlert() {
    const c = ctx.causale(causaleSel.value);
    const a = ctx.account(accountSel.value);
    const show = J.channelAlert(c, a) && date.value && !provisional.checked;
    alertBox.hidden = !show;
    if (show) alertBox.textContent = J.alertText(a, ctx.causale(a.standard_causale_id)?.code ?? '?', date.value);
    provHint.hidden = !provisional.checked;
  }

  let pendingAccount = null;   // conto arrivato dal Budget per una voce senza canale standard
  let stornoKeep = null;       // voce di uno storno duplicato: resta valida anche con la causale di tipo opposto
  causaleSel.addEventListener('change', () => sync(pendingAccount));
  accountSel.addEventListener('change', syncAlert);
  date.addEventListener('change', syncAlert);
  provisional.addEventListener('change', syncAlert);

  function setMode(isEditing) {
    title.textContent = isEditing ? 'Modifica registrazione' : 'Nuova registrazione';
    save.textContent = isEditing ? 'Salva modifiche' : 'Registra';
    cancel.hidden = !isEditing;
    del.hidden = !isEditing;
    error.hidden = true;
  }

  // dopo un inserimento restano causale e data, per registrare di fila
  function reset(full) {
    const keep = !full && !editing ? { causale: causaleSel.value, date: date.value } : null;
    editing = null;
    pendingAccount = null;
    stornoKeep = null;
    fillCausali();
    causaleSel.value = keep?.causale ?? '';
    date.value = keep?.date || J.defaultDate(ctx.view, ctx.today);
    amount.value = '';
    note.value = '';
    accountSel.value = '';
    provisional.checked = false;
    setMode(false);
    sync();
    if (ctx.entries.length) drawList(ctx);
  }

  function edit(e) {
    editing = e;
    pendingAccount = null;
    fillCausali(e.causale_id);
    causaleSel.value = e.causale_id;
    accountSel.value = '';
    sync(e.economic_account_id);
    date.value = e.entry_date;
    amount.value = fmtAmount(e.amount);
    note.value = e.note || '';
    provisional.checked = Boolean(e.provisional);
    setMode(true);
    syncAlert();
    drawList(ctx);
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    amount.focus({ preventScroll: true });
  }

  // Nuova registrazione già compilata (preferiti e "+" del Budget). Se la causale manca,
  // il conto resta in attesa e si seleziona appena la si sceglie.
  function fill({ causaleId, accountId, amount: value, note: text, date: day, prov = false }) {
    editing = null;
    pendingAccount = causaleId ? null : accountId;
    stornoKeep = null;
    fillCausali(causaleId);
    causaleSel.value = ctx.causale(causaleId) ? causaleId : '';
    accountSel.value = '';
    sync(accountId);
    date.value = day;
    amount.value = value != null ? fmtAmount(Number(value)) : '';
    note.value = text || '';
    provisional.checked = prov;
    setMode(false);
    syncAlert();
    if (ctx.entries.length) drawList(ctx);
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Duplica: tutto come la registrazione di partenza (anche data e "provvisorio"), come nuova da registrare
  function duplicate(e) {
    fill({ causaleId: e.causale_id, accountId: e.economic_account_id, amount: e.amount, note: e.note,
           date: e.entry_date, prov: Boolean(e.provisional) });
    if (ctx.account(e.economic_account_id)?.kind !== ctx.causale(e.causale_id)?.kind) stornoKeep = e.economic_account_id;
    amount.focus({ preventScroll: true });
    say('Copia di «' + entryTitle(ctx, e) + '» del ' + fmtDay(e.entry_date) + ': cambia quello che serve e premi Registra.');
  }

  // Preferito: causale, conto, importo e note come salvati; la data è sempre oggi
  function applyFavorite(f) {
    fill({ causaleId: f.causale_id, accountId: f.economic_account_id, amount: f.amount, note: f.note, date: ctx.today });
    (amount.value ? save : amount).focus({ preventScroll: true });
    say('Compilata da «' + f.name + '»: controlla e premi Registra.');
  }

  // Dal "+" del Budget: voce (o causale finanziaria) e importo che manca; data e note da compilare
  function applyPrefill(p) {
    fill({ causaleId: p.causale?.id ?? null, accountId: p.account?.id ?? null, amount: p.amount, note: '', date: '' });
    (p.causale ? date : causaleSel).focus({ preventScroll: true });
    say(p.warning ?? 'Compilata dal Budget: scegli la data e premi Registra.', Boolean(p.warning));
  }

  async function saveFavorite() {
    clearMsg();
    error.hidden = true;
    const c = ctx.causale(causaleSel.value);
    const a = J.needsEconomic(c) ? ctx.account(accountSel.value) ?? null : null;
    const value = amount.value.trim() === '' ? null : parseAmount(amount.value);
    const errors = J.validateFavorite({ name: 'x', causale: c, account: a, amount: value });
    if (errors.length) {
      error.textContent = errors.join(' ');
      error.hidden = false;
      return;
    }
    const detail = [c.code + ' · ' + c.description, a?.name, value != null && fmtAmount(value) + ' €', note.value.trim()]
      .filter(Boolean).join(' · ');
    const res = await promptBox({ title: 'Salvare tra i preferiti?',
      lines: [detail, 'La data non si salva: richiamando il preferito sarà quella di oggi.'],
      label: 'Nome', value: J.favoriteName(c, a), ok: 'Salva preferito' });
    if (!res) return;
    try {
      await rows(sb.from('favorites').insert(J.buildFavorite(res.value, c, a?.id, value, note.value)));
      await loadFavorites(ctx);
      say('Preferito «' + res.value + '» salvato.');
    } catch (e) {
      error.textContent = 'Preferito non salvato: ' + e.message + '.';
      error.hidden = false;
    }
  }

  // Registrazione periodica: dai dati del form, una tabella di movimenti (uno per periodo) da rivedere
  // riga per riga (data, importo, note); nascono tutti provvisori e si confermano quando arrivano.
  function openPeriodic() {
    clearMsg();
    error.hidden = true;
    const c = ctx.causale(causaleSel.value);
    const a = J.needsEconomic(c) ? ctx.account(accountSel.value) ?? null : null;
    const value = amount.value.trim() === '' ? null : parseAmount(amount.value);
    const errors = J.validateEntry({ causale: c, account: a, date: date.value || ctx.today, amount: value ?? 1,
                                    stornoId: stornoKeep }, ctx.years);
    if (errors.length) {
      error.textContent = errors.join(' ');
      error.hidden = false;
      return;
    }

    const first = h('input', { type: 'date', value: date.value || ctx.today });
    const until = h('input', { type: 'month', value: (date.value || ctx.today).slice(0, 4) + '-12' });
    const step = h('select', null, [[1, 'ogni mese'], [2, 'ogni 2 mesi'], [3, 'ogni 3 mesi'], [6, 'ogni 6 mesi'], [12, 'ogni anno']]
      .map(([v, t]) => h('option', { value: v }, t)));
    const body = h('tbody');
    const count = h('button', { type: 'submit' });
    const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
    let lines = [];

    // la tabella si rigenera quando cambiano prima data, frequenza o "fino a"
    function generate() {
      const dates = J.periodicDates(first.value, until.value, +step.value);
      lines = dates.map((d) => ({
        on: h('input', { type: 'checkbox', checked: true, 'aria-label': 'Registra il ' + fmtDay(d) }),
        date: h('input', { type: 'date', value: d, 'aria-label': 'Data' }),
        amount: h('input', { inputmode: 'decimal', autocomplete: 'off', placeholder: '0,00', 'aria-label': 'Importo',
                             value: value != null ? fmtAmount(value) : '' }),
        note: h('input', { autocomplete: 'off', 'aria-label': 'Note', value: note.value.trim() })
      }));
      body.replaceChildren(...(lines.length
        ? lines.map((l) => {
            const tr = h('tr', null, h('td', null, l.on), h('td', null, l.date), h('td', null, l.amount), h('td', null, l.note));
            l.on.addEventListener('change', () => { tr.classList.toggle('off', !l.on.checked); countLabel(); });
            return tr;
          })
        : [h('tr', null, h('td', { colspan: 4, class: 'muted' }, 'Nessuna data: controlla la prima data e «fino a».'))]));
      countLabel();
    }
    const countLabel = () => {
      const n = lines.filter((l) => l.on.checked).length;
      count.textContent = n === 1 ? 'Registra 1 movimento provvisorio' : `Registra ${n} movimenti provvisori`;
      count.disabled = !n;
    };
    for (const x of [first, until, step]) x.addEventListener('change', generate);

    const detail = [c.code + ' · ' + c.description, a?.name].filter(Boolean).join(' · ');
    const form = h('form', { method: 'dialog', novalidate: true },
      h('h2', null, 'Registrazione periodica'),
      h('p', null, detail),
      h('div', { class: 'periodic-controls' },
        h('label', { class: 'field' }, 'Prima data', first),
        h('label', { class: 'field' }, 'Frequenza', step),
        h('label', { class: 'field' }, 'Fino a', until)),
      h('p', { class: 'hint' }, 'Nascono tutti come movimenti provvisori: non entrano nei calcoli finché non li confermi dal Giornale, quando arrivano alla loro data. Puoi cambiare data, importo e note di ogni riga, o togliere la spunta per saltarla.'),
      h('div', { class: 'table-wrap periodic-wrap' },
        h('table', { class: 'list periodic' },
          h('thead', null, h('tr', null, h('th', { scope: 'col' }, ''), h('th', { scope: 'col' }, 'Data'),
            h('th', { scope: 'col' }, 'Importo (€)'), h('th', { scope: 'col' }, 'Note'))),
          body)),
      err,
      h('div', { class: 'actions' }, count,
        h('button', { type: 'button', class: 'quiet', onclick: () => { dlg.close(); } }, 'Annulla')));

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      err.hidden = true;
      const recs = [];
      const problems = [];
      for (const l of lines.filter((x) => x.on.checked)) {
        const v = parseAmount(l.amount.value);
        const e = J.validateEntry({ causale: c, account: a, date: l.date.value, amount: v, stornoId: stornoKeep }, ctx.years);
        l.date.setAttribute('aria-invalid', String(e.some((t) => /data|anno/i.test(t))));
        l.amount.setAttribute('aria-invalid', String(e.some((t) => /importo/i.test(t))));
        if (e.length) problems.push((l.date.value ? fmtDay(l.date.value) + '/' + l.date.value.slice(0, 4) : 'riga senza data') + ': ' + e.join(' '));
        else recs.push(J.buildEntry(c, a?.id ?? null, l.date.value, v, l.note.value, true));
      }
      if (problems.length) {
        err.textContent = problems.join(' · ');
        err.hidden = false;
        return;
      }
      count.disabled = true;
      try {
        await rows(sb.from('entries').insert(recs));
        dlg.close();
        reset(true);
        await Promise.all([loadEntries(ctx), loadMatured(ctx)]);
        const days = recs.map((r) => r.entry_date).sort();
        const full = (d) => fmtDay(d) + '/' + d.slice(0, 4);
        say(recs.length === 1 ? `Salvato 1 movimento provvisorio, il ${full(days[0])}.`
          : `Salvati ${recs.length} movimenti provvisori, dal ${full(days[0])} al ${full(days.at(-1))}.`);
      } catch (e2) {
        err.textContent = 'Movimenti non salvati: ' + e2.message + '.';
        err.hidden = false;
        count.disabled = false;
      }
    });

    const dlg = h('dialog', { class: 'sheet wide' }, form);
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    generate();
    dlg.showModal();
  }

  async function submit(ev) {
    ev.preventDefault();
    clearMsg();
    error.hidden = true;
    const c = ctx.causale(causaleSel.value);
    const a = J.needsEconomic(c) ? ctx.account(accountSel.value) : null;
    const value = parseAmount(amount.value);
    const errors = J.validateEntry({ causale: c, account: a, date: date.value, amount: value,
                                    stornoId: editing?.economic_account_id ?? stornoKeep }, ctx.years);
    if (errors.length) {
      error.textContent = errors.join(' ');
      error.hidden = false;
      return;
    }
    const rec = J.buildEntry(c, a?.id ?? null, date.value, value, note.value, provisional.checked);
    save.disabled = true;
    try {
      if (editing) await rows(sb.from('entries').update(rec).eq('id', editing.id));
      else await rows(sb.from('entries').insert(rec));
      const elsewhere = !date.value.startsWith(J.monthParam(ctx.view));
      const confirmed = Boolean(editing?.provisional && !rec.provisional);
      const what = confirmed ? 'Movimento confermato'
        : rec.provisional ? (editing ? 'Movimento provvisorio aggiornato' : 'Movimento provvisorio salvato')
        : editing ? 'Modifica salvata' : 'Registrazione salvata';
      reset(false);
      await Promise.all([loadEntries(ctx), loadMatured(ctx)]);
      say(what + (elsewhere ? ' in ' + monthLabel(+rec.entry_date.slice(0, 4), +rec.entry_date.slice(5, 7)) : '') + '.');
    } catch (e) {
      error.textContent = 'Registrazione non salvata: ' + e.message + '.';
      error.hidden = false;
    } finally {
      save.disabled = false;
    }
  }

  async function remove() {
    const e = editing;
    const ok = await confirmBox({ title: e.provisional ? 'Eliminare il movimento provvisorio?' : 'Eliminare la registrazione?',
      lines: [fmtDay(e.entry_date) + ' · ' + (e.economic_account_name || e.causale_code) + ' · ' + fmtAmount(e.amount) + ' €',
              'L\'operazione non si può annullare.'],
      ok: 'Elimina', danger: true });
    if (!ok) return;
    try {
      await rows(sb.from('entries').delete().eq('id', e.id));
      reset(true);
      await Promise.all([loadEntries(ctx), loadMatured(ctx)]);
      say(e.provisional ? 'Movimento provvisorio eliminato.' : 'Registrazione eliminata.');
    } catch (err) {
      error.textContent = 'Eliminazione non riuscita: ' + err.message + '.';
      error.hidden = false;
    }
  }

  const el = h('form', { class: 'entry-form', novalidate: true, onsubmit: submit },
    h('div', { class: 'form-head' }, title, h('div', { class: 'head-buttons' }, repeat, star)),
    h('div', { class: 'field' }, h('label', { for: 'j-causale' }, 'Causale'), causaleSel, fixedInfo),
    accountField,
    h('div', { class: 'pair' },
      h('div', { class: 'field' }, h('label', { for: 'j-date' }, 'Data'),
        h('div', { class: 'date-row' }, date, todayBtn)),
      h('div', { class: 'field' }, h('label', { for: 'j-amount' }, 'Importo (€)'), amount)),
    h('div', { class: 'field' }, h('label', { for: 'j-note' }, 'Note'), note),
    h('label', { class: 'check prov-check', for: 'j-prov' }, provisional, ' Movimento provvisorio'),
    provHint,
    alertBox,
    error,
    h('div', { class: 'actions' }, save, cancel, del));

  reset(true);
  return { el, edit, duplicate, applyFavorite, applyPrefill, editingId: () => editing?.id };
}

// Icone (stella, ripeti, copia): simboli SVG di index.html
function icon(id) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'ico');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#' + id);
  svg.append(use);
  return svg;
}
