// Saldi patrimoniali: funzioni pure (primo pezzo del motore di calcolo).
import { round2 } from '../format.js';

// Patrimonio = somma dei conti attivi − somma dei conti passivi, su tutti i conti patrimoniali.
// amounts: Map o oggetto { account_id: importo naturale } (un debito è positivo).
export function netWorth(accounts, amounts) {
  const get = (id) => Number((amounts instanceof Map ? amounts.get(id) : amounts[id]) || 0);
  let attivo = 0;
  let passivo = 0;
  for (const a of accounts) {
    if (a.type !== 'patrimoniale') continue;
    if (a.side === 'passivo') passivo += get(a.id);
    else attivo += get(a.id);
  }
  return { attivo: round2(attivo), passivo: round2(passivo), patrimonio: round2(attivo - passivo) };
}
