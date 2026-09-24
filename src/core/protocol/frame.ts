import {
  BYTE_ORDER,
  MAX_PAYLOAD_SIZE,
  PARSER_BUFFER_LIMIT,
  PREAMBLE_BYTES,
} from './constants';
import { crc8Dvbs2 } from './crc8';

if (BYTE_ORDER !== 'little-endian') {
  // Sanity guard: seluruh encode/decode di file ini ditulis mengasumsikan
  // little-endian sesuai protocol.md Bagian 2. Kalau ini pernah berubah,
  // encode/decode 16-bit di bawah wajib ditinjau ulang.
  throw new Error(`frame.ts hardcodes little-endian, got ${BYTE_ORDER}`);
}

/**
 * core/protocol/frame.ts
 *
 * CATATAN: interface `Frame` di sini menambahkan `requestId` dibanding
 * placeholder Bagian 4.2 di web-configurator-architecture.md ({ commandId,
 * payload } saja) — itu ditulis sebelum protocol.md Bagian 3 memfinalkan
 * request_id 1 byte di wire. Ini bukan penyimpangan dari kontrak, melainkan
 * penutupan salah satu open item Bagian 21 (request-id/sequence number).
 */
export interface Frame {
  commandId: number; // uint16
  requestId: number; // uint8 — 0x00 = unsolicited (protocol.md Bagian 3)
  payload: Uint8Array;
}

export function encodeFrame(frame: Frame): Uint8Array {
  const { commandId, requestId, payload } = frame;

  if (payload.length > MAX_PAYLOAD_SIZE) {
    throw new ProtocolError(
      'payload-too-large',
      `payload ${payload.length} byte melebihi MAX_PAYLOAD_SIZE (${MAX_PAYLOAD_SIZE})`,
    );
  }
  if (commandId < 0 || commandId > 0xffff) {
    throw new ProtocolError('payload-too-large', `commandId ${commandId} di luar rentang uint16`);
  }

  // Domain checksum: [length, command_id_lo, command_id_hi, request_id, payload...]
  // TIDAK termasuk 2 byte preamble (protocol.md Bagian 4).
  const domain = new Uint8Array(4 + payload.length);
  domain[0] = payload.length & 0xff;
  domain[1] = commandId & 0xff; // command_id_lo
  domain[2] = (commandId >> 8) & 0xff; // command_id_hi
  domain[3] = requestId & 0xff;
  domain.set(payload, 4);

  const crc = crc8Dvbs2(domain);

  const out = new Uint8Array(PREAMBLE_BYTES.length + domain.length + 1);
  out.set(PREAMBLE_BYTES, 0);
  out.set(domain, PREAMBLE_BYTES.length);
  out[out.length - 1] = crc;
  return out;
}

export type ProtocolErrorCode = 'crc-mismatch' | 'payload-too-large' | 'resync';

export class ProtocolError extends Error {
  code: ProtocolErrorCode;
  constructor(code: ProtocolErrorCode, message: string) {
    super(message);
    this.name = 'ProtocolError';
    this.code = code;
  }
}

type FrameCallback = (frame: Frame) => void;
type FrameErrorCallback = (err: ProtocolError) => void;

/**
 * Stream parser: menerima potongan byte kapan saja (satu transport event
 * tidak dijamin = satu frame utuh), cari preamble, validasi length + CRC8,
 * pancarkan Frame yang valid. Frame korup di-drop + resync ke preamble
 * berikutnya — TIDAK melempar exception ke pemanggil (architecture doc
 * Bagian 6).
 */
export class FrameParser {
  private buffer: number[] = [];
  private frameCb: FrameCallback | null = null;
  private errorCb: FrameErrorCallback | null = null;

  onFrame(cb: FrameCallback): void {
    this.frameCb = cb;
  }

  onFrameError(cb: FrameErrorCallback): void {
    this.errorCb = cb;
  }

  feed(chunk: Uint8Array): void {
    for (const byte of chunk) this.buffer.push(byte);
    this.drain();
    this.enforceBufferLimit();
  }

  private drain(): void {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const preambleIdx = this.findPreamble();
      if (preambleIdx === -1) {
        // Tidak ada preamble sama sekali — buang semua kecuali byte terakhir
        // (bisa jadi awal preamble berikutnya yang belum lengkap tiba).
        if (this.buffer.length > 1) {
          this.buffer.splice(0, this.buffer.length - 1);
        }
        return;
      }
      if (preambleIdx > 0) {
        // Buang byte sampah sebelum preamble (mis. sisa frame korup sebelumnya).
        this.buffer.splice(0, preambleIdx);
      }

      // Minimal: preamble(2) + length(1) + cmdId(2) + requestId(1) = 6 byte
      // sebelum kita tahu total panjang frame.
      if (this.buffer.length < 6) return; // tunggu byte lebih lanjut

      const length = this.buffer[2];
      const totalLen = 6 + length + 1; // header + payload + crc
      if (this.buffer.length < totalLen) return; // frame belum lengkap, tunggu

      const frameBytes = this.buffer.slice(0, totalLen);
      const domain = frameBytes.slice(2, 6 + length); // length..payload, exclude preamble & crc
      const receivedCrc = frameBytes[totalLen - 1];
      const computedCrc = crc8Dvbs2(new Uint8Array(domain));

      if (computedCrc !== receivedCrc) {
        this.errorCb?.(new ProtocolError('crc-mismatch', `CRC mismatch: got ${receivedCrc}, expected ${computedCrc}`));
        // Resync: buang 2 byte preamble yang gagal ini saja, supaya preamble
        // "palsu" berikutnya (kalau ada di tengah payload korup) masih bisa ditemukan.
        this.buffer.splice(0, 2);
        continue;
      }

      const commandId = frameBytes[3] | (frameBytes[4] << 8);
      const requestId = frameBytes[5];
      const payload = new Uint8Array(frameBytes.slice(6, 6 + length));

      this.buffer.splice(0, totalLen);
      this.frameCb?.({ commandId, requestId, payload });
    }
  }

  private findPreamble(): number {
    for (let i = 0; i < this.buffer.length - 1; i++) {
      if (this.buffer[i] === PREAMBLE_BYTES[0] && this.buffer[i + 1] === PREAMBLE_BYTES[1]) {
        return i;
      }
    }
    return -1;
  }

  private enforceBufferLimit(): void {
    if (this.buffer.length > PARSER_BUFFER_LIMIT) {
      this.errorCb?.(
        new ProtocolError(
          'resync',
          `buffer internal melebihi ${PARSER_BUFFER_LIMIT} byte tanpa preamble valid — dibuang sebagian (kemungkinan data non-protokol nyasar)`,
        ),
      );
      // Buang dari depan sampai turun di bawah batas lagi (architecture doc Bagian 6).
      this.buffer.splice(0, this.buffer.length - PARSER_BUFFER_LIMIT);
    }
  }
}
