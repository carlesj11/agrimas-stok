-- =====================================================================
-- Sistem Manajemen Stok CV Agrimas Perkasa
-- 009: nomor dokumen tidak boleh dipakai dua kali
--
-- Jalankan sekali di Supabase SQL Editor, setelah 001-008. Aman dijalankan ulang.
--
-- - Menyimpan atau mengedit dokumen dengan nomor yang sudah dipakai dokumen lain sejenis
--   (termasuk yang sudah dibatalkan) ditolak dengan pesan yang jelas. Huruf besar/kecil dan
--   spasi di awal/akhir tidak dibedakan, jadi "fj-01" dianggap sama dengan "FJ-01".
-- - Nomor otomatis melompati nomor yang sudah dipakai, misalnya karena pernah diketik manual.
-- =====================================================================

create or replace function _tabel_nomor(p_jenis text) returns text
language sql immutable as $$
  select case p_jenis
    when 'PO' then 'purchase_order' when 'RB' then 'retur_pembelian' when 'FJ' then 'faktur_penjualan'
    when 'SJK' then 'surat_jalan_keluar' when 'RJ' then 'retur_penjualan' when 'PS' then 'penyesuaian_stok'
    when 'TG' then 'transfer_gudang' when 'PBS' then 'pembelian_sementara'
  end
$$;

-- Sama seperti sebelumnya, ditambah: nomor yang sudah ada di tabel dokumennya dilewati.
create or replace function nomor_berikutnya(p_pid uuid, p_jenis text, p_gudang uuid, p_tanggal date) returns text
language plpgsql security definer set search_path = public as $$
declare
  f text;
  digit int;
  v_kunci text;
  n int;
  hasil text;
  tabel text := _tabel_nomor(p_jenis);
  sudah boolean;
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
  loop
    insert into nomor_urut (perusahaan_id, kunci, terakhir) values (p_pid, v_kunci, 1)
    on conflict on constraint nomor_urut_pkey do update set terakhir = nomor_urut.terakhir + 1
    returning nomor_urut.terakhir into n;
    hasil := regexp_replace(f, '\{N+\}', lpad(n::text, digit, '0'));
    exit when tabel is null;
    execute format('select exists (select 1 from %I where perusahaan_id = $1 and upper(trim(nomor)) = upper(trim($2)))', tabel)
      into sudah using p_pid, hasil;
    exit when not sudah;
  end loop;
  return hasil;
end $$;
revoke execute on function nomor_berikutnya(uuid, text, uuid, date) from public, anon, authenticated;

-- Tolak nomor yang sudah dipakai dokumen lain di tabel yang sama (tanpa membedakan huruf besar/kecil).
create or replace function _cek_nomor_unik() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  lain record;
begin
  if tg_op = 'UPDATE' and new.nomor is not distinct from old.nomor then return new; end if;
  new.nomor := trim(new.nomor);
  if new.nomor = '' then raise exception 'Nomor dokumen wajib diisi.'; end if;
  execute format('select nomor, tanggal, status from %I where perusahaan_id = $1 and id <> $2
                   and upper(trim(nomor)) = upper($3) limit 1', tg_table_name)
    into lain using new.perusahaan_id, new.id, new.nomor;
  if lain.nomor is not null then
    raise exception 'Nomor % sudah dipakai (tanggal %). Gunakan nomor lain.', lain.nomor,
      to_char(lain.tanggal, 'DD-MM-YYYY') || case when lain.status = 'batal' then ', sudah dibatalkan' else '' end
      using errcode = 'unique_violation';
  end if;
  return new;
end $$;
revoke execute on function _cek_nomor_unik() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['purchase_order', 'surat_jalan_masuk', 'faktur_pembelian', 'retur_pembelian',
                           'faktur_penjualan', 'surat_jalan_keluar', 'retur_penjualan', 'penyesuaian_stok',
                           'transfer_gudang', 'pembelian_sementara'] loop
    -- Nama diawali "x" supaya berjalan setelah trigger huruf kapital (trigger dijalankan urut nama).
    execute format('drop trigger if exists %I on %I', t || '_x_nomor_unik', t);
    execute format('create trigger %I before insert or update on %I for each row execute function _cek_nomor_unik()',
                   t || '_x_nomor_unik', t);
  end loop;
end $$;
