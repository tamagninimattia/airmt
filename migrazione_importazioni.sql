-- =====================================================================
--  MIGRAZIONE: importazione del Giornale da Excel
--  Da eseguire una volta nel SQL Editor. Si puo' rieseguire senza danni.
--  Lo schema aggiornato (contabilita_schema.sql) include gia' tutto questo.
-- =====================================================================

-- Ogni caricamento ha una riga qui; le sue registrazioni puntano a lei.
-- Eliminare l'importazione elimina le sue registrazioni ("Annulla importazione").
create table if not exists imports (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  label      text not null,
  created_at timestamptz not null default now()
);
create index if not exists imports_user_idx on imports (user_id);
alter table entries add column if not exists import_id uuid references imports(id) on delete cascade;
create index if not exists entries_import_idx on entries (import_id);

alter table imports enable row level security;
drop policy if exists "own rows" on imports;
create policy "own rows" on imports for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- controllo: deve restituire la tabella imports e la colonna import_id
select table_name as oggetto from information_schema.tables where table_name = 'imports'
union all
select column_name from information_schema.columns where table_name = 'entries' and column_name = 'import_id';
