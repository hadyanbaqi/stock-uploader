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

**Tahap 4: Metadata AI (Ciora)** (selesai)

- Halaman Metadata: judul, deskripsi, keyword, kategori Adobe & Shutterstock dibuat AI, bisa diedit
- Video dilihat utuh: 9 frame jadi 1 lembar kontak (mode Hemat) atau 12 frame terpisah (mode Detail), plus data teknis (resolusi, durasi, loop, green screen)
- Mode Hemat (go/gemini-3.1-flash-lite), Gratis (nemotron free, otomatis pindah ke Hemat kalau penuh), Detail
- Aturan SEO otomatis: judul ≤70 karakter, keyword ≤49 tanpa dobel/merek, kata judul masuk 10 keyword pertama
- Simpan ke file (ExifTool) untuk JPG, PNG, PSD, EPS, AI, MP4, MOV; file asli dicadangkan dulu
- Download CSV untuk Adobe Stock, Shutterstock, Vecteezy, Freepik, Pond5, Dreamstime, 123RF
- EPS/AI/ZIP dibaca lewat JPG pratinjau dengan nama sama
- API key Ciora disimpan terenkripsi di Pengaturan

**Tahap 5: Rapikan** (selesai, versi 1.0.0)

- Ikon aplikasi, tema terang/gelap/ikuti sistem di Pengaturan
- Ekspor/impor daftar akun tanpa password (untuk pindah komputer)
- Peringatan akun yang password-nya belum diisi

**Versi 1.7.0: Upscale AI di Buat Gambar**

- Sakelar **Upscale AI saat disimpan** di Buat Gambar: hasil generate langsung diperbesar dengan Real-ESRGAN
  (mesin yang sama dengan Upscayl) di komputer sendiri, tanpa internet dan tanpa biaya.
- Pilih **model** (Foto & umum / Ilustrasi & anime / Cepat), **skala** 2×, 3×, 4×, dan **format** JPG, PNG, atau WebP.
  JPG: latar transparan jadi putih; PNG/WebP: transparansi tetap. Hasil dibatasi 64 MP.
- **Peringatan** saat pertama kali dinyalakan: berjalan di kartu grafis komputer ini (bisa panas/lambat,
  ±5–60 detik per gambar, Windows perlu driver Vulkan terbaru). Progres "Upscale AI xx%" tampil di kartu.
- Kalau upscale gagal (mis. kartu grafis tidak didukung), gambar tetap disimpan seperti biasa dan ada pesan alasannya.
- Windows: `realesrgan-ncnn-vulkan.exe` + `vcomp140.dll`; Mac: binary native Apple Silicon (ditandatangani ad-hoc).
  Diunduh saat build dari rilis resmi xinntao/Real-ESRGAN v0.2.5.0 dengan SHA-256 dikunci (`npm run upscaler`).
  Lisensi MIT (program) + BSD-3 (model) disertakan di `upscaler/LISENSI-UPSCALER.txt`.
  Upscayl sendiri (AGPL-3.0) sengaja tidak dipakai supaya kode aplikasi ini tidak wajib dibuka.

**Versi 1.6.0: Profil Browser**

- Halaman **Profil Browser**: satu profil = satu Chrome terpisah (login, cookie, riwayat, ekstensi sendiri), jadi
  dasbor beberapa akun kontributor bisa dibuka bersamaan tanpa saling logout.
- Proxy per profil: HTTP, HTTPS, SOCKS5, dengan atau tanpa username/password. Tempel dalam format apa pun
  (`host:port:user:pass`, `user:pass@host:port`, `socks5://…`), langsung diisi ke formulir.
- Proxy ber-password berjalan lewat perantara lokal di 127.0.0.1 (tanpa popup login, SOCKS5 juga bisa).
  Gagal tertutup: kalau proxy mati, Chrome tidak bisa membuka halaman, tidak pernah lewat IP asli.
- Tes IP satu/semua profil: "OK - IP x.x.x.x (ms)", "Gagal" dengan alasan, "Berubah - belum dites" setelah proxy diganti,
  peringatan kalau dua profil keluar dengan IP yang sama.
- Buka satu (klik dua kali), yang dipilih (Ctrl/Shift + klik), atau semua dalam grup dengan jeda antarprofil.
  Proxy dites dulu sebelum Chrome dibuka (bisa dimatikan). WebRTC dibatasi supaya IP asli tidak bocor.
- Grup di panel kiri, cari, pindah grup, duplikat setelan (tanpa login), halaman awal per profil (preset dasbor agensi).
- Password proxy disimpan terenkripsi seperti password FTP. Chrome/Chromium/Brave/Edge dicari otomatis atau dipilih manual.
- Catatan: sidik jari browser (layar, font, WebGL) sama di semua profil; fitur ini untuk mengelola akun tim/klien.
- **Metadata untuk PSD/PSB:** AI membaca gambar gabungan PSD langsung (tanpa JPG pratinjau); judul, deskripsi, dan
  keyword ditanam ke PSD (XMP + IPTC). Saat "Simpan ke file", JPG pratinjau bernama sama dibuat otomatis kalau belum
  ada (wajib untuk Freepik/Magnific, maks 10.000 px), lengkap dengan metadata. Didukung RGB, CMYK, Grayscale,
  Indexed, 8/16 bit; PSD harus disimpan dengan "Maximize PSD Compatibility" aktif (bawaan Photoshop).

- **Pembaruan otomatis:** aplikasi mengecek versi baru saat dibuka dan tiap 6 jam (bisa dimatikan di Pengaturan).
  Muncul banner "Versi baru tersedia" → Download (dicek SHA-256) → Pasang & buka ulang.
  Windows: installer berjalan senyap lalu aplikasi terbuka lagi. Mac: aplikasi lama diganti lalu dibuka lagi;
  kalau dijalankan dari DMG atau folder yang tidak bisa ditulisi, DMG dibuka untuk dipasang manual.

**Versi 1.7.0: Transparan → paket per agensi**

Centang agensi di Transparan → tiap agensi dapat folder sendiri (nama folder sama dengan upload otomatis):

| Folder | File | Syarat (dicek Nov 2026) |
| --- | --- | --- |
| `ADOBE-STOCK/` | PNG transparan | 4–100 MP, ≤ 45 MB, sRGB; PNG lewat portal web |
| `SHUTTERSTOCK/` | JPG (efek di latar aslinya) | ≥ 4 MP sRGB. PNG/PSD ditolak; EPS hanya vektor asli. Tidak menerima AI |
| `FREEPIK/` | `nama.psd` + `nama.jpg` | PSD 1,5–250 MB; JPG 2.000–10.000 px, nama sama |
| `VECTEEZY/` | PNG transparan | ≥ 4 MP, ≤ 50 MB |
| `POND5/` | PNG transparan | ≥ 2.000 px. Tidak menerima AI |
| `123RF/` | JPG | ≥ 6 MP, ≤ 30 MB |
| `DREAMSTIME/`, `DEPOSITPHOTOS/` | JPG | ≥ 3 / 4 MP |
| `ALAMY/` | JPG | ≥ 17 MB tanpa kompresi (±6 MP). Tidak menerima AI |

Gambar diperbesar otomatis sampai memenuhi semua agensi terpilih. Gambar AI (dari Buat Gambar atau dicentang
"buatan AI") dilewati untuk agensi yang menolak AI. ZIP menyimpan folder agensinya.

**Versi 1.4.0: Transparan (VFX → PNG transparan)**

- Halaman **Transparan**: seret atau pilih gambar/folder (atau "Jadikan transparan" dari Buat Gambar).
- Latar hitam/putih/warna dideteksi otomatis; transparansi dihitung per piksel (un-premultiply) sehingga glow, api,
  dan asap tetap halus tanpa halo. Atur pembersih noise dan kekuatan glow, pratinjau sebelum/sesudah dengan penggeser.
- Keluaran: PNG transparan (sRGB), JPG preview (belah hitam|putih, hitam, putih, petak, warna + teks), PSD berlapis
  (efek + latar), nama asli atau berurutan, ZIP otomatis. Diperbesar ke ±6 MP kalau di bawah 4 MP.
- Buat Gambar: template "VFX latar hitam" dan "Asap/tinta latar putih" + 30 contoh prompt VFX siap pakai.
- Offline, tanpa biaya; tanda AI generatif ikut dari file asal.

**Versi 1.3.0: Buat Gambar (Ciora)**

- Halaman **Buat Gambar**: tempel banyak prompt (satu per baris), variasi 1–4 per prompt, template gaya (wallpaper 4K,
  foto realistis, siluet untuk vektor, tekstur, ruang kosong untuk teks), gambar referensi opsional.
- Model dibaca langsung dari akun Ciora (hanya model gambar, Gemini flash image paling atas), rasio 16:9 sampai 9:16.
- Antrean 2 gambar sekaligus dengan coba ulang otomatis; yang ditolak filter konten tidak dicoba ulang.
- Galeri per kelompok: Simpan / Buang / Buat lagi / Salin prompt, lihat ukuran penuh.
- Simpan = JPG kualitas 95, diperbesar ke ±6 MP kalau di bawah 4 MP, ditandai AI generatif + prompt jadi catatan metadata.
- **ZIP otomatis**: begitu satu kelompok selesai, semua hasil disimpan lalu di-ZIP (bisa dimatikan; ada tombol ZIP manual).
- "Buat metadata" langsung dari hasil; file AI tidak dikirim ke Shutterstock, Vecteezy, Alamy, iStock.
- Tab Riwayat: semua prompt, model, status, dan file.

**Versi 1.2.0:** tema gelap baru (bawaan), progress Antrean menghitung semua file, tanda tangan ad-hoc Mac.

**Versi 1.1.0: Sambung ke alur kerja Microstok**

- **Metadata dari CSV (gratis, tanpa AI):** halaman Metadata otomatis mengisi judul, deskripsi, keyword, dan kategori dari
  `metadata-master.csv` (di `_FILE-KERJA`) dan CSV platform (`adobe-stock.csv`, `shutterstock.csv`, `vecteezy.csv`, dll.)
  yang ada di folder file atau folder di atasnya, dicocokkan lewat nama file. Tombol "Pilih CSV…" untuk CSV lain.
- **Upload sesuai nama folder:** file di folder `ADOBE-STOCK` hanya ke akun Adobe Stock, `SHUTTERSTOCK` ke Shutterstock,
  `VECTEEZY` ke Vecteezy, dan seterusnya (juga `file video/ADOBE-STOCK`). Bisa dimatikan untuk kirim ke semua akun yang dicentang.
- **Setelah upload berhasil** (Pengaturan): status "belum" → "sudah" di `metadata-master.csv` untuk agensi itu, dan file yang
  semua uploadnya selesai bisa dipindah ke `_sudah-upload` (di sebelah folder agensi) atau ke Tempat Sampah.
- **Installer lebih kecil:** Mac hanya Apple Silicon, DMG ULFO, kompresi maksimum, bahasa Electron hanya Inggris + Indonesia.

## Cara pakai singkat

1. **Akun**: tambah akun agensi, klik Tes koneksi, Simpan.
2. **Pengaturan**: tempel API key Ciora (kalau mau metadata AI).
3. **Upload**: seret file/folder, klik "Buat metadata" kalau perlu.
4. **Metadata**: klik Buat metadata, cek/edit, lalu "Simpan ke file" dan "Download CSV".
5. **Upload**: centang akun tujuan, klik Upload. Pantau di **Antrean**; semua tercatat di **Riwayat**.

## Download installer

Setiap push ke `main`, GitHub Actions membuat installer:

1. Buka tab **Actions** di repo ini, pilih run terbaru yang hijau.
2. Di bagian **Artifacts**, download `Stock-Uploader-Windows` (.exe) atau `Stock-Uploader-macOS` (.dmg).

Saat pertama dibuka akan muncul peringatan karena aplikasi tidak bertanda tangan resmi:

- **Windows:** klik "More info" lalu "Run anyway".
- **Mac:** klik kanan aplikasi > Open > Open. Kalau tetap diblokir: System Settings > Privacy & Security > Open Anyway.

## Menerbitkan versi baru (pembaruan otomatis)

Repo kode ini publik, jadi GitHub Actions gratis tanpa kuota (termasuk runner Mac). Setiap push ke main dan
setiap pull request otomatis dites dan dibuatkan installer (workflow **Build installer**).

Installer untuk pembaruan otomatis diterbitkan di repo publik
[hadyanbaqi/stock-uploader-releases](https://github.com/hadyanbaqi/stock-uploader-releases), tempat aplikasi
mengecek `latest.json` (versi, catatan, ukuran, sidik SHA-256 tiap installer).

Setiap rilis:

1. Naikkan `"version"` di package.json (mis. 1.8.0), commit, push ke main.
2. Di repo **stock-uploader-releases**: **Actions → Build & Rilis → Run workflow**, centang **terbitkan**,
   isi catatan "Apa yang baru". (Tanpa token: kode diambil langsung dari repo publik ini.)

Workflow menjalankan semua tes (`npm run ci:test`), membuat installer Windows + Mac, lalu menerbitkan rilis
beserta `latest.json`. Tanpa centang **terbitkan**, workflow hanya membuat installer untuk dicoba (bisa juga dari
branch lain). Versi dengan tanda hubung (mis. `1.8.0-beta.1`) jadi pra-rilis dan tidak ditawarkan ke aplikasi.

Cara lama tetap ada: **Actions → Rilis → Run workflow** di repo ini (butuh secret `RELEASES_TOKEN`,
token "Contents: Read and write" untuk repo stock-uploader-releases).

Kalau repo ini dijadikan private lagi, isi secret `SOURCE_TOKEN` (token "Contents: Read-only" untuk repo ini)
di repo stock-uploader-releases, dan ingat repo private hanya punya kuota menit bulanan.

## Untuk pengembang

```bash
npm install
npm run dev          # jalankan aplikasi
npm run typecheck    # cek tipe
npm run test:conn    # tes koneksi ke server FTP/FTPS/SFTP lokal
npm run test:upload  # tes antrean: putus, jeda, coba ulang (BIG=1 tambah file 500 MB)
npm run test:meta    # tes metadata: aturan SEO, CSV, AI tiruan, ExifTool
npm run test:csv     # tes impor CSV, folder agensi, metadata-master, pindah file
npm run test:gen     # tes Buat Gambar: Ciora tiruan, nama file, ZIP
npm run test:alpha   # tes Transparan: alpha, PNG, PSD
npm run test:profiles # tes Profil Browser: format proxy, flag Chrome, perantara proxy, cek IP
npm run test:psd     # tes pembaca PSD: mode warna, 16 bit, RLE, PSB, file rusak
npm run test:update  # tes pembaruan: versi, latest.json, unduh + SHA-256, skrip ganti aplikasi Mac
npm run upscaler     # unduh Real-ESRGAN untuk komputer ini ke resources/upscaler (sekali saja)
npm run test:upscale # tes upscale: ukuran, flag, progres, error; Real-ESRGAN asli kalau ada GPU
                     # (tanpa GPU: VK_ICD_FILENAMES=…/vk_swiftshader_icd.json untuk Vulkan di CPU)
npm run test:app     # tes aplikasi asli: upload, riwayat, metadata
npm run dist:win     # installer Windows
npm run dist:mac     # installer Mac (harus di Mac)
```

Data akun tersimpan di folder data aplikasi (`accounts.json`), password hanya dalam bentuk terenkripsi.
