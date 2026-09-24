import { BinaryReader } from '../../shared/utils/binary';

/**
 * core/commands/errorFrame.ts
 *
 * MASIH TERBUKA — bukan asumsi biasa seperti file command lain di folder ini.
 * web-configurator-architecture.md Bagian 21 secara eksplisit mendaftar
 * "Respons firmware terhadap command tidak dikenal/salah format (perlu tipe
 * error response standar di commands/registry.ts)" sebagai item yang BELUM
 * diputuskan tim, dan protocol.md tidak memberi layout byte untuk CMD_ERROR
 * sama sekali (hanya ID 0xFFFF-nya yang final).
 *
 * Layout di bawah adalah placeholder supaya DeviceClient punya sesuatu yang
 * bisa dipanggil sementara menunggu keputusan firmware — GANTI begitu
 * protocol.md diupdate, jangan anggap ini final.
 *   [failed_command_id: u16][error_code: u8][message: lstring]
 */
export interface DeviceErrorPayload {
  failedCommandId: number;
  errorCode: number;
  message: string;
}

export function decodeErrorFrame(payload: Uint8Array): DeviceErrorPayload {
  const r = new BinaryReader(payload);
  return {
    failedCommandId: r.u16(),
    errorCode: r.u8(),
    message: payload.length > 3 ? r.lstring() : '',
  };
}

export class DeviceError extends Error {
  payload: DeviceErrorPayload;
  constructor(payload: DeviceErrorPayload) {
    super(`CMD_ERROR dari device: cmd=0x${payload.failedCommandId.toString(16)} code=${payload.errorCode} ${payload.message}`);
    this.name = 'DeviceError';
    this.payload = payload;
  }
}
