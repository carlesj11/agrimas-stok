-- =====================================================================
-- Sistem Manajemen Stok CV Agrimas Perkasa
-- 007: Pembelian Sementara
--
-- Jalankan sekali di Supabase SQL Editor, setelah 001-006. Aman dijalankan ulang.
--
-- Barang yang diambil dari mitra tanpa dicatat sebagai pembelian. Stok bertambah dan bisa
-- langsung dijual, tetapi tidak masuk laporan pembelian. Bila barang itu kemudian dibeli resmi
-- dari supplier, catat PO, surat jalan, dan faktur seperti biasa, lalu edit pembelian
-- sementaranya (kurangi qty atau hapus barangnya). Yang masih tercatat di pembelian sementara
-- yang aktif adalah sisa barang sementara.
-- =====================================================================

create table if not exists pembelian_sementara (
  id              uuid primary key default gen_random_uuid(),
  perusahaan_id   uuid not null references perusahaan (id),
  nomor           text not null,
  tanggal         date not null,
  mitra_id        uuid not null,
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
  foreign key (mitra_id, perusahaan_id) references supplier (id, perusahaan_id),
  foreign key (gudang_id, perusahaan_id) references gudang (id, perusahaan_id)
);

create table if not exists pembelian_sementara_detail (
  id            uuid primary key default gen_random_uuid(),
  perusahaan_id uuid not null references perusahaan (id),
  pbs_id        uuid not null references pembelian_sementara (id),
  urutan        int not null,
  barang_id     uuid not null,
  qty           numeric(18, 3) not null check (qty > 0),
  harga         numeric(18, 2) not null default 0 check (harga >= 0),
  subtotal      numeric(18, 2) not null default 0,
  foreign key (barang_id, perusahaan_id) references barang (id, perusahaan_id)
);
create index if not exists pembelian_sementara_detail_pbs on pembelian_sementara_detail (pbs_id);

do $$
declare t text;
begin
  foreach t in array array['pembelian_sementara', 'pembelian_sementara_detail'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_baca on %I', t, t);
    execute format('create policy %I_baca on %I for select using (akses_perusahaan(perusahaan_id))', t, t);
    execute format('revoke all on %I from anon', t);
    execute format('revoke insert, update, delete on %I from authenticated', t);
    execute format('grant select on %I to authenticated', t);
  end loop;
end $$;

-- Simpan pembelian sementara baru, atau edit yang sudah ada bila "id" diisi (Owner/Admin).
--   p: {id?, perusahaan_id, nomor?, tanggal, mitra_id, gudang_id, keterangan, baris: [{barang_id, qty, harga}]}
create or replace function simpan_pembelian_sementara(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  pid uuid := (p ->> 'perusahaan_id')::uuid;
  tgl date := (p ->> 'tanggal')::date;
  gdg uuid := (p ->> 'gudang_id')::uuid;
  dok uuid := nullif(p ->> 'id', '')::uuid;
  edit boolean := dok is not null;
  nomor text;
  b jsonb;
  brg uuid;
  v_qty numeric;
  v_harga numeric;
  i int := 0;
  tot numeric := 0;
begin
  perform _wajib_akses(pid);
  if (p ->> 'mitra_id') is null then raise exception 'Pilih mitra asal barang.'; end if;
  if gdg is null then raise exception 'Pilih gudang tujuan.'; end if;

  if not edit then
    nomor := coalesce(nullif(trim(p ->> 'nomor'), ''), nomor_berikutnya(pid, 'PBS', gdg, tgl));
    insert into pembelian_sementara (perusahaan_id, nomor, tanggal, mitra_id, gudang_id, keterangan)
    values (pid, nomor, tgl, (p ->> 'mitra_id')::uuid, gdg, p ->> 'keterangan')
    returning id into dok;
  else
    perform _mulai_edit('pembelian_sementara', dok, pid);
    perform _lepas_mutasi('pembelian_sementara', dok);
    delete from pembelian_sementara_detail where pbs_id = dok;
    update pembelian_sementara s
       set nomor = coalesce(nullif(trim(p ->> 'nomor'), ''), s.nomor), tanggal = tgl,
           mitra_id = (p ->> 'mitra_id')::uuid, gudang_id = gdg, keterangan = p ->> 'keterangan'
     where s.id = dok
    returning s.nomor into nomor;
  end if;

  for b in select * from jsonb_array_elements(coalesce(p -> 'baris', '[]')) loop
    brg := (b ->> 'barang_id')::uuid;
    v_qty := coalesce((b ->> 'qty')::numeric, 0);
    continue when v_qty = 0;
    if v_qty < 0 then raise exception 'Qty % tidak boleh minus.', _nama_barang(brg); end if;
    v_harga := coalesce((b ->> 'harga')::numeric, 0);
    if v_harga < 0 then raise exception 'Harga % tidak boleh minus.', _nama_barang(brg); end if;
    i := i + 1;
    insert into pembelian_sementara_detail (perusahaan_id, pbs_id, urutan, barang_id, qty, harga, subtotal)
    values (pid, dok, i, brg, v_qty, v_harga, round(v_qty * v_harga, 2));
    -- Tanpa harga, stok masuk memakai HPP barang saat ini supaya HPP rata-rata tidak turun.
    perform _stok_masuk(pid, brg, gdg, v_qty,
                        case when v_harga > 0 then v_harga
                             else coalesce((select hpp from barang where id = brg and perusahaan_id = pid), 0) end,
                        tgl, 'PBS', 'pembelian_sementara', dok, nomor,
                        (select nama from supplier where id = (p ->> 'mitra_id')::uuid));
    tot := tot + round(v_qty * v_harga, 2);
  end loop;

  if i = 0 then raise exception 'Isi minimal satu barang.'; end if;
  update pembelian_sementara set total = tot where id = dok;
  if edit then perform _cek_stok_minus(pid); end if;
  return dok;
end $$;

-- Daftar jenis dokumen untuk ubah info, edit, dan pembatalan.
create or replace function _tabel_dokumen(p_tabel text) returns void
language plpgsql immutable as $$
begin
  if p_tabel not in ('purchase_order', 'surat_jalan_masuk', 'faktur_pembelian', 'retur_pembelian',
                     'faktur_penjualan', 'surat_jalan_keluar', 'retur_penjualan',
                     'penyesuaian_stok', 'transfer_gudang', 'pembelian_sementara') then
    raise exception 'Jenis dokumen tidak dikenal: %', p_tabel;
  end if;
end $$;

create or replace function batal_dokumen(p_tabel text, p_id uuid, p_alasan text) returns void
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

  elsif p_tabel in ('retur_pembelian', 'retur_penjualan', 'penyesuaian_stok', 'transfer_gudang', 'pembelian_sementara') then
    perform _balik_mutasi(p_tabel, p_id, tgl, p_alasan);
  end if;

  execute format('update %I set status = ''batal'', alasan_batal = $2, dibatalkan_oleh = auth.uid(),
                  dibatalkan_pada = now() where id = $1', p_tabel)
    using p_id, p_alasan;
end $$;

revoke execute on function simpan_pembelian_sementara(jsonb) from public, anon;
grant execute on function simpan_pembelian_sementara(jsonb) to authenticated;
