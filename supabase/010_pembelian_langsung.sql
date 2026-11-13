-- =====================================================================
-- Sistem Manajemen Stok CV Agrimas Perkasa
-- 010: pembelian langsung lewat faktur supplier (tanpa PO dan surat jalan masuk)
--
-- Jalankan sekali di Supabase SQL Editor, setelah 001-009. Aman dijalankan ulang.
--
-- Faktur supplier sekarang diisi langsung: supplier, gudang, barang, qty, dan harga. Saat disimpan
-- stok gudang bertambah (kartu stok jenis FB) dan HPP dihitung dari harga setelah diskon, tanpa PPN.
-- Retur pembelian dibuat dari faktur supplier. Faktur dan retur lama yang memakai surat jalan
-- tetap tersimpan dan tetap bisa dibuka, diedit, dan dibatalkan seperti sebelumnya.
-- =====================================================================

alter table faktur_pembelian add column if not exists gudang_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'faktur_pembelian_gudang_fk') then
    alter table faktur_pembelian add constraint faktur_pembelian_gudang_fk
      foreign key (gudang_id, perusahaan_id) references gudang (id, perusahaan_id);
  end if;
end $$;
comment on column faktur_pembelian.gudang_id is 'Terisi = faktur langsung (barang masuk lewat faktur ini). Kosong = faktur lama dari surat jalan.';
alter table faktur_pembelian_detail add column if not exists urutan int;

alter table retur_pembelian alter column sj_id drop not null;
alter table retur_pembelian add column if not exists faktur_id uuid references faktur_pembelian (id);
alter table retur_pembelian_detail add column if not exists fb_detail_id uuid references faktur_pembelian_detail (id);

-- ---------------------------------------------------------------------
-- Faktur supplier lama (dari surat jalan): fungsi 006 disimpan dengan nama lain
-- ---------------------------------------------------------------------

create or replace function _simpan_faktur_pembelian_sj(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
<<_simpan_faktur_pembelian_sj>>
declare
  pid uuid := (p ->> 'perusahaan_id')::uuid;
  tgl date := (p ->> 'tanggal')::date;
  sup uuid := (p ->> 'supplier_id')::uuid;
  nomor text := nullif(trim(p ->> 'nomor'), '');
  dok uuid := nullif(p ->> 'id', '')::uuid;
  sj_ids uuid[];
  b jsonb;
  sd record;
  fd record;
  hb record;
  koreksi numeric;
  total_stok numeric;
  sub numeric := 0;
begin
  perform _wajib_akses(pid);
  if nomor is null then raise exception 'Nomor faktur supplier wajib diisi.'; end if;

  if dok is not null then
    perform _mulai_edit('faktur_pembelian', dok, pid);
    -- Lepas koreksi HPP lama dan ikatan surat jalannya, sama seperti saat dibatalkan.
    for fd in select * from faktur_pembelian_detail where faktur_id = dok and koreksi_nilai <> 0 loop
      perform 1 from barang where id = fd.barang_id for update;
      select coalesce(sum(qty), 0) into total_stok from stok_gudang where barang_id = fd.barang_id;
      if total_stok > 0 then
        update barang set hpp = greatest(round(hpp - fd.koreksi_nilai / total_stok, 4), 0) where id = fd.barang_id;
      end if;
    end loop;
    update surat_jalan_masuk set faktur_id = null where faktur_id = dok;
    delete from faktur_pembelian_detail where faktur_id = dok;
  end if;

  select array_agg(x::uuid) into sj_ids from jsonb_array_elements_text(coalesce(p -> 'sj_ids', '[]')) x;
  if sj_ids is null then raise exception 'Pilih minimal satu surat jalan.'; end if;
  if exists (select 1 from surat_jalan_masuk
             where id = any (sj_ids) and (perusahaan_id <> pid or supplier_id <> sup or status <> 'aktif' or faktur_id is not null))
     or (select count(*) from surat_jalan_masuk where id = any (sj_ids)) <> cardinality(sj_ids) then
    raise exception 'Ada surat jalan yang tidak valid atau sudah difakturkan.';
  end if;

  if dok is null then
    insert into faktur_pembelian (perusahaan_id, nomor, tanggal, jatuh_tempo, supplier_id, keterangan,
                                  diskon_total, ppn_total)
    values (pid, nomor, tgl, coalesce((p ->> 'jatuh_tempo')::date, tgl + 30), sup, p ->> 'keterangan',
            coalesce((p ->> 'diskon_total')::numeric, 0), coalesce((p ->> 'ppn_total')::numeric, 0))
    returning id into dok;
  else
    update faktur_pembelian
       set nomor = _simpan_faktur_pembelian_sj.nomor, tanggal = tgl, jatuh_tempo = coalesce((p ->> 'jatuh_tempo')::date, tgl + 30),
           supplier_id = sup, keterangan = p ->> 'keterangan',
           diskon_total = coalesce((p ->> 'diskon_total')::numeric, 0), ppn_total = coalesce((p ->> 'ppn_total')::numeric, 0)
     where id = dok;
  end if;

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

revoke execute on function _simpan_faktur_pembelian_sj(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Faktur supplier langsung
--   p: {id?, perusahaan_id, supplier_id, gudang_id, nomor, tanggal, jatuh_tempo, keterangan,
--       diskon_total, ppn_total, baris: [{barang_id, qty, harga, diskon_persen, diskon_nominal, ppn_persen}]}
-- ---------------------------------------------------------------------

create or replace function simpan_faktur_pembelian(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
<<simpan_faktur_pembelian>>
declare
  pid uuid := (p ->> 'perusahaan_id')::uuid;
  tgl date := (p ->> 'tanggal')::date;
  gdg uuid := nullif(p ->> 'gudang_id', '')::uuid;
  nomor text := nullif(trim(p ->> 'nomor'), '');
  dok uuid := nullif(p ->> 'id', '')::uuid;
  edit boolean := dok is not null;
  sup record;
  b jsonb;
  hb record;
  v_qty numeric;
  i int := 0;
  sub numeric := 0;
begin
  -- Faktur lama dari surat jalan tetap memakai alur lama.
  if (edit and (select gudang_id from faktur_pembelian where id = dok) is null)
     or (not edit and jsonb_array_length(coalesce(p -> 'sj_ids', '[]')) > 0) then
    return _simpan_faktur_pembelian_sj(p);
  end if;

  perform _wajib_akses(pid);
  if nomor is null then raise exception 'Nomor faktur supplier wajib diisi.'; end if;
  if gdg is null then raise exception 'Pilih gudang tempat barang masuk.'; end if;
  if jsonb_array_length(coalesce(p -> 'baris', '[]')) = 0 then raise exception 'Faktur belum berisi barang.'; end if;
  select * into sup from supplier where id = (p ->> 'supplier_id')::uuid and perusahaan_id = pid;
  if not found then raise exception 'Supplier tidak ditemukan.'; end if;

  if not edit then
    insert into faktur_pembelian (perusahaan_id, nomor, tanggal, jatuh_tempo, supplier_id, gudang_id, keterangan,
                                  diskon_total, ppn_total)
    values (pid, nomor, tgl, coalesce((p ->> 'jatuh_tempo')::date, tgl + 30), sup.id, gdg, p ->> 'keterangan',
            coalesce((p ->> 'diskon_total')::numeric, 0), coalesce((p ->> 'ppn_total')::numeric, 0))
    returning id into dok;
  else
    perform _mulai_edit('faktur_pembelian', dok, pid);
    if exists (select 1 from retur_pembelian where faktur_id = dok and status = 'aktif') then
      raise exception 'Faktur ini punya retur pembelian. Batalkan returnya dulu sebelum mengedit faktur.';
    end if;
    update retur_pembelian_detail d set fb_detail_id = null
      from retur_pembelian r, faktur_pembelian_detail x
     where r.id = d.retur_id and r.status = 'batal' and x.id = d.fb_detail_id and x.faktur_id = dok;
    perform _lepas_mutasi('faktur_pembelian', dok);
    delete from faktur_pembelian_detail where faktur_id = dok;
    update faktur_pembelian f
       set nomor = simpan_faktur_pembelian.nomor, tanggal = tgl, jatuh_tempo = coalesce((p ->> 'jatuh_tempo')::date, tgl + 30),
           supplier_id = sup.id, gudang_id = gdg, keterangan = p ->> 'keterangan',
           diskon_total = coalesce((p ->> 'diskon_total')::numeric, 0), ppn_total = coalesce((p ->> 'ppn_total')::numeric, 0)
     where f.id = dok;
  end if;

  for b in select * from jsonb_array_elements(p -> 'baris') loop
    i := i + 1;
    v_qty := (b ->> 'qty')::numeric;
    if coalesce((b ->> 'harga')::numeric, -1) < 0 then raise exception 'Harga % tidak valid.', _nama_barang((b ->> 'barang_id')::uuid); end if;
    hb := _hitung_baris(v_qty, (b ->> 'harga')::numeric, (b ->> 'diskon_persen')::numeric,
                        (b ->> 'diskon_nominal')::numeric, (b ->> 'ppn_persen')::numeric);
    -- HPP dari harga setelah diskon, tanpa PPN (sama seperti penerimaan dari PO).
    perform _stok_masuk(pid, (b ->> 'barang_id')::uuid, gdg, v_qty, round(hb.dpp / nullif(v_qty, 0), 4), tgl, 'FB',
                        'faktur_pembelian', dok, nomor, sup.nama);
    insert into faktur_pembelian_detail (perusahaan_id, faktur_id, urutan, barang_id, qty, harga, diskon_persen,
                                         diskon_nominal, ppn_persen, dpp, ppn, subtotal)
    values (pid, dok, i, (b ->> 'barang_id')::uuid, v_qty, (b ->> 'harga')::numeric,
            coalesce((b ->> 'diskon_persen')::numeric, 0), coalesce((b ->> 'diskon_nominal')::numeric, 0),
            coalesce((b ->> 'ppn_persen')::numeric, 0), hb.dpp, hb.ppn, hb.subtotal);
    sub := sub + hb.subtotal;
  end loop;

  update faktur_pembelian set subtotal = sub, total = sub - diskon_total + ppn_total where id = dok;
  if edit then perform _cek_stok_minus(pid); end if;
  return dok;
end $$;

-- ---------------------------------------------------------------------
-- Retur pembelian: dari faktur supplier langsung ({faktur_id, baris: [{fb_detail_id, qty}]})
-- atau, untuk data lama, dari surat jalan ({sj_id, baris: [{sj_detail_id, qty}]}).
-- ---------------------------------------------------------------------

create or replace function simpan_retur_pembelian(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  pid uuid := (p ->> 'perusahaan_id')::uuid;
  tgl date := (p ->> 'tanggal')::date;
  dok uuid := nullif(p ->> 'id', '')::uuid;
  edit boolean := dok is not null;
  dari_faktur boolean := nullif(p ->> 'faktur_id', '') is not null;
  v_sj uuid;
  v_fb uuid;
  v_sup uuid;
  v_gdg uuid;
  sj record;
  fb record;
  sd record;
  nomor text;
  b jsonb;
  v_qty numeric;
  v_barang uuid;
  v_harga numeric;
  v_baris uuid;
  v_maks numeric;
  sudah numeric;
  tot numeric := 0;
begin
  perform _wajib_akses(pid);
  if edit then
    perform _mulai_edit('retur_pembelian', dok, pid);
    perform _lepas_mutasi('retur_pembelian', dok);
    delete from retur_pembelian_detail where retur_id = dok;
  end if;

  if dari_faktur then
    select * into fb from faktur_pembelian where id = (p ->> 'faktur_id')::uuid and perusahaan_id = pid;
    if not found or fb.status <> 'aktif' or fb.gudang_id is null then
      raise exception 'Faktur supplier tidak ditemukan atau sudah dibatalkan.';
    end if;
    v_fb := fb.id; v_sup := fb.supplier_id; v_gdg := fb.gudang_id;
  else
    select * into sj from surat_jalan_masuk where id = (p ->> 'sj_id')::uuid and perusahaan_id = pid;
    if not found or sj.status <> 'aktif' then raise exception 'Surat jalan tidak ditemukan atau sudah dibatalkan.'; end if;
    v_sj := sj.id; v_sup := sj.supplier_id; v_gdg := sj.gudang_id;
  end if;

  if not edit then
    nomor := coalesce(nullif(trim(p ->> 'nomor'), ''), nomor_berikutnya(pid, 'RB', v_gdg, tgl));
    insert into retur_pembelian (perusahaan_id, nomor, tanggal, sj_id, faktur_id, supplier_id, gudang_id, keterangan)
    values (pid, nomor, tgl, v_sj, v_fb, v_sup, v_gdg, p ->> 'keterangan')
    returning id into dok;
  else
    update retur_pembelian
       set nomor = coalesce(nullif(trim(p ->> 'nomor'), ''), retur_pembelian.nomor), tanggal = tgl, sj_id = v_sj,
           faktur_id = v_fb, supplier_id = v_sup, gudang_id = v_gdg, keterangan = p ->> 'keterangan'
     where id = dok
    returning retur_pembelian.nomor into nomor;
  end if;

  for b in select * from jsonb_array_elements(coalesce(p -> 'baris', '[]')) loop
    v_qty := coalesce((b ->> 'qty')::numeric, 0);
    continue when v_qty = 0;
    if dari_faktur then
      select id, barang_id, round(dpp / qty, 4), qty into v_baris, v_barang, v_harga, v_maks
        from faktur_pembelian_detail where id = (b ->> 'fb_detail_id')::uuid and faktur_id = v_fb;
      if not found then raise exception 'Baris faktur tidak valid.'; end if;
      select coalesce(sum(d.qty), 0) into sudah from retur_pembelian_detail d
        join retur_pembelian r on r.id = d.retur_id
       where d.fb_detail_id = v_baris and r.status = 'aktif' and r.id <> dok;
    else
      select id, barang_id, harga, qty into v_baris, v_barang, v_harga, v_maks
        from sj_masuk_detail where id = (b ->> 'sj_detail_id')::uuid and sj_id = v_sj;
      if not found then raise exception 'Baris surat jalan tidak valid.'; end if;
      select coalesce(sum(d.qty), 0) into sudah from retur_pembelian_detail d
        join retur_pembelian r on r.id = d.retur_id
       where d.sj_detail_id = v_baris and r.status = 'aktif' and r.id <> dok;
    end if;
    if v_qty > v_maks - sudah then
      raise exception 'Qty retur % melebihi qty dibeli yang belum diretur (%).', _nama_barang(v_barang), trim_scale(v_maks - sudah);
    end if;
    insert into retur_pembelian_detail (perusahaan_id, retur_id, sj_detail_id, fb_detail_id, barang_id, qty, harga)
    values (pid, dok, case when dari_faktur then null else v_baris end, case when dari_faktur then v_baris end,
            v_barang, v_qty, v_harga);
    perform _stok_keluar(pid, v_barang, v_gdg, v_qty, tgl, 'RB', 'retur_pembelian', dok, nomor);
    tot := tot + v_qty * v_harga;
  end loop;

  if not exists (select 1 from retur_pembelian_detail where retur_id = dok) then
    raise exception 'Isi qty retur minimal untuk satu barang.';
  end if;
  update retur_pembelian set total = round(tot, 2) where id = dok;
  if edit then perform _cek_stok_minus(pid); end if;
  return dok;
end $$;

-- ---------------------------------------------------------------------
-- Pembatalan: faktur langsung mengeluarkan lagi stoknya
-- ---------------------------------------------------------------------

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

  elsif p_tabel = 'faktur_pembelian' and (select gudang_id from faktur_pembelian where id = p_id) is not null then
    -- Faktur langsung: barangnya masuk lewat faktur ini, jadi stoknya ikut dikeluarkan lagi.
    if exists (select 1 from retur_pembelian where faktur_id = p_id and status = 'aktif') then
      raise exception 'Faktur ini punya retur pembelian. Batalkan returnya dulu.';
    end if;
    perform _balik_mutasi(p_tabel, p_id, tgl, p_alasan);

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


-- ---------------------------------------------------------------------
-- Rekap pembelian per barang: barang diterima dari faktur langsung dan dari surat jalan lama
-- ---------------------------------------------------------------------

create or replace function laporan_pembelian_barang(p_pid uuid, p_dari date, p_sampai date, p_supplier uuid default null)
returns table (barang_id uuid, kode text, nama text, satuan text,
               qty_diterima numeric, nilai_diterima numeric, qty_retur numeric, nilai_retur numeric)
language sql stable security invoker set search_path = public as $$
  with masuk as (
    select d.barang_id, d.qty, d.qty * d.harga as nilai
      from surat_jalan_masuk s join sj_masuk_detail d on d.sj_id = s.id
     where s.perusahaan_id = p_pid and s.status = 'aktif' and s.tanggal between p_dari and p_sampai
       and (p_supplier is null or s.supplier_id = p_supplier)
    union all
    select d.barang_id, d.qty, d.dpp
      from faktur_pembelian f join faktur_pembelian_detail d on d.faktur_id = f.id
     where f.perusahaan_id = p_pid and f.status = 'aktif' and f.gudang_id is not null
       and f.tanggal between p_dari and p_sampai and (p_supplier is null or f.supplier_id = p_supplier)
  ), terima as (
    select barang_id, sum(qty) as qty, sum(nilai) as nilai from masuk group by barang_id
  ), retur as (
    select d.barang_id, sum(d.qty) as qty, sum(d.qty * d.harga) as nilai
      from retur_pembelian r join retur_pembelian_detail d on d.retur_id = r.id
     where r.perusahaan_id = p_pid and r.status = 'aktif' and r.tanggal between p_dari and p_sampai
       and (p_supplier is null or r.supplier_id = p_supplier)
     group by d.barang_id
  )
  select b.id, b.kode, b.nama, b.satuan,
         coalesce(t.qty, 0), round(coalesce(t.nilai, 0), 2), coalesce(r.qty, 0), round(coalesce(r.nilai, 0), 2)
    from barang b
    left join terima t on t.barang_id = b.id
    left join retur r on r.barang_id = b.id
   where b.perusahaan_id = p_pid and (t.barang_id is not null or r.barang_id is not null)
   order by b.nama
$$;
