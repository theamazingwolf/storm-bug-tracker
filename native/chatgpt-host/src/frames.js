import { MAX_FRAME_BYTES, MAX_RESPONSE_BYTES } from "./constants.js";

export class FrameDecoder {
  #buffer = Buffer.alloc(0);
  constructor({ maxBytes = MAX_FRAME_BYTES } = {}) { this.maxBytes = maxBytes; }
  push(chunk) {
    if (chunk.length > 64 * 1024) {
      const values = [];
      for (let offset = 0; offset < chunk.length; offset += 64 * 1024) values.push(...this.push(chunk.subarray(offset, Math.min(offset + 64 * 1024, chunk.length))));
      return values;
    }
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    const values = [];
    while (this.#buffer.length >= 4) {
      const size = this.#buffer.readUInt32LE(0);
      if (size < 2 || size > this.maxBytes || size > MAX_FRAME_BYTES) throw new Error("invalid_frame_size");
      if (this.#buffer.length < size + 4) break;
      const bytes = this.#buffer.subarray(4, size + 4);
      let parsed;
      try { parsed = JSON.parse(bytes.toString("utf8")); } catch { throw new Error("invalid_json_frame"); }
      values.push(parsed);
      this.#buffer = this.#buffer.subarray(size + 4);
    }
    if (this.#buffer.length > this.maxBytes + 4) throw new Error("oversized_frame");
    return values;
  }
  finish() { if (this.#buffer.length) throw new Error("truncated_frame"); }
}

export function encodeFrame(value, { maxBytes = MAX_RESPONSE_BYTES } = {}) {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  if (body.length > maxBytes || body.length > MAX_FRAME_BYTES) throw new Error("response_too_large");
  const frame = Buffer.allocUnsafe(body.length + 4);
  frame.writeUInt32LE(body.length, 0);
  body.copy(frame, 4);
  return frame;
}

export function readNativeMessages(input, onMessage, onFatal = () => {}) {
  const decoder = new FrameDecoder();
  input.on("data", (chunk) => {
    try { for (const message of decoder.push(chunk)) onMessage(message); }
    catch (error) { onFatal(error); input.destroy(error); }
  });
  input.on("end", () => {
    try { decoder.finish(); } catch (error) { onFatal(error); }
  });
}
