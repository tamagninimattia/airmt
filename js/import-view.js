// Importazione del Giornale da Excel (vista Importa da Excel, sotto Impostazioni): riquadro con il file da trascinare,
// anteprima con l'abbinamento dei nomi, elenco delle importazioni con "Annulla".
import { sb, rows, rowsAll, countRows } from './db.js';
import { h, say, clearMsg, confirmBox } from './ui.js';
import * as I from './import-model.js';
import { sortByOrder } from './settings-model.js';
import { MONTHS, fmtAmount, fmtDay } from './format.js';

// SheetJS legge i file .xlsx; si carica solo al primo file trascinato
const XLSX_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
const MAP_KEY = 'import.abbinamenti';

const TEMPLATE = '﻿Data;Da;A;Importo;Note;Causale\n' +
  '03/01/2026;Conto corrente FINECO;Ristoranti;42,50;cena;\n' +
  '27/01/2026;Emolumenti mensili;Conto corrente FINECO;1800,00;;\n' +
  '12/02/2026;Conto corrente FINECO;Portafoglio;250,00;bancomat;\n';

function loadMapping() {
  try { return JSON.parse(localStorage.getItem(MAP_KEY)) || {}; } catch { return {}; }
}
function saveMapping(m) {
  try { localStorage.setItem(MAP_KEY, JSON.stringify(m)); } catch { /* ignorato */ }
}

let xlsxPromise = null;
function loadXlsx() {
  xlsxPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = XLSX_URL;
    s.onload = () => resolve(window.XLSX);
    s.onerror = () => { xlsxPromise = null; reject(new Error('non riesco a caricare il lettore dei file Excel: controlla la connessione')); };
    document.head.append(s);
  });
  return xlsxPromise;
}

// File -> righe { line, cells }: primo foglio dell'Excel, oppure CSV
async function readFile(file) {
  if (/\.(csv|txt)$/i.test(file.name)) return I.splitRows(await file.text());
  if (!/\.(xlsx|xlsm|xls)$/i.test(file.name)) throw new Error('il file deve essere un Excel (.xlsx) o un CSV');
  const XLSX = await loadXlsx();
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return I.sheetRows(XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' }));
}

/**
 * Riquadro "Importa da Excel". ctx: { accounts, causali, years }; onDone(): dopo un'importazione
 * o un annullamento (il Giornale ricarica le registrazioni).
 */
export function importCard(ctx, onDone) {
  const list = h('div', { class: 'imports' });
  const picker = h('input', { type: 'file', accept: '.xlsx,.xlsm,.xls,.csv', hidden: true });
  const drop = h('div', { class: 'drop', tabindex: '0', role: 'button',
                          'aria-label': 'Trascina qui il file Excel, oppure premi per sceglierlo' },
    h('strong', null, 'Trascina qui il file Excel'),
    h('span', null, 'oppure clicca per sceglierlo (.xlsx o .csv)'));

  async function take(file) {
    if (!file) return;
    clearMsg();
    drop.classList.add('busy');
    try {
      const table = await readFile(file);
      if (!table.length) throw new Error('il file è vuoto');
      await openPreview(ctx, table, file.name, async () => { await loadImports(); await onDone(); });
    } catch (e) {
      say('File non letto: ' + e.message + '.', true);
    } finally {
      drop.classList.remove('busy');
      picker.value = '';
    }
  }

  drop.addEventListener('click', () => picker.click());
  drop.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); picker.click(); } });
  picker.addEventListener('change', () => take(picker.files[0]));
  drop.addEventListener('dragover', (ev) => { ev.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (ev) => { ev.preventDefault(); drop.classList.remove('over'); take(ev.dataTransfer.files[0]); });

  async function loadImports() {
    try {
      const items = await rows(sb.from('imports').select('id, label, created_at').order('created_at', { ascending: false }));
      const counts = await Promise.all(items.map((x) => countRows('entries', (q) => q.eq('import_id', x.id))));
      list.replaceChildren(items.length
        ? h('ul', null, items.map((x, i) => h('li', null,
            h('div', null, h('strong', null, x.label),
              h('small', null, new Date(x.created_at).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }) +
                ' · ' + counts[i] + ' registrazioni')),
            h('button', { type: 'button', class: 'quiet small danger', onclick: () => undo(x, counts[i]) }, 'Annulla'))))
        : h('p', { class: 'muted' }, 'Nessuna importazione.'));
    } catch (e) {
      list.replaceChildren(h('p', { class: 'muted' }, 'Importazioni non disponibili: ' + e.message + '. Hai eseguito migrazione_importazioni.sql?'));
    }
  }

  async function undo(x, n) {
    const ok = await confirmBox({ title: 'Annullare l\'importazione?', ok: 'Annulla importazione', danger: true,
      lines: [x.label, `Si eliminano le sue ${n} registrazioni, anche se nel frattempo le hai modificate. Non si può tornare indietro.`] });
    if (!ok) return;
    try {
      await rows(sb.from('imports').delete().eq('id', x.id));
      await loadImports();
      await onDone();
      say(`Importazione annullata: eliminate ${n} registrazioni.`);
    } catch (e) {
      say('Importazione non annullata: ' + e.message + '.', true);
    }
  }

  loadImports();
  return h('section', { class: 'card import-card', 'aria-labelledby': 'imp-title' },
    h('h2', { id: 'imp-title' }, 'Carica un file'),
    h('p', { class: 'hint' }, 'Una riga per registrazione: Data, Da (da dove escono i soldi), A (dove vanno), Importo, Note. ',
      h('a', { href: 'data:text/csv;charset=utf-8,' + encodeURIComponent(TEMPLATE), download: 'modello-giornale.csv' }, 'Scarica il modello'), '.'),
    drop, picker,
    h('h3', null, 'Importazioni fatte'),
    list);
}

// Anteprima: abbinamento dei nomi sconosciuti, righe pronte ed errori, doppioni, poi importazione
async function openPreview(ctx, table, fileName, onDone) {
  const mapping = loadMapping();
  const dates = table.map((r) => I.parseDate(r.cells[0])).filter(Boolean).sort();
  // registrazioni già presenti nel periodo del file, per segnalare i possibili doppioni
  const existing = dates.length ? await rowsAll(() => sb.from('entries')
    .select('id, entry_date, debit_account_id, credit_account_id, amount')
    .gte('entry_date', dates[0]).lte('entry_date', dates.at(-1)).order('entry_date').order('id')) : [];
  const existingKeys = new Set(existing.map(I.dupKey));

  const body = h('div');
  const go = h('button', { type: 'submit' });
  const withDups = h('input', { type: 'checkbox' });
  const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
  let ready = [];

  const options = () => {
    const group = (label, items) => h('optgroup', { label }, items.map((a) => h('option', { value: a.id }, a.name)));
    const by = (f) => sortByOrder(ctx.accounts.filter(f));
    return [h('option', { value: '' }, 'Scegli il conto…'),
      group('Conti patrimoniali', by((a) => a.type === 'patrimoniale')),
      group('Voci di costo', by((a) => a.type === 'economico' && a.kind === 'costo')),
      group('Voci di ricavo', by((a) => a.type === 'economico' && a.kind === 'ricavo'))];
  };

  // Causali che mancano per alcune righe: elenco e creazione in un colpo, poi l'anteprima si ricalcola
  function missingSection(list) {
    if (!list.length) return null;
    const name = (id) => ctx.accounts.find((a) => a.id === id)?.name ?? '–';
    const side = (rec, which) => (rec.kind === 'costo' && which === 'debit') || (rec.kind === 'ricavo' && which === 'credit')
      ? h('em', { class: 'muted' }, 'la voce') : name(rec[which + '_account_id']);
    const rowsCount = list.reduce((t, x) => t + x.count, 0);
    const create = h('button', { type: 'button' }, list.length === 1 ? 'Crea 1 causale' : `Crea ${list.length} causali`);
    create.addEventListener('click', async () => {
      create.disabled = true;
      error.hidden = true;
      try {
        await rows(sb.from('causali').insert(list.map((x) => x.rec)));
        // le nuove causali entrano nei dati del Giornale (stessa lista): servono anche al form
        const fresh = await rows(sb.from('causali').select('*'));
        ctx.causali.splice(0, ctx.causali.length, ...fresh);
        paint();
        say(`Create ${list.length} causali: ${list.map((x) => x.rec.code).join(', ')}.`);
      } catch (e) {
        error.textContent = 'Causali non create: ' + e.message + '.';
        error.hidden = false;
        create.disabled = false;
      }
    });
    return [
      h('h3', null, 'Causali mancanti'),
      h('p', { class: 'hint' }, `${rowsCount === 1 ? '1 riga non ha' : rowsCount + ' righe non hanno'} una causale per la sua coppia di conti. ` +
        'Le creo con codici e descrizioni come quelli della finestra «Causali» dei conti; dopo potrai modificarle nelle Impostazioni.'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
        h('thead', null, h('tr', null, h('th', null, 'Codice'), h('th', null, 'Descrizione'), h('th', null, 'Dare'),
          h('th', null, 'Avere'), h('th', { class: 'num' }, 'Righe'))),
        h('tbody', null, list.map((x) => h('tr', null,
          h('td', null, h('code', null, x.rec.code)), h('td', null, x.rec.description),
          h('td', null, side(x.rec, 'debit')), h('td', null, side(x.rec, 'credit')), h('td', { class: 'num' }, x.count)))))),
      h('div', { class: 'actions tight' }, create)];
  }

  function paint() {
    const { rows: parsed } = I.parseImport(table, { ...ctx, mapping });
    const ok = parsed.filter((r) => r.rec);
    const bad = parsed.filter((r) => r.error);
    for (const r of ok) r.dup = existingKeys.has(I.dupKey(r.rec));
    ready = ok.filter((r) => withDups.checked || !r.dup);
    const dups = ok.filter((r) => r.dup).length;
    const unknown = I.unknownNames(table, ctx.accounts, mapping);
    const mapped = Object.keys(mapping).filter((k) => table.some((r) => [r.cells[1], r.cells[2]]
      .some((c) => String(c ?? '').trim().replace(/\s+/g, ' ').toLowerCase() === k)));

    const mapRow = (name, key) => {
      const sel = h('select', { 'aria-label': 'Conto per «' + name + '»' }, options());
      sel.value = mapping[key] || '';
      sel.addEventListener('change', () => {
        if (sel.value) mapping[key] = sel.value; else delete mapping[key];
        saveMapping(mapping);
        paint();
      });
      return h('tr', null, h('td', null, name), h('td', null, sel));
    };

    body.replaceChildren(h('div', null,
      (unknown.length > 0 || mapped.length > 0) && [
        h('h3', null, 'Abbina i nomi'),
        h('p', { class: 'hint' }, 'Nomi del file che non corrispondono a un conto dell\'app: scegli il conto una volta, vale per tutte le righe e per le prossime importazioni.'),
        h('div', { class: 'table-wrap' }, h('table', { class: 'list map-table' },
          h('thead', null, h('tr', null, h('th', null, 'Nel file'), h('th', null, 'Conto dell\'app'))),
          h('tbody', null, unknown.map((n) => mapRow(n, n.toLowerCase())),
            mapped.map((k) => mapRow(k, k)))))],
      missingSection(I.missingCausali(parsed, ctx.accounts, ctx.causali)),
      h('h3', null, 'Riepilogo'),
      h('ul', { class: 'checks' },
        h('li', { class: ok.length ? 'ok' : 'warn' }, ok.length === 1 ? '1 riga pronta' : `${ok.length} righe pronte`),
        bad.length > 0 && h('li', { class: 'warn' }, bad.length === 1 ? '1 riga con errori: non si importa' : `${bad.length} righe con errori: non si importano`),
        dups > 0 && h('li', { class: 'warn' }, (dups === 1 ? '1 possibile doppione' : `${dups} possibili doppioni`) + ' (stessa data, conti e importo già nel Giornale)')),
      dups > 0 && h('label', { class: 'check' }, withDups, ' Importa anche i possibili doppioni'),
      ok.length > 0 && h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
        h('thead', null, h('tr', null, h('th', null, 'Mese'), h('th', { class: 'num' }, 'Righe'),
          h('th', { class: 'num' }, 'Ricavi'), h('th', { class: 'num' }, 'Costi'), h('th', { class: 'num' }, 'Tra conti'))),
        h('tbody', null, I.monthSummary(ok).map((s) => h('tr', null,
          h('td', null, MONTHS[+s.month.slice(5) - 1] + ' ' + s.month.slice(0, 4)), h('td', { class: 'num' }, s.count),
          h('td', { class: 'num' }, fmtAmount(s.ricavi)), h('td', { class: 'num' }, fmtAmount(s.costi)),
          h('td', { class: 'num' }, fmtAmount(s.finanziarie))))))),
      bad.length > 0 && h('details', { open: true }, h('summary', null, 'Righe con errori'),
        h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
          h('thead', null, h('tr', null, h('th', { class: 'num' }, 'Riga'), h('th', null, 'Da → A'), h('th', null, 'Problema'))),
          h('tbody', null, bad.map((r) => h('tr', null, h('td', { class: 'num' }, r.line),
            h('td', null, `${r.fromName || '–'} → ${r.toName || '–'}`), h('td', { class: 'warn' }, r.error))))))),
      ok.length > 0 && h('details', null, h('summary', null, 'Righe pronte'),
        h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
          h('thead', null, h('tr', null, h('th', null, 'Data'), h('th', null, 'Causale'), h('th', null, 'Da → A'),
            h('th', { class: 'num' }, 'Importo'), h('th', null, 'Note'))),
          h('tbody', null, ok.map((r) => h('tr', { class: r.dup ? 'dup' : null },
            h('td', null, fmtDay(r.date) + '/' + r.date.slice(0, 4)), h('td', null, h('code', null, r.causale.code)),
            h('td', null, `${r.fromName} → ${r.toName}`), h('td', { class: 'num' }, fmtAmount(r.amount)),
            h('td', { class: 'muted' }, r.note, r.dup && h('span', { class: 'badge alert' }, 'doppione?'))))))))));
    go.textContent = ready.length === 1 ? 'Importa 1 registrazione' : `Importa ${ready.length} registrazioni`;
    go.disabled = ready.length === 0;
  }

  withDups.addEventListener('change', paint);

  const form = h('form', { novalidate: true },
    h('h2', null, 'Importa «' + fileName + '»'),
    body, error,
    h('div', { class: 'actions' }, go, h('button', { type: 'button', class: 'quiet', onclick: () => shut() }, 'Annulla')));
  const dlg = h('dialog', { class: 'sheet wide' }, form);
  const shut = () => { dlg.close(); dlg.remove(); };
  dlg.addEventListener('close', () => dlg.remove());

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    error.hidden = true;
    go.disabled = true;
    const months = [...new Set(ready.map((r) => r.date.slice(0, 7)))].sort();
    const span = months.length > 1 ? `${months[0]} – ${months.at(-1)}` : months[0];
    let imp = null;
    try {
      imp = await rows(sb.from('imports').insert({ label: `${fileName} · ${span}` }).select().single());
      for (let i = 0; i < ready.length; i += 500) {
        await rows(sb.from('entries').insert(ready.slice(i, i + 500).map((r) => ({ ...r.rec, import_id: imp.id }))));
      }
      shut();
      await onDone();
      say(`Importate ${ready.length} registrazioni da «${fileName}». Se qualcosa non va, «Annulla» nel riquadro Importa da Excel le elimina tutte.`);
    } catch (e) {
      // a metà strada: si elimina l'importazione, che si porta via le righe già inserite
      if (imp) await sb.from('imports').delete().eq('id', imp.id);
      error.textContent = 'Importazione non riuscita, nessuna registrazione salvata: ' + e.message + '.';
      error.hidden = false;
      go.disabled = false;
    }
  });

  paint();
  document.body.append(dlg);
  dlg.showModal();
}
