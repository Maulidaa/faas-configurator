/**
 * core/protocol/constants.ts
 * SATU-SATUNYA tempat nilai wire-format didefinisikan (web-configurator-architecture.md
 * Bagian 3 & 4.2). Nilai di sini FINAL, diambil dari docs/protocol.md draft v1 —
 * menggantikan seluruh placeholder yang sebelumnya ada di file ini.
 */

export const PROTOCOL_VERSION = 1;

export const PREAMBLE_BYTES = new Uint8Array([0xfa, 0xfc]);

/**
 * Panjang maksimum payload dalam byte. 255 (bukan 256) supaya field `length`
 * di frame cukup 1 byte (uint8) tanpa perlu uint16 — protocol.md Bagian 2.
 */
export const MAX_PAYLOAD_SIZE = 255;

export const BYTE_ORDER: 'little-endian' | 'big-endian' = 'little-endian';

/** preamble(2) + length(1) + commandId(2) + requestId(1) + crc(1), tidak termasuk payload. */
export const FRAME_OVERHEAD_BYTES = 7;

export const MAX_FRAME_SIZE = FRAME_OVERHEAD_BYTES + MAX_PAYLOAD_SIZE; // 262

/**
 * Batas atas buffer internal FrameParser, dalam kelipatan MAX_FRAME_SIZE.
 * web-configurator-architecture.md Bagian 6: begitu buffer melebihi ini,
 * buang byte dari depan sampai turun lagi di bawah batas — jangan menunggu
 * preamble ketemu secara alami (mencegah unbounded growth kalau data yang
 * masuk bukan frame protokol sama sekali, mis. log debug UART nyasar).
 */
export const PARSER_BUFFER_LIMIT_MULTIPLIER = 3;
export const PARSER_BUFFER_LIMIT = MAX_FRAME_SIZE * PARSER_BUFFER_LIMIT_MULTIPLIER;

/** CRC8 DVB-S2 — polynomial 0xD5, tanpa reflect input/output, initial 0x00. protocol.md Bagian 4. */
export const CRC8_POLY = 0xd5;
export const CRC8_INIT = 0x00;

/** request_id 0x00 = frame unsolicited dari firmware (bukan balasan atas request tertentu). protocol.md Bagian 3. */
export const UNSOLICITED_REQUEST_ID = 0x00;

/** CMD_ERROR sengaja di luar rentang grup manapun supaya tidak pernah bentrok. protocol.md Bagian 5. */
export const CMD_ERROR = 0xffff;
