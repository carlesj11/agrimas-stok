// Cetakan faktur penjualan: setengah A4 (21 × 14,875 cm), mengikuti bentuk faktur lama.
import { state } from './state.js';
import { h } from './ui.js';

const UKURAN = '210mm 148.75mm';
const fmt = new Intl.NumberFormat('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const uang = (n) => fmt.format(Number(n ?? 0));
const fmtQty = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 3 });
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

function tanggalPanjang(iso) {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${Number(d)} ${BULAN[Number(m) - 1]} ${y}`;
}

const isian = (label, nilai) => h('tr', {}, h('td', { class: 'lf-label' }, label), h('td', {}, `: ${nilai ?? ''}`));

export function lembarFakturJual(dok, baris, ctx) {
  const prsh = state.perusahaan;
  const cust = ctx.customerMap?.[dok.customer_id];
  const dpp = baris.reduce((n, r) => n + Number(r.dpp), 0);
  const ppn = baris.reduce((n, r) => n + Number(r.ppn), 0) + Number(dok.ppn_total);
  const diskon = Number(dok.diskon_total);
  const persen = dpp ? (diskon / dpp) * 100 : 0;

  const rincian = baris.map((r, i) => {
    const qty = Number(r.qty);
    const net = Number(r.dpp) / qty;
    return h('tr', {},
      h('td', { class: 'kanan' }, i + 1),
      h('td', {}, ctx.barangMap?.[r.barang_id]?.nama ?? ''),
      h('td', { class: 'kanan' }, fmtQty.format(qty)),
      h('td', { class: 'kanan' }, uang(r.harga)),
      h('td', { class: 'kanan' }, uang(Number(r.harga) - net)),
      h('td', { class: 'kanan' }, uang(net)),
      h('td', { class: 'kanan' }, uang(r.dpp)));
  });

  return h('div', { class: 'lembar-cetak lembar-faktur' },
    h('div', { class: 'lf-kepala' },
      h('div', { class: 'lf-kotak' },
        h('div', { class: 'lf-judul' }, 'Customer'),
        h('table', {},
          isian('Nama', dok.nama_customer),
          isian('Alamat', cust ? cust.alamat : dok.alamat_customer),
          isian('Kota', cust?.kota))),
      h('div', { class: 'lf-logo' }, prsh.logo ? h('img', { src: prsh.logo, alt: prsh.nama }) : h('strong', {}, prsh.nama)),
      h('div', { class: 'lf-kotak' },
        h('div', { class: 'lf-judul tengah' }, 'Penjualan'),
        h('table', {},
          isian('No. Bukti', dok.nomor),
          isian('Tanggal', tanggalPanjang(dok.tanggal)),
          isian('Salesman', ctx.salesMap?.[dok.sales_id]?.nama ?? '')))),
    dok.status === 'batal' && h('div', { class: 'lf-batal' }, 'BATAL'),
    h('table', { class: 'lf-rincian' },
      h('thead', {}, h('tr', {},
        h('th', {}, 'No'), h('th', { class: 'kiri' }, 'Keterangan'), h('th', {}, 'Qty'), h('th', {}, 'Harga @'),
        h('th', {}, 'Disc @'), h('th', {}, 'Harga@Net'), h('th', {}, 'Harga'))),
      h('tbody', {}, rincian)),
    h('div', { class: 'lf-bawah' },
      h('div', { class: 'lf-ket' }, `Keterangan : ${dok.keterangan ?? ''}`),
      h('table', { class: 'lf-total' },
        h('tr', {}, h('td', {}, 'Subtotal'), h('td', {}, uang(dpp))),
        h('tr', {}, h('td', {}, `Discount ${uang(persen)} %`), h('td', { class: 'garis' }, uang(diskon))),
        ppn > 0 && h('tr', {}, h('td', {}, 'PPN'), h('td', {}, uang(ppn))),
        h('tr', { class: 'tebal' }, h('td', {}, 'Total'), h('td', { class: 'garis-ganda' }, uang(dok.total))))),
    h('div', { class: 'lf-ttd' },
      h('div', {}, h('div', {}, 'Tanda Terima,'), h('div', { class: 'lf-kurung' }, h('span', {}, '('), h('span', {}, ')'))),
      h('div', {}, h('div', {}, 'Hormat Kami,'), h('div', { class: 'lf-kurung' }, h('span', {}, '('), h('span', {}, ')')))),
    prsh.catatan_faktur && h('div', { class: 'lf-catatan' }, h('div', {}, 'Perhatian :'), h('div', {}, prsh.catatan_faktur)));
}

// Cetak satu lembar khusus dengan ukuran kertasnya sendiri, lalu bersihkan lagi.
export function cetakLembar(lembar, ukuran = UKURAN) {
  document.querySelectorAll('.lembar-cetak, style[data-cetak]').forEach((el) => el.remove());
  const gaya = h('style', { 'data-cetak': '' }, `@page { size: ${ukuran}; margin: 6mm 9mm; }`);
  document.head.append(gaya);
  document.body.append(lembar);
  document.body.classList.add('cetak-khusus');
  const bersihkan = () => {
    gaya.remove();
    lembar.remove();
    document.body.classList.remove('cetak-khusus');
    window.removeEventListener('afterprint', bersihkan);
  };
  window.addEventListener('afterprint', bersihkan);
  window.print();
}

export const cetakFakturJual = (dok, baris, ctx) => cetakLembar(lembarFakturJual(dok, baris, ctx));
