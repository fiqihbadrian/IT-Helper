# Web Widget (Phase 5)

Widget chat yang bisa ditempel ke website mana pun dengan satu baris `<script>`.
Percakapan pengunjung menjadi tiket biasa di antrian yang sama — bukan sistem
terpisah, bukan tabel terpisah, bukan antrian terpisah.

```
pengunjung website
      │  POST /api/widget/v1/session
      ▼
  channels  ──►  tickets (source='widget', channel_id=…)
                   │
                   ├── ticket_contacts   identitas pengunjung (nama, email, IP)
                   ├── ticket_comments   isi percakapan
                   ├── ticket_history    jejak audit
                   └── notifications     ke tim IT, audience='staff'
```

---

## 1. Konsep

| Istilah | Arti |
| --- | --- |
| **Channel** | Satu website yang boleh menempelkan widget. Punya public key, daftar origin yang diizinkan, dan default tiket. |
| **Public key** | `wk_…`. Dikirim ke browser, **memang publik**. Fungsinya menamai channel, bukan memberi akses. |
| **Session token** | Diterbitkan sekali saat percakapan dimulai. Disimpan di `localStorage` pengunjung, di server hanya hash-nya. |
| **Visitor** | Pengunjung website. **Tidak pernah** menjadi akun. |
| **System profile** | Satu profil mesin per channel. Tiket widget dicatat atas nama profil ini. |

### Keputusan utama: pengunjung bukan user

Cara yang kelihatannya paling gampang adalah membuat akun per pengunjung. Itu
salah. Pengunjung bukan karyawan: mereka tidak punya role, tidak punya
departemen, tidak ada urusannya di `/admin/users`, dan tidak boleh muncul di
dropdown "assign to" bersebelahan dengan rekan kerja sungguhan. Jumlah mereka
juga tidak akan pernah berkurang, karena — tidak seperti karyawan — tidak ada
yang bisa menonaktifkan mereka.

Jadi setiap channel punya **satu system profile** (`profiles.is_system = true`),
dan kata-kata pengunjung ditulis atas nama profil itu. Identitas asli pengunjung
hidup di `ticket_contacts`, satu baris per tiket eksternal.

Untungnya:

- **RLS tidak diubah sama sekali.** Request widget berjalan lewat `asUser()` yang
  sama dengan bot Telegram dan REST API, jadi `tickets_insert` dengan
  `created_by = auth.uid()` tetap terpenuhi dan seluruh policy bekerja apa
  adanya. Tidak ada lubang "anonymous" yang harus diaudit.
- **Staf dan pengunjung tetap bisa dibedakan tanpa role baru.** Tiket yang punya
  baris `ticket_contacts` berarti eksternal, dan `tickets.source` menyebutkan
  asalnya.

System profile `is_active = true` (RLS mensyaratkan) dan `is_system = true` —
kolom terakhir inilah yang menyembunyikannya dari daftar user, dari dropdown
assignee, dan dari tabel notifikasi.

---

## 2. Setup

### 2.1 Buat channel

Masuk sebagai admin → **Admin → Channels → New channel**.

| Field | Keterangan |
| --- | --- |
| Name | Nama channel, muncul di judul tiket dan di timeline. |
| Accent colour | Warna launcher dan gelembung pesan pengunjung. |
| Allowed origins | Satu origin per baris, mis. `https://example.com`. Boleh tanpa skema — otomatis ditambah `https://`. |
| Greeting | Kalimat pembuka di dalam panel. |
| Default priority | Prioritas tiket baru dari channel ini. |
| Default category | Kategori tiket baru. |
| Department | Departemen tiket baru. |

Menyimpan channel akan membuat, dalam satu langkah:

1. satu baris `auth.users` dengan email `<slug>@widget.local` dan password acak
   yang tidak pernah ditampilkan,
2. satu baris `profiles` dengan `is_system = true`, `role = 'employee'`,
3. satu baris `channels` beserta public key `wk_…`.

Akun tersebut ada semata-mata karena `profiles.id` punya foreign key ke
`auth.users`. Akun itu tidak bisa dipakai login.

### 2.2 Tempel snippet

Halaman channel menampilkan snippet yang tinggal disalin:

```html
<script src="https://<host-anda>/widget.js" data-key="wk_…" async></script>
```

Letakkan tepat sebelum `</body>`. Host di snippet diambil dari origin yang sedang
Anda buka, jadi snippet otomatis benar di local maupun di production.

Atribut opsional:

| Atribut | Default | Fungsi |
| --- | --- | --- |
| `data-key` | — | **Wajib.** Public key channel. |
| `data-base` | origin `widget.js` | Base URL API. Berguna kalau file `widget.js` disajikan dari CDN lain. |

---

## 3. Alur percakapan

1. Widget **tidak melakukan request apa pun** sampai pengunjung mengklik
   launcher. Halaman yang tidak pernah dipakai tidak membebani apa pun.
2. Klik pertama → `GET /config` → nama, greeting, warna.
3. Pengunjung mengisi nama + email dan menulis pesan → `POST /session`:
   - satu tiket `source='widget'`, `channel_id=<channel>`, `created_by=<system profile>`
   - satu baris `ticket_contacts` (nama, email, IP, user agent, page URL)
   - satu komentar pertama
   - satu `widget_sessions` dengan hash token
   - satu token dikembalikan **hanya sekali**
4. Widget menyimpan token di `localStorage` dengan key `itw.token.<public key>`,
   lalu polling `GET /messages` setiap 4 detik.
5. Balasan tim IT muncul sebagai komentar biasa di tiket yang sama. Tidak ada
   jalur khusus: staf menjawab dari halaman tiket web seperti tiket lain.
6. Pengunjung membalas → `POST /messages` → komentar baru + notifikasi
   `audience='staff'` ke seluruh bench.

Kalau staf menutup tiket (`CLOSED`) atau menandainya `RESOLVED`, widget
menampilkan catatan peringatan dan menonaktifkan composer.

---

## 4. HTTP API

Base: `<host>/api/widget/v1`. Semua respons berformat `{ ok, data }` atau
`{ ok, error: { code, message, details? } }`.

Header:

| Header | Kapan | Isi |
| --- | --- | --- |
| `X-Widget-Key` | Semua request | Public key channel |
| `X-Widget-Token` | `/messages` | Session token |
| `Origin` | Otomatis oleh browser | Dicek terhadap `allowed_origins` |

### `GET /config`

```bash
curl -H "Origin: https://example.com" \
     -H "X-Widget-Key: wk_…" \
     https://<host>/api/widget/v1/config
```

```json
{ "ok": true, "data": { "name": "Demo Site", "greeting": "Halo! Ada yang bisa kami bantu?", "accentColor": "#0ea5e9" } }
```

### `POST /session`

```bash
curl -X POST https://<host>/api/widget/v1/session \
  -H "Origin: https://example.com" \
  -H "X-Widget-Key: wk_…" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Dewi Lestari",
    "email": "dewi@example.com",
    "message": "Printer di lantai 3 tidak bisa mencetak.",
    "visitorRef": "v-abc123",
    "pageUrl": "https://example.com/kontak"
  }'
```

`201` dengan `{ token, conversation, messages }`. `token` tidak akan pernah
ditampilkan lagi.

### `GET /messages`

```bash
curl "https://<host>/api/widget/v1/messages?since=2026-09-19T00:00:00Z" \
  -H "Origin: https://example.com" \
  -H "X-Widget-Key: wk_…" \
  -H "X-Widget-Token: <token>"
```

`since` opsional (ISO 8601). Tiket **tidak pernah** diambil dari request —
selalu dari baris `widget_sessions`.

### `POST /messages`

```bash
curl -X POST https://<host>/api/widget/v1/messages \
  -H "Origin: https://example.com" \
  -H "X-Widget-Key: wk_…" \
  -H "X-Widget-Token: <token>" \
  -H "Content-Type: application/json" \
  -d '{"message": "Ada update?"}'
```

### Error

| Status | Code | Arti |
| --- | --- | --- |
| 400 | `bad_request` | Body bukan JSON, nama/email/pesan tidak valid, `since` salah format |
| 401 | `unauthorized` | `X-Widget-Key` tidak ada / tidak dikenal, atau token tidak ada / kedaluwarsa |
| 403 | `forbidden` | Origin tidak diizinkan, channel dimatikan, atau token milik channel lain |
| 429 | `rate_limited` | Terlalu banyak pesan atau percakapan |
| 500 | `internal_error` | Kesalahan tak terduga |

---

## 5. Keamanan

**Public key memang publik.** Nilainya bisa dibaca siapa saja yang membuka
View Source. Karena itu `allowed_origins` bukan tembok — itu ganjalan yang
membuat orang jujur tetap jujur. Yang benar-benar melindungi:

| Mekanisme | Detail |
| --- | --- |
| **Binding sesi** | Satu baris `widget_sessions` terikat pada **tepat satu** `ticket_id`. `GET /messages` membaca kolom itu, tidak pernah dari request. Tidak ada tiket yang bisa disebut, jadi tidak ada yang bisa ditebak. |
| **Origin check** | `allowed_origins` kosong = **tolak semua** (fail closed). Berisi `"*"` = izinkan semua. |
| **Rate limit per IP** | Maksimum 15 percakapan baru per jam per IP, dihitung dari `ticket_contacts.visitor_ip`. |
| **Rate limit per tiket** | Maksimum 20 pesan per menit per tiket, dihitung dari `ticket_comments`. |
| **Batas panjang pesan** | 4000 karakter. |
| **Token sekali pakai** | Disimpan sebagai sha256; dump database tidak berisi apa pun yang bisa diputar ulang. |
| **Kedaluwarsa** | Token berlaku 30 hari. |

Rate limit dihitung **di database**, bukan di memori Worker. Memori isolate
Cloudflare bersifat per-isolate dan berumur pendek — penghitung di memori bisa
dilewati hanya dengan memicu cold start. Jumlah baris tidak bisa.

`clientIp()` memakai `cf-connecting-ip` lebih dulu (diisi Cloudflare, tidak bisa
dipalsukan), dan `x-forwarded-for` hanya sebagai fallback saat development.

### Kalau key bocor

Jangan hapus channel — **matikan** (Switch off). Channel nonaktif menolak semua
request seketika, tetapi seluruh tiket dan riwayatnya tetap utuh untuk audit.
Menghapus channel yang sudah punya tiket diblokir oleh foreign key, dan itu
memang disengaja.

---

## 6. Keterbatasan versi ini

- **Teks saja.** Pengunjung belum bisa mengirim lampiran. Tiket yang dibuat dari
  widget tetap bisa dilampiri file oleh staf dari halaman tiket.
- **Belum ada Turnstile.** Kalau channel mulai disalahgunakan, langkah
  berikutnya adalah menambahkan verifikasi Turnstile di `POST /session`.
- **Belum ada notifikasi realtime.** Widget polling tiap 4 detik; tidak ada
  WebSocket. Cukup untuk percakapan helpdesk, dan jauh lebih murah.
- **Satu percakapan per pengunjung per channel.** Token di `localStorage`
  mengikat satu percakapan aktif; membersihkan storage berarti memulai
  percakapan baru.

---

## 7. Berkas terkait

| Berkas | Isi |
| --- | --- |
| `supabase/migrations/0010_channels.sql` | Tabel `channels`, `ticket_contacts`, `widget_sessions`, `notify()`, `ticket_actor_name()`, RLS |
| `lib/widget/keys.ts` | Pembuatan public key & session token, hashing, pembacaan header |
| `lib/widget/channels.ts` | Resolusi channel dari key, pengecekan origin |
| `lib/widget/cors.ts` | CORS, pembungkus route, preflight |
| `lib/widget/rate.ts` | Rate limit pesan & percakapan, deteksi IP |
| `lib/widget/sessions.ts` | Cari / sentuh / buat sesi |
| `lib/widget/conversations.ts` | Buat tiket, tambah pesan, baca percakapan |
| `app/api/widget/v1/**` | Route HTTP |
| `public/widget.js` | Widget sisi browser (vanilla, shadow DOM, tanpa dependensi) |
| `services/channels.ts` | Daftar channel + jumlah tiket |
| `app/actions/channels.ts` | Server action create / update / toggle / delete |
| `components/admin/ChannelManager.tsx` | UI admin |

---

## 8. Uji cepat

```bash
# 1. config
curl -s -H "Origin: https://example.com" -H "X-Widget-Key: wk_…" \
  http://localhost:3000/api/widget/v1/config

# 2. mulai percakapan
TOKEN=$(curl -s -X POST http://localhost:3000/api/widget/v1/session \
  -H "Origin: https://example.com" -H "X-Widget-Key: wk_…" \
  -H "Content-Type: application/json" \
  -d '{"name":"Dewi","email":"dewi@example.com","message":"Halo"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['token'])")

# 3. baca
curl -s -H "Origin: https://example.com" -H "X-Widget-Key: wk_…" \
  -H "X-Widget-Token: $TOKEN" http://localhost:3000/api/widget/v1/messages
```

Cek juga di **Admin → Channels**: jumlah tiket per channel, dan di
**Tickets → All** tiket muncul dengan badge `via widget` dan nama pengunjung.

`npm run verify` menutup bagian widget dengan 18 pemeriksaan di level basis
data (tanpa perlu server jalan): profil mesin bisa dibuat, `source` dan
`channel_id` harus sepakat, `notify()` melewati profil mesin, nama pengunjung
muncul di `ticket_actor_name()`, RLS `ticket_contacts` dan `widget_sessions`,
serta channel bertiket tidak bisa dihapus.

Yang **belum** tercakup tes otomatis: empat server action di
`app/actions/channels.ts`. Semuanya tipis — `assertAdmin()`, validasi zod, lalu
query — dan sudah diverifikasi manual sekali (buat, ubah, matikan, hapus, plus
penolakan hapus saat sudah ada tiket).
