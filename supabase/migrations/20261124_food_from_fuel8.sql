-- Applied to project health-hub (tldbofbnqdloddgivktk) on 24 Nov 2026 as migration "food_from_fuel8".
-- Food totals per day, sent from Fuel8 via Apple Health and an iPhone Shortcut.
-- Rows are written only by the food-sync Edge Function (service role); each person can read and delete their own.
create table public.food_days (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  kcal numeric(7,1) check (kcal is null or (kcal >= 0 and kcal <= 20000)),
  protein_g numeric(6,1) check (protein_g is null or (protein_g >= 0 and protein_g <= 2000)),
  carbs_g numeric(6,1) check (carbs_g is null or (carbs_g >= 0 and carbs_g <= 2000)),
  fat_g numeric(6,1) check (fat_g is null or (fat_g >= 0 and fat_g <= 2000)),
  source text not null default 'fuel8' check (char_length(source) <= 40),
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);
comment on table public.food_days is 'Health Hub: daily food totals (calories and macros) from Fuel8 via Apple Health. Written by the food-sync Edge Function; row-level security limits reads and deletes to the owner.';

alter table public.food_days enable row level security;
revoke all on public.food_days from anon, authenticated;
grant select, delete on public.food_days to authenticated;
create policy "Read own food days" on public.food_days for select to authenticated using ((select auth.uid()) = user_id);
create policy "Delete own food days" on public.food_days for delete to authenticated using ((select auth.uid()) = user_id);

-- One sync key per person. Only a SHA-256 hash is stored; the key itself is shown once in the app and pasted into the Shortcut.
create table public.sync_keys (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  key_hash text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  hint text check (hint is null or char_length(hint) <= 8),
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
comment on table public.sync_keys is 'Health Hub: hashed personal key that lets the iPhone Shortcut send food totals to the food-sync Edge Function. Owner-only.';

alter table public.sync_keys enable row level security;
revoke all on public.sync_keys from anon, authenticated;
grant select, insert, update, delete on public.sync_keys to authenticated;
create policy "Read own sync key" on public.sync_keys for select to authenticated using ((select auth.uid()) = user_id);
create policy "Create own sync key" on public.sync_keys for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Replace own sync key" on public.sync_keys for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Remove own sync key" on public.sync_keys for delete to authenticated using ((select auth.uid()) = user_id);
