import { sb, q } from '../db.js';
import { pid, isKelola } from '../state.js';
import { halamanMaster } from '../crud.js';
import { h, tabel, modal, toast, angka, rupiah, konfirmasi } from '../ui.js';

const fKode = { key: 'kode', label: 'Kode', required: true };
const fNama = { key: 'nama', label: 'Nama', required: true };
const fAlamat = { key: 'alamat', label: 'Alamat', type: 'textarea', lebar: true };
const fKota = { key: 'kota', label: 'Kota' };
const fTelepon = { key: 'telepon', label: 'Telepon' };
const fKet = { key: 'keterangan', label: 'Keterangan', type: 'textarea', lebar: true };
const kKode = { label: 'Kode', isi: (r) => r.kode };
const kNama = { label: 'Nama', isi: (r) => r.nama };

export const halamanBarang = halamanMaster({
  judul: 'Barang',
  tabel: 'barang',
  deskripsi: 'Daftar barang yang dijual dan dibeli. Stok dan HPP dihitung otomatis dari transaksi.',
  kolom: [
    kKode, kNama,
    { label: 'Satuan', isi: (r) => r.satuan },
    { label: 'Harga Jual', kelas: 'kanan', isi: (r) => rupiah(r.harga_jual) },
    { label: 'HPP', kelas: 'kanan', isi: (r) => rupiah(r.hpp) },
    { label: 'Stok Min.', kelas: 'kanan', isi: (r) => angka(r.stok_minimum) },
  ],
  field: [
    fKode, fNama,
    { key: 'satuan', label: 'Satuan', required: true, bawaan: 'pcs', placeholder: 'pcs, sak, kg, liter…' },
    { key: 'harga_jual', label: 'Harga Jual (Rp)', type: 'number' },
    { key: 'harga_beli', label: 'Harga Beli Standar (Rp)', type: 'number', hint: 'Dipakai bila supplier belum punya harga khusus.' },
    { key: 'stok_minimum', label: 'Stok Minimum', type: 'number', hint: 'Muncul di Beranda bila stok di bawah angka ini.' },
    fKet,
  ],
  aksiTambahan: (r) => h('button', { class: 'tombol tombol-kecil', onclick: () => detailBarang(r) }, 'Detail'),
});

async function detailBarang(barang) {
  const isi = h('div', {}, h('p', {}, 'Memuat…'));
  modal(`${barang.kode} · ${barang.nama}`, isi, { lebar: true });
  try {
    const [stok, gudang, bs, supplier] = await Promise.all([
      q(sb.from('stok_gudang').select('*').eq('barang_id', barang.id)),
      q(sb.from('gudang').select('id,kode,nama').eq('perusahaan_id', pid()).order('nama')),
      q(sb.from('barang_supplier').select('*').eq('barang_id', barang.id)),
      q(sb.from('supplier').select('id,kode,nama').eq('perusahaan_id', pid())),
    ]);
    const qtyGudang = Object.fromEntries(stok.map((s) => [s.gudang_id, s.qty]));
    const namaSupplier = Object.fromEntries(supplier.map((s) => [s.id, `${s.kode} · ${s.nama}`]));
    const total = stok.reduce((n, s) => n + Number(s.qty), 0);
    isi.replaceChildren(
      h('div', { class: 'ringkas' },
        h('div', {}, h('small', {}, 'Total stok'), h('strong', {}, `${angka(total)} ${barang.satuan}`)),
        h('div', {}, h('small', {}, 'HPP rata-rata'), h('strong', {}, rupiah(barang.hpp))),
        h('div', {}, h('small', {}, 'Nilai persediaan'), h('strong', {}, rupiah(total * Number(barang.hpp))))),
      h('h3', {}, 'Stok per gudang'),
      tabel([
        { label: 'Gudang', isi: (g) => `${g.kode} · ${g.nama}` },
        { label: 'Qty', kelas: 'kanan', isi: (g) => `${angka(qtyGudang[g.id] ?? 0)} ${barang.satuan}` },
      ], gudang, 'Belum ada gudang. Tambahkan di menu Gudang.'),
      h('h3', {}, 'Dipasok oleh'),
      tabel([
        { label: 'Supplier', isi: (r) => namaSupplier[r.supplier_id] ?? '-' },
        { label: 'Harga Beli', kelas: 'kanan', isi: (r) => rupiah(r.harga_beli) },
      ], bs, 'Belum dikaitkan ke supplier. Atur dari menu Supplier.'),
    );
  } catch (e) {
    isi.replaceChildren(h('p', { class: 'form-error' }, e.message));
  }
}

export const halamanSupplier = halamanMaster({
  judul: 'Supplier',
  tabel: 'supplier',
  kolom: [kKode, kNama, { label: 'Kota', isi: (r) => r.kota ?? '' }, { label: 'Telepon', isi: (r) => r.telepon ?? '' }],
  field: [fKode, fNama, fAlamat, fKota, fTelepon, { key: 'kontak', label: 'Nama Kontak' }, fKet],
  aksiTambahan: (r) => h('button', { class: 'tombol tombol-kecil', onclick: () => barangSupplier(r) }, 'Barang'),
});

// Atur barang apa saja yang dipasok supplier ini. Daftar ini membatasi pilihan barang di PO.
async function barangSupplier(supplier) {
  const isi = h('div', {}, h('p', {}, 'Memuat…'));
  modal(`Barang dari ${supplier.nama}`, isi, { lebar: true });

  const muat = async () => {
    const [daftar, barang] = await Promise.all([
      q(sb.from('barang_supplier').select('*').eq('supplier_id', supplier.id)),
      q(sb.from('barang').select('id,kode,nama,satuan,harga_beli').eq('perusahaan_id', pid()).eq('aktif', true).order('nama')),
    ]);
    const peta = Object.fromEntries(barang.map((b) => [b.id, b]));
    const sudah = new Set(daftar.map((d) => d.barang_id));
    const pilihan = barang.filter((b) => !sudah.has(b.id));

    const pilihBarang = h('select', { 'aria-label': 'Barang' },
      h('option', { value: '' }, pilihan.length ? 'Pilih barang…' : 'Semua barang aktif sudah ditambahkan'),
      pilihan.map((b) => h('option', { value: b.id }, `${b.kode} · ${b.nama}`)));
    const harga = h('input', { type: 'number', min: 0, step: 'any', placeholder: 'Harga beli', 'aria-label': 'Harga beli' });
    pilihBarang.addEventListener('change', () => { harga.value = peta[pilihBarang.value]?.harga_beli ?? ''; });

    const tambah = async (e) => {
      e.preventDefault();
      if (!pilihBarang.value) return;
      try {
        await q(sb.from('barang_supplier').insert({
          perusahaan_id: pid(), supplier_id: supplier.id, barang_id: pilihBarang.value,
          harga_beli: Number(harga.value || 0),
        }));
        await muat();
      } catch (err) { toast(err.message, 'error'); }
    };

    const ubahHarga = async (d, nilai) => {
      try {
        await q(sb.from('barang_supplier').update({ harga_beli: Number(nilai || 0) }).eq('id', d.id));
        toast('Harga tersimpan.');
      } catch (err) { toast(err.message, 'error'); }
    };

    const lepas = async (d) => {
      if (!konfirmasi(`Lepaskan ${peta[d.barang_id]?.nama ?? 'barang ini'} dari supplier ini?`)) return;
      try {
        await q(sb.from('barang_supplier').delete().eq('id', d.id));
        await muat();
      } catch (err) { toast(err.message, 'error'); }
    };

    isi.replaceChildren(
      h('form', { class: 'baris-tambah', onsubmit: tambah }, pilihBarang, harga,
        h('button', { class: 'tombol tombol-utama', type: 'submit' }, 'Tambah')),
      tabel([
        { label: 'Barang', isi: (d) => peta[d.barang_id] ? `${peta[d.barang_id].kode} · ${peta[d.barang_id].nama}` : '(nonaktif)' },
        {
          label: 'Harga Beli (Rp)', kelas: 'kanan', isi: (d) => h('input', {
            type: 'number', min: 0, step: 'any', value: d.harga_beli, class: 'input-kecil', 'aria-label': 'Harga beli',
            onchange: (e) => ubahHarga(d, e.target.value),
          }),
        },
        { label: '', kelas: 'kol-aksi', isi: (d) => isKelola() && h('button', { class: 'tombol tombol-kecil tombol-bahaya', onclick: () => lepas(d) }, 'Lepas') },
      ], daftar, 'Belum ada barang yang dikaitkan ke supplier ini.'),
    );
  };

  try { await muat(); } catch (e) { isi.replaceChildren(h('p', { class: 'form-error' }, e.message)); }
}

export const halamanCustomer = halamanMaster({
  judul: 'Customer',
  tabel: 'customer',
  kolom: [kKode, kNama, { label: 'Kota', isi: (r) => r.kota ?? '' }, { label: 'Telepon', isi: (r) => r.telepon ?? '' }],
  field: [fKode, fNama, fAlamat, fKota, fTelepon, fKet],
});

export const halamanSales = halamanMaster({
  judul: 'Sales',
  tabel: 'sales',
  deskripsi: 'Tenaga sales yang dicatat di faktur penjualan.',
  kolom: [kKode, kNama, { label: 'Telepon', isi: (r) => r.telepon ?? '' }],
  field: [fKode, fNama, fTelepon],
});

export const halamanGudang = halamanMaster({
  judul: 'Gudang',
  tabel: 'gudang',
  deskripsi: 'Lokasi penyimpanan stok. Hanya Owner dan Admin yang bisa mengatur gudang.',
  bolehUbah: isKelola,
  kolom: [kKode, kNama, { label: 'Alamat', isi: (r) => r.alamat ?? '' }],
  field: [fKode, fNama, fAlamat, fKet],
});
