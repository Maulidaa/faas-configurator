import { BinaryReader, BinaryWriter } from '../../shared/utils/binary';
import { CMD_FLASH_HASH, CMD_REBOOT_DFU } from './ids';
import { emptyRequest, type CommandDef } from './CommandDef';

/**
 * payload kosong, EKSPLISIT protocol.md Bagian 11. WAJIB ditolak firmware
 * kalau armed=true — reboot ke bootloader saat armed berbahaya.
 * Setelah ini dikirim lewat WebSerialTransport, device re-enumerasi dengan
 * VID:PID DFU (0x0483:0xDF11) — bukan proses otomatis, lihat
 * core/transport/constants.ts dan features/dfu state machine.
 */
export const rebootDfuCommand: CommandDef<void, void> = {
  id: CMD_REBOOT_DFU,
  name: 'CMD_REBOOT_DFU',
  encodeRequest: emptyRequest,
  decodeResponse() {
    // Device akan reboot sebelum sempat membalas dalam kondisi normal;
    // kalau ada balasan (mis. ditolak krn armed), itu ditangani via
    // ActuatorTestResult-style status di future response, TBD firmware.
  },
};

export interface FlashHashRequest {
  startAddress: number;
  length: number;
}

/**
 * EKSPLISIT protocol.md Bagian 11: request [start_address:u32][length:u32],
 * response [crc32:u32]. CRC32 (bukan hash kriptografis) dipilih karena
 * threat model-nya deteksi korupsi/erase-gagal-sebagian, bukan proteksi
 * pihak jahat (RDP level 0 — proyek kampus/open, keputusan final tim).
 */
export const flashHashCommand: CommandDef<FlashHashRequest, number> = {
  id: CMD_FLASH_HASH,
  name: 'CMD_FLASH_HASH',
  encodeRequest({ startAddress, length }) {
    return new BinaryWriter().u32(startAddress).u32(length).toUint8Array();
  },
  decodeResponse(payload): number {
    return new BinaryReader(payload).u32();
  },
};
