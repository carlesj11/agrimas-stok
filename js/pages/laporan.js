import { sb, q } from '../db.js';
import { state, pid } from '../state.js';
import { h, tabel, toast, angka, rupiah } from '../ui.js';
import { muatMaster, namaKode, opsi, pilihan, pilihKetik, rpc, hariIni, awalBulan, tgl } from '../dokumen.js';

const URL_XLSX = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';

function muatXlsx() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return new Promise((ok, gagal) => {
    const s = document.createElement('script');
    s.src = URL_XLSX;
    s.onload = () => ok(window.XLSX);
    s.onerror = () => gagal(new Error('Gagal memuat modul Excel. Periksa koneksi internet.'));
    document.head.append(s);
  });
}

// Kolom laporan: { label, nilai(r) -> angka/teks mentah, jenis: 'rp' | 'qty' | 'tgl', jumlah: true, kelas }
const tampilNilai = (k, r) => {
  const v = k.nilai(r);
  if (k.jenis === 'rp') return rupiah(v);
  if (k.jenis === 'qty') return angka(v);
  if (k.jenis === 'tgl') return tgl(v);
  return v ?? '';
};

// Kerangka halaman laporan: filter, tabel dengan baris total, export Excel, dan cetak/PDF.
function kerangka(konten, { judul, deskripsi, filter, muat, keteranganFilter }) {
  const hasil = h('div', {}, h('p', { class: 'memuat' }, 'Memuat…'));
  const subjudul = h('div');
  let data = { kolom: [], baris: [] };

  const segarkan = async () => {
    hasil.replaceChildren(h('p', { class: 'memuat' }, 'Memuat…'));
    try {
      data = await muat();
      subjudul.textContent = keteranganFilter();
      if (data.render) {
        hasil.replaceChildren(h('p', { class: 'info-jumlah' }, data.info), data.render());
        return;
      }
      const adaJumlah = data.kolom.some((k) => k.jumlah);
      const total = Object.fromEntries(data.kolom.filter((k) => k.jumlah)
        .map((k) => [k.label, data.baris.reduce((n, r) => n + Number(k.nilai(r) ?? 0), 0)]));
      hasil.replaceChildren(
        h('p', { class: 'info-jumlah' }, `${data.baris.length} baris`),
        tabel(data.kolom.map((k) => ({ label: k.label, kelas: k.kelas ?? (['rp', 'qty'].includes(k.jenis) ? 'kanan' : null), isi: (r) => tampilNilai(k, r) })),
          data.baris, 'Tidak ada data untuk filter ini.'),
        adaJumlah && data.baris.length > 0 && h('dl', { class: 'dokumen-total' },
          data.kolom.filter((k) => k.jumlah).flatMap((k) => [
            h('dt', { class: 'tebal' }, `Total ${k.label.toLowerCase()}`),
            h('dd', { class: 'tebal' }, k.jenis === 'rp' ? rupiah(total[k.label]) : angka(total[k.label]))])));
    } catch (e) {
      hasil.replaceChildren(h('p', { class: 'form-error' }, e.message));
    }
  };

  const exportExcel = async () => {
    try {
      const XLSX = await muatXlsx();
      const kepala = (data.kolom ?? []).map((k) => k.label);
      const isi = (data.baris ?? []).map((r) => data.kolom.map((k) => {
        const v = k.nilai(r);
        return ['rp', 'qty'].includes(k.jenis) ? Number(v ?? 0) : (k.jenis === 'tgl' ? tgl(v) : v ?? '');
      }));
      const totalBaris = data.kolom?.some((k) => k.jumlah)
        ? [data.kolom.map((k, i) => (k.jumlah ? data.baris.reduce((n, r) => n + Number(k.nilai(r) ?? 0), 0) : (i === 0 ? 'TOTAL' : '')))]
        : [];
      const tabelSheet = data.aoa ?? [kepala, ...isi, ...totalBaris];
      const ws = XLSX.utils.aoa_to_sheet([[`${judul} - ${state.perusahaan.nama}`], [keteranganFilter()], [], ...tabelSheet]);
      const lebarKolom = Math.max(...tabelSheet.map((r) => r.length));
      ws['!cols'] = Array.from({ length: lebarKolom }, (_, i) => ({ wch: Math.min(Math.max(...tabelSheet.map((r) => String(r[i] ?? '').length)) + 2, 60) }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, judul.slice(0, 31));
      XLSX.writeFile(wb, `${judul} ${state.perusahaan.kode} ${hariIni()}.xlsx`);
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  for (const el of filter.flat()) {
    el.querySelectorAll?.('input,select').forEach((i) => i.addEventListener('change', segarkan));
    if (['INPUT', 'SELECT'].includes(el.tagName)) el.addEventListener('change', segarkan);
  }

  konten.replaceChildren(
    h('div', { class: 'cetak-kop' }, h('strong', {}, state.perusahaan.nama), h('div', {}, judul), subjudul),
    h('div', { class: 'kepala-halaman' },
      h('div', {}, h('h1', {}, judul), deskripsi && h('p', { class: 'deskripsi' }, deskripsi)),
      h('div', { class: 'aksi-baris tanpa-cetak' },
        h('button', { class: 'tombol', onclick: exportExcel }, 'Export Excel'),
        h('button', { class: 'tombol', onclick: () => window.print() }, 'Cetak / PDF'))),
    h('div', { class: 'saringan' }, filter),
    hasil);
  return segarkan();
}

// Ambil semua baris walau melebihi batas 1000 baris per permintaan ke Supabase.
async function semua(buatQuery) {
  const hasil = [];
  for (let i = 0; ; i += 1000) {
    const rows = await q(buatQuery().range(i, i + 999));
    hasil.push(...rows);
    if (rows.length < 1000) return hasil;
  }
}

const labelTgl = (teks, el) => h('label', { class: 'saringan-tgl' }, teks, el);
const inputTgl = (v) => h('input', { type: 'date', value: v });
const teksPilihan = (sel) => sel.options[sel.selectedIndex]?.text ?? '';

// Saringan yang bisa diketik (kode atau nama) atau dipilih dari daftar. Kosong = semua.
// Laporan dimuat ulang begitu pilihan cocok dengan daftar atau isian dikosongkan.
function saringKetik(daftarOpsi, { semua, label }) {
  const p = pilihKetik(daftarOpsi, { placeholder: `${semua} (ketik untuk mencari)`, label });
  const input = p.el.querySelector('input');
  input.type = 'search';
  input.setAttribute('aria-label', label);
  p.el.className = 'saring-ketik';
  let terakhir = '';
  input.addEventListener('change', (e) => {
    const teks = input.value.trim();
    if (!input.checkValidity()) { e.stopImmediatePropagation(); input.reportValidity(); return; }
    if (teks === terakhir) { e.stopImmediatePropagation(); return; }
    terakhir = teks;
  });
  const kirim = () => input.dispatchEvent(new Event('change'));
  input.addEventListener('input', () => { if (p.nilai() || !input.value.trim()) kirim(); });
  return {
    el: p.el,
    get value() { return p.nilai(); },
    teks: () => (p.nilai() ? input.value.trim() : semua),
  };
}

// ===================================================================
// Laporan Stok
// ===================================================================

export async function halamanLaporanStok(konten) {
  const m = await muatMaster('gudang');
  const tanggal = inputTgl(hariIni());
  const gudang = pilihan(opsi(m.gudang, false), { kosong: 'Semua gudang' });
  const cari = h('input', { type: 'search', placeholder: 'Cari kode atau nama…', 'aria-label': 'Cari' });
  const sembunyi = h('input', { type: 'checkbox', checked: true });

  await kerangka(konten, {
    judul: 'Laporan Stok',
    deskripsi: 'Posisi stok pada akhir tanggal yang dipilih. Nilai persediaan memakai HPP rata-rata saat ini.',
    filter: [labelTgl('Per tanggal', tanggal), gudang, cari, h('label', { class: 'form-centang saringan-centang' }, sembunyi, 'Sembunyikan stok 0')],
    keteranganFilter: () => `Per ${tgl(tanggal.value)} · ${teksPilihan(gudang)}`,
    muat: async () => {
      const rows = await rpc('laporan_stok', { p_pid: pid(), p_tanggal: tanggal.value, p_gudang: gudang.value || null });
      const t = cari.value.trim().toLowerCase();
      return {
        baris: rows.filter((r) => (!sembunyi.checked || Number(r.qty) !== 0) &&
          (!t || `${r.kode} ${r.nama}`.toLowerCase().includes(t))),
        kolom: [
          { label: 'Kode', nilai: (r) => r.kode },
          { label: 'Nama Barang', nilai: (r) => r.nama },
          { label: 'Satuan', nilai: (r) => r.satuan },
          { label: 'Qty', jenis: 'qty', nilai: (r) => Number(r.qty), jumlah: false },
          { label: 'HPP', jenis: 'rp', nilai: (r) => Number(r.hpp) },
          { label: 'Nilai', jenis: 'rp', nilai: (r) => Number(r.nilai), jumlah: true },
          { label: 'Keterangan', nilai: (r) => (Number(r.stok_minimum) > 0 && Number(r.qty) < Number(r.stok_minimum) ? 'Di bawah minimum' : '') },
        ],
      };
    },
  });
  cari.addEventListener('input', () => cari.dispatchEvent(new Event('change')));
}

// ===================================================================
// Laporan Penjualan
// ===================================================================

export async function halamanLaporanPenjualan(konten) {
  const m = await muatMaster('customer', 'sales', 'barang');
  const mode = pilihan([{ value: 'faktur', label: 'Per faktur' }, { value: 'detail', label: 'Detail per faktur' },
    { value: 'barang', label: 'Rekap per barang' }]);
  const dari = inputTgl(awalBulan());
  const sampai = inputTgl(hariIni());
  const customer = saringKetik(opsi(m.customer, false), { semua: 'Semua customer', label: 'customer' });
  const sales = pilihan(opsi(m.sales, false), { kosong: 'Semua sales' });

  await kerangka(konten, {
    judul: 'Laporan Penjualan',
    deskripsi: 'Faktur penjualan aktif dalam periode. Rekap per barang sudah dikurangi retur.',
    filter: [mode, labelTgl('Dari', dari), labelTgl('Sampai', sampai), customer.el, sales],
    keteranganFilter: () => `${tgl(dari.value)} s/d ${tgl(sampai.value)} · ${customer.teks()} · ${teksPilihan(sales)}`,
    muat: async () => {
      if (mode.value === 'barang') {
        const rows = await rpc('laporan_penjualan_barang', {
          p_pid: pid(), p_dari: dari.value, p_sampai: sampai.value, p_customer: customer.value || null, p_sales: sales.value || null,
        });
        return {
          baris: rows,
          kolom: [
            { label: 'Kode', nilai: (r) => r.kode },
            { label: 'Nama Barang', nilai: (r) => r.nama },
            { label: 'Satuan', nilai: (r) => r.satuan },
            { label: 'Qty Jual', jenis: 'qty', nilai: (r) => Number(r.qty_jual) },
            { label: 'Qty Retur', jenis: 'qty', nilai: (r) => Number(r.qty_retur) },
            { label: 'Qty Bersih', jenis: 'qty', nilai: (r) => Number(r.qty_bersih) },
            { label: 'Nilai Bersih', jenis: 'rp', nilai: (r) => Number(r.nilai_bersih), jumlah: true },
          ],
        };
      }
      const queryFaktur = () => {
        let query = sb.from('faktur_penjualan').select('*').eq('perusahaan_id', pid()).eq('status', 'aktif')
          .gte('tanggal', dari.value).lte('tanggal', sampai.value).order('tanggal').order('nomor').order('id');
        if (customer.value) query = query.eq('customer_id', customer.value);
        if (sales.value) query = query.eq('sales_id', sales.value);
        return query;
      };
      if (mode.value === 'detail') {
        const faktur = await semua(queryFaktur);
        const detail = [];
        for (let i = 0; i < faktur.length; i += 100) {
          const ids = faktur.slice(i, i + 100).map((f) => f.id);
          detail.push(...await semua(() => sb.from('faktur_penjualan_detail').select('*').in('faktur_id', ids).order('faktur_id').order('urutan')));
        }
        return laporanDetailPenjualan(faktur, detail, m);
      }
      return {
        baris: await semua(queryFaktur),
        kolom: [
          { label: 'Tanggal', jenis: 'tgl', nilai: (r) => r.tanggal },
          { label: 'Nomor', nilai: (r) => r.nomor },
          { label: 'Customer', nilai: (r) => r.nama_customer },
          { label: 'Sales', nilai: (r) => m.salesMap[r.sales_id]?.nama ?? '' },
          { label: 'Bayar', nilai: (r) => (r.jenis_bayar === 'tunai' ? 'Tunai' : 'Kredit') },
          { label: 'Jatuh Tempo', jenis: 'tgl', nilai: (r) => r.jatuh_tempo },
          { label: 'Total', jenis: 'rp', nilai: (r) => Number(r.total), jumlah: true },
        ],
      };
    },
  });
}

// Detail per faktur: kepala faktur, rincian barang, lalu Sub Total, Diskon, PPN, dan Total.
const fmtDua = new Intl.NumberFormat('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dua = (n) => fmtDua.format(Number(n ?? 0));

function laporanDetailPenjualan(faktur, detail, m) {
  const perFaktur = new Map();
  for (const d of detail) {
    if (!perFaktur.has(d.faktur_id)) perFaktur.set(d.faktur_id, []);
    perFaktur.get(d.faktur_id).push(d);
  }
  const blok = faktur.map((f) => {
    const baris = (perFaktur.get(f.id) ?? []).map((d) => ({
      nama: m.barangMap[d.barang_id]?.nama ?? '',
      qty: Number(d.qty),
      harga: Number(d.harga),
      diskon: Number(d.harga) - Number(d.dpp) / Number(d.qty),
      total: Number(d.dpp),
    }));
    return {
      f,
      sales: m.salesMap[f.sales_id]?.nama ?? '',
      baris,
      ringkas: [
        ['Sub Total', baris.reduce((n, r) => n + r.total, 0)],
        ['Diskon', Number(f.diskon_total)],
        ['PPN', (perFaktur.get(f.id) ?? []).reduce((n, d) => n + Number(d.ppn), 0) + Number(f.ppn_total)],
        ['Total', Number(f.total)],
      ],
    };
  });
  const grand = blok.reduce((n, b) => n + Number(b.f.total), 0);

  const render = () => {
    if (!blok.length) return h('p', { class: 'kosong' }, 'Tidak ada data untuk filter ini.');
    const ringkas = ([label, nilai]) => h('tr', { class: label === 'Total' ? 'lap-ringkas tebal' : 'lap-ringkas' },
      h('td', { colspan: 5 }), h('td', {}, label), h('td', { class: 'kanan' }, dua(nilai)));
    return h('div', { class: 'tabel-wrap lap-detail' },
      h('table', {},
        h('thead', {},
          h('tr', {}, h('th', {}, 'Tanggal'), h('th', {}, 'No.'), h('th', {}, 'Sales'), h('th', {}, 'Customer'), h('th', { colspan: 3 }, 'Keterangan')),
          h('tr', {}, h('th', { colspan: 3, class: 'lap-indent' }, 'Nama Stok'), h('th', { class: 'kanan' }, 'Qty'),
            h('th', { class: 'kanan' }, 'Harga@'), h('th', { class: 'kanan' }, 'Diskon@'), h('th', { class: 'kanan' }, 'Total'))),
        blok.map((b) => h('tbody', {},
          h('tr', { class: 'lap-kepala' }, h('td', {}, tgl(b.f.tanggal)), h('td', {}, b.f.nomor), h('td', {}, b.sales),
            h('td', {}, b.f.nama_customer ?? ''), h('td', { colspan: 3 }, b.f.keterangan ?? '')),
          b.baris.map((r) => h('tr', {},
            h('td', { colspan: 3, class: 'lap-indent' }, r.nama), h('td', { class: 'kanan' }, angka(r.qty)),
            h('td', { class: 'kanan' }, dua(r.harga)), h('td', { class: 'kanan' }, dua(r.diskon)), h('td', { class: 'kanan' }, dua(r.total)))),
          b.ringkas.map(ringkas))),
        h('tfoot', {}, h('tr', { class: 'tebal' },
          h('td', { colspan: 5 }, `Total ${blok.length} faktur`), h('td', {}, 'Total'), h('td', { class: 'kanan' }, dua(grand))))));
  };

  const aoa = [
    ['Tanggal', 'No.', 'Sales', 'Customer', 'Keterangan'],
    ['Nama Stok', '', '', 'Qty', 'Harga@', 'Diskon@', 'Total'],
    ...blok.flatMap((b) => [
      [],
      [tgl(b.f.tanggal), b.f.nomor, b.sales, b.f.nama_customer ?? '', b.f.keterangan ?? ''],
      ...b.baris.map((r) => [r.nama, '', '', r.qty, r.harga, r.diskon, r.total]),
      ...b.ringkas.map(([label, nilai]) => ['', '', '', '', '', label, nilai]),
    ]),
    [],
    [`Total ${blok.length} faktur`, '', '', '', '', 'Total', grand],
  ];
  return { render, aoa, info: `${blok.length} faktur` };
}

// ===================================================================
// Laporan Pembelian
// ===================================================================

export async function halamanLaporanPembelian(konten) {
  const m = await muatMaster('supplier');
  const mode = pilihan([{ value: 'faktur', label: 'Per faktur supplier' }, { value: 'barang', label: 'Rekap per barang' }]);
  const dari = inputTgl(awalBulan());
  const sampai = inputTgl(hariIni());
  const supplier = pilihan(opsi(m.supplier, false), { kosong: 'Semua supplier' });

  await kerangka(konten, {
    judul: 'Laporan Pembelian',
    deskripsi: 'Faktur supplier dalam periode, atau rekap barang yang dibeli per barang.',
    filter: [mode, labelTgl('Dari', dari), labelTgl('Sampai', sampai), supplier],
    keteranganFilter: () => `${tgl(dari.value)} s/d ${tgl(sampai.value)} · ${teksPilihan(supplier)}`,
    muat: async () => {
      if (mode.value === 'barang') {
        const rows = await rpc('laporan_pembelian_barang', { p_pid: pid(), p_dari: dari.value, p_sampai: sampai.value, p_supplier: supplier.value || null });
        return {
          baris: rows,
          kolom: [
            { label: 'Kode', nilai: (r) => r.kode },
            { label: 'Nama Barang', nilai: (r) => r.nama },
            { label: 'Satuan', nilai: (r) => r.satuan },
            { label: 'Qty Dibeli', jenis: 'qty', nilai: (r) => Number(r.qty_diterima) },
            { label: 'Qty Retur', jenis: 'qty', nilai: (r) => Number(r.qty_retur) },
            { label: 'Nilai Dibeli', jenis: 'rp', nilai: (r) => Number(r.nilai_diterima), jumlah: true },
            { label: 'Nilai Retur', jenis: 'rp', nilai: (r) => Number(r.nilai_retur), jumlah: true },
          ],
        };
      }
      let query = sb.from('faktur_pembelian').select('*').eq('perusahaan_id', pid()).eq('status', 'aktif')
        .gte('tanggal', dari.value).lte('tanggal', sampai.value).order('tanggal').order('nomor');
      if (supplier.value) query = query.eq('supplier_id', supplier.value);
      return {
        baris: await q(query),
        kolom: [
          { label: 'Tanggal', jenis: 'tgl', nilai: (r) => r.tanggal },
          { label: 'No. Faktur', nilai: (r) => r.nomor },
          { label: 'Supplier', nilai: (r) => m.supplierMap[r.supplier_id]?.nama ?? '' },
          { label: 'Jatuh Tempo', jenis: 'tgl', nilai: (r) => r.jatuh_tempo },
          { label: 'Total', jenis: 'rp', nilai: (r) => Number(r.total), jumlah: true },
        ],
      };
    },
  });
}

// ===================================================================
// PO Belum Terpenuhi
// ===================================================================

export async function halamanLaporanPO(konten) {
  const m = await muatMaster('supplier', 'barang');
  const supplier = pilihan(opsi(m.supplier, false), { kosong: 'Semua supplier' });

  await kerangka(konten, {
    judul: 'PO Belum Terpenuhi',
    deskripsi: 'Barang yang sudah dipesan tetapi belum diterima seluruhnya.',
    filter: [supplier],
    keteranganFilter: () => `Per ${tgl(hariIni())} · ${teksPilihan(supplier)}`,
    muat: async () => {
      let query = sb.from('purchase_order').select('*').eq('perusahaan_id', pid()).in('status', ['terbuka', 'sebagian']).order('tanggal');
      if (supplier.value) query = query.eq('supplier_id', supplier.value);
      const po = await q(query);
      const poMap = Object.fromEntries(po.map((p) => [p.id, p]));
      const detail = po.length ? await q(sb.from('po_detail').select('*').in('po_id', po.map((p) => p.id)).order('urutan')) : [];
      const hari = hariIni();
      return {
        baris: detail.filter((d) => Number(d.qty) > Number(d.qty_diterima))
          .map((d) => ({ ...d, po: poMap[d.po_id] }))
          .sort((a, b) => a.po.tanggal.localeCompare(b.po.tanggal) || a.po.nomor.localeCompare(b.po.nomor)),
        kolom: [
          { label: 'Tanggal PO', jenis: 'tgl', nilai: (r) => r.po.tanggal },
          { label: 'No. PO', nilai: (r) => r.po.nomor },
          { label: 'Supplier', nilai: (r) => m.supplierMap[r.po.supplier_id]?.nama ?? '' },
          { label: 'Barang', nilai: (r) => namaKode(m.barangMap[r.barang_id]) },
          { label: 'Dipesan', jenis: 'qty', nilai: (r) => Number(r.qty) },
          { label: 'Diterima', jenis: 'qty', nilai: (r) => Number(r.qty_diterima) },
          { label: 'Sisa', jenis: 'qty', nilai: (r) => Number(r.qty) - Number(r.qty_diterima) },
          { label: 'Batas', jenis: 'tgl', nilai: (r) => r.po.jatuh_tempo },
          { label: 'Keterangan', nilai: (r) => (r.po.jatuh_tempo && r.po.jatuh_tempo < hari ? 'Lewat batas' : '') },
        ],
      };
    },
  });
}

// ===================================================================
// Sisa Pembelian Sementara
// ===================================================================

export async function halamanLaporanSementara(konten) {
  const m = await muatMaster('supplier', 'barang', 'gudang');
  const mode = pilihan([{ value: 'dokumen', label: 'Per dokumen' }, { value: 'barang', label: 'Rekap per mitra dan barang' }]);
  const mitra = pilihan(opsi(m.supplier, false), { kosong: 'Semua mitra' });

  await kerangka(konten, {
    judul: 'Sisa Pembelian Sementara',
    deskripsi: 'Barang dari mitra yang masih tercatat sebagai pembelian sementara (belum dibeli resmi dari supplier).',
    filter: [mode, mitra],
    keteranganFilter: () => `Per ${tgl(hariIni())} · ${teksPilihan(mitra)}`,
    muat: async () => {
      const dok = await semua(() => {
        let query = sb.from('pembelian_sementara').select('*').eq('perusahaan_id', pid()).eq('status', 'aktif').order('tanggal').order('nomor');
        if (mitra.value) query = query.eq('mitra_id', mitra.value);
        return query;
      });
      const dokMap = Object.fromEntries(dok.map((d) => [d.id, d]));
      const detail = [];
      for (let i = 0; i < dok.length; i += 100) {
        const ids = dok.slice(i, i + 100).map((d) => d.id);
        detail.push(...await semua(() => sb.from('pembelian_sementara_detail').select('*').in('pbs_id', ids).order('urutan')));
      }
      const barang = (r) => m.barangMap[r.barang_id];
      if (mode.value === 'barang') {
        const rekap = new Map();
        for (const d of detail) {
          const k = `${dokMap[d.pbs_id].mitra_id}|${d.barang_id}`;
          const r = rekap.get(k) ?? { mitra_id: dokMap[d.pbs_id].mitra_id, barang_id: d.barang_id, qty: 0, nilai: 0 };
          r.qty += Number(d.qty); r.nilai += Number(d.subtotal);
          rekap.set(k, r);
        }
        return {
          baris: [...rekap.values()].sort((a, b) => (m.supplierMap[a.mitra_id]?.nama ?? '').localeCompare(m.supplierMap[b.mitra_id]?.nama ?? '')
            || (barang(a)?.nama ?? '').localeCompare(barang(b)?.nama ?? '')),
          kolom: [
            { label: 'Mitra', nilai: (r) => m.supplierMap[r.mitra_id]?.nama ?? '' },
            { label: 'Kode', nilai: (r) => barang(r)?.kode ?? '' },
            { label: 'Nama Barang', nilai: (r) => barang(r)?.nama ?? '' },
            { label: 'Satuan', nilai: (r) => barang(r)?.satuan ?? '' },
            { label: 'Qty', jenis: 'qty', nilai: (r) => r.qty },
            { label: 'Nilai', jenis: 'rp', nilai: (r) => r.nilai, jumlah: true },
          ],
        };
      }
      return {
        baris: detail.map((d) => ({ ...d, dok: dokMap[d.pbs_id] }))
          .sort((a, b) => a.dok.tanggal.localeCompare(b.dok.tanggal) || a.dok.nomor.localeCompare(b.dok.nomor) || a.urutan - b.urutan),
        kolom: [
          { label: 'Tanggal', jenis: 'tgl', nilai: (r) => r.dok.tanggal },
          { label: 'Nomor', nilai: (r) => r.dok.nomor },
          { label: 'Mitra', nilai: (r) => m.supplierMap[r.dok.mitra_id]?.nama ?? '' },
          { label: 'Gudang', nilai: (r) => m.gudangMap[r.dok.gudang_id]?.nama ?? '' },
          { label: 'Barang', nilai: (r) => namaKode(barang(r)) },
          { label: 'Qty', jenis: 'qty', nilai: (r) => Number(r.qty) },
          { label: 'Harga', jenis: 'rp', nilai: (r) => Number(r.harga) },
          { label: 'Nilai', jenis: 'rp', nilai: (r) => Number(r.subtotal), jumlah: true },
        ],
      };
    },
  });
}
