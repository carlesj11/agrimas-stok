import { sb, q } from '../db.js';
import { state, pid } from '../state.js';
import { h, tabel, toast, angka, rupiah } from '../ui.js';
import { muatMaster, namaKode, opsi, pilihan, rpc, hariIni, awalBulan, tgl } from '../dokumen.js';

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
      const kepala = data.kolom.map((k) => k.label);
      const isi = data.baris.map((r) => data.kolom.map((k) => {
        const v = k.nilai(r);
        return ['rp', 'qty'].includes(k.jenis) ? Number(v ?? 0) : (k.jenis === 'tgl' ? tgl(v) : v ?? '');
      }));
      const totalBaris = data.kolom.some((k) => k.jumlah)
        ? [data.kolom.map((k, i) => (k.jumlah ? data.baris.reduce((n, r) => n + Number(k.nilai(r) ?? 0), 0) : (i === 0 ? 'TOTAL' : '')))]
        : [];
      const ws = XLSX.utils.aoa_to_sheet([[`${judul} - ${state.perusahaan.nama}`], [keteranganFilter()], [], kepala, ...isi, ...totalBaris]);
      ws['!cols'] = kepala.map((k, i) => ({ wch: Math.max(k.length, ...isi.map((r) => String(r[i]).length)) + 2 }));
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

const labelTgl = (teks, el) => h('label', { class: 'saringan-tgl' }, teks, el);
const inputTgl = (v) => h('input', { type: 'date', value: v });
const teksPilihan = (sel) => sel.options[sel.selectedIndex]?.text ?? '';

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
  const m = await muatMaster('customer', 'sales');
  const mode = pilihan([{ value: 'faktur', label: 'Per faktur' }, { value: 'barang', label: 'Rekap per barang' }]);
  const dari = inputTgl(awalBulan());
  const sampai = inputTgl(hariIni());
  const customer = pilihan(opsi(m.customer, false), { kosong: 'Semua customer' });
  const sales = pilihan(opsi(m.sales, false), { kosong: 'Semua sales' });

  await kerangka(konten, {
    judul: 'Laporan Penjualan',
    deskripsi: 'Faktur penjualan aktif dalam periode. Rekap per barang sudah dikurangi retur.',
    filter: [mode, labelTgl('Dari', dari), labelTgl('Sampai', sampai), customer, sales],
    keteranganFilter: () => `${tgl(dari.value)} s/d ${tgl(sampai.value)} · ${teksPilihan(customer)} · ${teksPilihan(sales)}`,
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
      let query = sb.from('faktur_penjualan').select('*').eq('perusahaan_id', pid()).eq('status', 'aktif')
        .gte('tanggal', dari.value).lte('tanggal', sampai.value).order('tanggal').order('nomor');
      if (customer.value) query = query.eq('customer_id', customer.value);
      if (sales.value) query = query.eq('sales_id', sales.value);
      return {
        baris: await q(query),
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

// ===================================================================
// Laporan Pembelian
// ===================================================================

export async function halamanLaporanPembelian(konten) {
  const m = await muatMaster('supplier');
  const mode = pilihan([{ value: 'faktur', label: 'Per faktur supplier' }, { value: 'barang', label: 'Rekap barang diterima' }]);
  const dari = inputTgl(awalBulan());
  const sampai = inputTgl(hariIni());
  const supplier = pilihan(opsi(m.supplier, false), { kosong: 'Semua supplier' });

  await kerangka(konten, {
    judul: 'Laporan Pembelian',
    deskripsi: 'Faktur supplier dalam periode, atau rekap barang yang diterima lewat surat jalan.',
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
            { label: 'Qty Diterima', jenis: 'qty', nilai: (r) => Number(r.qty_diterima) },
            { label: 'Qty Retur', jenis: 'qty', nilai: (r) => Number(r.qty_retur) },
            { label: 'Nilai Diterima', jenis: 'rp', nilai: (r) => Number(r.nilai_diterima), jumlah: true },
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
