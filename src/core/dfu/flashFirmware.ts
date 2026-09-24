import type { DfuDevice } from './DfuDevice';
import { DfuError } from './DfuDevice';
import { sectorsInRange } from './descriptor';
import { DFUSE_FIRST_DATA_BLOCK_NUM } from './constants';

export type FlashStage = 'erase' | 'write' | 'manifest';

export interface FlashProgress {
  stage: FlashStage;
  current: number;
  total: number;
}

/**
 * core/dfu/flashFirmware.ts
 * Orkestrasi penuh flashing DfuSe: abort-to-idle, erase tiap sektor yang
 * overlap range firmware, tulis data per-chunk sebesar `transferSize`, lalu
 * leave DFU (device reset & lompat ke `startAddress`).
 *
 * Firmware v1 tidak punya bootloader custom (RDP level 0, ROM bootloader ST
 * bawaan dipakai langsung — project-context.md), jadi `startAddress` untuk
 * .bin mentah adalah base flash STM32F411 (0x08000000), BUKAN base+offset
 * bootloader custom manapun.
 */
export async function flashFirmware(
  dfu: DfuDevice,
  startAddress: number,
  data: Uint8Array,
  onProgress: (p: FlashProgress) => void,
): Promise<void> {
  if (!dfu.memoryLayout) {
    throw new DfuError(
      'Tidak bisa membaca peta memori DfuSe dari device (string iInterface tidak ada/tidak dikenali) — tidak aman menentukan batas sektor untuk erase.',
    );
  }
  if (data.byteLength === 0) {
    throw new DfuError('File firmware kosong.');
  }

  await dfu.abortToIdle();

  const sectors = sectorsInRange(dfu.memoryLayout, startAddress, data.byteLength);
  if (sectors.length === 0) {
    throw new DfuError('Range alamat firmware tidak overlap dengan sektor flash mana pun yang dilaporkan device.');
  }
  const nonWritable = sectors.find((s) => !s.writable);
  if (nonWritable) {
    throw new DfuError(`Sektor di alamat 0x${nonWritable.address.toString(16)} dilaporkan device sebagai tidak writable.`);
  }

  for (let i = 0; i < sectors.length; i++) {
    await dfu.eraseSector(sectors[i].address);
    onProgress({ stage: 'erase', current: i + 1, total: sectors.length });
  }

  const transferSize = dfu.transferSize;
  const totalChunks = Math.ceil(data.byteLength / transferSize);
  await dfu.setAddressPointer(startAddress);

  for (let i = 0; i < totalChunks; i++) {
    const chunk = data.subarray(i * transferSize, Math.min(data.byteLength, (i + 1) * transferSize));
    await dfu.writeDataBlock(DFUSE_FIRST_DATA_BLOCK_NUM + i, chunk);
    onProgress({ stage: 'write', current: i + 1, total: totalChunks });
  }

  onProgress({ stage: 'manifest', current: 1, total: 1 });
  await dfu.leave(startAddress);
}
