import { sb, q, keEmail, clientSementara } from '../db.js';
import { state, pid, isOwner, muatSesi } from '../state.js';
import { h, tabel, bukaForm, toast, lencana } from '../ui.js';

const NAMA_PERAN = { owner: 'Owner', admin: 'Admin', user: 'User' };

export async function halamanPerusahaan(konten) {
  const wadah = h('div');
  const muat = async () => {
    const daftar = await q(sb.from('perusahaan').select('*').order('nama'));
    wadah.replaceChildren(tabel([
      { label: 'Kode', isi: (r) => r.kode },
      { label: 'Nama', isi: (r) => r.nama },
      { label: 'Telepon', isi: (r) => r.telepon ?? '' },
      { label: 'Status', isi: (r) => lencana(r.aktif) },
      { label: '', kelas: 'kol-aksi', isi: (r) => h('button', { class: 'tombol tombol-kecil', onclick: () => formulir(r) }, 'Ubah') },
    ], daftar));
  };

  const formulir = (r) => bukaForm({
    judul: r ? 'Ubah Perusahaan' : 'Tambah Perusahaan',
    nilai: r ?? {},
    field: [
      { key: 'kode', label: 'Singkatan', required: true, hint: 'Dipakai di penomoran dokumen, misalnya PAP.' },
      { key: 'nama', label: 'Nama Perusahaan', required: true },
      { key: 'alamat', label: 'Alamat', type: 'textarea', lebar: true },
      { key: 'telepon', label: 'Telepon' },
      { key: 'npwp', label: 'NPWP' },
      { key: 'aktif', label: 'Aktif', type: 'checkbox' },
    ],
    onSimpan: async (data) => {
      data.kode = data.kode.toUpperCase();
      if (r) await q(sb.from('perusahaan').update(data).eq('id', r.id));
      else await q(sb.from('perusahaan').insert(data));
      toast('Perusahaan tersimpan.');
      await muatSesi();
      await muat();
    },
  });

  konten.replaceChildren(
    h('div', { class: 'kepala-halaman' },
      h('div', {}, h('h1', {}, 'Perusahaan'),
        h('p', { class: 'deskripsi' }, 'Setiap perusahaan punya data barang, gudang, supplier, customer, dan stok sendiri yang tidak saling terlihat.')),
      isOwner() && h('button', { class: 'tombol tombol-utama', onclick: () => formulir(null) }, '+ Tambah Perusahaan')),
    wadah);
  await muat();
}

export async function halamanPengguna(konten) {
  const wadah = h('div');
  const opsiPeran = () => (isOwner() ? ['admin', 'user', 'owner'] : ['admin', 'user'])
    .map((p) => ({ value: p, label: NAMA_PERAN[p] }));

  const muat = async () => {
    let query = sb.from('pengguna').select('*').order('nama');
    query = isOwner() ? query.or(`perusahaan_id.eq.${pid()},peran.eq.owner`) : query.eq('perusahaan_id', pid());
    const daftar = await q(query);
    wadah.replaceChildren(tabel([
      { label: 'Username', isi: (r) => r.username },
      { label: 'Nama', isi: (r) => r.nama },
      { label: 'Peran', isi: (r) => NAMA_PERAN[r.peran] },
      { label: 'Status', isi: (r) => lencana(r.aktif) },
      {
        label: '', kelas: 'kol-aksi', isi: (r) => (r.id !== state.user.id && (isOwner() || r.peran !== 'owner')) &&
          h('button', { class: 'tombol tombol-kecil', onclick: () => ubah(r) }, 'Ubah'),
      },
    ], daftar));
  };

  const tambah = () => bukaForm({
    judul: `Tambah User · ${state.perusahaan.nama}`,
    field: [
      { key: 'username', label: 'Username', required: true, hint: 'Huruf kecil, angka, titik, atau garis bawah.' },
      { key: 'nama', label: 'Nama Lengkap', required: true },
      { key: 'password', label: 'Password', type: 'password', required: true, hint: 'Minimal 6 karakter.' },
      { key: 'peran', label: 'Peran', type: 'select', required: true, options: opsiPeran(), bawaan: 'user' },
    ],
    onSimpan: async (data) => {
      const username = data.username.toLowerCase();
      if (!/^[a-z0-9._]{3,}$/.test(username)) throw new Error('Username minimal 3 karakter: huruf kecil, angka, titik, atau garis bawah.');
      if (data.password.length < 6) throw new Error('Password minimal 6 karakter.');

      const { data: hasil, error } = await clientSementara().auth.signUp({ email: keEmail(username), password: data.password });
      if (error) throw new Error(/registered/i.test(error.message) ? 'Username ini sudah dipakai.' : error.message);
      if (!hasil.user || hasil.user.identities?.length === 0) throw new Error('Username ini sudah dipakai.');

      await q(sb.from('pengguna').insert({
        id: hasil.user.id,
        username,
        nama: data.nama,
        peran: data.peran,
        perusahaan_id: data.peran === 'owner' ? null : pid(),
      }));
      if (!hasil.session) {
        toast('User dibuat, tetapi belum bisa login: matikan "Confirm email" di pengaturan Supabase.', 'error');
      } else {
        toast(`User ${username} dibuat.`);
      }
      await muat();
    },
  });

  const ubah = (r) => bukaForm({
    judul: `Ubah User · ${r.username}`,
    nilai: r,
    field: [
      { key: 'nama', label: 'Nama Lengkap', required: true },
      { key: 'peran', label: 'Peran', type: 'select', required: true, options: opsiPeran(), hanyaBaca: r.peran === 'owner' },
      { key: 'aktif', label: 'Aktif (bisa login)', type: 'checkbox' },
    ],
    onSimpan: async (data) => {
      if (data.peran === 'owner') data.perusahaan_id = null;
      await q(sb.from('pengguna').update(data).eq('id', r.id));
      toast('User tersimpan.');
      await muat();
    },
  });

  konten.replaceChildren(
    h('div', { class: 'kepala-halaman' },
      h('div', {}, h('h1', {}, 'User'),
        h('p', { class: 'deskripsi' }, `User untuk ${state.perusahaan.nama}. Akun Admin dan User hanya bisa membuka perusahaan ini.`)),
      h('button', { class: 'tombol tombol-utama', onclick: tambah }, '+ Tambah User')),
    wadah,
    h('p', { class: 'catatan' }, 'Lupa password: user bisa mengganti passwordnya sendiri lewat menu akun di pojok kanan atas. Bila benar-benar lupa, Owner bisa mengatur ulang dari dashboard Supabase (Authentication → Users).'));
  await muat();
}

export function gantiPassword() {
  bukaForm({
    judul: 'Ganti Password',
    field: [
      { key: 'baru', label: 'Password Baru', type: 'password', required: true },
      { key: 'ulang', label: 'Ulangi Password Baru', type: 'password', required: true },
    ],
    onSimpan: async ({ baru, ulang }) => {
      if (baru.length < 6) throw new Error('Password minimal 6 karakter.');
      if (baru !== ulang) throw new Error('Kedua password tidak sama.');
      const { error } = await sb.auth.updateUser({ password: baru });
      if (error) throw new Error(error.message);
      toast('Password diganti.');
    },
  });
}
