# Kontrak Protokol FC ↔ Web (`protocol.md`)

Dokumen ini adalah **satu-satunya sumber kebenaran** untuk kontrak komunikasi antara firmware (STM32F411 Blackpill) dan web configurator. Sejalan dengan Bagian 3 & Bagian 20 `web-configurator-architecture.md`: perubahan di sini hanya berdampak ke `core/protocol/constants.ts` + `core/commands/registry.ts` di sisi web, dan modul `comms/` (`protocol.c/h`, `command_handler.c/h`) di sisi firmware — modul lain di kedua sisi tidak perlu tahu detail wire format.

Status: **draft v1**, menuntaskan sebagian besar item yang ditandai "menunggu finalisasi protocol.md" di `firmware-architecture-stm32f411.md` Bagian 5 dan `web-configurator-architecture.md` Bagian 21, termasuk keputusan tim di `pembagian-tugas-firmware-4-orang.md` Bagian 2 (mixer tunable, `SERVO_TEST` armed-gated, RDP=0). Nilai yang masih benar-benar menunggu fakta hardware (VID:PID) tetap ditandai TBD — lihat Bagian 12.

**Update dari audit kode (`pio_flightController`, `src/comms/`):** dua penyesuaian ditemukan langsung dari implementasi yang sudah berjalan, bukan dari diskusi tim — ditandai di Bagian 1 (transport ganda USB CDC + USART6, belum tercatat sebelumnya) dan Bagian 5 (command `CMD_RTH_TRIGGER` sudah diimplementasikan di kode tapi belum pernah masuk registry di sini). Status implementasi tiap command (mana yang sudah punya handler nyata vs baru terdaftar di dokumen ini) dirangkum di Bagian 13.

---

## 1. Filosofi Framing

Framing bergaya MSP (preamble, length, command ID, payload, checksum) tapi dengan namespace command ID sendiri (bukan reuse ID dari MSP asli), plus satu tambahan yang tidak ada di MSP klasik: **request ID 1 byte** untuk menutup celah race yang sudah diidentifikasi di `web-configurator-architecture.md` Bagian 8 & 21.

**Transport, diperbarui dari audit kode:** implementasi `protocol.c` sekarang menerima frame dari **dua transport**, bukan satu — USB CDC (virtual COM port) **atau** USART6 (command link cadangan untuk adapter USB-to-TTL, lihat `bsp_uart.h`/`bsp_pinmap.h`). Ini bukan wireless (jadi tidak bertentangan dengan keputusan scope "tanpa redundansi wireless untuk v1" di `firmware-architecture-stm32f411.md` Bagian 5), murni jalur serial cadangan kalau USB CDC tidak tersedia. Device tidak perlu tahu di web mana yang dipakai. Aturan lock transport: begitu preamble pertama frame masuk cocok di salah satu jalur, parser "mengunci" ke transport itu sampai frame selesai/gagal (mencegah byte dari kedua sumber tercampur di tengah satu frame); balasan (`request_id != 0x00`) dikirim ke transport yang sama dengan request-nya, sedangkan frame unsolicited (push status) di-broadcast ke kedua transport karena tidak terikat satu jalur. `WebSerialTransport` di sisi web tetap hanya perlu tahu satu dari keduanya (biasanya USB CDC) — USART6 relevan terutama untuk debugging/bench dengan adapter serial terpisah.

---

## 2. Format Frame

```
[0]     0xFA              preamble byte 1
[1]     0xFC              preamble byte 2
[2]     length            uint8 — panjang payload dalam byte (0-255)
[3]     command_id_lo      uint8
[4]     command_id_hi      uint8   (command ID uint16, little-endian)
[5]     request_id         uint8   (lihat Bagian 3)
[6..]   payload            `length` byte
[6+len] crc8               uint8   (lihat Bagian 4)
```

- **Byte order:** little-endian untuk semua field multi-byte (menggenapi placeholder `BYTE_ORDER` di `core/protocol/constants.ts`).
- **MAX_PAYLOAD_SIZE = 255 byte** — dipilih supaya field `length` cukup 1 byte tanpa perlu uint16, dan total frame maksimum (preamble+length+cmdid+reqid+payload+crc = 7+255 = 262 byte) masih jauh di bawah batas wajar buffer parser. Ini menggantikan placeholder `256` di kode web; beda 1 byte ini murni supaya `length` tidak butuh 2 byte.
- Preamble `0xFA 0xFC` dipertahankan sama seperti placeholder yang sudah ada di `core/protocol/constants.ts` — tidak perlu ubah kode web untuk nilai ini.
- Resync/parsing behavior (drop byte sampai preamble berikutnya kalau CRC/length gagal, batas buffer internal 2-3x max frame size) sudah benar sesuai desain `FrameParser` di `web-configurator-architecture.md` Bagian 6 — tidak berubah oleh dokumen ini.

---

## 3. Request ID / Sequence Number

Menutup item prioritas tinggi di `web-configurator-architecture.md` Bagian 21 & 8: field `request_id` (1 byte, wrap-around 0-255) diisi client di setiap frame permintaan, dan **wajib** di-echo oleh firmware persis di frame balasannya (termasuk di frame `CMD_ERROR`, lihat Bagian 9).

- `DeviceClient.sendCommand` menaikkan counter `request_id` lokal tiap kirim request baru, dan hanya me-resolve promise yang menunggu kalau `command_id` **dan** `request_id` frame balasan cocok dengan yang sedang pending.
- Ini menghilangkan ambiguitas balasan basi vs balasan sah untuk retry cepat dengan command ID sama — kebijakan client "single in-flight + generation token + jeda drain" yang sudah diterapkan sebagai mitigasi sementara (Bagian 8 web doc) tetap boleh dipertahankan sebagai lapisan pertahanan tambahan, tapi tidak lagi jadi satu-satunya penutup celah.
- Frame unsolicited dari firmware (kalau ada, mis. push status tanpa diminta) memakai `request_id = 0x00` sebagai penanda "bukan balasan atas request tertentu" — client tidak boleh mencoba me-resolve promise apa pun dengan frame ber-`request_id = 0x00`.

---

## 4. CRC8 (DVB-S2)

- Polynomial: `0xD5`, tanpa reflect input/output, initial value `0x00` (menggenapi bagian yang belum eksplisit di kode web).
- **Domain checksum:** dihitung atas byte `[length, command_id_lo, command_id_hi, request_id, payload...]` — **tidak termasuk 2 byte preamble**, karena preamble murni penanda resync, bukan bagian data yang diverifikasi integritasnya.
- Implementasi tetap sebagai fungsi murni tanpa state (`crc8Dvbs2(bytes, initial?)`), sesuai kontrak tipe yang sudah dibekukan di `core/protocol/frame.ts`.

---

## 5. Registry Command ID

ID dikelompokkan per rentang 0x0100 supaya gampang dibaca dan ada slot ekspansi di tiap kelompok tanpa reshuffle ID yang sudah dipakai.

| Rentang | Kelompok |
|---|---|
| `0x0000–0x00FF` | System / status |
| `0x0100–0x01FF` | Telemetri (read-only) |
| `0x0200–0x02FF` | Settings |
| `0x0300–0x03FF` | Actuator test (armed-gated) |
| `0x0400–0x04FF` | Kalibrasi sensor |
| `0x0500–0x05FF` | Mission |
| `0x0600–0x06FF` | DFU / firmware update (armed-gated) |
| `0xFFFF` | `CMD_ERROR` (reserved, di luar rentang manapun supaya tidak pernah bentrok saat kelompok lain berkembang) |

| ID | Nama | Arah | Catatan |
|---|---|---|---|
| `0x0001` | `CMD_GET_STATUS` | web→FC / FC→web | Payload respons: `DeviceStatus` (armed, firmwareVersion, protocolVersion, batteryVoltage, gpsFixType) |
| `0x0101` | `CMD_ATTITUDE` | FC→web | roll/pitch/yaw + flag IMU aktif hasil arbitrasi dual-IMU |
| `0x0102` | `CMD_GPS_DATA` | FC→web | latE7/lonE7, ground speed, fix type, sat count |
| `0x0103` | `CMD_BATTERY` | FC→web | tegangan (mV) + arus (mA) |
| `0x0104` | `CMD_IMU_RAW` | FC→web | raw accel/gyro kedua IMU, untuk debug/kalibrasi |
| `0x0201` | `CMD_SETTING_SCHEMA_LIST` | web→FC | dipaginasi, lihat Bagian 6 |
| `0x0202` | `CMD_SETTING_GET` | web→FC | ambil nilai saat ini sesuai schema |
| `0x0203` | `CMD_SETTING_SET` | web→FC | ubah nilai di RAM (belum permanen) |
| `0x0204` | `CMD_SETTING_COMMIT` | web→FC | tulis permanen ke flash |
| `0x0301` | `CMD_MOTOR_TEST` | web→FC | **armed-gated**, ditolak kalau armed=true |
| `0x0302` | `CMD_SERVO_TEST` | web→FC | **armed-gated** — disamakan dengan `CMD_MOTOR_TEST` (keputusan tim: semua command `*_TEST` ditolak saat armed=true, lihat `pembagian-tugas-firmware-4-orang.md` Bagian 2) |
| `0x0401` | `CMD_CALIB_ACCEL_GYRO_START` / `_STOP` | web→FC | dua ID terpisah (`0x0401`/`0x0402`), device didiamkan di permukaan datar |
| `0x0403` | `CMD_CALIB_MAG_START` / `_STOP` | web→FC | dua ID terpisah (`0x0403`/`0x0404`), gerakan figure-8 |
| `0x0405` | `CMD_CALIB_STATUS` | web→FC | poll progres (persen cakupan orientasi untuk mag) |
| `0x0501` | `CMD_MISSION_UPLOAD` | web→FC | chunked, lihat Bagian 6 & 10 |
| `0x0502` | `CMD_HOME_SET` | web→FC | set titik home eksplisit (default: posisi GPS saat arming, override manual opsional) |
| `0x0503` | `CMD_RTH_TRIGGER` | web→FC | **BARU (dari audit kode)** — trigger RTH manual dari web, payload kosong; menutup gap yang sebelumnya dicatat sebagai "jalur `Nav_TriggerRTH()` sudah disiapkan tapi belum ada command ID" di `rancangan-mag-fusion-heading-rth.md` Bagian 3.2. Sudah diregistrasi & diimplementasikan di `navigation.c` |
| `0x0601` | `CMD_REBOOT_DFU` | web→FC | **armed-gated**, lihat Bagian 11 |
| `0x0602` | `CMD_FLASH_HASH` | web→FC | verifikasi DFU jujur, lihat Bagian 11 |
| `0xFFFF` | `CMD_ERROR` | FC→web | lihat Bagian 9 |

Catatan penomoran: `0x0402` dan `0x0404` sengaja dilompati dari tabel (masing-masing `_STOP` dari `0x0401`/`0x0403`) supaya start/stop satu jenis kalibrasi bertetangga langsung.

---

## 6. Dua Pola Multi-Frame (Wire-Level)

Mengikuti pemisahan arsitektur yang sudah disepakati di `web-configurator-architecture.md` Bagian 6.1 — di sini didefinisikan bentuk byte-nya:

**Pagination (FC→web, dipakai `CMD_SETTING_SCHEMA_LIST`):**
```
payload = [page_index: u8] [has_more: u8 (0/1)] [field_count: u8] [field...]
```
`sendPaginatedCommand` di web mengirim request page berikutnya dengan `request_id` baru tiap kali, sampai `has_more = 0`.

**Chunking (web→FC, dipakai `CMD_MISSION_UPLOAD`):**
```
payload = [total_chunks: u8] [chunk_index: u8] [item_count: u8] [item...]
```
Firmware membalas tiap chunk dengan `command_id` sama + `request_id` di-echo + payload `[chunk_index: u8] [status: u8 (0=OK, 1=RETRY)]`. Web retry chunk yang gagal ack sebelum lanjut ke chunk berikutnya.

---

## 7. Skema Setting (`SettingFieldSchema` — Wire Encoding)

Serialisasi biner dari tipe TypeScript yang sudah dibekukan di `shared/types` (Bagian 4.5 web doc):

```
field = [key_len: u8][key: bytes]
        [label_len: u8][label: bytes]
        [type: u8]                 // 0=number,1=bool,2=enum,3=string,4=bitmask,5=group
        [flags: u8]                // bit0=has_min_max_step, bit1=readonly_when_armed
        [min: f32][max: f32][step: f32]     // hadir hanya kalau flags.bit0=1
        [unit_len: u8][unit: bytes]         // boleh 0
        [option_count: u8][ (value: i32)(label_len: u8)(label: bytes) ... ]  // untuk type=enum/bitmask
        [child_count: u8][ field... ]        // untuk type=group, rekursif
```

Field `readonlyWhenArmed` wajib `true` untuk seluruh grup `output_mapping` dan `mixer` (lihat Bagian 8), plus toggle fitur keselamatan (RTH/failsafe enable) — cermin dari guard armed-state yang sama di firmware (`firmware-architecture-stm32f411.md` Bagian 3.16).

---

## 8. Grup Setting: `output_mapping` (Update untuk V-tail)

Jumlah field di grup ini mengikuti jumlah pin timer-capable yang tersedia secara fisik di board (final di `pinout-fc-stm32f411.md`, masih Bagian 12 di sini) — **bukan** hardcode 5, supaya slot ekspansi tetap ada. Untuk target default v1 (V-tail, 5 channel aktif dari total pin yang tersedia), field yang diharapkan terisi role selain `NONE`:

| key | type | enumOptions | Catatan |
|---|---|---|---|
| `output.pin0.role` | enum | `NONE, MOTOR, SERVO` | default `MOTOR` — harus pin DMA-capable |
| `output.pin0.index` | number | — | index logis (0 untuk motor tunggal) |
| `output.pin1.role` … `output.pin4.role` | enum | `NONE, MOTOR, SERVO` | default `SERVO`, index logis 0-3 → dipetakan mixer ke `AIL_L, AIL_R, VTAIL_L, VTAIL_R` sesuai urutan yang disepakati tim |
| `output.pinN.role` (sisa pin) | enum | `NONE, MOTOR, SERVO` | default `NONE`, slot ekspansi |

Penamaan `pin0..pinN` di sini generik (nomor urut logis, bukan nama GPIO fisik) — pemetaan ke pin fisik sebenarnya ada di `pinout-fc-stm32f411.md`, dokumen ini hanya mendefinisikan bentuk setting-nya. Seluruh field `output.*` wajib `readonlyWhenArmed: true`.

---

## 9. Grup Setting: `mixer` (Final — Tunable)

**Keputusan tim** (`pembagian-tugas-firmware-4-orang.md` Bagian 2, poin 1): parameter mixing diekspos sebagai setting tunable dari web, bukan konstanta tetap di `mixer.c/h`. Rasional: infrastruktur skema setting sudah ada sehingga ongkos tambah kecil, dan gain ruddervator/differential aileron hampir pasti butuh tuning pasca uji terbang tanpa perlu reflash firmware tiap kali.

| key | type | min/max/step | Catatan |
|---|---|---|---|
| `mixer.vtail_ruddervator_gain` | number | 0.0 / 2.0 / 0.05 | gain mixing yaw ke ruddervator, default 1.0 |
| `mixer.aileron_differential_pct` | number | 0 / 100 / 1 | persen defleksi-turun relatif ke defleksi-naik, default 0 (tanpa differential) |

Kedua field diberi `readonlyWhenArmed: true` — mengubah karakteristik kontrol saat armed/terbang tidak boleh diizinkan, konsisten dengan guard yang sama untuk `output_mapping`.

---

## 10. Command Set Kalibrasi & Mission (Payload)

- `CMD_CALIB_ACCEL_GYRO_START/STOP`, `CMD_CALIB_MAG_START/STOP`: payload kosong (aksi murni lewat command ID).
- `CMD_CALIB_STATUS` (respons): `[calib_type: u8][state: u8 (0=idle,1=in_progress,2=done,3=failed)][progress_pct: u8]`.
- `CMD_MISSION_UPLOAD` item (dalam chunk, lihat Bagian 6): `[seq: u8][lat_e7: i32][lon_e7: i32][altitude_m: i16][action_type: u8][action_param: i32]` — `action_param` berarti radius (meter) kalau `action_type = LOITER`, diabaikan untuk `WAYPOINT`/`RTH`.
- `CMD_HOME_SET`: `[lat_e7: i32][lon_e7: i32][altitude_m: i32]`.
- `CMD_RTH_TRIGGER`: payload kosong (aksi murni lewat command ID, sama pola dengan `CMD_CALIB_*_START/STOP`) — memanggil `Nav_TriggerRTH()` langsung, tidak armed-gated (RTH manual dari web harus bisa dipicu kapan pun pesawat armed/terbang; menolaknya justru bertentangan dengan tujuan command ini).

---

## 11. DFU & Verifikasi Flash

- `CMD_REBOOT_DFU`: payload kosong, **wajib ditolak kalau armed=true** (item ini belum eksplisit di draft sebelumnya — reboot ke bootloader saat armed jelas berbahaya, ditambahkan ke daftar command yang digating armed-state di Bagian 3.16 firmware doc).
- Proses flashing sesudahnya sepenuhnya DfuSe standar (di luar protokol custom ini) — tidak berubah dari `firmware-architecture-stm32f411.md` Bagian 3.17 dan `web-configurator-architecture.md` Bagian 11.
- `CMD_FLASH_HASH` (baru, menutup item terbuka verifikasi DFU): request `[start_address: u32][length: u32]`, respons `[crc32: u32]`. Dipilih CRC32 (bukan hash kriptografis) karena threat model di sini adalah deteksi korupsi/erase-gagal-sebagian, bukan proteksi terhadap pihak jahat — CRC32 lewat peripheral hardware CRC bawaan STM32F4 cukup cepat dihitung on-device tanpa membebani scheduler. **Level RDP sudah diputuskan tim: RDP level 0** (tanpa proteksi flash — proyek kampus/open, bukan proteksi IP komersial; RDP≥1 membatasi akses debug SWD dan downgrade-nya memicu mass erase, risiko dinilai lebih besar dari manfaat — lihat `pembagian-tugas-firmware-4-orang.md` Bagian 2 poin 3). Konsekuensinya: akses SWD langsung tetap terbuka sebagai jalur verifikasi tambahan di luar `CMD_FLASH_HASH`, bukan satu-satunya cara seperti yang dikhawatirkan sebelumnya.

---

## 12. Item yang Masih Terbuka / Menunggu Konfirmasi

**Sudah ditutup sejak draft ini:** varian chip STM32F411CEU6/512KB (dari linker script, lihat `pinout-fc-stm32f411.md`), jumlah & alokasi pin timer-capable untuk `output_mapping` (`pinout-fc-stm32f411.md` Bagian 1 & 3), grup setting `mixer` dipastikan tunable (Bagian 9), `CMD_SERVO_TEST` dipastikan armed-gated (Bagian 5), dan level RDP=0 (Bagian 11). Detail rasional tiap keputusan ada di `pembagian-tugas-firmware-4-orang.md` Bagian 2.

**Ditutup dari audit kode (bukan dari diskusi tim):** `CMD_RTH_TRIGGER` (0x0503, Bagian 5 & 10) dan transport ganda USB CDC + USART6 (Bagian 1) — keduanya sudah berjalan di `src/comms/` tapi baru sekarang masuk dokumen ini. Status implementasi lengkap tiap command ada di Bagian 13.

Sisa yang masih terbuka:

- **VID:PID mode normal (WebSerial):** belum ada nilai — perlu dikonfirmasi ke firmware/hardware, dipakai `WebSerialTransport` untuk filter device. Belum tersentuh oleh keputusan tim manapun sejauh ini.
- **Format record blackbox:** sudah dipindah keluar dari cakupan dokumen ini — sekarang didefinisikan lengkap di `blackbox-format.md` (format sendiri, bukan reuse framing di sini).
- Item hardware/pin yang masih perlu verifikasi fisik (stream DMA TIM1_CH1 vs ADC1, kristal LSE PC14/PC15, clock tree, keputusan RX-only vs telemetry balik CRSF di PA9) dilacak di `pinout-fc-stm32f411.md` Bagian 5, bukan diduplikasi di sini.

---

## 13. Status Implementasi (Audit Kode — `src/comms/`)

Bagian ini membedakan **command yang sudah terdaftar di dokumen ini** (yang mendefinisikan wire format-nya) dari **command yang sudah benar-benar punya handler jalan di firmware**. Sumber: `command_handler.c` (registration table) + pencarian `CommandHandler_Register()` di seluruh `src/`. Infrastruktur inti (`protocol.c`, `command_handler.c`, wiring `Protocol_Init()`/`CommandHandler_Init()`/`Protocol_Poll()` di `main.c`) sudah jalan penuh — tabel di bawah soal command individual, bukan infrastrukturnya.

**Punya handler terdaftar (registrasi + balasan nyata):**

| Command | Modul handler |
|---|---|
| `CMD_GET_STATUS` | `command_handler.c` (bawaan) |
| `CMD_SETTING_SCHEMA_LIST`, `CMD_SETTING_GET`, `CMD_SETTING_SET`, `CMD_SETTING_COMMIT` | `settings.c` |
| `CMD_MISSION_UPLOAD`, `CMD_HOME_SET`, `CMD_RTH_TRIGGER` | `navigation.c` |
| `CMD_REBOOT_DFU`, `CMD_FLASH_HASH` | `dfu.c` |

**Terdaftar di dokumen ini tapi BELUM ada `CommandHandler_Register()` di kode** — kirim command ini hari ini akan dibalas `CMD_ERROR` (unknown command), bukan bug parser, murni fitur belum diisi:

| Command | Modul yang seharusnya isi | Catatan |
|---|---|---|
| `CMD_MOTOR_TEST`, `CMD_SERVO_TEST` | `output_map.c` | Disebut di komentar `output_map.h`/`command_handler.c` (soal guard armed-state), tapi belum ada implementasi fungsi handler-nya |
| `CMD_CALIB_ACCEL_GYRO_START/STOP`, `CMD_CALIB_MAG_START/STOP`, `CMD_CALIB_STATUS` | `calib_dispatcher.c` | Sama pola — disebut di komentar `calib_dispatcher.h`, belum diregistrasi |

**Telemetri FC→web (Bagian 5, arah `FC→web`) — `Protocol_SendUnsolicited()` sudah diimplementasikan di `protocol.c` tapi belum ada satu pun caller-nya:**

| Command | Status |
|---|---|
| `CMD_ATTITUDE`, `CMD_GPS_DATA`, `CMD_BATTERY`, `CMD_IMU_RAW` | Fungsi kirim tersedia, tapi tidak ada task scheduler yang memanggilnya secara periodik — web tidak akan menerima frame ini sama sekali sampai task ini ditambahkan |

Ini bukan gap protokol (wire format tiap command sudah didefinisikan lengkap di Bagian 5 & dokumen terkait) — murni gap pengerjaan modul yang belum menyentuh comms layer, dilacak sebagai pekerjaan tersisa di `pembagian-tugas-firmware-4-orang.md` (Orang 2/3 untuk kalibrasi & telemetri fusion, Orang 4 untuk actuator test & battery).
