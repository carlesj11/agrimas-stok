import { sb, q } from '../db.js';
import { pid, isKelola } from '../state.js';
import { h, tabel, toast, angka, rupiah } from '../ui.js';
import {
  halamanDaftar, bukaDetail, aksiKelola, formDokumen, isian, pilihan, editorBaris, muatMaster,
  namaKode, opsi, rpc, hariIni, awalBulan, tgl, stokGudang,
} from '../dokumen.js';

const satuan = (m, id) => m.barangMap[id]?.satuan ?? '';
const namaBarang = (m, id) => namaKode(m.barangMap[id]);

const NAMA_JENIS = {
  AWAL: 'Saldo awal', SJM: 'Surat jalan masuk', FJ: 'Faktur penjualan', RJ: 'Retur penjualan',
  RB: 'Retur pembelian', PS: 'Penyesuaian', TG: 'Pindah gudang', BATAL: 'Pembatalan',
};

// ===================================================================
// Kartu Stok
// ===================================================================

export async function halamanKartuStok(konten) {
  const m = await muatMaster('barang', 'gudang');
  const peta = new Map(m.barang.map((b) => [namaKode(b), b]));
  const barang = h('input', { list: 'dl-kartu', placeholder: 'Ketik kode atau nama barang…', 'aria-label': 'Barang' });
  const gudang = pilihan(opsi(m.gudang, false), { kosong: 'Semua gudang' });
  const dari = h('input', { type: 'date', value: awalBulan(), 'aria-label': 'Dari' });
  const sampai = h('input', { type: 'date', value: hariIni(), 'aria-label': 'Sampai' });
  const hasil = h('div', {}, h('p', { class: 'kosong' }, 'Pilih barang untuk melihat kartu stoknya.'));

  const tampil = async () => {
    const b = peta.get(barang.value.trim());
    if (!b) { hasil.replaceChildren(h('p', { class: 'kosong' }, 'Pilih barang dari daftar.')); return; }
    try {
      const [rows, stok] = await Promise.all([
        rpc('kartu_stok', { p_barang: b.id, p_gudang: gudang.value || null, p_dari: dari.value, p_sampai: sampai.value }),
        q(sb.from('stok_gudang').select('gudang_id,qty').eq('barang_id', b.id)),
      ]);
      const totalStok = stok.reduce((n, s) => n + Number(s.qty), 0);
      const masuk = rows.reduce((n, r) => n + Number(r.qty_masuk ?? 0), 0);
      const keluar = rows.reduce((n, r) => n + Number(r.qty_keluar ?? 0), 0);
      hasil.replaceChildren(
        h('div', { class: 'ringkas kartu' },
          h('div', {}, h('small', {}, 'Stok sekarang (semua gudang)'), h('strong', {}, `${angka(totalStok)} ${b.satuan}`)),
          h('div', {}, h('small', {}, 'HPP rata-rata'), h('strong', {}, rupiah(b.hpp))),
          h('div', {}, h('small', {}, 'Masuk periode ini'), h('strong', {}, angka(masuk))),
          h('div', {}, h('small', {}, 'Keluar periode ini'), h('strong', {}, angka(keluar)))),
        tabel([
          { label: 'Tanggal', isi: (r) => tgl(r.tanggal) },
          { label: 'Jenis', isi: (r) => NAMA_JENIS[r.jenis] ?? r.jenis },
          { label: 'Nomor', isi: (r) => r.nomor },
          { label: 'Gudang', isi: (r) => m.gudangMap[r.gudang_id]?.nama ?? '' },
          { label: 'Keterangan', isi: (r) => r.keterangan ?? '' },
          { label: 'Masuk', kelas: 'kanan', isi: (r) => (Number(r.qty_masuk) ? angka(r.qty_masuk) : '') },
          { label: 'Keluar', kelas: 'kanan', isi: (r) => (Number(r.qty_keluar) ? angka(r.qty_keluar) : '') },
          { label: 'Saldo', kelas: 'kanan tebal', isi: (r) => angka(r.saldo) },
        ], rows));
    } catch (e) {
      hasil.replaceChildren(h('p', { class: 'form-error' }, e.message));
    }
  };
  for (const el of [barang, gudang, dari, sampai]) el.addEventListener('change', tampil);

  konten.replaceChildren(
    h('div', { class: 'kepala-halaman' }, h('div', {}, h('h1', {}, 'Kartu Stok'),
      h('p', { class: 'deskripsi' }, 'Riwayat keluar masuk barang beserta saldo berjalan.'))),
    h('datalist', { id: 'dl-kartu' }, m.barang.map((b) => h('option', { value: namaKode(b) }))),
    h('div', { class: 'saringan' },
      barang, gudang,
      h('label', { class: 'saringan-tgl' }, 'Dari', dari),
      h('label', { class: 'saringan-tgl' }, 'Sampai', sampai)),
    hasil);
}

// ===================================================================
// Stok Awal & Penyesuaian (Owner/Admin)
// ===================================================================

const JENIS_PENYESUAIAN = [
  { value: 'stok_awal', label: 'Stok awal' },
  { value: 'opname', label: 'Stock opname (hitung fisik)' },
  { value: 'lainnya', label: 'Penyesuaian lain (rusak, hilang, dll)' },
];

async function formPenyesuaian(ctx) {
  const gudangAktif = ctx.gudang.filter((g) => g.aktif);
  if (!gudangAktif.length) { toast('Buat gudang dulu di menu Gudang.', 'error'); return; }
  const barangAktif = ctx.barang.filter((b) => b.aktif);
  const peta = new Map(barangAktif.map((b) => [namaKode(b), b]));
  let stok = await stokGudang(gudangAktif[0].id);

  const tbody = h('tbody');
  const thead = h('thead');
  let baris = [];

  const kolomJenis = () => ({
    stok_awal: ['Barang', 'Stok sistem', 'Qty masuk', 'HPP / unit (Rp)'],
    opname: ['Barang', 'Stok sistem', 'Stok fisik', 'Selisih'],
    lainnya: ['Barang', 'Stok sistem', 'Tambah / kurang (±)', 'HPP / unit bila tambah'],
  }[jenis.value]);

  const tambahBaris = (b) => {
    const pilih = h('input', { list: 'dl-penyesuaian', placeholder: 'Ketik kode atau nama…', class: 'input-barang', 'aria-label': 'Barang', value: b ? namaKode(b) : '' });
    const sistem = h('span');
    const angka1 = h('input', { type: 'number', step: 'any', class: 'input-angka', 'aria-label': 'Qty' });
    const angka2 = h('input', { type: 'number', min: 0, step: 'any', class: 'input-angka', 'aria-label': 'HPP' });
    const selisih = h('span');
    const r = {
      barang: () => peta.get(pilih.value.trim()), pilih, angka1, angka2,
      segarkan: () => {
        const br = r.barang();
        sistem.textContent = br ? `${angka(stok[br.id] ?? 0)} ${br.satuan}` : '';
        if (br && jenis.value !== 'opname' && !angka2.value) angka2.value = Number(br.hpp) || Number(br.harga_beli) || '';
        if (jenis.value === 'opname') {
          selisih.textContent = br && angka1.value !== '' ? angka(Number(angka1.value) - (stok[br.id] ?? 0)) : '';
        }
      },
    };
    pilih.addEventListener('change', r.segarkan);
    angka1.addEventListener('input', r.segarkan);
    const tr = h('tr', {},
      h('td', { 'data-label': 'Barang' }, pilih),
      h('td', { 'data-label': 'Stok sistem', class: 'kanan' }, sistem),
      h('td', { 'data-label': 'Qty', class: 'kanan' }, angka1),
      h('td', { 'data-label': jenis.value === 'opname' ? 'Selisih' : 'HPP', class: 'kanan' }, jenis.value === 'opname' ? selisih : angka2),
      h('td', { class: 'kol-aksi' }, h('button', { type: 'button', class: 'tombol tombol-kecil tombol-bahaya', 'aria-label': 'Hapus baris', onclick: () => { baris = baris.filter((x) => x !== r); tr.remove(); } }, '×')));
    baris.push(r);
    tbody.append(tr);
    r.segarkan();
    return pilih;
  };

  const susunUlang = () => {
    thead.replaceChildren(h('tr', {}, kolomJenis().map((k, i) => h('th', { class: i ? 'kanan' : null }, k)), h('th')));
    tbody.replaceChildren();
    baris = [];
    tambahBaris();
  };

  const jenis = pilihan(JENIS_PENYESUAIAN, { onchange: susunUlang });
  const gudang = pilihan(opsi(ctx.gudang), {
    wajib: true,
    onchange: async () => { stok = await stokGudang(gudang.value); baris.forEach((r) => r.segarkan()); },
  });
  const tanggal = h('input', { type: 'date', value: hariIni(), required: true });
  const ket = h('textarea', { rows: 2 });
  susunUlang();

  formDokumen({
    judul: 'Stok Awal / Penyesuaian',
    badan: h('div', {},
      h('div', { class: 'form-grid form-grid-3' },
        isian('Jenis', jenis, { wajib: true }),
        isian('Gudang', gudang, { wajib: true }),
        isian('Tanggal', tanggal, { wajib: true }),
        isian('Keterangan', ket, { penuh: true })),
      h('datalist', { id: 'dl-penyesuaian' }, barangAktif.map((b) => h('option', { value: namaKode(b) }))),
      h('h3', {}, 'Barang'),
      h('div', { class: 'tabel-wrap' }, h('table', { class: 'tabel-input' }, thead, tbody)),
      h('div', { class: 'editor-bawah' },
        h('button', { type: 'button', class: 'tombol tombol-kecil', onclick: () => tambahBaris().focus() }, '+ Tambah baris'),
        h('button', {
          type: 'button', class: 'tombol tombol-kecil', onclick: () => {
            tbody.replaceChildren(); baris = [];
            barangAktif.forEach((b) => tambahBaris(b));
          },
        }, 'Isi semua barang')),
      h('p', { class: 'catatan' }, 'Stok awal: isi qty dan HPP per unit. Stock opname: isi hasil hitung fisik, selisihnya dihitung otomatis. Baris yang kosong dilewati.')),
    kumpulkan: () => {
      const hasil = [];
      for (const r of baris) {
        if (!r.pilih.value.trim() && r.angka1.value === '') continue;
        const b = r.barang();
        if (!b) throw new Error(`Barang "${r.pilih.value}" tidak ditemukan.`);
        if (r.angka1.value === '') continue;
        const n = Number(r.angka1.value);
        if (jenis.value === 'opname') hasil.push({ barang_id: b.id, qty_fisik: n });
        else {
          if (jenis.value === 'stok_awal' && n <= 0) throw new Error(`Qty ${b.nama} harus lebih dari 0.`);
          hasil.push({ barang_id: b.id, selisih: n, hpp: r.angka2.value === '' ? null : Number(r.angka2.value) });
        }
      }
      if (!hasil.length) throw new Error('Isi minimal satu barang.');
      return { perusahaan_id: pid(), jenis: jenis.value, gudang_id: gudang.value, tanggal: tanggal.value, keterangan: ket.value || null, baris: hasil };
    },
    simpan: async (p) => {
      await rpc('simpan_penyesuaian', { p });
      toast('Penyesuaian stok tersimpan.');
      await ctx.muatUlang();
    },
  });
}

async function detailPenyesuaian(dok, ctx) {
  const baris = await q(sb.from('penyesuaian_stok_detail').select('*').eq('penyesuaian_id', dok.id));
  const tutup = bukaDetail({
    judul: 'Penyesuaian Stok',
    dok,
    info: [
      ['Jenis', JENIS_PENYESUAIAN.find((j) => j.value === dok.jenis)?.label],
      ['Gudang', ctx.gudangMap[dok.gudang_id]?.nama],
      ['Tanggal', tgl(dok.tanggal)],
      ['Keterangan', dok.keterangan],
    ],
    kolom: [
      { label: 'Barang', isi: (r) => namaBarang(ctx, r.barang_id) },
      { label: 'Stok sistem', kelas: 'kanan', isi: (r) => angka(r.qty_sistem) },
      { label: 'Stok baru', kelas: 'kanan', isi: (r) => angka(r.qty_fisik) },
      { label: 'Selisih', kelas: 'kanan', isi: (r) => `${Number(r.selisih) > 0 ? '+' : ''}${angka(r.selisih)} ${satuan(ctx, r.barang_id)}` },
      { label: 'HPP/unit', kelas: 'kanan', isi: (r) => rupiah(r.hpp) },
    ],
    baris,
    aksi: aksiKelola('penyesuaian_stok', dok, { tutupDetail: () => tutup(), muatUlang: ctx.muatUlang }),
  });
}

export const halamanPenyesuaian = halamanDaftar({
  judul: 'Stok Awal & Penyesuaian',
  deskripsi: 'Memasukkan stok awal, hasil stock opname, atau koreksi stok lain. Hanya Owner dan Admin yang bisa membuat.',
  tabel: 'penyesuaian_stok',
  siapkan: () => muatMaster('gudang', 'barang'),
  kolom: [
    { label: 'Jenis', isi: (r) => JENIS_PENYESUAIAN.find((j) => j.value === r.jenis)?.label ?? r.jenis },
    { label: 'Gudang', isi: (r, m) => m.gudangMap[r.gudang_id]?.nama ?? '-' },
    { label: 'Keterangan', isi: (r) => r.keterangan ?? '' },
  ],
  tombolBuat: () => (isKelola() ? { label: '+ Penyesuaian', aksi: formPenyesuaian } : null),
  bukaDetail: detailPenyesuaian,
});

// ===================================================================
// Pindah Gudang
// ===================================================================

async function formTransfer(ctx) {
  const aktif = ctx.gudang.filter((g) => g.aktif);
  if (aktif.length < 2) { toast('Butuh minimal dua gudang aktif.', 'error'); return; }
  let stok = await stokGudang(aktif[0].id);
  const editor = editorBaris({
    barang: ctx.barang.filter((b) => b.aktif),
    denganHarga: false,
    infoBarang: (b) => `Stok di gudang asal: ${angka(stok[b.id] ?? 0)} ${b.satuan}`,
  });
  const asal = pilihan(opsi(ctx.gudang), {
    wajib: true, nilai: aktif[0].id,
    onchange: async () => { stok = await stokGudang(asal.value); editor.el.querySelectorAll('.input-barang').forEach((i) => i.dispatchEvent(new Event('change'))); },
  });
  const tujuan = pilihan(opsi(ctx.gudang), { wajib: true, nilai: aktif[1].id });
  const tanggal = h('input', { type: 'date', value: hariIni(), required: true });
  const ket = h('textarea', { rows: 2 });

  formDokumen({
    judul: 'Pindah Barang Antar Gudang',
    badan: h('div', {},
      h('div', { class: 'form-grid form-grid-3' },
        isian('Dari Gudang', asal, { wajib: true }),
        isian('Ke Gudang', tujuan, { wajib: true }),
        isian('Tanggal', tanggal, { wajib: true }),
        isian('Keterangan', ket, { penuh: true })),
      h('h3', {}, 'Barang'),
      editor.el),
    kumpulkan: () => {
      if (asal.value === tujuan.value) throw new Error('Gudang asal dan tujuan harus berbeda.');
      return { perusahaan_id: pid(), gudang_asal: asal.value, gudang_tujuan: tujuan.value, tanggal: tanggal.value, keterangan: ket.value || null, baris: editor.ambil() };
    },
    simpan: async (p) => {
      await rpc('simpan_transfer', { p });
      toast('Barang dipindahkan.');
      await ctx.muatUlang();
    },
  });
}

async function detailTransfer(dok, ctx) {
  const baris = await q(sb.from('transfer_gudang_detail').select('*').eq('transfer_id', dok.id));
  const tutup = bukaDetail({
    judul: 'Pindah Gudang',
    dok,
    info: [
      ['Dari', ctx.gudangMap[dok.gudang_asal]?.nama],
      ['Ke', ctx.gudangMap[dok.gudang_tujuan]?.nama],
      ['Tanggal', tgl(dok.tanggal)],
      ['Keterangan', dok.keterangan],
    ],
    kolom: [
      { label: 'Barang', isi: (r) => namaBarang(ctx, r.barang_id) },
      { label: 'Qty', kelas: 'kanan', isi: (r) => `${angka(r.qty)} ${satuan(ctx, r.barang_id)}` },
    ],
    baris,
    aksi: aksiKelola('transfer_gudang', dok, { tutupDetail: () => tutup(), muatUlang: ctx.muatUlang }),
  });
}

export const halamanTransfer = halamanDaftar({
  judul: 'Pindah Gudang',
  deskripsi: 'Memindahkan barang dari satu gudang ke gudang lain. HPP tidak berubah.',
  tabel: 'transfer_gudang',
  siapkan: () => muatMaster('gudang', 'barang'),
  kolom: [
    { label: 'Dari', isi: (r, m) => m.gudangMap[r.gudang_asal]?.nama ?? '-' },
    { label: 'Ke', isi: (r, m) => m.gudangMap[r.gudang_tujuan]?.nama ?? '-' },
    { label: 'Keterangan', isi: (r) => r.keterangan ?? '' },
  ],
  tombolBuat: { label: '+ Pindah Barang', aksi: formTransfer },
  bukaDetail: detailTransfer,
});
