import { sb, keEmail } from './db.js';
import { state, muatSesi, pilihPerusahaan, isOwner, isKelola } from './state.js';
import { h, toast } from './ui.js';
import { halamanBeranda } from './pages/beranda.js';
import { halamanBarang, halamanSupplier, halamanCustomer, halamanSales, halamanGudang } from './pages/master.js';
import { halamanPerusahaan, halamanPengguna, gantiPassword } from './pages/pengaturan.js';

const app = document.getElementById('app');

// Menu samping. "segera" = dikerjakan di tahap berikutnya.
const MENU = [
  { grup: null, item: [{ rute: 'beranda', label: 'Beranda', render: halamanBeranda }] },
  {
    grup: 'Master Data', item: [
      { rute: 'barang', label: 'Barang', render: halamanBarang },
      { rute: 'supplier', label: 'Supplier', render: halamanSupplier },
      { rute: 'customer', label: 'Customer', render: halamanCustomer },
      { rute: 'sales', label: 'Sales', render: halamanSales },
      { rute: 'gudang', label: 'Gudang', render: halamanGudang },
    ],
  },
  {
    grup: 'Pembelian', item: [
      { label: 'Purchase Order', segera: true },
      { label: 'Surat Jalan Masuk', segera: true },
      { label: 'Faktur Supplier', segera: true },
      { label: 'Retur Pembelian', segera: true },
    ],
  },
  {
    grup: 'Penjualan', item: [
      { label: 'Faktur Penjualan', segera: true },
      { label: 'Surat Jalan Keluar', segera: true },
      { label: 'Retur Penjualan', segera: true },
    ],
  },
  {
    grup: 'Stok', item: [
      { label: 'Kartu Stok', segera: true },
      { label: 'Stok Awal & Penyesuaian', segera: true },
    ],
  },
  { grup: 'Laporan', item: [{ label: 'Laporan', segera: true }] },
  {
    grup: 'Pengaturan', item: [
      { rute: 'perusahaan', label: 'Perusahaan', render: halamanPerusahaan, syarat: isOwner },
      { rute: 'pengguna', label: 'User', render: halamanPengguna, syarat: isKelola },
    ],
  },
];

const semuaRute = () => MENU.flatMap((g) => g.item).filter((i) => i.rute && (!i.syarat || i.syarat()));

async function mulai() {
  try {
    await muatSesi();
  } catch (e) {
    toast(e.message, 'error');
  }
  tampil();
}

function tampil() {
  if (!state.user) return layarLogin();
  if (!state.pengguna || !state.pengguna.aktif) return layarTanpaAkses();
  if (!state.perusahaan) return isOwner() ? layarPilihPerusahaan() : layarTanpaAkses();
  layarAplikasi();
}

function layarLogin() {
  const pesan = h('p', { class: 'form-error', hidden: true });
  const tombol = h('button', { class: 'tombol tombol-utama tombol-penuh', type: 'submit' }, 'Masuk');
  const username = h('input', { id: 'username', required: true, autocomplete: 'username', autocapitalize: 'none' });
  const password = h('input', { id: 'password', type: 'password', required: true, autocomplete: 'current-password' });

  app.replaceChildren(h('main', { class: 'layar-tengah' },
    h('form', {
      class: 'kartu kartu-login',
      onsubmit: async (e) => {
        e.preventDefault();
        tombol.disabled = true;
        pesan.hidden = true;
        const { error } = await sb.auth.signInWithPassword({ email: keEmail(username.value), password: password.value });
        tombol.disabled = false;
        if (error) {
          pesan.textContent = /Invalid login/i.test(error.message) ? 'Username atau password salah.' : error.message;
          pesan.hidden = false;
          return;
        }
        await mulai();
      },
    },
    h('h1', {}, 'Manajemen Stok'),
    h('p', { class: 'deskripsi' }, 'CV Agrimas Perkasa'),
    h('div', { class: 'form-baris' }, h('label', { for: 'username' }, 'Username'), username),
    h('div', { class: 'form-baris' }, h('label', { for: 'password' }, 'Password'), password),
    pesan,
    tombol)));
  username.focus();
}

function layarTanpaAkses() {
  app.replaceChildren(h('main', { class: 'layar-tengah' },
    h('div', { class: 'kartu kartu-login' },
      h('h1', {}, 'Akun belum aktif'),
      h('p', {}, 'Akun ini belum terdaftar sebagai user perusahaan, atau sudah dinonaktifkan. Hubungi Admin atau Owner.'),
      h('button', { class: 'tombol tombol-penuh', onclick: keluar }, 'Keluar'))));
}

function layarPilihPerusahaan() {
  app.replaceChildren(h('main', { class: 'layar-tengah' },
    h('div', { class: 'kartu kartu-login' },
      h('h1', {}, 'Pilih Perusahaan'),
      h('p', { class: 'deskripsi' }, `Halo, ${state.pengguna.nama}. Perusahaan mana yang mau dibuka?`),
      state.daftarPerusahaan.length
        ? h('div', { class: 'daftar-pilih' }, state.daftarPerusahaan.map((p) =>
          h('button', { class: 'tombol tombol-penuh', onclick: () => { pilihPerusahaan(p.id); location.hash = '#/beranda'; tampil(); } },
            h('strong', {}, p.kode), ` · ${p.nama}`)))
        : h('p', {}, 'Belum ada perusahaan aktif.'),
      h('button', { class: 'tombol tombol-teks', onclick: keluar }, 'Keluar'))));
}

function layarAplikasi() {
  const konten = h('main', { class: 'konten', id: 'konten', onclick: () => shell.classList.remove('menu-terbuka') });
  const nav = h('nav', { class: 'menu', 'aria-label': 'Menu utama' });
  const shell = h('div', { class: 'shell' });

  const menuAkun = h('div', { class: 'menu-akun', hidden: true },
    h('button', { class: 'tombol tombol-teks', onclick: () => { menuAkun.hidden = true; gantiPassword(); } }, 'Ganti password'),
    h('button', { class: 'tombol tombol-teks', onclick: keluar }, 'Keluar'));

  const header = h('header', { class: 'atas' },
    h('button', { class: 'tombol-ikon tombol-menu', 'aria-label': 'Buka menu', onclick: () => shell.classList.toggle('menu-terbuka') }, '☰'),
    h('div', { class: 'nama-perusahaan' },
      h('strong', {}, state.perusahaan.nama),
      isOwner() &&
        h('button', { class: 'tombol tombol-kecil', onclick: () => { pilihPerusahaan(''); tampil(); } }, 'Ganti')),
    h('div', { class: 'akun' },
      h('button', { class: 'tombol tombol-teks', onclick: () => { menuAkun.hidden = !menuAkun.hidden; } },
        `${state.pengguna.nama} · ${state.pengguna.peran}`),
      menuAkun));

  nav.append(...MENU.map((g) => {
    const item = g.item.filter((i) => !i.syarat || i.syarat());
    if (!item.length) return '';
    return h('div', { class: 'menu-grup' },
      g.grup && h('div', { class: 'menu-judul' }, g.grup),
      item.map((i) => i.segera
        ? h('span', { class: 'menu-item menu-segera', title: 'Segera hadir' }, i.label, h('small', {}, 'segera'))
        : h('a', { class: 'menu-item', href: `#/${i.rute}`, 'data-rute': i.rute }, i.label)));
  }));

  shell.append(header, nav, konten);
  app.replaceChildren(shell);
  bukaRute();
}

async function bukaRute() {
  const konten = document.getElementById('konten');
  if (!konten) return;
  const nama = location.hash.replace(/^#\/?/, '') || 'beranda';
  const rute = semuaRute().find((r) => r.rute === nama) ?? semuaRute()[0];
  document.querySelectorAll('.menu-item[data-rute]').forEach((a) =>
    a.classList.toggle('aktif', a.dataset.rute === rute.rute));
  document.querySelector('.shell')?.classList.remove('menu-terbuka');
  document.title = `${rute.label} · Manajemen Stok`;
  // Setiap kunjungan dapat wadah baru, jadi halaman lama yang selesai dimuat
  // belakangan tidak menimpa halaman yang sedang dibuka.
  const wadah = h('div', {}, h('p', { class: 'memuat' }, 'Memuat…'));
  konten.replaceChildren(wadah);
  try {
    await rute.render(wadah);
  } catch (e) {
    wadah.replaceChildren(h('div', { class: 'kartu' }, h('h2', {}, 'Gagal memuat halaman'), h('p', { class: 'form-error' }, e.message)));
  }
}

async function keluar() {
  await sb.auth.signOut();
  location.hash = '';
  await mulai();
}

window.addEventListener('hashchange', bukaRute);
mulai();
