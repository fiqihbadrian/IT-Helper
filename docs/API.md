# REST API v1

API untuk sistem lain: skrip, cron, integrasi internal, atau tool AI. Semua
endpoint bekerja pada data dan aturan akses yang sama dengan web — bukan salinan
logika.

## Autentikasi

Setiap pengguna bisa membuat API key di **Profil → API Keys**.

```http
Authorization: Bearer itk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

`X-API-Key` juga diterima kalau klien tidak nyaman memakai header Authorization.

Key hanya ditampilkan **sekali** saat dibuat. Yang disimpan di database cuma
hash SHA-256 dan 12 karakter pertama sebagai penanda, jadi key yang hilang tidak
bisa dipulihkan — buat yang baru dan cabut yang lama.

### Key mewarisi identitas pemiliknya

Ini bagian terpenting dari desainnya. Key bukan akun super: setiap request
dijalankan sebagai pemilik key di dalam satu transaksi Postgres, dengan
`set local role authenticated` dan klaim `sub` berisi id pemiliknya. Artinya
`auth.uid()` mengembalikan orang yang benar, dan **seluruh kebijakan RLS tetap
berlaku**.

| Key milik | Bisa | Tidak bisa |
| --- | --- | --- |
| `employee` | lihat & buat tiket sendiri, komentar di tiket sendiri | lihat tiket orang lain, ubah status, lihat direktori |
| `it_support` | lihat semua tiket, ubah status/prioritas, ambil tiket, lihat semua profil | kelola pengguna |
| `admin` | semuanya, termasuk hapus tiket | — |

Konsekuensinya: kalau aturan akses berubah di SQL, API ikut berubah tanpa
deploy. Tidak ada daftar izin terpisah yang bisa melenceng dari database.

## Format respons

Sukses:

```json
{ "ok": true, "data": { } }
```

Gagal:

```json
{
  "ok": false,
  "error": {
    "code": "bad_request",
    "message": "Unknown status \"NOPE\".",
    "details": { "allowed": ["OPEN", "ASSIGNED", "IN_PROGRESS", "WAITING_USER", "RESOLVED", "CLOSED"] }
  }
}
```

Kode error: `bad_request` (400), `unauthorized` (401), `forbidden` (403),
`not_found` (404), `internal_error` (500).

`not_found` sengaja dipakai untuk "tidak ada" **dan** "bukan milikmu". Kalau
karyawan menebak-nebak nomor tiket, jawabannya tidak boleh membocorkan tiket
siapa yang ada.

## Endpoint

### `GET /api/v1`

Dokumentasi diri sendiri: daftar endpoint, nilai enum yang sah, dan contoh
payload. Cocok untuk dipanggil pertama kali oleh tool yang belum tahu apa-apa.

### `GET /api/v1/me`

Identitas pemanggil, izin, dan ringkasan tiket. Panggilan pertama yang sebaiknya
dilakukan integrasi apa pun, supaya bisa gagal cepat kalau key-nya salah peran.

```json
{
  "ok": true,
  "data": {
    "id": "44444444-4444-4444-8444-444444444444",
    "email": "employee1@helpdesk.test",
    "full_name": "Budi Santoso",
    "role": "employee",
    "department": "Finance",
    "telegram": { "employee": false, "staff": false },
    "api_key": { "id": "…", "name": "Bot laporan" },
    "permissions": {
      "create_ticket": true,
      "view_all_tickets": false,
      "change_status": false,
      "manage_users": false
    },
    "stats": { "open": 1, "total": 5, "…": 0 }
  }
}
```

### `GET /api/v1/meta`

Kategori aktif, departemen, dan angka statistik — semuanya dalam satu request,
supaya form di sisi klien tidak perlu tiga kali bolak-balik.

### `GET /api/v1/users`
Direktori, dibatasi RLS: karyawan melihat dirinya sendiri dan orang-orang yang
terlibat di tiketnya (nama agen yang membalas harus terbaca), staf melihat
semuanya.

| Query | Keterangan |
| --- | --- |
| `role` | `employee`, `it_support`, `admin` |
| `q` | cari di nama atau email |
| `active=all` | ikut sertakan akun nonaktif |
| `page`, `limit` | paginasi, `limit` maksimum 100 |

### `GET /api/v1/tickets`

| Query | Keterangan |
| --- | --- |
| `status` | `OPEN`, `ASSIGNED`, `IN_PROGRESS`, `WAITING_USER`, `RESOLVED`, `CLOSED` |
| `priority` | `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` |
| `category_id` | UUID kategori |
| `q` | cari di judul dan deskripsi |
| `page`, `limit` | paginasi, default 25, maksimum 100 |

Nilai enum tidak peka huruf besar/kecil; nilai yang salah dibalas dengan daftar
yang benar.

```json
{
  "ok": true,
  "data": {
    "items": [
      {
        "id": "…",
        "ticket_number": "IT-000004",
        "title": "Server tidak bisa diakses",
        "status": "OPEN",
        "priority": "CRITICAL",
        "category": "Server",
        "requester": { "id": "…", "full_name": "Budi Santoso", "email": "employee1@helpdesk.test" },
        "assignee": null,
        "created_at": "2026-09-18T12:31:59.000Z",
        "updated_at": "2026-09-18T12:31:59.000Z",
        "resolved_at": null,
        "closed_at": null
      }
    ],
    "pagination": { "page": 1, "limit": 25, "total": 5, "pages": 1 }
  }
}
```

`total` adalah jumlah **dalam jangkauan pemanggil**, bukan jumlah seluruh tiket
di sistem. Karyawan melihat total tiketnya sendiri; staf melihat total antrean.

Email requester selalu ikut — itulah identitas yang dibutuhkan sistem luar untuk
memetakan tiket ke orangnya, tanpa lookup kedua.

### `POST /api/v1/tickets`

```json
{
  "title": "Printer lantai 3 offline",
  "description": "Muncul error offline sejak pagi, sudah restart tetap sama.",
  "priority": "HIGH",
  "category_id": "b709434d-…",
  "requester_email": "employee1@helpdesk.test"
}
```

`title` minimal 4 karakter, `description` minimal 10. `priority` default
`MEDIUM`.

`requester_email` boleh diisi sebagai penegasan identitas; kalau tidak cocok
dengan pemilik key, request ditolak `403`. RLS memaksa `created_by = auth.uid()`,
jadi tiket atas nama orang lain memang mustahil — field ini ada supaya
kesalahannya diberi nama, bukan gagal diam-diam.

Efek sampingnya otomatis: nomor `IT-0000xx` dibuat, baris `ticket_history`
tertulis, dan notifikasi terkirim — semuanya lewat trigger yang sama seperti
tiket dari web.

### `GET /api/v1/tickets/{number}`

Nomor tiket, bukan UUID: `IT-000004`. UUID-nya tetap ada di payload untuk
dipakai sebagai foreign key di sistem lain.

### `PATCH /api/v1/tickets/{number}`

```json
{ "status": "IN_PROGRESS", "assign_to_me": true }
```

Field: `status`, `priority`, `category_id`, `assign_to_me`. Hanya staf yang
boleh mengubah; karyawan yang mencoba akan mendapat `404` karena barisnya tidak
bisa ia ubah — bukan karena ada pemeriksaan khusus di handler.

### `GET|POST /api/v1/tickets/{number}/comments`

```json
{ "message": "Sudah saya cek, kabel HDMI longgar." }
```

Komentar dari API memicu notifikasi yang sama dengan komentar dari web, karena
efek sampingnya ada di trigger.

## Contoh

```bash
KEY=itk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# siapa saya
curl -s -H "Authorization: Bearer $KEY" https://helpdesk.example.com/api/v1/me

# tiket saya yang masih terbuka
curl -s -H "Authorization: Bearer $KEY" \
  "https://helpdesk.example.com/api/v1/tickets?status=OPEN&limit=10"

# buat tiket
curl -s -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"title":"Printer lantai 3 offline","description":"Error offline sejak pagi.","priority":"HIGH"}' \
  https://helpdesk.example.com/api/v1/tickets

# balas
curl -s -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"message":"Sudah dicoba, masih sama."}' \
  https://helpdesk.example.com/api/v1/tickets/IT-000004/comments
```

## Menyambungkan tool AI

Pola yang dipakai: satu key per integrasi, dengan nama yang jelas.

1. Buat key di **Profil → API Keys**, beri nama seperti `n8n workflow` atau
   `claude desktop`.
2. Simpan sebagai secret di sisi tool tersebut.
3. Suruh tool memanggil `GET /api/v1` dulu — deskripsi endpoint dan contoh
   payload ada di sana, jadi tidak perlu menempel dokumentasi ke prompt.
4. Panggil `GET /api/v1/me` untuk tahu perannya, lalu pakai endpoint sesuai izin.

Key karyawan sudah cukup untuk membuka dan membalas tiket sendiri, jadi bot
pribadi tidak perlu diberi hak staf.

## Perubahan yang memutus kompatibilitas

**`telegram_linked` → `telegram: { employee, staff }`.** Sistem punya dua bot
Telegram sejak `0009_two_bots.sql` — satu untuk karyawan, satu untuk tim IT — dan
satu boolean tidak bisa menyatakan "tertaut ke yang mana". Bidang lamanya dihapus,
bukan dipertahankan sebagai alias, supaya integrasi yang belum menyesuaikan gagal
cepat dan jelas alih-alih diam-diam salah baca.

## Membatalkan

Cabut key kapan saja di **Profil → API Keys**, atau dari server:

```sql
select public.revoke_api_key('<uuid>');
```

Key yang dicabut langsung berhenti bekerja — `verify_api_key()` mengembalikan
kosong, sehingga request berikutnya dibalas `401`. Kolom `last_used_at` diisi
setiap kali key dipakai, jadi key yang tidak pernah dipakai bisa dikenali.

## Berkas

```
lib/api/errors.ts                  tipe error + kode
lib/api/auth.ts                    verifikasi key, impersonasi, peran
lib/api/handler.ts                 pembungkus route + transaksi
lib/api/response.ts                format respons, paginasi
lib/api/body.ts                    parsing body dan enum
lib/api/tickets.ts                 query tiket sebagai user
app/api/v1/route.ts                dokumentasi diri
app/api/v1/me/route.ts             identitas pemanggil
app/api/v1/meta/route.ts           kategori, departemen, statistik
app/api/v1/users/route.ts          direktori
app/api/v1/tickets/route.ts        daftar + buat
app/api/v1/tickets/[number]/…      detail, ubah, komentar
supabase/migrations/0006_api_keys.sql  tabel key + fungsi terbit/verifikasi/cabut
```
