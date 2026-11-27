# Contabilità personale: istruzioni di progetto

Webapp personale che replica il file Excel `TM27 Pers.xlsx` (foglio "Simul. Mutuo" escluso).
Contabilità in partita doppia con budget annuale mensile e confronto con il consuntivo.
Utente singolo: Mattia. Lingua dell'interfaccia e dei commenti: italiano.

## Stack e modo di lavorare

- HTML/JS puro, senza framework né build. `supabase-js` da CDN con versione fissata.
- Backend: Supabase (Postgres, Auth, RLS). Hosting: GitHub Pages dal ramo `main` di https://github.com/tamagninimattia/airmt (repository pubblico), app su https://tamagninimattia.github.io/airmt/.
- Si lavora in locale con un server (`python -m http.server 8000`). Commit piccoli e frequenti, uno per funzione.
- Pubblicazione automatica (deciso con Mattia): dopo ogni modifica provata (test e, se serve, screenshot) commit e `git push` su `main` senza chiedere conferma. Il ramo locale `master` è solo la copia della vecchia cronologia con dati personali: non va mai pubblicato.
- Supabase gratuito mette in pausa il progetto dopo circa una settimana di inattività: se le richieste rispondono "521" va ripristinato dal pannello (Restore project).
- La chiave `anon` è pubblica e sta in `index.html`. Non usare mai la `service_role`.
- Le registrazioni nuove su Supabase sono disattivate e devono restare così.
- Ogni modifica allo schema va fatta in `contabilita_schema.sql` (deve restare rieseguibile) e non solo a mano sul database.
- Prima di dichiarare finita una funzione che tocca calcoli, confrontare i risultati con l'Excel (vedi "Valori di verifica").

## File del progetto

- `index.html`: guscio dell'app (intestazione, navigazione, `window.APP_CONFIG` con URL e chiave anon). Carica `js/app.js` come modulo ES nativo, senza build.
- `css/app.css`: stili. Tema scuro ispirato all'app Claude (grigi caldi molto scuri: pagina `#1a1a19`, riquadri `#242422`; testo chiaro) con accento verde "aurora boreale" `#2fd59b` (testo scuro sui pulsanti) e `#6ee7b7` per link e testi in evidenza; verde salvia per "tutto a posto", ambra per gli avvisi, rosso chiaro per errori e scostamenti negativi. Tutti i colori sono variabili in `:root`: non scrivere colori diretti nelle regole. Icone del menu: simboli SVG in `index.html` sul modello di Lucide (licenza ISC). Sopra i 56 rem il menu è una colonna fissa a sinistra (`aside.side`), nera come il fondo del logo, con in cima il logo animato (192 px: video `icons/logo-video.mp4`, loop continuo di 20 s ridotto con ffmpeg a 384×384 H.264 senza audio, circa 400 KB, e poster `icons/logo-poster.jpg` = primo fotogramma; i sorgenti pesanti `Video loop*.mp4` restano fuori dal repository; quando cambia, aumentare `?v=` negli indirizzi; parte solo sopra i 56 rem e senza "riduci movimento", vedi `setupLogoVideo` in `js/app.js`) e il nome "AirTM" (deciso con Mattia; nera anche la barra in alto del telefono); sotto, una barra in alto con il pulsante "☰ <pagina corrente>" lo apre come pannello a tutto schermo; sotto i 40 rem griglie e tabelle si compattano e i campi sono a 16 px (niente zoom di iOS).
- `manifest.webmanifest` e `icons/`: il logo di Mattia (`icons/logo.png`, 1254×1254 su fondo nero) è la sorgente di favicon (16, 32), icona iPhone (`apple-touch-icon.png`, 180) e icone del manifest (192, 512), ricavate ridimensionandolo senza ritagli. Quando le icone cambiano, aumentare il numero di versione (`?v=2`, `?v=3`, …) negli indirizzi di `index.html` e del manifest: Safari su iPhone tiene l'icona in memoria per indirizzo e altrimenti mostra quella vecchia. L'app si aggiunge alla schermata Home e si apre a schermo intero. Nessun service worker: senza rete Supabase non risponde comunque.
- `js/app.js`: sessione e router a hash (`#/vista/parametri`). Le viste stanno in `js/views/` (`login.js`, `setup.js` = Avvio (fuori dal menu: si apre da sola solo con il database vuoto, per caricare il piano dei conti e creare il primo anno), `settings.js` = Impostazioni, `opening.js` = Apertura anno (fuori dal menu, si apre dalle Chiusure), `journal.js` = Giornale, `budget.js` = Budget, `accounts.js` = Partitario (schede conto, `#/partitario`; il vecchio `#/schede` vi reindirizza), `position.js` = Situazione patrimoniale, `dashboard.js` = Dashboard, `closing.js` = Chiusure) ed esportano `render(root, { session, params })`.
- `js/format.js` (importi e date in italiano, `parseAmount`), `js/journal-model.js` (regole del Giornale e Alert).
- `js/import-model.js` (regole pure dell'importazione da Excel: date, importi, causale dalla coppia di conti), `js/import-view.js` (riquadro "Importa da Excel" del Giornale e anteprima; SheetJS `xlsx@0.18.5` da CDN, caricato solo al primo file).
- `js/engine/`: motore di calcolo, funzioni pure. `year.js` calcola consuntivo, budget concatenato, budget calcolati (`budget_rule`), quadratura, riepilogo, imprevisti, scostamenti e Var suggerite; `balances.js` il patrimonio. `js/data.js` carica da Supabase i dati di un anno nel formato del motore (a pagine da 1000 righe).
- `tests/`: aprire `tests/index.html` dal server locale. I test confrontano il motore con l'Excel mese per mese (`excel-2027.js`, estratto dal foglio "Prova Bdg") usando piano dei conti, budget e target di `seed_default_chart` e `seed_2027.sql` (`chart-2027.js`) e i valori attesi di `expected-2027.js`. I tre file contengono dati personali e non vanno nel repository (sono in `.gitignore`): si rigenerano o ricreano in locale come spiegato in `tests/tools/README.md`.
- `js/db.js` (client Supabase, `rows`, `countRows`, errori tradotti), `js/ui.js` (helper DOM `h`, messaggi, `confirmBox`).
- `js/settings-model.js`: regole pure delle Impostazioni (validazione di conti e causali, campi bloccati quando ci sono registrazioni, blocchi all'eliminazione).
- `js/budget-model.js`: righe della griglia del Budget (`buildRows`), mese corrente, Var da allineare.
- `js/accounts-model.js`: righe delle schede conto (`cardRows`), movimenti del mese con saldo progressivo (`accountLedger`), situazione patrimoniale (`positionRows`).
- `js/grid.js`: griglia a 12 mesi condivisa (intestazione dei mesi, mesi esplosi ricordati per anno, colori delle celle, `readGrid` in sola lettura).
- `js/dashboard-model.js`: periodo di confronto, riepilogo, numeri chiave, scostamenti per sezione e per voce. `js/charts.js`: grafici SVG senza librerie (linee e barre), disegnati alla larghezza reale del riquadro.
- `js/closing-model.js`: riconciliazione per mese (`reconciliationRows`), controlli prima della chiusura (`monthChecks`), chiusura dell'anno, saldi iniziali dell'anno dopo.
- `contabilita_schema.sql`: tabelle, RLS, controllo del Giornale, vista `entries_enriched`, funzioni `seed_default_chart`, `init_year`, `account_balances`, `suggest_channel_adjustments`.
- `migrazione_storni_var.sql`: Alert e Var suggerite anche per gli storni (vista `entries_enriched` e `suggest_channel_adjustments`; da eseguire una volta).
- `migrazione_importazioni.sql`: aggiunge al database già creato la tabella `imports` e la colonna `entries.import_id` (da eseguire una volta).
- `migrazione_preferiti_provvisori.sql`: aggiunge al database già creato i preferiti (`favorites`) e i movimenti provvisori (`entries.provisional`, vista e `account_balances` aggiornate); da eseguire una volta, lo schema aggiornato lo include già.
- `migrazione_rimmt.sql`: rende calcolato il budget di `RIMMT` nel database già creato (da eseguire una volta; lo schema aggiornato lo include già per le nuove installazioni).
- `seed_2027.sql`: saldi iniziali 2027 e budget 2027 presi dall'Excel (da eseguire una volta nel SQL Editor, dopo aver creato l'anno).
- `TM27_Pers_.xlsx`: file Excel di riferimento (da copiare nella cartella).

## Modello contabile

- Ogni registrazione ha un importo e due conti (Dare e Avere). Mai scritture con più righe.
- Conti patrimoniali: attivi (saldo = iniziale + Dare − Avere) e passivi (saldo = iniziale + Avere − Dare). I saldi iniziali sono "naturali": un debito è positivo.
- Conti economici: ricavi (Avere − Dare) e costi (Dare − Avere).
- Patrimonio = somma dei conti attivi − somma dei conti passivi, includendo tutti i conti.
- Quadratura: posizione patrimoniale finale = patrimonio iniziale + ricavi − costi progressivi. Deve dare sempre 0.
- Il Dossier titoli è un saldo unico mosso solo da `INV` e `DIS`, senza valore di mercato.
- Le schede conto non hanno tabella: si ricavano dalle causali (Dare/Avere) e dai movimenti, così aggiungere o modificare conti e causali aggiorna tutto.
- Il consuntivo si concatena con il consuntivo (saldo finale reale di un mese = saldo iniziale del successivo) e il budget con il budget. Servono entrambi, perché in fase prospettica il budget deve restare agganciato al budget precedente.

## Causali e Giornale

- Tre tipi di causale: `finanziaria` (Dare e Avere fissi), `ricavo` (Dare fisso = il canale, Avere = conto economico scelto) e `costo` (Avere fisso = il canale, Dare = conto economico scelto).
- Nel Giornale si sceglie la causale dal menu, poi data (con il pulsante "Oggi" accanto al campo), importo e conto economico (se serve) e note. Il lato fisso si compila da solo (lo garantisce anche il trigger `entries_validate`).
- Il mese di competenza è il mese della data. Le spese su carta restano nel mese della spesa; l'addebito su Fineco è un'altra registrazione.
- Giornale pensato per l'uso da telefono. Sugli schermi larghi (≥ 64 rem) è su due colonne uguali che occupano la pagina (fino a 96 rem): a sinistra nuova registrazione e registrazioni del mese, a destra i Preferiti; sul telefono i Preferiti vanno sotto.
- Preferiti (tabella `favorites`, decisi con Mattia): la stella ☆ del form chiede conferma e un nome e salva solo lo schema (causale, conto economico, importo e note; conto e importo facoltativi, la data no), senza registrare. Cliccando un preferito il form si compila con la data di oggi e si registra con "Registra". Ordine alfabetico; il menu ⋯ rinomina o elimina (con conferma).
- Movimento provvisorio (`entries.provisional`, deciso con Mattia): compare nel Giornale in lilla con il badge "provvisorio" ma non entra in nessun calcolo (`loadYear` lo esclude, come `account_balances` e quindi `init_year`) e non dà Alert di canale. Si conferma aprendolo e togliendo la spunta. Un avviso in cima al Giornale elenca i provvisori di qualsiasi mese con data ≤ oggi, cliccabili per aprirli in modifica. Nel Partitario la casella "Mostra i movimenti provvisori" (ricordata nel browser) li aggiunge in lilla ai movimenti del mese, senza saldo progressivo e senza cambiare saldi e griglia. Nel Budget la stessa casella ("budget.provvisori" nel browser) calcola il Progr. anche con i provvisori e colora in lilla le celle Progr. che cambiano (`provisionalMarks`); lì "←" non compare. Var, controlli, Dashboard e Chiusure restano sul confermato.
- Importa da Excel (deciso con Mattia), nel Giornale sotto i Preferiti: si trascina un file .xlsx (primo foglio) o .csv con le colonne Data, Da, A, Importo, Note e, facoltativa, Causale. Da = da dove escono i soldi, A = dove vanno: costo = canale → voce, ricavo = voce → canale, tra conti = partenza → arrivo. La causale si ricava dalla coppia di conti (se ce ne sono più di una vale il canale standard della voce, altrimenti la colonna Causale). Storni (voce di costo in Da, cioè rimborsi, resi e vendite, o voce di ricavo in A): causale del verso opposto con la voce in Avere/Dare, che ne esce ridotta; nel Giornale la loro voce resta modificabile (`stornoId` in `validateEntry`). Anteprima con abbinamento dei nomi sconosciuti (ricordato nel browser), causali mancanti create con un pulsante (una per coppia di conti, codici e descrizioni come nella finestra "Causali" dei conti: `missingCausali`), errori per riga, riepilogo per mese e possibili doppioni (stessa data, conti e importo) esclusi di base. Ogni caricamento è una riga di `imports` e le sue registrazioni hanno `import_id`: "Annulla" elimina l'importazione e, a cascata, le sue registrazioni.

## Alert di canale e righe Var +/-

- Ogni conto economico ha un canale standard (`standard_causale_id`), ad esempio Apple Music → `COSCCRED`.
- Se una registrazione usa una causale diversa dallo standard, la vista `entries_enriched` mette `channel_alert = true` e il Giornale mostra un badge.
- Scopo dell'Alert: ricordare di compilare le righe **Var +/-** del Budget per quel mese e canale. Una Var sposta budget da un canale a un altro (meno sul canale standard, più su quello reale).
- Il budget per canale (righe "di cui Portafoglio, C/C Fineco, ...") è: somma del budget delle voci con quel canale standard + Var +/-.
- Le Var si inseriscono a mano, con in più un pulsante "applica suggerimento" che usa `suggest_channel_adjustments(anno, mese)` (importo modificabile prima del salvataggio).
- Nel Budget mostrare per mese e canale quante Var restano da allineare, e il controllo "Verifica Variazioni" (vedi sotto gli storni) che deve fare 0. Le Var da allineare si contano solo fino al mese corrente: nei mesi futuri non ci sono registrazioni e le Var sono pianificazione. Il suggerimento è calcolato in JavaScript (`suggestAdjustments`) con la stessa regola di `suggest_channel_adjustments`.
- Storni (voce di costo con causale di ricavo, cioè rimborsi, resi e vendite, o viceversa): danno anch'essi Alert e chiedono le Var, ma con lo stesso segno sui due canali, +importo sul canale usato e +importo sul canale standard della voce (canali di tipo opposto). Per questo "Verifica Variazioni" è Var sui canali di costo − Var sui canali di ricavo, per mese, e deve fare 0: è la condizione che tiene a 0 la quadratura del budget (`stornoAlert`, `varCheck`; nel database la vista `entries_enriched` ha la colonna `storno`, vedi `migrazione_storni_var.sql`).
- Le Var cambiano anche il giroconto della carta e i saldi di budget delle schede conto.

## Budget

- Tabelle: `budget_accounts` (per conto economico), `budget_causali` (per causale finanziaria), `channel_adjustments` (Var +/-).
- Griglia anno × 12 mesi, con colonne Budget, Progr. (consuntivo del mese) e Scost. per ogni mese, e totale annuo. Il budget è sempre modificabile a mano.
- Vista della griglia: di base si vedono i 12 budget e il totale, con esploso (Budget, Progr., Scost.) solo il mese corrente, cioè l'ultimo non chiuso. Ogni altro mese si può esplodere a richiesta.
- Righe a zero (budget, Progr. e Var tutti a 0 nell'anno) nascoste, comprese le voci attive e le causali calcolate; si vedono con "Mostra anche le righe a zero", che serve anche per scrivere il budget di una voce nuova (deciso con Mattia).
- Le celle da digitare hanno sfondo giallo `#FFFF99` con testo scuro, grigio `#BFBFBF` se sono vuote; diventano verdi `#99FFCC` quando il consuntivo del mese è uguale a un budget diverso da zero (scostamento 0: budget raggiunto). Deciso con Mattia.
- "+" dal Budget al Giornale (deciso con Mattia): nei mesi esplosi, a destra dello scostamento nella colonna Scost. delle righe con budget manuale (voci economiche e causali finanziarie; non le calcolate, gli imprevisti e le Var), compare se al budget del mese manca ancora qualcosa. Apre `#/giornale/<anno-mese>?voce=<id>` (o `?causale=<id>`) `&importo=<budget − consuntivo>`: il Giornale compila causale (il canale standard della voce), conto e importo, lascia vuote data e note e toglie la richiesta dall'indirizzo (`journalPrefill`, `prefillFromQuery`).
- "←" accanto alla cella del budget (deciso con Mattia; prima era "=" nella colonna Scost.): stesse righe del "+", nei mesi esplosi fino al corrente, quando budget e consuntivo differiscono; porta il budget del mese al consuntivo (anche a 0: "non arriva più nulla"), subito, con "Annulla" nel messaggio (`alignToActual`). La differenza passa agli imprevisti dei mesi aperti.
- Colonna Voce senza badge "calcolato" né codici causale (deciso con Mattia): le voci calcolate hanno il nome in corsivo e la regola si legge passandoci sopra.
- Scorciatoie: "copia su tutti i mesi" e "dividi il totale annuo" (il resto dell'arrotondamento va sull'ultimo mese; i mesi chiusi restano invariati se si lascia la spunta).
- Mese corrente del Budget = primo mese non chiuso (quello dopo l'ultimo chiuso).
- Scostamento: positivo = favorevole, sia per ricavi che per costi (ricavi: Progr. − Budget; costi: Budget − Progr.). Nelle griglie i favorevoli sono verdi e gli sfavorevoli rossi (deciso con Mattia). Per le causali finanziarie vale come per i costi: Budget − Progr. (deciso con Mattia).
- Le causali finanziarie (prelievi, trasferimenti, investimenti, anticipi MT, CSC) hanno budget manuale. Fanno eccezione le tre con `budget_rule`, il cui budget è calcolato dall'app: `GCCCRED`, `ADDCCRED` (vedi "Carta di credito") e `RIMMT`. Il calcolato si può sostituire mese per mese scrivendo un importo (deciso con Mattia, per gli anni con regole diverse come il 2026, quando la carta si addebitava su RivieraBanca): una riga di `budget_causali` su una calcolata vale al posto del calcolato, anche a 0, e le regole che ne dipendono (l'addebito dal giroconto) usano il valore finale; svuotando la cella si torna al calcolato. Celle azzurre `#CCE5FF` dove vale il calcolato, gialle dove è scritto (`overrides` in `computeBudget`, `manual` nelle righe). Tra le voci economiche è calcolata solo quella degli imprevisti (vedi sotto).
- `RIMMT` (rimborsi MT Prof.le, `budget_rule = 'mt_rimborso'`): gennaio = saldo iniziale di "Crediti vs MT Prof.le"; da febbraio = `ANTFIN` + `ANTPOR` del mese precedente, perché gli anticipi vengono rimborsati il mese dopo. Se cambiano gli anticipi, i rimborsi si aggiornano da soli.

## Carta di credito

- `GCCCRED` (giroconto da "corrente" a "da addebitare"), budget del mese = costi su carta − ricavi su carta dello stesso mese (budget per canale, Var comprese).
- `ADDCCRED` (addebito su Fineco), budget del mese = giroconto del mese precedente. A gennaio = saldo iniziale di "Carta di credito (da addebitare)".
- Nel consuntivo valgono solo i movimenti reali registrati.

## Imprevisti ("Spese indivise non preventivate")

- È il conto economico con `is_contingency = true`. È solo budget (prudenziale) e non si consuma con spese reali.
- Target di risparmio annuo: campo `target` di `years`, input dell'utente, modificabile dalla Dashboard.
- È una voce residuale, sempre calcolata e mai inserita a mano (deciso con Mattia): totale annuo = ricavi − costi esclusi imprevisti − target, tutto a budget. Quindi il risultato netto di budget è sempre il target.
- Nei mesi chiusi vale 0: alla chiusura budget e Progr. coincidono e gli imprevisti non hanno movimenti reali.
- Il residuo si divide in parti uguali sui mesi non chiusi (mese corrente compreso); il resto dell'arrotondamento va sull'ultimo. A inizio anno è la divisione per 12.
- Si ricalcola a ogni modifica del budget, non solo alla chiusura: 50 € di costi in più a parità di ricavi tolgono 50 € agli imprevisti, ripartiti sui mesi aperti.
- Se il residuo è negativo gli imprevisti diventano negativi e Budget e Dashboard avvisano che il target non è raggiungibile.
- Implementato in `contingencyPlan` (dentro `computeBudget`); eventuali righe di `budget_accounts` salvate per questa voce vengono ignorate.

## Chiusura del mese e dell'anno

- Chiudere un mese imposta solo `months.closed`: non blocca le registrazioni e si può riaprire.
- Prima di chiudere, Mattia allinea il budget del mese al consuntivo: a mano, voce per voce con "←" nel Budget o tutto insieme dalle Chiusure. L'app lo riscrive solo su sua richiesta e non conserva il budget originale.
- `init_year(anno)` crea l'anno e prende i saldi iniziali dai saldi finali di dicembre dell'anno prima. Finché l'anno è in `bozza` i saldi iniziali restano modificabili.
- Vista Chiusure (`#/chiusure/anno/mese`): per il mese scelto, controlli prima della chiusura (voci e causali finanziarie con budget diverso dal consuntivo, Var da allineare, quadratura, riconciliazione) che avvisano ma non bloccano; "Chiudi mese" / "Riapri mese" con conferma. Il pulsante "Allinea il budget al consuntivo" fa lo stesso per tutte le voci manuali del mese, con conferma che elenca le voci e l'effetto sugli imprevisti (`alignMonthRows`), causali calcolate comprese (il consuntivo diventa un valore scritto).
- L'anno si chiude (`years.status = 'chiuso'`) solo con tutti i 12 mesi chiusi, e si può riaprire.
- Anno prima: le Chiusure del primo anno offrono "Crea il <anno − 1>" (`init_year`, saldi iniziali a zero da compilare nell'Apertura); i suoi saldi finali di dicembre si riportano poi sull'anno dopo con il meccanismo qui sotto.
- Anno dopo: si crea con `init_year`; se esiste ed è in bozza, un pulsante riallinea i suoi saldi iniziali ai saldi finali reali di dicembre (per le registrazioni arrivate dopo la creazione).

## Riconciliazione ("Saldo per controllo")

- Tabella `reconciliations`: saldo reale di banca per conto e mese. Evidenziare quando coincide o no con il saldo calcolato. Saldi negativi in rosso.
- Si inserisce nelle Chiusure (saldo vuoto = riga cancellata), in celle gialle come quelle del Budget. "Usa i saldi calcolati" (con conferma) copia il saldo calcolato come saldo reale nei conti ancora vuoti, senza toccare quelli già scritti (`fillFromCalculated`; deciso con Mattia). Nelle schede conto compaiono le righe "Saldo per controllo" e "Differenza", nella colonna Progr. dei mesi esplosi.

## Viste previste

Dopo aver creato un conto patrimoniale si apre la finestra "Crea le causali" (deciso con Mattia), che si apre anche dal pulsante "Causali" sulla riga di ogni conto: costi e ricavi (COS/RIC+sigla), trasferimenti da e verso ogni altro conto (sigla+sigla), variazioni di crediti e debiti (ICRED/DCRE/IDEB/DDEB+sigla). Per le disponibilità sono spuntati costi, ricavi, crediti e debiti e i trasferimenti con il primo conto delle disponibilità; per gli altri gruppi niente. Le causali con gli stessi conti che esistono già non si ricreano (`accountAbbr`, `causaleProposals`, `validateProposals`).

Menu laterale, in quest'ordine (deciso con Mattia): Dashboard, Giornale, Budget, Partitario (le schede conto), Patrimonio (situazione patrimoniale), poi il gruppo Impostazioni (titolo non cliccabile) con le sotto-schede rientrate Conti patrimoniali, Conti economici, Causali (`#/impostazioni/<scheda>`) e Chiusure. Avvio e Apertura anno non sono nel menu (deciso con Mattia): gli anni successivi si creano dalle Chiusure; l'Apertura anno (saldi iniziali, bozza/attivo) si apre dalle Chiusure ("Saldi iniziali del …") o dall'avviso della Dashboard quando l'anno è in bozza, e nel menu evidenzia Chiusure. Nelle Impostazioni si possono aggiungere, modificare ed eliminare conti e causali (con l'aggancio al budget). Budget soprattutto per desktop, Giornale per telefono. Nessuna importazione di estratti conto bancari; c'è invece l'importazione del Giornale da un file Excel preparato da Mattia (vedi "Causali e Giornale").

- Dashboard: avvisi, numeri chiave al mese corrente, riepilogo annuale (budget anno, budget e consuntivo del periodo) con il target modificabile, andamento del patrimonio con il traguardo (patrimonio iniziale + target), costi per sezione e le 5 voci più sfavorevoli.
- I confronti "da inizio anno" della Dashboard usano solo i mesi chiusi; se non ce ne sono, il mese corrente con un avviso.
- Pagina iniziale: Dashboard sugli schermi larghi (≥ 900 px), Giornale sul telefono.
- Grafici (due, semplici, da rivedere con l'uso): consuntivo blu `#3987e5`, budget arancio `#d95926` (tratteggiato nelle linee): palette per lo sfondo scuro, validata con lo script della skill dataviz contro i riquadri `#30302e` e ricontrollata (contrasto ≥ 4:1) sui riquadri `#242422`.

## Errori dell'Excel già corretti (non ripeterli)

- `PAYFIN`, `SATFIN`, `REVFIN` avevano Dare e Avere invertiti. Corretti nello schema.
- Codici non allineati tra Budget e Causali: ora `RICCCRED` (ricavi su carta), `RICRED` e `COSRED` (crediti). Un solo codice per causale, ovunque.
- Il patrimonio iniziale nell'Excel ignorava alcuni conti: qui include tutti.
- Il Progr. di ogni mese partiva dal saldo iniziale di budget: qui il consuntivo si concatena con il consuntivo.
- "Spese indivise non preventivate" non era nel Piano dei conti: ora è un conto economico.

## Valori di verifica (dall'Excel)

I valori sono dati personali e stanno in file locali fuori dal repository (`.gitignore`): `verifica-2027.md` (saldi iniziali, patrimonio iniziale, riepilogo annuale, giroconto carta annuo) e, per i test, `tests/expected-2027.js`, `tests/excel-2027.js`, `tests/chart-2027.js`. Non scrivere importi reali in file versionati (codice, test, CLAUDE.md): il repository è pubblico.

Con i dati di `seed_2027.sql` il giroconto carta (costi su carta − ricavi su carta), l'addebito del mese dopo e i rimborsi MT, ricalcolati dalle regole, coincidono con l'Excel mese per mese.

## Ordine di sviluppo

1. Schema, login, caricamento del piano dei conti, anno 2027 (fatto, in verifica).
2. Impostazioni: conti e causali modificabili (fatto).
3. Saldi iniziali (apertura anno) e Giornale con Alert (fatto).
4. Motore di calcolo con test contro l'Excel (fatto: budget mese per mese, consuntivo di gennaio con il Giornale di prova).
5. Budget a griglia con scorciatoie, poi Var +/- e contatore da allineare (fatto).
6. Schede conto, situazione patrimoniale e quadratura (fatto).
7. Dashboard con target e imprevisti (fatto).
8. Chiusura del mese e dell'anno, riconciliazione (fatto).
9. Rifiniture per il telefono (fatto).

## Convenzioni

- Importi in euro con 2 decimali (`numeric(14,2)` nel database, arrotondamento a 2 decimali nei calcoli).
- Interfaccia: frasi in minuscolo, verbi attivi nei pulsanti ("Salva", "Chiudi mese"), errori chiari su cosa è andato storto e come rimediare.
- I calcoli (consuntivo, budget concatenato, quadratura, imprevisti) stanno in funzioni JavaScript pure e testabili, su un anno di dati. Non usare viste SQL ricorsive.
- Prima di cambiare una scelta di questo file, chiedere a Mattia.
