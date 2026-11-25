-- =====================================================================
--  MIGRAZIONE: preferiti e movimenti provvisori del Giornale
--  Da eseguire una volta nel SQL Editor. Si puo' rieseguire senza danni.
--  Lo schema aggiornato (contabilita_schema.sql) include gia' tutto questo.
-- =====================================================================

-- 1. Movimento provvisorio: compare nel Giornale ma non entra nei calcoli
alter table entries add column if not exists provisional boolean not null default false;

-- 2. Preferiti del Giornale
create table if not exists favorites (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name                text not null check (length(btrim(name)) > 0),
  causale_id          uuid not null references causali(id) on delete cascade,
  economic_account_id uuid references accounts(id) on delete cascade,
  amount              numeric(14,2) check (amount > 0),
  note                text,
  created_at          timestamptz not null default now()
);
create index if not exists favorites_user_idx on favorites (user_id);

alter table favorites enable row level security;
drop policy if exists "own rows" on favorites;
create policy "own rows" on favorites for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- 3. Vista del Giornale: colonna provisional e niente Alert sui provvisori
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
  coalesce(not e.provisional
           and ea.kind = c.kind
           and ea.standard_causale_id is not null
           and ea.standard_causale_id <> e.causale_id, false) as channel_alert,
  e.provisional
from entries e
join causali c on c.id = e.causale_id
left join accounts ea
       on ea.id = case c.kind when 'ricavo' then e.credit_account_id
                              when 'costo'  then e.debit_account_id end;

-- 4. Saldi dei conti (usati anche da init_year): i provvisori non contano
create or replace function account_balances(p_year int, p_month int default 12)
returns table (account_id uuid, balance numeric)
language sql
stable
set search_path = public
as $$
  with mv as (
    select debit_account_id as account_id, amount as d, 0::numeric as c
      from entries
     where not provisional
       and entry_date >= make_date(p_year, 1, 1)
       and entry_date <  (make_date(p_year, p_month, 1) + interval '1 month')::date
    union all
    select credit_account_id, 0::numeric, amount
      from entries
     where not provisional
       and entry_date >= make_date(p_year, 1, 1)
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

-- controllo: deve restituire la colonna provisional e la tabella favorites
select column_name from information_schema.columns
 where table_name = 'entries' and column_name = 'provisional'
union all
select table_name from information_schema.tables where table_name = 'favorites';
