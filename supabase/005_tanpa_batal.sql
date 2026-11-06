-- =====================================================================
-- Sistem Manajemen Stok CV Agrimas Perkasa
-- 005: dokumen yang dibatalkan tidak tampil di Kartu Stok dan Laporan Stok.
--
-- Jalankan sekali di Supabase SQL Editor, setelah 001-004. Aman dijalankan ulang.
-- Stok dan HPP tidak berubah: pembatalan tetap membalik stoknya seperti biasa,
-- hanya baris pergerakan asli dan baris pembaliknya yang tidak ditampilkan lagi.
-- =====================================================================

-- Dokumen yang sudah dibatalkan punya baris BATAL di kartu stok. Laporan stok dan kartu stok
-- tidak menampilkan dokumen seperti ini sama sekali (baik pergerakan aslinya maupun pembaliknya).
create or replace function _dokumen_dibatalkan(p_tabel text, p_dok uuid) returns boolean
language sql stable security invoker set search_path = public as $$
  select exists (select 1 from mutasi_stok where dokumen_tabel = p_tabel and dokumen_id = p_dok and jenis = 'BATAL')
$$;

create or replace function kartu_stok(p_barang uuid, p_gudang uuid, p_dari date, p_sampai date)
returns table (id bigint, tanggal date, jenis text, nomor text, gudang_id uuid, keterangan text,
               qty_masuk numeric, qty_keluar numeric, saldo numeric, hpp numeric, dokumen_tabel text, dokumen_id uuid)
language sql stable security invoker set search_path = public as $$
  with semua as (
    select m.*, sum(m.qty_masuk - m.qty_keluar) over (order by m.tanggal, m.id) as saldo_jalan
      from mutasi_stok m
     where m.barang_id = p_barang and (p_gudang is null or m.gudang_id = p_gudang) and m.tanggal <= p_sampai
       and not _dokumen_dibatalkan(m.dokumen_tabel, m.dokumen_id)
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

-- Posisi stok setiap barang pada akhir tanggal tertentu, semua gudang atau satu gudang.
-- Nilai persediaan memakai HPP rata-rata saat ini.
create or replace function laporan_stok(p_pid uuid, p_tanggal date, p_gudang uuid default null)
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
         and not _dokumen_dibatalkan(ms.dokumen_tabel, ms.dokumen_id)
       group by ms.barang_id
    ) m on m.barang_id = b.id
   where b.perusahaan_id = p_pid
   order by b.nama
$$;

revoke execute on function _dokumen_dibatalkan(text, uuid) from public, anon;
grant execute on function _dokumen_dibatalkan(text, uuid) to authenticated;
