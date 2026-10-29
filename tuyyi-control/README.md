# Tuyyi Control Dashboard — Vercel Serverless

Dashboard pribadi untuk mengelola repository GitHub dan project Vercel. Versi ini disesuaikan untuk Vercel Functions: tidak memakai `app.listen()` pada runtime Vercel, memakai session cookie bertanda tangan yang tidak bergantung pada penyimpanan memori server, dan memakai Vercel REST API untuk membuat deployment.

## Deploy ke Vercel

1. Upload semua isi folder ini ke repository GitHub baru/private.
2. Import repository tersebut di Vercel.
3. Framework Preset: **Other**. Build Command dan Output Directory dapat dikosongkan.
4. Tambahkan Environment Variables di Vercel Project Settings → Environment Variables:
   - `DASHBOARD_PIN`: PIN login dashboard.
   - `SESSION_SECRET`: string acak panjang minimal 32 karakter.
   - `GITHUB_TOKEN`: GitHub token dengan akses minimum ke repository yang ingin dikelola.
   - `VERCEL_TOKEN`: Vercel access token dengan akses yang dibutuhkan.
   - `GITHUB_OWNER` (opsional): username/organisasi default.
5. Deploy/redeploy setelah environment variables ditambahkan.
6. Buka domain deployment dan login menggunakan PIN.

Jangan masukkan token asli ke GitHub atau file frontend. Jika token pernah terunggah, cabut dan buat token baru.

## Pengembangan lokal

```bash
cp .env.example .env
# edit .env, isi PIN, SESSION_SECRET, GITHUB_TOKEN, dan VERCEL_TOKEN
npm install
npm start
```

Dashboard lokal berjalan di `http://localhost:3000`.

## Batasan serverless Vercel

- Upload ZIP masuk dibatasi 3 MB karena batas payload request Vercel Functions. Untuk ZIP GitHub, isi hasil ekstraksi dibatasi 20 MB dan 100 file.
- Deployment ZIP langsung ke Vercel dibatasi 3 MB hasil ekstraksi dan 100 file. Untuk website lebih besar atau build kompleks, hubungkan repository GitHub ke Vercel dan deploy dari integrasi Git.
- Deployment melalui API membuat deployment; proses build dapat berlanjut setelah respons awal. Periksa deployment di dashboard Vercel untuk memastikan status akhirnya Ready.
- Cookie session bertanda tangan menyimpan status autentikasi singkat di browser; tidak memakai MemoryStore Express yang hilang saat instance serverless berganti. Isinya tidak menyimpan token provider.
- Rate limit berbasis memori pada fungsi serverless bersifat best-effort dan bukan pembatas global lintas instance. Gunakan PIN kuat dan pertimbangkan proteksi tambahan jika dashboard dibuka ke internet publik.
- Beberapa aksi API memerlukan scope/akses akun yang tepat. Jika API menolak aksi, periksa izin token dan pesan error.

## Fitur

- Login PIN dan logout.
- Daftar repository, telusuri file, edit file teks, unduh repository, upload ZIP ke GitHub, serta ubah visibilitas repository.
- Daftar project Vercel, deploy ZIP kecil melalui API, kelola environment variables, hapus project, dan kelola domain.

## Keamanan

Dashboard ini memiliki akses yang kuat ke GitHub dan Vercel. Gunakan token dengan hak minimum, jangan membagikan PIN, jangan commit `.env`, dan pertimbangkan membatasi akses dashboard dengan proteksi tambahan. Hapus project, ubah visibilitas, dan perubahan environment variable harus dilakukan dengan hati-hati.
