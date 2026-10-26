-- =====================================================================
-- Sistem Manajemen Stok CV Agrimas Perkasa
-- 001: Fondasi (perusahaan, pengguna, gudang, master data)
--
-- Jalankan sekali di Supabase: SQL Editor -> New query -> tempel -> Run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Perusahaan dan pengguna
-- ---------------------------------------------------------------------

create table perusahaan (
  id          uuid primary key default gen_random_uuid(),
  kode        text not null unique,
  nama        text not null,
  alamat      text,
  telepon     text,
  npwp        text,
  aktif       boolean not null default true,
  dibuat_pada timestamptz not null default now(),
  diubah_pada timestamptz not null default now()
);

-- Owner tidak terikat perusahaan (perusahaan_id kosong).
-- Admin dan User terikat tepat ke satu perusahaan.
create table pengguna (
  id            uuid primary key references auth.users (id) on delete cascade,
  perusahaan_id uuid references perusahaan (id),
  username      text not null unique,
  nama          text not null,
  peran         text not null check (peran in ('owner', 'admin', 'user')),
  aktif         boolean not null default true,
  dibuat_pada   timestamptz not null default now(),
  diubah_pada   timestamptz not null default now(),
  check ((peran = 'owner') = (perusahaan_id is null))
);

-- ---------------------------------------------------------------------
-- Fungsi bantu hak akses (dipakai oleh Row Level Security)
-- ---------------------------------------------------------------------

create function peran_saya() returns text
language sql stable security definer set search_path = public as $$
  select peran from pengguna where id = auth.uid() and aktif
$$;

-- Boleh melihat dan mengisi data perusahaan ini?
create function akses_perusahaan(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from pengguna
    where id = auth.uid() and aktif
      and (peran = 'owner' or perusahaan_id = pid)
  )
$$;

-- Boleh mengelola (edit transaksi, batal, atur user dan gudang) perusahaan ini?
create function kelola_perusahaan(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from pengguna
    where id = auth.uid() and aktif
      and (peran = 'owner' or (peran = 'admin' and perusahaan_id = pid))
  )
$$;

create function set_diubah_pada() returns trigger
language plpgsql as $$
begin
  new.diubah_pada := now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Master data (semua dipisah per perusahaan)
-- ---------------------------------------------------------------------

create table gudang (
  id            uuid primary key default gen_random_uuid(),
  perusahaan_id uuid not null references perusahaan (id),
  kode          text not null,
  nama          text not null,
  alamat        text,
  keterangan    text,
  aktif         boolean not null default true,
  dibuat_oleh   uuid default auth.uid(),
  dibuat_pada   timestamptz not null default now(),
  diubah_pada   timestamptz not null default now(),
  unique (perusahaan_id, kode),
  unique (id, perusahaan_id)
);

create table barang (
  id            uuid primary key default gen_random_uuid(),
  perusahaan_id uuid not null references perusahaan (id),
  kode          text not null,
  nama          text not null,
  satuan        text not null default 'pcs',
  harga_jual    numeric(18, 2) not null default 0 check (harga_jual >= 0),
  harga_beli    numeric(18, 2) not null default 0 check (harga_beli >= 0),
  stok_minimum  numeric(18, 3) not null default 0 check (stok_minimum >= 0),
  hpp           numeric(18, 4) not null default 0,  -- diisi otomatis oleh transaksi stok
  keterangan    text,
  aktif         boolean not null default true,
  dibuat_oleh   uuid default auth.uid(),
  dibuat_pada   timestamptz not null default now(),
  diubah_pada   timestamptz not null default now(),
  unique (perusahaan_id, kode),
  unique (id, perusahaan_id)
);

-- Stok per barang per gudang. Hanya diubah oleh fungsi transaksi (tahap 3).
create table stok_gudang (
  perusahaan_id uuid not null references perusahaan (id),
  barang_id     uuid not null,
  gudang_id     uuid not null,
  qty           numeric(18, 3) not null default 0,
  diubah_pada   timestamptz not null default now(),
  primary key (barang_id, gudang_id),
  foreign key (barang_id, perusahaan_id) references barang (id, perusahaan_id),
  foreign key (gudang_id, perusahaan_id) references gudang (id, perusahaan_id)
);

create table supplier (
  id            uuid primary key default gen_random_uuid(),
  perusahaan_id uuid not null references perusahaan (id),
  kode          text not null,
  nama          text not null,
  alamat        text,
  kota          text,
  telepon       text,
  kontak        text,
  keterangan    text,
  aktif         boolean not null default true,
  dibuat_oleh   uuid default auth.uid(),
  dibuat_pada   timestamptz not null default now(),
  diubah_pada   timestamptz not null default now(),
  unique (perusahaan_id, kode),
  unique (id, perusahaan_id)
);

-- Barang apa saja yang dipasok oleh supplier mana, dan harga belinya.
create table barang_supplier (
  id            uuid primary key default gen_random_uuid(),
  perusahaan_id uuid not null references perusahaan (id),
  barang_id     uuid not null,
  supplier_id   uuid not null,
  harga_beli    numeric(18, 2) not null default 0 check (harga_beli >= 0),
  dibuat_oleh   uuid default auth.uid(),
  dibuat_pada   timestamptz not null default now(),
  diubah_pada   timestamptz not null default now(),
  unique (barang_id, supplier_id),
  foreign key (barang_id, perusahaan_id) references barang (id, perusahaan_id) on delete cascade,
  foreign key (supplier_id, perusahaan_id) references supplier (id, perusahaan_id) on delete cascade
);

create table customer (
  id            uuid primary key default gen_random_uuid(),
  perusahaan_id uuid not null references perusahaan (id),
  kode          text not null,
  nama          text not null,
  alamat        text,
  kota          text,
  telepon       text,
  keterangan    text,
  aktif         boolean not null default true,
  dibuat_oleh   uuid default auth.uid(),
  dibuat_pada   timestamptz not null default now(),
  diubah_pada   timestamptz not null default now(),
  unique (perusahaan_id, kode),
  unique (id, perusahaan_id)
);

create table sales (
  id            uuid primary key default gen_random_uuid(),
  perusahaan_id uuid not null references perusahaan (id),
  kode          text not null,
  nama          text not null,
  telepon       text,
  aktif         boolean not null default true,
  dibuat_oleh   uuid default auth.uid(),
  dibuat_pada   timestamptz not null default now(),
  diubah_pada   timestamptz not null default now(),
  unique (perusahaan_id, kode),
  unique (id, perusahaan_id)
);

-- Catatan siapa mengubah atau menghapus apa.
create table log_aktivitas (
  id            bigint generated always as identity primary key,
  perusahaan_id uuid references perusahaan (id),
  pengguna_id   uuid default auth.uid(),
  tabel         text not null,
  data_id       text not null,
  aksi          text not null,
  data_lama     jsonb,
  data_baru     jsonb,
  waktu         timestamptz not null default now()
);

create function catat_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  lama jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  baru jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  rec  jsonb := coalesce(baru, lama);
begin
  insert into log_aktivitas (perusahaan_id, tabel, data_id, aksi, data_lama, data_baru)
  values (
    case when tg_table_name = 'perusahaan' then (rec ->> 'id')::uuid
         else (rec ->> 'perusahaan_id')::uuid end,
    tg_table_name, rec ->> 'id', lower(tg_op), lama, baru
  );
  return coalesce(new, old);
end $$;

-- Trigger diubah_pada dan log untuk semua tabel master.
do $$
declare t text;
begin
  foreach t in array array['perusahaan', 'pengguna', 'gudang', 'barang', 'supplier',
                           'barang_supplier', 'customer', 'sales'] loop
    execute format('create trigger %I_diubah before update on %I
                    for each row execute function set_diubah_pada()', t, t);
    execute format('create trigger %I_log after update or delete on %I
                    for each row execute function catat_log()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Row Level Security: data perusahaan lain tidak bisa dibaca atau diubah
-- ---------------------------------------------------------------------

alter table perusahaan      enable row level security;
alter table pengguna        enable row level security;
alter table gudang          enable row level security;
alter table barang          enable row level security;
alter table stok_gudang     enable row level security;
alter table supplier        enable row level security;
alter table barang_supplier enable row level security;
alter table customer        enable row level security;
alter table sales           enable row level security;
alter table log_aktivitas   enable row level security;

-- Perusahaan: hanya Owner yang menambah. Owner/Admin boleh mengubah datanya.
create policy perusahaan_baca on perusahaan for select using (akses_perusahaan(id));
create policy perusahaan_tambah on perusahaan for insert with check (peran_saya() = 'owner');
create policy perusahaan_ubah on perusahaan for update
  using (kelola_perusahaan(id)) with check (kelola_perusahaan(id));

-- Pengguna: semua orang melihat dirinya sendiri. Owner/Admin mengatur user
-- perusahaannya. Hanya Owner yang boleh membuat atau mengubah Owner.
create policy pengguna_baca on pengguna for select
  using (id = auth.uid() or peran_saya() = 'owner'
         or (perusahaan_id is not null and kelola_perusahaan(perusahaan_id)));
create policy pengguna_tambah on pengguna for insert
  with check (peran_saya() = 'owner'
              or (peran in ('admin', 'user') and kelola_perusahaan(perusahaan_id)));
create policy pengguna_ubah on pengguna for update
  using (peran_saya() = 'owner'
         or (peran in ('admin', 'user') and kelola_perusahaan(perusahaan_id)))
  with check (peran_saya() = 'owner'
              or (peran in ('admin', 'user') and kelola_perusahaan(perusahaan_id)));

-- Gudang: semua user perusahaan boleh lihat, Owner/Admin yang mengatur.
create policy gudang_baca on gudang for select using (akses_perusahaan(perusahaan_id));
create policy gudang_tambah on gudang for insert with check (kelola_perusahaan(perusahaan_id));
create policy gudang_ubah on gudang for update
  using (kelola_perusahaan(perusahaan_id)) with check (kelola_perusahaan(perusahaan_id));
create policy gudang_hapus on gudang for delete using (kelola_perusahaan(perusahaan_id));

-- Barang, supplier, customer, sales, barang_supplier: semua user perusahaan
-- boleh tambah dan ubah; hanya Owner/Admin yang boleh menghapus.
do $$
declare t text;
begin
  foreach t in array array['barang', 'supplier', 'barang_supplier', 'customer', 'sales'] loop
    execute format('create policy %I_baca on %I for select using (akses_perusahaan(perusahaan_id))', t, t);
    execute format('create policy %I_tambah on %I for insert with check (akses_perusahaan(perusahaan_id))', t, t);
    execute format('create policy %I_ubah on %I for update using (akses_perusahaan(perusahaan_id))
                    with check (akses_perusahaan(perusahaan_id))', t, t);
    execute format('create policy %I_hapus on %I for delete using (kelola_perusahaan(perusahaan_id))', t, t);
  end loop;
end $$;

-- Stok hanya bisa dibaca dari aplikasi.
create policy stok_gudang_baca on stok_gudang for select using (akses_perusahaan(perusahaan_id));

-- Log hanya bisa dibaca Owner/Admin.
create policy log_baca on log_aktivitas for select
  using (perusahaan_id is not null and kelola_perusahaan(perusahaan_id));

-- ---------------------------------------------------------------------
-- Hak akses tabel untuk user yang sudah login
-- ---------------------------------------------------------------------

revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- HPP dan stok tidak boleh diubah langsung dari aplikasi.
revoke update on barang from authenticated;
grant update (kode, nama, satuan, harga_jual, harga_beli, stok_minimum, keterangan, aktif)
  on barang to authenticated;
revoke insert, update, delete on stok_gudang from authenticated;
revoke insert, update, delete on log_aktivitas from authenticated;

-- ---------------------------------------------------------------------
-- Setup awal: menjadikan akun pertama sebagai Owner
-- Hanya bisa dijalankan dari SQL Editor, tidak dari aplikasi.
-- ---------------------------------------------------------------------

create function setup_owner(p_email text, p_username text, p_nama text) returns text
language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  select id into uid from auth.users where lower(email) = lower(p_email);
  if uid is null then
    raise exception 'Akun dengan email % belum ada. Buat dulu di Authentication -> Users.', p_email;
  end if;
  insert into pengguna (id, username, nama, peran)
  values (uid, lower(p_username), p_nama, 'owner')
  on conflict (id) do update set peran = 'owner', perusahaan_id = null, aktif = true;
  return 'Owner siap: ' || p_username;
end $$;

revoke execute on function setup_owner(text, text, text) from public, anon, authenticated;

-- Perusahaan pertama.
insert into perusahaan (kode, nama) values ('PAP', 'CV Prima Agro Perkasa');
