-- =====================================================================
-- Sistem Manajemen Stok CV Agrimas Perkasa
-- 006: dokumen yang sudah disimpan bisa diedit (tambah/hapus barang, ubah qty, harga, dll.)
--
-- Jalankan sekali di Supabase SQL Editor, setelah 001-005. Aman dijalankan ulang.
--
-- Cara kerja: semua fungsi simpan_* menerima "id" dokumen yang sudah ada. Bila ada, pergerakan
-- stok lama dokumen itu dilepas, rinciannya dihapus, lalu dokumen diisi ulang dengan data baru
-- (nomor dan id tetap). Hanya Owner/Admin yang boleh mengedit, sama seperti pembatalan.
-- Sesuai keputusan pengguna, HPP tidak dihitung ulang mundur: HPP rata-rata hanya mengikuti
-- pergerakan baru. Stok tetap tidak boleh minus setelah perubahan.
-- Dokumen yang sudah dipakai dokumen lain (misalnya faktur yang sudah diretur) harus
-- dilepas dulu dari dokumen lanjutannya, supaya rinciannya tidak saling bertentangan.
-- =====================================================================

-- Melepas pengaruh stok sebuah dokumen tanpa mencatat baris BATAL: stok gudang dikembalikan
-- dan baris kartu stoknya dihapus. Dipakai sebelum dokumen diisi ulang.
create or replace function _lepas_mutasi(p_tabel text, p_dok uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update stok_gudang s set qty = s.qty - x.net, diubah_pada = now()
    from (select barang_id, gudang_id, sum(qty_masuk - qty_keluar) as net
            from mutasi_stok where dokumen_tabel = p_tabel and dokumen_id = p_dok
           group by barang_id, gudang_id) x
   where s.barang_id = x.barang_id and s.gudang_id = x.gudang_id;
  delete from mutasi_stok where dokumen_tabel = p_tabel and dokumen_id = p_dok;
end $$;

-- Setelah edit, tidak boleh ada stok yang minus.
create or replace function _cek_stok_minus(p_pid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select b.kode || ' ' || b.nama as barang, g.nama as gudang, s.qty into r
    from stok_gudang s join barang b on b.id = s.barang_id join gudang g on g.id = s.gudang_id
   where s.perusahaan_id = p_pid and s.qty < 0
   limit 1;
  if found then
    raise exception 'Perubahan ini membuat stok % di gudang % menjadi minus (%). Barangnya mungkin sudah terjual atau dipindahkan.',
      r.barang, r.gudang, trim_scale(r.qty);
  end if;
end $$;

-- Pemeriksaan bersama sebelum mengedit: Owner/Admin, dokumen milik perusahaan ini, belum dibatalkan.
create or replace function _mulai_edit(p_tabel text, p_id uuid, p_pid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  ada boolean;
  st text;
begin
  perform _tabel_dokumen(p_tabel);
  perform _wajib_kelola(p_pid);
  execute format('select true, status from %I where id = $1 and perusahaan_id = $2 for update', p_tabel)
    into ada, st using p_id, p_pid;
  if ada is null then raise exception 'Dokumen tidak ditemukan.'; end if;
  if st = 'batal' then raise exception 'Dokumen yang sudah dibatalkan tidak bisa diedit.'; end if;
end $$;

-- Rincian dokumen yang dibatalkan tetap menunjuk ke baris dokumen asalnya. Saat dokumen asal
-- diedit, rinciannya dibuat ulang, jadi tautan dari dokumen batal itu dilepas (dikosongkan);
-- barang dan qty dokumen batal tetap tersimpan.
alter table sj_masuk_detail alter column po_detail_id drop not null;
alter table faktur_pembelian_detail alter column sj_detail_id drop not null;
alter table retur_pembelian_detail alter column sj_detail_id drop not null;
alter table retur_penjualan_detail alter column fj_detail_id drop not null;

revoke execute on function _lepas_mutasi(text, uuid) from public, anon, authenticated;
revoke execute on function _cek_stok_minus(uuid) from public, anon, authenticated;
revoke execute on function _mulai_edit(text, uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Purchase Order
-- ---------------------------------------------------------------------

create or replace function simpan_po(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  pid uuid := (p ->> 'perusahaan_id')::uuid;
  tgl date := (p ->> 'tanggal')::date;
  dok uuid := nullif(p ->> 'id', '')::uuid;
  b jsonb;
  hb record;
  i int := 0;
  sub numeric := 0;
begin
  perform _wajib_akses(pid);
  if jsonb_array_length(coalesce(p -> 'baris', '[]')) = 0 then raise exception 'PO belum berisi barang.'; end if;

  if dok is null then
    insert into purchase_order (perusahaan_id, nomor, tanggal, supplier_id, jatuh_tempo, keterangan,
                                diskon_total, ppn_total)
    values (pid, coalesce(nullif(trim(p ->> 'nomor'), ''), nomor_berikutnya(pid, 'PO', null, tgl)), tgl,
            (p ->> 'supplier_id')::uuid, (p ->> 'jatuh_tempo')::date, p ->> 'keterangan',
            coalesce((p ->> 'diskon_total')::numeric, 0), coalesce((p ->> 'ppn_total')::numeric, 0))
    returning id into dok;
  else
    perform _mulai_edit('purchase_order', dok, pid);
    if exists (select 1 from surat_jalan_masuk where po_id = dok and status = 'aktif') then
      raise exception 'PO ini sudah punya surat jalan masuk. Batalkan surat jalannya dulu sebelum mengedit PO.';
    end if;
    update sj_masuk_detail d set po_detail_id = null
      from surat_jalan_masuk s, po_detail x
     where s.id = d.sj_id and s.status = 'batal' and x.id = d.po_detail_id and x.po_id = dok;
    delete from po_detail where po_id = dok;
    update purchase_order
       set nomor = coalesce(nullif(trim(p ->> 'nomor'), ''), nomor), tanggal = tgl,
           supplier_id = (p ->> 'supplier_id')::uuid, jatuh_tempo = (p ->> 'jatuh_tempo')::date,
           keterangan = p ->> 'keterangan',
           diskon_total = coalesce((p ->> 'diskon_total')::numeric, 0), ppn_total = coalesce((p ->> 'ppn_total')::numeric, 0)
     where id = dok;
  end if;

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

-- ---------------------------------------------------------------------
-- Surat Jalan Masuk
-- ---------------------------------------------------------------------

create or replace function simpan_sj_masuk(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
<<simpan_sj_masuk>>
declare
  pid uuid := (p ->> 'perusahaan_id')::uuid;
  tgl date := (p ->> 'tanggal')::date;
  gdg uuid := (p ->> 'gudang_id')::uuid;
  dok uuid := nullif(p ->> 'id', '')::uuid;
  edit boolean := dok is not null;
  lama_po uuid;
  lama_faktur uuid;
  harga_faktur jsonb := '{}';
  f jsonb;
  fd record;
  sd record;
  hb record;
  koreksi numeric;
  total_stok numeric;
  po record;
  pd record;
  b jsonb;
  v_qty numeric;
  harga numeric;
  nomor text := nullif(trim(p ->> 'nomor'), '');
begin
  perform _wajib_akses(pid);
  if nomor is null then raise exception 'Nomor surat jalan supplier wajib diisi.'; end if;

  if edit then
    perform _mulai_edit('surat_jalan_masuk', dok, pid);
    select po_id, faktur_id into lama_po, lama_faktur from surat_jalan_masuk where id = dok;
    if exists (select 1 from retur_pembelian where sj_id = dok and status = 'aktif') then
      raise exception 'Surat jalan ini punya retur pembelian. Batalkan returnya dulu.';
    end if;
    if lama_faktur is not null then
      -- Sudah difakturkan: simpan harga faktur per baris PO, lalu lepas baris fakturnya
      -- (berikut koreksi HPP-nya). Baris faktur dibuat ulang setelah surat jalan diisi ulang.
      select coalesce(jsonb_object_agg(x.po_detail_id::text, to_jsonb(d) || jsonb_build_object('qty_lama', d.qty)), '{}')
        into harga_faktur
        from faktur_pembelian_detail d join sj_masuk_detail x on x.id = d.sj_detail_id
       where x.sj_id = dok;
      for fd in select d.* from faktur_pembelian_detail d join sj_masuk_detail x on x.id = d.sj_detail_id
                 where x.sj_id = dok and d.koreksi_nilai <> 0 loop
        perform 1 from barang where id = fd.barang_id for update;
        select coalesce(sum(qty), 0) into total_stok from stok_gudang where barang_id = fd.barang_id;
        if total_stok > 0 then
          update barang set hpp = greatest(round(hpp - fd.koreksi_nilai / total_stok, 4), 0) where id = fd.barang_id;
        end if;
      end loop;
      delete from faktur_pembelian_detail d using sj_masuk_detail x where x.id = d.sj_detail_id and x.sj_id = dok;
    end if;
    update faktur_pembelian_detail d set sj_detail_id = null
      from faktur_pembelian f, sj_masuk_detail x
     where f.id = d.faktur_id and f.status = 'batal' and x.id = d.sj_detail_id and x.sj_id = dok;
    update retur_pembelian_detail d set sj_detail_id = null
      from retur_pembelian r, sj_masuk_detail x
     where r.id = d.retur_id and r.status = 'batal' and x.id = d.sj_detail_id and x.sj_id = dok;
    perform _lepas_mutasi('surat_jalan_masuk', dok);
    update po_detail x set qty_diterima = x.qty_diterima - d.qty
      from sj_masuk_detail d where d.sj_id = dok and d.po_detail_id = x.id;
    delete from sj_masuk_detail where sj_id = dok;
    perform _status_po(lama_po);
  end if;

  select * into po from purchase_order where id = (p ->> 'po_id')::uuid and perusahaan_id = pid for update;
  if not found then raise exception 'PO tidak ditemukan.'; end if;
  if po.status not in ('terbuka', 'sebagian') then raise exception 'PO % sudah %.', po.nomor, po.status; end if;

  if not edit then
    insert into surat_jalan_masuk (perusahaan_id, nomor, tanggal, po_id, supplier_id, gudang_id, keterangan)
    values (pid, nomor, tgl, po.id, po.supplier_id, gdg, p ->> 'keterangan')
    returning id into dok;
  else
    update surat_jalan_masuk
       set nomor = simpan_sj_masuk.nomor, tanggal = tgl, po_id = po.id, supplier_id = po.supplier_id,
           gudang_id = gdg, keterangan = p ->> 'keterangan'
     where id = dok;
  end if;

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
  if edit then
    if lama_po <> po.id then perform _status_po(lama_po); end if;
    if lama_faktur is not null then
      if po.supplier_id <> (select supplier_id from faktur_pembelian where id = lama_faktur) then
        raise exception 'Surat jalan ini sudah difakturkan, jadi PO-nya harus dari supplier yang sama.';
      end if;
      -- Buat ulang baris faktur: harga, diskon, dan PPN dari faktur lama; barang baru memakai harga PO.
      for sd in select * from sj_masuk_detail where sj_id = dok loop
        select * into pd from po_detail where id = sd.po_detail_id;
        f := harga_faktur -> sd.po_detail_id::text;
        hb := _hitung_baris(sd.qty, coalesce((f ->> 'harga')::numeric, pd.harga),
                            coalesce((f ->> 'diskon_persen')::numeric, pd.diskon_persen),
                            round(coalesce((f ->> 'diskon_nominal')::numeric / nullif((f ->> 'qty_lama')::numeric, 0),
                                           pd.diskon_nominal / pd.qty) * sd.qty, 2),
                            coalesce((f ->> 'ppn_persen')::numeric, pd.ppn_persen));
        koreksi := hb.dpp - sd.qty * sd.harga;
        if koreksi <> 0 then
          perform 1 from barang where id = sd.barang_id for update;
          select coalesce(sum(qty), 0) into total_stok from stok_gudang where barang_id = sd.barang_id;
          if total_stok > 0 then
            update barang set hpp = greatest(round(hpp + koreksi / total_stok, 4), 0) where id = sd.barang_id;
          else
            koreksi := 0;
          end if;
        end if;
        insert into faktur_pembelian_detail (perusahaan_id, faktur_id, sj_detail_id, barang_id, qty, harga,
                                             diskon_persen, diskon_nominal, ppn_persen, dpp, ppn, subtotal, koreksi_nilai)
        values (pid, lama_faktur, sd.id, sd.barang_id, sd.qty, coalesce((f ->> 'harga')::numeric, pd.harga),
                coalesce((f ->> 'diskon_persen')::numeric, pd.diskon_persen),
                round(coalesce((f ->> 'diskon_nominal')::numeric / nullif((f ->> 'qty_lama')::numeric, 0),
                               pd.diskon_nominal / pd.qty) * sd.qty, 2),
                coalesce((f ->> 'ppn_persen')::numeric, pd.ppn_persen), hb.dpp, hb.ppn, hb.subtotal, koreksi);
      end loop;
      update faktur_pembelian fp
         set subtotal = x.sub, total = x.sub - fp.diskon_total + fp.ppn_total
        from (select coalesce(sum(subtotal), 0) as sub from faktur_pembelian_detail where faktur_id = lama_faktur) x
       where fp.id = lama_faktur;
    end if;
    perform _cek_stok_minus(pid);
  end if;
  return dok;
end $$;

-- ---------------------------------------------------------------------
-- Faktur Supplier (tidak mengubah stok; harga bisa diubah)
-- ---------------------------------------------------------------------

create or replace function simpan_faktur_pembelian(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
<<simpan_faktur_pembelian>>
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
       set nomor = simpan_faktur_pembelian.nomor, tanggal = tgl, jatuh_tempo = coalesce((p ->> 'jatuh_tempo')::date, tgl + 30),
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

-- ---------------------------------------------------------------------
-- Retur Pembelian
-- ---------------------------------------------------------------------

create or replace function simpan_retur_pembelian(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  pid uuid := (p ->> 'perusahaan_id')::uuid;
  tgl date := (p ->> 'tanggal')::date;
  dok uuid := nullif(p ->> 'id', '')::uuid;
  edit boolean := dok is not null;
  sj record;
  sd record;
  nomor text;
  b jsonb;
  v_qty numeric;
  sudah numeric;
  tot numeric := 0;
begin
  perform _wajib_akses(pid);
  if edit then
    perform _mulai_edit('retur_pembelian', dok, pid);
    perform _lepas_mutasi('retur_pembelian', dok);
    delete from retur_pembelian_detail where retur_id = dok;
  end if;

  select * into sj from surat_jalan_masuk where id = (p ->> 'sj_id')::uuid and perusahaan_id = pid;
  if not found or sj.status <> 'aktif' then raise exception 'Surat jalan tidak ditemukan atau sudah dibatalkan.'; end if;

  if not edit then
    nomor := coalesce(nullif(trim(p ->> 'nomor'), ''), nomor_berikutnya(pid, 'RB', sj.gudang_id, tgl));
    insert into retur_pembelian (perusahaan_id, nomor, tanggal, sj_id, supplier_id, gudang_id, keterangan)
    values (pid, nomor, tgl, sj.id, sj.supplier_id, sj.gudang_id, p ->> 'keterangan')
    returning id into dok;
  else
    update retur_pembelian
       set nomor = coalesce(nullif(trim(p ->> 'nomor'), ''), retur_pembelian.nomor), tanggal = tgl, sj_id = sj.id,
           supplier_id = sj.supplier_id, gudang_id = sj.gudang_id, keterangan = p ->> 'keterangan'
     where id = dok
    returning retur_pembelian.nomor into nomor;
  end if;

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

  if not exists (select 1 from retur_pembelian_detail where retur_id = dok) then
    raise exception 'Isi qty retur minimal untuk satu barang.';
  end if;
  update retur_pembelian set total = round(tot, 2) where id = dok;
  if edit then perform _cek_stok_minus(pid); end if;
  return dok;
end $$;

-- ---------------------------------------------------------------------
-- Faktur Penjualan
-- ---------------------------------------------------------------------

create or replace function simpan_faktur_penjualan(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  pid uuid := (p ->> 'perusahaan_id')::uuid;
  tgl date := (p ->> 'tanggal')::date;
  gdg uuid := (p ->> 'gudang_id')::uuid;
  dok uuid := nullif(p ->> 'id', '')::uuid;
  edit boolean := dok is not null;
  cust record;
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

  if not edit then
    nomor := coalesce(nullif(trim(p ->> 'nomor'), ''), nomor_berikutnya(pid, 'FJ', gdg, tgl));
    insert into faktur_penjualan (perusahaan_id, nomor, tanggal, jatuh_tempo, customer_id, nama_customer,
                                  alamat_customer, sales_id, gudang_id, jenis_bayar, keterangan, diskon_total, ppn_total)
    values (pid, nomor, tgl, coalesce((p ->> 'jatuh_tempo')::date, tgl + 30), cust.id, cust.nama,
            concat_ws(', ', cust.alamat, cust.kota), (p ->> 'sales_id')::uuid, gdg,
            coalesce(p ->> 'jenis_bayar', 'kredit'), p ->> 'keterangan',
            coalesce((p ->> 'diskon_total')::numeric, 0), coalesce((p ->> 'ppn_total')::numeric, 0))
    returning id into dok;
  else
    perform _mulai_edit('faktur_penjualan', dok, pid);
    if exists (select 1 from retur_penjualan where faktur_id = dok and status = 'aktif') then
      raise exception 'Faktur ini punya retur penjualan. Batalkan returnya dulu sebelum mengedit faktur.';
    end if;
    update retur_penjualan_detail d set fj_detail_id = null
      from retur_penjualan r, faktur_penjualan_detail x
     where r.id = d.retur_id and r.status = 'batal' and x.id = d.fj_detail_id and x.faktur_id = dok;
    perform _lepas_mutasi('faktur_penjualan', dok);
    delete from faktur_penjualan_detail where faktur_id = dok;
    update faktur_penjualan f
       set nomor = coalesce(nullif(trim(p ->> 'nomor'), ''), f.nomor), tanggal = tgl,
           jatuh_tempo = coalesce((p ->> 'jatuh_tempo')::date, tgl + 30),
           customer_id = cust.id, nama_customer = cust.nama, alamat_customer = concat_ws(', ', cust.alamat, cust.kota),
           sales_id = (p ->> 'sales_id')::uuid, gudang_id = gdg, jenis_bayar = coalesce(p ->> 'jenis_bayar', 'kredit'),
           keterangan = p ->> 'keterangan',
           diskon_total = coalesce((p ->> 'diskon_total')::numeric, 0), ppn_total = coalesce((p ->> 'ppn_total')::numeric, 0)
     where f.id = dok
    returning f.nomor into nomor;
  end if;

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
  if edit then perform _cek_stok_minus(pid); end if;
  return dok;
end $$;

-- ---------------------------------------------------------------------
-- Surat Jalan Keluar (tidak mengubah stok)
-- ---------------------------------------------------------------------

create or replace function simpan_sj_keluar(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  pid uuid := (p ->> 'perusahaan_id')::uuid;
  tgl date := (p ->> 'tanggal')::date;
  dok uuid := nullif(p ->> 'id', '')::uuid;
  fj record;
begin
  perform _wajib_akses(pid);
  select * into fj from faktur_penjualan where id = (p ->> 'faktur_id')::uuid and perusahaan_id = pid;
  if not found or fj.status <> 'aktif' then raise exception 'Faktur tidak ditemukan atau sudah dibatalkan.'; end if;
  if dok is null then
    insert into surat_jalan_keluar (perusahaan_id, nomor, tanggal, faktur_id, alamat_kirim, pengirim, kendaraan, keterangan)
    values (pid, coalesce(nullif(trim(p ->> 'nomor'), ''), nomor_berikutnya(pid, 'SJK', fj.gudang_id, tgl)), tgl, fj.id,
            coalesce(nullif(p ->> 'alamat_kirim', ''), fj.alamat_customer), p ->> 'pengirim', p ->> 'kendaraan', p ->> 'keterangan')
    returning id into dok;
  else
    perform _mulai_edit('surat_jalan_keluar', dok, pid);
    update surat_jalan_keluar s
       set nomor = coalesce(nullif(trim(p ->> 'nomor'), ''), s.nomor), tanggal = tgl, faktur_id = fj.id,
           alamat_kirim = coalesce(nullif(p ->> 'alamat_kirim', ''), fj.alamat_customer),
           pengirim = p ->> 'pengirim', kendaraan = p ->> 'kendaraan', keterangan = p ->> 'keterangan'
     where s.id = dok;
  end if;
  return dok;
end $$;

-- ---------------------------------------------------------------------
-- Retur Penjualan
-- ---------------------------------------------------------------------

create or replace function simpan_retur_penjualan(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  pid uuid := (p ->> 'perusahaan_id')::uuid;
  tgl date := (p ->> 'tanggal')::date;
  dok uuid := nullif(p ->> 'id', '')::uuid;
  edit boolean := dok is not null;
  fj record;
  fd record;
  gdg uuid;
  nomor text;
  b jsonb;
  v_qty numeric;
  sudah numeric;
  nilai numeric;
  tot numeric := 0;
begin
  perform _wajib_akses(pid);
  if edit then
    perform _mulai_edit('retur_penjualan', dok, pid);
    perform _lepas_mutasi('retur_penjualan', dok);
    delete from retur_penjualan_detail where retur_id = dok;
  end if;

  select * into fj from faktur_penjualan where id = (p ->> 'faktur_id')::uuid and perusahaan_id = pid;
  if not found or fj.status <> 'aktif' then raise exception 'Faktur tidak ditemukan atau sudah dibatalkan.'; end if;
  gdg := coalesce((p ->> 'gudang_id')::uuid, fj.gudang_id);

  if not edit then
    nomor := coalesce(nullif(trim(p ->> 'nomor'), ''), nomor_berikutnya(pid, 'RJ', gdg, tgl));
    insert into retur_penjualan (perusahaan_id, nomor, tanggal, faktur_id, customer_id, gudang_id, keterangan)
    values (pid, nomor, tgl, fj.id, fj.customer_id, gdg, p ->> 'keterangan')
    returning id into dok;
  else
    update retur_penjualan r
       set nomor = coalesce(nullif(trim(p ->> 'nomor'), ''), r.nomor), tanggal = tgl, faktur_id = fj.id,
           customer_id = fj.customer_id, gudang_id = gdg, keterangan = p ->> 'keterangan'
     where r.id = dok
    returning r.nomor into nomor;
  end if;

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
  if edit then perform _cek_stok_minus(pid); end if;
  return dok;
end $$;

-- ---------------------------------------------------------------------
-- Stok Awal / Penyesuaian
--   stok_awal / lainnya: baris {barang_id, selisih, hpp}  (selisih + masuk, - keluar)
--   opname:              baris {barang_id, qty_fisik}      (selisih dihitung dari stok sistem)
-- ---------------------------------------------------------------------

create or replace function simpan_penyesuaian(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  pid uuid := (p ->> 'perusahaan_id')::uuid;
  tgl date := (p ->> 'tanggal')::date;
  gdg uuid := (p ->> 'gudang_id')::uuid;
  jns text := p ->> 'jenis';
  dok uuid := nullif(p ->> 'id', '')::uuid;
  edit boolean := dok is not null;
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

  if not edit then
    nomor := coalesce(nullif(trim(p ->> 'nomor'), ''), nomor_berikutnya(pid, 'PS', gdg, tgl));
    insert into penyesuaian_stok (perusahaan_id, nomor, tanggal, gudang_id, jenis, keterangan)
    values (pid, nomor, tgl, gdg, jns, p ->> 'keterangan')
    returning id into dok;
  else
    perform _mulai_edit('penyesuaian_stok', dok, pid);
    perform _lepas_mutasi('penyesuaian_stok', dok);
    delete from penyesuaian_stok_detail where penyesuaian_id = dok;
    update penyesuaian_stok s
       set nomor = coalesce(nullif(trim(p ->> 'nomor'), ''), s.nomor), tanggal = tgl, gudang_id = gdg, jenis = jns,
           keterangan = p ->> 'keterangan'
     where s.id = dok
    returning s.nomor into nomor;
  end if;

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
  if edit then perform _cek_stok_minus(pid); end if;
  return dok;
end $$;

-- ---------------------------------------------------------------------
-- Pindah Gudang
-- ---------------------------------------------------------------------

create or replace function simpan_transfer(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  pid uuid := (p ->> 'perusahaan_id')::uuid;
  tgl date := (p ->> 'tanggal')::date;
  asal uuid := (p ->> 'gudang_asal')::uuid;
  tujuan uuid := (p ->> 'gudang_tujuan')::uuid;
  dok uuid := nullif(p ->> 'id', '')::uuid;
  edit boolean := dok is not null;
  nomor text;
  b jsonb;
  h numeric;
begin
  perform _wajib_akses(pid);
  if asal = tujuan then raise exception 'Gudang asal dan tujuan harus berbeda.'; end if;

  if not edit then
    nomor := coalesce(nullif(trim(p ->> 'nomor'), ''), nomor_berikutnya(pid, 'TG', asal, tgl));
    insert into transfer_gudang (perusahaan_id, nomor, tanggal, gudang_asal, gudang_tujuan, keterangan)
    values (pid, nomor, tgl, asal, tujuan, p ->> 'keterangan')
    returning id into dok;
  else
    perform _mulai_edit('transfer_gudang', dok, pid);
    perform _lepas_mutasi('transfer_gudang', dok);
    delete from transfer_gudang_detail where transfer_id = dok;
    update transfer_gudang t
       set nomor = coalesce(nullif(trim(p ->> 'nomor'), ''), t.nomor), tanggal = tgl, gudang_asal = asal,
           gudang_tujuan = tujuan, keterangan = p ->> 'keterangan'
     where t.id = dok
    returning t.nomor into nomor;
  end if;

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
  if edit then perform _cek_stok_minus(pid); end if;
  return dok;
end $$;
