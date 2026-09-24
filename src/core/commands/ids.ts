/**
 * core/commands/ids.ts
 * Daftar command ID FINAL dari docs/protocol.md Bagian 5 — menggantikan
 * seluruh placeholder "// TODO: sinkron docs/protocol.md" yang disebut di
 * web-configurator-architecture.md Bagian 7.
 */

// 0x0000–0x00FF — System / status
export const CMD_GET_STATUS = 0x0001;

// 0x0100–0x01FF — Telemetri (read-only)
export const CMD_ATTITUDE = 0x0101;
export const CMD_GPS_DATA = 0x0102;
export const CMD_BATTERY = 0x0103;
export const CMD_IMU_RAW = 0x0104;

// 0x0200–0x02FF — Settings
export const CMD_SETTING_SCHEMA_LIST = 0x0201;
export const CMD_SETTING_GET = 0x0202;
export const CMD_SETTING_SET = 0x0203;
export const CMD_SETTING_COMMIT = 0x0204;

// 0x0300–0x03FF — Actuator test (armed-gated)
export const CMD_MOTOR_TEST = 0x0301;
export const CMD_SERVO_TEST = 0x0302;

// 0x0500–0x05FF — Mission
export const CMD_MISSION_UPLOAD = 0x0501;
export const CMD_HOME_SET = 0x0502;
/**
 * Trigger RTH manual dari web — BARU, ditemukan dari audit kode firmware
 * (navigation.c, handle_rth_trigger), belum ada di draft protocol.md
 * sebelumnya. Payload kosong, TIDAK armed-gated (RTH manual harus bisa
 * dipicu kapan pun, termasuk saat armed/terbang).
 */
export const CMD_RTH_TRIGGER = 0x0503;

// 0x0600–0x06FF — DFU / firmware update (armed-gated)
export const CMD_REBOOT_DFU = 0x0601;
export const CMD_FLASH_HASH = 0x0602;

// CMD_ERROR (0xFFFF) ada di core/protocol/constants.ts karena dipakai
// langsung oleh DeviceClient di luar jalur registry command biasa.
export { CMD_ERROR } from '../protocol/constants';
