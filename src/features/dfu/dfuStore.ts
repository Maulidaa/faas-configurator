import { create } from 'zustand';
import type { DeviceClient } from '../../core/device';
import { DeviceError, flashHashCommand, rebootDfuCommand } from '../../core/commands/registry';
import { TransportError } from '../../core/transport';
import { DFU_MODE_PID, DFU_MODE_VID } from '../../core/transport/constants';
import { DfuDevice, DfuError, STM32F411_FLASH_BASE, crc32Stm32, flashFirmware, type FlashProgress } from '../../core/dfu';

/**
 * features/dfu/dfuStore.ts
 * Progres alur DFU HARUS bertahan lintas transisi tampilan App.tsx antara
 * ConnectionPanel (tampil setiap kali `connectionState !== 'connected'`) dan
 * tab shell — mengirim CMD_REBOOT_DFU membuat serial link putus dengan
 * SENGAJA (device reboot ke bootloader), jadi selama proses WebUSB
 * berlangsung `connectionStore.connectionState` memang 'disconnected'.
 * Kalau state ini hidup di useState lokal DfuPanel, unmount/remount akibat
 * App.tsx bakal membuangnya di tengah jalan. `active` di bawah dipakai
 * App.tsx untuk tahu kapan tetap menampilkan DfuPanel walau disconnected
 * (lihat App.tsx).
 */

export type DfuPhase =
  | 'idle'
  | 'rebooting'
  | 'await-usb'
  | 'usb-ready'
  | 'flashing'
  | 'awaiting-reconnect'
  | 'verifying'
  | 'verify-ok'
  | 'verify-mismatch'
  | 'error';

interface FirmwareFile {
  name: string;
  size: number;
  data: Uint8Array;
  crc32: number;
}

interface DfuStoreState {
  active: boolean;
  phase: DfuPhase;
  error: string | null;
  rebootNote: string | null;

  firmware: FirmwareFile | null;
  startAddress: number;

  dfuDevice: DfuDevice | null;
  memoryLayoutSummary: string | null;

  progress: FlashProgress | null;

  deviceCrc32: number | null;

  setFirmwareFile: (name: string, data: Uint8Array) => void;
  setStartAddress: (addr: number) => void;
  rebootToDfu: (client: DeviceClient) => Promise<void>;
  startStandalone: () => void;
  pickUsbDevice: () => Promise<void>;
  startFlash: () => Promise<void>;
  verifyFlash: (client: DeviceClient) => Promise<void>;
  reset: () => void;
}

function errorMessage(err: unknown): string {
  if (err instanceof DeviceError) return `Ditolak device: ${err.message}`;
  if (err instanceof Error) return err.message;
  return String(err);
}

const initialTransient = {
  phase: 'idle' as DfuPhase,
  error: null,
  rebootNote: null,
  firmware: null,
  startAddress: STM32F411_FLASH_BASE,
  dfuDevice: null,
  memoryLayoutSummary: null,
  progress: null,
  deviceCrc32: null,
};

export const useDfuStore = create<DfuStoreState>((set, get) => ({
  active: false,
  ...initialTransient,

  setFirmwareFile(name, data) {
    set({ firmware: { name, size: data.byteLength, data, crc32: crc32Stm32(data) }, deviceCrc32: null });
  },

  setStartAddress(addr) {
    set({ startAddress: addr });
  },

  async rebootToDfu(client) {
    set({ active: true, phase: 'rebooting', error: null, rebootNote: null });
    try {
      await client.sendCommand(rebootDfuCommand, undefined, { timeoutMs: 2500 });
      set({ phase: 'await-usb', rebootNote: 'Device membalas OK sebelum reboot.' });
    } catch (err) {
      if (err instanceof DeviceError) {
        // Penolakan eksplisit (mis. armed=true) — bukan reboot yang berhasil.
        set({ active: false, phase: 'error', error: errorMessage(err) });
        return;
      }
      if (err instanceof TransportError) {
        // Diharapkan pada hardware asli: device reboot ke bootloader sebelum
        // sempat membalas, port serial putus di tengah tunggu respons —
        // dfuCommands.ts eksplisit menandai ini sebagai perilaku normal.
        set({ phase: 'await-usb', rebootNote: 'Koneksi serial putus (device kemungkinan sudah reboot ke DFU) — ini normal.' });
        return;
      }
      // CommandTimeoutError juga masuk sini (nama class-nya generik Error) —
      // sama-sama diperlakukan sebagai "device kemungkinan sudah reboot".
      set({ phase: 'await-usb', rebootNote: `Tidak ada balasan (${errorMessage(err)}) — device kemungkinan sudah reboot ke DFU.` });
    }
  },

  /**
   * Entry point untuk board yang SUDAH ada di bootloader DFU dari awal —
   * chip kosong (belum pernah diflash), BOOT0 ditahan manual saat colok USB,
   * atau firmware sebelumnya crash sebelum sempat enumerasi CDC. Di
   * kondisi ini tidak ada koneksi serial untuk mengirim CMD_REBOOT_DFU
   * (langkah 1 STEP_ORDER di DfuPanel.tsx), jadi langkah itu dilewati dan
   * alur langsung mulai dari 'await-usb' (langkah 2, WebUSB picker).
   * Dipicu dari ConnectionPanel — lihat App.tsx: `dfuActive` jadi true di
   * sini membuat DfuPanel tampil walau `connectionState` masih
   * 'disconnected', sama seperti alur reboot-lewat-serial biasa.
   */
  startStandalone() {
    set({
      active: true,
      phase: 'await-usb',
      error: null,
      rebootNote:
        'Mode manual — langkah reboot-lewat-serial dilewati. Pastikan device memang sudah dalam mode DFU (STM32 BOOTLOADER di Device Manager / system_profiler), bukan sekadar belum tersambung.',
    });
  },

  async pickUsbDevice() {
    set({ error: null });
    try {
      const dfuDevice = await DfuDevice.requestAndOpen(DFU_MODE_VID, DFU_MODE_PID);
      const layout = dfuDevice.memoryLayout;
      set({
        dfuDevice,
        phase: 'usb-ready',
        memoryLayoutSummary: layout
          ? `${layout.name || 'Internal Flash'} @ 0x${layout.baseAddress.toString(16)} — ${layout.sectors.length} sektor`
          : 'Device tidak melaporkan peta memori DfuSe (iInterface tidak dikenali).',
      });
    } catch (err) {
      set({ phase: 'error', error: errorMessage(err) });
    }
  },

  async startFlash() {
    const { dfuDevice, firmware, startAddress } = get();
    if (!dfuDevice || !firmware) {
      set({ phase: 'error', error: 'Belum ada device DFU dan/atau file firmware yang dipilih.' });
      return;
    }
    set({ phase: 'flashing', error: null, progress: null });
    try {
      await flashFirmware(dfuDevice, startAddress, firmware.data, (progress) => set({ progress }));
      set({ phase: 'awaiting-reconnect' });
      // Device sudah reset sendiri sesudah leave() — interface USB DFU ini
      // sudah tidak valid lagi, lepas referensinya supaya tidak dipakai lagi
      // secara tidak sengaja.
      try {
        await dfuDevice.close();
      } catch {
        // sudah putus duluan, wajar.
      }
      set({ dfuDevice: null });
    } catch (err) {
      const message = err instanceof DfuError ? err.message : errorMessage(err);
      set({ phase: 'error', error: message });
    }
  },

  async verifyFlash(client) {
    const { firmware, startAddress } = get();
    if (!firmware) {
      set({ phase: 'error', error: 'Belum ada file firmware untuk dibandingkan.' });
      return;
    }
    set({ phase: 'verifying', error: null });
    try {
      const crc32 = await client.sendCommand(flashHashCommand, { startAddress, length: firmware.size });
      const match = crc32 === firmware.crc32;
      set({ deviceCrc32: crc32, phase: match ? 'verify-ok' : 'verify-mismatch' });
    } catch (err) {
      set({ phase: 'error', error: errorMessage(err) });
    }
  },

  reset() {
    const { dfuDevice } = get();
    if (dfuDevice) {
      void dfuDevice.close();
    }
    set({ active: false, ...initialTransient });
  },
}));
