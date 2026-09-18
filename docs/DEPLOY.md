# Deploy — Cloudflare Workers

Aplikasi ini jalan di **Cloudflare Workers**, bukan cuma di laptop. Web app, REST API
v1, dan bot Telegram semuanya ikut ter-deploy sebagai satu Worker yang sama.

```text
https://it-helpdesk.fiqihbadrian.workers.dev
```

| Item | Nilai |
| --- | --- |
| Worker | `it-helpdesk` |
| Adapter | `@opennextjs/cloudflare` (OpenNext) |
| Config | `wrangler.jsonc` |
| Hyperdrive | `it-helpdesk-db` — `<hyperdrive-id>` |
| Region DB | Tokyo (`ap-northeast-1`) |

## Kenapa OpenNext, bukan vinext

Cloudflare sekarang menyarankan **vinext** sebagai jalur default Next.js di Workers.
Tapi vinext masih beta dan menargetkan **Next.js 16**, sedangkan proyek ini di
Next.js 15.5.25. `@opennextjs/cloudflare` mendukung Next.js 14/15/16, App Router,
route handlers, middleware, Server Actions, dan streaming — semuanya sudah dipakai
di sini. Jadi OpenNext yang dipilih, dan tidak perlu upgrade Next.js.

Satu batasan yang perlu diketahui: **Node.js Middleware (Next 15.2+) belum
didukung**. `middleware.ts` di proyek ini memakai Edge middleware biasa, jadi aman.

## Hyperdrive — dan kenapa caching-nya wajib mati

`lib/db/pool.ts` memakai driver `pg` (TCP langsung ke Postgres). Workers tidak bisa
membuka koneksi TCP biasa, jadi Hyperdrive yang menjembatani:

```jsonc
"hyperdrive": [{ "binding": "HYPERDRIVE", "id": "<hyperdrive-id>" }]
```

Konfigurasi ini dibuat dengan `--caching-disabled`, dan itu **bukan** pilihan
estetika:

> Cache key Hyperdrive hanya **teks SQL + parameter**. Ia tidak tahu apa-apa soal
> `set local role authenticated` maupun `request.jwt.claims`.

Seluruh otorisasi di proyek ini hidup di session state itu. Kalau caching menyala,
dua user berbeda yang menjalankan `select * from tickets` akan mendapat entri cache
yang sama — dan user kedua membaca baris milik user pertama. Dokumentasi Hyperdrive
sendiri menyebut kasus ini: pakai konfigurasi tanpa cache untuk *"authentication,
sessions, permissions"*.

```bash
npx wrangler hyperdrive create it-helpdesk-db \
  --connection-string="postgresql://postgres.<ref>:<password>@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres" \
  --caching-disabled
npx wrangler hyperdrive get <hyperdrive-id>   # caching.disabled harus true
```

### Harus lewat pooler, bukan host `db.`

Host `db.<ref>.supabase.co` **hanya punya record AAAA** (IPv6). Hyperdrive tidak
menjangkau IPv6, jadi koneksi wajib lewat pooler Supabase
(`aws-0-ap-northeast-1.pooler.supabase.com`), dan user-nya berbentuk
`postgres.<ref>` — bukan `postgres`.

### `SET LOCAL` tetap aman

Hyperdrive berjalan dalam **transaction mode**: satu koneksi dipakai selama satu
transaksi, lalu dikembalikan ke pool dan di-`RESET`. Karena `asUser()` memakai
`set local`, identitas pemanggil tidak pernah menempel ke koneksi berikutnya.
Ini sudah diuji langsung ke produksi, bukan cuma dibaca dari dokumen.

## Node vs Workers — satu API, dua runtime

`lib/db/pool.ts` menyembunyikan perbedaannya:

| | Node (`next dev` / `next start`) | Workers |
| --- | --- | --- |
| Koneksi | satu `pg.Pool` di module scope | satu `pg.Client` per panggilan |
| Kenapa | koneksi hangat bertahan antar request | Workers melarang I/O lintas request, jadi pool global akan menyerahkan socket milik request yang sudah selesai |
| Alamat DB | `SUPABASE_DB_URL` | `env.HYPERDRIVE.connectionString` |

Yang dipakai bersama: `asUser()` dan `asSystem()`. Kode pemanggil tidak perlu tahu
sedang jalan di mana.

`asUser()` membuka paling banyak **5 koneksi bersamaan** (Workers membatasi 6 per
invocation). Kalau batas itu tertabrak, errornya menyebut penyebab yang paling
umum: `asUser()` dipanggil dari dalam `asUser()`.

## Deploy

```bash
npm run cf:deploy
```

`cf:deploy` menjalankan **build lalu deploy** (`opennextjs-cloudflare build && ...
deploy`). Urutan itu wajib: perintah `deploy` milik OpenNext **tidak** melakukan
build — ia hanya mengunggah isi `.open-next` yang sudah ada. Menjalankan `deploy`
sendirian akan sukses, mencetak Version ID baru, dan tetap menyajikan kode lama.

Script `scripts/cf.mjs` juga membaca `SUPABASE_DB_URL` dari `.env.local` dan
menyerahkannya sebagai `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE`,
karena OpenNext perlu memutar miniflare lokal untuk membaca binding sebelum deploy.

String koneksi itu **tidak** ditulis ke `wrangler.jsonc` — kalau ditaruh di sana,
password database ikut ter-commit ke git.

Perintah lain:

```bash
npm run cf:build     # build saja, tanpa deploy
npm run cf:preview   # build + jalankan Worker di lokal (localhost:8787)
npm run cf:typegen   # regenerate cloudflare-env.d.ts
```

## Secrets vs vars

**Vars** (`wrangler.jsonc`, boleh publik, ikut ter-commit):

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
NEXT_PUBLIC_TICKET_BUCKET
NEXT_PUBLIC_TELEGRAM_BOT_USERNAME
```

**Secrets** (dashboard Cloudflare, tidak pernah masuk repo):

```text
SUPABASE_SERVICE_ROLE_KEY
TELEGRAM_BOT_TOKEN
TELEGRAM_WEBHOOK_SECRET
DISPATCH_SECRET
```

Pasang sekaligus dari `.env.local`:

```bash
node -e '
const fs=require("fs");
const env=Object.fromEntries(fs.readFileSync(".env.local","utf8").split("\n")
  .map(l=>/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l)).filter(Boolean).map(m=>[m[1],m[2]]));
fs.writeFileSync("/tmp/it-secrets.json", JSON.stringify({
  SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
  TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN ?? env.BOT_TELE,
  TELEGRAM_WEBHOOK_SECRET: env.TELEGRAM_WEBHOOK_SECRET,
  DISPATCH_SECRET: env.DISPATCH_SECRET,
}));
'
npx wrangler secret bulk /tmp/it-secrets.json && rm -f /tmp/it-secrets.json
npx wrangler secret list
```

`NEXT_PUBLIC_*` ditaruh di `wrangler.jsonc` dengan sengaja: nilainya memang ikut
ke browser, dan OpenNext membacanya dari `process.env` saat **runtime**, bukan
hanya saat build.

`wrangler.jsonc` memakai `"keep_vars": true` supaya deploy berikutnya tidak
menghapus variabel yang diisi dari dashboard.

## Bot Telegram setelah deploy

Webhook Telegram itu **per bot token, satu URL**. Cloudflare tidak tahu-menahu soal
Telegram, jadi setelah deploy URL-nya harus didaftarkan sekali:

```bash
TELEGRAM_WEBHOOK_SECRET=<sama seperti di Worker> npm run telegram:setup https://it-helpdesk.fiqihbadrian.workers.dev
npm run telegram:info
```

Sekali daftar, selesai. Worker tidak pernah tidur, jadi bot hidup 24/7 — beda
dengan lokal yang butuh `npm run dev` **dan** `npm run telegram:poll` jalan
bersamaan.

Dua hal yang mudah salah:

1. **Jangan** jalankan `npm run telegram:poll` di produksi. Script itu memanggil
   `deleteWebhook` lebih dulu, jadi webhook produksi ikut terhapus dan bot mati.
2. Kalau `TELEGRAM_WEBHOOK_SECRET` tidak di-set saat setup, script akan membuat
   secret acak. Worker menolak semuanya dengan **401** karena secret-nya beda.
   Set dulu secret-nya di Worker, baru daftarkan webhook.

## Auto-deploy dari GitHub

Repo `fiqihbadrian/IT-Helper` sudah terhubung ke Cloudflare, jadi bisa memakai
**Workers Builds**: push ke `main` → build → deploy, tanpa `npm run cf:deploy`
manual.

Dua syarat yang harus dipenuhi lebih dulu:

- **Build variables and secrets** harus diisi. Build Next.js perlu
  `NEXT_PUBLIC_*` (untuk di-inline) dan `SUPABASE_SERVICE_ROLE_KEY`.
- Nama Worker di dashboard harus sama dengan `name` di `wrangler.jsonc`
  (`it-helpdesk`), kalau tidak build-nya gagal.

## Notifikasi proaktif (belum)

Sekarang notifikasi Telegram bersifat *lazy*: baru terkirim saat user mengirim pesan
ke bot, karena `flushNotifications` dipanggil di jalur masuk. Untuk benar-benar
proaktif, tambahkan Cron Trigger yang memanggil:

```text
POST /api/telegram/dispatch
x-dispatch-secret: $DISPATCH_SECRET
```

Cron Trigger butuh handler `scheduled()` di entrypoint Worker, sedangkan
`.open-next/worker.js` itu file hasil generate. Jadi ini perlu worker entry kustom —
belum dikerjakan.

## Jebakan yang sudah pernah menggigit

**`timeout` tidak ada di macOS.** Pakai `(cmd & echo $! > /tmp/x.pid)`, lalu
`kill $(cat /tmp/x.pid)`.

**Jangan `pkill -f "next-server"` sembarangan.** Mesin ini menjalankan proyek lain
di port 20128 (`next-server v16.3.4`). Matikan berdasarkan PID atau port yang jelas.

**`opennextjs-cloudflare deploy` gagal tanpa connection string Hyperdrive lokal**,
dengan pesan `UserError: When developing locally, you should use a local Postgres
connection string`. Itu sebabnya deploy lewat `npm run cf:deploy`, bukan langsung.

**Ticket number boleh bolong.** `npm run verify` membuat tiket di dalam transaksi
yang di-rollback, tapi `nextval` tetap terpakai. Jadi `IT-000045` muncul setelah
`IT-000038` — itu normal, bukan bug.

**`deploy` tanpa `build` menyajikan kode lama.** `opennextjs-cloudflare deploy`
tidak mem-build apa pun. Kalau `.open-next` tidak lebih baru dari `.next`,
yang ter-deploy adalah versi sebelumnya — dan tidak ada peringatan apa pun.
Itulah kenapa `cf:deploy` selalu build lebih dulu.
