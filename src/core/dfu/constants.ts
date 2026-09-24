/**
 * core/dfu/constants.ts
 * Konstanta protokol USB DFU class spec 1.1 (Universal Serial Bus Device
 * Class Specification for Device Firmware Upgrade) + ekstensi vendor-specific
 * ST "DfuSe" (AN3156) yang dipakai bootloader ROM STM32F4.
 *
 * Ini SENGAJA terpisah total dari core/protocol (frame.ts/crc8.ts) —
 * protocol.md Bagian 11 eksplisit bilang proses flashing sesudah
 * CMD_REBOOT_DFU "sepenuhnya DfuSe standar, di luar protokol custom ini".
 * Device dalam mode DFU bukan mengerti frame [0xFA 0xFC ...] sama sekali,
 * dia bicara USB DFU class request murni lewat WebUSB control transfer.
 */

/** bInterfaceClass/bInterfaceSubClass DFU per spec. */
export const DFU_INTERFACE_CLASS = 0xfe;
export const DFU_INTERFACE_SUBCLASS = 0x01;

/** bRequest DFU class-specific (USB DFU spec 1.1 Tabel 3.2). */
export const DfuRequest = {
  DETACH: 0x00,
  DNLOAD: 0x01,
  UPLOAD: 0x02,
  GETSTATUS: 0x03,
  CLRSTATUS: 0x04,
  GETSTATE: 0x05,
  ABORT: 0x06,
} as const;

/** bState di respons DFU_GETSTATUS (USB DFU spec 1.1 Tabel A.1). */
export const DfuState = {
  appIDLE: 0,
  appDETACH: 1,
  dfuIDLE: 2,
  dfuDNLOAD_SYNC: 3,
  dfuDNBUSY: 4,
  dfuDNLOAD_IDLE: 5,
  dfuMANIFEST_SYNC: 6,
  dfuMANIFEST: 7,
  dfuMANIFEST_WAIT_RESET: 8,
  dfuUPLOAD_IDLE: 9,
  dfuERROR: 10,
} as const;

/** bStatus di respons DFU_GETSTATUS (USB DFU spec 1.1 Tabel A.2). */
export const DfuStatus = {
  OK: 0x00,
  errTARGET: 0x01,
  errFILE: 0x02,
  errWRITE: 0x03,
  errERASE: 0x04,
  errCHECK_ERASED: 0x05,
  errPROG: 0x06,
  errVERIFY: 0x07,
  errADDRESS: 0x08,
  errNOTDONE: 0x09,
  errFIRMWARE: 0x0a,
  errVENDOR: 0x0b,
  errUSBR: 0x0c,
  errPOR: 0x0d,
  errUNKNOWN: 0x0e,
  errSTALLEDPKT: 0x0f,
} as const;

/**
 * Command byte pertama di payload DNLOAD ber-wBlockNum=0 — perintah
 * vendor-specific ST DfuSe (AN3156 Bagian A.4). Bukan bagian USB DFU
 * standar, khusus bootloader ROM STMicroelectronics.
 */
export const DfuseCommand = {
  GET_COMMANDS: 0x00,
  SET_ADDRESS_POINTER: 0x21,
  ERASE: 0x41,
  READ_UNPROTECT: 0x92,
} as const;

/**
 * wBlockNum data pertama untuk transfer data biasa (AN3156 & konvensi
 * dfu-util dfuse.c): wBlockNum=0 dicadangkan untuk command frame (erase/
 * set-address/dst), wBlockNum=1 dilewati, data biner sesungguhnya mulai
 * dari 2 lalu naik 1 tiap chunk (address = addressPointer + (blockNum-2) *
 * transferSize).
 */
export const DFUSE_FIRST_DATA_BLOCK_NUM = 2;

/**
 * wTransferSize fallback kalau functional descriptor DFU gagal di-parse
 * dari raw config descriptor (lihat descriptor.ts). 2048 byte adalah
 * default yang umum dipakai bootloader DfuSe ST (dikonfirmasi lewat
 * dfu-util --list terhadap board STM32 lain) — TETAP ditandai ASUMSI KERJA
 * untuk board proyek ini spesifik sampai diverifikasi (lihat
 * project-context.md pola "ASUMSI KERJA" untuk byte-layout yang belum
 * final).
 */
export const FALLBACK_TRANSFER_SIZE = 2048;

/** Batas jeda antar poll GETSTATUS kalau device melaporkan bwPollTimeout=0. */
export const DEFAULT_POLL_TIMEOUT_MS = 20;

/** Batas total waktu tunggu satu fase DNBUSY sebelum dianggap macet. */
export const DNBUSY_MAX_WAIT_MS = 15000;

/** STM32F411CEU6: 512KB flash mulai dari alamat base ini (linker script, dikonfirmasi project-context.md). */
export const STM32F411_FLASH_BASE = 0x08000000;
export const STM32F411_FLASH_SIZE = 512 * 1024;
