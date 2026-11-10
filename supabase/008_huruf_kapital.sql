-- =====================================================================
-- Sistem Manajemen Stok CV Agrimas Perkasa
-- 008: isian teks di semua dokumen disimpan dengan HURUF KAPITAL
--
-- Jalankan sekali di Supabase SQL Editor, setelah 001-007. Aman dijalankan ulang.
--
-- Nomor, keterangan, alasan batal, dan isian teks lain di setiap dokumen (PO, surat jalan,
-- faktur, retur, penyesuaian, pindah gudang, pembelian sementara) otomatis diubah ke huruf
-- kapital (spasi di awal/akhir dibuang) saat disimpan atau diedit, walau diketik dengan huruf kecil. Kartu stok ikut
-- memakai nomor yang sama. Dokumen yang sudah tersimpan sebelumnya tidak diubah.
-- Isian pilihan sistem (status, jenis, jenis bayar) tidak ikut diubah.
-- =====================================================================

create or replace function _huruf_kapital() returns trigger
language plpgsql as $$
declare
  k text;
  j jsonb := to_jsonb(new);
begin
  foreach k in array tg_argv loop
    if jsonb_typeof(j -> k) = 'string' then
      j := jsonb_set(j, array[k], to_jsonb(upper(btrim(j ->> k))));
    end if;
  end loop;
  return jsonb_populate_record(new, j);
end $$;

do $$
declare
  t record;
begin
  for t in select * from (values
      ('purchase_order',      array['nomor', 'keterangan', 'alasan_batal']),
      ('surat_jalan_masuk',   array['nomor', 'keterangan', 'alasan_batal']),
      ('faktur_pembelian',    array['nomor', 'keterangan', 'alasan_batal']),
      ('retur_pembelian',     array['nomor', 'keterangan', 'alasan_batal']),
      ('faktur_penjualan',    array['nomor', 'nama_customer', 'alamat_customer', 'keterangan', 'alasan_batal']),
      ('surat_jalan_keluar',  array['nomor', 'alamat_kirim', 'pengirim', 'kendaraan', 'keterangan', 'alasan_batal']),
      ('retur_penjualan',     array['nomor', 'keterangan', 'alasan_batal']),
      ('penyesuaian_stok',    array['nomor', 'keterangan', 'alasan_batal']),
      ('transfer_gudang',     array['nomor', 'keterangan', 'alasan_batal']),
      ('pembelian_sementara', array['nomor', 'keterangan', 'alasan_batal']),
      ('mutasi_stok',         array['nomor', 'keterangan'])
    ) as v(tabel, kolom)
  loop
    execute format('drop trigger if exists %I on %I', t.tabel || '_kapital', t.tabel);
    execute format('create trigger %I before insert or update on %I for each row execute function _huruf_kapital(%s)',
                   t.tabel || '_kapital', t.tabel,
                   (select string_agg(quote_literal(c), ', ') from unnest(t.kolom) c));
  end loop;
end $$;

revoke execute on function _huruf_kapital() from public, anon, authenticated;
