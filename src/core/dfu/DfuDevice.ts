import { DFU_INTERFACE_CLASS, DFU_INTERFACE_SUBCLASS, DfuRequest, DfuState, DfuStatus, DfuseCommand, DEFAULT_POLL_TIMEOUT_MS, DNBUSY_MAX_WAIT_MS, FALLBACK_TRANSFER_SIZE } from './constants';
import { parseDfuseMemoryLayout, readDfuFunctionalDescriptor, readDfuseInterfaceName, type DfuseMemoryLayout } from './descriptor';

export class DfuError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DfuError';
  }
}

export interface DfuStatusResult {
  status: number;
  pollTimeoutMs: number;
  state: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * core/dfu/DfuDevice.ts
 * Driver WebUSB untuk device dalam mode DFU (USB DFU class 1.1 + vendor
 * command DfuSe ST/AN3156). SENGAJA tidak mengimplementasikan interface
 * `Transport` (core/transport/Transport.ts) — DFU bukan bicara frame
 * protokol custom [0xFA 0xFC ...], dia bicara control-transfer USB DFU
 * standar. Menyatukan keduanya di balik satu abstraksi `send()/onData()`
 * cuma memaksakan kecocokan yang tidak nyata ada di wire level.
 *
 * Alur pemakaian tipikal (lihat flashFirmware.ts untuk orkestrasi penuh):
 *   const dfu = await DfuDevice.requestAndOpen();
 *   await dfu.abortToIdle();
 *   const layout = dfu.memoryLayout; // dari iInterface string, sudah di-parse saat open()
 *   ... erase sektor, tulis data ...
 *   await dfu.leave(entryAddress);
 */
export class DfuDevice {
  private device: USBDevice;
  private interfaceNumber: number;
  readonly transferSize: number;
  readonly memoryLayout: DfuseMemoryLayout | null;

  private constructor(device: USBDevice, interfaceNumber: number, transferSize: number, memoryLayout: DfuseMemoryLayout | null) {
    this.device = device;
    this.interfaceNumber = interfaceNumber;
    this.transferSize = transferSize;
    this.memoryLayout = memoryLayout;
  }

  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.usb;
  }

  /**
   * Memicu device picker WebUSB (wajib dipanggil dari user gesture, sama
   * seperti WebSerialTransport.requestDevice). Filter dulu dengan
   * DFU_MODE_VID/PID; kalau tidak match (mis. VID:PID belum final atau user
   * mengetes board lain), fallback tanpa filter — pola sama seperti
   * WebSerialTransport (core/transport/WebSerialTransport.ts).
   */
  static async requestAndOpen(filterVid?: number, filterPid?: number): Promise<DfuDevice> {
    if (!DfuDevice.isSupported()) {
      throw new DfuError('WebUSB API tidak tersedia di browser ini — pakai Chrome/Edge versi desktop terbaru.');
    }
    const usb = navigator.usb!;
    let usbDevice: USBDevice;
    try {
      const filters =
        filterVid !== undefined && filterPid !== undefined ? [{ vendorId: filterVid, productId: filterPid }] : [];
      usbDevice = await usb.requestDevice({ filters });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotFoundError' && filterVid !== undefined) {
        // Tidak ada device cocok filter — biarkan user pilih manual dari semua device USB.
        usbDevice = await usb.requestDevice({ filters: [] });
      } else {
        throw err;
      }
    }
    return DfuDevice.open(usbDevice);
  }

  static async open(usbDevice: USBDevice): Promise<DfuDevice> {
    await usbDevice.open();
    if (!usbDevice.configuration) {
      await usbDevice.selectConfiguration(1);
    }
    const configValue = usbDevice.configuration?.configurationValue ?? 1;

    const found = findDfuInterface(usbDevice);
    if (!found) {
      await usbDevice.close();
      throw new DfuError(
        'Device terpilih tidak melaporkan interface DFU (class 0xFE/subclass 0x01) — pastikan device benar-benar sudah masuk mode bootloader DFU.',
      );
    }

    await usbDevice.claimInterface(found.interfaceNumber);
    if (found.alternateSetting !== 0) {
      await usbDevice.selectAlternateInterface(found.interfaceNumber, found.alternateSetting);
    }

    let transferSize = FALLBACK_TRANSFER_SIZE;
    try {
      const functional = await readDfuFunctionalDescriptor(usbDevice, configValue);
      if (functional && functional.wTransferSize > 0) {
        transferSize = functional.wTransferSize;
      }
    } catch {
      // Beberapa browser/device menolak GET_DESCRIPTOR non-standar setelah
      // enumerasi — bukan alasan gagal total, fallback constants.ts cukup.
    }

    // `alt.interfaceName` bawaan WebUSB TERBUKTI bisa kosong/undefined di
    // hardware nyata (Windows + driver WinUSB bootloader ST) walau device
    // DFU-nya valid — lihat descriptor.ts. Kalau itu terjadi, jangan
    // langsung nyerah ke memoryLayout=null: coba baca string iInterface
    // manual lewat GET_DESCRIPTOR(STRING), independen dari resolusi
    // otomatis browser.
    let interfaceName = found.interfaceName;
    if (!interfaceName) {
      try {
        interfaceName =
          (await readDfuseInterfaceName(usbDevice, configValue, found.interfaceNumber, found.alternateSetting)) ?? undefined;
      } catch {
        // Sebagian device/driver menolak GET_DESCRIPTOR(STRING) manual sesudah
        // claimInterface() — bukan alasan gagal total, memoryLayout tetap null
        // dan flashFirmware.ts sudah menolak melanjutkan tanpa peta sektor (aman).
      }
    }

    const memoryLayout = interfaceName ? parseDfuseMemoryLayout(interfaceName) : null;

    return new DfuDevice(usbDevice, found.interfaceNumber, transferSize, memoryLayout);
  }

  async close(): Promise<void> {
    try {
      await this.device.releaseInterface(this.interfaceNumber);
    } catch {
      // device mungkin sudah tercabut/reset diri sendiri (mis. sesudah leave()) — abaikan.
    }
    try {
      await this.device.close();
    } catch {
      // idem.
    }
  }

  // --- USB DFU class requests standar (spec 1.1 Bagian 3) ---

  private async dnload(blockNum: number, data: Uint8Array): Promise<void> {
    const result = await this.device.controlTransferOut(
      { requestType: 'class', recipient: 'interface', request: DfuRequest.DNLOAD, value: blockNum, index: this.interfaceNumber },
      data.byteLength > 0 ? toArrayBuffer(data) : undefined,
    );
    if (result.status !== 'ok') {
      throw new DfuError(`DFU_DNLOAD blok ${blockNum} gagal (status USB: ${result.status})`);
    }
  }

  async getStatus(): Promise<DfuStatusResult> {
    const result = await this.device.controlTransferIn(
      { requestType: 'class', recipient: 'interface', request: DfuRequest.GETSTATUS, value: 0, index: this.interfaceNumber },
      6,
    );
    if (!result.data || result.data.byteLength < 6) {
      throw new DfuError('DFU_GETSTATUS mengembalikan respons tidak lengkap');
    }
    const view = result.data;
    const status = view.getUint8(0);
    const pollTimeoutMs = view.getUint8(1) | (view.getUint8(2) << 8) | (view.getUint8(3) << 16);
    const state = view.getUint8(4);
    return { status, pollTimeoutMs, state };
  }

  async clearStatus(): Promise<void> {
    await this.device.controlTransferOut({
      requestType: 'class',
      recipient: 'interface',
      request: DfuRequest.CLRSTATUS,
      value: 0,
      index: this.interfaceNumber,
    });
  }

  async abort(): Promise<void> {
    await this.device.controlTransferOut({
      requestType: 'class',
      recipient: 'interface',
      request: DfuRequest.ABORT,
      value: 0,
      index: this.interfaceNumber,
    });
  }

  /** Bersihkan state dfuERROR (kalau ada sisa dari sesi sebelumnya) dan pastikan mulai dari dfuIDLE. */
  async abortToIdle(): Promise<void> {
    const initial = await this.getStatus();
    if (initial.state === DfuState.dfuERROR) {
      await this.clearStatus();
    } else {
      await this.abort();
    }
    const after = await this.getStatus();
    if (after.state !== DfuState.dfuIDLE && after.state !== DfuState.dfuDNLOAD_IDLE) {
      throw new DfuError(`Device tidak kembali ke dfuIDLE (state saat ini: ${after.state}) — cabut & pasang ulang device.`);
    }
  }

  /** Poll GETSTATUS sampai device keluar dari dfuDNBUSY, sesuai bwPollTimeout yang device minta. */
  private async waitWhileBusy(): Promise<DfuStatusResult> {
    const deadline = Date.now() + DNBUSY_MAX_WAIT_MS;
    let last = await this.getStatus();
    while (last.state === DfuState.dfuDNBUSY) {
      if (Date.now() > deadline) {
        throw new DfuError('Timeout menunggu device keluar dari dfuDNBUSY — kemungkinan erase/write macet.');
      }
      await sleep(Math.max(last.pollTimeoutMs, DEFAULT_POLL_TIMEOUT_MS));
      last = await this.getStatus();
    }
    if (last.status !== DfuStatus.OK) {
      throw new DfuError(`Device melaporkan error DFU: bStatus=0x${last.status.toString(16)} pada state=${last.state}`);
    }
    return last;
  }

  // --- Vendor command DfuSe (AN3156 Bagian A.4) — dikirim lewat DNLOAD wBlockNum=0 ---

  private async dfuseCommand(bytes: number[]): Promise<void> {
    await this.dnload(0, new Uint8Array(bytes));
    await this.waitWhileBusy();
  }

  async setAddressPointer(address: number): Promise<void> {
    await this.dfuseCommand([
      DfuseCommand.SET_ADDRESS_POINTER,
      address & 0xff,
      (address >> 8) & 0xff,
      (address >> 16) & 0xff,
      (address >>> 24) & 0xff,
    ]);
  }

  /** Erase satu sektor flash pada alamat tersebut (harus sector-aligned — lihat descriptor.ts sectorsInRange). */
  async eraseSector(address: number): Promise<void> {
    await this.dfuseCommand([
      DfuseCommand.ERASE,
      address & 0xff,
      (address >> 8) & 0xff,
      (address >> 16) & 0xff,
      (address >>> 24) & 0xff,
    ]);
  }

  async massErase(): Promise<void> {
    await this.dfuseCommand([DfuseCommand.ERASE]);
  }

  /**
   * Tulis satu chunk data biner ke address pointer + (blockNum-2)*transferSize
   * (konvensi dfu-util, lihat constants.ts DFUSE_FIRST_DATA_BLOCK_NUM).
   * Pemanggil wajib set address pointer sekali sebelum blok pertama.
   */
  async writeDataBlock(blockNum: number, data: Uint8Array): Promise<void> {
    await this.dnload(blockNum, data);
    await this.waitWhileBusy();
  }

  /**
   * Keluar dari mode DFU: set address pointer ke entry address lalu kirim
   * DNLOAD kosong (panjang 0) di blockNum berikutnya — ini sinyal standar
   * "akhir file" yang memicu firmware DfuSe mulai manifest lalu reset &
   * lompat ke alamat tsb (USB DFU spec 1.1 Bagian 6.1.4 + AN3156).
   */
  async leave(entryAddress: number): Promise<void> {
    await this.setAddressPointer(entryAddress);
    await this.dnload(2, new Uint8Array(0));
    // Device pindah ke dfuMANIFEST -> dfuMANIFEST_WAIT_RESET lalu reset diri
    // sendiri; GETSTATUS terakhir ini realistis bisa gagal (device sudah
    // putus koneksi sebelum sempat membalas) — itu bukan error, itu tanda
    // manifest sukses.
    try {
      await this.getStatus();
    } catch {
      // diharapkan pada device yang sudah reset duluan.
    }
  }
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  // Salin ke buffer baru yang benar-benar rapat (offset 0, length penuh) —
  // subarray() dari firmware bytes besar bisa punya byteOffset/byteLength
  // yang tidak sama dengan underlying buffer, WebUSB butuh view yang bersih.
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}

interface FoundDfuInterface {
  interfaceNumber: number;
  alternateSetting: number;
  interfaceName?: string;
}

function findDfuInterface(device: USBDevice): FoundDfuInterface | null {
  const configs = device.configurations.length > 0 ? device.configurations : device.configuration ? [device.configuration] : [];
  for (const config of configs) {
    for (const iface of config.interfaces) {
      for (const alt of iface.alternates) {
        if (alt.interfaceClass === DFU_INTERFACE_CLASS && alt.interfaceSubclass === DFU_INTERFACE_SUBCLASS) {
          return {
            interfaceNumber: iface.interfaceNumber,
            alternateSetting: alt.alternateSetting,
            interfaceName: alt.interfaceName,
          };
        }
      }
    }
  }
  return null;
}
