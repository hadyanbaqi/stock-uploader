# Stock Uploader

Aplikasi desktop pribadi (Windows dan Mac) untuk upload file ke banyak akun microstock lewat FTP, FTPS, dan SFTP.

## Status

**Tahap 1: Kerangka + Akun** (selesai)

- Halaman Akun: tambah, ubah, duplikat, hapus, aktif/nonaktif
- Jumlah akun per agensi tidak dibatasi (mis. "Vecteezy - Utama" dan "Vecteezy - Kedua")
- Preset agensi: Adobe Stock, Shutterstock, Dreamstime, Vecteezy, Freepik, Pond5, 123RF, Depositphotos, Alamy, Lainnya
- Password disimpan terenkripsi lewat brankas sistem (Windows DPAPI / macOS Keychain)
- Tes koneksi FTP, FTPS, SFTP dengan pesan error yang mudah dipahami

Tahap berikutnya: Upload + Antrean, Riwayat + cegah dobel, Metadata AI (Ciora), Rapikan.

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
npm run dist:win     # installer Windows
npm run dist:mac     # installer Mac (harus di Mac)
```

Data akun tersimpan di folder data aplikasi (`accounts.json`), password hanya dalam bentuk terenkripsi.
