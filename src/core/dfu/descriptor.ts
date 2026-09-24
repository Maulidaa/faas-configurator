/**
 * core/dfu/descriptor.ts
 * Dua hal yang TIDAK diekspos WebUSB lewat struktur `USBConfiguration`
 * bawaan browser secara andal, jadi harus digali manual:
 *
 * 1. DFU Functional Descriptor (bDescriptorType 0x21) — berisi wTransferSize,
 *    field ukuran chunk maksimum per DNLOAD yang device sanggup terima.
 *    Ini class-specific descriptor, WebUSB cuma mem-parse descriptor standar
 *    (device/config/interface/endpoint) ke object terstruktur — jadi kita
 *    fetch raw config descriptor lewat GET_DESCRIPTOR standard request lalu
 *    walk TLV manual.
 * 2. String iInterface dari alternate-setting DfuSe (mis.
 *    "@Internal Flash /0x08000000/04*016Kg,01*064Kg,07*128Kg"). ASUMSI AWAL
 *    kode ini: WebUSB otomatis resolve ke `USBAlternateInterface.interfaceName`.
 *    TERBUKTI SALAH di uji hardware nyata (STM32F411 bootloader ROM + driver
 *    WinUSB bawaan di Windows) — `interfaceName` kembali kosong/undefined
 *    walau device DFU-nya valid dan `claimInterface()` sukses, kemungkinan
 *    karena Chrome gagal/skip resolve string descriptor untuk alternate
 *    setting selain yang lagi aktif di beberapa stack driver Windows.
 *    `readDfuseInterfaceName()` di bawah jadi FALLBACK MANUAL: cari byte
 *    `iInterface` di raw config descriptor (offset yang sama dengan pola TLV
 *    functional descriptor di atas), lalu GET_DESCRIPTOR(STRING) langsung ke
 *    device — tidak bergantung sama sekali ke resolusi otomatis browser.
 */

const GET_DESCRIPTOR = 0x06;
const DESCRIPTOR_TYPE_CONFIGURATION = 0x02;
const DESCRIPTOR_TYPE_STRING = 0x03;
const DESCRIPTOR_TYPE_INTERFACE = 0x04;
const DFU_FUNCTIONAL_DESCRIPTOR_TYPE = 0x21;
/** English (US) — cukup buat string DfuSe bawaan ST, selalu ASCII. */
const DEFAULT_STRING_LANGID = 0x0409;

export interface DfuFunctionalDescriptor {
  bmAttributes: number;
  wDetachTimeoutMs: number;
  wTransferSize: number;
  bcdDFUVersion: number;
}

/** Ambil raw config descriptor lengkap (2 control transfer: header dulu buat tahu wTotalLength, lalu full body). */
async function fetchRawConfigurationDescriptor(device: USBDevice, configurationValue: number): Promise<DataView | null> {
  const head = await device.controlTransferIn(
    {
      requestType: 'standard',
      recipient: 'device',
      request: GET_DESCRIPTOR,
      value: (DESCRIPTOR_TYPE_CONFIGURATION << 8) | (configurationValue - 1),
      index: 0,
    },
    4,
  );
  if (!head.data || head.data.byteLength < 4) return null;
  const totalLength = head.data.getUint16(2, true);

  const full = await device.controlTransferIn(
    {
      requestType: 'standard',
      recipient: 'device',
      request: GET_DESCRIPTOR,
      value: (DESCRIPTOR_TYPE_CONFIGURATION << 8) | (configurationValue - 1),
      index: 0,
    },
    totalLength,
  );
  return full.data ?? null;
}

/**
 * Ambil & parse DFU functional descriptor dari config descriptor mentah.
 * Mengembalikan null kalau tidak ketemu (device tidak strictly-compliant) —
 * pemanggil wajib fallback ke FALLBACK_TRANSFER_SIZE (constants.ts).
 */
export async function readDfuFunctionalDescriptor(
  device: USBDevice,
  configurationValue: number,
): Promise<DfuFunctionalDescriptor | null> {
  const view = await fetchRawConfigurationDescriptor(device, configurationValue);
  if (!view) return null;

  let offset = 0;
  while (offset + 2 <= view.byteLength) {
    const length = view.getUint8(offset);
    const type = view.getUint8(offset + 1);
    if (length === 0) break; // descriptor rusak/kosong, hindari infinite loop
    if (type === DFU_FUNCTIONAL_DESCRIPTOR_TYPE && length >= 9) {
      return {
        bmAttributes: view.getUint8(offset + 2),
        wDetachTimeoutMs: view.getUint16(offset + 3, true),
        wTransferSize: view.getUint16(offset + 5, true),
        bcdDFUVersion: view.getUint16(offset + 7, true),
      };
    }
    offset += length;
  }
  return null;
}

/**
 * Baca string descriptor mentah (UTF-16LE) dari device via GET_DESCRIPTOR
 * standar — dua tahap sama seperti config descriptor: baca bLength dulu (byte
 * pertama), baru fetch penuh sepanjang itu. stringIndex=0 berarti "tidak ada
 * string" (konvensi USB standar), jadi langsung null tanpa round-trip.
 */
async function readStringDescriptor(
  device: USBDevice,
  stringIndex: number,
  langId: number = DEFAULT_STRING_LANGID,
): Promise<string | null> {
  if (stringIndex === 0) return null;

  const head = await device.controlTransferIn(
    { requestType: 'standard', recipient: 'device', request: GET_DESCRIPTOR, value: (DESCRIPTOR_TYPE_STRING << 8) | stringIndex, index: langId },
    1,
  );
  if (!head.data || head.data.byteLength < 1) return null;
  const length = head.data.getUint8(0);
  if (length < 2) return null;

  const full = await device.controlTransferIn(
    { requestType: 'standard', recipient: 'device', request: GET_DESCRIPTOR, value: (DESCRIPTOR_TYPE_STRING << 8) | stringIndex, index: langId },
    length,
  );
  if (!full.data) return null;

  const charCount = (length - 2) / 2;
  const codeUnits: number[] = [];
  for (let i = 0; i < charCount; i++) {
    codeUnits.push(full.data.getUint16(2 + i * 2, true));
  }
  return String.fromCharCode(...codeUnits);
}

/** Cari byte `iInterface` (offset 8 di descriptor INTERFACE standar 9-byte) untuk interface+alt tertentu, walk TLV manual. */
function findInterfaceStringIndex(view: DataView, interfaceNumber: number, alternateSetting: number): number | null {
  let offset = 0;
  while (offset + 2 <= view.byteLength) {
    const length = view.getUint8(offset);
    const type = view.getUint8(offset + 1);
    if (length === 0) break;
    if (type === DESCRIPTOR_TYPE_INTERFACE && length >= 9) {
      const bInterfaceNumber = view.getUint8(offset + 2);
      const bAlternateSetting = view.getUint8(offset + 3);
      if (bInterfaceNumber === interfaceNumber && bAlternateSetting === alternateSetting) {
        return view.getUint8(offset + 8);
      }
    }
    offset += length;
  }
  return null;
}

/**
 * FALLBACK MANUAL untuk string iInterface DfuSe — dipakai ketika
 * `USBAlternateInterface.interfaceName` bawaan WebUSB kosong/undefined
 * (terbukti terjadi di hardware nyata, lihat komentar file). Jalur:
 * raw config descriptor -> temukan byte iInterface interface+alt yang
 * diminta -> GET_DESCRIPTOR(STRING) langsung, tanpa lewat resolusi
 * otomatis browser sama sekali.
 */
export async function readDfuseInterfaceName(
  device: USBDevice,
  configurationValue: number,
  interfaceNumber: number,
  alternateSetting: number,
): Promise<string | null> {
  const configView = await fetchRawConfigurationDescriptor(device, configurationValue);
  if (!configView) return null;
  const stringIndex = findInterfaceStringIndex(configView, interfaceNumber, alternateSetting);
  if (stringIndex === null) return null;
  return readStringDescriptor(device, stringIndex);
}

export interface DfuseSector {
  address: number;
  size: number;
  /** true kalau tipe sektor ini mengizinkan erase+write ('e'/'g' di string DfuSe — bukan read-only). */
  writable: boolean;
}

export interface DfuseMemoryLayout {
  name: string;
  baseAddress: number;
  sectors: DfuseSector[];
}

/**
 * Parse string iInterface DfuSe, format standar ST (AN3156 Bagian 5):
 *   "@<name>/<base address hex>/<segment>,<segment>,..."
 *   segment = "<jumlah>*<ukuran><unit K/M><tipe huruf>"
 * Contoh: "@Internal Flash /0x08000000/04*016Kg,01*064Kg,07*128Kg"
 *   -> 4 sektor 16K, lalu 1 sektor 64K, lalu 7 sektor 128K, semua dari 0x08000000.
 *
 * Huruf tipe di akhir tiap segmen adalah bitmask kemampuan (a=readable,
 * b=erasable, c=writable — kombinasi umum "g" berarti readable+erasable+
 * writable). Di sini kita treat huruf apa pun SELAIN eksplisit read-only
 * sebagai writable — cukup untuk keperluan flashing (bukan implementasi
 * penuh semantik AN3156).
 */
export function parseDfuseMemoryLayout(interfaceName: string): DfuseMemoryLayout | null {
  const match = /^@([^/]*)\/0x([0-9a-fA-F]+)\/(.+)$/.exec(interfaceName.trim());
  if (!match) return null;

  const name = match[1].trim();
  const baseAddress = parseInt(match[2], 16);
  const segments = match[3].split(',');

  const sectors: DfuseSector[] = [];
  let cursor = baseAddress;

  const segmentRe = /^(\d+)\*(\d+)([KM]?)(\w)$/;
  for (const segment of segments) {
    const segMatch = segmentRe.exec(segment.trim());
    if (!segMatch) continue; // segmen tidak dikenali — lewati, jangan gagal total
    const count = parseInt(segMatch[1], 10);
    let size = parseInt(segMatch[2], 10);
    const unit = segMatch[3];
    const typeChar = segMatch[4];
    if (unit === 'K') size *= 1024;
    if (unit === 'M') size *= 1024 * 1024;

    const writable = typeChar.toLowerCase() !== 'd'; // 'd' = device-specific/read-protected di beberapa varian, sisanya writable
    for (let i = 0; i < count; i++) {
      sectors.push({ address: cursor, size, writable });
      cursor += size;
    }
  }

  if (sectors.length === 0) return null;
  return { name, baseAddress, sectors };
}

/** Cari daftar sektor yang overlap dengan range [startAddress, startAddress+length). */
export function sectorsInRange(layout: DfuseMemoryLayout, startAddress: number, length: number): DfuseSector[] {
  const endAddress = startAddress + length;
  return layout.sectors.filter((s) => s.address < endAddress && s.address + s.size > startAddress);
}
