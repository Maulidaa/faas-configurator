/**
 * core/dfu/crc32.ts
 * Dipakai untuk membandingkan hasil `CMD_FLASH_HASH` (protocol.md Bagian 11)
 * dengan CRC32 firmware file yang dihitung di browser sebelum flashing.
 *
 * ASUMSI KERJA (belum dikonfirmasi ke firmware, pola yang sama seperti item
 * lain di project-context.md bagian "Asumsi byte-layout yang masih perlu
 * dikonfirmasi ke firmware"): protocol.md cuma bilang "CRC32 lewat peripheral
 * hardware CRC bawaan STM32F4", tidak menspesifikasi register config
 * byte-level. Implementasi di sini pakai CONFIG DEFAULT peripheral CRC
 * STM32F4 (yang dipakai kalau firmware panggil HAL_CRC_Calculate() tanpa
 * override register POLYSIZE/REV_IN/REV_OUT/INIT):
 *   - polynomial 0x04C11DB7, initial value 0xFFFFFFFF
 *   - TIDAK ada reflect input/output, TIDAK ada final XOR
 *   - beroperasi per word 32-bit; setiap word diasumsikan dibaca firmware
 *     langsung dari flash sebagai uint32 native (Cortex-M4 little-endian,
 *     match dengan BYTE_ORDER little-endian yang sama dipakai seluruh
 *     frame protokol — shared/utils/binary.ts)
 *   - sisa byte terakhir yang tidak genap 4 di-pad dengan 0xFF (nilai flash
 *     kosong pasca-erase, ASUMSI tambahan soal padding)
 *
 * Kalau firmware ternyata override register CRC (mis. REV_IN/REV_OUT
 * di-nyalakan, INIT custom, atau padding pakai 0x00) angka di sini TIDAK
 * akan cocok dengan `CMD_FLASH_HASH` — perlu diverifikasi byte-level begitu
 * `comms/command_handler.c` yang menghitungnya benar-benar ditulis. Sampai
 * saat itu, mismatch di UI verifikasi HARUS ditampilkan sebagai
 * "kemungkinan asumsi CRC belum cocok", bukan otomatis divonis "flash gagal".
 */
const STM32_CRC32_POLY = 0x04c11db7;

export function crc32Stm32(data: Uint8Array): number {
  const paddedLength = Math.ceil(data.byteLength / 4) * 4;
  const padded = new Uint8Array(paddedLength).fill(0xff);
  padded.set(data);

  let crc = 0xffffffff >>> 0;
  for (let offset = 0; offset < padded.length; offset += 4) {
    const word =
      (padded[offset] | (padded[offset + 1] << 8) | (padded[offset + 2] << 16) | (padded[offset + 3] << 24)) >>> 0;
    crc = (crc ^ word) >>> 0;
    for (let bit = 0; bit < 32; bit++) {
      crc = crc & 0x80000000 ? ((crc << 1) ^ STM32_CRC32_POLY) >>> 0 : (crc << 1) >>> 0;
    }
  }
  return crc >>> 0;
}
