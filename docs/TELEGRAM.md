# Telegram Bot

Ada **dua** bot, dan pemisahannya disengaja:

| Bot | Untuk | Perintah | Webhook |
| --- | --- | --- | --- |
| **@bian_it_bot** | karyawan | 7 | `/api/telegram/webhook` |
| **@bian_itbot** | tim IT | 13 | `/api/telegram/webhook/staff` |

Satu update tiket untuk pemohon dan satu update untuk bangku IT adalah dua
notifikasi yang berbeda. Mengirim keduanya ke satu bot berarti antrean tiket
masuk ke chat karyawan. Karena itu pemisahannya bukan soal tampilan menu, tapi
soal **notifikasi mana yang pantas dilihat siapa**.

Bot adalah **kanal alternatif untuk membuka dan memantau tiket** — memakai data,
tabel, dan aturan akses yang sama persis dengan web. Tidak ada sistem tiket
kedua: bot hanya berbicara ke database yang sama.

## Cara kerja

```
Telegram ──webhook──▶ /api/telegram/webhook[/staff] ──▶ lib/telegram/commands.ts
                                                                │
                                                   asUser(userId)  ← impersonasi
                                                                ▼
                                                 Postgres + RLS (0003_rls.sql)
```

URL webhook **adalah** identitas bot. Tidak ada apa pun di payload update yang
mengatakan bot mana yang menerimanya, dan tidak perlu ada: yang membedakan cuma
alamat yang dipakai Telegram untuk mengirim.

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

### 1. Buat dua bot

1. Chat [@BotFather](https://t.me/BotFather) → `/newbot` → ikuti instruksinya.
   Ulangi sekali lagi untuk bot kedua.
2. Salin kedua token ke `.env.local`:

```bash
BOT_TELE_KARYAWAN=123456:ABC...    # @bian_it_bot
BOT_TELE_ADMIN=789012:DEF...       # @bian_itbot
```

Nama panjang `TELEGRAM_EMPLOYEE_BOT_TOKEN` dan `TELEGRAM_STAFF_BOT_TOKEN` juga
dikenali, dan menang kalau keduanya diisi. Daftar nama variabelnya hidup di
`lib/telegram/bots.ts` supaya script dan aplikasi tidak pernah berbeda pendapat
soal bot mana yang mana.

3. Opsional, agar halaman profil menampilkan tautan langsung:

```bash
NEXT_PUBLIC_TELEGRAM_BOT_USERNAME=bian_it_bot
NEXT_PUBLIC_TELEGRAM_STAFF_BOT_USERNAME=bian_itbot
```

### 2. Secret

```bash
# dipakai Telegram untuk membuktikan bahwa request benar datang dari Telegram
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

```bash
TELEGRAM_WEBHOOK_SECRET=...   # dipakai KEDUA bot
DISPATCH_SECRET=...           # dipakai cron untuk memanggil dispatcher
```

Satu secret untuk dua bot: yang membedakan keduanya adalah URL, bukan secret.

### 3. Daftarkan webhook

Telegram hanya mau URL **HTTPS publik**.

```bash
# produksi
npm run telegram:setup        https://helpdesk.example.com   # bot karyawan
npm run telegram:setup:staff  https://helpdesk.example.com   # bot tim IT

# cek status
npm run telegram:info
npm run telegram:info:staff

# hapus
npm run telegram:delete
npm run telegram:delete:staff
```

Mendaftarkan ulang **tidak** membuang update yang masih tertunda secara default —
update itu adalah apa yang diketik orang sungguhan saat webhook mati, justru di
saat kamu paling tidak mau kehilangannya. Pakai `--drop-pending` kalau tumpukan
itu memang sudah pasti sampah.

### 4. Development lokal (tanpa tunnel)

Telegram tidak bisa mengirim webhook ke `localhost`, jadi pakai mode polling.
Ia menarik update lewat `getUpdates` lalu meneruskannya ke route webhook yang
sama — logikanya tidak diduplikasi.

```bash
npm run dev                    # terminal 1
npm run telegram:poll          # terminal 2 — bot karyawan
npm run telegram:poll:staff    # atau bot tim IT
```

Script polling menolak jalan kalau `NEXT_PUBLIC_APP_URL` bukan localhost. Alasannya:
polling dimulai dengan `deleteWebhook`, dan itu akan mematikan bot yang sedang
tayang di produksi tanpa peringatan apa pun.

## Menghubungkan akun

Email bukan rahasia, jadi bot tidak boleh percaya begitu saja kalau seseorang
mengaku sebagai `budi@perusahaan.com`. Penautan memakai kode sekali pakai yang
dibuat dari sesi web yang sudah terautentikasi:

1. Buka **Profil → Telegram**. Ada satu kartu per bot.
2. Kode 6 karakter muncul, berlaku 15 menit.
3. Kirim ke bot yang sesuai: `/start K4M7QP`.

Kode disimpan di `telegram_link_codes` bersama kolom `bot`, dan ditandai `used_at`
begitu dipakai. Kode yang dibuat untuk satu bot tidak berlaku di bot yang lain.

Yang mengikat adalah pasangan **(profil, bot)**: tabel `telegram_links`
berprimary key `(profile_id, bot)`. Kuncinya bukan `chat_id` sendirian, karena
chat pribadi memakai id user Telegram — orang yang sama punya `chat_id` yang
**sama persis** di kedua bot.

Tim IT boleh menautkan keduanya. Karyawan hanya boleh bot karyawan: memanggil
`create_telegram_link_code` dengan `p_bot = 'staff'` langsung ditolak
(`only IT staff can link the staff bot`). Batasnya di database, bukan di UI.

Kalau peran seseorang diturunkan dari tim IT, tautan bot stafnya dilepas otomatis
saat ia mengirim perintah berikutnya — bot memeriksa ulang perannya, memutus
tautan, dan memberi tahu. RLS sebenarnya sudah menolak tulisannya; ini supaya ia
tidak setengah terlayani.

Untuk memutus: `/unlink` di bot, atau tombol di halaman profil.

## Perintah

Tiap bot punya **satu** daftar menu `default`. Tidak ada override per-chat, tidak
ada percabangan peran di dalam satu bot, jadi tidak ada yang bisa melenceng.

| Perintah | Bot | Fungsi |
| --- | --- | --- |
| `/start` | keduanya | Sambutan / penautan dengan kode |
| `/new` | keduanya | Buat tiket, bertahap: kategori → judul → deskripsi → prioritas |
| `/tickets` | keduanya | 10 tiket milik sendiri yang terakhir diperbarui |
| `/ticket IT-000004` | keduanya | Detail satu tiket + 4 percakapan terakhir |
| `/reply IT-000004 pesan` | keduanya | Balas tiket langsung dari chat |
| `/status` | keduanya | Ringkasan akun (bot staf dapat tambahan hitungan antrean) |
| `/unlink` | keduanya | Putuskan akun Telegram |
| `/help` | keduanya | Daftar perintah, sesuai bot |
| `/queue` | staf | Semua tiket, terbaru dulu |
| `/open` | staf | Tiket yang belum `RESOLVED`/`CLOSED` |
| `/unassigned` | staf | Tiket yang belum punya penanggung jawab |
| `/find printer` | staf | Cari berdasarkan nomor tiket atau judul |
| `/claim IT-000004` | staf | Tugaskan tiket ke diri sendiri |
| `/close IT-000004` | staf | Tutup tiket |

Bot karyawan melihat **7** perintah; bot tim IT melihat **13**. Untuk memeriksa apa
yang sebenarnya terpasang di Telegram:

```bash
node scripts/telegram-setup.mjs --menus --bot employee
node scripts/telegram-setup.mjs --menus --bot staff
```

Daftar perintah **tidak** didaftarkan dari script. Sumbernya hanya satu,
`lib/telegram/menu.ts`, dan tiap bot memasang daftarnya sendiri saat update
pertama masuk.

> **Menu itu bukan sistem izin.** Tampilan saja. Perintah khusus tim IT masih
diperiksa ulang di `commands.ts` (`STAFF_ONLY`), dan RLS tetap penentu akhir —
> karyawan yang mengetik `/queue` ditolak sebelum menyentuh database. Di bot
> karyawan perintah itu dijawab `Perintah itu ada di bot tim IT.`

`/start` sengaja tidak dipasang di menu: perintah itu tetap bekerja, tapi
tempatnya di pesan sambutan, bukan di daftar yang bisa ditekan kapan saja.

Konsekuensinya: setelah peran seseorang diubah di web, menu Telegram-nya masih
lama sampai ia mengirim `/start` atau `/help` sekali. Tidak ada yang memberi tahu
bot saat peran berubah, jadi dua perintah itu yang memaksa bot melihat ulang.

### Balas lewat perintah, bukan lewat pesan berikutnya

Tombol **Balas** masih membuka mode "pesan berikutnya langsung dikirim sebagai
balasan", karena itu nyaman untuk balasan panjang. Tapi `/reply IT-000004 pesan`
ada supaya pesan biasa tidak pernah salah ditafsirkan sebagai balasan. Kalau kamu
mengetik `/reply` sementara mode balas sedang terbuka, mode itu ditutup — kalau
tidak, pesan berikutnya akan ikut terkirim sebagai balasan.

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
  langsung ditandai `SENT`.

Yang ditambahkan `0009_two_bots.sql`: kolom `notifications.audience`, dan
routing-nya.

### Audience ditentukan saat notifikasi dibuat

Bukan ditebak saat pengiriman. Seorang admin bisa sekaligus jadi pemohon dan
anggota bangku IT, jadi "siapa orang ini" tidak bisa menjawab pertanyaan "ini
notifikasi tentang apa". Yang bisa menjawab hanya `audience`, dan itu ditulis oleh
trigger yang membuat notifikasinya:

| Kejadian | Penerima | `audience` |
| --- | --- | --- |
| tiket baru | semua tim IT | `staff` |
| status berubah | pemohon | `requester` |
| prioritas berubah | pemohon | `requester` |
| eskalasi HIGH/CRITICAL | semua tim IT | `staff` |
| tiket diambil | penanggung jawab | `staff` |
| tiket diambil | pemohon | `requester` |
| karyawan membalas | penanggung jawab / semua tim IT | `staff` |
| tim IT membalas | pemohon | `requester` |

Routing-nya ketat, **tanpa fallback**: `requester` hanya ke bot karyawan, `staff`
hanya ke bot staf. Fallback ke "bot mana pun yang tertaut" akan diam-diam
membatalkan pemisahan botnya. Konsekuensinya: anggota tim IT yang hanya menautkan
satu bot akan melewatkan satu jenis notifikasi di Telegram — tapi tetap melihatnya
di web.

Kanal `telegram` berarti bot karyawan (nama itu sudah dipakai sejak awal); kanal
`telegram_staff` baru di `0009`.

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

Di Cloudflare, pakai Cron Trigger ke Worker yang sama.

Selain itu, saat user mengirim pesan apa pun ke bot, antreannya ikut dikuras
(`flushNotifications`), jadi notifikasi tetap sampai tanpa cron.

## Keamanan

| Aspek | Penanganan |
| --- | --- |
| Pemalsuan update | Header `X-Telegram-Bot-Api-Secret-Token` wajib cocok; kalau tidak → 401 |
| Update ganda | `telegram_updates` primary key `(bot, update_id)`; retry Telegram diabaikan |
| Update tertukar antar bot | `update_id` adalah urutan **per bot** — dua bot bisa sama-sama mengirim `123456`, dan PK `(bot, update_id)` yang membuat keduanya selamat |
| Sesi tertukar antar bot | `telegram_sessions` PK `(bot, chat_id)`; draft di satu bot tidak dilanjutkan bot lain |
| Klaim akun orang lain | Butuh kode dari sesi web yang sudah login, bukan sekadar email |
| Karyawan memakai bot staf | Kode bot staf tidak bisa dibuat sama sekali; RLS menolak sisanya |
| Akses data | `asUser()` → RLS asli; bot tidak punya jalur istimewa ke tiket |
| Unggahan | MIME dan ukuran divalidasi sama seperti unggahan web |

Route webhook selalu membalas `200` (kecuali secret salah). Membalas `5xx` akan
membuat Telegram mengirim ulang update yang sama terus-menerus.

## Berkas

```
supabase/migrations/0007_telegram.sql   tabel + trigger + fungsi penautan
supabase/migrations/0009_two_bots.sql  telegram_links, audience, routing
lib/telegram/bots.ts                    identitas bot: nama, kanal, nama env var
lib/db/pool.ts                          asUser() — impersonasi untuk RLS
lib/telegram/client.ts                  pemanggilan Bot API (per bot)
lib/telegram/menu.ts                    daftar perintah per bot
lib/telegram/commands.ts                perintah, tombol, alur buat tiket
lib/telegram/session.ts                 penautan, state percakapan, idempotensi
lib/telegram/tickets.ts                 operasi tiket sebagai user
lib/telegram/files.ts                   unduh dari Telegram → Supabase Storage
lib/telegram/attachments.ts             lampirkan foto ke tiket
lib/telegram/webhook.ts                 badan bersama kedua route webhook
app/api/telegram/webhook/route.ts       bot karyawan
app/api/telegram/webhook/staff/route.ts bot tim IT
app/api/telegram/dispatch/route.ts      pengirim notifikasi
components/profile/TelegramPanel.tsx    UI penautan (satu kartu per bot)
scripts/telegram-setup.mjs              daftar/hapus webhook, --bot employee|staff
scripts/telegram-poll.mjs               mode polling untuk lokal, per bot
```

## Pemecahan masalah

**Bot tidak merespons**
`npm run telegram:info` — pastikan URL webhook benar dan `pending_update_count`
tidak terus bertambah. Cek log Worker (`npx wrangler tail`) untuk `[telegram:*]`.

**`pending_update_count` naik terus dan `last_error_message` 500**
Biasanya Worker yang sedang tayang lebih lama dari skema database. Gejalanya:
kode lama menanyakan kolom yang sudah dihapus migrasi baru. Deploy ulang
(`npm run cf:deploy`) dan update tertunda akan diproses sendiri. `last_error_date`
tetap terisi setelah pulih — itu metadata terakhir, bukan status sekarang.

**`chat not found`**
Chat id tidak valid atau user belum pernah menekan Start di bot. User harus
memulai percakapan lebih dulu.

**`409 Conflict: can't use getUpdates method while webhook is active`**
Hapus webhook dulu: `npm run telegram:delete`, atau hentikan `telegram:poll`.

**Kode penautan tidak valid**
Kode berlaku 15 menit dan sekali pakai. Membuat kode baru otomatis membatalkan
kode sebelumnya untuk bot yang sama. Kode bot karyawan tidak berlaku di bot staf.

**Notifikasi tidak terkirim**
Pastikan penerimanya sudah menautkan bot yang benar — bot karyawan untuk
notifikasi `requester`, bot staf untuk `staff`. Kalau tidak, baris itu memang tidak
diantrikan; hanya `web` yang `SENT`. Baris yang gagal tersimpan di
`notification_deliveries` dengan `status = 'FAILED'` dan `last_error`-nya.

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

**Jangan memakai variabel global untuk identitas bot.**

Dua bot hidup di Worker yang sama. Menyimpan bot yang sedang ditangani di variabel
modul akan bocor antar request yang berjalan bersamaan — satu request bot staf bisa
membuat request bot karyawan mengirim pesan sebagai bot yang salah. Karena itu
identitasnya dioper eksplisit sebagai parameter (`BotKind`, `BotContext`) ke
seluruh `client.ts`, `commands.ts`, dan `session.ts`.

**Jangan memakai `create or replace` untuk mengubah signature fungsi.**

`create or replace function public.unlink_telegram(p_bot text, p_chat_id bigint)`
tidak menggantikan `unlink_telegram(bigint)` — Postgres menyimpannya sebagai
**overload kedua**, dan pemanggil lama tetap menemukan yang lama. Setiap fungsi
yang berubah argumennya di `0009` didahului `drop function if exists` dengan
signature lengkap.

**Migrasi harus bisa di-*replay*, bukan cuma idempoten.**

`node scripts/db-push.mjs --schema` menjalankan **semua** file setiap kali, jadi
file yang menyebut kolom yang dihapus file berikutnya akan gagal di run kedua.
Contohnya `0007_telegram.sql` yang dulu menyimpan tautan di
`profiles.telegram_user_id` — kolom itu dihapus `0009`, sehingga badan fungsinya
pindah ke `0009` dan `0007` hanya menyisakan tabelnya. Backfill di `0009` sendiri
dibungkus `do $$ ... $$` yang memeriksa `information_schema.columns` dulu.

**Worker yang tertinggal dari skema akan membalas 500 ke Telegram.**

Pernah kejadian: `0009` sudah dijalankan ke database, tapi Worker yang tayang masih
kode satu-bot yang menanyakan `profiles.telegram_user_id`. Gejalanya bukan error
yang jelas di log, tapi `pending_update_count` yang tidak mau turun dan
`last_error_message: 500 Internal Server Error`. Deploy ulang menyelesaikannya, dan
update tertunda langsung diproses.

## Masuk ke web lewat Telegram

Kalau akun Telegram sudah terhubung, kata sandi tidak perlu diingat lagi.

1. Buka `/auth/telegram` (atau tombol **Sign in with Telegram** di halaman login).
2. Halaman menampilkan kode 8 karakter dan tombol ke tiap bot yang punya username.
3. Tombol itu membuka Telegram dengan kode sudah terisi — tekan **Start**.
4. Tab browser lanjut sendiri dan masuk sebagai akun yang terhubung ke chat itu.

Dari sisi bot, tombol itu mengirim `/start login_KODE`; mengetik
`/login KODE` manual juga jalan. Kode hidup **10 menit** dan sekali pakai.

**Kenapa ini aman.** Kode bukan kredensial milik orang lain. Bot menyelesaikan
pengirimnya lewat `telegram_links` lebih dulu, jadi kode hanya bisa mengikat
akun milik si pengirim. Siapa pun yang menyalin kode dari layar orang lain
paling banter membuat browser itu masuk sebagai dirinya sendiri. Selain itu
browser memegang cookie `it-helpdesk-login` yang diterbitkan bersama kodenya —
tanpa cookie itu kode tidak bisa ditukar. Server lalu mengecek ulang bahwa
profilnya masih aktif dan bukan akun mesin, baru membuat sesi Supabase asli.

Kode disimpan di `web_login_codes`: tanpa policy, tanpa grant ke `anon` maupun
`authenticated`, dan fungsi klaim/pemakaiannya hanya bisa dipanggil
`service_role`.

Karyawan yang belum pernah menghubungkan Telegram tetap pakai email + kata
sandi. Alur itu tidak berubah.
