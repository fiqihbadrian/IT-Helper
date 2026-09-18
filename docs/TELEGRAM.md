# Telegram Bot

Bot Telegram adalah **kanal alternatif untuk membuka dan memantau tiket** — memakai
data, tabel, dan aturan akses yang sama persis dengan web. Tidak ada sistem tiket
kedua: bot hanya berbicara ke database yang sama.

## Cara kerja

```
Telegram ──webhook──▶ /api/telegram/webhook ──▶ lib/telegram/commands.ts
                                                       │
                                          asUser(userId)  ← impersonasi
                                                       ▼
                                        Postgres + RLS (0003_rls.sql)
```

Poin penting: bot **tidak** punya hak istimewa atas data tiket. Setiap operasi
tiket dijalankan lewat `asUser(userId)`, yang membuka transaksi dengan
`set local role authenticated` dan `request.jwt.claims` berisi id pemilik akun
Telegram. Artinya seluruh kebijakan RLS tetap berlaku:

- Karyawan hanya bisa melihat tiket miliknya sendiri.
- Hanya `it_support` dan `admin` yang bisa mengubah status atau mengambil tiket.
- Percobaan lewat bot tidak bisa melewati aturan yang sama di web.

Kalau kamu menambah policy baru di SQL, bot otomatis ikut mematuhinya tanpa
perubahan kode.

## Setup

### 1. Buat bot

1. Chat [@BotFather](https://t.me/BotFather) → `/newbot` → ikuti instruksinya.
2. Salin token-nya ke `.env.local`:

```bash
TELEGRAM_BOT_TOKEN=123456:ABC...
# atau BOT_TELE=...  (keduanya dikenali, TELEGRAM_BOT_TOKEN menang)
```

3. Opsional, agar halaman profil menampilkan tautan langsung ke bot:

```bash
NEXT_PUBLIC_TELEGRAM_BOT_USERNAME=bian_it_bot
```

### 2. Secret

```bash
# dipakai Telegram untuk membuktikan bahwa request benar datang dari Telegram
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

```bash
TELEGRAM_WEBHOOK_SECRET=...
# dipakai cron untuk memanggil dispatcher notifikasi
DISPATCH_SECRET=...
```

Nilai acak sudah ditambahkan otomatis ke `.env.local` saat setup pertama.

### 3. Daftarkan webhook

Telegram hanya mau URL **HTTPS publik**.

```bash
# produksi
npm run telegram:setup https://helpdesk.example.com

# cek status
npm run telegram:info

# hapus
npm run telegram:delete
```

### 4. Development lokal (tanpa tunnel)

Telegram tidak bisa mengirim webhook ke `localhost`, jadi pakai mode polling.
Ia menarik update lewat `getUpdates` lalu meneruskannya ke route webhook yang
sama — logikanya tidak diduplikasi.

```bash
npm run dev             # terminal 1
npm run telegram:poll   # terminal 2
```

## Menghubungkan akun

Email bukan rahasia, jadi bot tidak boleh percaya begitu saja kalau seseorang
mengaku sebagai `budi@perusahaan.com`. Penautan memakai kode sekali pakai yang
dibuat dari sesi web yang sudah terautentikasi:

1. Buka **Profil → Telegram → Hubungkan Telegram**.
2. Kode 6 karakter muncul, berlaku 15 menit.
3. Kirim ke bot: `/start K4M7QP`.

Kode disimpan di `telegram_link_codes` dan ditandai `used_at` begitu dipakai,
jadi tidak bisa dipakai dua kali. Satu akun Telegram hanya bisa menautkan ke satu
profil.

Untuk memutus: `/unlink` di bot, atau tombol di halaman profil.

## Perintah

| Perintah | Siapa | Fungsi |
| --- | --- | --- |
| `/start` | semua | Sambutan / penautan dengan kode |
| `/new` | semua | Buat tiket, bertahap: kategori → judul → deskripsi → prioritas |
| `/tickets` | semua | 10 tiket yang terakhir diperbarui |
| `/ticket IT-000004` | semua | Detail satu tiket + 4 percakapan terakhir |
| `/status` | semua | Ringkasan jumlah tiket |
| `/unlink` | semua | Putuskan akun Telegram |
| `/help` | semua | Daftar perintah |

Di setiap tiket ada tombol inline: **Balas**, **Segarkan**, dan untuk tim IT
tambahan **Ambil tiket ini** serta tombol ubah status.

### Screenshot

Foto yang dikirim:

- saat `/new` sedang berjalan → disimpan dan dilampirkan otomatis begitu tiket dibuat;
- saat mode balas → langsung dilampirkan ke tiket itu;
- caption foto dipakai sebagai deskripsi (kalau ≥ 10 karakter) atau sebagai balasan.

File diunduh dari Telegram lalu diunggah ulang ke bucket Supabase yang sama
(`ticket-attachments`, path `<ticket_id>/<uuid>-<nama>`), sehingga tiket menyimpan
salinan permanen dan tetap terlindungi Storage RLS — bukan `file_id` yang hanya
bisa dibuka bot.

## Notifikasi

`notifications` tetap satu-satunya sumber kebenaran dan ditulis oleh trigger di
`0002_triggers.sql` — tidak ada kode aplikasi yang membuat notifikasi.

Yang ditambahkan `0007_telegram.sql`:

- `notification_deliveries` — satu baris per (notifikasi, kanal) untuk melacak
  pengiriman, supaya tidak pernah terkirim dua kali dan bisa dicoba ulang.
- Trigger `notifications_queue_delivery` — saat notifikasi dibuat, kanal `web`
  langsung ditandai `SENT`; kanal `telegram` diantrikan `PENDING` **hanya** kalau
  penerimanya sudah menautkan akun.

Pengiriman dilakukan oleh dispatcher:

```bash
curl -X POST https://helpdesk.example.com/api/telegram/dispatch \
  -H "x-dispatch-secret: $DISPATCH_SECRET"
```

Jalankan dari cron, misalnya tiap menit:

```
* * * * * curl -s -X POST https://helpdesk.example.com/api/telegram/dispatch \
  -H "x-dispatch-secret: $DISPATCH_SECRET" > /dev/null
```

Di Vercel, tambahkan `crons` di `vercel.json` dengan header tersebut.

Selain itu, saat user mengirim pesan apa pun ke bot, antreannya ikut dikuras
(`flushNotifications`), jadi notifikasi tetap sampai tanpa cron.

## Keamanan

| Aspek | Penanganan |
| --- | --- |
| Pemalsuan update | Header `X-Telegram-Bot-Api-Secret-Token` wajib cocok; kalau tidak → 401 |
| Update ganda | `telegram_updates.update_id` primary key; retry Telegram diabaikan |
| Klaim akun orang lain | Butuh kode dari sesi web yang sudah login, bukan sekadar email |
| Akses data | `asUser()` → RLS asli; bot tidak punya jalur istimewa ke tiket |
| Unggahan | MIME dan ukuran divalidasi sama seperti unggahan web |

Route webhook selalu membalas `200` (kecuali secret salah). Membalas `5xx` akan
membuat Telegram mengirim ulang update yang sama terus-menerus.

## Berkas

```
supabase/migrations/0007_telegram.sql   tabel + trigger + fungsi penautan
lib/db/pool.ts                          asUser() — impersonasi untuk RLS
lib/telegram/client.ts                  pemanggilan Bot API
lib/telegram/commands.ts                perintah, tombol, alur buat tiket
lib/telegram/session.ts                 penautan, state percakapan, idempotensi
lib/telegram/tickets.ts                 operasi tiket sebagai user
lib/telegram/files.ts                   unduh dari Telegram → Supabase Storage
lib/telegram/attachments.ts             lampirkan foto ke tiket
app/api/telegram/webhook/route.ts       penerima update
app/api/telegram/dispatch/route.ts      pengirim notifikasi
components/profile/TelegramPanel.tsx    UI penautan
scripts/telegram-setup.mjs              daftar/hapus webhook
scripts/telegram-poll.mjs               mode polling untuk lokal
```

## Pemecahan masalah

**Bot tidak merespons**
`npm run telegram:info` — pastikan URL webhook benar dan `pending_update_count`
tidak terus bertambah. Cek log server untuk `[telegram]`.

**`chat not found`**
Chat id tidak valid atau user belum pernah menekan Start di bot. User harus
memulai percakapan lebih dulu.

**`409 Conflict: can't use getUpdates method while webhook is active`**
Hapus webhook dulu: `npm run telegram:delete`, atau hentikan `telegram:poll`.

**Kode penautan tidak valid**
Kode berlaku 15 menit dan sekali pakai. Membuat kode baru otomatis membatalkan
kode sebelumnya.

**Notifikasi tidak terkirim**
Pastikan user sudah menautkan akun (`profiles.telegram_user_id` terisi) dan
dispatcher dijalankan. Baris yang gagal tersimpan di `notification_deliveries`
dengan `status = 'FAILED'` dan `last_error`-nya.

## Jebakan yang sudah pernah menggigit

**Jangan gabungkan INSERT dan SELECT dalam satu data-modifying CTE.**

`lib/telegram/tickets.ts` dulu menulis:

```sql
with inserted as (
  insert into public.tickets (...) values (...) returning id
)
select ... from public.tickets t where t.id = (select id from inserted)
```

Terlihat rapi, tapi **selalu mengembalikan 0 baris**. Sub-statement di dalam
`WITH` berbagi snapshot yang diambil saat statement dimulai, jadi SELECT di
luarnya tidak bisa melihat baris yang baru saja di-INSERT oleh CTE itu sendiri.
Akibatnya `createTicket()` mengembalikan `undefined` dan bot mengirim
"Gagal membuat tiket" — padahal INSERT-nya sudah commit dan tiketnya benar-benar
ada. Sekarang INSERT dan SELECT dibaca sebagai dua statement terpisah.

**Jangan memanggil `asUser()` di dalam `asUser()`.**

`asUser()` mengambil koneksi dari pool dan membuka transaksi. Memanggilnya lagi
dari dalam callback akan mengambil koneksi **kedua**, yang tidak bisa melihat
baris yang belum di-commit di transaksi pertama. Karena itu helper yang perlu
membaca ulang hasil tulisannya menerima `Queryable` (`db`), bukan `userId`.

Keduanya dijaga oleh `npm run verify` (bagian *Read-your-own-write inside a
transaction*).
