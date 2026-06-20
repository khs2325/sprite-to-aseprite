function assertUnsignedInteger(
  value: number,
  maximum: number,
  type: string,
): void {
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new RangeError(`${type} value must be an integer from 0 to ${maximum}.`);
  }
}

export class BinaryWriter {
  readonly #bytes: number[] = [];

  get length(): number {
    return this.#bytes.length;
  }

  writeUint8(value: number): void {
    assertUnsignedInteger(value, 0xff, "Uint8");
    this.#bytes.push(value);
  }

  writeUint16LE(value: number): void {
    assertUnsignedInteger(value, 0xffff, "Uint16");
    this.#bytes.push(value & 0xff, (value >>> 8) & 0xff);
  }

  writeUint32LE(value: number): void {
    assertUnsignedInteger(value, 0xffffffff, "Uint32");
    this.#bytes.push(
      value & 0xff,
      (value >>> 8) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 24) & 0xff,
    );
  }

  writeBytes(bytes: Uint8Array): void {
    for (const byte of bytes) {
      this.#bytes.push(byte);
    }
  }

  toUint8Array(): Uint8Array {
    return Uint8Array.from(this.#bytes);
  }
}
