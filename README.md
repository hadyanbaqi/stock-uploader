# Stock Uploader

Aplikasi desktop pribadi (Windows dan Mac) untuk upload file ke banyak akun microstock lewat FTP, FTPS, dan SFTP.

## Status

**Tahap 1: Kerangka + Akun** (selesai)

- Halaman Akun: tambah, ubah, duplikat, hapus, aktif/nonaktif
- Jumlah akun per agensi tidak dibatasi (mis. "Vecteezy - Utama" dan "Vecteezy - Kedua")
- Preset agensi: Adobe Stock, Shutterstock, Dreamstime, Vecteezy, Freepik, Pond5, 123RF, Depositphotos, Alamy, Lainnya
- Password disimpan terenkripsi lewat brankas sistem (Windows DPAPI / macOS Keychain)
- Tes koneksi FTP, FTPS, SFTP dengan pesan error yang mudah dipahami

**Tahap 2: Upload + Antrean** (selesai)

- Seret file atau folder (MP4, MOV, JPG, PNG, EPS, AI, SVG, ZIP), atau pilih lewat tombol
- Centang akun tujuan, atau simpan pilihan sebagai grup (mis. "Video")
- Antrean dengan progress, kecepatan, dan sisa waktu; jeda, lanjut, batal, coba lagi
- Upload bersamaan per akun bisa diatur (default 2)
- Coba ulang otomatis 3x; FTP/FTPS melanjutkan dari bagian yang sudah terkirim
- Antrean tersimpan: kalau aplikasi ditutup, upload dilanjutkan saat dibuka lagi
- Komputer tidak tidur selama upload berjalan

**Tahap 3: Riwayat + cegah dobel** (selesai)

- Setiap upload berhasil/gagal dicatat (file, akun, waktu, hasil)
- File yang sudah pernah dikirim ke akun yang sama (nama + ukuran) ditandai dan dilewati, kecuali dipilih "Kirim ulang"
- Filter per akun, hasil, tanggal, cari nama file; ekspor ke CSV
- Hapus catatan supaya file bisa dikirim lagi ke akun itu

Tahap berikutnya: Metadata AI (Ciora), Rapikan.

## Download installer

Setiap push ke `main`, GitHub Actions membuat installer:

1. Buka tab **Actions** di repo ini, pilih run terbaru yang hijau.
2. Di bagian **Artifacts**, download `Stock-Uploader-Windows` (.exe) atau `Stock-Uploader-macOS` (.dmg).

Saat pertama dibuka akan muncul peringatan karena aplikasi tidak bertanda tangan resmi:

- **Windows:** klik "More info" lalu "Run anyway".
- **Mac:** klik kanan aplikasi > Open > Open. Kalau tetap diblokir: System Settings > Privacy & Security > Open Anyway.

## Untuk pengembang

```bash
npm install
npm run dev          # jalankan aplikasi
npm run typecheck    # cek tipe
npm run test:conn    # tes koneksi ke server FTP/FTPS/SFTP lokal
npm run test:upload  # tes antrean: putus, jeda, coba ulang (BIG=1 tambah file 500 MB)
node scripts/test-app.mts  # tes aplikasi asli: 10 video ke 3 akun
npm run dist:win     # installer Windows
npm run dist:mac     # installer Mac (harus di Mac)
```

Data akun tersimpan di folder data aplikasi (`accounts.json`), password hanya dalam bentuk terenkripsi.
