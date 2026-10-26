# Manajemen Stok CV Agrimas Perkasa

Aplikasi web manajemen stok untuk beberapa anak perusahaan. Setiap perusahaan punya data barang, gudang, supplier, customer, dan stok sendiri yang tidak saling terlihat.

- Tampilan: HTML, CSS, dan JavaScript biasa (tanpa build).
- Database dan login: [Supabase](https://supabase.com) (paket gratis).
- Hosting: situs statis (GitHub Pages atau Netlify).

## Status

| Tahap | Isi | Status |
|---|---|---|
| 1 | Desain data dan aturan stok | Selesai |
| 2 | Login, multi-perusahaan, gudang, master data (barang, supplier, customer, sales), user | Selesai |
| 3 | PO, surat jalan masuk, faktur supplier, faktur penjualan, surat jalan keluar, retur, stok awal, HPP rata-rata | Berikutnya |
| 4 | Laporan, export Excel/PDF, hosting | Belum |

## Hak akses

| | Owner | Admin | User |
|---|:-:|:-:|:-:|
| Membuat perusahaan | Ya | - | - |
| Membuka semua perusahaan | Ya | - | - |
| Mengatur user | Ya | Ya (perusahaannya) | - |
| Mengatur gudang | Ya | Ya | - |
| Tambah dan ubah barang, supplier, customer, sales | Ya | Ya | Ya |
| Menghapus data master | Ya | Ya | - |

Aturan ini dijaga di database (Row Level Security), bukan hanya di tampilan.

## Setup Supabase (sekali saja)

1. **Matikan konfirmasi email.** Supabase → Authentication → Sign In / Providers → Email → matikan **Confirm email** → Save. Login memakai username, jadi tidak ada email sungguhan yang bisa dikonfirmasi.
2. **Buat struktur database.** Supabase → SQL Editor → New query → tempel seluruh isi [`supabase/001_fondasi.sql`](supabase/001_fondasi.sql) → Run. Script ini juga membuat perusahaan pertama, CV Prima Agro Perkasa (PAP).
3. **Buat akun Owner.** Supabase → Authentication → Users → Add user → Create new user:
   - Email: `<username>@agrimas-stok.app`, misalnya `carles@agrimas-stok.app`
   - Password: bebas (minimal 6 karakter)
   - Centang **Auto Confirm User**
4. **Jadikan akun itu Owner.** Di SQL Editor jalankan (ganti sesuai akun di langkah 3):
   ```sql
   select setup_owner('carles@agrimas-stok.app', 'carles', 'Carles Juliandy');
   ```
5. Buka aplikasinya, login dengan username `carles` dan password tadi, lalu pilih perusahaan.

User lain (Admin dan User) dibuat dari dalam aplikasi lewat menu **Pengaturan → User**.

## Menjalankan di komputer sendiri

Aplikasi memakai JavaScript module, jadi harus dibuka lewat server, bukan klik ganda file `index.html`:

```bash
python -m http.server 8000
# lalu buka http://localhost:8000
```

## Struktur folder

```
index.html              halaman utama
css/style.css           tampilan
js/config.js            alamat dan anon key Supabase
js/db.js                koneksi Supabase dan pesan error
js/state.js             sesi login dan perusahaan aktif
js/ui.js                bantuan tampilan (tabel, form, modal)
js/crud.js              halaman master data standar
js/app.js               menu, login, dan perpindahan halaman
js/pages/               halaman per menu
supabase/*.sql          struktur database, dijalankan berurutan
```
