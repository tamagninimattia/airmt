-- =====================================================================
--  MIGRAZIONE: gli storni chiedono le Var come le registrazioni fuori canale
--  Da eseguire una volta nel SQL Editor. Si puo' rieseguire senza danni.
--  Lo schema aggiornato (contabilita_schema.sql) include gia' tutto questo.
--  Storno = voce di costo registrata con una causale di ricavo (rimborso, reso, vendita) o viceversa:
--  Alert nel Giornale e Var suggerite + sul canale usato e + sul canale standard della voce.
-- =====================================================================

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
  -- Alert: causale diversa dal canale standard, oppure storno (voce di costo con causale di ricavo o
  -- viceversa: rimborsi, resi, vendite), che chiede anch'esso le Var
  coalesce(not e.provisional
           and ea.standard_causale_id is not null
           and (ea.kind <> c.kind or ea.standard_causale_id <> e.causale_id), false) as channel_alert,
  e.provisional,
  coalesce(ea.kind <> c.kind, false) as storno
from entries e
join causali c on c.id = e.causale_id
left join accounts ea
       on ea.id = case c.kind when 'ricavo' then e.credit_account_id
                              when 'costo'  then e.debit_account_id end;

create or replace function suggest_channel_adjustments(p_year int, p_month int)
returns table (causale_id uuid, amount numeric)
language sql
stable
set search_path = public
as $$
  with a as (
    select ee.causale_id as actual_causale, ee.standard_causale_id as std_causale, ee.amount, ee.storno
      from entries_enriched ee
     where ee.channel_alert
       and ee.entry_date >= make_date(p_year, p_month, 1)
       and ee.entry_date <  (make_date(p_year, p_month, 1) + interval '1 month')::date
  ),
  -- fuori canale: + sul canale usato, − sul canale standard; storno: + su entrambi
  -- (canali di tipo opposto: costi e ricavi del budget crescono insieme, il risultato non cambia)
  m as (
    select actual_causale as causale_id, amount from a
    union all
    select std_causale, case when storno then amount else -amount end from a
  )
  select m.causale_id, sum(m.amount)::numeric(14,2)
    from m
   group by m.causale_id
  having sum(m.amount) <> 0;
$$;

-- controllo: storni del 2026 con il loro Alert (deve restituire le registrazioni di rimborsi e vendite)
select entry_date, causale_code, economic_account_name, amount, channel_alert
  from entries_enriched
 where storno and entry_date >= '2026-01-01'
 order by entry_date;
