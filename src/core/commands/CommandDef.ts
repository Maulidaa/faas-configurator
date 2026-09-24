/**
 * core/commands/CommandDef.ts
 * Frozen contract (web-configurator-architecture.md Bagian 4.3 & 18).
 * Tidak ada fitur yang membangun payload biner secara manual — setiap
 * command baru didefinisikan sekali mengikuti pola ini, lalu fitur cukup
 * memanggil lewat DeviceClient.sendCommand(...).
 */
export interface CommandDef<TRequest, TResponse> {
  id: number;
  name: string;
  encodeRequest(req: TRequest): Uint8Array;
  decodeResponse(payload: Uint8Array): TResponse;
}

/** Helper untuk command tanpa payload request (mis. CMD_GET_STATUS, CMD_REBOOT_DFU). */
export function emptyRequest(): Uint8Array {
  return new Uint8Array(0);
}
