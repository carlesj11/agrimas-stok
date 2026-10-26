import { sb, q } from '../db.js';
import { pid, isKelola } from '../state.js';
import { h, tabel, toast, angka, rupiah, konfirmasi } from '../ui.js';
import {
  halamanDaftar, bukaDetail, aksiKelola, formDokumen, isian, pilihan, editorBaris, kotakTotal, muatMaster,
  namaKode, opsi, rpc, hariIni, tambahHari, tgl, hitungBaris,
} from '../dokumen.js';

const satuan = (m, id) => m.barangMap[id]?.satuan ?? '';
const namaBarang = (m, id) => namaKode(m.barangMap[id]);

// ===================================================================
// Purchase Order
// ===================================================================

async function siapkanPO() {
  const m = await muatMaster('supplier', 'barang', 'gudang');
  m.barangSupplier = await q(sb.from('barang_supplier').select('*').eq('perusahaan_id', pid()));
  return m;
}

function formPO(ctx) {
  const tanggal = h('input', { type: 'date', value: hariIni(), required: true });
  const jatuhTempo = h('input', { type: 'date' });
  const nomor = h('input', { placeholder: 'Kosongkan untuk nomor otomatis' });
  const ket = h('textarea', { rows: 2 });
  const total = kotakTotal();
  const wadahEditor = h('div', {}, h('p', { class: 'catatan' }, 'Pilih supplier dulu untuk menampilkan barangnya.'));
  let editor = null;

  const supplier = pilihan(opsi(ctx.supplier), {
    kosong: 'Pilih supplier…', wajib: true,
    onchange: () => {
      const dipasok = ctx.barangSupplier.filter((x) => x.supplier_id === supplier.value);
      const hargaKhusus = Object.fromEntries(dipasok.map((x) => [x.barang_id, Number(x.harga_beli)]));
      const barang = ctx.barang.filter((b) => b.aktif && b.id in hargaKhusus);
      if (!barang.length) {
        editor = null;
        wadahEditor.replaceChildren(h('p', { class: 'form-error' },
          'Supplier ini belum punya daftar barang. Atur dulu di menu Supplier → tombol Barang.'));
        return;
      }
      editor = editorBaris({
        barang,
        hargaAwal: (b) => hargaKhusus[b.id] || b.harga_beli,
        infoBarang: (b) => `Satuan ${b.satuan}`,
        onUbah: (sub) => total.setSubtotal(sub),
      });
      wadahEditor.replaceChildren(editor.el);
    },
  });

  formDokumen({
    judul: 'Purchase Order Baru',
    badan: h('div', {},
      h('div', { class: 'form-grid form-grid-3' },
        isian('Supplier', supplier, { wajib: true }),
        isian('Tanggal PO', tanggal, { wajib: true }),
        isian('Batas Pemenuhan', jatuhTempo),
        isian('Nomor PO', nomor),
        isian('Keterangan', ket, { penuh: true })),
      h('h3', {}, 'Barang'),
      wadahEditor,
      total.el),
    kumpulkan: () => {
      if (!editor) throw new Error('Pilih supplier yang punya daftar barang.');
      return {
        perusahaan_id: pid(), supplier_id: supplier.value, tanggal: tanggal.value, jatuh_tempo: jatuhTempo.value || null,
        nomor: nomor.value, keterangan: ket.value || null, ...total.nilai(), baris: editor.ambil(),
      };
    },
    simpan: async (p) => {
      const id = await rpc('simpan_po', { p });
      toast('PO tersimpan.');
      await ctx.muatUlang();
      const dok = await q(sb.from('purchase_order').select('*').eq('id', id).single());
      detailPO(dok, ctx);
    },
  });
}

async function detailPO(dok, ctx) {
  const baris = await q(sb.from('po_detail').select('*').eq('po_id', dok.id).order('urutan'));
  const bisaTerima = ['terbuka', 'sebagian'].includes(dok.status);
  const tutup = bukaDetail({
    judul: 'Purchase Order',
    dok,
    info: [
      ['Supplier', namaKode(ctx.supplierMap[dok.supplier_id])],
      ['Tanggal', tgl(dok.tanggal)],
      ['Batas pemenuhan', tgl(dok.jatuh_tempo)],
      ['Keterangan', dok.keterangan],
    ],
    kolom: [
      { label: 'Barang', isi: (r) => namaBarang(ctx, r.barang_id) },
      { label: 'Qty', kelas: 'kanan', isi: (r) => `${angka(r.qty)} ${satuan(ctx, r.barang_id)}` },
      { label: 'Diterima', kelas: 'kanan tanpa-cetak', isi: (r) => angka(r.qty_diterima) },
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
      bisaTerima && h('button', { class: 'tombol tombol-utama', onclick: () => { tutup(); formSJMasuk(ctx, dok.id); } }, 'Terima Barang'),
      bisaTerima && isKelola() && h('button', {
        class: 'tombol', onclick: async () => {
          if (!konfirmasi('Tutup PO ini? Sisa barang yang belum dikirim tidak akan ditunggu lagi.')) return;
          try { await rpc('tutup_po', { p_id: dok.id }); toast('PO ditutup.'); tutup(); await ctx.muatUlang(); } catch (e) { toast(e.message, 'error'); }
        },
      }, 'Tutup PO'),
      ...aksiKelola('purchase_order', dok, { tutupDetail: () => tutup(), muatUlang: ctx.muatUlang, jatuhTempo: true }),
    ],
  });
}

export const halamanPO = halamanDaftar({
  judul: 'Purchase Order',
  deskripsi: 'Pesanan barang ke supplier. Satu PO bisa dipenuhi dalam beberapa surat jalan.',
  tabel: 'purchase_order',
  statusPilihan: ['terbuka', 'sebagian', 'selesai', 'ditutup', 'batal'],
  siapkan: siapkanPO,
  cari: (r, m) => [m.supplierMap[r.supplier_id]?.nama],
  kolom: [
    { label: 'Supplier', isi: (r, m) => m.supplierMap[r.supplier_id]?.nama ?? '-' },
    { label: 'Batas', isi: (r) => tgl(r.jatuh_tempo) },
    { label: 'Total', kelas: 'kanan', isi: (r) => rupiah(r.total) },
  ],
  tombolBuat: { label: '+ PO Baru', aksi: formPO },
  bukaDetail: detailPO,
});

// ===================================================================
// Surat Jalan Masuk (penerimaan barang dari supplier)
// ===================================================================

async function siapkanSJ() {
  const m = await muatMaster('supplier', 'barang', 'gudang');
  const po = await q(sb.from('purchase_order').select('id,nomor,tanggal,supplier_id,status').eq('perusahaan_id', pid()).order('tanggal', { ascending: false }));
  m.po = po;
  m.poMap = Object.fromEntries(po.map((p) => [p.id, p]));
  return m;
}

async function formSJMasuk(ctx, poAwal) {
  const m = ctx.poMap ? ctx : { ...(await siapkanSJ()), muatUlang: ctx.muatUlang };
  const poTerbuka = m.po.filter((p) => ['terbuka', 'sebagian'].includes(p.status));
  const tanggal = h('input', { type: 'date', value: hariIni(), required: true });
  const nomor = h('input', { required: true, placeholder: 'Nomor surat jalan dari supplier' });
  const gudang = pilihan(opsi(m.gudang), { wajib: true });
  const ket = h('textarea', { rows: 2 });
  const wadah = h('div');
  let input = [];

  const muatPO = async (poId) => {
    input = [];
    if (!poId) { wadah.replaceChildren(); return; }
    const detail = await q(sb.from('po_detail').select('*').eq('po_id', poId).order('urutan'));
    const sisa = detail.filter((d) => Number(d.qty) > Number(d.qty_diterima));
    input = sisa.map((d) => ({ d, el: h('input', { type: 'number', min: 0, max: Number(d.qty) - Number(d.qty_diterima), step: 'any', value: Number(d.qty) - Number(d.qty_diterima), class: 'input-angka', 'aria-label': 'Qty diterima' }) }));
    wadah.replaceChildren(tabel([
      { label: 'Barang', isi: (x) => namaBarang(m, x.d.barang_id) },
      { label: 'Dipesan', kelas: 'kanan', isi: (x) => `${angka(x.d.qty)} ${satuan(m, x.d.barang_id)}` },
      { label: 'Sudah diterima', kelas: 'kanan', isi: (x) => angka(x.d.qty_diterima) },
      { label: 'Diterima sekarang', kelas: 'kanan', isi: (x) => x.el },
    ], input, 'Semua barang di PO ini sudah diterima.'));
  };

  const po = pilihan(poTerbuka.map((p) => ({ value: p.id, label: `${p.nomor} · ${m.supplierMap[p.supplier_id]?.nama ?? ''}` })), {
    kosong: poTerbuka.length ? 'Pilih PO…' : 'Tidak ada PO yang menunggu barang', wajib: true, nilai: poAwal ?? '',
    onchange: () => muatPO(po.value).catch((e) => toast(e.message, 'error')),
  });
  if (poAwal) await muatPO(poAwal);

  formDokumen({
    judul: 'Terima Barang (Surat Jalan Masuk)',
    badan: h('div', {},
      h('div', { class: 'form-grid form-grid-3' },
        isian('Purchase Order', po, { wajib: true }),
        isian('No. Surat Jalan Supplier', nomor, { wajib: true }),
        isian('Tanggal Terima', tanggal, { wajib: true }),
        isian('Masuk ke Gudang', gudang, { wajib: true }),
        isian('Keterangan', ket, { penuh: true })),
      h('h3', {}, 'Barang diterima'),
      wadah),
    kumpulkan: () => {
      const baris = input.map((x) => ({ po_detail_id: x.d.id, qty: Number(x.el.value || 0) })).filter((b) => b.qty > 0);
      if (!baris.length) throw new Error('Isi qty yang diterima minimal untuk satu barang.');
      return { perusahaan_id: pid(), po_id: po.value, nomor: nomor.value, tanggal: tanggal.value, gudang_id: gudang.value, keterangan: ket.value || null, baris };
    },
    simpan: async (p) => {
      await rpc('simpan_sj_masuk', { p });
      toast('Barang diterima. Stok dan HPP sudah diperbarui.');
      await m.muatUlang?.();
    },
  });
}

async function detailSJ(dok, ctx) {
  const baris = await q(sb.from('sj_masuk_detail').select('*').eq('sj_id', dok.id));
  const tutup = bukaDetail({
    judul: 'Surat Jalan Masuk',
    dok,
    info: [
      ['Supplier', namaKode(ctx.supplierMap[dok.supplier_id])],
      ['PO', ctx.poMap[dok.po_id]?.nomor],
      ['Tanggal terima', tgl(dok.tanggal)],
      ['Gudang', namaKode(ctx.gudangMap[dok.gudang_id])],
      ['Faktur supplier', dok.faktur_id ? 'Sudah' : 'Belum'],
      ['Keterangan', dok.keterangan],
    ],
    kolom: [
      { label: 'Barang', isi: (r) => namaBarang(ctx, r.barang_id) },
      { label: 'Qty', kelas: 'kanan', isi: (r) => `${angka(r.qty)} ${satuan(ctx, r.barang_id)}` },
      { label: 'Harga/unit', kelas: 'kanan', isi: (r) => rupiah(r.harga) },
    ],
    baris,
    aksi: [
      dok.status === 'aktif' && h('button', { class: 'tombol', onclick: () => { tutup(); formReturBeli(ctx, dok.id); } }, 'Retur ke Supplier'),
      ...aksiKelola('surat_jalan_masuk', dok, { tutupDetail: () => tutup(), muatUlang: ctx.muatUlang }),
    ],
  });
}

export const halamanSJMasuk = halamanDaftar({
  judul: 'Surat Jalan Masuk',
  deskripsi: 'Penerimaan barang dari supplier. Stok bertambah dan HPP dihitung ulang saat disimpan.',
  tabel: 'surat_jalan_masuk',
  siapkan: siapkanSJ,
  cari: (r, m) => [m.supplierMap[r.supplier_id]?.nama, m.poMap[r.po_id]?.nomor],
  kolom: [
    { label: 'Supplier', isi: (r, m) => m.supplierMap[r.supplier_id]?.nama ?? '-' },
    { label: 'PO', isi: (r, m) => m.poMap[r.po_id]?.nomor ?? '-' },
    { label: 'Gudang', isi: (r, m) => m.gudangMap[r.gudang_id]?.nama ?? '-' },
    { label: 'Faktur', isi: (r) => (r.faktur_id ? 'Sudah' : 'Belum') },
  ],
  tombolBuat: { label: '+ Terima Barang', aksi: (ctx) => formSJMasuk(ctx) },
  bukaDetail: detailSJ,
});

// ===================================================================
// Faktur Supplier
// ===================================================================

function formFakturBeli(ctx) {
  const tanggal = h('input', { type: 'date', value: hariIni(), required: true });
  const jatuhTempo = h('input', { type: 'date', value: tambahHari(hariIni(), 30), required: true });
  tanggal.addEventListener('change', () => { jatuhTempo.value = tambahHari(tanggal.value, 30); });
  const nomor = h('input', { required: true, placeholder: 'Nomor faktur dari supplier' });
  const ket = h('textarea', { rows: 2 });
  const total = kotakTotal();
  const wadahSJ = h('div');
  const wadahBaris = h('div');
  let dipilih = new Set();
  let baris = [];

  const hitung = () => {
    let sub = 0;
    for (const b of baris) {
      const n = hitungBaris(b.data());
      b.subEl.textContent = rupiah(n.subtotal);
      sub += n.subtotal;
    }
    total.setSubtotal(sub);
  };

  const muatBaris = async () => {
    baris = [];
    if (!dipilih.size) { wadahBaris.replaceChildren(); total.setSubtotal(0); return; }
    const sd = await q(sb.from('sj_masuk_detail').select('*').in('sj_id', [...dipilih]));
    const pd = await q(sb.from('po_detail').select('*').in('id', sd.map((x) => x.po_detail_id)));
    const pdMap = Object.fromEntries(pd.map((x) => [x.id, x]));
    baris = sd.map((x) => {
      const p = pdMap[x.po_detail_id];
      const inp = (v, kelas = 'input-angka') => {
        const el = h('input', { type: 'number', min: 0, step: 'any', value: v, class: kelas });
        el.addEventListener('input', hitung);
        return el;
      };
      const harga = inp(p.harga);
      const dp = inp(p.diskon_persen, 'input-pendek');
      const dn = inp(Math.round(Number(p.diskon_nominal) * Number(x.qty) / Number(p.qty) * 100) / 100);
      const pp = inp(p.ppn_persen, 'input-pendek');
      return {
        x, harga, dp, dn, pp, subEl: h('span'),
        data: () => ({ qty: x.qty, harga: harga.value, diskon_persen: dp.value, diskon_nominal: dn.value, ppn_persen: pp.value }),
      };
    });
    wadahBaris.replaceChildren(tabel([
      { label: 'Barang', isi: (b) => namaBarang(ctx, b.x.barang_id) },
      { label: 'Qty', kelas: 'kanan', isi: (b) => `${angka(b.x.qty)} ${satuan(ctx, b.x.barang_id)}` },
      { label: 'Harga', kelas: 'kanan', isi: (b) => b.harga },
      { label: 'Disk %', kelas: 'kanan', isi: (b) => b.dp },
      { label: 'Disk Rp', kelas: 'kanan', isi: (b) => b.dn },
      { label: 'PPN %', kelas: 'kanan', isi: (b) => b.pp },
      { label: 'Subtotal', kelas: 'kanan', isi: (b) => b.subEl },
    ], baris));
    hitung();
  };

  const supplier = pilihan(opsi(ctx.supplier, false), {
    kosong: 'Pilih supplier…', wajib: true,
    onchange: async () => {
      dipilih = new Set();
      await muatBaris();
      if (!supplier.value) { wadahSJ.replaceChildren(); return; }
      const sj = await q(sb.from('surat_jalan_masuk').select('*').eq('supplier_id', supplier.value)
        .eq('status', 'aktif').is('faktur_id', null).order('tanggal'));
      wadahSJ.replaceChildren(sj.length
        ? h('div', { class: 'daftar-centang' }, sj.map((s) => h('label', { class: 'form-centang' },
          h('input', { type: 'checkbox', onchange: (e) => { e.target.checked ? dipilih.add(s.id) : dipilih.delete(s.id); muatBaris().catch((er) => toast(er.message, 'error')); } }),
          `${s.nomor} · ${tgl(s.tanggal)}`)))
        : h('p', { class: 'catatan' }, 'Tidak ada surat jalan dari supplier ini yang belum difakturkan.'));
    },
  });

  formDokumen({
    judul: 'Faktur Supplier Baru',
    badan: h('div', {},
      h('div', { class: 'form-grid form-grid-3' },
        isian('Supplier', supplier, { wajib: true }),
        isian('No. Faktur Supplier', nomor, { wajib: true }),
        isian('Tanggal Faktur', tanggal, { wajib: true }),
        isian('Jatuh Tempo', jatuhTempo, { wajib: true, hint: 'Otomatis 30 hari dari tanggal faktur.' }),
        isian('Keterangan', ket, { penuh: true })),
      h('h3', {}, 'Surat jalan yang ditagih'),
      wadahSJ,
      wadahBaris,
      h('p', { class: 'catatan' }, 'Harga di faktur dianggap final. Bila berbeda dari harga PO, HPP barang ikut disesuaikan.'),
      total.el),
    kumpulkan: () => {
      if (!baris.length) throw new Error('Pilih minimal satu surat jalan.');
      return {
        perusahaan_id: pid(), supplier_id: supplier.value, nomor: nomor.value, tanggal: tanggal.value, jatuh_tempo: jatuhTempo.value,
        keterangan: ket.value || null, sj_ids: [...dipilih], ...total.nilai(),
        baris: baris.map((b) => ({ sj_detail_id: b.x.id, ...b.data() })),
      };
    },
    simpan: async (p) => {
      await rpc('simpan_faktur_pembelian', { p });
      toast('Faktur supplier tersimpan.');
      await ctx.muatUlang();
    },
  });
}

async function detailFakturBeli(dok, ctx) {
  const [baris, sj] = await Promise.all([
    q(sb.from('faktur_pembelian_detail').select('*').eq('faktur_id', dok.id)),
    q(sb.from('surat_jalan_masuk').select('nomor').eq('faktur_id', dok.id)),
  ]);
  const tutup = bukaDetail({
    judul: 'Faktur Supplier',
    dok,
    info: [
      ['Supplier', namaKode(ctx.supplierMap[dok.supplier_id])],
      ['Tanggal', tgl(dok.tanggal)],
      ['Jatuh tempo', tgl(dok.jatuh_tempo)],
      ['Surat jalan', sj.map((s) => s.nomor).join(', ') || '-'],
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
    aksi: aksiKelola('faktur_pembelian', dok, { tutupDetail: () => tutup(), muatUlang: ctx.muatUlang, jatuhTempo: true }),
  });
}

export const halamanFakturBeli = halamanDaftar({
  judul: 'Faktur Supplier',
  deskripsi: 'Tagihan dari supplier atas barang yang sudah diterima. Perhitungan hutang menyusul di tahap keuangan.',
  tabel: 'faktur_pembelian',
  siapkan: () => muatMaster('supplier', 'barang'),
  cari: (r, m) => [m.supplierMap[r.supplier_id]?.nama],
  kolom: [
    { label: 'Supplier', isi: (r, m) => m.supplierMap[r.supplier_id]?.nama ?? '-' },
    { label: 'Jatuh Tempo', isi: (r) => tgl(r.jatuh_tempo) },
    { label: 'Total', kelas: 'kanan', isi: (r) => rupiah(r.total) },
  ],
  tombolBuat: { label: '+ Faktur Supplier', aksi: formFakturBeli },
  bukaDetail: detailFakturBeli,
});

// ===================================================================
// Retur Pembelian
// ===================================================================

async function formReturBeli(ctx, sjAwal) {
  const m = ctx.poMap ? ctx : { ...(await siapkanSJ()), muatUlang: ctx.muatUlang };
  const tanggal = h('input', { type: 'date', value: hariIni(), required: true });
  const ket = h('textarea', { rows: 2, placeholder: 'Alasan retur' });
  const wadah = h('div');
  let input = [];

  const sjAktif = await q(sb.from('surat_jalan_masuk').select('id,nomor,tanggal,supplier_id').eq('perusahaan_id', pid())
    .eq('status', 'aktif').order('tanggal', { ascending: false }).limit(300));

  const muatSJ = async (sjId) => {
    input = [];
    if (!sjId) { wadah.replaceChildren(); return; }
    const [sd, retur] = await Promise.all([
      q(sb.from('sj_masuk_detail').select('*').eq('sj_id', sjId)),
      q(sb.from('retur_pembelian').select('id').eq('sj_id', sjId).eq('status', 'aktif')),
    ]);
    const rd = retur.length ? await q(sb.from('retur_pembelian_detail').select('sj_detail_id,qty').in('retur_id', retur.map((r) => r.id))) : [];
    const sudah = {};
    for (const r of rd) sudah[r.sj_detail_id] = (sudah[r.sj_detail_id] ?? 0) + Number(r.qty);
    input = sd.map((d) => ({ d, sudah: sudah[d.id] ?? 0, el: h('input', { type: 'number', min: 0, max: Number(d.qty) - (sudah[d.id] ?? 0), step: 'any', class: 'input-angka', 'aria-label': 'Qty retur' }) }));
    wadah.replaceChildren(tabel([
      { label: 'Barang', isi: (x) => namaBarang(m, x.d.barang_id) },
      { label: 'Diterima', kelas: 'kanan', isi: (x) => `${angka(x.d.qty)} ${satuan(m, x.d.barang_id)}` },
      { label: 'Sudah diretur', kelas: 'kanan', isi: (x) => angka(x.sudah) },
      { label: 'Retur sekarang', kelas: 'kanan', isi: (x) => x.el },
    ], input));
  };

  const sj = pilihan(sjAktif.map((s) => ({ value: s.id, label: `${s.nomor} · ${m.supplierMap[s.supplier_id]?.nama ?? ''} · ${tgl(s.tanggal)}` })), {
    kosong: 'Pilih surat jalan…', wajib: true, nilai: sjAwal ?? '',
    onchange: () => muatSJ(sj.value).catch((e) => toast(e.message, 'error')),
  });
  if (sjAwal) await muatSJ(sjAwal);

  formDokumen({
    judul: 'Retur Pembelian',
    badan: h('div', {},
      h('div', { class: 'form-grid form-grid-3' },
        isian('Surat Jalan Masuk', sj, { wajib: true }),
        isian('Tanggal Retur', tanggal, { wajib: true }),
        isian('Keterangan', ket, { penuh: true })),
      h('h3', {}, 'Barang yang dikembalikan'),
      wadah,
      h('p', { class: 'catatan' }, 'Barang keluar dari gudang tempat surat jalan diterima.')),
    kumpulkan: () => {
      const baris = input.map((x) => ({ sj_detail_id: x.d.id, qty: Number(x.el.value || 0) })).filter((b) => b.qty > 0);
      if (!baris.length) throw new Error('Isi qty retur minimal untuk satu barang.');
      return { perusahaan_id: pid(), sj_id: sj.value, tanggal: tanggal.value, keterangan: ket.value || null, baris };
    },
    simpan: async (p) => {
      await rpc('simpan_retur_pembelian', { p });
      toast('Retur pembelian tersimpan. Stok sudah dikurangi.');
      await m.muatUlang?.();
    },
  });
}

async function detailReturBeli(dok, ctx) {
  const baris = await q(sb.from('retur_pembelian_detail').select('*').eq('retur_id', dok.id));
  const sj = await q(sb.from('surat_jalan_masuk').select('nomor').eq('id', dok.sj_id).maybeSingle());
  const tutup = bukaDetail({
    judul: 'Retur Pembelian',
    dok,
    info: [
      ['Supplier', namaKode(ctx.supplierMap[dok.supplier_id])],
      ['Surat jalan', sj?.nomor],
      ['Tanggal', tgl(dok.tanggal)],
      ['Gudang', namaKode(ctx.gudangMap[dok.gudang_id])],
      ['Keterangan', dok.keterangan],
    ],
    kolom: [
      { label: 'Barang', isi: (r) => namaBarang(ctx, r.barang_id) },
      { label: 'Qty', kelas: 'kanan', isi: (r) => `${angka(r.qty)} ${satuan(ctx, r.barang_id)}` },
      { label: 'Harga/unit', kelas: 'kanan', isi: (r) => rupiah(r.harga) },
    ],
    baris,
    ringkasan: [['Nilai retur', rupiah(dok.total), true]],
    aksi: aksiKelola('retur_pembelian', dok, { tutupDetail: () => tutup(), muatUlang: ctx.muatUlang }),
  });
}

export const halamanReturBeli = halamanDaftar({
  judul: 'Retur Pembelian',
  deskripsi: 'Barang yang dikembalikan ke supplier. Stok berkurang dari gudang penerima.',
  tabel: 'retur_pembelian',
  siapkan: siapkanSJ,
  cari: (r, m) => [m.supplierMap[r.supplier_id]?.nama],
  kolom: [
    { label: 'Supplier', isi: (r, m) => m.supplierMap[r.supplier_id]?.nama ?? '-' },
    { label: 'Gudang', isi: (r, m) => m.gudangMap[r.gudang_id]?.nama ?? '-' },
    { label: 'Nilai', kelas: 'kanan', isi: (r) => rupiah(r.total) },
  ],
  tombolBuat: { label: '+ Retur Pembelian', aksi: (ctx) => formReturBeli(ctx) },
  bukaDetail: detailReturBeli,
});

