/**
 * shared/utils/binary.ts
 * Helper baca/tulis biner little-endian (protocol.md Bagian 2: "Byte order:
 * little-endian untuk semua field multi-byte"). Dipakai oleh core/commands/*
 * untuk encode/decode payload — supaya logika offset-tracking tidak
 * diulang-ulang manual di tiap command.
 */

export class BinaryWriter {
  private bytes: number[] = [];

  get length(): number {
    return this.bytes.length;
  }

  u8(value: number): this {
    this.bytes.push(value & 0xff);
    return this;
  }

  i8(value: number): this {
    return this.u8(value < 0 ? value + 0x100 : value);
  }

  u16(value: number): this {
    this.bytes.push(value & 0xff, (value >> 8) & 0xff);
    return this;
  }

  i16(value: number): this {
    return this.u16(value < 0 ? value + 0x10000 : value);
  }

  u32(value: number): this {
    this.bytes.push(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff);
    return this;
  }

  i32(value: number): this {
    return this.u32(value < 0 ? value + 0x100000000 : value);
  }

  f32(value: number): this {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setFloat32(0, value, true);
    this.bytes.push(...new Uint8Array(buf));
    return this;
  }

  /** String dengan prefix panjang 1 byte (dipakai untuk key/label/unit di setting schema). */
  lstring(value: string): this {
    const encoded = new TextEncoder().encode(value);
    if (encoded.length > 0xff) {
      throw new Error(`string "${value}" melebihi 255 byte saat encode`);
    }
    this.u8(encoded.length);
    this.bytes.push(...encoded);
    return this;
  }

  bytes_(value: Uint8Array): this {
    this.bytes.push(...value);
    return this;
  }

  toUint8Array(): Uint8Array {
    return new Uint8Array(this.bytes);
  }
}

export class BinaryReader {
  private offset = 0;
  private view: Uint8Array;
  constructor(view: Uint8Array) {
    this.view = view;
  }

  get remaining(): number {
    return this.view.length - this.offset;
  }

  u8(): number {
    return this.view[this.offset++];
  }

  i8(): number {
    const v = this.u8();
    return v > 0x7f ? v - 0x100 : v;
  }

  u16(): number {
    const v = this.view[this.offset] | (this.view[this.offset + 1] << 8);
    this.offset += 2;
    return v;
  }

  i16(): number {
    const v = this.u16();
    return v > 0x7fff ? v - 0x10000 : v;
  }

  u32(): number {
    const v =
      (this.view[this.offset] |
        (this.view[this.offset + 1] << 8) |
        (this.view[this.offset + 2] << 16) |
        (this.view[this.offset + 3] << 24)) >>>
      0;
    this.offset += 4;
    return v;
  }

  i32(): number {
    const v = this.u32();
    return v > 0x7fffffff ? v - 0x100000000 : v;
  }

  f32(): number {
    const slice = this.view.slice(this.offset, this.offset + 4);
    this.offset += 4;
    return new DataView(slice.buffer, slice.byteOffset, 4).getFloat32(0, true);
  }

  lstring(): string {
    const len = this.u8();
    const slice = this.view.slice(this.offset, this.offset + len);
    this.offset += len;
    return new TextDecoder().decode(slice);
  }

  bytes(count: number): Uint8Array {
    const slice = this.view.slice(this.offset, this.offset + count);
    this.offset += count;
    return slice;
  }
}
