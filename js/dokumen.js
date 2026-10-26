// Bantuan bersama untuk halaman dokumen transaksi (PO, faktur, retur, dll).
import { sb, q } from './db.js';
import { state, pid, isKelola } from './state.js';
import { h, tabel, modal, toast, angka, rupiah, bukaForm } from './ui.js';

// ---------- Tanggal ----------
const duaDigit = (n) => String(n).padStart(2, '0');
const isoLokal = (d) => `${d.getFullYear()}-${duaDigit(d.getMonth() + 1)}-${duaDigit(d.getDate())}`;
export const hariIni = () => isoLokal(new Date());
export const awalBulan = () => { const d = new Date(); return isoLokal(new Date(d.getFullYear(), d.getMonth(), 1)); };
export function tambahHari(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return isoLokal(new Date(y, m - 1, d + n));
}
export function tgl(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

// ---------- Perhitungan baris (sama dengan fungsi _hitung_baris di database) ----------
const bulat2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
export function hitungBaris(b) {
  const bruto = Number(b.qty || 0) * Number(b.harga || 0);
  const dpp = bulat2(bruto - bruto * Number(b.diskon_persen || 0) / 100 - Number(b.diskon_nominal || 0));
  const ppn = bulat2(dpp * Number(b.ppn_persen || 0) / 100);
  return { dpp, ppn, subtotal: bulat2(dpp + ppn) };
}

// ---------- Data master untuk pilihan dan nama ----------
export async function muatMaster(...jenis) {
  const hasil = {};
  await Promise.all(jenis.map(async (j) => {
    const kolom = {
      barang: 'id,kode,nama,satuan,harga_jual,harga_beli,hpp,aktif',
      gudang: 'id,kode,nama,aktif',
      supplier: 'id,kode,nama,aktif',
      customer: 'id,kode,nama,alamat,kota,aktif',
      sales: 'id,kode,nama,aktif',
    }[j];
    const daftar = await q(sb.from(j).select(kolom).eq('perusahaan_id', pid()).order('nama'));
    hasil[j] = daftar;
    hasil[j + 'Map'] = Object.fromEntries(daftar.map((r) => [r.id, r]));
  }));
  return hasil;
}
export const namaKode = (r) => (r ? `${r.kode} · ${r.nama}` : '-');
export const opsi = (daftar, hanyaAktif = true) =>
  daftar.filter((r) => !hanyaAktif || r.aktif).map((r) => ({ value: r.id, label: namaKode(r) }));

export async function stokGudang(gudangId) {
  const rows = await q(sb.from('stok_gudang').select('barang_id,qty').eq('gudang_id', gudangId));
  return Object.fromEntries(rows.map((r) => [r.barang_id, Number(r.qty)]));
}

// ---------- RPC ----------
export async function rpc(nama, args) {
  const { data, error } = await sb.rpc(nama, args);
  if (error) throw new Error(error.message);
  return data;
}

// ---------- Tampilan ----------
const WARNA_STATUS = {
  aktif: 'aktif', terbuka: 'aktif', sebagian: 'kuning', selesai: 'selesai', ditutup: 'nonaktif', batal: 'batal',
};
export function lencanaStatus(s) {
  return h('span', { class: `lencana lencana-${WARNA_STATUS[s] ?? 'nonaktif'}` }, s.charAt(0).toUpperCase() + s.slice(1));
}

// Halaman daftar dokumen dengan filter tanggal, cari nomor, dan status.
export function halamanDaftar(cfg) {
  const { judul, deskripsi, tabel: namaTabel, kolom, bukaDetail, siapkan, statusPilihan } = cfg;
  return async function render(konten) {
    const tombolBuat = typeof cfg.tombolBuat === 'function' ? cfg.tombolBuat() : cfg.tombolBuat;
    const ctx = siapkan ? await siapkan() : {};
    let dari = awalBulan();
    let sampai = hariIni();
    let teks = '';
    let status = '';
    let semua = [];
    const wadah = h('div');

    const muat = async () => {
      semua = await q(sb.from(namaTabel).select('*').eq('perusahaan_id', pid())
        .gte('tanggal', dari).lte('tanggal', sampai).order('tanggal', { ascending: false }).order('dibuat_pada', { ascending: false }));
      tampil();
    };
    const tampil = () => {
      const t = teks.toLowerCase();
      const baris = semua.filter((r) => (!status || r.status === status) &&
        (!t || [r.nomor, ...(cfg.cari?.(r, ctx) ?? [])].some((v) => String(v ?? '').toLowerCase().includes(t))));
      wadah.replaceChildren(
        h('p', { class: 'info-jumlah' }, `${baris.length} dokumen`),
        tabel([
          { label: 'Tanggal', isi: (r) => tgl(r.tanggal) },
          { label: 'Nomor', isi: (r) => h('a', { href: '#', onclick: (e) => { e.preventDefault(); buka(r); } }, r.nomor) },
          ...kolom.map((k) => ({ ...k, isi: (r) => k.isi(r, ctx) })),
          { label: 'Status', isi: (r) => lencanaStatus(r.status) },
        ], baris, 'Tidak ada dokumen pada periode ini.'));
    };
    const buka = (r) => bukaDetail(r, { ...ctx, muatUlang: muat });

    konten.replaceChildren(
      h('div', { class: 'kepala-halaman' },
        h('div', {}, h('h1', {}, judul), deskripsi && h('p', { class: 'deskripsi' }, deskripsi)),
        tombolBuat && h('button', { class: 'tombol tombol-utama', onclick: () => tombolBuat.aksi({ ...ctx, muatUlang: muat }) }, tombolBuat.label)),
      h('div', { class: 'saringan' },
        h('label', { class: 'saringan-tgl' }, 'Dari', h('input', { type: 'date', value: dari, onchange: (e) => { dari = e.target.value; muat(); } })),
        h('label', { class: 'saringan-tgl' }, 'Sampai', h('input', { type: 'date', value: sampai, onchange: (e) => { sampai = e.target.value; muat(); } })),
        h('input', { type: 'search', placeholder: 'Cari nomor atau nama…', 'aria-label': 'Cari', oninput: (e) => { teks = e.target.value; tampil(); } }),
        h('select', { 'aria-label': 'Status', onchange: (e) => { status = e.target.value; tampil(); } },
          h('option', { value: '' }, 'Semua status'),
          (statusPilihan ?? ['aktif', 'batal']).map((s) => h('option', { value: s }, s.charAt(0).toUpperCase() + s.slice(1))))),
      wadah);
    await muat();
  };
}

// Detail dokumen yang bisa dicetak, dengan tombol aksi.
export function bukaDetail({ judul, dok, info, kolom, baris, ringkasan = [], aksi = [], catatan }) {
  const isi = h('div', { class: 'dokumen' },
    h('div', { class: 'cetak-kop' },
      h('strong', {}, state.perusahaan.nama),
      state.perusahaan.alamat && h('div', {}, state.perusahaan.alamat),
      state.perusahaan.telepon && h('div', {}, `Telp. ${state.perusahaan.telepon}`)),
    h('div', { class: 'dokumen-kepala' },
      h('div', {}, h('div', { class: 'dokumen-jenis' }, judul), h('div', { class: 'dokumen-nomor' }, dok.nomor)),
      h('span', { class: 'tanpa-cetak' }, lencanaStatus(dok.status))),
    dok.status === 'batal' && h('p', { class: 'form-error' }, `Dibatalkan: ${dok.alasan_batal ?? ''}`),
    h('dl', { class: 'dokumen-info' }, info.filter(Boolean).flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v ?? '-')])),
    tabel(kolom, baris),
    ringkasan.length > 0 && h('dl', { class: 'dokumen-total' }, ringkasan.filter(Boolean).flatMap(([k, v, tebal]) =>
      [h('dt', { class: tebal ? 'tebal' : null }, k), h('dd', { class: tebal ? 'tebal' : null }, v)])),
    catatan && h('p', { class: 'catatan' }, catatan),
    h('div', { class: 'cetak-ttd' }, h('div', {}, 'Dibuat oleh'), h('div', {}, 'Diterima oleh')),
    h('div', { class: 'form-aksi tanpa-cetak' },
      aksi.filter(Boolean),
      h('button', { class: 'tombol', onclick: () => window.print() }, 'Cetak')));
  return modal(`${judul} ${dok.nomor}`, isi, { lebar: true });
}

// Tombol standar untuk Owner/Admin: ubah tanggal/keterangan dan batalkan.
export function aksiKelola(namaTabel, dok, { tutupDetail, muatUlang, jatuhTempo = false }) {
  if (!isKelola() || dok.status === 'batal') return [];
  return [
    h('button', {
      class: 'tombol', onclick: () => bukaForm({
        judul: `Ubah Info ${dok.nomor}`,
        nilai: dok,
        field: [
          { key: 'tanggal', label: 'Tanggal', type: 'date', required: true },
          jatuhTempo && { key: 'jatuh_tempo', label: 'Jatuh Tempo', type: 'date' },
          { key: 'keterangan', label: 'Keterangan', type: 'textarea', lebar: true },
        ].filter(Boolean),
        onSimpan: async (d) => {
          await rpc('ubah_info_dokumen', {
            p_tabel: namaTabel, p_id: dok.id, p_tanggal: d.tanggal, p_keterangan: d.keterangan, p_jatuh_tempo: d.jatuh_tempo ?? null,
          });
          toast('Info dokumen diubah.');
          tutupDetail();
          await muatUlang();
        },
      }),
    }, 'Ubah Tanggal/Keterangan'),
    h('button', {
      class: 'tombol tombol-bahaya', onclick: () => bukaForm({
        judul: `Batalkan ${dok.nomor}`,
        labelSimpan: 'Batalkan Dokumen',
        field: [{ key: 'alasan', label: 'Alasan pembatalan', type: 'textarea', required: true, lebar: true }],
        onSimpan: async (d) => {
          if (!d.alasan) throw new Error('Alasan wajib diisi.');
          await rpc('batal_dokumen', { p_tabel: namaTabel, p_id: dok.id, p_alasan: d.alasan });
          toast(`${dok.nomor} dibatalkan. Stok sudah dikembalikan.`);
          tutupDetail();
          await muatUlang();
        },
      }),
    }, 'Batalkan'),
  ];
}

// ---------- Form dokumen ----------
// Membuka form dokumen besar. `badan` adalah elemen isi form, `kumpulkan()`
// mengembalikan payload atau melempar error validasi, `simpan(payload)` menyimpan.
export function formDokumen({ judul, badan, kumpulkan, simpan, labelSimpan = 'Simpan' }) {
  const pesan = h('p', { class: 'form-error', hidden: true });
  const tombol = h('button', { class: 'tombol tombol-utama', type: 'submit' }, labelSimpan);
  let tutup;
  const form = h('form', {
    class: 'form form-dokumen',
    onsubmit: async (e) => {
      e.preventDefault();
      pesan.hidden = true;
      tombol.disabled = true;
      try {
        await simpan(kumpulkan());
        tutup();
      } catch (err) {
        pesan.textContent = err.message;
        pesan.hidden = false;
      } finally {
        tombol.disabled = false;
      }
    },
  }, badan, pesan, h('div', { class: 'form-aksi' },
    h('button', { class: 'tombol', type: 'button', onclick: () => tutup() }, 'Batal'), tombol));
  tutup = modal(judul, form, { lebar: true });
  return tutup;
}

// Satu isian berlabel untuk kepala form dokumen.
export function isian(label, el, { wajib = false, penuh = false, hint } = {}) {
  return h('div', { class: penuh ? 'form-baris form-penuh' : 'form-baris' },
    h('label', {}, h('span', {}, label, wajib && h('span', { class: 'wajib' }, ' *')), el), hint && h('small', {}, hint));
}

export function pilihan(daftarOpsi, { kosong = null, nilai = '', wajib = false, onchange } = {}) {
  return h('select', { required: wajib, onchange },
    kosong !== null && h('option', { value: '' }, kosong),
    daftarOpsi.map((o) => h('option', { value: o.value, selected: String(o.value) === String(nilai) }, o.label)));
}

let nomorDatalist = 0;

// Editor baris barang dengan harga, diskon, PPN, dan subtotal.
//   barang: daftar barang yang boleh dipilih
//   hargaAwal(b): harga bawaan saat barang dipilih
//   infoBarang(b): teks kecil di bawah nama barang (misalnya stok tersedia)
export function editorBaris({ barang, hargaAwal = (b) => b.harga_jual, infoBarang, denganHarga = true, onUbah }) {
  const idList = `dl-barang-${++nomorDatalist}`;
  const peta = new Map(barang.map((b) => [namaKode(b), b]));
  const datalist = h('datalist', { id: idList }, barang.map((b) => h('option', { value: namaKode(b) })));
  const tbody = h('tbody');
  const ringkas = h('div', { class: 'ringkas-baris' });
  const baris = [];

  const hitungUlang = () => {
    let sub = 0;
    for (const r of baris) {
      const nilai = hitungBaris(r.data());
      r.subtotal.textContent = rupiah(nilai.subtotal);
      sub += nilai.subtotal;
    }
    ringkas.textContent = denganHarga ? `Subtotal: ${rupiah(sub)}` : '';
    onUbah?.(sub);
  };

  const tambah = () => {
    const pilih = h('input', { list: idList, placeholder: 'Ketik kode atau nama barang…', 'aria-label': 'Barang', class: 'input-barang' });
    const info = h('small', { class: 'info-barang' });
    const qty = h('input', { type: 'number', min: 0, step: 'any', 'aria-label': 'Qty', class: 'input-qty' });
    const harga = h('input', { type: 'number', min: 0, step: 'any', 'aria-label': 'Harga', class: 'input-angka' });
    const dp = h('input', { type: 'number', min: 0, max: 100, step: 'any', 'aria-label': 'Diskon %', class: 'input-pendek' });
    const dn = h('input', { type: 'number', min: 0, step: 'any', 'aria-label': 'Diskon Rp', class: 'input-angka' });
    const pp = h('input', { type: 'number', min: 0, step: 'any', 'aria-label': 'PPN %', class: 'input-pendek' });
    const subtotal = h('span');
    const r = {
      barang: () => peta.get(pilih.value.trim()),
      data: () => ({
        barang_id: r.barang()?.id, qty: Number(qty.value || 0), harga: Number(harga.value || 0),
        diskon_persen: Number(dp.value || 0), diskon_nominal: Number(dn.value || 0), ppn_persen: Number(pp.value || 0),
      }),
      subtotal,
      label: () => pilih.value,
    };
    pilih.addEventListener('change', () => {
      const b = r.barang();
      pilih.classList.toggle('tidak-valid', !!pilih.value && !b);
      info.textContent = b ? (infoBarang?.(b) ?? b.satuan) : (pilih.value ? 'Barang tidak ditemukan' : '');
      if (b && denganHarga && !harga.value) harga.value = hargaAwal(b) ?? 0;
      hitungUlang();
    });
    for (const el of [qty, harga, dp, dn, pp]) el.addEventListener('input', hitungUlang);
    const tr = h('tr', {},
      h('td', { 'data-label': 'Barang' }, pilih, info),
      h('td', { 'data-label': 'Qty', class: 'kanan' }, qty),
      denganHarga && h('td', { 'data-label': 'Harga', class: 'kanan' }, harga),
      denganHarga && h('td', { 'data-label': 'Disk %', class: 'kanan' }, dp),
      denganHarga && h('td', { 'data-label': 'Disk Rp', class: 'kanan' }, dn),
      denganHarga && h('td', { 'data-label': 'PPN %', class: 'kanan' }, pp),
      denganHarga && h('td', { 'data-label': 'Subtotal', class: 'kanan' }, subtotal),
      h('td', { class: 'kol-aksi' }, h('button', {
        type: 'button', class: 'tombol tombol-kecil tombol-bahaya', 'aria-label': 'Hapus baris',
        onclick: () => { baris.splice(baris.indexOf(r), 1); tr.remove(); hitungUlang(); },
      }, '×')));
    baris.push(r);
    tbody.append(tr);
    return pilih;
  };

  const el = h('div', { class: 'editor-baris' },
    datalist,
    h('div', { class: 'tabel-wrap' }, h('table', { class: 'tabel-input' },
      h('thead', {}, h('tr', {},
        h('th', {}, 'Barang'), h('th', { class: 'kanan' }, 'Qty'),
        denganHarga && [h('th', { class: 'kanan' }, 'Harga'), h('th', { class: 'kanan' }, 'Disk %'),
          h('th', { class: 'kanan' }, 'Disk Rp'), h('th', { class: 'kanan' }, 'PPN %'), h('th', { class: 'kanan' }, 'Subtotal')],
        h('th', {}))),
      tbody)),
    h('div', { class: 'editor-bawah' },
      h('button', { type: 'button', class: 'tombol tombol-kecil', onclick: () => tambah().focus() }, '+ Tambah baris'),
      ringkas));
  tambah();

  return {
    el,
    // Ambil baris yang terisi; lempar error bila ada yang tidak valid.
    ambil() {
      const hasil = [];
      for (const r of baris) {
        const d = r.data();
        if (!r.label().trim() && !d.qty) continue;
        if (!d.barang_id) throw new Error(`Barang "${r.label()}" tidak ditemukan. Pilih dari daftar.`);
        if (!(d.qty > 0)) throw new Error(`Qty ${r.label()} harus lebih dari 0.`);
        hasil.push(denganHarga ? d : { barang_id: d.barang_id, qty: d.qty });
      }
      if (!hasil.length) throw new Error('Isi minimal satu barang.');
      return hasil;
    },
  };
}

// Total dokumen: subtotal - diskon keseluruhan + PPN keseluruhan.
export function kotakTotal() {
  const diskon = h('input', { type: 'number', min: 0, step: 'any', value: 0, class: 'input-angka', 'aria-label': 'Diskon keseluruhan' });
  const ppn = h('input', { type: 'number', min: 0, step: 'any', value: 0, class: 'input-angka', 'aria-label': 'PPN keseluruhan' });
  const total = h('strong');
  let sub = 0;
  const hitung = () => { total.textContent = rupiah(sub - Number(diskon.value || 0) + Number(ppn.value || 0)); };
  diskon.addEventListener('input', hitung);
  ppn.addEventListener('input', hitung);
  hitung();
  return {
    el: h('div', { class: 'kotak-total' },
      h('label', {}, 'Diskon keseluruhan (Rp)', diskon),
      h('label', {}, 'PPN keseluruhan (Rp)', ppn),
      h('div', {}, h('span', {}, 'Total'), total)),
    setSubtotal(n) { sub = n; hitung(); },
    nilai: () => ({ diskon_total: Number(diskon.value || 0), ppn_total: Number(ppn.value || 0) }),
  };
}

export const kolomRp = (label, key) => ({ label, kelas: 'kanan', isi: (r) => rupiah(r[key]) });
export const kolomQty = (label, key, satuan) => ({ label, kelas: 'kanan', isi: (r) => `${angka(r[key])} ${satuan?.(r) ?? ''}`.trim() });
