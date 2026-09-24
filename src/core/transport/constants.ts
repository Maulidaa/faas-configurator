/**
 * core/transport/constants.ts
 * SATU-SATUNYA tempat nilai VID:PID didefinisikan (web-configurator-architecture.md
 * Bagian 4.1 catatan). Jangan hardcode nilai ini di tempat lain.
 */

/**
 * Mode normal (USB CDC-ACM, WebSerialTransport).
 * Terkonfirmasi dari usb_cdc_if.h firmware: 0x0483:0x5740 — TAPI masih ditandai
 * placeholder oleh firmware sendiri (protocol.md Bagian 12, belum ada nilai final
 * dari checklist K). Jangan pakai untuk filter WebSerial secara ketat; biarkan
 * fallback ke "pilih port manual" kalau filter tidak match (device tampil
 * dengan iProduct string "FC-CDC" di picker browser).
 */
export const NORMAL_MODE_VID = 0x0483;
export const NORMAL_MODE_PID = 0x5740; // TODO: konfirmasi final, lihat protocol.md Bagian 12

/**
 * Mode DFU (bootloader STM32 bawaan, WebUSBTransport).
 * VID sama dengan mode normal (ST) — PID wajib dicocokkan juga, VID saja
 * tidak cukup untuk membedakan device CDC dari device DFU.
 */
export const DFU_MODE_VID = 0x0483;
export const DFU_MODE_PID = 0xdf11;

export const DEFAULT_BAUD_RATE = 115200; // tidak krusial secara elektris, CDC-ACM abaikan nilainya
