import { sb, q } from './db.js';
import { pid, isKelola } from './state.js';
import { h, tabel, bukaForm, toast, lencana, konfirmasi } from './ui.js';

// Halaman master data standar: daftar, cari, tambah, edit, aktif/nonaktif, hapus.
export function halamanMaster(cfg) {
  const {
    judul, tabel: namaTabel, kolom, field, cari = ['kode', 'nama'], urut = 'nama',
    bolehUbah = () => true, aksiTambahan, deskripsi,
  } = cfg;

  return async function render(konten) {
    let semua = [];
    let teks = '';
    let status = 'aktif';
    const wadah = h('div');

    const muat = async () => {
      semua = await q(sb.from(namaTabel).select('*').eq('perusahaan_id', pid()).order(urut));
      tampil();
    };

    const simpan = async (id, data) => {
      if (id) await q(sb.from(namaTabel).update(data).eq('id', id));
      else await q(sb.from(namaTabel).insert({ ...data, perusahaan_id: pid() }));
      toast(`${judul} tersimpan.`);
      await muat();
    };

    const formulir = (baris) => bukaForm({
      judul: baris ? `Ubah ${judul}` : `Tambah ${judul}`,
      field,
      nilai: baris ?? {},
      onSimpan: (data) => simpan(baris?.id, data),
    });

    const gantiAktif = async (baris) => {
      try {
        await q(sb.from(namaTabel).update({ aktif: !baris.aktif }).eq('id', baris.id));
        toast(baris.aktif ? `${baris.nama} dinonaktifkan.` : `${baris.nama} diaktifkan.`);
        await muat();
      } catch (e) { toast(e.message, 'error'); }
    };

    const hapus = async (baris) => {
      if (!konfirmasi(`Hapus ${baris.nama}? Data yang sudah dihapus tidak bisa dikembalikan.`)) return;
      try {
        await q(sb.from(namaTabel).delete().eq('id', baris.id));
        toast(`${baris.nama} dihapus.`);
        await muat();
      } catch (e) { toast(e.message, 'error'); }
    };

    const tampil = () => {
      const t = teks.toLowerCase();
      const baris = semua.filter((r) =>
        (status === 'semua' || (status === 'aktif') === r.aktif) &&
        (!t || cari.some((k) => String(r[k] ?? '').toLowerCase().includes(t))));
      const ubah = bolehUbah();
      wadah.replaceChildren(
        h('p', { class: 'info-jumlah' }, `${baris.length} dari ${semua.length} data`),
        tabel([
          ...kolom,
          { label: 'Status', isi: (r) => lencana(r.aktif) },
          {
            label: '', kelas: 'kol-aksi', isi: (r) => h('div', { class: 'aksi-baris' },
              aksiTambahan?.(r, muat),
              ubah && h('button', { class: 'tombol tombol-kecil', onclick: () => formulir(r) }, 'Ubah'),
              ubah && h('button', { class: 'tombol tombol-kecil', onclick: () => gantiAktif(r) },
                r.aktif ? 'Nonaktifkan' : 'Aktifkan'),
              ubah && isKelola() && h('button', { class: 'tombol tombol-kecil tombol-bahaya', onclick: () => hapus(r) }, 'Hapus')),
          },
        ], baris, semua.length ? 'Tidak ada data yang cocok.' : `Belum ada ${judul.toLowerCase()}. Klik "Tambah ${judul}".`),
      );
    };

    konten.replaceChildren(
      h('div', { class: 'kepala-halaman' },
        h('div', {}, h('h1', {}, judul), deskripsi && h('p', { class: 'deskripsi' }, deskripsi)),
        bolehUbah() && h('button', { class: 'tombol tombol-utama', onclick: () => formulir(null) }, `+ Tambah ${judul}`)),
      h('div', { class: 'saringan' },
        h('input', {
          type: 'search', placeholder: 'Cari kode atau nama…', 'aria-label': 'Cari',
          oninput: (e) => { teks = e.target.value; tampil(); },
        }),
        h('select', { 'aria-label': 'Status', onchange: (e) => { status = e.target.value; tampil(); } },
          h('option', { value: 'aktif' }, 'Aktif'),
          h('option', { value: 'nonaktif' }, 'Nonaktif'),
          h('option', { value: 'semua' }, 'Semua'))),
      wadah,
    );
    await muat();
  };
}
