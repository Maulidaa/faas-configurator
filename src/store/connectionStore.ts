import { create } from 'zustand';
import { DeviceClientImpl, type ConnectionState, type DeviceClient } from '../core/device';
import { MockTransport } from '../core/mock';
import { getStatusCommand } from '../core/commands/registry';
import type { DeviceStatus } from '../shared/types';

/**
 * store/connectionStore.ts
 * Satu-satunya tempat DeviceClient dibuat (App.tsx komentar: "begitu
 * features/connection ada, ini diganti oleh connectionStore yang sungguhan
 * terhubung ke DeviceClient"). Semua features/* membaca status koneksi dan
 * memicu connect/disconnect lewat hook ini — tidak ada feature yang boleh
 * membuat instance DeviceClient sendiri.
 *
 * client sendiri sengaja TIDAK disimpan sebagai bagian dari state React biasa
 * (bukan re-created tiap render) — dibuat sekali di module scope, listener
 * dipasang sekali saat store diinisialisasi.
 */

export type ActiveTransportKind = 'mock' | 'webserial' | null;

interface ConnectionStoreState {
  client: DeviceClient;
  /**
   * Client yang dipakai oleh tab Settings, PID (calibration), & Mission.
   * Untuk saat ini SELALU sama dengan `client` (device asli tidak lagi
   * disambungkan lewat tombol "Hubungkan via USB" — lihat komentar
   * connectSerial() di bawah). Field ini sengaja dipertahankan terpisah
   * dari `client` supaya gampang dipisah lagi nanti kalau koneksi device
   * asli via WebSerialTransport diaktifkan kembali.
   */
  contentClient: DeviceClient;
  connectionState: ConnectionState;
  deviceStatus: DeviceStatus | null;
  activeTransport: ActiveTransportKind;
  lastError: string | null;
  connectDemo: () => Promise<void>;
  connectSerial: () => Promise<void>;
  disconnect: () => Promise<void>;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

const client = new DeviceClientImpl();

export const useConnectionStore = create<ConnectionStoreState>((set, get) => {
  client.on('connectionChange', (state: ConnectionState, err?: unknown) => {
    set({
      connectionState: state,
      lastError: state === 'error' ? errorMessage(err) : state === 'connected' ? null : get().lastError,
      ...(state === 'disconnected' ? { deviceStatus: null, activeTransport: null } : {}),
    });

    if (state === 'connected') {
      // Ambil status awal (armed, versi firmware) segera setelah konek.
      // Gagal di sini bukan alasan memutus koneksi yang baru saja berhasil
      // dibuka — user masih bisa retry manual lewat tab manapun nanti.
      client.sendCommand(getStatusCommand, undefined).catch(() => {});
    }
  });

  client.on('statusUpdate', (status: DeviceStatus) => {
    set({ deviceStatus: status });
  });

  return {
    client,
    contentClient: client,
    connectionState: 'disconnected',
    deviceStatus: null,
    activeTransport: null,
    lastError: null,

    async connectDemo() {
      set({ lastError: null });
      try {
        await client.connect(new MockTransport({ telemetryIntervalMs: 500 }));
        set({ activeTransport: 'mock', contentClient: client });
      } catch (err) {
        set({ lastError: errorMessage(err) });
      }
    },

    async connectSerial() {
      // "Hubungkan via USB" sekarang SENGAJA diarahkan ke mode demo/mock
      // juga — WebSerialTransport asli (core/transport/WebSerialTransport.ts,
      // masih ada & tidak dihapus) sering gagal di lapangan: dialog pilih
      // port, port terkunci OS, firmware belum menjawab Settings/PID/Mission
      // dengan andal, dst. Daripada user selalu mentok di error itu, tombol
      // ini untuk sementara berperilaku identik dengan connectDemo() — tidak
      // ada lagi requestPort()/navigator.serial yang dipanggil dari sini.
      // Kalau nanti firmware & hardware sudah stabil, tinggal kembalikan
      // body fungsi ini ke logika WebSerialTransport yang lama.
      await get().connectDemo();
    },

    async disconnect() {
      await client.disconnect();
      set({ contentClient: client });
    },
  };
});
