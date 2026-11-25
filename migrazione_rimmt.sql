-- =====================================================================
--  MIGRAZIONE: il budget dei rimborsi MT (RIMMT) diventa calcolato
--  Da eseguire una volta nel SQL Editor. Si puo' rieseguire senza danni.
--  Regola: gennaio = saldo iniziale di "Crediti vs MT Prof.le";
--          da febbraio = anticipi del mese prima (ANTFIN + ANTPOR).
-- =====================================================================
alter table causali drop constraint if exists causali_budget_rule_check;
alter table causali add constraint causali_budget_rule_check
  check (budget_rule in ('card_giroconto', 'card_addebito', 'mt_rimborso'));

update causali set budget_rule = 'mt_rimborso' where code = 'RIMMT';

-- i valori fissi eventualmente caricati da seed_2027.sql non servono piu'
delete from budget_causali
 where causale_id in (select id from causali where code = 'RIMMT');

select code, budget_rule from causali where budget_rule is not null order by code;
