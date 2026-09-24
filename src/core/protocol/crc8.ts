import { CRC8_INIT, CRC8_POLY } from './constants';

/**
 * CRC8 DVB-S2 — polynomial 0xD5, tanpa reflect input/output, initial 0x00.
 * Fungsi murni tanpa state, dipakai baik oleh encodeFrame maupun FrameParser.
 * protocol.md Bagian 4.
 */
export function crc8Dvbs2(bytes: Uint8Array, initial: number = CRC8_INIT): number {
  let crc = initial & 0xff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x80 ? ((crc << 1) ^ CRC8_POLY) & 0xff : (crc << 1) & 0xff;
    }
  }
  return crc;
}
