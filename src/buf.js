// Growable typed array: geometry is collected straight into compact typed storage instead of plain JS arrays
// (8 bytes per number) or per-item objects — on a 900×200×1000 map that's the difference between fitting
// in a phone's memory and not.
export class GrowBuf {
  constructor(T, n = 1 << 16) { this.a = new T(n); this.n = 0; }
  grow(k) {
    if (this.n + k <= this.a.length) return;
    let L = this.a.length * 2; while (L < this.n + k) L *= 2;
    const b = new this.a.constructor(L); b.set(this.a.subarray(0, this.n)); this.a = b;
  }
  push3(x, y, z) { this.grow(3); const a = this.a; a[this.n++] = x; a[this.n++] = y; a[this.n++] = z; }
  push4(x, y, z, w) { this.grow(4); const a = this.a; a[this.n++] = x; a[this.n++] = y; a[this.n++] = z; a[this.n++] = w; }
  // a right-sized copy; the oversized working buffer can then be collected
  trim() { return this.a.slice(0, this.n); }
}
// 0..1 colour channel → byte for a normalized Uint8 attribute
export const u8 = v => Math.max(0, Math.min(255, Math.round(v * 255)));
