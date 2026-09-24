import { create } from 'zustand';
import { useConnectionStore } from '../../store/connectionStore';
import type {
  CommandResultEvent,
  CommandSentEvent,
  ConnectionState,
} from '../../core/device';
import type { Frame, ProtocolError } from '../../core/protocol/frame';

/**
 * features/log/logStore.ts
 *
 * Log aktivitas MURNI client-side: riwayat command yang dikirim lewat
 * DeviceClient (dari fitur mana pun — settings, mission, kalibrasi, dfu,
 * dst.), hasilnya, frame unsolicited, error parsing protokol, dan
 * perubahan status koneksi. Tidak ada command baru ke firmware di sini,
 * dan tidak menunggu/butuh apa pun dari device — murni observasi terhadap
 * apa yang sudah lewat di DeviceClient.
 *
 * Pola sama seperti connectionStore.ts: listener dipasang SEKALI di module
 * scope lewat body `create()`, memakai instance `client` yang sama (diambil
 * dari connectionStore, bukan bikin DeviceClient baru — connectionStore.ts
 * eksplisit bilang tidak ada fitur yang boleh bikin instance sendiri).
 */

export type LogLevel = 'info' | 'success' | 'error' | 'warning';

export interface LogEntry {
  id: number;
  timestamp: number; // Date.now()
  level: LogLevel;
  message: string;
  detail?: string;
}

/** Batas ring-buffer — log ini cuma buat observasi sesi berjalan, bukan
 *  arsip. Entry lebih lama dibuang begitu melewati batas ini. */
const MAX_ENTRIES = 300;

interface LogStoreState {
  entries: LogEntry[];
  clear: () => void;
}

function commandLabel(commandName: string, requestId: number): string {
  return `${commandName} #${requestId}`;
}

export const useLogStore = create<LogStoreState>((set) => {
  let nextId = 1;

  const push = (level: LogLevel, message: string, detail?: string) => {
    set((state) => {
      const entry: LogEntry = { id: nextId++, timestamp: Date.now(), level, message, detail };
      const entries = [...state.entries, entry];
      if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
      return { entries };
    });
  };

  const client = useConnectionStore.getState().client;

  client.on('commandSent', (evt: CommandSentEvent) => {
    push('info', `→ ${commandLabel(evt.commandName, evt.requestId)}`, `${evt.payloadBytes} byte payload`);
  });

  client.on('commandResult', (evt: CommandResultEvent) => {
    if (evt.ok) {
      push('success', `← ${commandLabel(evt.commandName, evt.requestId)}`);
    } else {
      push('error', `✗ ${commandLabel(evt.commandName, evt.requestId)}`, evt.error);
    }
  });

  client.on('unsolicited', (frame: Frame) => {
    push(
      'info',
      `↚ unsolicited cmd=0x${frame.commandId.toString(16).padStart(4, '0')}`,
      `${frame.payload.length} byte payload`,
    );
  });

  client.on('protocolError', (err: ProtocolError) => {
    push('warning', `Frame protokol rusak (${err.code})`, err.message);
  });

  client.on('connectionChange', (state: ConnectionState, err?: unknown) => {
    const label: Record<ConnectionState, string> = {
      disconnected: 'Terputus',
      connecting: 'Menyambung…',
      connected: 'Tersambung',
      error: 'Error koneksi',
    };
    push(
      state === 'error' ? 'error' : state === 'connected' ? 'success' : 'info',
      label[state],
      err instanceof Error ? err.message : undefined,
    );
  });

  return {
    entries: [],
    clear: () => set({ entries: [] }),
  };
});
