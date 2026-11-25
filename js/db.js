// Client Supabase e piccoli aiuti per le query.
// URL e chiave anon (pubblica) stanno in index.html, in window.APP_CONFIG.

const cfg = window.APP_CONFIG || {};

export const configured = Boolean(cfg.url && cfg.anonKey)
  && !cfg.url.includes('TUO-PROGETTO') && !cfg.anonKey.startsWith('LA-TUA');

export const sb = configured ? window.supabase.createClient(cfg.url, cfg.anonKey) : null;

// Errori di Postgres più comuni, spiegati
const MESSAGES = {
  '23505': 'esiste già un elemento con lo stesso nome, codice o descrizione',
  '23503': 'è collegato ad altri dati (registrazioni o causali)',
  '23514': 'la combinazione dei campi non è valida',
  '42501': 'permesso negato: esci e rientra'
};

export function friendly(error) {
  return new Error(MESSAGES[error.code] || error.message);
}

// Esegue una query e restituisce i dati, o lancia un errore leggibile
export async function rows(query) {
  const { data, error } = await query;
  if (error) throw friendly(error);
  return data;
}

// Legge tutte le righe a pagine: Supabase ne restituisce al massimo 1000 per richiesta.
// build() deve creare ogni volta la stessa query, con un ordinamento stabile.
export async function rowsAll(build, pageSize = 1000) {
  const out = [];
  for (let from = 0; ; from += pageSize) {
    const page = await rows(build().range(from, from + pageSize - 1));
    out.push(...page);
    if (page.length < pageSize) return out;
  }
}

// Conta le righe di una tabella; filter riceve la query e aggiunge i filtri
export async function countRows(table, filter = (q) => q) {
  const { count, error } = await filter(sb.from(table).select('*', { count: 'exact', head: true }));
  if (error) throw friendly(error);
  return count;
}
