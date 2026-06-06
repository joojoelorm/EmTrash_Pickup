-- Emtrash Pickup MVP Supabase setup
-- Run this in Supabase Dashboard > SQL Editor.

create table if not exists public.app_state (
  id text primary key,
  state jsonb not null default '{"users":[],"pickups":[],"notifications":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_state enable row level security;

drop policy if exists "public read app state" on public.app_state;
create policy "public read app state"
on public.app_state
for select
to anon
using (true);

drop policy if exists "public insert app state" on public.app_state;
create policy "public insert app state"
on public.app_state
for insert
to anon
with check (true);

drop policy if exists "public update app state" on public.app_state;
create policy "public update app state"
on public.app_state
for update
to anon
using (true)
with check (true);

insert into public.app_state (id, state)
values (
  'default',
  '{
    "users": [
      {
        "id": "collector_demo",
        "role": "collector",
        "name": "Kwame (Tricycle)",
        "phone": "0241234567",
        "address": "Osu, Accra",
        "serviceArea": "Osu · Labone · Airport Residential",
        "joinCode": "KWAME1",
        "momoNumber": "0241234567",
        "momoNetwork": "MTN MoMo",
        "lat": 5.557,
        "lng": -0.182
      },
      {
        "id": "admin_demo",
        "role": "admin",
        "name": "Emtrash Operator",
        "phone": "0500000000"
      },
      {
        "id": "resident_ama_demo",
        "role": "resident",
        "name": "Ama Mensah",
        "phone": "0559876543",
        "address": "Labone, near Osu",
        "collectorId": "collector_demo",
        "lat": 5.565,
        "lng": -0.175
      },
      {
        "id": "resident_kofi_demo",
        "role": "resident",
        "name": "Kofi Asante",
        "phone": "0201122334",
        "address": "Airport Residential",
        "collectorId": "collector_demo",
        "lat": 5.572,
        "lng": -0.180
      }
    ],
    "pickups": [
      {
        "id": "pickup_demo_requested",
        "residentId": "resident_ama_demo",
        "collectorId": "collector_demo",
        "status": "requested",
        "createdAt": "2026-06-05T00:00:00.000Z",
        "note": "Kitchen bin is overflowing"
      },
      {
        "id": "pickup_demo_priced",
        "residentId": "resident_kofi_demo",
        "collectorId": "collector_demo",
        "status": "priced",
        "createdAt": "2026-06-05T00:30:00.000Z",
        "note": "",
        "priceGhs": 8,
        "pricedAt": "2026-06-05T00:45:00.000Z"
      }
    ],
    "notifications": []
  }'::jsonb
)
on conflict (id) do nothing;
