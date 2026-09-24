/**
 * core/device/errors.ts
 * Taksonomi error (web-configurator-architecture.md Bagian 15). TransportError
 * & ProtocolError sudah ada di layer masing-masing — dua lagi didefinisikan
 * di sini karena murni konsep level DeviceClient.
 */

export class CommandTimeoutError extends Error {
  commandName: string;
  timeoutMs: number;
  constructor(commandName: string, timeoutMs: number) {
    super(`${commandName} timeout setelah ${timeoutMs}ms tanpa balasan`);
    this.name = 'CommandTimeoutError';
    this.commandName = commandName;
    this.timeoutMs = timeoutMs;
  }
}

/** Device menolak command (mis. armed-gated command ditolak saat armed=true). */
export class DeviceBusyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeviceBusyError';
  }
}

/**
 * request_id yang sama dipakai firmware untuk membalas dengan command_id
 * yang tidak cocok dengan request yang sedang pending — anomali protokol,
 * bukan sekadar timeout/busy biasa.
 */
export class UnexpectedResponseError extends Error {
  constructor(expectedCommandId: number, actualCommandId: number, requestId: number) {
    super(
      `request_id=${requestId}: mengharapkan balasan commandId=0x${expectedCommandId.toString(16)}, ` +
        `dapat 0x${actualCommandId.toString(16)}`,
    );
    this.name = 'UnexpectedResponseError';
  }
}
