-- =====================================================================
-- Sistem Manajemen Stok CV Agrimas Perkasa
-- 002: Transaksi stok (pembelian, penjualan, retur, penyesuaian, pindah gudang)
--
-- Jalankan setelah 001_fondasi.sql: SQL Editor -> New query -> tempel -> Run.
--
-- Semua dokumen yang mengubah stok dibuat lewat fungsi (RPC) di bawah,
-- sehingga stok, HPP, dan kartu stok selalu berubah bersamaan dalam satu
-- transaksi database. Aplikasi hanya boleh MEMBACA tabel-tabel ini.
-- =====================================================================

-- Perubahan HPP oleh transaksi stok tidak perlu masuk log aktivitas.
create or replace function catat_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  lama jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  baru jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  rec  jsonb := coalesce(baru, lama);
begin
  if tg_op = 'UPDATE' and (lama - 'hpp' - 'diubah_pada') = (baru - 'hpp' - 'diubah_pada') then
    return new;
  end if;
  insert into log_aktivitas (perusahaan_id, tabel, data_id, aksi, data_lama, data_baru)
  values (
    case when tg_table_name = 'perusahaan' then (rec ->> 'id')::uuid
         else (rec ->> 'perusahaan_id')::uuid end,
    tg_table_name, rec ->> 'id', lower(tg_op), lama, baru
  );
  return coalesce(new, old);
end $$;

-- ---------------------------------------------------------------------
-- Penomoran dokumen
-- ---------------------------------------------------------------------
-- Format memakai kode: {PRSH} singkatan perusahaan, {GDG} kode gudang,
-- {YYYY} tahun, {YY} tahun 2 digit, {MM} bulan, {NNNN} nomor urut
-- (jumlah N = jumlah digit). Nomor urut mulai dari 1 lagi setiap kali
-- bagian lain dari nomor berubah (misalnya ganti bulan atau ganti gudang).

create table penomoran (
  perusahaan_id uuid not null references perusahaan (id),
  jenis         text not null,
  format        text not null check (format ~ '\{N+\}'),
  primary key (perusahaan_id, jenis)
);

create table nomor_urut (
  perusahaan_id uuid not null references perusahaan (id),
  kunci         text not null,
  terakhir      integer not null,
  primary key (perusahaan_id, kunci)
);

create function format_nomor_bawaan(p_jenis text) returns text
language sql immutable as $$
  select case
    when p_jenis in ('FJ', 'SJK', 'RJ') then p_jenis || '/{PRSH}/{GDG}/{YYYY}/{MM}/{NNNN}'
    else p_jenis || '/{PRSH}/{YYYY}/{MM}/{NNNN}'
  end
$$;

create function nomor_berikutnya(p_pid uuid, p_jenis text, p_gudang uuid, p_tanggal date) returns text
language plpgsql security definer set search_path = public as $$
declare
  f text;
  digit int;
  v_kunci text;
  n int;
begin
  select format into f from penomoran where perusahaan_id = p_pid and jenis = p_jenis;
  f := coalesce(f, format_nomor_bawaan(p_jenis));
  f := replace(f, '{PRSH}', (select kode from perusahaan where id = p_pid));
  f := replace(f, '{GDG}', coalesce((select kode from gudang where id = p_gudang), ''));
  f := replace(f, '{YYYY}', to_char(p_tanggal, 'YYYY'));
  f := replace(f, '{YY}', to_char(p_tanggal, 'YY'));
  f := replace(f, '{MM}', to_char(p_tanggal, 'MM'));
  digit := length(substring(f from '\{(N+)\}'));
  v_kunci := regexp_replace(f, '\{N+\}', '#');
  insert into nomor_urut (perusahaan_id, kunci, terakhir) values (p_pid, v_kunci, 1)
  on conflict on constraint nomor_urut_pkey do update set terakhir = nomor_urut.terakhir + 1
  returning nomor_urut.terakhir into n;
  return regexp_replace(f, '\{N+\}', lpad(n::text, digit, '0'));
end $$;

-- ---------------------------------------------------------------------
-- Kartu stok: satu baris untuk setiap pergerakan barang
-- ---------------------------------------------------------------------

create table mutasi_stok (
  id            bigint generated always as identity primary key,
  perusahaan_id uuid not null references perusahaan (id),
  tanggal       date not null,
  barang_id     uuid not null,
  gudang_id     uuid not null,
  jenis         text not null,      -- kode dokumen: SJM, FJ, RJ, RB, PS, TG, atau BATAL
  dokumen_tabel text not null,
  dokumen_id    uuid not null,
  nomor         text not null,
  qty_masuk     numeric(18, 3) not null default 0,
  qty_keluar    numeric(18, 3) not null default 0,
  hpp           numeric(18, 4) not null default 0,  -- harga per unit pergerakan ini
  keterangan    text,
  dibuat_oleh   uuid default auth.uid(),
  dibuat_pada   timestamptz not null default now(),
  foreign key (barang_id, perusahaan_id) references barang (id, perusahaan_id),
  foreign key (gudang_id, perusahaan_id) references gudang (id, perusahaan_id)
);
create index mutasi_stok_barang on mutasi_stok (barang_id, tanggal);
create index mutasi_stok_dokumen on mutasi_stok (dokumen_tabel, dokumen_id);

-- ---------------------------------------------------------------------
-- Dokumen pembelian
-- ---------------------------------------------------------------------

create table purchase_order (
  id              uuid primary key default gen_random_uuid(),
  perusahaan_id   uuid not null references perusahaan (id),
  nomor           text not null,
  tanggal         date not null,
  supplier_id     uuid not null,
  jatuh_tempo     date,             -- batas pemenuhan PO
  keterangan      text,
  subtotal        numeric(18, 2) not null default 0,
  diskon_total    numeric(18, 2) not null default 0,
  ppn_total       numeric(18, 2) not null default 0,
  total           numeric(18, 2) not null default 0,
  status          text not null default 'terbuka'
                  check (status in ('terbuka', 'sebagian', 'selesai', 'ditutup', 'batal')),
  alasan_batal    text,
  dibatalkan_oleh uuid,
  dibatalkan_pada timestamptz,
  dibuat_oleh     uuid default auth.uid(),
  dibuat_pada     timestamptz not null default now(),
  unique (perusahaan_id, nomor),
  foreign key (supplier_id, perusahaan_id) references supplier (id, perusahaan_id)
);

create table po_detail (
  id             uuid primary key default gen_random_uuid(),
  perusahaan_id  uuid not null references perusahaan (id),
  po_id          uuid not null references purchase_order (id),
  urutan         int not null,
  barang_id      uuid not null,
  qty            numeric(18, 3) not null check (qty > 0),
  harga          numeric(18, 2) not null check (harga >= 0),
  diskon_persen  numeric(7, 3) not null default 0,
  diskon_nominal numeric(18, 2) not null default 0,
  ppn_persen     numeric(7, 3) not null default 0,
  dpp            numeric(18, 2) not null,   -- qty x harga - diskon
  ppn            numeric(18, 2) not null,
  subtotal       numeric(18, 2) not null,
  qty_diterima   numeric(18, 3) not null default 0,
  foreign key (barang_id, perusahaan_id) references barang (id, perusahaan_id)
);

create table surat_jalan_masuk (
  id              uuid primary key default gen_random_uuid(),
  perusahaan_id   uuid not null references perusahaan (id),
  nomor           text not null,    -- nomor surat jalan dari supplier
  tanggal         date not null,
  po_id           uuid not null references purchase_order (id),
  supplier_id     uuid not null,
  gudang_id       uuid not null,
  faktur_id       uuid,             -- diisi saat faktur supplier diinput
  keterangan      text,
  status          text not null default 'aktif' check (status in ('aktif', 'batal')),
  alasan_batal    text,
  dibatalkan_oleh uuid,
  dibatalkan_pada timestamptz,
  dibuat_oleh     uuid default auth.uid(),
  dibuat_pada     timestamptz not null default now(),
  foreign key (supplier_id, perusahaan_id) references supplier (id, perusahaan_id),
  foreign key (gudang_id, perusahaan_id) references gudang (id, perusahaan_id)
);

create table sj_masuk_detail (
  id            uuid primary key default gen_random_uuid(),
  perusahaan_id uuid not null references perusahaan (id),
  sj_id         uuid not null references surat_jalan_masuk (id),
  po_detail_id  uuid not null references po_detail (id),
  barang_id     uuid not null,
  qty           numeric(18, 3) not null check (qty > 0),
  harga         numeric(18, 4) not null,   -- harga per unit dari PO (setelah diskon, sebelum PPN)
  foreign key (barang_id, perusahaan_id) references barang (id, perusahaan_id)
);

create table faktur_pembelian (
  id              uuid primary key default gen_random_uuid(),
  perusahaan_id   uuid not null references perusahaan (id),
  nomor           text not null,    -- nomor faktur dari supplier
  tanggal         date not null,
  jatuh_tempo     date not null,
  supplier_id     uuid not null,
  keterangan      text,
  subtotal        numeric(18, 2) not null default 0,
  diskon_total    numeric(18, 2) not null default 0,
  ppn_total       numeric(18, 2) not null default 0,
  total           numeric(18, 2) not null default 0,
  status          text not null default 'aktif' check (status in ('aktif', 'batal')),
  alasan_batal    text,
  dibatalkan_oleh uuid,
  dibatalkan_pada timestamptz,
  dibuat_oleh     uuid default auth.uid(),
  dibuat_pada     timestamptz not null default now(),
  foreign key (supplier_id, perusahaan_id) references supplier (id, perusahaan_id)
);
alter table surat_jalan_masuk add foreign key (faktur_id) references faktur_pembelian (id);

create table faktur_pembelian_detail (
  id              uuid primary key default gen_random_uuid(),
  perusahaan_id   uuid not null references perusahaan (id),
  faktur_id       uuid not null references faktur_pembelian (id),
  sj_detail_id    uuid not null references sj_masuk_detail (id),
  barang_id       uuid not null,
  qty             numeric(18, 3) not null,
  harga           numeric(18, 2) not null check (harga >= 0),
  diskon_persen   numeric(7, 3) not null default 0,
  diskon_nominal  numeric(18, 2) not null default 0,
  ppn_persen      numeric(7, 3) not null default 0,
  dpp             numeric(18, 2) not null,
  ppn             numeric(18, 2) not null,
  subtotal        numeric(18, 2) not null,
  koreksi_nilai   numeric(18, 4) not null default 0,  -- selisih nilai vs surat jalan, dibebankan ke HPP
  foreign key (barang_id, perusahaan_id) references barang (id, perusahaan_id)
);

create table retur_pembelian (
  id              uuid primary key default gen_random_uuid(),
  perusahaan_id   uuid not null references perusahaan (id),
  nomor           text not null,
  tanggal         date not null,
  sj_id           uuid not null references surat_jalan_masuk (id),
  supplier_id     uuid not null,
  gudang_id       uuid not null,
  keterangan      text,
  total           numeric(18, 2) not null default 0,
  status          text not null default 'aktif' check (status in ('aktif', 'batal')),
  alasan_batal    text,
  dibatalkan_oleh uuid,
  dibatalkan_pada timestamptz,
  dibuat_oleh     uuid default auth.uid(),
  dibuat_pada     timestamptz not null default now(),
  unique (perusahaan_id, nomor),
  foreign key (supplier_id, perusahaan_id) references supplier (id, perusahaan_id),
  foreign key (gudang_id, perusahaan_id) references gudang (id, perusahaan_id)
);

create table retur_pembelian_detail (
  id            uuid primary key default gen_random_uuid(),
  perusahaan_id uuid not null references perusahaan (id),
  retur_id      uuid not null references retur_pembelian (id),
  sj_detail_id  uuid not null references sj_masuk_detail (id),
  barang_id     uuid not null,
  qty           numeric(18, 3) not null check (qty > 0),
  harga         numeric(18, 4) not null,
  foreign key (barang_id, perusahaan_id) references barang (id, perusahaan_id)
);

-- ---------------------------------------------------------------------
-- Dokumen penjualan
-- ---------------------------------------------------------------------

create table faktur_penjualan (
  id               uuid primary key default gen_random_uuid(),
  perusahaan_id    uuid not null references perusahaan (id),
  nomor            text not null,
  tanggal          date not null,
  jatuh_tempo      date not null,
  customer_id      uuid not null,
  nama_customer    text not null,   -- disalin saat faktur dibuat
  alamat_customer  text,
  sales_id         uuid,
  gudang_id        uuid not null,
  jenis_bayar      text not null default 'kredit' check (jenis_bayar in ('tunai', 'kredit')),
  keterangan       text,
  subtotal         numeric(18, 2) not null default 0,
  diskon_total     numeric(18, 2) not null default 0,
  ppn_total        numeric(18, 2) not null default 0,
  total            numeric(18, 2) not null default 0,
  status           text not null default 'aktif' check (status in ('aktif', 'batal')),
  alasan_batal     text,
  dibatalkan_oleh  uuid,
  dibatalkan_pada  timestamptz,
  dibuat_oleh      uuid default auth.uid(),
  dibuat_pada      timestamptz not null default now(),
  unique (perusahaan_id, nomor),
  foreign key (customer_id, perusahaan_id) references customer (id, perusahaan_id),
  foreign key (sales_id, perusahaan_id) references sales (id, perusahaan_id),
  foreign key (gudang_id, perusahaan_id) references gudang (id, perusahaan_id)
);

create table faktur_penjualan_detail (
  id             uuid primary key default gen_random_uuid(),
  perusahaan_id  uuid not null references perusahaan (id),
  faktur_id      uuid not null references faktur_penjualan (id),
  urutan         int not null,
  barang_id      uuid not null,
  qty            numeric(18, 3) not null check (qty > 0),
  harga          numeric(18, 2) not null check (harga >= 0),
  diskon_persen  numeric(7, 3) not null default 0,
  diskon_nominal numeric(18, 2) not null default 0,
  ppn_persen     numeric(7, 3) not null default 0,
  dpp            numeric(18, 2) not null,
  ppn            numeric(18, 2) not null,
  subtotal       numeric(18, 2) not null,
  hpp            numeric(18, 4) not null,   -- HPP per unit saat terjual, untuk laba nanti
  foreign key (barang_id, perusahaan_id) references barang (id, perusahaan_id)
);

create table surat_jalan_keluar (
  id              uuid primary key default gen_random_uuid(),
  perusahaan_id   uuid not null references perusahaan (id),
  nomor           text not null,
  tanggal         date not null,
  faktur_id       uuid not null references faktur_penjualan (id),
  alamat_kirim    text,
  pengirim        text,
  kendaraan       text,
  keterangan      text,
  status          text not null default 'aktif' check (status in ('aktif', 'batal')),
  alasan_batal    text,
  dibatalkan_oleh uuid,
  dibatalkan_pada timestamptz,
  dibuat_oleh     uuid default auth.uid(),
  dibuat_pada     timestamptz not null default now(),
  unique (perusahaan_id, nomor)
);

create table retur_penjualan (
  id              uuid primary key default gen_random_uuid(),
  perusahaan_id   uuid not null references perusahaan (id),
  nomor           text not null,
  tanggal         date not null,
  faktur_id       uuid not null references faktur_penjualan (id),
  customer_id     uuid not null,
  gudang_id       uuid not null,
  keterangan      text,
  total           numeric(18, 2) not null default 0,
  status          text not null default 'aktif' check (status in ('aktif', 'batal')),
  alasan_batal    text,
  dibatalkan_oleh uuid,
  dibatalkan_pada timestamptz,
  dibuat_oleh     uuid default auth.uid(),
  dibuat_pada     timestamptz not null default now(),
  unique (perusahaan_id, nomor),
  foreign key (customer_id, perusahaan_id) references customer (id, perusahaan_id),
  foreign key (gudang_id, perusahaan_id) references gudang (id, perusahaan_id)
);

create table retur_penjualan_detail (
  id             uuid primary key default gen_random_uuid(),
  perusahaan_id  uuid not null references perusahaan (id),
  retur_id       uuid not null references retur_penjualan (id),
  fj_detail_id   uuid not null references faktur_penjualan_detail (id),
  barang_id      uuid not null,
  qty            numeric(18, 3) not null check (qty > 0),
  nilai          numeric(18, 2) not null,   -- nilai jual yang dikembalikan
  hpp            numeric(18, 4) not null,
  foreign key (barang_id, perusahaan_id) references barang (id, perusahaan_id)
);

-- ---------------------------------------------------------------------
-- Stok awal, penyesuaian, dan pindah gudang
-- ---------------------------------------------------------------------

create table penyesuaian_stok (
  id              uuid primary key default gen_random_uuid(),
  perusahaan_id   uuid not null references perusahaan (id),
  nomor           text not null,
  tanggal         date not null,
  gudang_id       uuid not null,
  jenis           text not null check (jenis in ('stok_awal', 'opname', 'lainnya')),
  keterangan      text,
  status          text not null default 'aktif' check (status in ('aktif', 'batal')),
  alasan_batal    text,
  dibatalkan_oleh uuid,
  dibatalkan_pada timestamptz,
  dibuat_oleh     uuid default auth.uid(),
  dibuat_pada     timestamptz not null default now(),
  unique (perusahaan_id, nomor),
  foreign key (gudang_id, perusahaan_id) references gudang (id, perusahaan_id)
);

create table penyesuaian_stok_detail (
  id            uuid primary key default gen_random_uuid(),
  perusahaan_id uuid not null references perusahaan (id),
  penyesuaian_id uuid not null references penyesuaian_stok (id),
  barang_id     uuid not null,
  qty_sistem    numeric(18, 3),
  qty_fisik     numeric(18, 3),
  selisih       numeric(18, 3) not null,
  hpp           numeric(18, 4) not null,
  foreign key (barang_id, perusahaan_id) references barang (id, perusahaan_id)
);

create table transfer_gudang (
  id              uuid primary key default gen_random_uuid(),
  perusahaan_id   uuid not null references perusahaan (id),
  nomor           text not null,
  tanggal         date not null,
  gudang_asal     uuid not null,
  gudang_tujuan   uuid not null,
  keterangan      text,
  status          text not null default 'aktif' check (status in ('aktif', 'batal')),
  alasan_batal    text,
  dibatalkan_oleh uuid,
  dibatalkan_pada timestamptz,
  dibuat_oleh     uuid default auth.uid(),
  dibuat_pada     timestamptz not null default now(),
  unique (perusahaan_id, nomor),
  check (gudang_asal <> gudang_tujuan),
  foreign key (gudang_asal, perusahaan_id) references gudang (id, perusahaan_id),
  foreign key (gudang_tujuan, perusahaan_id) references gudang (id, perusahaan_id)
);

create table transfer_gudang_detail (
  id            uuid primary key default gen_random_uuid(),
  perusahaan_id uuid not null references perusahaan (id),
  transfer_id   uuid not null references transfer_gudang (id),
  barang_id     uuid not null,
  qty           numeric(18, 3) not null check (qty > 0),
  foreign key (barang_id, perusahaan_id) references barang (id, perusahaan_id)
);

-- ---------------------------------------------------------------------
-- Fungsi inti stok
-- ---------------------------------------------------------------------

create function _wajib_akses(p_pid uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_pid is null or not akses_perusahaan(p_pid) then
    raise exception 'Anda tidak punya akses ke perusahaan ini.' using errcode = '42501';
  end if;
end $$;

create function _wajib_kelola(p_pid uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_pid is null or not kelola_perusahaan(p_pid) then
    raise exception 'Hanya Owner atau Admin yang boleh melakukan ini.' using errcode = '42501';
  end if;
end $$;

-- Hitung nilai satu baris: dpp = qty x harga - diskon, lalu PPN dari dpp.
create function _hitung_baris(qty numeric, harga numeric, dp numeric, dn numeric, pp numeric,
                              out dpp numeric, out ppn numeric, out subtotal numeric)
language plpgsql immutable as $$
declare bruto numeric := qty * harga;
begin
  if coalesce(dp, 0) < 0 or coalesce(dp, 0) > 100 or coalesce(dn, 0) < 0 or coalesce(pp, 0) < 0 then
    raise exception 'Diskon atau PPN tidak valid.';
  end if;
  dpp := round(bruto - bruto * coalesce(dp, 0) / 100 - coalesce(dn, 0), 2);
  if dpp < 0 then raise exception 'Diskon lebih besar dari nilai barang.'; end if;
  ppn := round(dpp * coalesce(pp, 0) / 100, 2);
  subtotal := dpp + ppn;
end $$;

create function _nama_barang(p_barang uuid) returns text
language sql stable security definer set search_path = public as $$
  select kode || ' ' || nama from barang where id = p_barang
$$;

-- Barang masuk: tambah stok gudang, hitung ulang HPP rata-rata, catat kartu stok.
create function _stok_masuk(p_pid uuid, p_barang uuid, p_gudang uuid, p_qty numeric, p_harga numeric,
                            p_tanggal date, p_jenis text, p_tabel text, p_dok uuid, p_nomor text,
                            p_ket text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  hpp_lama numeric;
  total numeric;
begin
  if p_qty is null or p_qty <= 0 then raise exception 'Qty harus lebih dari 0.'; end if;
  select hpp into hpp_lama from barang where id = p_barang and perusahaan_id = p_pid for update;
  if not found then raise exception 'Barang tidak ditemukan.'; end if;
  select greatest(coalesce(sum(qty), 0), 0) into total from stok_gudang where barang_id = p_barang;

  update barang set hpp = round((total * hpp_lama + p_qty * p_harga) / (total + p_qty), 4)
  where id = p_barang;

  insert into stok_gudang (perusahaan_id, barang_id, gudang_id, qty)
  values (p_pid, p_barang, p_gudang, p_qty)
  on conflict (barang_id, gudang_id) do update set qty = stok_gudang.qty + excluded.qty, diubah_pada = now();

  insert into mutasi_stok (perusahaan_id, tanggal, barang_id, gudang_id, jenis, dokumen_tabel, dokumen_id,
                           nomor, qty_masuk, hpp, keterangan)
  values (p_pid, p_tanggal, p_barang, p_gudang, p_jenis, p_tabel, p_dok, p_nomor, p_qty, p_harga, p_ket);
end $$;

-- Barang keluar: kurangi stok gudang (tidak boleh minus), catat kartu stok.
-- Mengembalikan HPP per unit yang dipakai.
create function _stok_keluar(p_pid uuid, p_barang uuid, p_gudang uuid, p_qty numeric,
                             p_tanggal date, p_jenis text, p_tabel text, p_dok uuid, p_nomor text,
                             p_ket text default null) returns numeric
language plpgsql security definer set search_path = public as $$
declare
  h numeric;
  ada numeric;
begin
  if p_qty is null or p_qty <= 0 then raise exception 'Qty harus lebih dari 0.'; end if;
  select hpp into h from barang where id = p_barang and perusahaan_id = p_pid for update;
  if not found then raise exception 'Barang tidak ditemukan.'; end if;
  select qty into ada from stok_gudang where barang_id = p_barang and gudang_id = p_gudang for update;
  if coalesce(ada, 0) < p_qty then
    raise exception 'Stok % di gudang % tidak cukup. Tersedia %, dibutuhkan %.',
      _nama_barang(p_barang), (select nama from gudang where id = p_gudang),
      trim_scale(coalesce(ada, 0)), trim_scale(p_qty);
  end if;

  update stok_gudang set qty = qty - p_qty, diubah_pada = now()
  where barang_id = p_barang and gudang_id = p_gudang;

  insert into mutasi_stok (perusahaan_id, tanggal, barang_id, gudang_id, jenis, dokumen_tabel, dokumen_id,
                           nomor, qty_keluar, hpp, keterangan)
  values (p_pid, p_tanggal, p_barang, p_gudang, p_jenis, p_tabel, p_dok, p_nomor, p_qty, h, p_ket);
  return h;
end $$;

-- Membalik semua pergerakan stok sebuah dokumen (dipakai saat pembatalan).
-- Barang yang dulu masuk dikeluarkan lagi dengan harga masuknya (HPP dikoreksi),
-- barang yang dulu keluar dimasukkan lagi dengan HPP saat keluar.
create function _balik_mutasi(p_tabel text, p_dok uuid, p_tanggal date, p_alasan text) returns void
language plpgsql security definer set search_path = public as $$
declare
  m record;
  hpp_lama numeric;
  total numeric;
  ada numeric;
begin
  for m in select * from mutasi_stok
           where dokumen_tabel = p_tabel and dokumen_id = p_dok and jenis <> 'BATAL'
           order by id loop
    if m.qty_masuk > 0 then
      select hpp into hpp_lama from barang where id = m.barang_id for update;
      select qty into ada from stok_gudang where barang_id = m.barang_id and gudang_id = m.gudang_id for update;
      if coalesce(ada, 0) < m.qty_masuk then
        raise exception 'Tidak bisa dibatalkan: stok % di gudang sudah tidak cukup (tersedia %, perlu %). Barangnya mungkin sudah terjual.',
          _nama_barang(m.barang_id), trim_scale(coalesce(ada, 0)), trim_scale(m.qty_masuk);
      end if;
      select coalesce(sum(qty), 0) into total from stok_gudang where barang_id = m.barang_id;
      if total - m.qty_masuk > 0 then
        update barang set hpp = greatest(round((total * hpp_lama - m.qty_masuk * m.hpp) / (total - m.qty_masuk), 4), 0)
        where id = m.barang_id;
      end if;
      update stok_gudang set qty = qty - m.qty_masuk, diubah_pada = now()
      where barang_id = m.barang_id and gudang_id = m.gudang_id;
      insert into mutasi_stok (perusahaan_id, tanggal, barang_id, gudang_id, jenis, dokumen_tabel, dokumen_id,
                               nomor, qty_keluar, hpp, keterangan)
      values (m.perusahaan_id, p_tanggal, m.barang_id, m.gudang_id, 'BATAL', p_tabel, p_dok,
              m.nomor, m.qty_masuk, m.hpp, p_alasan);
    else
      perform _stok_masuk(m.perusahaan_id, m.barang_id, m.gudang_id, m.qty_keluar, m.hpp, p_tanggal,
                          'BATAL', p_tabel, p_dok, m.nomor, p_alasan);
    end if;
  end loop;
end $$;

create function _status_po(p_po uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  belum numeric;
  sudah numeric;
begin
  select coalesce(sum(greatest(qty - qty_diterima, 0)), 0), coalesce(sum(qty_diterima), 0)
    into belum, sudah from po_detail where po_id = p_po;
  update purchase_order
     set status = case when belum = 0 then 'selesai' when sudah > 0 then 'sebagian' else 'terbuka' end
   where id = p_po and status in ('terbuka', 'sebagian', 'selesai');
end $$;

-- ---------------------------------------------------------------------
-- RPC: membuat dokumen
-- Semua menerima satu parameter JSON "p" dan mengembalikan id dokumen.
-- ---------------------------------------------------------------------

create function simpan_po(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  pid uuid := (p ->> 'perusahaan_id')::uuid;
  tgl date := (p ->> 'tanggal')::date;
  dok uuid;
  b jsonb;
  hb record;
  i int := 0;
  sub numeric := 0;
begin
  perform _wajib_akses(pid);
  if jsonb_array_length(coalesce(p -> 'baris', '[]')) = 0 then raise exception 'PO belum berisi barang.'; end if;

  insert into purchase_order (perusahaan_id, nomor, tanggal, supplier_id, jatuh_tempo, keterangan,
                              diskon_total, ppn_total)
  values (pid, coalesce(nullif(trim(p ->> 'nomor'), ''), nomor_berikutnya(pid, 'PO', null, tgl)), tgl,
          (p ->> 'supplier_id')::uuid, (p ->> 'jatuh_tempo')::date, p ->> 'keterangan',
          coalesce((p ->> 'diskon_total')::numeric, 0), coalesce((p ->> 'ppn_total')::numeric, 0))
  returning id into dok;

  for b in select * from jsonb_array_elements(p -> 'baris') loop
    i := i + 1;
    hb := _hitung_baris((b ->> 'qty')::numeric, (b ->> 'harga')::numeric, (b ->> 'diskon_persen')::numeric,
                        (b ->> 'diskon_nominal')::numeric, (b ->> 'ppn_persen')::numeric);
    insert into po_detail (perusahaan_id, po_id, urutan, barang_id, qty, harga, diskon_persen, diskon_nominal,
                           ppn_persen, dpp, ppn, subtotal)
    values (pid, dok, i, (b ->> 'barang_id')::uuid, (b ->> 'qty')::numeric, (b ->> 'harga')::numeric,
            coalesce((b ->> 'diskon_persen')::numeric, 0), coalesce((b ->> 'diskon_nominal')::numeric, 0),
            coalesce((b ->> 'ppn_persen')::numeric, 0), hb.dpp, hb.ppn, hb.subtotal);
    sub := sub + hb.subtotal;
  end loop;

  update purchase_order set subtotal = sub, total = sub - diskon_total + ppn_total where id = dok;
  return dok;
end $$;

create function simpan_sj_masuk(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  pid uuid := (p ->> 'perusahaan_id')::uuid;
  tgl date := (p ->> 'tanggal')::date;
  gdg uuid := (p ->> 'gudang_id')::uuid;
  po record;
  pd record;
  dok uuid;
  b jsonb;
  v_qty numeric;
  harga numeric;
  nomor text := nullif(trim(p ->> 'nomor'), '');
begin
  perform _wajib_akses(pid);
  if nomor is null then raise exception 'Nomor surat jalan supplier wajib diisi.'; end if;
  select * into po from purchase_order where id = (p ->> 'po_id')::uuid and perusahaan_id = pid for update;
  if not found then raise exception 'PO tidak ditemukan.'; end if;
  if po.status not in ('terbuka', 'sebagian') then raise exception 'PO % sudah %.', po.nomor, po.status; end if;

  insert into surat_jalan_masuk (perusahaan_id, nomor, tanggal, po_id, supplier_id, gudang_id, keterangan)
  values (pid, nomor, tgl, po.id, po.supplier_id, gdg, p ->> 'keterangan')
  returning id into dok;

  for b in select * from jsonb_array_elements(coalesce(p -> 'baris', '[]')) loop
    v_qty := coalesce((b ->> 'qty')::numeric, 0);
    continue when v_qty = 0;
    select * into pd from po_detail where id = (b ->> 'po_detail_id')::uuid and po_id = po.id for update;
    if not found then raise exception 'Baris PO tidak ditemukan.'; end if;
    if v_qty > pd.qty - pd.qty_diterima then
      raise exception 'Qty % melebihi sisa PO (%).', _nama_barang(pd.barang_id), trim_scale(pd.qty - pd.qty_diterima);
    end if;
    harga := round(pd.dpp / pd.qty, 4);
    insert into sj_masuk_detail (perusahaan_id, sj_id, po_detail_id, barang_id, qty, harga)
    values (pid, dok, pd.id, pd.barang_id, v_qty, harga);
    update po_detail set qty_diterima = qty_diterima + v_qty where id = pd.id;
    perform _stok_masuk(pid, pd.barang_id, gdg, v_qty, harga, tgl, 'SJM', 'surat_jalan_masuk', dok, nomor);
  end loop;

  if not exists (select 1 from sj_masuk_detail where sj_id = dok) then
    raise exception 'Isi qty yang diterima minimal untuk satu barang.';
  end if;
  perform _status_po(po.id);
  return dok;
end $$;

create function simpan_faktur_pembelian(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  pid uuid := (p ->> 'perusahaan_id')::uuid;
  tgl date := (p ->> 'tanggal')::date;
  sup uuid := (p ->> 'supplier_id')::uuid;
  nomor text := nullif(trim(p ->> 'nomor'), '');
  dok uuid;
  sj_ids uuid[];
  b jsonb;
  sd record;
  hb record;
  koreksi numeric;
  total_stok numeric;
  sub numeric := 0;
begin
  perform _wajib_akses(pid);
  if nomor is null then raise exception 'Nomor faktur supplier wajib diisi.'; end if;
  select array_agg(x::uuid) into sj_ids from jsonb_array_elements_text(coalesce(p -> 'sj_ids', '[]')) x;
  if sj_ids is null then raise exception 'Pilih minimal satu surat jalan.'; end if;
  if exists (select 1 from surat_jalan_masuk
             where id = any (sj_ids) and (perusahaan_id <> pid or supplier_id <> sup or status <> 'aktif' or faktur_id is not null))
     or (select count(*) from surat_jalan_masuk where id = any (sj_ids)) <> cardinality(sj_ids) then
    raise exception 'Ada surat jalan yang tidak valid atau sudah difakturkan.';
  end if;

  insert into faktur_pembelian (perusahaan_id, nomor, tanggal, jatuh_tempo, supplier_id, keterangan,
                                diskon_total, ppn_total)
  values (pid, nomor, tgl, coalesce((p ->> 'jatuh_tempo')::date, tgl + 30), sup, p ->> 'keterangan',
          coalesce((p ->> 'diskon_total')::numeric, 0), coalesce((p ->> 'ppn_total')::numeric, 0))
  returning id into dok;

  for b in select * from jsonb_array_elements(coalesce(p -> 'baris', '[]')) loop
    select * into sd from sj_masuk_detail where id = (b ->> 'sj_detail_id')::uuid and sj_id = any (sj_ids);
    if not found then raise exception 'Baris surat jalan tidak valid.'; end if;
    hb := _hitung_baris(sd.qty, (b ->> 'harga')::numeric, (b ->> 'diskon_persen')::numeric,
                        (b ->> 'diskon_nominal')::numeric, (b ->> 'ppn_persen')::numeric);
    -- Harga faktur dianggap final: selisihnya terhadap harga surat jalan dibebankan ke HPP.
    koreksi := hb.dpp - sd.qty * sd.harga;
    if koreksi <> 0 then
      perform 1 from barang where id = sd.barang_id for update;
      select coalesce(sum(qty), 0) into total_stok from stok_gudang where barang_id = sd.barang_id;
      if total_stok > 0 then
        update barang set hpp = greatest(round(hpp + koreksi / total_stok, 4), 0) where id = sd.barang_id;
      else
        koreksi := 0;  -- barang sudah habis, tidak ada persediaan untuk dikoreksi
      end if;
    end if;
    insert into faktur_pembelian_detail (perusahaan_id, faktur_id, sj_detail_id, barang_id, qty, harga,
                                         diskon_persen, diskon_nominal, ppn_persen, dpp, ppn, subtotal, koreksi_nilai)
    values (pid, dok, sd.id, sd.barang_id, sd.qty, (b ->> 'harga')::numeric,
            coalesce((b ->> 'diskon_persen')::numeric, 0), coalesce((b ->> 'diskon_nominal')::numeric, 0),
            coalesce((b ->> 'ppn_persen')::numeric, 0), hb.dpp, hb.ppn, hb.subtotal, koreksi);
    sub := sub + hb.subtotal;
  end loop;

  if (select count(*) from faktur_pembelian_detail where faktur_id = dok)
     <> (select count(*) from sj_masuk_detail where sj_id = any (sj_ids)) then
    raise exception 'Semua barang di surat jalan harus masuk ke faktur.';
  end if;

  update surat_jalan_masuk set faktur_id = dok where id = any (sj_ids);
  update faktur_pembelian set subtotal = sub, total = sub - diskon_total + ppn_total where id = dok;
  return dok;
end $$;

create function simpan_retur_pembelian(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  pid uuid := (p ->> 'perusahaan_id')::uuid;
  tgl date := (p ->> 'tanggal')::date;
  sj record;
  sd record;
  dok uuid;
  nomor text;
  b jsonb;
  v_qty numeric;
  sudah numeric;
  tot numeric := 0;
begin
  perform _wajib_akses(pid);
  select * into sj from surat_jalan_masuk where id = (p ->> 'sj_id')::uuid and perusahaan_id = pid;
  if not found or sj.status <> 'aktif' then raise exception 'Surat jalan tidak ditemukan atau sudah dibatalkan.'; end if;
  nomor := coalesce(nullif(trim(p ->> 'nomor'), ''), nomor_berikutnya(pid, 'RB', sj.gudang_id, tgl));

  insert into retur_pembelian (perusahaan_id, nomor, tanggal, sj_id, supplier_id, gudang_id, keterangan)
  values (pid, nomor, tgl, sj.id, sj.supplier_id, sj.gudang_id, p ->> 'keterangan')
  returning id into dok;

  for b in select * from jsonb_array_elements(coalesce(p -> 'baris', '[]')) loop
    v_qty := coalesce((b ->> 'qty')::numeric, 0);
    continue when v_qty = 0;
    select * into sd from sj_masuk_detail where id = (b ->> 'sj_detail_id')::uuid and sj_id = sj.id;
    if not found then raise exception 'Baris surat jalan tidak valid.'; end if;
    select coalesce(sum(d.qty), 0) into sudah from retur_pembelian_detail d
      join retur_pembelian r on r.id = d.retur_id
     where d.sj_detail_id = sd.id and r.status = 'aktif' and r.id <> dok;
    if v_qty > sd.qty - sudah then
      raise exception 'Qty retur % melebihi qty diterima yang belum diretur (%).', _nama_barang(sd.barang_id), trim_scale(sd.qty - sudah);
    end if;
    insert into retur_pembelian_detail (perusahaan_id, retur_id, sj_detail_id, barang_id, qty, harga)
    values (pid, dok, sd.id, sd.barang_id, v_qty, sd.harga);
    perform _stok_keluar(pid, sd.barang_id, sj.gudang_id, v_qty, tgl, 'RB', 'retur_pembelian', dok, nomor);
    tot := tot + v_qty * sd.harga;
  end loop;

  if tot = 0 and not exists (select 1 from retur_pembelian_detail where retur_id = dok) then
    raise exception 'Isi qty retur minimal untuk satu barang.';
  end if;
  update retur_pembelian set total = round(tot, 2) where id = dok;
  return dok;
end $$;

create function simpan_faktur_penjualan(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  pid uuid := (p ->> 'perusahaan_id')::uuid;
  tgl date := (p ->> 'tanggal')::date;
  gdg uuid := (p ->> 'gudang_id')::uuid;
  cust record;
  dok uuid;
  nomor text;
  b jsonb;
  hb record;
  h numeric;
  i int := 0;
  sub numeric := 0;
begin
  perform _wajib_akses(pid);
  if jsonb_array_length(coalesce(p -> 'baris', '[]')) = 0 then raise exception 'Faktur belum berisi barang.'; end if;
  select * into cust from customer where id = (p ->> 'customer_id')::uuid and perusahaan_id = pid;
  if not found then raise exception 'Customer tidak ditemukan.'; end if;
  nomor := coalesce(nullif(trim(p ->> 'nomor'), ''), nomor_berikutnya(pid, 'FJ', gdg, tgl));

  insert into faktur_penjualan (perusahaan_id, nomor, tanggal, jatuh_tempo, customer_id, nama_customer,
                                alamat_customer, sales_id, gudang_id, jenis_bayar, keterangan, diskon_total, ppn_total)
  values (pid, nomor, tgl, coalesce((p ->> 'jatuh_tempo')::date, tgl + 30), cust.id, cust.nama,
          concat_ws(', ', cust.alamat, cust.kota), (p ->> 'sales_id')::uuid, gdg,
          coalesce(p ->> 'jenis_bayar', 'kredit'), p ->> 'keterangan',
          coalesce((p ->> 'diskon_total')::numeric, 0), coalesce((p ->> 'ppn_total')::numeric, 0))
  returning id into dok;

  for b in select * from jsonb_array_elements(p -> 'baris') loop
    i := i + 1;
    hb := _hitung_baris((b ->> 'qty')::numeric, (b ->> 'harga')::numeric, (b ->> 'diskon_persen')::numeric,
                        (b ->> 'diskon_nominal')::numeric, (b ->> 'ppn_persen')::numeric);
    h := _stok_keluar(pid, (b ->> 'barang_id')::uuid, gdg, (b ->> 'qty')::numeric, tgl, 'FJ',
                      'faktur_penjualan', dok, nomor, cust.nama);
    insert into faktur_penjualan_detail (perusahaan_id, faktur_id, urutan, barang_id, qty, harga, diskon_persen,
                                         diskon_nominal, ppn_persen, dpp, ppn, subtotal, hpp)
    values (pid, dok, i, (b ->> 'barang_id')::uuid, (b ->> 'qty')::numeric, (b ->> 'harga')::numeric,
            coalesce((b ->> 'diskon_persen')::numeric, 0), coalesce((b ->> 'diskon_nominal')::numeric, 0),
            coalesce((b ->> 'ppn_persen')::numeric, 0), hb.dpp, hb.ppn, hb.subtotal, h);
    sub := sub + hb.subtotal;
  end loop;

  update faktur_penjualan set subtotal = sub, total = sub - diskon_total + ppn_total where id = dok;
  return dok;
end $$;

create function simpan_sj_keluar(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  pid uuid := (p ->> 'perusahaan_id')::uuid;
  tgl date := (p ->> 'tanggal')::date;
  fj record;
  dok uuid;
begin
  perform _wajib_akses(pid);
  select * into fj from faktur_penjualan where id = (p ->> 'faktur_id')::uuid and perusahaan_id = pid;
  if not found or fj.status <> 'aktif' then raise exception 'Faktur tidak ditemukan atau sudah dibatalkan.'; end if;
  insert into surat_jalan_keluar (perusahaan_id, nomor, tanggal, faktur_id, alamat_kirim, pengirim, kendaraan, keterangan)
  values (pid, coalesce(nullif(trim(p ->> 'nomor'), ''), nomor_berikutnya(pid, 'SJK', fj.gudang_id, tgl)), tgl, fj.id,
          coalesce(nullif(p ->> 'alamat_kirim', ''), fj.alamat_customer), p ->> 'pengirim', p ->> 'kendaraan', p ->> 'keterangan')
  returning id into dok;
  return dok;
end $$;

create function simpan_retur_penjualan(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  pid uuid := (p ->> 'perusahaan_id')::uuid;
  tgl date := (p ->> 'tanggal')::date;
  fj record;
  fd record;
  gdg uuid;
  dok uuid;
  nomor text;
  b jsonb;
  v_qty numeric;
  sudah numeric;
  nilai numeric;
  tot numeric := 0;
begin
  perform _wajib_akses(pid);
  select * into fj from faktur_penjualan where id = (p ->> 'faktur_id')::uuid and perusahaan_id = pid;
  if not found or fj.status <> 'aktif' then raise exception 'Faktur tidak ditemukan atau sudah dibatalkan.'; end if;
  gdg := coalesce((p ->> 'gudang_id')::uuid, fj.gudang_id);
  nomor := coalesce(nullif(trim(p ->> 'nomor'), ''), nomor_berikutnya(pid, 'RJ', gdg, tgl));

  insert into retur_penjualan (perusahaan_id, nomor, tanggal, faktur_id, customer_id, gudang_id, keterangan)
  values (pid, nomor, tgl, fj.id, fj.customer_id, gdg, p ->> 'keterangan')
  returning id into dok;

  for b in select * from jsonb_array_elements(coalesce(p -> 'baris', '[]')) loop
    v_qty := coalesce((b ->> 'qty')::numeric, 0);
    continue when v_qty = 0;
    select * into fd from faktur_penjualan_detail where id = (b ->> 'fj_detail_id')::uuid and faktur_id = fj.id;
    if not found then raise exception 'Baris faktur tidak valid.'; end if;
    select coalesce(sum(d.qty), 0) into sudah from retur_penjualan_detail d
      join retur_penjualan r on r.id = d.retur_id
     where d.fj_detail_id = fd.id and r.status = 'aktif' and r.id <> dok;
    if v_qty > fd.qty - sudah then
      raise exception 'Qty retur % melebihi qty terjual yang belum diretur (%).', _nama_barang(fd.barang_id), trim_scale(fd.qty - sudah);
    end if;
    nilai := round(fd.subtotal / fd.qty * v_qty, 2);
    insert into retur_penjualan_detail (perusahaan_id, retur_id, fj_detail_id, barang_id, qty, nilai, hpp)
    values (pid, dok, fd.id, fd.barang_id, v_qty, nilai, fd.hpp);
    perform _stok_masuk(pid, fd.barang_id, gdg, v_qty, fd.hpp, tgl, 'RJ', 'retur_penjualan', dok, nomor, fj.nama_customer);
    tot := tot + nilai;
  end loop;

  if not exists (select 1 from retur_penjualan_detail where retur_id = dok) then
    raise exception 'Isi qty retur minimal untuk satu barang.';
  end if;
  update retur_penjualan set total = tot where id = dok;
  return dok;
end $$;

-- Stok awal, stock opname, atau penyesuaian lain. Hanya Owner/Admin.
--   stok_awal / lainnya: baris {barang_id, selisih, hpp}  (selisih + masuk, - keluar)
--   opname:              baris {barang_id, qty_fisik}      (selisih dihitung dari stok sistem)
create function simpan_penyesuaian(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  pid uuid := (p ->> 'perusahaan_id')::uuid;
  tgl date := (p ->> 'tanggal')::date;
  gdg uuid := (p ->> 'gudang_id')::uuid;
  jns text := p ->> 'jenis';
  dok uuid;
  nomor text;
  b jsonb;
  brg uuid;
  sistem numeric;
  fisik numeric;
  selisih numeric;
  h numeric;
begin
  perform _wajib_kelola(pid);
  if jns not in ('stok_awal', 'opname', 'lainnya') then raise exception 'Jenis penyesuaian tidak dikenal.'; end if;
  nomor := coalesce(nullif(trim(p ->> 'nomor'), ''), nomor_berikutnya(pid, 'PS', gdg, tgl));

  insert into penyesuaian_stok (perusahaan_id, nomor, tanggal, gudang_id, jenis, keterangan)
  values (pid, nomor, tgl, gdg, jns, p ->> 'keterangan')
  returning id into dok;

  for b in select * from jsonb_array_elements(coalesce(p -> 'baris', '[]')) loop
    brg := (b ->> 'barang_id')::uuid;
    select coalesce((select qty from stok_gudang where barang_id = brg and gudang_id = gdg), 0) into sistem;
    if jns = 'opname' then
      fisik := (b ->> 'qty_fisik')::numeric;
      if fisik is null or fisik < 0 then raise exception 'Qty fisik % tidak valid.', _nama_barang(brg); end if;
      selisih := fisik - sistem;
    else
      selisih := coalesce((b ->> 'selisih')::numeric, 0);
      fisik := sistem + selisih;
    end if;
    continue when selisih = 0;

    if selisih > 0 then
      h := coalesce(nullif(b ->> 'hpp', '')::numeric, (select hpp from barang where id = brg and perusahaan_id = pid));
      if h is null or h < 0 then raise exception 'HPP % tidak valid.', _nama_barang(brg); end if;
      perform _stok_masuk(pid, brg, gdg, selisih, h, tgl, 'PS', 'penyesuaian_stok', dok, nomor, p ->> 'keterangan');
    else
      h := _stok_keluar(pid, brg, gdg, -selisih, tgl, 'PS', 'penyesuaian_stok', dok, nomor, p ->> 'keterangan');
    end if;
    insert into penyesuaian_stok_detail (perusahaan_id, penyesuaian_id, barang_id, qty_sistem, qty_fisik, selisih, hpp)
    values (pid, dok, brg, sistem, fisik, selisih, h);
  end loop;

  if not exists (select 1 from penyesuaian_stok_detail where penyesuaian_id = dok) then
    raise exception 'Tidak ada perubahan stok untuk disimpan.';
  end if;
  return dok;
end $$;

create function simpan_transfer(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  pid uuid := (p ->> 'perusahaan_id')::uuid;
  tgl date := (p ->> 'tanggal')::date;
  asal uuid := (p ->> 'gudang_asal')::uuid;
  tujuan uuid := (p ->> 'gudang_tujuan')::uuid;
  dok uuid;
  nomor text;
  b jsonb;
  h numeric;
begin
  perform _wajib_akses(pid);
  if asal = tujuan then raise exception 'Gudang asal dan tujuan harus berbeda.'; end if;
  nomor := coalesce(nullif(trim(p ->> 'nomor'), ''), nomor_berikutnya(pid, 'TG', asal, tgl));

  insert into transfer_gudang (perusahaan_id, nomor, tanggal, gudang_asal, gudang_tujuan, keterangan)
  values (pid, nomor, tgl, asal, tujuan, p ->> 'keterangan')
  returning id into dok;

  for b in select * from jsonb_array_elements(coalesce(p -> 'baris', '[]')) loop
    continue when coalesce((b ->> 'qty')::numeric, 0) = 0;
    insert into transfer_gudang_detail (perusahaan_id, transfer_id, barang_id, qty)
    values (pid, dok, (b ->> 'barang_id')::uuid, (b ->> 'qty')::numeric);
    h := _stok_keluar(pid, (b ->> 'barang_id')::uuid, asal, (b ->> 'qty')::numeric, tgl, 'TG', 'transfer_gudang', dok, nomor);
    perform _stok_masuk(pid, (b ->> 'barang_id')::uuid, tujuan, (b ->> 'qty')::numeric, h, tgl, 'TG', 'transfer_gudang', dok, nomor);
  end loop;

  if not exists (select 1 from transfer_gudang_detail where transfer_id = dok) then
    raise exception 'Isi minimal satu barang yang dipindahkan.';
  end if;
  return dok;
end $$;

-- ---------------------------------------------------------------------
-- RPC: edit info, tutup PO, dan pembatalan (hanya Owner/Admin)
-- ---------------------------------------------------------------------

create function _tabel_dokumen(p_tabel text) returns void
language plpgsql immutable as $$
begin
  if p_tabel not in ('purchase_order', 'surat_jalan_masuk', 'faktur_pembelian', 'retur_pembelian',
                     'faktur_penjualan', 'surat_jalan_keluar', 'retur_penjualan',
                     'penyesuaian_stok', 'transfer_gudang') then
    raise exception 'Jenis dokumen tidak dikenal: %', p_tabel;
  end if;
end $$;

-- Mengubah tanggal dan keterangan. Isi barang tidak bisa diubah:
-- batalkan dokumen lalu buat yang baru.
create function ubah_info_dokumen(p_tabel text, p_id uuid, p_tanggal date, p_keterangan text,
                                  p_jatuh_tempo date default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  pid uuid;
  st text;
begin
  perform _tabel_dokumen(p_tabel);
  execute format('select perusahaan_id, status from %I where id = $1', p_tabel) into pid, st using p_id;
  perform _wajib_kelola(pid);
  if st = 'batal' then raise exception 'Dokumen yang sudah dibatalkan tidak bisa diubah.'; end if;
  if p_tanggal is null then raise exception 'Tanggal wajib diisi.'; end if;
  execute format('update %I set tanggal = $2, keterangan = $3 where id = $1', p_tabel)
    using p_id, p_tanggal, p_keterangan;
  if p_jatuh_tempo is not null and p_tabel in ('purchase_order', 'faktur_pembelian', 'faktur_penjualan') then
    execute format('update %I set jatuh_tempo = $2 where id = $1', p_tabel) using p_id, p_jatuh_tempo;
  end if;
  update mutasi_stok set tanggal = p_tanggal
   where dokumen_tabel = p_tabel and dokumen_id = p_id and jenis <> 'BATAL';
end $$;

create function tutup_po(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare po record;
begin
  select * into po from purchase_order where id = p_id;
  perform _wajib_kelola(po.perusahaan_id);
  if po.status not in ('terbuka', 'sebagian') then raise exception 'PO ini sudah %.', po.status; end if;
  update purchase_order set status = 'ditutup' where id = p_id;
end $$;

create function batal_dokumen(p_tabel text, p_id uuid, p_alasan text) returns void
language plpgsql security definer set search_path = public as $$
declare
  pid uuid;
  st text;
  sj record;
  fd record;
  total_stok numeric;
  tgl date := current_date;
begin
  perform _tabel_dokumen(p_tabel);
  execute format('select perusahaan_id, status from %I where id = $1 for update', p_tabel) into pid, st using p_id;
  perform _wajib_kelola(pid);
  if st = 'batal' then raise exception 'Dokumen ini sudah dibatalkan.'; end if;
  if nullif(trim(p_alasan), '') is null then raise exception 'Alasan pembatalan wajib diisi.'; end if;

  if p_tabel = 'purchase_order' then
    if exists (select 1 from surat_jalan_masuk where po_id = p_id and status = 'aktif') then
      raise exception 'PO ini sudah punya surat jalan masuk. Batalkan surat jalannya dulu, atau gunakan Tutup PO.';
    end if;

  elsif p_tabel = 'surat_jalan_masuk' then
    select * into sj from surat_jalan_masuk where id = p_id;
    if sj.faktur_id is not null then
      raise exception 'Surat jalan ini sudah difakturkan. Batalkan faktur supplier-nya dulu.';
    end if;
    if exists (select 1 from retur_pembelian where sj_id = p_id and status = 'aktif') then
      raise exception 'Surat jalan ini punya retur pembelian. Batalkan returnya dulu.';
    end if;
    perform _balik_mutasi(p_tabel, p_id, tgl, p_alasan);
    update po_detail pd set qty_diterima = pd.qty_diterima - d.qty
      from sj_masuk_detail d where d.sj_id = p_id and d.po_detail_id = pd.id;
    perform _status_po(sj.po_id);

  elsif p_tabel = 'faktur_pembelian' then
    for fd in select * from faktur_pembelian_detail where faktur_id = p_id and koreksi_nilai <> 0 loop
      perform 1 from barang where id = fd.barang_id for update;
      select coalesce(sum(qty), 0) into total_stok from stok_gudang where barang_id = fd.barang_id;
      if total_stok > 0 then
        update barang set hpp = greatest(round(hpp - fd.koreksi_nilai / total_stok, 4), 0) where id = fd.barang_id;
      end if;
    end loop;
    update surat_jalan_masuk set faktur_id = null where faktur_id = p_id;

  elsif p_tabel = 'faktur_penjualan' then
    if exists (select 1 from retur_penjualan where faktur_id = p_id and status = 'aktif') then
      raise exception 'Faktur ini punya retur penjualan. Batalkan returnya dulu.';
    end if;
    perform _balik_mutasi(p_tabel, p_id, tgl, p_alasan);
    update surat_jalan_keluar
       set status = 'batal', alasan_batal = 'Faktur dibatalkan', dibatalkan_oleh = auth.uid(), dibatalkan_pada = now()
     where faktur_id = p_id and status = 'aktif';

  elsif p_tabel in ('retur_pembelian', 'retur_penjualan', 'penyesuaian_stok', 'transfer_gudang') then
    perform _balik_mutasi(p_tabel, p_id, tgl, p_alasan);
  end if;

  execute format('update %I set status = ''batal'', alasan_batal = $2, dibatalkan_oleh = auth.uid(),
                  dibatalkan_pada = now() where id = $1', p_tabel)
    using p_id, p_alasan;
end $$;

-- ---------------------------------------------------------------------
-- Kartu stok dengan saldo berjalan
-- ---------------------------------------------------------------------

create function kartu_stok(p_barang uuid, p_gudang uuid, p_dari date, p_sampai date)
returns table (id bigint, tanggal date, jenis text, nomor text, gudang_id uuid, keterangan text,
               qty_masuk numeric, qty_keluar numeric, saldo numeric, hpp numeric, dokumen_tabel text, dokumen_id uuid)
language sql stable security invoker set search_path = public as $$
  with semua as (
    select m.*, sum(m.qty_masuk - m.qty_keluar) over (order by m.tanggal, m.id) as saldo_jalan
      from mutasi_stok m
     where m.barang_id = p_barang and (p_gudang is null or m.gudang_id = p_gudang) and m.tanggal <= p_sampai
  ),
  awal as (
    select coalesce(sum(qty_masuk - qty_keluar), 0) as saldo from semua where tanggal < p_dari
  )
  select null::bigint, p_dari, 'AWAL', 'Saldo awal', null::uuid, null, null::numeric, null::numeric,
         (select saldo from awal), null::numeric, null, null::uuid
  union all
  select s.id, s.tanggal, s.jenis, s.nomor, s.gudang_id, s.keterangan, s.qty_masuk, s.qty_keluar,
         s.saldo_jalan, s.hpp, s.dokumen_tabel, s.dokumen_id
    from semua s where s.tanggal >= p_dari
   order by 2, 1 nulls first
$$;

-- ---------------------------------------------------------------------
-- Row Level Security dan hak akses
-- ---------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['mutasi_stok', 'purchase_order', 'po_detail', 'surat_jalan_masuk', 'sj_masuk_detail',
                           'faktur_pembelian', 'faktur_pembelian_detail', 'retur_pembelian', 'retur_pembelian_detail',
                           'faktur_penjualan', 'faktur_penjualan_detail', 'surat_jalan_keluar', 'retur_penjualan',
                           'retur_penjualan_detail', 'penyesuaian_stok', 'penyesuaian_stok_detail',
                           'transfer_gudang', 'transfer_gudang_detail', 'penomoran', 'nomor_urut'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I_baca on %I for select using (akses_perusahaan(perusahaan_id))', t, t);
    execute format('revoke all on %I from anon', t);
    execute format('revoke insert, update, delete on %I from authenticated', t);
    execute format('grant select on %I to authenticated', t);
  end loop;
end $$;

-- Format penomoran diatur oleh Owner/Admin.
create policy penomoran_tambah on penomoran for insert with check (kelola_perusahaan(perusahaan_id));
create policy penomoran_ubah on penomoran for update
  using (kelola_perusahaan(perusahaan_id)) with check (kelola_perusahaan(perusahaan_id));
create policy penomoran_hapus on penomoran for delete using (kelola_perusahaan(perusahaan_id));
grant insert, update, delete on penomoran to authenticated;

-- Fungsi bantu internal tidak boleh dipanggil langsung dari aplikasi.
revoke execute on function nomor_berikutnya(uuid, text, uuid, date) from public, anon, authenticated;
revoke execute on function _stok_masuk(uuid, uuid, uuid, numeric, numeric, date, text, text, uuid, text, text) from public, anon, authenticated;
revoke execute on function _stok_keluar(uuid, uuid, uuid, numeric, date, text, text, uuid, text, text) from public, anon, authenticated;
revoke execute on function _balik_mutasi(text, uuid, date, text) from public, anon, authenticated;
revoke execute on function _status_po(uuid) from public, anon, authenticated;

-- RPC yang dipakai aplikasi: hanya untuk user yang sudah login.
do $$
declare f text;
begin
  foreach f in array array['simpan_po(jsonb)', 'simpan_sj_masuk(jsonb)', 'simpan_faktur_pembelian(jsonb)',
                           'simpan_retur_pembelian(jsonb)', 'simpan_faktur_penjualan(jsonb)', 'simpan_sj_keluar(jsonb)',
                           'simpan_retur_penjualan(jsonb)', 'simpan_penyesuaian(jsonb)', 'simpan_transfer(jsonb)',
                           'ubah_info_dokumen(text, uuid, date, text, date)', 'tutup_po(uuid)',
                           'batal_dokumen(text, uuid, text)', 'kartu_stok(uuid, uuid, date, date)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
