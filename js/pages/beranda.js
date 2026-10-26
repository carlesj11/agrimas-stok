import { sb, q } from '../db.js';
import { state, pid } from '../state.js';
import { h, tabel, angka } from '../ui.js';

export async function halamanBeranda(konten) {
  const hitung = async (t) => {
    const { count, error } = await sb.from(t).select('id', { count: 'exact', head: true })
      .eq('perusahaan_id', pid()).eq('aktif', true);
    if (error) throw new Error(error.message);
    return count ?? 0;
  };

  const [nBarang, nSupplier, nCustomer, nGudang, barang, stok] = await Promise.all([
    hitung('barang'), hitung('supplier'), hitung('customer'), hitung('gudang'),
    q(sb.from('barang').select('id,kode,nama,satuan,stok_minimum').eq('perusahaan_id', pid()).eq('aktif', true).gt('stok_minimum', 0)),
    q(sb.from('stok_gudang').select('barang_id,qty').eq('perusahaan_id', pid())),
  ]);

  const total = {};
  for (const s of stok) total[s.barang_id] = (total[s.barang_id] ?? 0) + Number(s.qty);
  const menipis = barang
    .map((b) => ({ ...b, stok: total[b.id] ?? 0 }))
    .filter((b) => b.stok < Number(b.stok_minimum))
    .sort((a, b) => a.stok - b.stok);

  const kotak = (label, n, rute) => h('a', { class: 'kotak-angka', href: `#/${rute}` }, h('small', {}, label), h('strong', {}, angka(n)));

  konten.replaceChildren(
    h('div', { class: 'kepala-halaman' },
      h('div', {}, h('h1', {}, 'Beranda'), h('p', { class: 'deskripsi' }, `${state.perusahaan.kode} · ${state.perusahaan.nama}`))),
    h('div', { class: 'grid-angka' },
      kotak('Barang aktif', nBarang, 'barang'),
      kotak('Supplier', nSupplier, 'supplier'),
      kotak('Customer', nCustomer, 'customer'),
      kotak('Gudang', nGudang, 'gudang')),
    nGudang === 0 ? h('div', { class: 'kartu kartu-info' },
      h('strong', {}, 'Langkah awal: '),
      'buat minimal satu gudang di menu Gudang, lalu isi daftar barang, supplier, dan customer.') : '',
    h('h2', {}, 'Stok di bawah minimum'),
    tabel([
      { label: 'Kode', isi: (b) => b.kode },
      { label: 'Nama', isi: (b) => b.nama },
      { label: 'Stok', kelas: 'kanan', isi: (b) => `${angka(b.stok)} ${b.satuan}` },
      { label: 'Minimum', kelas: 'kanan', isi: (b) => `${angka(b.stok_minimum)} ${b.satuan}` },
    ], menipis, 'Tidak ada barang di bawah stok minimum.'),
  );
}
