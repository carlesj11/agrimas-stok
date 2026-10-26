import { sb, q } from '../db.js';
import { pid } from '../state.js';
import { h, tabel, toast, angka, rupiah } from '../ui.js';
import {
  halamanDaftar, bukaDetail, aksiKelola, formDokumen, isian, pilihan, editorBaris, kotakTotal, muatMaster,
  namaKode, opsi, rpc, hariIni, tambahHari, tgl, stokGudang,
} from '../dokumen.js';

const satuan = (m, id) => m.barangMap[id]?.satuan ?? '';
const namaBarang = (m, id) => namaKode(m.barangMap[id]);
const siapkan = () => muatMaster('customer', 'sales', 'gudang', 'barang');

// ===================================================================
// Faktur Penjualan
// ===================================================================

async function formFakturJual(ctx) {
  const gudangAktif = ctx.gudang.filter((g) => g.aktif);
  if (!gudangAktif.length) { toast('Buat gudang dulu di menu Gudang.', 'error'); return; }

  let stok = await stokGudang(gudangAktif[0].id);
  const total = kotakTotal();
  const editor = editorBaris({
    barang: ctx.barang.filter((b) => b.aktif),
    hargaAwal: (b) => b.harga_jual,
    infoBarang: (b) => `Stok di gudang: ${angka(stok[b.id] ?? 0)} ${b.satuan}`,
    onUbah: (sub) => total.setSubtotal(sub),
  });

  const customer = pilihan(opsi(ctx.customer), { kosong: 'Pilih customer…', wajib: true });
  const sales = pilihan(opsi(ctx.sales), { kosong: '- Tanpa sales -' });
  const gudang = pilihan(opsi(ctx.gudang), {
    wajib: true,
    onchange: async () => { stok = await stokGudang(gudang.value); editor.el.querySelectorAll('.input-barang').forEach((i) => i.dispatchEvent(new Event('change'))); },
  });
  const bayar = pilihan([{ value: 'kredit', label: 'Kredit' }, { value: 'tunai', label: 'Tunai' }]);
  const tanggal = h('input', { type: 'date', value: hariIni(), required: true });
  const jatuhTempo = h('input', { type: 'date', value: tambahHari(hariIni(), 30), required: true });
  tanggal.addEventListener('change', () => { jatuhTempo.value = tambahHari(tanggal.value, 30); });
  const nomor = h('input', { placeholder: 'Kosongkan untuk nomor otomatis' });
  const ket = h('textarea', { rows: 2 });

  formDokumen({
    judul: 'Faktur Penjualan Baru',
    badan: h('div', {},
      h('div', { class: 'form-grid form-grid-3' },
        isian('Customer', customer, { wajib: true }),
        isian('Sales', sales),
        isian('Barang keluar dari', gudang, { wajib: true }),
        isian('Tanggal Faktur', tanggal, { wajib: true }),
        isian('Jatuh Tempo', jatuhTempo, { wajib: true, hint: 'Otomatis 30 hari dari tanggal faktur.' }),
        isian('Pembayaran', bayar),
        isian('Nomor Faktur', nomor, { hint: 'Untuk faktur tulis dari sales, ketik nomornya di sini.' }),
        isian('Keterangan', ket, { penuh: true })),
      h('h3', {}, 'Barang'),
      editor.el,
      total.el),
    kumpulkan: () => ({
      perusahaan_id: pid(), customer_id: customer.value, sales_id: sales.value || null, gudang_id: gudang.value,
      jenis_bayar: bayar.value, tanggal: tanggal.value, jatuh_tempo: jatuhTempo.value, nomor: nomor.value,
      keterangan: ket.value || null, ...total.nilai(), baris: editor.ambil(),
    }),
    simpan: async (p) => {
      const id = await rpc('simpan_faktur_penjualan', { p });
      toast('Faktur tersimpan. Stok sudah dikurangi.');
      await ctx.muatUlang();
      const dok = await q(sb.from('faktur_penjualan').select('*').eq('id', id).single());
      detailFakturJual(dok, ctx);
    },
  });
}

async function detailFakturJual(dok, ctx) {
  const baris = await q(sb.from('faktur_penjualan_detail').select('*').eq('faktur_id', dok.id).order('urutan'));
  const tutup = bukaDetail({
    judul: 'Faktur Penjualan',
    dok,
    info: [
      ['Kepada', dok.nama_customer],
      ['Alamat', dok.alamat_customer],
      ['Tanggal', tgl(dok.tanggal)],
      ['Jatuh tempo', tgl(dok.jatuh_tempo)],
      ['Sales', ctx.salesMap[dok.sales_id]?.nama],
      ['Gudang', ctx.gudangMap[dok.gudang_id]?.nama],
      ['Pembayaran', dok.jenis_bayar === 'tunai' ? 'Tunai' : 'Kredit'],
      ['Keterangan', dok.keterangan],
    ],
    kolom: [
      { label: 'Barang', isi: (r) => namaBarang(ctx, r.barang_id) },
      { label: 'Qty', kelas: 'kanan', isi: (r) => `${angka(r.qty)} ${satuan(ctx, r.barang_id)}` },
      { label: 'Harga', kelas: 'kanan', isi: (r) => rupiah(r.harga) },
      { label: 'Diskon', kelas: 'kanan', isi: (r) => [Number(r.diskon_persen) ? `${angka(r.diskon_persen)}%` : '', Number(r.diskon_nominal) ? rupiah(r.diskon_nominal) : ''].filter(Boolean).join(' + ') || '-' },
      { label: 'PPN', kelas: 'kanan', isi: (r) => (Number(r.ppn_persen) ? `${angka(r.ppn_persen)}%` : '-') },
      { label: 'Subtotal', kelas: 'kanan', isi: (r) => rupiah(r.subtotal) },
    ],
    baris,
    ringkasan: [
      ['Subtotal', rupiah(dok.subtotal)],
      Number(dok.diskon_total) && ['Diskon', `- ${rupiah(dok.diskon_total)}`],
      Number(dok.ppn_total) && ['PPN', rupiah(dok.ppn_total)],
      ['Total', rupiah(dok.total), true],
    ],
    aksi: [
      dok.status === 'aktif' && h('button', { class: 'tombol', onclick: () => { tutup(); formSJKeluar(ctx, dok.id); } }, 'Buat Surat Jalan'),
      dok.status === 'aktif' && h('button', { class: 'tombol', onclick: () => { tutup(); formReturJual(ctx, dok.id); } }, 'Retur'),
      ...aksiKelola('faktur_penjualan', dok, { tutupDetail: () => tutup(), muatUlang: ctx.muatUlang, jatuhTempo: true }),
    ],
  });
}

export const halamanFakturJual = halamanDaftar({
  judul: 'Faktur Penjualan',
  deskripsi: 'Penjualan ke customer. Stok gudang langsung berkurang saat faktur disimpan.',
  tabel: 'faktur_penjualan',
  siapkan,
  cari: (r, m) => [r.nama_customer, m.salesMap[r.sales_id]?.nama],
  kolom: [
    { label: 'Customer', isi: (r) => r.nama_customer },
    { label: 'Sales', isi: (r, m) => m.salesMap[r.sales_id]?.nama ?? '-' },
    { label: 'Jatuh Tempo', isi: (r) => tgl(r.jatuh_tempo) },
    { label: 'Total', kelas: 'kanan', isi: (r) => rupiah(r.total) },
  ],
  tombolBuat: { label: '+ Faktur Baru', aksi: formFakturJual },
  bukaDetail: detailFakturJual,
});

// Pilihan faktur aktif terbaru untuk surat jalan dan retur.
async function pilihFaktur(nilai, onchange) {
  const fj = await q(sb.from('faktur_penjualan').select('id,nomor,tanggal,nama_customer,alamat_customer,gudang_id')
    .eq('perusahaan_id', pid()).eq('status', 'aktif').order('tanggal', { ascending: false }).limit(300));
  const peta = Object.fromEntries(fj.map((f) => [f.id, f]));
  const el = pilihan(fj.map((f) => ({ value: f.id, label: `${f.nomor} · ${f.nama_customer} · ${tgl(f.tanggal)}` })), {
    kosong: 'Pilih faktur…', wajib: true, nilai: nilai ?? '', onchange: () => onchange(peta[el.value]),
  });
  return { el, peta };
}

// ===================================================================
// Surat Jalan Keluar (pengantaran barang ke customer luar kota)
// ===================================================================

async function formSJKeluar(ctx, fakturAwal) {
  const alamat = h('textarea', { rows: 2 });
  const { el: faktur, peta } = await pilihFaktur(fakturAwal, (f) => { alamat.value = f?.alamat_customer ?? ''; });
  if (fakturAwal) alamat.value = peta[fakturAwal]?.alamat_customer ?? '';
  const tanggal = h('input', { type: 'date', value: hariIni(), required: true });
  const pengirim = h('input', { placeholder: 'Nama sopir / ekspedisi' });
  const kendaraan = h('input', { placeholder: 'Nomor polisi' });
  const ket = h('textarea', { rows: 2 });

  formDokumen({
    judul: 'Surat Jalan Keluar',
    badan: h('div', { class: 'form-grid form-grid-3' },
      isian('Faktur Penjualan', faktur, { wajib: true }),
      isian('Tanggal Kirim', tanggal, { wajib: true }),
      isian('Pengirim', pengirim),
      isian('Kendaraan', kendaraan),
      isian('Alamat Kirim', alamat, { penuh: true }),
      isian('Keterangan', ket, { penuh: true })),
    kumpulkan: () => ({
      perusahaan_id: pid(), faktur_id: faktur.value, tanggal: tanggal.value, alamat_kirim: alamat.value,
      pengirim: pengirim.value || null, kendaraan: kendaraan.value || null, keterangan: ket.value || null,
    }),
    simpan: async (p) => {
      const id = await rpc('simpan_sj_keluar', { p });
      toast('Surat jalan dibuat.');
      await ctx.muatUlang();
      const dok = await q(sb.from('surat_jalan_keluar').select('*').eq('id', id).single());
      detailSJKeluar(dok, ctx);
    },
  });
}

async function detailSJKeluar(dok, ctx) {
  const fj = await q(sb.from('faktur_penjualan').select('*').eq('id', dok.faktur_id).single());
  const baris = await q(sb.from('faktur_penjualan_detail').select('*').eq('faktur_id', dok.faktur_id).order('urutan'));
  const tutup = bukaDetail({
    judul: 'Surat Jalan',
    dok,
    info: [
      ['Kepada', fj.nama_customer],
      ['Alamat kirim', dok.alamat_kirim],
      ['Tanggal', tgl(dok.tanggal)],
      ['No. faktur', fj.nomor],
      ['Pengirim', dok.pengirim],
      ['Kendaraan', dok.kendaraan],
      ['Keterangan', dok.keterangan],
    ],
    kolom: [
      { label: 'Barang', isi: (r) => namaBarang(ctx, r.barang_id) },
      { label: 'Qty', kelas: 'kanan', isi: (r) => `${angka(r.qty)} ${satuan(ctx, r.barang_id)}` },
    ],
    baris,
    aksi: aksiKelola('surat_jalan_keluar', dok, { tutupDetail: () => tutup(), muatUlang: ctx.muatUlang }),
  });
}

export const halamanSJKeluar = halamanDaftar({
  judul: 'Surat Jalan Keluar',
  deskripsi: 'Surat pengantaran barang untuk faktur penjualan. Tidak mengubah stok (stok sudah berkurang saat faktur).',
  tabel: 'surat_jalan_keluar',
  siapkan: async () => {
    const m = await siapkan();
    const fj = await q(sb.from('faktur_penjualan').select('id,nomor,nama_customer').eq('perusahaan_id', pid()));
    m.fjMap = Object.fromEntries(fj.map((f) => [f.id, f]));
    return m;
  },
  cari: (r, m) => [m.fjMap[r.faktur_id]?.nomor, m.fjMap[r.faktur_id]?.nama_customer],
  kolom: [
    { label: 'Faktur', isi: (r, m) => m.fjMap[r.faktur_id]?.nomor ?? '-' },
    { label: 'Customer', isi: (r, m) => m.fjMap[r.faktur_id]?.nama_customer ?? '-' },
    { label: 'Pengirim', isi: (r) => r.pengirim ?? '-' },
  ],
  tombolBuat: { label: '+ Surat Jalan', aksi: (ctx) => formSJKeluar(ctx) },
  bukaDetail: detailSJKeluar,
});

// ===================================================================
// Retur Penjualan
// ===================================================================

async function formReturJual(ctx, fakturAwal) {
  const wadah = h('div');
  const gudang = pilihan(opsi(ctx.gudang), { wajib: true });
  let input = [];

  const muat = async (f) => {
    input = [];
    if (!f) { wadah.replaceChildren(); return; }
    gudang.value = f.gudang_id;
    const [fd, retur] = await Promise.all([
      q(sb.from('faktur_penjualan_detail').select('*').eq('faktur_id', f.id).order('urutan')),
      q(sb.from('retur_penjualan').select('id').eq('faktur_id', f.id).eq('status', 'aktif')),
    ]);
    const rd = retur.length ? await q(sb.from('retur_penjualan_detail').select('fj_detail_id,qty').in('retur_id', retur.map((r) => r.id))) : [];
    const sudah = {};
    for (const r of rd) sudah[r.fj_detail_id] = (sudah[r.fj_detail_id] ?? 0) + Number(r.qty);
    input = fd.map((d) => ({ d, sudah: sudah[d.id] ?? 0, el: h('input', { type: 'number', min: 0, max: Number(d.qty) - (sudah[d.id] ?? 0), step: 'any', class: 'input-angka', 'aria-label': 'Qty retur' }) }));
    wadah.replaceChildren(tabel([
      { label: 'Barang', isi: (x) => namaBarang(ctx, x.d.barang_id) },
      { label: 'Terjual', kelas: 'kanan', isi: (x) => `${angka(x.d.qty)} ${satuan(ctx, x.d.barang_id)}` },
      { label: 'Sudah diretur', kelas: 'kanan', isi: (x) => angka(x.sudah) },
      { label: 'Retur sekarang', kelas: 'kanan', isi: (x) => x.el },
    ], input));
  };

  const { el: faktur, peta } = await pilihFaktur(fakturAwal, (f) => muat(f).catch((e) => toast(e.message, 'error')));
  if (fakturAwal) await muat(peta[fakturAwal]);
  const tanggal = h('input', { type: 'date', value: hariIni(), required: true });
  const ket = h('textarea', { rows: 2, placeholder: 'Alasan retur' });

  formDokumen({
    judul: 'Retur Penjualan',
    badan: h('div', {},
      h('div', { class: 'form-grid form-grid-3' },
        isian('Faktur Penjualan', faktur, { wajib: true }),
        isian('Tanggal Retur', tanggal, { wajib: true }),
        isian('Masuk ke Gudang', gudang, { wajib: true }),
        isian('Keterangan', ket, { penuh: true })),
      h('h3', {}, 'Barang yang dikembalikan customer'),
      wadah),
    kumpulkan: () => {
      const baris = input.map((x) => ({ fj_detail_id: x.d.id, qty: Number(x.el.value || 0) })).filter((b) => b.qty > 0);
      if (!baris.length) throw new Error('Isi qty retur minimal untuk satu barang.');
      return { perusahaan_id: pid(), faktur_id: faktur.value, gudang_id: gudang.value, tanggal: tanggal.value, keterangan: ket.value || null, baris };
    },
    simpan: async (p) => {
      await rpc('simpan_retur_penjualan', { p });
      toast('Retur penjualan tersimpan. Stok sudah bertambah.');
      await ctx.muatUlang();
    },
  });
}

async function detailReturJual(dok, ctx) {
  const baris = await q(sb.from('retur_penjualan_detail').select('*').eq('retur_id', dok.id));
  const fj = await q(sb.from('faktur_penjualan').select('nomor,nama_customer').eq('id', dok.faktur_id).single());
  const tutup = bukaDetail({
    judul: 'Retur Penjualan',
    dok,
    info: [
      ['Customer', fj.nama_customer],
      ['No. faktur', fj.nomor],
      ['Tanggal', tgl(dok.tanggal)],
      ['Gudang', ctx.gudangMap[dok.gudang_id]?.nama],
      ['Keterangan', dok.keterangan],
    ],
    kolom: [
      { label: 'Barang', isi: (r) => namaBarang(ctx, r.barang_id) },
      { label: 'Qty', kelas: 'kanan', isi: (r) => `${angka(r.qty)} ${satuan(ctx, r.barang_id)}` },
      { label: 'Nilai', kelas: 'kanan', isi: (r) => rupiah(r.nilai) },
    ],
    baris,
    ringkasan: [['Total retur', rupiah(dok.total), true]],
    aksi: aksiKelola('retur_penjualan', dok, { tutupDetail: () => tutup(), muatUlang: ctx.muatUlang }),
  });
}

export const halamanReturJual = halamanDaftar({
  judul: 'Retur Penjualan',
  deskripsi: 'Barang yang dikembalikan customer. Stok bertambah dan bisa dijual lagi.',
  tabel: 'retur_penjualan',
  siapkan: async () => {
    const m = await siapkan();
    const fj = await q(sb.from('faktur_penjualan').select('id,nomor,nama_customer').eq('perusahaan_id', pid()));
    m.fjMap = Object.fromEntries(fj.map((f) => [f.id, f]));
    return m;
  },
  cari: (r, m) => [m.fjMap[r.faktur_id]?.nomor, m.fjMap[r.faktur_id]?.nama_customer],
  kolom: [
    { label: 'Faktur', isi: (r, m) => m.fjMap[r.faktur_id]?.nomor ?? '-' },
    { label: 'Customer', isi: (r, m) => m.fjMap[r.faktur_id]?.nama_customer ?? '-' },
    { label: 'Total', kelas: 'kanan', isi: (r) => rupiah(r.total) },
  ],
  tombolBuat: { label: '+ Retur Penjualan', aksi: (ctx) => formReturJual(ctx) },
  bukaDetail: detailReturJual,
});
