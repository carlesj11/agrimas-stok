import { sb, q } from './db.js';

const KUNCI_PERUSAHAAN = 'perusahaan-aktif';

// Data sesi yang dipakai semua halaman.
export const state = {
  user: null,          // akun Supabase Auth
  pengguna: null,      // baris tabel pengguna (nama, peran, perusahaan_id)
  perusahaan: null,    // perusahaan yang sedang dibuka
  daftarPerusahaan: [],
};

export const isOwner = () => state.pengguna?.peran === 'owner';
export const isKelola = () => ['owner', 'admin'].includes(state.pengguna?.peran);
export const pid = () => state.perusahaan?.id;

// Isi state baru dulu, baru diganti sekaligus, supaya halaman yang sedang dibuka
// tidak sempat melihat perusahaan kosong saat sesi dimuat ulang.
export async function muatSesi() {
  const { data } = await sb.auth.getSession();
  const baru = { user: data.session?.user ?? null, pengguna: null, perusahaan: null, daftarPerusahaan: [] };
  if (baru.user) {
    baru.pengguna = await q(sb.from('pengguna').select('*').eq('id', baru.user.id).maybeSingle());
    if (baru.pengguna?.aktif) {
      baru.daftarPerusahaan = await q(sb.from('perusahaan').select('*').eq('aktif', true).order('nama'));
      const id = baru.pengguna.peran === 'owner' ? bacaLokal(KUNCI_PERUSAHAAN) : baru.pengguna.perusahaan_id;
      baru.perusahaan = baru.daftarPerusahaan.find((p) => p.id === id) ?? null;
    }
  }
  Object.assign(state, baru);
}

export function pilihPerusahaan(id) {
  state.perusahaan = state.daftarPerusahaan.find((p) => p.id === id) ?? null;
  tulisLokal(KUNCI_PERUSAHAAN, id);
}

function bacaLokal(k) {
  try { return localStorage.getItem(k); } catch { return null; }
}
function tulisLokal(k, v) {
  try { localStorage.setItem(k, v); } catch { /* abaikan */ }
}
