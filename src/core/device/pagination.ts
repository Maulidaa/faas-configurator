import type { CommandDef } from '../commands/CommandDef';
import type { DeviceClient } from './DeviceClient';

/**
 * core/device/pagination.ts
 * Pola "device → client, banyak frame balas satu request logis"
 * (web-configurator-architecture.md Bagian 6.1) — dipakai untuk
 * CMD_SETTING_SCHEMA_LIST. Loop mengirim "next page" sampai hasMore=false,
 * lalu gabungkan semua hasil jadi satu array. Fitur (features/settings)
 * tidak pernah tahu ada pagination — cukup panggil ini dan terima array utuh.
 */
export async function sendPaginatedCommand<TItem, TPage>(
  client: DeviceClient,
  cmd: CommandDef<{ pageIndex: number }, TPage>,
  getPageInfo: (page: TPage) => { hasMore: boolean; items: TItem[] },
  opts?: { timeoutMs?: number },
): Promise<TItem[]> {
  const results: TItem[] = [];
  let pageIndex = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const page = await client.sendCommand(cmd, { pageIndex }, opts);
    const { hasMore, items } = getPageInfo(page);
    results.push(...items);
    if (!hasMore) break;
    pageIndex++;
  }

  return results;
}
