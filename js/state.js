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

export async function muatSesi() {
  const { data } = await sb.auth.getSession();
  state.user = data.session?.user ?? null;
  state.pengguna = null;
  state.perusahaan = null;
  state.daftarPerusahaan = [];
  if (!state.user) return;

  state.pengguna = await q(sb.from('pengguna').select('*').eq('id', state.user.id).maybeSingle());
  if (!state.pengguna || !state.pengguna.aktif) return;

  state.daftarPerusahaan = await q(sb.from('perusahaan').select('*').eq('aktif', true).order('nama'));
  if (isOwner()) {
    const simpan = bacaLokal(KUNCI_PERUSAHAAN);
    state.perusahaan = state.daftarPerusahaan.find((p) => p.id === simpan) ?? null;
  } else {
    state.perusahaan = state.daftarPerusahaan.find((p) => p.id === state.pengguna.perusahaan_id) ?? null;
  }
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
