import type { CommandDef } from '../commands/CommandDef';
import { CMD_ERROR, decodeErrorFrame, DeviceError } from '../commands/registry';
import { getStatusCommand } from '../commands/statusCommands';
import { encodeFrame, FrameParser, type Frame } from '../protocol/frame';
import { UNSOLICITED_REQUEST_ID } from '../protocol/constants';
import type { Transport } from '../transport/Transport';
import { TransportError } from '../transport/Transport';
import type { DeviceStatus } from '../../shared/types';
import { CommandTimeoutError, UnexpectedResponseError } from './errors';
import { DEFAULT_COMMAND_TIMEOUT_MS } from './constants';

function errToMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export type DeviceClientEvent =
  | 'connectionChange'
  | 'statusUpdate'
  | 'unsolicited'
  | 'protocolError'
  | 'commandSent'
  | 'commandResult';

/** Dipancarkan sendCommand() persis sebelum frame dikirim ke transport. */
export interface CommandSentEvent {
  requestId: number;
  commandId: number;
  commandName: string;
  payloadBytes: number;
}

/** Dipancarkan sekali per sendCommand() — sukses, ditolak device (CMD_ERROR),
 *  timeout, atau gagal kirim di level transport. Satu commandSent selalu
 *  diikuti tepat satu commandResult dengan requestId yang sama, KECUALI
 *  request_id itu sendiri gagal dialokasikan (belum sempat terkirim). */
export interface CommandResultEvent {
  requestId: number;
  commandId: number;
  commandName: string;
  ok: boolean;
  error?: string;
}

/**
 * core/device/DeviceClient.ts
 * Frozen interface per web-configurator-architecture.md Bagian 4.4.
 */
export interface DeviceClient {
  connect(transport: Transport): Promise<void>;
  disconnect(): Promise<void>;
  sendCommand<TReq, TRes>(
    cmd: CommandDef<TReq, TRes>,
    req: TReq,
    opts?: { timeoutMs?: number },
  ): Promise<TRes>;
  getStatus(): DeviceStatus | null;
  on(event: DeviceClientEvent | string, cb: (...args: any[]) => void): void;
  off(event: DeviceClientEvent | string, cb: (...args: any[]) => void): void;
}

interface PendingEntry<TRes = unknown> {
  cmd: CommandDef<unknown, TRes>;
  resolve: (value: TRes) => void;
  reject: (err: Error) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
}

/**
 * CATATAN DESAIN: web-configurator-architecture.md Bagian 8 mendeskripsikan
 * kebijakan default "single in-flight + generation token + jeda drain"
 * sebagai mitigasi SEMENTARA untuk race balasan basi vs retry cepat, dan
 * eksplisit bilang penutupan tanpa ambiguitas hanya mungkin kalau wire
 * protocol punya request-id sendiri (Bagian 21, prioritas tinggi).
 *
 * protocol.md Bagian 3 sudah memfinalkan request_id 1 byte yang di-echo
 * firmware. Karena itu implementasi di sini TIDAK memakai kebijakan single
 * in-flight lama — setiap sendCommand mendapat request_id uniknya sendiri
 * (map pending keyed by requestId), sehingga beberapa command boleh
 * pending bersamaan dan balasan basi/retry tidak akan pernah salah
 * ke-resolve ke promise yang salah. Ini penggantian yang disengaja atas
 * default lama, bukan penyimpangan darinya.
 */
export class DeviceClientImpl implements DeviceClient {
  private transport: Transport | null = null;
  private parser = new FrameParser();
  private pending = new Map<number, PendingEntry>();
  private nextRequestId = 1; // 0x00 dicadangkan untuk unsolicited (protocol.md Bagian 3)
  private cachedStatus: DeviceStatus | null = null;
  private listeners = new Map<string, Set<(...args: any[]) => void>>();

  constructor() {
    this.parser.onFrame((frame) => this.handleFrame(frame));
    this.parser.onFrameError((err) => this.emit('protocolError', err));
  }

  async connect(transport: Transport): Promise<void> {
    this.transport = transport;
    transport.setEventHandlers({
      onData: (chunk) => this.parser.feed(chunk),
      onDisconnect: () => this.handleDisconnect(),
      onError: (err) => this.handleTransportError(err),
    });
    this.emit('connectionChange', 'connecting' satisfies ConnectionState);
    await transport.connect();
    this.emit('connectionChange', 'connected' satisfies ConnectionState);
  }

  async disconnect(): Promise<void> {
    if (this.transport) {
      await this.transport.disconnect();
    }
    this.handleDisconnect();
  }

  private handleDisconnect(): void {
    // Reset pending commands, tapi TIDAK menghapus draft misi/setting yang
    // belum disimpan — itu tanggung jawab store fitur masing-masing, bukan
    // DeviceClient (Bagian 8).
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timeoutHandle);
      entry.reject(new TransportError('io-error', 'device terputus sebelum sempat membalas'));
    }
    this.pending.clear();
    this.transport = null;
    this.emit('connectionChange', 'disconnected' satisfies ConnectionState);
  }

  private handleTransportError(err: TransportError): void {
    this.emit('connectionChange', 'error' satisfies ConnectionState, err);
  }

  sendCommand<TReq, TRes>(
    cmd: CommandDef<TReq, TRes>,
    req: TReq,
    opts?: { timeoutMs?: number },
  ): Promise<TRes> {
    if (!this.transport || !this.transport.isConnected()) {
      return Promise.reject(new TransportError('no-device', 'belum terkoneksi ke device'));
    }

    const requestId = this.allocateRequestId();
    const payload = cmd.encodeRequest(req);
    const frameBytes = encodeFrame({ commandId: cmd.id, requestId, payload });

    this.emit('commandSent', {
      requestId,
      commandId: cmd.id,
      commandName: cmd.name,
      payloadBytes: payload.length,
    } satisfies CommandSentEvent);

    return new Promise<TRes>((resolve, reject) => {
      // resolve/reject dibungkus di sini (bukan di handleFrame) supaya
      // SETIAP jalur keluar dari sendCommand -- sukses, CMD_ERROR, response
      // tak terduga, timeout, maupun gagal kirim di level transport --
      // memancarkan tepat satu commandResult, dari satu tempat saja.
      const emitResult = (ok: boolean, error?: string) => {
        this.emit('commandResult', {
          requestId,
          commandId: cmd.id,
          commandName: cmd.name,
          ok,
          error,
        } satisfies CommandResultEvent);
      };

      const timeoutMs = opts?.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
      const timeoutHandle = setTimeout(() => {
        this.pending.delete(requestId);
        emitResult(false, `timeout setelah ${timeoutMs}ms`);
        reject(new CommandTimeoutError(cmd.name, timeoutMs));
      }, timeoutMs);

      this.pending.set(requestId, {
        cmd: cmd as CommandDef<unknown, unknown>,
        resolve: (value: unknown) => {
          emitResult(true);
          resolve(value as TRes);
        },
        reject: (err: Error) => {
          emitResult(false, err.message);
          reject(err);
        },
        timeoutHandle,
      });

      this.transport!.send(frameBytes).catch((err) => {
        clearTimeout(timeoutHandle);
        this.pending.delete(requestId);
        emitResult(false, errToMessage(err));
        reject(err);
      });
    });
  }

  getStatus(): DeviceStatus | null {
    return this.cachedStatus;
  }

  on(event: string, cb: (...args: any[]) => void): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(cb);
  }

  off(event: string, cb: (...args: any[]) => void): void {
    this.listeners.get(event)?.delete(cb);
  }

  private emit(event: string, ...args: any[]): void {
    this.listeners.get(event)?.forEach((cb) => cb(...args));
  }

  private allocateRequestId(): number {
    // Lewati 0x00 (unsolicited marker) dan slot yang masih pending.
    for (let i = 0; i < 255; i++) {
      const candidate = this.nextRequestId;
      this.nextRequestId = this.nextRequestId >= 255 ? 1 : this.nextRequestId + 1;
      if (candidate !== UNSOLICITED_REQUEST_ID && !this.pending.has(candidate)) {
        return candidate;
      }
    }
    throw new Error('tidak ada request_id tersedia — terlalu banyak command pending bersamaan');
  }

  private handleFrame(frame: Frame): void {
    if (frame.requestId === UNSOLICITED_REQUEST_ID) {
      this.handleUnsolicitedFrame(frame);
      return;
    }

    const entry = this.pending.get(frame.requestId);
    if (!entry) {
      // request_id sudah di-abandon (timeout) sebelumnya, atau frame nyasar
      // — bukan error, cukup diteruskan sebagai unsolicited-ish supaya
      // tidak hilang diam-diam.
      this.emit('unsolicited', frame);
      return;
    }

    clearTimeout(entry.timeoutHandle);
    this.pending.delete(frame.requestId);

    if (frame.commandId === CMD_ERROR) {
      entry.reject(new DeviceError(decodeErrorFrame(frame.payload)));
      return;
    }
    if (frame.commandId !== entry.cmd.id) {
      entry.reject(new UnexpectedResponseError(entry.cmd.id, frame.commandId, frame.requestId));
      return;
    }

    const decoded = entry.cmd.decodeResponse(frame.payload);
    if (entry.cmd.id === getStatusCommand.id) {
      this.cachedStatus = decoded as DeviceStatus;
      this.emit('statusUpdate', this.cachedStatus);
    }
    entry.resolve(decoded);
  }

  private handleUnsolicitedFrame(frame: Frame): void {
    if (frame.commandId === getStatusCommand.id) {
      this.cachedStatus = getStatusCommand.decodeResponse(frame.payload);
      this.emit('statusUpdate', this.cachedStatus);
    }
    this.emit('unsolicited', frame);
  }
}
