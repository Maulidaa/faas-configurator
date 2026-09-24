# Konteks Tambahan Proyek FAAS

Dokumen ini melengkapi `protocol.md` di folder yang sama. Isinya dirangkum dari
percakapan dengan pemilik proyek dan dari membaca kode firmware/web langsung —
**bukan** salinan dokumen arsitektur asli. Beberapa dokumen yang sering dirujuk
di komentar kode (`firmware-architecture-stm32f411.md`, `pinout-fc-stm32f411.md`,
`pembagian-tugas-firmware-4-orang.md`, `blackbox-format.md`) belum pernah
dibagikan penuh ke sesi yang menulis dokumen ini — kalau ada perbedaan,
dokumen aslinya yang benar, bukan rangkuman di sini.

**Update:** `web-configurator-architecture.md` **sudah** dibagikan penuh (lihat
`reference/web-configurator-architecture.md` di folder yang sama) — bukan lagi
dokumen yang "belum pernah diterima". Isi rangkuman proyek di bawah ini secara
umum konsisten dengan dokumen itu; kalau ada detail yang tampak berbeda,
utamakan `web-configurator-architecture.md` sebagai sumber kebenaran karena itu
dokumen asli, bukan rangkuman.

## Ringkasan proyek

- Flight controller custom berbasis STM32F411 Blackpill (chip STM32F411CEU6,
  512KB flash / 128KB RAM — dikonfirmasi dari linker script), dikerjakan tim
  4 orang.
- Target airframe v1: fixed-wing V-tail, 4 servo + 1 motor brushless (berubah
  dari rencana awal delta wing 1 motor + 2 servo elevon).
- Configurator berbasis web (bukan aplikasi desktop seperti Betaflight/iNav
  Configurator) — dipilih supaya lebih mudah dipakai orang yang belum
  familiar dengan flight controller. Dukungan Chromium-only dianggap cukup
  untuk v1. Tanpa router (tab-switch biasa).
- Transport v1: USB CDC-ACM murni (virtual COM port), tanpa redundansi
  wireless.

## Pembagian tugas firmware (tim 4 orang)

- Orang 1: sistem & komunikasi (`comms/`, protocol, command handler)
- Orang 2: sensor & kalibrasi, termasuk driver OLED
- Orang 3: fusion / navigasi / failsafe / CRSF
- Orang 4: kontrol / mixer / output / blackbox

## Pinout kunci (dari `pinout-fc-stm32f411.md`, sudah final)

- SPI1: IMU MPU6500 (CS=PA4, SCK/MISO/MOSI=PA5-7)
- I2C1: SCL=PB6, SDA=PB7 — dipakai bersama MPU6050 (IMU sekunder), BMP280
  (baro), HMC5883/QMC5883 (mag), OLED SSD1306 (0x3C)
- USART1: CRSF (PA9/PA10)
- USART2: GPS (TX=PA2, RX=PA3)
- SPI2: flash W25Q64 untuk blackbox (PB12-15)
- Output V-tail: MOTOR0 = PA8/TIM1_CH1 (DShot), SERVO0-3 = PB0, PB1, PB8, PB9
  (via TIM3/TIM4)

## Keputusan tim yang menutup beberapa item terbuka

- Grup setting `mixer` (`vtail_ruddervator_gain`, `aileron_differential_pct`)
  dibuat tunable dari web, bukan konstanta tetap di firmware.
- `CMD_SERVO_TEST` digating sama seperti `CMD_MOTOR_TEST` — semua command
  `*_TEST` ditolak firmware saat `armed=true`.
- RDP level 0 (tanpa proteksi flash) — proyek kampus/open, bukan proteksi IP
  komersial; RDP≥1 dinilai lebih berisiko (downgrade memicu mass erase)
  daripada manfaatnya.
- Format blackbox pakai format sendiri (bukan reuse framing `protocol.md`),
  didefinisikan di `blackbox-format.md` (belum dibagikan penuh ke sesi ini).

## Status implementasi firmware (per snapshot kode yang pernah diberikan)

- Driver BSP, sensor (dual-IMU, baro, mag, GPS, OLED), output (DShot+servo),
  RX CRSF, PID/mixer, kalibrasi accel-gyro & mag, blackbox+flash — modul-modul
  ini sudah punya isi substansial secara individual, dan project berhasil
  dibuild di STM32CubeIDE.
- **Belum ada** `comms/protocol.c` atau `comms/command_handler.c` — folder
  `comms/` baru berisi `usb_cdc_if.c/h` (transport mentah). Seluruh lapisan
  parsing-frame/dispatch-command/armed-gating yang didefinisikan
  `protocol.md` belum diimplementasikan di firmware.
- `main.c` masih murni loop uji sensor (baca semua sensor, refresh OLED,
  delay) — belum ada scheduler nyata, belum ada state machine
  armed/disarmed, belum ada pipeline fusion→navigation→mixer→output yang
  tersambung.
- `nav/navigation.c` (waypoint tracking) ditandai **STUB** eksplisit oleh
  penulisnya sendiri.

### Catatan khusus: kalibrasi BMP280 (air pressure) tidak lewat web

Berbeda dari accel/gyro dan mag (yang punya command `CMD_CALIB_*` di
`protocol.md` dan diimplementasikan di `calibration/calib_accel_gyro.c` &
`calib_mag.c`), kalibrasi baro sepenuhnya hardcode di firmware:

- Koefisien kalibrasi pabrik BMP280 dibaca otomatis dari register chip saat
  `BMP280_Init()` (standar Bosch, memang tidak pernah perlu input user).
- Referensi tekanan ground (baseline altitude=0) di-set **sekali** di
  `main.c` (baris ~58-63), langsung setelah `BMP280_Init()` sukses saat
  boot — bukan saat arming, dan tidak ada command protokol untuk memicu
  re-zero dari web.
- `calib_dispatcher.h` cuma mengenal dua tipe: `CALIB_TYPE_ACCEL_GYRO` dan
  `CALIB_TYPE_MAG` — tidak ada `CALIB_TYPE_BARO`.
- Kemungkinan besar ini masih perlu diputuskan tim: apakah re-zero baro
  tetap hardcode (dipindah ke event arming, bukan boot) atau ditambah
  command baru semacam `CMD_CALIB_BARO` / "Zero Altitude" yang bisa dipicu
  dari web.

## Status implementasi web (`faas-web`, per isi zip ini)

Sudah dibangun:

- `core/` — protocol (frame, CRC8, constants), commands (registry lengkap
  untuk semua command di `protocol.md`), device (`DeviceClient`, chunking,
  pagination), mock (`MockDevice` + `MockTransport` untuk dev tanpa
  hardware).
- `core/transport/WebSerialTransport.ts` — transport nyata via Web Serial
  API, dengan fallback device-picker tanpa filter kalau VID:PID placeholder
  tidak match.
- `store/connectionStore.ts` — satu instance `DeviceClient` untuk seluruh
  app.
- `features/connection/` — layar connect (USB nyata / mode demo tanpa
  hardware).
- `features/settings/` — tree setting generik dari schema device, dengan
  armed-lock otomatis untuk field `readonlyWhenArmed`, pemisahan Apply
  (SET) vs Commit to Flash (COMMIT).
- `features/mission/` — peta Leaflet (klik tambah waypoint, drag reposisi,
  warna marker per jenis aksi), tabel waypoint editable, panel Home
  terpisah, upload chunked ke device dengan progress.
- `features/dfu/` + `core/dfu/` — alur penuh: `CMD_REBOOT_DFU` lewat
  DeviceClient/serial (dfuStore.ts menangani disconnect/timeout sesudah
  reboot sebagai jalur sukses, bukan error, karena device memang reboot
  sebelum sempat membalas), lalu flashing DfuSe murni via WebUSB
  (`core/dfu/DfuDevice.ts`, `flashFirmware.ts` — bicara USB DFU class
  request + vendor command ST langsung, TIDAK lewat `Transport`/frame
  protokol custom, sesuai protocol.md Bagian 11 "di luar protokol custom
  ini"), lalu sambung-ulang serial dan verifikasi `CMD_FLASH_HASH`
  dibanding CRC32 lokal (`core/dfu/crc32.ts`). Beberapa hal ditandai
  eksplisit ASUMSI KERJA di kode, belum dikonfirmasi firmware:
  - Config register CRC32 hardware STM32 yang dipakai `CMD_FLASH_HASH`
    (poly/init/reflect/padding byte terakhir) — `core/dfu/crc32.ts`.
  - `wTransferSize` fallback 2048 byte kalau functional descriptor DFU
    gagal di-parse dari device — `core/dfu/constants.ts`.
  - Alamat awal flash default untuk .bin mentah = base flash STM32F411
    (`0x08000000`, tanpa offset bootloader custom, karena RDP=0 + bootloader
    ROM ST bawaan) — bisa diubah manual dari UI kalau ternyata perlu offset.
  `App.tsx` juga diubah: selama `dfuStore.active` bertahan (zustand, TIDAK
  di `useState` lokal DfuPanel), DfuPanel tetap tampil walau
  `connectionState !== 'connected'` — CMD_REBOOT_DFU sengaja memutus serial
  di tengah alur, jadi pengecualian ini perlu supaya App.tsx tidak
  membuang layar DFU balik ke ConnectionPanel di tengah flashing.
  Belum ada dukungan file `.dfu` ber-suffix DfuSe (target descriptor,
  images multi-segment) — hanya `.bin` mentah yang ditulis mulai dari
  alamat awal yang diisi user, sesuai kebutuhan v1 (satu image aplikasi).

  **Update sesi berikutnya — dua fix kecil di alur DFU:**
  1. **Tab tidak auto-switch setelah reconnect verifikasi.** `activeTab` di
     `App.tsx` adalah `useState` lokal yang sebelumnya tidak ikut berubah
     saat App.tsx keluar dari mode standalone DfuPanel
     (`dfuActive && !isConnected`) balik ke tab-strip biasa sesudah user
     klik "Hubungkan via USB Serial" — user mendarat di tab manapun yang
     aktif sebelum alur DFU dimulai, bukan di tab DFU. Fix: `App.tsx` sekarang
     punya `wasConnectedRef` + `useEffect([isConnected, dfuActive])` yang
     mendeteksi tepi transisi disconnected→connected secara presisi (bukan
     cuma `isConnected && dfuActive`, supaya tidak ikut memaksa tab pindah di
     awal alur saat koneksi belum sempat putus sama sekali — mis. kalau mock
     transport dipakai, `CMD_REBOOT_DFU` tidak benar-benar mereboot device)
     dan memaksa `activeTab = 'dfu'` hanya pada tepi itu, selama
     `dfuStore.active` masih true.
  2. **Dead code fase `'flash-done'`.** Union `DfuPhase` di `dfuStore.ts`
     menyertakan `'flash-done'`, tapi tidak pernah benar-benar di-`set()` di
     mana pun — `startFlash()` loncat langsung dari `'flashing'` ke
     `'awaiting-reconnect'` begitu `flashFirmware()` resolve. `DfuPanel.tsx`
     defensif mengecek kedua nilai di beberapa tempat, padahal copy UI-nya
     pun sudah sama persis untuk keduanya (section "Sambung Ulang via USB
     Serial" tidak punya teks berbeda antara "baru selesai flash" vs
     "menunggu reconnect"). **Keputusan: dihapus** (bukan dijadikan fase
     transien sungguhan) — tidak ada jeda/polling nyata yang membedakan "baru
     selesai flash" dari "menunggu reconnect" di implementasi saat ini
     (`leave()` di `flashFirmware.ts` sudah memicu reset device sendiri
     sebelum `flashFirmware()` resolve, tidak ada tunggu tambahan sesudahnya),
     jadi state kedua itu murni duplikat tanpa makna yang bisa dibedakan.
     Kalau nanti ada kebutuhan nyata untuk membedakan "sedang menunggu device
     benar-benar reboot" dari "siap disambung ulang" (mis. polling aktif ke
     port serial sebelum menawarkan tombol reconnect), fase baru sebaiknya
     dibuat ulang dengan perilaku yang benar-benar berbeda, bukan sekadar
     dikembalikan namanya.

Belum dibangun:

- UI untuk actuator test (`CMD_MOTOR_TEST`/`CMD_SERVO_TEST`) dan kalibrasi
  accel-gyro/mag dari sisi web — command sudah siap di `core/`, belum ada
  tempat di tab manapun (belum diputuskan apakah masuk tab Settings atau
  tab sendiri).
- Dashboard telemetri live (attitude, GPS detail, raw dual-IMU) — command
  sudah siap (`CMD_ATTITUDE`, `CMD_GPS_DATA`, `CMD_IMU_RAW`), status ringkas
  (armed/firmware version/baterai/fix GPS) sudah tampil di header lewat
  `CMD_GET_STATUS`.

## Asumsi byte-layout yang masih perlu dikonfirmasi ke firmware

`protocol.md` sudah final untuk sebagian besar wire format, tapi beberapa
command belum eksplisit soal layout payload persis — kode web menandainya
"ASUMSI KERJA" di komentar dan memilih layout yang masuk akal supaya
development bisa jalan duluan. Yang masih perlu dikonfirmasi/diverifikasi
byte-level ke firmware:

- `CMD_GET_STATUS` respons (armed, firmwareVersion, protocolVersion,
  batteryVoltage, gpsFixType) — `protocol.md` cuma sebut nama field, bukan
  layout byte.
- `CMD_ATTITUDE`, `CMD_GPS_DATA`, `CMD_BATTERY`, `CMD_IMU_RAW` — sama, nama
  field saja yang eksplisit.
- `CMD_SETTING_GET`/`SET`/`COMMIT` — request/respons byte-level (tagged
  value encoding) adalah asumsi kerja, belum di-spec eksplisit di
  `protocol.md`.
- `CMD_MOTOR_TEST`/`CMD_SERVO_TEST` payload — armed-gating-nya sendiri
  final, tapi bentuk payload request/respons masih asumsi.
- `CMD_ERROR` — HANYA ID `0xFFFF` yang final; layout payload
  (`failed_command_id`/`error_code`/`message`) di `errorFrame.ts` adalah
  placeholder eksplisit, ditandai "MASIH TERBUKA" di kode (bukan sekadar
  asumsi biasa seperti yang lain).
- VID:PID mode normal (`0x0483:0x5740`) masih placeholder di firmware
  (`usb_cdc_if.h`, ditandai TODO) — belum ada nilai final.

Semua yang EKSPLISIT final di `protocol.md` (frame format, CRC8, command ID
registry, request-id/echo, pola pagination & chunking, skema setting wire
encoding, payload kalibrasi & mission, DFU/flash-hash) sudah diimplementasikan
sesuai dokumen, bukan asumsi.
