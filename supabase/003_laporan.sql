-- =====================================================================
-- Sistem Manajemen Stok CV Agrimas Perkasa
-- 003: Fungsi laporan
--
-- Jalankan setelah 002_transaksi.sql: SQL Editor -> New query -> tempel -> Run.
-- Semua fungsi memakai hak akses user yang login (Row Level Security tetap berlaku).
-- =====================================================================

-- Posisi stok setiap barang pada akhir tanggal tertentu, semua gudang atau satu gudang.
-- Nilai persediaan memakai HPP rata-rata saat ini.
create function laporan_stok(p_pid uuid, p_tanggal date, p_gudang uuid default null)
returns table (barang_id uuid, kode text, nama text, satuan text, aktif boolean,
               stok_minimum numeric, qty numeric, hpp numeric, nilai numeric)
language sql stable security invoker set search_path = public as $$
  select b.id, b.kode, b.nama, b.satuan, b.aktif, b.stok_minimum,
         coalesce(m.qty, 0), b.hpp, round(coalesce(m.qty, 0) * b.hpp, 2)
    from barang b
    left join (
      select ms.barang_id, sum(ms.qty_masuk - ms.qty_keluar) as qty
        from mutasi_stok ms
       where ms.perusahaan_id = p_pid and ms.tanggal <= p_tanggal
         and (p_gudang is null or ms.gudang_id = p_gudang)
       group by ms.barang_id
    ) m on m.barang_id = b.id
   where b.perusahaan_id = p_pid
   order by b.nama
$$;

-- Rekap penjualan per barang dalam periode (faktur aktif), dikurangi retur aktif.
create function laporan_penjualan_barang(p_pid uuid, p_dari date, p_sampai date,
                                         p_customer uuid default null, p_sales uuid default null)
returns table (barang_id uuid, kode text, nama text, satuan text,
               qty_jual numeric, nilai_jual numeric, qty_retur numeric, nilai_retur numeric,
               qty_bersih numeric, nilai_bersih numeric)
language sql stable security invoker set search_path = public as $$
  with jual as (
    select d.barang_id, sum(d.qty) as qty, sum(d.subtotal) as nilai
      from faktur_penjualan f join faktur_penjualan_detail d on d.faktur_id = f.id
     where f.perusahaan_id = p_pid and f.status = 'aktif' and f.tanggal between p_dari and p_sampai
       and (p_customer is null or f.customer_id = p_customer)
       and (p_sales is null or f.sales_id = p_sales)
     group by d.barang_id
  ), retur as (
    select d.barang_id, sum(d.qty) as qty, sum(d.nilai) as nilai
      from retur_penjualan r
      join retur_penjualan_detail d on d.retur_id = r.id
      join faktur_penjualan f on f.id = r.faktur_id
     where r.perusahaan_id = p_pid and r.status = 'aktif' and r.tanggal between p_dari and p_sampai
       and (p_customer is null or r.customer_id = p_customer)
       and (p_sales is null or f.sales_id = p_sales)
     group by d.barang_id
  )
  select b.id, b.kode, b.nama, b.satuan,
         coalesce(j.qty, 0), coalesce(j.nilai, 0), coalesce(r.qty, 0), coalesce(r.nilai, 0),
         coalesce(j.qty, 0) - coalesce(r.qty, 0), coalesce(j.nilai, 0) - coalesce(r.nilai, 0)
    from barang b
    left join jual j on j.barang_id = b.id
    left join retur r on r.barang_id = b.id
   where b.perusahaan_id = p_pid and (j.barang_id is not null or r.barang_id is not null)
   order by b.nama
$$;

-- Rekap pembelian per barang: barang diterima (surat jalan) dan nilai faktur supplier dalam periode.
create function laporan_pembelian_barang(p_pid uuid, p_dari date, p_sampai date, p_supplier uuid default null)
returns table (barang_id uuid, kode text, nama text, satuan text,
               qty_diterima numeric, nilai_diterima numeric, qty_retur numeric, nilai_retur numeric)
language sql stable security invoker set search_path = public as $$
  with terima as (
    select d.barang_id, sum(d.qty) as qty, sum(d.qty * d.harga) as nilai
      from surat_jalan_masuk s join sj_masuk_detail d on d.sj_id = s.id
     where s.perusahaan_id = p_pid and s.status = 'aktif' and s.tanggal between p_dari and p_sampai
       and (p_supplier is null or s.supplier_id = p_supplier)
     group by d.barang_id
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

do $$
declare f text;
begin
  foreach f in array array['laporan_stok(uuid, date, uuid)',
                           'laporan_penjualan_barang(uuid, date, date, uuid, uuid)',
                           'laporan_pembelian_barang(uuid, date, date, uuid)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
