/** Thrown for malformed or hostile frames. The server drops the message (or client), never crashes. */
export class CodecError extends Error {
  override readonly name = 'CodecError';
}

export const utf8 = new TextEncoder();
export const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

/** Sequential little-endian reader that throws CodecError instead of reading past the end. */
export class Reader {
  private offset = 0;
  private readonly view: DataView;

  constructor(bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get remaining(): number {
    return this.view.byteLength - this.offset;
  }

  private take(size: number): number {
    if (this.remaining < size) throw new CodecError('message truncated');
    const at = this.offset;
    this.offset += size;
    return at;
  }

  u8(): number {
    return this.view.getUint8(this.take(1));
  }
  i8(): number {
    return this.view.getInt8(this.take(1));
  }
  u16(): number {
    return this.view.getUint16(this.take(2), true);
  }
  i16(): number {
    return this.view.getInt16(this.take(2), true);
  }
  u32(): number {
    return this.view.getUint32(this.take(4), true);
  }
  f32(): number {
    const value = this.view.getFloat32(this.take(4), true);
    if (!Number.isFinite(value)) throw new CodecError('non-finite number');
    return value;
  }
  f64(): number {
    const value = this.view.getFloat64(this.take(8), true);
    if (!Number.isFinite(value)) throw new CodecError('non-finite number');
    return value;
  }
  string(maxLength: number): string {
    const length = this.u8();
    if (length > maxLength) throw new CodecError('string too long');
    const at = this.take(length);
    try {
      return utf8Decoder.decode(
        new Uint8Array(this.view.buffer, this.view.byteOffset + at, length),
      );
    } catch {
      throw new CodecError('invalid utf-8');
    }
  }
  /** The rest of the message as UTF-8 text (JSON payloads), at most `maxBytes` long. */
  rest(maxBytes: number): string {
    const length = this.remaining;
    if (length > maxBytes) throw new CodecError('text too long');
    const at = this.take(length);
    try {
      return utf8Decoder.decode(
        new Uint8Array(this.view.buffer, this.view.byteOffset + at, length),
      );
    } catch {
      throw new CodecError('invalid utf-8');
    }
  }
  end(): void {
    if (this.remaining !== 0) throw new CodecError('trailing bytes');
  }
}

/** Sequential little-endian writer over a pre-sized buffer. */
export class Writer {
  private offset = 0;
  private readonly view: DataView;
  readonly bytes: Uint8Array;

  constructor(size: number) {
    this.bytes = new Uint8Array(size);
    this.view = new DataView(this.bytes.buffer);
  }

  u8(v: number): this {
    this.view.setUint8(this.offset++, v);
    return this;
  }
  i8(v: number): this {
    this.view.setInt8(this.offset++, v);
    return this;
  }
  u16(v: number): this {
    this.view.setUint16(this.offset, v, true);
    this.offset += 2;
    return this;
  }
  i16(v: number): this {
    this.view.setInt16(this.offset, v, true);
    this.offset += 2;
    return this;
  }
  u32(v: number): this {
    this.view.setUint32(this.offset, v, true);
    this.offset += 4;
    return this;
  }
  f32(v: number): this {
    this.view.setFloat32(this.offset, v, true);
    this.offset += 4;
    return this;
  }
  f64(v: number): this {
    this.view.setFloat64(this.offset, v, true);
    this.offset += 8;
    return this;
  }
  string(text: string): this {
    const encoded = utf8.encode(text);
    this.u8(encoded.length);
    this.bytes.set(encoded, this.offset);
    this.offset += encoded.length;
    return this;
  }
}
