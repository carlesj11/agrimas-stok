import { SUPABASE_URL, SUPABASE_ANON_KEY, DOMAIN_USERNAME } from './config.js';

export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export function keEmail(username) {
  const u = username.trim().toLowerCase();
  return u.includes('@') ? u : `${u}@${DOMAIN_USERNAME}`;
}

// Client terpisah tanpa sesi tersimpan, dipakai untuk mendaftarkan user baru
// supaya Owner/Admin yang sedang login tidak ikut ter-logout.
export function clientSementara() {
  return window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, storageKey: 'daftar-user-sementara' },
  });
}

// Jalankan query Supabase dan lempar error dengan pesan yang mudah dipahami.
export async function q(query) {
  const { data, error } = await query;
  if (error) throw new Error(pesanError(error));
  return data;
}

function pesanError(error) {
  const m = error.message || String(error);
  if (error.code === '23505') return 'Kode atau data yang sama sudah ada.';
  if (error.code === '23503') return 'Data ini masih dipakai di data lain, jadi tidak bisa dihapus. Nonaktifkan saja.';
  if (error.code === '42501' || /row-level security|permission denied/i.test(m)) {
    return 'Anda tidak punya hak akses untuk tindakan ini.';
  }
  if (/Invalid login credentials/i.test(m)) return 'Username atau password salah.';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Tidak bisa terhubung ke server. Periksa koneksi internet.';
  return m;
}
