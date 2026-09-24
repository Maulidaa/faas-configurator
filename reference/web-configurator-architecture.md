# Web Configurator — Referensi Arsitektur & Fungsi (v1)

> Dokumen ini adalah rujukan fungsional untuk bagian `web/` dalam monorepo FC. Desain visual/UI styling **sengaja diabaikan** — fokus dokumen ini adalah kontrak fungsi, struktur modul, dan batas tanggung jawab tiap bagian, supaya beberapa orang/model bisa mengerjakan modul berbeda secara paralel tanpa saling bentrok logika.
>
> Prinsip utama: **tiap modul punya satu tanggung jawab dan satu kontrak tipe (interface) yang dibekukan lebih dulu**. Selama kontrak tipe tidak berubah, implementasi di dalam modul boleh diubah bebas tanpa memengaruhi modul lain.

---

## 1. Ruang Lingkup v1

Web configurator v1 hanya mencakup tiga alur fungsional:

1. **DFU firmware upload** — flash firmware baru ke device via WebUSB DFU.
2. **Konfigurasi setting & feature toggle** — baca/tulis setting device via schema generik.
3. **Definisi misi offline** — buat/edit waypoint di peta, tanpa live monitoring atau GCS real-time.

Tidak ada backend. Semua komunikasi terjadi langsung dari browser ke device via WebUSB/WebSerial. Target browser: **Chromium-only** (Chrome/Edge/Brave/Opera) karena WebUSB/WebSerial belum didukung Firefox/Safari — perlu deteksi fitur dan pesan fallback yang jelas jika browser tidak didukung.

---

## 2. Tech Stack

| Bagian | Pilihan | Catatan |
|---|---|---|
| Framework | React 18 + TypeScript (strict mode) | |
| Build tool | Vite | |
| Deploy | GitHub Pages (static hosting, HTTPS) | Perlu `base` path di `vite.config.ts` sesuai nama repo, kecuali pakai custom domain |
| State management | Zustand | Dipilih karena ringan, tanpa boilerplate, dan mudah dipecah jadi store per-fitur (penting untuk kerja paralel) |
| Peta | Leaflet + `react-leaflet`, tile OpenStreetMap | Tanpa API key |
| Routing | **Tidak pakai router** | 3 alur (DFU/Settings/Mission) cukup sebagai tab/state switch dalam satu halaman. Ini sengaja menghindari masalah SPA routing di GitHub Pages (404 fallback trick) |
| Testing | Vitest + React Testing Library | Unit test untuk protokol, komponen di-test dengan mock device |
| Lint boundary | `eslint-plugin-boundaries` (atau setara) | Menegakkan aturan folder di Bagian 3 secara otomatis |

---

## 3. Struktur Folder & Aturan Modularitas

```
web/
  src/
    core/
      transport/        # I/O mentah: WebUSB / WebSerial
      protocol/          # Framing, encode/decode, CRC8, parser byte-stream
      commands/          # Registry command ID + tipe payload (sinkron dengan docs/protocol.md)
      device/            # DeviceClient — API tingkat tinggi gabungan transport+protocol+commands
      mock/              # Mock transport & mock device untuk dev/test tanpa hardware
    features/
      connection/        # UI + store status koneksi device
      dfu/               # Alur upload firmware
      settings/          # Alur konfigurasi setting (SchemaField)
      mission/           # Alur perencanaan misi offline
    shared/
      types/             # Tipe lintas-modul (DeviceStatus, ArmedState, dll)
      utils/             # Fungsi murni (konversi lat/lon, format angka, dll)
      hooks/             # React hooks lintas-fitur
    store/               # Komposisi root store (jika diperlukan menggabungkan slice Zustand)
  public/
```

**Aturan wajib (ditegakkan lint, bukan sekadar konvensi):**

- Folder di `features/*` **tidak boleh** saling import satu sama lain secara langsung (`features/dfu` tidak boleh `import` dari `features/settings`, dst).
- Folder di `features/*` hanya boleh bergantung pada `core/*` dan `shared/*`.
- Semua akses ke device (kirim/terima command) **wajib** lewat `core/device/DeviceClient` — tidak ada fitur yang boleh membuat frame mentah atau memanggil transport langsung.
- Perubahan pada `docs/protocol.md` hanya berdampak ke `core/protocol/constants.ts` dan `core/commands/registry.ts`. Modul lain tidak perlu diubah kalau kontrak tipe command tidak berubah.

Implikasi praktis: **langkah pertama sebelum siapa pun mulai coding fitur adalah membekukan interface di Bagian 4.** Setelah itu, tiap orang/model bisa membangun fiturnya sendiri melawan mock device (Bagian 13) tanpa menunggu modul lain selesai.

---

## 4. Kontrak Tipe Inti (dibekukan dulu, sebelum implementasi fitur)

### 4.1 Transport

```ts
// core/transport/Transport.ts
export type TransportKind = 'webusb-normal' | 'webusb-dfu' | 'webserial';

export interface TransportEvents {
  onData: (chunk: Uint8Array) => void;
  onDisconnect: () => void;
  onError: (err: TransportError) => void;
}

export interface Transport {
  readonly kind: TransportKind;
  requestDevice(): Promise<void>;   // memicu device picker browser
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  send(data: Uint8Array): Promise<void>;
  setEventHandlers(events: Partial<TransportEvents>): void;
}

export class TransportError extends Error {
  constructor(public code: 'no-device' | 'permission-denied' | 'io-error' | 'unsupported-browser', message: string) {
    super(message);
  }
}
```

> **Terkonfirmasi dari kode firmware (`usb_cdc_if.c/h`):** mode normal memang **USB CDC-ACM tunggal, non-composite**, sesuai `protocol.md` Bagian 1 ("Transport v1 murni USB CDC") — `WebSerialTransport` adalah pilihan yang benar untuk mode normal, tidak perlu diubah. VID:PID saat ini `0x0483:0x5740` tapi **masih placeholder** (ditandai TODO oleh firmware, menunggu keputusan final di `protocol.md` Bagian 12/checklist K) — jangan hardcode nilai ini di banyak tempat, taruh di satu konstanta (`core/transport/constants.ts`) yang gampang diganti begitu final, atau lewati filter VID:PID sama sekali dan biarkan user pilih port manual (device akan tampil dengan nama "FC-CDC" di picker browser, sesuai `iProduct` string descriptor firmware). **Catatan filter DFU:** VID `0x0483` yang dipakai firmware ini **sama** dengan vendor ID bootloader DFU STM32 (`0x0483:0xDF11`) — filter `WebUSBTransport` untuk mode DFU wajib cocokkan VID **dan** PID sekaligus, VID saja tidak cukup untuk membedakan device CDC dari device DFU.

### 4.2 Frame & Protokol

```ts
// core/protocol/frame.ts
export interface Frame {
  commandId: number;      // uint16
  payload: Uint8Array;
}

export function encodeFrame(frame: Frame): Uint8Array;
export function crc8Dvbs2(bytes: Uint8Array, initial?: number): number;

export class ProtocolError extends Error {
  constructor(public code: 'crc-mismatch' | 'payload-too-large' | 'resync', message: string) {
    super(message);
  }
}

export class FrameParser {
  feed(chunk: Uint8Array): void;                       // panggil tiap kali transport.onData
  onFrame(cb: (frame: Frame) => void): void;
  onFrameError(cb: (err: ProtocolError) => void): void; // frame korup di-drop + resync ke preamble berikutnya, tidak melempar exception ke pemanggil
}
```

```ts
// core/protocol/constants.ts — SATU-SATUNYA tempat nilai ini didefinisikan
export const PROTOCOL_VERSION = 1;                       // TBD, sinkron docs/protocol.md
export const PREAMBLE_BYTES = new Uint8Array([0xFA, 0xFC]); // PLACEHOLDER — ganti begitu protocol.md fix
export const MAX_PAYLOAD_SIZE = 256;                      // PLACEHOLDER
export const BYTE_ORDER: 'little-endian' | 'big-endian' = 'little-endian'; // PLACEHOLDER
```

Format frame yang sudah disepakati secara filosofi (meniru MSP, namespace & command ID sendiri): `preamble | length payload | command ID (16-bit) | payload | CRC8 DVB-S2`. Nilai persis preamble, endianness, dan apakah ada sequence number/ACK per command **masih menunggu finalisasi `docs/protocol.md`** — lihat Bagian 21.

### 4.3 Command Registry

```ts
// core/commands/registry.ts
export interface CommandDef<TRequest, TResponse> {
  id: number;
  name: string;
  encodeRequest(req: TRequest): Uint8Array;
  decodeResponse(payload: Uint8Array): TResponse;
}
```

Aturan: **tidak ada fitur yang membangun payload biner secara manual.** Setiap command baru didefinisikan sekali di `core/commands/registry.ts` mengikuti pola `CommandDef`, lalu fitur cukup memanggil lewat `DeviceClient.sendCommand(...)`.

### 4.4 DeviceClient

```ts
// core/device/DeviceClient.ts
export interface DeviceClient {
  connect(transport: Transport): Promise<void>;
  disconnect(): Promise<void>;
  sendCommand<TReq, TRes>(
    cmd: CommandDef<TReq, TRes>,
    req: TReq,
    opts?: { timeoutMs?: number }
  ): Promise<TRes>;
  getStatus(): DeviceStatus | null;
  on(event: 'connectionChange' | 'statusUpdate' | 'unsolicited', cb: (...args: any[]) => void): void;
  off(event: string, cb: (...args: any[]) => void): void;
}
```

### 4.5 Tipe Lintas-Modul (`shared/types`)

```ts
export interface DeviceStatus {
  armed: boolean;
  firmwareVersion: string;
  protocolVersion: number;
  batteryVoltage: number;
  gpsFixType: 'no-fix' | '2d' | '3d';
}

export type SettingFieldType = 'number' | 'bool' | 'enum' | 'string' | 'bitmask' | 'group';

export interface SettingFieldSchema {
  key: string;
  label: string;
  type: SettingFieldType;
  description?: string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  enumOptions?: { value: number; label: string }[];
  bitmaskFlags?: { bit: number; label: string }[];
  children?: SettingFieldSchema[];     // untuk type: 'group'
  readonlyWhenArmed?: boolean;         // wajib true untuk output-mapping & safety feature toggle
}

export interface Waypoint {
  id: string;
  seq: number;
  latE7: number;        // fixed-point int32, skala 1e7 — sama persis dengan representasi firmware
  lonE7: number;
  altitudeM: number;
  action?: WaypointAction;
}

export type WaypointAction = { type: 'waypoint' } | { type: 'rth' } | { type: 'loiter'; radiusM: number };
```

Konversi lat/lon float ⟷ fixed-point **hanya boleh terjadi di satu tempat** (`shared/utils/geo.ts`): `toLatLonFloat(latE7, lonE7)` dan `fromLatLonFloat(lat, lon)`. UI peta selalu bekerja dengan float; serialisasi ke command selalu lewat fungsi ini.

---

## 5. Lapisan Transport (`core/transport/`)

- `WebUSBTransport` — dipakai untuk mode DFU. Filter device via VID:PID bootloader STM32 default (`0x0483:0xDF11`) untuk deteksi otomatis kalau device sudah dalam mode DFU (misalnya lewat tombol BOOT0 fisik), tanpa perlu command `REBOOT_DFU` dulu.
- `WebSerialTransport` — dipakai untuk mode normal (command protocol). Menangani baud rate (nilai `baudRate` di `port.open()` tidak krusial secara fungsional — firmware CDC-ACM menyimpan line coding tapi tidak memakainya secara elektris; isi angka apa pun konsisten, misal 115200), buffering, dan meneruskan byte mentah ke `FrameParser`.
- Kedua transport mengimplementasikan interface `Transport` yang sama (Bagian 4.1) — kode di `core/device` dan `features/*` tidak perlu tahu transport mana yang sedang aktif.
- Deteksi dukungan browser: cek `navigator.usb` dan `navigator.serial` sebelum menawarkan tombol connect. Kalau tidak ada, tampilkan pesan "browser tidak didukung" (bukan error diam-diam).

---

## 6. Lapisan Protokol (`core/protocol/`)

- `FrameParser` bekerja sebagai stream parser: menerima potongan byte kapan saja (WebSerial/WebUSB tidak menjamin satu event = satu frame utuh), menyimpan buffer internal, mencari preamble, validasi panjang & CRC8 DVB-S2, lalu memancarkan `Frame` yang sudah valid lewat callback `onFrame`.
- Kalau CRC gagal atau panjang tidak masuk akal: buang byte sampai preamble berikutnya ditemukan (resync), panggil `onFrameError`, **jangan** melempar exception yang menghentikan parser — device tetap harus bisa mengirim frame berikutnya.
- **Batas atas buffer internal wajib ada.** Kalau data yang masuk ternyata bukan frame protokol sama sekali (misalnya nyasar log debug UART), preamble valid mungkin tidak akan pernah ditemukan, dan buffer bisa tumbuh tanpa batas kalau hanya mengandalkan "tunggu sampai ketemu preamble". Aturan: begitu ukuran buffer melewati kira-kira 2-3× ukuran frame maksimum (`preamble + length + command ID + MAX_PAYLOAD_SIZE + CRC`), buang byte dari depan sampai ukurannya turun lagi di bawah batas itu, jangan menunggu preamble ketemu secara alami.
- CRC8 DVB-S2: algoritma standar (polynomial `0xD5`, tanpa reflect), sama dengan yang dipakai keluarga protokol MSP — bisa diimplementasikan sebagai fungsi murni tanpa state.

---

## 6.1 Dua Pola Multi-Frame: Pagination vs Chunking (`core/device/`)

"Chunking" sebenarnya dua masalah berbeda bentuk, tidak boleh dipaksakan jadi satu kontrak generik:

- **Pagination (device → client)** — satu request logis dibalas banyak frame, dipakai untuk `CMD_SETTING_SCHEMA_LIST` dan command sejenis yang responsnya berpotensi besar (misal daftar setting FC yang gampang ratusan field). Pola: setiap frame balasan bawa flag `hasMore` + index; helper `sendPaginatedCommand` di `core/device/` loop mengirim "next page" sampai `hasMore = false`, lalu menggabungkan semua hasil jadi satu array sebelum dikembalikan ke pemanggil.
- **Chunking (client → device)** — satu operasi logis dipecah jadi banyak request, dipakai untuk `CMD_MISSION_UPLOAD`. Jumlah chunk sudah diketahui di awal (bukan `hasMore`), yang dibutuhkan adalah ack per-chunk dan retry-on-loss. Helper `sendChunkedCommand` di `core/device/` menangani pemecahan payload, pengiriman berurutan, dan retry per chunk yang gagal ack.

Keduanya dipakai lewat `core/device/`, dan **fitur (`features/settings`, `features/mission`) tidak pernah tahu ada pagination/chunking sama sekali** — mereka cukup memanggil satu fungsi dan menerima hasil yang sudah utuh, persis semangat yang sama dengan Bagian 13.

---

## 7. Command Registry (`core/commands/`)

- Satu file per grup command (misal `settingCommands.ts`, `dfuCommands.ts`, `missionCommands.ts`, `statusCommands.ts`), semuanya diekspor lewat `registry.ts` sebagai satu objek gabungan.
- Command ID 16-bit — daftar ID pasti mengikuti `docs/protocol.md` begitu difinalkan. Sampai saat itu, gunakan placeholder ID yang jelas ditandai `// TODO: sinkron docs/protocol.md` supaya mudah dicari-ganti.
- Command minimal yang sudah pasti dibutuhkan v1 (nama sementara, ID belum final):
  - `CMD_GET_STATUS` — baca `DeviceStatus` (termasuk flag armed).
  - `CMD_SETTING_SCHEMA_LIST` — firmware mengirim daftar `SettingFieldSchema` (self-describing, bukan hardcode di web).
  - `CMD_SETTING_GET` / `CMD_SETTING_SET` / `CMD_SETTING_COMMIT`.
  - `CMD_REBOOT_DFU`.
  - `CMD_MISSION_UPLOAD` (kemungkinan perlu chunking kalau jumlah waypoint besar — lihat Bagian 21).

---

## 8. DeviceClient (`core/device/`)

- Menggabungkan `Transport` + `FrameParser` + `commands/registry` jadi satu API berbasis Promise: `sendCommand` mengirim frame lalu menunggu frame balasan yang cocok.
- **Kebijakan default sebelum ada sequence number resmi di wire protocol (single in-flight + generation token):**
  - Hanya **satu command dalam status pending** pada satu waktu — `sendCommand` berikutnya diantrekan, tidak dikirim bersamaan.
  - Tiap request yang dikirim diberi **token/generasi lokal** (counter internal, tidak ikut dikirim di wire). Frame balasan yang cocok dengan command ID yang sedang ditunggu di-resolve ke request dengan token itu.
  - Kalau `CommandTimeoutError` terjadi, token itu ditandai *abandoned* dan slot pending dikosongkan. Frame yang datang belakangan saat **tidak ada request lain yang pending** otomatis jatuh ke jalur unsolicited (dibuang/di-log), bukan salah me-resolve promise mana pun.
  - **Batasan yang perlu disadari:** token ini murni bookkeeping di sisi client, tidak ikut terkirim di wire — jadi ia *tidak* bisa membedakan balasan basi milik request yang sudah timeout dari balasan sah untuk request baru, **kalau keduanya kebetulan sama-sama command ID yang sama dan request baru itu terlanjur dikirim sebelum balasan basi tiba**. Untuk kasus retry cepat dengan command ID yang sama, tambahkan **jeda drain** (misal beberapa ratus ms tanpa frame masuk) sebelum slot yang baru saja abandoned benar-benar dianggap aman dipakai ulang. Penutupan yang sepenuhnya tanpa ambiguitas hanya mungkin kalau wire protocol punya request-id/sequence number sendiri — lihat Bagian 21.
- Timeout per command bisa dioverride, default disimpan sebagai konstanta tunggal (misal 1000 ms) di `core/device/constants.ts`.
- Event `statusUpdate` dipancarkan setiap kali `DeviceStatus` baru diterima (baik dari polling manual maupun push, tergantung keputusan protokol) — semua fitur yang butuh tahu status `armed` (Settings, Mission) berlangganan event ini, **tidak** melakukan request `CMD_GET_STATUS` sendiri-sendiri.
- Saat `disconnect()` atau `TransportError` terjadi, `DeviceClient` memancarkan `connectionChange` dengan status `disconnected` — semua store fitur wajib bereaksi terhadap event ini (reset state yang butuh device live, tapi **tidak** menghapus draft misi/setting yang belum disimpan).

---

## 9. State Management

- Satu Zustand store per fitur, masing-masing didefinisikan di dalam folder fitur itu sendiri:
  - `features/connection/connectionStore.ts` — status koneksi, info device, `DeviceStatus` terakhir.
  - `features/dfu/dfuStore.ts` — file terpilih, progress upload, state (`idle | validating | flashing | verifying | done | error`).
  - `features/settings/settingsStore.ts` — schema hasil `CMD_SETTING_SCHEMA_LIST`, nilai saat ini, nilai draft (belum di-commit), flag `armed` (dibaca dari `connectionStore`, bukan disalin manual).
  - `features/mission/missionStore.ts` — daftar `Waypoint[]`, status upload ke device.
- Komunikasi antar-fitur **hanya** lewat `DeviceClient` events atau tipe di `shared/types` — tidak ada store yang import store fitur lain secara langsung.

---

## 10. Fitur: Koneksi Device (`features/connection/`)

Alur fungsi:
1. Cek dukungan browser (`navigator.usb`/`navigator.serial`).
2. Tombol "Connect" → `transport.requestDevice()` (memicu picker native browser) → `transport.connect()` → `deviceClient.connect(transport)`.
3. Setelah konek, otomatis request `CMD_GET_STATUS` sekali untuk populate `DeviceStatus` awal.
4. Tampilkan status: disconnected / connecting / connected / error, plus info armed/disarmed yang dipakai fitur lain sebagai guard.

---

## 11. Fitur: DFU Firmware Upload (`features/dfu/`)

Alur fungsi:
1. User pilih file `.bin`.
2. Validasi file: ukuran tidak melebihi batas flash (perlu konfirmasi varian chip — STM32F411CEU6 = 512KB atau STM32F411CCU6 = 256KB — simpan sebagai konstanta yang bisa diubah, bukan angka hardcode di tengah logika).
3. Kalau device sedang terkoneksi via WebSerial (mode normal): kirim `CMD_REBOOT_DFU`, lalu tampilkan state eksplisit "device reboot ke mode DFU — klik untuk pilih device" di UI. **Ini bukan proses otomatis/pasif** — begitu STM32 reboot ke bootloader, ia re-enumerasi dengan VID:PID berbeda (`0x0483:0xDF11` vs mode normal), yang dari sudut pandang WebUSB adalah device baru sama sekali; izin yang sudah diberikan untuk device mode-normal tidak ikut terbawa, dan `requestDevice()` wajib dipanggil dari user gesture (klik) — tidak bisa dipicu otomatis setelah sekadar "menunggu device muncul". State machine wajib punya tahap terpisah untuk ini.
4. Kalau device sudah dalam mode DFU dari awal (BOOT0 fisik): langsung tawarkan `requestDevice()` dengan filter VID:PID DFU.
5. Tulis firmware ke alamat flash `0x08000000`. **Catatan penting:** ini bukan protokol DFU generik (usb.org) — spec DFU generik tidak punya konsep alamat memori sama sekali. Yang dipakai adalah **DfuSe**, ekstensi milik ST (didokumentasikan di AN3156): sebelum menulis data, kirim command lewat `DFU_DNLOAD` block 0 — `Set Address Pointer` (0x21) dan `Erase`/`Mass Erase` (0x41). Idealnya parse memory-layout string descriptor dari alternate setting device (bukan hardcode ukuran sector), karena STM32F4 punya sector flash tidak seragam (sector 0-3 = 16KB, sector 4 = 64KB, sector 5+ = 128KB) — granularitas erase yang salah adalah sumber bug umum di sini. Progress upload dilaporkan ke `dfuStore` per chunk.
6. Verifikasi: **catatan penting** — kalau firmware mengaktifkan Read-Out Protection (RDP) level ≥1, baca-ulang-flash-lalu-bandingkan tidak akan bisa jalan sama sekali (RDP memblokir baca flash lewat DFU). CRC/hash yang dihitung web sendiri dari data yang *dikirim* juga tidak cukup — itu cuma membuktikan integritas jalur transport, bukan apa yang benar-benar tersimpan di flash (erase gagal sebagian atau sel rusak tetap lolos). Verifikasi yang jujur butuh command baru dari firmware: "hitung hash/CRC dari region flash X", dijalankan device sendiri, lalu dibandingkan dengan hash yang web hitung dari file `.bin` — ini butuh koordinasi dengan firmware (lihat Bagian 21) dan levelnya (RDP 0/1) perlu diputuskan lebih dulu karena downgrade RDP sendiri men-trigger mass erase.
7. State machine eksplisit: `idle → device-selected → erasing → writing → verifying → done` atau `error` di titik mana pun, dengan pesan error yang jelas per tahap (bukan satu pesan generik "gagal flashing").

---

## 12. Fitur: Settings / Config (`features/settings/`)

Alur fungsi:
1. Saat device konek, kirim `CMD_SETTING_SCHEMA_LIST` → simpan array `SettingFieldSchema[]` di `settingsStore`.
2. Kirim `CMD_SETTING_GET` untuk populate nilai saat ini sesuai schema.
3. Komponen `SchemaField` (generik) merender input yang sesuai berdasarkan `field.type` — **tidak ada kode UI yang menyebut nama setting spesifik secara hardcode.** Menambah setting baru di firmware seharusnya otomatis muncul di web tanpa ubah kode UI, selama firmware mengirim schema yang benar.
4. Perubahan nilai disimpan sebagai draft dulu (belum langsung `CMD_SETTING_SET`) — tombol "Apply" mengirim semua perubahan, tombol terpisah "Commit to Flash" mengirim `CMD_SETTING_COMMIT`. Ini mencerminkan pemisahan firmware antara "setting di RAM" vs "tersimpan permanen".
5. **Guard armed-state di level UI**: field dengan `readonlyWhenArmed: true` (output-mapping, toggle fitur keselamatan seperti RTH/failsafe) di-render disabled kalau `DeviceStatus.armed === true`, dengan tooltip/pesan yang menjelaskan kenapa. ini cermin dari guard yang sama di firmware — web tidak menggantikan validasi firmware, hanya mencegah user mencoba hal yang pasti ditolak.

---

## 13. Fitur: Mission Planning Offline (`features/mission/`)

Alur fungsi:
1. Peta Leaflet + tile OSM, tanpa perlu device terkoneksi untuk membuat/edit misi.
2. CRUD waypoint: tambah lewat klik peta atau lewat form, edit posisi (drag marker atau input angka), hapus, reorder urutan (`seq`).
3. Semua waypoint disimpan sebagai float lat/lon di `missionStore`; konversi ke `latE7`/`lonE7` (fixed-point 1e7) hanya terjadi saat serialisasi ke command — lihat `shared/utils/geo.ts` (Bagian 4.5).
4. Persistensi draft: simpan ke `localStorage`/`IndexedDB` otomatis supaya tidak hilang kalau tab ditutup; ada fungsi export/import JSON untuk backup manual antar sesi/komputer.
5. Upload ke device: tombol terpisah dari "save draft" — mengirim `CMD_MISSION_UPLOAD`. Kalau jumlah waypoint melebihi kapasitas satu frame (`MAX_PAYLOAD_SIZE`), perlu skema chunking (jumlah waypoint per chunk + index) — detail final menunggu `docs/protocol.md` (lihat Bagian 21), tapi struktur `missionStore` sudah didesain agar tidak peduli mission dikirim satu frame atau banyak — chunking terjadi di level command encoder, bukan di store atau UI.
6. Tidak ada live tracking posisi pesawat di peta ini — sesuai scope v1 (offline planning saja).

---

## 14. Mock/Simulator Layer (`core/mock/`)

Ini bagian yang membuat kerja paralel mungkin dilakukan **tanpa hardware fisik selalu tersedia**:

- `MockTransport` mengimplementasikan interface `Transport` yang sama persis, tapi mensimulasikan device virtual di dalam browser (tidak perlu USB nyata).
- `MockDeviceClient` (atau `MockTransport` + `DeviceClient` asli) dikonfigurasi dengan respons palsu per command — misalnya schema setting palsu, status device palsu (armed/disarmed bisa di-toggle manual untuk testing guard), simulasi progress DFU tanpa flashing sungguhan.
- Setiap fitur (`dfu`, `settings`, `mission`) harus punya cerita pengujian lengkap memakai mock ini sebelum diuji dengan hardware asli — supaya siapa pun yang sedang mengerjakan `features/settings` misalnya, tidak perlu menunggu firmware & `features/connection` selesai 100%, cukup menunggu kontrak tipe di Bagian 4 dibekukan.

---

## 15. Error Handling & Reconnection

Taksonomi error yang konsisten dipakai di semua layer:

- `TransportError` — masalah level fisik (device tidak ditemukan, izin ditolak, browser tak didukung, I/O error).
- `ProtocolError` — frame korup/CRC gagal (biasanya cukup di-log & di-drop, tidak perlu selalu tampil ke user kecuali berulang).
- `CommandTimeoutError` — device tidak membalas dalam batas waktu.
- `DeviceBusyError` — device menolak command (misalnya karena armed) — pesan ke user harus menjelaskan alasan, bukan sekadar "gagal".

Aturan UI: status koneksi harus selalu terlihat jelas (connected/disconnected/error), dan kehilangan koneksi di tengah proses (terutama saat DFU flashing) harus punya penanganan eksplisit — jangan biarkan progress bar diam tanpa keterangan.

---

## 16. Persistensi Lokal

- Draft misi: `localStorage` atau `IndexedDB` (pilih `IndexedDB` kalau ukuran data misi berpotensi besar; `localStorage` cukup untuk v1 karena jumlah waypoint kemungkinan kecil).
- Nilai setting: **tidak** disimpan sebagai sumber kebenaran di local storage — setiap kali konek ke device, nilai selalu diambil ulang dari device (`CMD_SETTING_GET`). Cache lokal boleh ada hanya untuk mempercepat render sementara, tidak boleh dipakai sebagai pengganti data asli.

---

## 17. Build & Deployment

- `vite.config.ts` → set `base: '/nama-repo/'` supaya asset ter-load benar di GitHub Pages (kecuali nanti pakai custom domain, baru `base: '/'`).
- Karena tidak pakai router (Bagian 2), tidak perlu trik `404.html` untuk SPA fallback di GitHub Pages.
- Build output: static files murni (`dist/`), di-deploy via GitHub Actions ke branch `gh-pages` atau lewat setting "Deploy from branch" bawaan GitHub Pages.
- Karena WebUSB/WebSerial butuh **secure context**, pastikan domain GitHub Pages selalu diakses via HTTPS (default GitHub Pages sudah HTTPS).

---

## 18. Coding Conventions & Batas Modul

- TypeScript `strict: true`, tidak ada `any` yang melewati batas modul (`core` ⟷ `features`, atau antar `features`).
- Semua command baru mengikuti pola `CommandDef` (Bagian 4.3) — dilarang membuat jalur pintas kirim byte mentah dari kode fitur.
- Penamaan file: `xxxStore.ts` untuk Zustand store, `xxxClient.ts`/`xxxTransport.ts` untuk lapisan I/O, `xxx.types.ts` untuk kumpulan tipe murni.
- Import antar `features/*` diblokir oleh lint rule (`eslint-plugin-boundaries` atau custom ESLint rule) supaya pelanggaran aturan Bagian 3 ketahuan dari CI, bukan dari review manual.

---

## 19. Testing Strategy

- **Unit test protokol**: round-trip `encodeFrame` → `FrameParser` → `Frame` yang sama, termasuk kasus frame terpotong di tengah (simulasi data datang per-chunk kecil) dan kasus CRC sengaja dirusak (harus ke-detect & resync, bukan crash).
- **Unit test command registry**: tiap `CommandDef` punya test encode/decode payload dengan nilai batas (min/max/overflow).
- **Test fitur**: pakai `MockTransport`/mock device, render komponen dengan React Testing Library, simulasikan interaksi user (misalnya toggle armed lalu cek field `readonlyWhenArmed` benar-benar disabled).

---

## 20. Rencana Pembagian Kerja Paralel

Urutan dependency supaya tidak saling menunggu tanpa alasan:

1. **Tahap 0 (wajib selesai duluan, dikerjakan bersama):** bekukan semua interface di Bagian 4 (`Transport`, `Frame`, `CommandDef`, `DeviceClient`, tipe di `shared/types`). Ini satu-satunya bagian yang butuh konsensus sebelum kerja paralel dimulai.
2. **Setelah Tahap 0**, bisa paralel:
   - Track A: `core/transport` + `core/protocol` (implementasi asli, butuh akses hardware/USART untuk uji nyata).
   - Track B: `core/mock` (implementasi mock, tidak butuh hardware sama sekali — bisa mulai dari hari pertama).
   - Track C: `core/commands` (registry command, disinkronkan bertahap dengan `docs/protocol.md`).
   - Track D: `features/connection` + `core/device` (dikembangkan & diuji dulu memakai mock dari Track B).
   - Track E: `features/dfu` (UI + state machine, diuji dengan mock dulu, integrasi nyata terakhir karena butuh device beneran dalam mode DFU).
   - Track F: `features/settings` + komponen `SchemaField` (diuji dengan schema palsu dari mock).
   - Track G: `features/mission` (hampir independen dari device — bisa dikerjakan penuh secara offline, integrasi upload ke device belakangan).
3. **Tahap integrasi akhir:** ganti mock dengan transport asli, uji ulang tiap fitur satu per satu terhadap hardware nyata (sejalan dengan prinsip "uji coba bertahap: meja dulu baru terbang" di level project).

---

## 21. Open Items — Menunggu Finalisasi `docs/protocol.md`

Bagian-bagian berikut sudah didesain agar perubahannya **terisolasi** (hanya menyentuh `core/protocol/constants.ts` dan `core/commands/registry.ts`), tapi nilainya belum final:

- Nilai persis preamble, endianness, dan apakah ada byte tambahan selain yang sudah disebut di filosofi framing (preamble/length/command ID/payload/CRC8).
- Daftar command ID 16-bit final untuk semua command yang disebut di Bagian 7.
- **Prioritas tinggi:** request-id/sequence number minimal 1 byte yang di-echo firmware di response. Tanpa ini, ada race yang tidak bisa ditutup sepenuhnya oleh bookkeeping di sisi client saja (lihat catatan token/generasi di Bagian 8) — kalau sebuah request timeout (padahal cuma telat, bukan hilang) lalu segera di-retry dengan command ID sama, balasan basi yang telat tiba berpotensi salah ke-resolve sebagai jawaban retry. Mitigasi sisi client (single in-flight + generation token + drain-delay) sudah diterapkan sebagai default, tapi penutupan yang benar-benar tanpa ambiguitas hanya mungkin dengan ID di wire.
- Skema pagination untuk respons besar (`CMD_SETTING_SCHEMA_LIST` — FC pada umumnya bisa punya ratusan field setting, jelas tidak muat satu frame) dan skema chunking untuk upload besar (`CMD_MISSION_UPLOAD` kalau jumlah waypoint besar) — lihat Bagian 6.1 untuk pemisahan dua pola ini. DFU sendiri sudah punya skema chunking dari DfuSe jadi tidak perlu didefinisikan ulang.
- Command firmware untuk menghitung hash/CRC dari region flash tertentu (dijalankan device sendiri), dibutuhkan untuk verifikasi DFU yang jujur kalau RDP ≥1 aktif (lihat Bagian 11 poin 6) — sekaligus keputusan level RDP (0 vs ≥1) itu sendiri, karena downgrade RDP men-trigger mass erase.
- Respons firmware terhadap command tidak dikenal/salah format (perlu tipe error response standar di `commands/registry.ts`).
- Kapan tepatnya setting dianggap tersimpan permanen vs hanya di RAM (memengaruhi UX tombol "Apply" vs "Commit" di Bagian 12).
- ~~VID:PID device untuk mode normal (WebSerial)~~ — **terkonfirmasi**: `0x0483:0x5740` di kode saat ini (`usb_cdc_if.h`), tapi masih ditandai placeholder oleh firmware sendiri. Yang masih perlu ditunggu: nilai final dari `protocol.md` Bagian 12/checklist K, untuk disinkronkan ke `core/transport/constants.ts`.
- Varian chip pasti (STM32F411CEU6 512KB vs STM32F411CCU6 256KB) untuk validasi ukuran file DFU di Bagian 11.
