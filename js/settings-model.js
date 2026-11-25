// Regole delle Impostazioni (conti e causali): funzioni pure, senza DOM né Supabase.

// Gruppi dei conti patrimoniali. La natura (attivo/passivo) dipende dal gruppo.
export const GROUPS = [
  { value: 'disponibilita', label: 'Disponibilità',    side: 'attivo' },
  { value: 'immobilizzato', label: 'Immobilizzazioni', side: 'attivo' },
  { value: 'crediti',       label: 'Crediti',          side: 'attivo' },
  { value: 'debiti',        label: 'Debiti',           side: 'passivo' }
];

export const CAUSALE_KINDS = [
  { value: 'finanziaria', label: 'Finanziaria', plural: 'Causali finanziarie' },
  { value: 'ricavo',      label: 'Ricavo',      plural: 'Causali di ricavo' },
  { value: 'costo',       label: 'Costo',       plural: 'Causali di costo' }
];

// Causali finanziarie con budget calcolato dall'app (vedi CLAUDE.md)
export const BUDGET_RULES = [
  { value: '',               short: 'manuale',               label: 'Manuale: lo inserisci tu nel Budget' },
  { value: 'card_giroconto', short: 'calcolato (giroconto)', label: 'Calcolato: costi su carta − ricavi su carta del mese' },
  { value: 'card_addebito',  short: 'calcolato (addebito)',  label: 'Calcolato: giroconto carta del mese precedente' },
  { value: 'mt_rimborso',    short: 'calcolato (rimborsi)',  label: 'Calcolato: anticipi MT del mese precedente' }
];

export const sideOfGroup = (grp) => GROUPS.find((g) => g.value === grp)?.side ?? null;
export const groupLabel = (grp) => GROUPS.find((g) => g.value === grp)?.label ?? grp;
export const ruleShort = (rule) => BUDGET_RULES.find((r) => r.value === (rule || ''))?.short ?? rule;

const sameText = (a, b) => (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();

export function sortByOrder(list, textKey = 'name') {
  return [...list].sort((a, b) =>
    (a.sort_order - b.sort_order) || String(a[textKey]).localeCompare(String(b[textKey]), 'it'));
}

// Raggruppa mantenendo l'ordine di prima comparsa (la lista va ordinata prima)
export function groupBy(list, keyFn) {
  const map = new Map();
  for (const item of list) {
    const k = keyFn(item);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(item);
  }
  return map;
}

export function nextOrder(list) {
  return list.reduce((max, x) => Math.max(max, x.sort_order || 0), 0) + 1;
}

function toOrder(v) {
  const n = Number(v);
  return Number.isInteger(n) ? n : NaN;
}

// ---------------------------------------------------------------------
// Conti
// ---------------------------------------------------------------------

// v: valori del form (stringhe e booleani). Restituisce il record per la tabella accounts.
export function buildAccount(type, v) {
  const base = {
    name: (v.name || '').trim(),
    type,
    sort_order: toOrder(v.sort_order),
    active: Boolean(v.active)
  };
  if (type === 'patrimoniale') {
    return { ...base, grp: v.grp || null, side: sideOfGroup(v.grp), kind: null,
             standard_causale_id: null, is_contingency: false, budget_section: null };
  }
  return { ...base, kind: v.kind || null, side: null, grp: null,
           budget_section: (v.budget_section || '').trim() || null,
           standard_causale_id: v.standard_causale_id || null,
           is_contingency: v.kind === 'costo' && Boolean(v.is_contingency) };
}

export function validateAccount(acc, id, accounts, causali) {
  const errors = [];
  const others = accounts.filter((a) => a.id !== id);

  if (!acc.name) errors.push('Inserisci il nome del conto.');
  else if (others.some((a) => sameText(a.name, acc.name))) {
    errors.push(`Esiste già un conto chiamato «${acc.name}»: scegli un altro nome.`);
  }
  if (Number.isNaN(acc.sort_order)) errors.push('L\'ordine deve essere un numero intero.');

  if (acc.type === 'patrimoniale') {
    if (!sideOfGroup(acc.grp)) errors.push('Scegli il gruppo del conto.');
  } else {
    if (acc.kind !== 'ricavo' && acc.kind !== 'costo') errors.push('Scegli se la voce è un ricavo o un costo.');
    if (acc.standard_causale_id) {
      const c = causali.find((x) => x.id === acc.standard_causale_id);
      if (!c) errors.push('Il canale standard scelto non esiste più: scegline un altro.');
      else if (c.kind !== acc.kind) {
        errors.push(`Il canale standard di un ${acc.kind} deve essere una causale di ${acc.kind}.`);
      }
    }
    if (acc.is_contingency) {
      const other = others.find((a) => a.is_contingency);
      if (other) errors.push(`La voce degli imprevisti è già «${other.name}»: togli prima la spunta lì.`);
    }
  }
  return errors;
}

// Campi che non si possono più cambiare: con registrazioni esistenti cambierebbe
// il significato dei movimenti già fatti.
export function accountLocks(acc, usage) {
  const used = (usage?.entries || 0) > 0;
  return {
    kind: used,                                  // ricavo <-> costo
    side: used || (usage?.causali?.length || 0) > 0 // attivo <-> passivo (il gruppo resta libero nella stessa natura)
  };
}

// ---------------------------------------------------------------------
// Causali
// ---------------------------------------------------------------------

export function buildCausale(v) {
  const kind = v.kind || null;
  return {
    code: (v.code || '').trim().toUpperCase(),
    description: (v.description || '').trim(),
    kind,
    debit_account_id:  kind === 'costo'  ? null : (v.debit_account_id  || null),
    credit_account_id: kind === 'ricavo' ? null : (v.credit_account_id || null),
    grp: (v.grp || '').trim() || null,
    budget_rule: kind === 'finanziaria' ? (v.budget_rule || null) : null,
    sort_order: toOrder(v.sort_order),
    active: Boolean(v.active)
  };
}

export function validateCausale(c, id, causali, accounts) {
  const errors = [];
  const others = causali.filter((x) => x.id !== id);
  const acc = (aid) => accounts.find((a) => a.id === aid);

  if (!/^[A-Z0-9]{2,12}$/.test(c.code)) {
    errors.push('Il codice va scritto con 2–12 lettere o cifre, senza spazi (es. COSFIN).');
  } else if (others.some((x) => x.code === c.code)) {
    errors.push(`Il codice ${c.code} è già usato da un'altra causale.`);
  }
  if (!c.description) errors.push('Inserisci la descrizione.');
  else if (others.some((x) => sameText(x.description, c.description))) {
    errors.push('Un\'altra causale ha già questa descrizione.');
  }
  if (Number.isNaN(c.sort_order)) errors.push('L\'ordine deve essere un numero intero.');

  const needDebit = c.kind === 'finanziaria' || c.kind === 'ricavo';
  const needCredit = c.kind === 'finanziaria' || c.kind === 'costo';
  if (!CAUSALE_KINDS.some((k) => k.value === c.kind)) errors.push('Scegli il tipo di causale.');
  if (needDebit && !c.debit_account_id) errors.push('Scegli il conto Dare.');
  if (needCredit && !c.credit_account_id) errors.push('Scegli il conto Avere.');
  for (const aid of [c.debit_account_id, c.credit_account_id]) {
    if (aid && acc(aid)?.type !== 'patrimoniale') errors.push('I conti fissi di una causale devono essere patrimoniali.');
  }
  if (c.debit_account_id && c.debit_account_id === c.credit_account_id) {
    errors.push('Il conto Dare e il conto Avere devono essere diversi.');
  }
  if (c.budget_rule) {
    const other = others.find((x) => x.budget_rule === c.budget_rule);
    if (other) errors.push(`Questo budget calcolato è già assegnato a ${other.code}: toglilo prima lì.`);
  }
  return errors;
}

export function causaleLocks(usage) {
  const used = (usage?.entries || 0) > 0;
  return {
    accounts: used,                                       // conti fissi Dare/Avere
    kind: used || (usage?.standardFor?.length || 0) > 0   // tipo
  };
}

// ---------------------------------------------------------------------
// Causali collegate a un conto patrimoniale (finestra "Crea le causali")
// ---------------------------------------------------------------------

const GENERIC = new Set(['CONTO', 'CORRENTE', 'CARTA', 'DI', 'DA', 'DEL', 'DELLA', 'CREDITO', 'DEBITO', 'VS', 'VERSO', 'C', 'CC']);

// Sigla del conto usata nei codici (COS+sigla, RIC+sigla, sigla+sigla per i trasferimenti).
// Se il conto ha già una causale di costo o ricavo la sigla si ricava da lì (COSFIN -> FIN),
// altrimenti dalla prima parola significativa del nome (Conto Arancio -> ARA).
export function accountAbbr(account, causali) {
  const own = causali.find((c) => c.kind === 'costo' && c.credit_account_id === account.id && c.code.startsWith('COS'))
           ?? causali.find((c) => c.kind === 'ricavo' && c.debit_account_id === account.id && c.code.startsWith('RIC'));
  if (own && own.code.length > 3) return own.code.slice(3);
  const words = (account.name || '').toUpperCase().normalize('NFD').replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const word = words.find((w) => !GENERIC.has(w)) ?? words[0] ?? 'X';
  return word.slice(0, 3);
}

export const validAbbr = (abbr) => /^[A-Z0-9]{2,6}$/.test(abbr);

/**
 * Causali proposte per il conto patrimoniale `account` con sigla `abbr`:
 *   { key, section: 'canale' | 'trasferimenti' | 'crediti', label, rec, existing, on }
 * rec: record per la tabella causali (senza sort_order); existing: codice della causale che fa
 * già lo stesso lavoro (stessi conti), da non ricreare; on: spuntata di base (per le disponibilità).
 */
export function causaleProposals(account, abbr, accounts, causali) {
  const out = [];
  const liquid = account.grp === 'disponibilita';
  // Altri crediti e Altri debiti hanno la loro sezione (variazioni crediti/debiti): non sono trasferimenti
  const credits = accounts.find((a) => a.name === 'Altri crediti');
  const debts = accounts.find((a) => a.name === 'Altri debiti');
  const others = sortByOrder(accounts.filter((a) => a.type === 'patrimoniale' && a.id !== account.id && a.active
                                                  && a.id !== credits?.id && a.id !== debts?.id));
  // conto principale (il primo delle disponibilità): i trasferimenti con lui sono spuntati di base
  const main = others.find((a) => a.grp === 'disponibilita');
  const same = (r) => causali.find((c) => c.kind === r.kind
    && (r.kind === 'costo' || c.debit_account_id === r.debit_account_id)
    && (r.kind === 'ricavo' || c.credit_account_id === r.credit_account_id));
  const add = (key, section, label, rec, on) => out.push({ key, section, label, rec, existing: same(rec)?.code ?? null, on });
  const fin = (code, description, debit, credit, grp) =>
    ({ code, description, kind: 'finanziaria', debit_account_id: debit, credit_account_id: credit, grp, budget_rule: null, active: true });

  add('cos', 'canale', 'Costi pagati da ' + account.name,
      { code: 'COS' + abbr, description: 'Costi ' + account.name, kind: 'costo', debit_account_id: null,
        credit_account_id: account.id, grp: 'Costi', budget_rule: null, active: true }, liquid);
  add('ric', 'canale', 'Ricavi incassati su ' + account.name,
      { code: 'RIC' + abbr, description: 'Ricavi ' + account.name, kind: 'ricavo', debit_account_id: account.id,
        credit_account_id: null, grp: 'Ricavi', budget_rule: null, active: true }, liquid);

  for (const o of others) {
    const oa = accountAbbr(o, causali);
    const on = liquid && o.id === main?.id;
    add('out:' + o.id, 'trasferimenti', `da ${account.name} a ${o.name}`,
        fin(abbr + oa, `Trasferimenti ${account.name} -> ${o.name}`, o.id, account.id, 'Trasferimenti'), on);
    add('in:' + o.id, 'trasferimenti', `da ${o.name} a ${account.name}`,
        fin(oa + abbr, `Trasferimenti ${o.name} -> ${account.name}`, account.id, o.id, 'Trasferimenti'), on);
  }

  // variazioni di crediti e debiti via questo conto, come nel piano dei conti iniziale
  if (credits && credits.id !== account.id) {
    add('icred', 'crediti', 'Incremento crediti', fin('ICRED' + abbr, 'Incremento crediti via ' + account.name, credits.id, account.id, 'Crediti'), liquid);
    add('dcre', 'crediti', 'Decremento crediti', fin('DCRE' + abbr, 'Decremento crediti via ' + account.name, account.id, credits.id, 'Crediti'), liquid);
  }
  if (debts && debts.id !== account.id) {
    add('ideb', 'crediti', 'Incremento debiti', fin('IDEB' + abbr, 'Incremento debiti via ' + account.name, account.id, debts.id, 'Debiti'), liquid);
    add('ddeb', 'crediti', 'Decremento debiti', fin('DDEB' + abbr, 'Decremento debiti via ' + account.name, debts.id, account.id, 'Debiti'), liquid);
  }
  return out;
}

// Errori sulle causali scelte: sigla, codici già usati o ripetuti, descrizioni già usate
export function validateProposals(abbr, chosen, causali) {
  const errors = [];
  if (!validAbbr(abbr)) errors.push('La sigla va scritta con 2–6 lettere o cifre, senza spazi (es. ARA).');
  const seen = new Set();
  for (const p of chosen) {
    const { code, description } = p.rec;
    if (!/^[A-Z0-9]{2,12}$/.test(code)) errors.push(`Il codice ${code} è troppo lungo: accorcia la sigla.`);
    else if (causali.some((c) => c.code === code) || seen.has(code)) {
      errors.push(`Il codice ${code} è già usato: cambia la sigla o togli la spunta.`);
    } else if (causali.some((c) => sameText(c.description, description))) {
      errors.push(`Esiste già una causale «${description}».`);
    }
    seen.add(code);
  }
  return errors;
}

// ---------------------------------------------------------------------
// Testi di riepilogo
// ---------------------------------------------------------------------

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function usageSummary(u) {
  const parts = [];
  if (u.entries) parts.push(plural(u.entries, 'registrazione', 'registrazioni'));
  if (u.budget) parts.push(plural(u.budget, 'valore di budget', 'valori di budget'));
  if (u.adjustments) parts.push(plural(u.adjustments, 'riga Var +/-', 'righe Var +/-'));
  if (u.opening) parts.push(plural(u.opening, 'saldo iniziale', 'saldi iniziali'));
  if (u.causali?.length) parts.push('conto fisso di ' + u.causali.map((c) => c.code).join(', '));
  if (u.standardFor?.length) parts.push(plural(u.standardFor.length, 'voce con questo canale standard', 'voci con questo canale standard'));
  return parts.length ? 'Usato in: ' + parts.join(', ') + '.' : 'Non ancora usato.';
}

// Motivo per cui non si può eliminare (null se si può)
export function accountDeleteBlock(u) {
  if (u.entries) {
    return `Non puoi eliminare questo conto: ha ${plural(u.entries, 'registrazione', 'registrazioni')}. ` +
           'Disattivalo invece: togli la spunta «attivo» e salva.';
  }
  if (u.causali?.length) {
    return 'Non puoi eliminare questo conto: è il conto fisso delle causali ' +
           u.causali.map((c) => c.code).join(', ') + '. Modifica o elimina prima quelle causali.';
  }
  return null;
}

export function causaleDeleteBlock(u) {
  if (u.entries) {
    return `Non puoi eliminare questa causale: ha ${plural(u.entries, 'registrazione', 'registrazioni')}. ` +
           'Disattivala invece: togli la spunta «attiva» e salva.';
  }
  return null;
}

// Conseguenze di un'eliminazione, da mostrare nella conferma
export function deleteConsequences(u) {
  const lines = [];
  if (u.budget) lines.push(`Si perdono ${plural(u.budget, 'valore di budget', 'valori di budget')} diversi da zero.`);
  if (u.adjustments) lines.push(`Si perdono ${plural(u.adjustments, 'riga Var +/-', 'righe Var +/-')}.`);
  if (u.opening) lines.push(`Si perdono ${plural(u.opening, 'saldo iniziale', 'saldi iniziali')} diversi da zero.`);
  if (u.standardFor?.length) {
    lines.push('Restano senza canale standard: ' + u.standardFor.map((a) => a.name).join(', ') + '.');
  }
  lines.push('L\'operazione non si può annullare.');
  return lines;
}
