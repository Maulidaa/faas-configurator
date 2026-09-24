import { create } from 'zustand';
import { DeviceClientImpl, type ConnectionState, type DeviceClient } from '../core/device';
import { MockTransport } from '../core/mock';
import { WebSerialTransport } from '../core/transport';
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
    connectionState: 'disconnected',
    deviceStatus: null,
    activeTransport: null,
    lastError: null,

    async connectDemo() {
      set({ lastError: null });
      try {
        await client.connect(new MockTransport({ telemetryIntervalMs: 500 }));
        set({ activeTransport: 'mock' });
      } catch (err) {
        set({ lastError: errorMessage(err) });
      }
    },

    async connectSerial() {
      set({ lastError: null });
      const transport = new WebSerialTransport();
      try {
        await transport.requestDevice();
      } catch (err) {
        set({ lastError: errorMessage(err) });
        return;
      }
      try {
        await client.connect(transport);
        set({ activeTransport: 'webserial' });
      } catch (err) {
        set({ lastError: errorMessage(err) });
      }
    },

    async disconnect() {
      await client.disconnect();
    },
  };
});
