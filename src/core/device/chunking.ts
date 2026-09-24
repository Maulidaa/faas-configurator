import type { Waypoint } from '../../shared/types';
import { missionUploadChunkCommand } from '../commands/missionCommands';
import { MAX_PAYLOAD_SIZE } from '../protocol/constants';
import type { DeviceClient } from './DeviceClient';

/**
 * core/device/chunking.ts
 * Pola "client → device, satu operasi logis dipecah banyak request"
 * (web-configurator-architecture.md Bagian 6.1) — dipakai untuk
 * CMD_MISSION_UPLOAD. Beda dari pagination: jumlah chunk sudah diketahui di
 * awal, yang dibutuhkan adalah ack per-chunk + retry-on-loss.
 *
 * Ukuran per-item mission (protocol.md Bagian 10): seq(1) + lat(4) + lon(4)
 * + altitude(2) + action_type(1) + action_param(4) = 16 byte. Header chunk
 * (Bagian 6): total_chunks(1) + chunk_index(1) + item_count(1) = 3 byte.
 * Jadi maksimum item per chunk = floor((MAX_PAYLOAD_SIZE - 3) / 16).
 */
const MISSION_ITEM_BYTES = 16;
const CHUNK_HEADER_BYTES = 3;
export const MAX_ITEMS_PER_CHUNK = Math.floor((MAX_PAYLOAD_SIZE - CHUNK_HEADER_BYTES) / MISSION_ITEM_BYTES);

export interface SendChunkedMissionOpts {
  timeoutMs?: number;
  maxRetriesPerChunk?: number;
  onProgress?: (sentChunks: number, totalChunks: number) => void;
}

export async function sendChunkedMission(
  client: DeviceClient,
  waypoints: Waypoint[],
  opts: SendChunkedMissionOpts = {},
): Promise<void> {
  const { timeoutMs, maxRetriesPerChunk = 3, onProgress } = opts;

  const chunks: Waypoint[][] = [];
  for (let i = 0; i < waypoints.length; i += MAX_ITEMS_PER_CHUNK) {
    chunks.push(waypoints.slice(i, i + MAX_ITEMS_PER_CHUNK));
  }
  const totalChunks = Math.max(chunks.length, 1); // minimal 1 chunk walau mission kosong

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const items = chunks[chunkIndex];
    let attempt = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const result = await client.sendCommand(
        missionUploadChunkCommand,
        { totalChunks, chunkIndex, items },
        { timeoutMs },
      );

      if (result.status === 'ok') break;

      attempt++;
      if (attempt > maxRetriesPerChunk) {
        throw new Error(`chunk ${chunkIndex}/${totalChunks} gagal ack setelah ${maxRetriesPerChunk}x retry`);
      }
      // Web retry chunk yang gagal ack sebelum lanjut ke chunk berikutnya (protocol.md Bagian 6).
    }

    onProgress?.(chunkIndex + 1, totalChunks);
  }
}
