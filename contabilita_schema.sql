-- =====================================================================
--  CONTABILITA' PERSONALE - schema Supabase
--  Da eseguire una volta nel SQL Editor del progetto Supabase.
--  Dopo l'esecuzione, dall'app (utente loggato):
--      supabase.rpc('seed_default_chart')   -> carica conti e causali
--      supabase.rpc('init_year', { p_year: 2027 })
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. TABELLE
-- ---------------------------------------------------------------------

-- Piano dei conti: patrimoniali ed economici in un'unica tabella
create table if not exists accounts (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name                text not null,
  type                text not null check (type in ('patrimoniale', 'economico')),
  -- solo patrimoniali: natura e gruppo della scheda conto
  side                text check (side in ('attivo', 'passivo')),
  grp                 text check (grp in ('disponibilita', 'crediti', 'debiti', 'immobilizzato')),
  -- solo economici: ricavo o costo
  kind                text check (kind in ('ricavo', 'costo')),
  -- solo economici: causale del canale "standard" (serve per l'Alert del Giornale)
  standard_causale_id uuid,
  -- solo costi: voce degli imprevisti ("Spese indivise non preventivate")
  is_contingency      boolean not null default false,
  budget_section      text,                    -- raggruppamento visivo nel Budget
  sort_order          int not null default 0,
  active              boolean not null default true,
  unique (user_id, name),
  constraint accounts_shape check (
        (type = 'patrimoniale' and side is not null and grp is not null
                               and kind is null and not is_contingency)
     or (type = 'economico'    and kind is not null and side is null and grp is null)),
  constraint accounts_contingency check (not is_contingency or kind = 'costo')
);

-- Causali: codice + conti Dare/Avere.
--   finanziaria : Dare e Avere fissi
--   ricavo      : Dare fisso (il canale), Avere = conto economico scelto nel Giornale
--   costo       : Avere fisso (il canale), Dare = conto economico scelto nel Giornale
create table if not exists causali (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  code              text not null,
  description       text not null,
  kind              text not null check (kind in ('finanziaria', 'ricavo', 'costo')),
  debit_account_id  uuid references accounts(id),
  credit_account_id uuid references accounts(id),
  grp               text,                      -- raggruppamento visivo nel Budget
  -- causali il cui budget NON e' manuale ma calcolato dall'app
  budget_rule       text check (budget_rule in ('card_giroconto', 'card_addebito', 'mt_rimborso')),
  sort_order        int not null default 0,
  active            boolean not null default true,
  unique (user_id, code),
  unique (user_id, description),
  constraint causali_shape check (
        (kind = 'finanziaria' and debit_account_id is not null and credit_account_id is not null)
     or (kind = 'ricavo'      and debit_account_id is not null and credit_account_id is null)
     or (kind = 'costo'       and credit_account_id is not null and debit_account_id is null))
);

do $$ begin
  alter table accounts
    add constraint accounts_standard_causale_fk
    foreign key (standard_causale_id) references causali(id) on delete set null;
exception when duplicate_object then null; end $$;

-- Anni: target di risparmio e stato (bozza = saldi iniziali ancora modificabili)
create table if not exists years (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  year    smallint not null,
  target  numeric(14,2) not null default 0,
  status  text not null default 'bozza' check (status in ('bozza', 'attivo', 'chiuso')),
  primary key (user_id, year)
);

-- Mesi: solo il flag di chiusura (riapribile). Il budget resta sempre modificabile.
create table if not exists months (
  user_id   uuid not null,
  year      smallint not null,
  month     smallint not null check (month between 1 and 12),
  closed    boolean not null default false,
  closed_at timestamptz,
  primary key (user_id, year, month),
  foreign key (user_id, year) references years(user_id, year) on delete cascade
);

-- Saldi iniziali per anno e conto patrimoniale (valori "naturali": un debito e' positivo)
create table if not exists opening_balances (
  user_id    uuid not null,
  year       smallint not null,
  account_id uuid not null references accounts(id) on delete cascade,
  amount     numeric(14,2) not null default 0,
  primary key (user_id, year, account_id),
  foreign key (user_id, year) references years(user_id, year) on delete cascade
);

-- Giornale: un importo, due conti
create table if not exists entries (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  entry_date        date not null,
  causale_id        uuid not null references causali(id),
  debit_account_id  uuid not null references accounts(id),
  credit_account_id uuid not null references accounts(id),
  amount            numeric(14,2) not null check (amount > 0),
  note              text,
  created_at        timestamptz not null default now()
);
create index if not exists entries_user_date_idx on entries (user_id, entry_date);
create index if not exists entries_causale_idx   on entries (causale_id);
create index if not exists entries_debit_idx     on entries (debit_account_id);
create index if not exists entries_credit_idx    on entries (credit_account_id);

-- Budget per conto economico (ricavi e costi, imprevisti compresi)
create table if not exists budget_accounts (
  user_id    uuid not null,
  year       smallint not null,
  month      smallint not null check (month between 1 and 12),
  account_id uuid not null references accounts(id) on delete cascade,
  amount     numeric(14,2) not null default 0,
  primary key (user_id, year, month, account_id),
  foreign key (user_id, year) references years(user_id, year) on delete cascade
);

-- Budget per causale finanziaria (prelievi, trasferimenti, investimenti, anticipi, CSC...)
create table if not exists budget_causali (
  user_id    uuid not null,
  year       smallint not null,
  month      smallint not null check (month between 1 and 12),
  causale_id uuid not null references causali(id) on delete cascade,
  amount     numeric(14,2) not null default 0,
  primary key (user_id, year, month, causale_id),
  foreign key (user_id, year) references years(user_id, year) on delete cascade
);

-- Righe "Var +/-": spostamenti di budget tra canali (causali di ricavo/costo)
create table if not exists channel_adjustments (
  user_id    uuid not null,
  year       smallint not null,
  month      smallint not null check (month between 1 and 12),
  causale_id uuid not null references causali(id) on delete cascade,
  amount     numeric(14,2) not null default 0,
  primary key (user_id, year, month, causale_id),
  foreign key (user_id, year) references years(user_id, year) on delete cascade
);

-- Riconciliazione: saldo reale di banca per conto e mese ("Saldo per controllo")
create table if not exists reconciliations (
  user_id        uuid not null,
  year           smallint not null,
  month          smallint not null check (month between 1 and 12),
  account_id     uuid not null references accounts(id) on delete cascade,
  actual_balance numeric(14,2) not null,
  note           text,
  primary key (user_id, year, month, account_id),
  foreign key (user_id, year) references years(user_id, year) on delete cascade
);


-- ---------------------------------------------------------------------
-- 2. SICUREZZA (RLS): ogni utente vede e scrive solo le proprie righe
-- ---------------------------------------------------------------------
alter table accounts enable row level security;
drop policy if exists "own rows" on accounts;
create policy "own rows" on accounts for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter table causali enable row level security;
drop policy if exists "own rows" on causali;
create policy "own rows" on causali for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter table years enable row level security;
drop policy if exists "own rows" on years;
create policy "own rows" on years for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter table months enable row level security;
drop policy if exists "own rows" on months;
create policy "own rows" on months for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter table opening_balances enable row level security;
drop policy if exists "own rows" on opening_balances;
create policy "own rows" on opening_balances for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter table entries enable row level security;
drop policy if exists "own rows" on entries;
create policy "own rows" on entries for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter table budget_accounts enable row level security;
drop policy if exists "own rows" on budget_accounts;
create policy "own rows" on budget_accounts for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter table budget_causali enable row level security;
drop policy if exists "own rows" on budget_causali;
create policy "own rows" on budget_causali for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter table channel_adjustments enable row level security;
drop policy if exists "own rows" on channel_adjustments;
create policy "own rows" on channel_adjustments for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter table reconciliations enable row level security;
drop policy if exists "own rows" on reconciliations;
create policy "own rows" on reconciliations for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));



-- ---------------------------------------------------------------------
-- 3. CONTROLLO DEL GIORNALE
--    - il lato fisso della causale viene impostato in automatico
--    - il lato "da scegliere" deve essere indicato e deve essere un conto economico
-- ---------------------------------------------------------------------
create or replace function entries_validate()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  c  causali;
  da accounts;
  ca accounts;
begin
  select * into c from causali where id = new.causale_id;

  -- in modifica i conti si riallineano alla causale solo se la causale cambia
  if tg_op = 'INSERT' or new.causale_id is distinct from old.causale_id then
    if c.debit_account_id  is not null then new.debit_account_id  := c.debit_account_id;  end if;
    if c.credit_account_id is not null then new.credit_account_id := c.credit_account_id; end if;
  end if;

  if new.debit_account_id is null or new.credit_account_id is null then
    raise exception 'Selezionare il conto economico per la causale %', c.code;
  end if;
  if new.debit_account_id = new.credit_account_id then
    raise exception 'Il conto Dare e il conto Avere coincidono';
  end if;

  select * into da from accounts where id = new.debit_account_id;
  select * into ca from accounts where id = new.credit_account_id;

  if c.kind = 'ricavo' and ca.type <> 'economico' then
    raise exception 'Con una causale di ricavo il conto Avere deve essere economico';
  elsif c.kind = 'costo' and da.type <> 'economico' then
    raise exception 'Con una causale di costo il conto Dare deve essere economico';
  elsif c.kind = 'finanziaria' and (da.type <> 'patrimoniale' or ca.type <> 'patrimoniale') then
    raise exception 'Una causale finanziaria muove solo conti patrimoniali';
  end if;

  return new;
end $$;

drop trigger if exists entries_validate_trg on entries;
create trigger entries_validate_trg
  before insert or update on entries
  for each row execute function entries_validate();


-- ---------------------------------------------------------------------
-- 4. VISTA CON L'ALERT DI CANALE
--    channel_alert = true quando la causale usata e' diversa dal canale
--    standard del conto economico (e' l'avviso che ti ricorda le Var +/-)
-- ---------------------------------------------------------------------
create or replace view entries_enriched
with (security_invoker = true) as
select
  e.id, e.entry_date, e.causale_id, e.debit_account_id, e.credit_account_id,
  e.amount, e.note, e.created_at,
  c.code as causale_code,
  c.kind as causale_kind,
  ea.id   as economic_account_id,
  ea.name as economic_account_name,
  ea.standard_causale_id,
  coalesce(ea.kind = c.kind
           and ea.standard_causale_id is not null
           and ea.standard_causale_id <> e.causale_id, false) as channel_alert
from entries e
join causali c on c.id = e.causale_id
left join accounts ea
       on ea.id = case c.kind when 'ricavo' then e.credit_account_id
                              when 'costo'  then e.debit_account_id end;


-- ---------------------------------------------------------------------
-- 5. FUNZIONI
-- ---------------------------------------------------------------------

-- Saldo a fine mese dei conti patrimoniali: saldo iniziale dell'anno + movimenti
-- da gennaio a p_month (consuntivo concatenato).
create or replace function account_balances(p_year int, p_month int default 12)
returns table (account_id uuid, balance numeric)
language sql
stable
set search_path = public
as $$
  with mv as (
    select debit_account_id as account_id, amount as d, 0::numeric as c
      from entries
     where entry_date >= make_date(p_year, 1, 1)
       and entry_date <  (make_date(p_year, p_month, 1) + interval '1 month')::date
    union all
    select credit_account_id, 0::numeric, amount
      from entries
     where entry_date >= make_date(p_year, 1, 1)
       and entry_date <  (make_date(p_year, p_month, 1) + interval '1 month')::date
  ),
  agg as (
    select mv.account_id, sum(mv.d) as d, sum(mv.c) as c from mv group by mv.account_id
  )
  select a.id,
         coalesce(ob.amount, 0)
         + case when a.side = 'passivo' then coalesce(g.c, 0) - coalesce(g.d, 0)
                else coalesce(g.d, 0) - coalesce(g.c, 0) end
    from accounts a
    left join opening_balances ob on ob.account_id = a.id and ob.year = p_year
    left join agg g on g.account_id = a.id
   where a.type = 'patrimoniale';
$$;

-- Importi suggeriti per le righe Var +/- di un mese, calcolati dagli Alert del
-- Giornale: l'importo si sposta dal canale standard al canale realmente usato.
create or replace function suggest_channel_adjustments(p_year int, p_month int)
returns table (causale_id uuid, amount numeric)
language sql
stable
set search_path = public
as $$
  with a as (
    select ee.causale_id as actual_causale, ee.standard_causale_id as std_causale, ee.amount
      from entries_enriched ee
     where ee.channel_alert
       and ee.entry_date >= make_date(p_year, p_month, 1)
       and ee.entry_date <  (make_date(p_year, p_month, 1) + interval '1 month')::date
  ),
  m as (
    select actual_causale as causale_id,  amount from a
    union all
    select std_causale,                  -amount from a
  )
  select m.causale_id, sum(m.amount)::numeric(14,2)
    from m
   group by m.causale_id
  having sum(m.amount) <> 0;
$$;

-- Crea un anno: 12 mesi e saldi iniziali (dai saldi finali dell'anno prima, se esiste)
create or replace function init_year(p_year int)
returns text
language plpgsql
set search_path = public
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Utente non autenticato'; end if;
  if exists (select 1 from years where user_id = v_user and year = p_year) then
    return 'Anno già esistente: nessuna modifica';
  end if;

  insert into years (user_id, year) values (v_user, p_year);
  insert into months (user_id, year, month)
    select v_user, p_year, g from generate_series(1, 12) g;

  if exists (select 1 from years where user_id = v_user and year = p_year - 1) then
    insert into opening_balances (user_id, year, account_id, amount)
      select v_user, p_year, b.account_id, b.balance
        from account_balances(p_year - 1, 12) b;
    return 'Anno creato: saldi iniziali presi dai saldi finali dell''anno precedente';
  end if;

  insert into opening_balances (user_id, year, account_id, amount)
    select v_user, p_year, a.id, 0 from accounts a
     where a.user_id = v_user and a.type = 'patrimoniale';
  return 'Anno creato: saldi iniziali a zero, da compilare';
end $$;

-- Carica il piano dei conti e le causali del file Excel (una sola volta)
create or replace function seed_default_chart()
returns text
language plpgsql
set search_path = public
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Utente non autenticato'; end if;
  if exists (select 1 from accounts where user_id = v_user) then
    return 'Piano dei conti già presente: nessuna modifica';
  end if;

  -- 5.1 conti patrimoniali
  insert into accounts (user_id, name, type, side, grp, sort_order)
  select v_user, t.name, 'patrimoniale', t.side, t.grp, t.ord
    from (values
      ('Dossier Titoli FINECO',            'attivo',  'immobilizzato',  1),
      ('Conto corrente FINECO',            'attivo',  'disponibilita',  2),
      ('Conto corrente Trade Republic',    'attivo',  'disponibilita',  3),
      ('Paypal',                           'attivo',  'disponibilita',  4),
      ('Satispay',                         'attivo',  'disponibilita',  5),
      ('Revolut',                          'attivo',  'disponibilita',  6),
      ('Portafoglio',                      'attivo',  'disponibilita',  7),
      ('Cassa CSC',                        'attivo',  'disponibilita',  8),
      ('Crediti vs MT Prof.le',            'attivo',  'crediti',        9),
      ('Altri crediti',                    'attivo',  'crediti',       10),
      ('Carta di credito (corrente)',      'passivo', 'debiti',        11),
      ('Carta di credito (da addebitare)', 'passivo', 'debiti',        12),
      ('Debiti verso CSC',                 'passivo', 'debiti',        13),
      ('Altri debiti',                     'passivo', 'debiti',        14)
    ) as t(name, side, grp, ord);

  -- 5.2 causali finanziarie "singole"
  insert into causali (user_id, code, description, kind, debit_account_id, credit_account_id,
                       grp, budget_rule, sort_order)
  select v_user, t.code, t.descr, 'finanziaria', d.id, c.id, t.grp, t.rule, t.ord
    from (values
      ('RIMCSC',   'Incasso quota CSC su TR',            'Conto corrente Trade Republic',    'Debiti verso CSC',                 'CSC',              null,             1),
      ('PAGCSC',   'Pagamento CSC',                      'Debiti verso CSC',                 'Cassa CSC',                        'CSC',              null,             2),
      ('ACCCSC',   'Accantonamento quote CSC',           'Cassa CSC',                        'Portafoglio',                      'CSC',              null,             3),
      ('PREFIN',   'Prelievo da Fineco',                 'Portafoglio',                      'Conto corrente FINECO',            'Prelievi',         null,             4),
      ('PRETR',    'Prelievo da TradeRepublic',          'Portafoglio',                      'Conto corrente Trade Republic',    'Prelievi',         null,             5),
      ('TRFIN',    'Trasferimenti TR -> Fineco',         'Conto corrente FINECO',            'Conto corrente Trade Republic',    'Trasferimenti',    null,             6),
      ('FINSAT',   'Trasferimenti Fineco -> Satispay',   'Satispay',                         'Conto corrente FINECO',            'Trasferimenti',    null,             7),
      ('FINREV',   'Trasferimenti Fineco -> Revolut',    'Revolut',                          'Conto corrente FINECO',            'Trasferimenti',    null,             8),
      -- CORRETTE rispetto all'Excel: li' Dare e Avere erano invertiti (uguali a FINSAT/FINREV)
      ('PAYFIN',   'Trasferimenti PayPal -> Fineco',     'Conto corrente FINECO',            'Paypal',                           'Trasferimenti',    null,             9),
      ('SATFIN',   'Trasferimenti Satispay -> Fineco',   'Conto corrente FINECO',            'Satispay',                         'Trasferimenti',    null,            10),
      ('REVFIN',   'Trasferimenti Revolut -> Fineco',    'Conto corrente FINECO',            'Revolut',                          'Trasferimenti',    null,            11),
      ('INV',      'Investimento dossier titoli',        'Dossier Titoli FINECO',            'Conto corrente FINECO',            'Investimenti',     null,            12),
      ('DIS',      'Disinvestimento dossier titoli',     'Conto corrente FINECO',            'Dossier Titoli FINECO',            'Investimenti',     null,            13),
      ('RIMMT',    'Incasso rimborsi MT Prof. su TR',    'Conto corrente Trade Republic',    'Crediti vs MT Prof.le',            'MT Prof.le',       'mt_rimborso',   14),
      ('ANTFIN',   'Anticipi MT a mezzo Fineco',         'Crediti vs MT Prof.le',            'Conto corrente FINECO',            'MT Prof.le',       null,            15),
      ('ANTPOR',   'Anticipi MT a mezzo portafoglio',    'Crediti vs MT Prof.le',            'Portafoglio',                      'MT Prof.le',       null,            16),
      ('GCCCRED',  'Giroconto carta di credito',         'Carta di credito (corrente)',      'Carta di credito (da addebitare)', 'Carta di credito', 'card_giroconto', 17),
      ('ADDCCRED', 'Addebito carta di credito',          'Carta di credito (da addebitare)', 'Conto corrente FINECO',            'Carta di credito', 'card_addebito',  18)
    ) as t(code, descr, dare, avere, grp, rule, ord)
    join accounts d on d.user_id = v_user and d.name = t.dare
    join accounts c on c.user_id = v_user and c.name = t.avere;

  -- 5.3 causali finanziarie "per canale": variazione crediti/debiti via ciascun canale
  insert into causali (user_id, code, description, kind, debit_account_id, credit_account_id,
                       grp, sort_order)
  select v_user,
         p.prefix || ch.sfx,
         p.label || ' via ' || ch.label,
         'finanziaria',
         case when p.chan_is_debit then chn.id else oth.id end,
         case when p.chan_is_debit then oth.id else chn.id end,
         p.grp,
         p.ord * 10 + ch.ord
    from (values
      ('ICRED', 'Incremento crediti', 'Altri crediti', false, 'Crediti', 10),
      ('DCRE',  'Decremento crediti', 'Altri crediti', true,  'Crediti', 11),
      ('IDEB',  'Incremento debiti',  'Altri debiti',  true,  'Debiti',  12),
      ('DDEB',  'Decremento debiti',  'Altri debiti',  false, 'Debiti',  13)
    ) as p(prefix, label, other, chan_is_debit, grp, ord)
    cross join (values
      ('FIN',   'Fineco',          'Conto corrente FINECO',         1),
      ('PAY',   'PayPal',          'Paypal',                        2),
      ('SAT',   'Satispay',        'Satispay',                      3),
      ('REV',   'Revolut',         'Revolut',                       4),
      ('TR',    'TradeRepublic',   'Conto corrente Trade Republic', 5),
      ('POR',   'Portafoglio',     'Portafoglio',                   6),
      ('CCRED', 'Carta di credito','Carta di credito (corrente)',   7)
    ) as ch(sfx, label, account, ord)
    join accounts chn on chn.user_id = v_user and chn.name = ch.account
    join accounts oth on oth.user_id = v_user and oth.name = p.other;

  -- 5.4 causali di ricavo (Dare fisso = canale) e di costo (Avere fisso = canale)
  insert into causali (user_id, code, description, kind, debit_account_id, credit_account_id,
                       grp, sort_order)
  select v_user, t.code, t.descr, t.kind,
         case when t.kind = 'ricavo' then a.id end,
         case when t.kind = 'costo'  then a.id end,
         case when t.kind = 'ricavo' then 'Ricavi' else 'Costi' end,
         t.ord
    from (values
      -- NOTA codici: uniformati. RICCCRED = ricavi su carta, RICRED/COSRED = crediti
      ('RICPOR',   'Ricavi Portafoglio',             'ricavo', 'Portafoglio',                   301),
      ('RICFIN',   'Ricavi Fineco',                  'ricavo', 'Conto corrente FINECO',         302),
      ('RICTR',    'Ricavi Trade Republic',          'ricavo', 'Conto corrente Trade Republic', 303),
      ('RICCCRED', 'Ricavi su carta di credito',     'ricavo', 'Carta di credito (corrente)',   304),
      ('RICSAT',   'Ricavi Satispay',                'ricavo', 'Satispay',                      305),
      ('RICPAY',   'Ricavi PayPal',                  'ricavo', 'Paypal',                        306),
      ('RICREV',   'Ricavi Revolut',                 'ricavo', 'Revolut',                       307),
      ('RICRED',   'Ricavi ad incremento crediti',   'ricavo', 'Altri crediti',                 308),
      ('RICDEB',   'Ricavi a decremento debiti',     'ricavo', 'Altri debiti',                  309),
      ('COSPOR',   'Costi Portafoglio',              'costo',  'Portafoglio',                   401),
      ('COSFIN',   'Costi Fineco',                   'costo',  'Conto corrente FINECO',         402),
      ('COSTR',    'Costi Trade Republic',           'costo',  'Conto corrente Trade Republic', 403),
      ('COSCCRED', 'Costi su carta di credito',      'costo',  'Carta di credito (corrente)',   404),
      ('COSSAT',   'Costi Satispay',                 'costo',  'Satispay',                      405),
      ('COSPAY',   'Costi PayPal',                   'costo',  'Paypal',                        406),
      ('COSREV',   'Costi Revolut',                  'costo',  'Revolut',                       407),
      ('COSRED',   'Costi a decremento crediti',     'costo',  'Altri crediti',                 408),
      ('COSDEB',   'Costi ad incremento debiti',     'costo',  'Altri debiti',                  409)
    ) as t(code, descr, kind, channel, ord)
    join accounts a on a.user_id = v_user and a.name = t.channel;

  -- 5.5 conti economici, ognuno col suo canale standard (come nella colonna B del Budget)
  insert into accounts (user_id, name, type, kind, budget_section, is_contingency,
                        standard_causale_id, sort_order)
  select v_user, t.name, 'economico', t.kind, t.sec, t.cont, c.id, t.ord
    from (values
      ('Emolumenti mensili',                   'ricavo', 'Ricavi',               false, 'RICTR',    101),
      ('Sopravvenienze attive',                'ricavo', 'Ricavi',               false, 'RICPOR',   102),
      ('Dividendi attivi',                     'ricavo', 'Ricavi',               false, 'RICFIN',   103),
      ('Interessi Attivi su c/c TR',           'ricavo', 'Ricavi',               false, 'RICTR',    104),
      ('Capital Gain',                         'ricavo', 'Ricavi',               false, 'RICFIN',   105),
      ('Comm.ni c/c FINECO',                   'costo',  'Banca e imposte',      false, 'COSFIN',   106),
      ('Imposte di bollo e comm.ni su titoli', 'costo',  'Banca e imposte',      false, 'COSFIN',   107),
      ('Imposte di bollo FINECO (c/c)',        'costo',  'Banca e imposte',      false, 'COSFIN',   108),
      ('Imposta di bollo Carta di credito',    'costo',  'Banca e imposte',      false, 'COSFIN',   109),
      ('Imposte sostitutive plus. Finanziarie','costo',  'Banca e imposte',      false, 'COSFIN',   110),
      ('Capital Loss',                         'costo',  'Banca e imposte',      false, 'COSFIN',   111),
      ('Imposte di bollo TR (c/c)',            'costo',  'Banca e imposte',      false, 'COSTR',    112),
      ('Comm.ni c/c TR',                       'costo',  'Banca e imposte',      false, 'COSTR',    113),
      ('Contributo convivenza (Hype)',         'costo',  'Convivenza',           false, 'COSTR',    114),
      ('Contributo convivenza (Wi-Fi)',        'costo',  'Convivenza',           false, 'COSFIN',   115),
      ('Storage iCloud',                       'costo',  'Abbonamenti',          false, 'COSCCRED', 116),
      ('Apple Music',                          'costo',  'Abbonamenti',          false, 'COSCCRED', 117),
      ('Abbonamenti TV',                       'costo',  'Abbonamenti',          false, 'COSCCRED', 118),
      ('Amazon Prime',                         'costo',  'Abbonamenti',          false, 'COSCCRED', 119),
      ('Caffè',                                'costo',  'Ristorazione',         false, 'COSCCRED', 120),
      ('Ristoranti',                           'costo',  'Ristorazione',         false, 'COSCCRED', 121),
      ('Sushi',                                'costo',  'Ristorazione',         false, 'COSCCRED', 122),
      ('Pizza',                                'costo',  'Ristorazione',         false, 'COSCCRED', 123),
      ('Gelato',                               'costo',  'Ristorazione',         false, 'COSCCRED', 124),
      ('Aperitivi',                            'costo',  'Ristorazione',         false, 'COSCCRED', 125),
      ('Alcol',                                'costo',  'Ristorazione',         false, 'COSCCRED', 126),
      ('Vestiti/Scarpe',                       'costo',  'Acquisti',             false, 'COSCCRED', 127),
      ('Accessori',                            'costo',  'Acquisti',             false, 'COSCCRED', 128),
      ('Lenti a contatto',                     'costo',  'Acquisti',             false, 'COSCCRED', 129),
      ('Acq. beni inf. 51,65',                 'costo',  'Acquisti',             false, 'COSCCRED', 130),
      ('Barbiere',                             'costo',  'Persona',              false, 'COSCCRED', 131),
      ('Sigarette',                            'costo',  'Persona',              false, 'COSCCRED', 132),
      ('Calcio',                               'costo',  'Sport e svago',        false, 'COSPOR',   133),
      ('Palestra',                             'costo',  'Sport e svago',        false, 'COSTR',    134),
      ('Calcetto',                             'costo',  'Sport e svago',        false, 'COSPOR',   135),
      ('Fantacalcio',                          'costo',  'Sport e svago',        false, 'COSPOR',   136),
      ('Lettino (mare)',                       'costo',  'Sport e svago',        false, 'COSCCRED', 137),
      ('Vacanze',                              'costo',  'Sport e svago',        false, 'COSTR',    138),
      ('Cinema',                               'costo',  'Sport e svago',        false, 'COSCCRED', 139),
      ('Giochi',                               'costo',  'Sport e svago',        false, 'COSCCRED', 140),
      ('Altri costi per divertimenti',         'costo',  'Sport e svago',        false, 'COSCCRED', 141),
      ('Pokèmon',                              'costo',  'Sport e svago',        false, 'COSCCRED', 142),
      ('Fisioterapia',                         'costo',  'Salute e cultura',     false, 'COSCCRED', 143),
      ('Medicinali e integratori',             'costo',  'Salute e cultura',     false, 'COSCCRED', 144),
      ('Visite mediche',                       'costo',  'Salute e cultura',     false, 'COSCCRED', 145),
      ('Libri',                                'costo',  'Salute e cultura',     false, 'COSCCRED', 146),
      ('Regali',                               'costo',  'Altro',                false, 'COSCCRED', 147),
      ('Altri costi',                          'costo',  'Altro',                false, 'COSCCRED', 148),
      -- presente solo nel Budget dell'Excel, non nel PdC
      ('Spese indivise non preventivate',      'costo',  'Imprevisti',           true,  'COSCCRED', 199)
    ) as t(name, kind, sec, cont, std, ord)
    left join causali c on c.user_id = v_user and c.code = t.std;

  return 'Piano dei conti e causali caricati';
end $$;


-- ---------------------------------------------------------------------
-- 6. PERMESSI SULLE FUNZIONI (solo utenti loggati)
-- ---------------------------------------------------------------------
revoke execute on function seed_default_chart()                        from public, anon;
revoke execute on function init_year(int)                              from public, anon;
revoke execute on function account_balances(int, int)                  from public, anon;
revoke execute on function suggest_channel_adjustments(int, int)       from public, anon;
grant  execute on function seed_default_chart()                        to authenticated;
grant  execute on function init_year(int)                              to authenticated;
grant  execute on function account_balances(int, int)                  to authenticated;
grant  execute on function suggest_channel_adjustments(int, int)       to authenticated;
