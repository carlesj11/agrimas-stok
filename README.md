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
| 3 | PO, surat jalan masuk, faktur supplier, faktur penjualan, surat jalan keluar, retur, stok awal/opname, pindah gudang, kartu stok, HPP rata-rata | Selesai |
| 4 | Laporan stok, penjualan, pembelian, PO belum terpenuhi; export Excel dan cetak/PDF | Selesai |
| 4b | Cetakan faktur penjualan setengah A4 (21 × 14,875 cm) dengan logo dan catatan per perusahaan | Selesai |
| Berikutnya | Migrasi data dari SQL Server, menu keuangan (hutang/piutang) | Belum |

## Hak akses

| | Owner | Admin | User |
|---|:-:|:-:|:-:|
| Membuat perusahaan | Ya | - | - |
| Membuka semua perusahaan | Ya | - | - |
| Mengatur user | Ya | Ya (perusahaannya) | - |
| Mengatur gudang | Ya | Ya | - |
| Tambah dan ubah barang, supplier, customer, sales | Ya | Ya | Ya |
| Menghapus data master | Ya | Ya | - |
| Membuat PO, surat jalan, faktur, retur, pindah gudang | Ya | Ya | Ya |
| Stok awal dan stock opname | Ya | Ya | - |
| Mengubah tanggal atau membatalkan dokumen | Ya | Ya | - |
| Mengatur format penomoran | Ya | Ya | - |

Aturan ini dijaga di database (Row Level Security), bukan hanya di tampilan.

## Setup Supabase (sekali saja)

1. **Matikan konfirmasi email.** Supabase → Authentication → Sign In / Providers → Email → matikan **Confirm email** → Save. Login memakai username, jadi tidak ada email sungguhan yang bisa dikonfirmasi.
2. **Buat struktur database.** Supabase → SQL Editor → New query → tempel seluruh isi [`supabase/001_fondasi.sql`](supabase/001_fondasi.sql) → Run. Script ini juga membuat perusahaan pertama, CV Prima Agro Perkasa (PAP). Lalu ulangi dengan [`supabase/002_transaksi.sql`](supabase/002_transaksi.sql), [`supabase/003_laporan.sql`](supabase/003_laporan.sql), dan [`supabase/004_faktur.sql`](supabase/004_faktur.sql), masing-masing di query baru. Jalankan setiap file sekali saja, berurutan.
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

## Hosting gratis (GitHub Pages)

Repo → Settings → Pages → Source: **Deploy from a branch** → Branch `main`, folder `/ (root)` → Save. Setelah sekitar satu menit situs bisa dibuka di `https://carlesj11.github.io/agrimas-stok/`. Setiap perubahan yang masuk ke `main` otomatis ikut terpasang.

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
js/dokumen.js           bantuan halaman transaksi (daftar, detail, cetak, editor barang)
js/app.js               menu, login, dan perpindahan halaman
js/pages/               halaman per menu
supabase/*.sql          struktur database, dijalankan berurutan
```

## Aturan stok

- Semua dokumen yang mengubah stok disimpan lewat fungsi database (`simpan_*`), jadi stok, HPP, dan kartu stok selalu berubah bersamaan.
- HPP dihitung dengan metode rata-rata (average) setiap ada barang masuk. Harga masuk = harga per unit setelah diskon baris, sebelum PPN.
- Faktur supplier dianggap harga final: selisihnya terhadap harga surat jalan dibebankan ke HPP barang yang masih ada.
- Stok tidak boleh minus. Penjualan, retur pembelian, dan pindah gudang ditolak bila stok di gudang tidak cukup.
- Dokumen tidak pernah dihapus. Pembatalan membuat baris pembalik di kartu stok.
- Mengubah tanggal dokumen tidak menghitung ulang HPP mundur.
- Laporan stok per tanggal menghitung qty dari kartu stok; nilai persediaannya memakai HPP rata-rata saat ini.

## Cetakan faktur penjualan

Tombol **Cetak** di faktur penjualan mencetak lembar setengah A4 (21 × 14,875 cm) dengan bentuk faktur lama. Logo dan teks "Perhatian" di bawahnya diatur per perusahaan di **Pengaturan → Perusahaan** (tombol **Logo** dan **Ubah**). Di jendela cetak, pilih printer dan biarkan ukuran kertas mengikuti dokumen; untuk printer dot matrix, atur ukuran kertas 21 × 14,875 cm di pengaturan printer.
