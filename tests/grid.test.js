// Colori delle celle della griglia (grid.js)
import { test, eq } from './runner.js';
import { setNum } from '../js/grid.js';

const cell = () => document.createElement('td');
const state = (td) => [td.textContent, td.classList.contains('bad'), td.classList.contains('good')];

test('rosso solo dove serve, anche ripetendo l\'aggiornamento', () => {
  const td = cell();
  const line = { type: 'line' };
  for (let i = 0; i < 3; i++) setNum(td, 320, line);
  eq(state(td), ['320,00', false, false], 'importo positivo di una riga senza negRed');
  setNum(td, 0, line);
  eq(state(td), ['', false, false], 'zero nelle righe di dettaglio');
  const saldo = { type: 'total', negRed: true };
  setNum(td, -86.45, saldo);
  eq(state(td), ['−86,45', true, false], 'saldo negativo');
  setNum(td, 10, saldo);
  eq(state(td), ['10,00', false, false], 'tornato positivo');
  setNum(td, -5, { type: 'line', kind: 'costo' }, { scost: true });
  eq(state(td), ['−5,00', true, false], 'scostamento sfavorevole');
  setNum(td, 5, { type: 'line', kind: 'ricavo' }, { scost: true });
  eq(state(td), ['5,00', false, true], 'scostamento favorevole in verde');
  setNum(td, 0, { type: 'line', kind: 'costo' }, { scost: true });
  eq(state(td), ['', false, false], 'nessuno scostamento');
  const check = { type: 'check' };
  setNum(td, 0, check);
  eq(state(td), ['0,00', false, true], 'quadratura a zero');
  setNum(td, 0.01, check);
  eq(state(td), ['0,01', true, false], 'quadratura diversa da zero');
});
