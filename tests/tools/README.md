# Rigenerare i dati di verifica

Non sono nel repository perché contengono saldi e budget personali (come `seed_2027.sql` e l'Excel): vanno generati in locale prima di aprire `tests/index.html`, e rigenerati se cambiano l'Excel, `seed_default_chart` o `seed_2027.sql`. Da Git Bash, nella cartella del progetto:

```sh
# piano dei conti e dati 2027 (dagli script SQL)
awk -f tests/tools/chart-fixture.awk contabilita_schema.sql seed_2027.sql > tests/chart-2027.js

# valori del foglio "Prova Bdg" (dall'Excel): si scompatta lo .xlsx e si estrae il foglio 6
mkdir -p xlsx-tmp && cp TM27_Pers_.xlsx xlsx-tmp/book.zip
powershell -Command "Expand-Archive -Force xlsx-tmp/book.zip xlsx-tmp/x"
powershell -File tests/tools/xlsx-dump.ps1 -Dir xlsx-tmp/x -Sheet sheet6 -Out xlsx-tmp/bdg.tsv
awk -f tests/tools/excel-fixture.awk xlsx-tmp/bdg.tsv > tests/excel-2027.js
rm -rf xlsx-tmp
```

`excel-fixture.awk` dipende dalla disposizione del foglio "Prova Bdg": righe 8–60 causali finanziarie, 65–103 canali, una riga "Saldo finale" per scheda conto, 365 posizione, 369 quadratura, tre colonne per mese da F (Budget, Progr., Scost.).

`tests/expected-2027.js` (valori attesi dei test, come il riepilogo annuale e i totali di gennaio) e `verifica-2027.md` (valori di verifica citati da CLAUDE.md) non si generano: sono scritti a mano e restano solo in locale. Tienine una copia di sicurezza insieme a `seed_2027.sql` e all'Excel.
