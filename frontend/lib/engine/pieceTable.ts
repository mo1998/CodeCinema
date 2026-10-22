/**
 * Piece table — a rope for text buffers.
 *
 * Why not just a JS string? Because playback replays *edits*, and a replayed
 * session can contain 100k+ events. Repeatedly doing
 * `s = s.slice(0, off) + text + s.slice(off)` on a 200 KB file is O(n) per edit
 * and therefore O(n²) per session: seconds of garbage collection for a single
 * seek. The piece table makes an edit O(log n) to locate plus O(1) to record,
 * and only pays the O(n) flattening cost when the text is actually read.
 *
 * The implementation keeps pieces in a flat array (cheap binary search + splice)
 * and periodically compacts to a single piece, which bounds the amortised cost
 * of the array splice to O(MAX_PIECES) per edit instead of O(pieces).
 */

const ORIGINAL = 0;
const ADDED = 1;

interface Piece {
  /** Which backing buffer the slice lives in. */
  buf: number;
  /** Start offset inside that buffer. */
  start: number;
  /** Length of the slice. */
  len: number;
}

/** Compact once the piece array exceeds this size. Bounds splice cost. */
const MAX_PIECES = 2048;

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export class PieceTable {
  private original = '';
  private added = '';
  private pieces: Piece[] = [];
  private cachedString: string | null = null;

  constructor(initial = '') {
    this.original = initial;
    if (initial.length > 0) {
      this.pieces = [{ buf: ORIGINAL, start: 0, len: initial.length }];
    }
  }

  static fromString(text: string): PieceTable {
    return new PieceTable(text);
  }

  get length(): number {
    let total = 0;
    for (const p of this.pieces) total += p.len;
    return total;
  }

  toString(): string {
    if (this.cachedString !== null) return this.cachedString;
    if (this.pieces.length === 0) {
      this.cachedString = '';
      return this.cachedString;
    }
    if (this.pieces.length === 1) {
      const p = this.pieces[0];
      const buf = p.buf === ORIGINAL ? this.original : this.added;
      this.cachedString = buf.slice(p.start, p.start + p.len);
      return this.cachedString;
    }
    const parts: string[] = new Array(this.pieces.length);
    for (let i = 0; i < this.pieces.length; i++) {
      const p = this.pieces[i];
      const buf = p.buf === ORIGINAL ? this.original : this.added;
      parts[i] = buf.slice(p.start, p.start + p.len);
    }
    this.cachedString = parts.join('');
    return this.cachedString;
  }

  /** Character at `offset`. */
  charAt(offset: number): string {
    if (offset < 0 || offset >= this.length) return '';
    const { piece, within } = this.locate(offset);
    if (!piece) return '';
    const buf = piece.buf === ORIGINAL ? this.original : this.added;
    return buf[piece.start + within];
  }

  /** Slice `[offset, offset + count)` as a string. */
  slice(offset: number, count: number): string {
    const len = this.length;
    const start = clamp(offset, 0, len);
    const end = clamp(start + Math.max(0, count), start, len);
    if (end <= start) return '';

    const parts: string[] = [];
    let cursor = 0;
    for (const piece of this.pieces) {
      const pieceEnd = cursor + piece.len;
      if (pieceEnd <= start) {
        cursor = pieceEnd;
        continue;
      }
      if (cursor >= end) break;
      const buf = piece.buf === ORIGINAL ? this.original : this.added;
      const from = Math.max(start - cursor, 0);
      const to = Math.min(piece.len, end - cursor);
      parts.push(buf.slice(piece.start + from, piece.start + to));
      cursor = pieceEnd;
    }
    return parts.join('');
  }

  /**
   * Replace `count` characters at `offset` with `text`.
   * Returns the number of characters removed.
   */
  splice(offset: number, count: number, text: string): number {
    const len = this.length;
    const start = clamp(offset, 0, len);
    const end = clamp(start + Math.max(0, count), start, len);
    const removed = end - start;
    if (removed === 0 && text.length === 0) return 0;

    const startLoc = this.locate(start);
    const endLoc = this.locate(end);

    const next: Piece[] = [];

    // Head: everything strictly before `start`.
    for (let i = 0; i < startLoc.index; i++) next.push(this.pieces[i]);
    const startPiece = this.pieces[startLoc.index];
    if (startPiece && startLoc.within > 0) {
      next.push({
        buf: startPiece.buf,
        start: startPiece.start,
        len: startLoc.within,
      });
    }

    // The inserted text.
    if (text.length > 0) {
      const at = this.added.length;
      this.added += text;
      next.push({ buf: ADDED, start: at, len: text.length });
    }

    // Tail: everything strictly after `end`.
    const endPiece = this.pieces[endLoc.index];
    if (endPiece) {
      const rest = endPiece.len - endLoc.within;
      if (rest > 0) {
        next.push({
          buf: endPiece.buf,
          start: endPiece.start + endLoc.within,
          len: rest,
        });
      }
    }
    for (let i = endLoc.index + 1; i < this.pieces.length; i++) {
      next.push(this.pieces[i]);
    }

    this.pieces = this.coalesce(next);
    this.cachedString = null;
    if (this.pieces.length > MAX_PIECES) this.compact();
    return removed;
  }

  insert(offset: number, text: string): void {
    this.splice(offset, 0, text);
  }

  delete(offset: number, count: number): number {
    return this.splice(offset, count, '');
  }

  /** Replace the whole content. */
  setText(text: string): void {
    this.original = text;
    this.added = '';
    this.pieces = text.length ? [{ buf: ORIGINAL, start: 0, len: text.length }] : [];
    this.cachedString = null;
  }

  /**
   * Locate the piece containing `offset`.
   *
   * Returns the piece index and the offset *within* that piece. A boundary
   * offset resolves to the start of the following piece, which is what makes
   * "insert at the end of the document" land in the right place.
   */
  private locate(offset: number): { index: number; within: number; piece?: Piece } {
    let cursor = 0;
    for (let i = 0; i < this.pieces.length; i++) {
      const piece = this.pieces[i];
      if (offset < cursor + piece.len) {
        return { index: i, within: offset - cursor, piece };
      }
      cursor += piece.len;
    }
    // Past the end: the insertion point is the end of the last piece.
    const lastIndex = this.pieces.length - 1;
    if (lastIndex < 0) return { index: 0, within: 0 };
    return {
      index: lastIndex,
      within: this.pieces[lastIndex].len,
      piece: this.pieces[lastIndex],
    };
  }

  /** Merge adjacent pieces that live in the same buffer and are contiguous. */
  private coalesce(pieces: Piece[]): Piece[] {
    const out: Piece[] = [];
    for (const piece of pieces) {
      if (piece.len === 0) continue;
      const previous = out[out.length - 1];
      if (
        previous &&
        previous.buf === piece.buf &&
        previous.start + previous.len === piece.start
      ) {
        previous.len += piece.len;
      } else {
        out.push({ ...piece });
      }
    }
    return out;
  }

  /** Flatten to a single piece to bound future splice cost. */
  private compact(): void {
    const text = this.toString();
    this.original = text;
    this.added = '';
    this.pieces = text.length ? [{ buf: ORIGINAL, start: 0, len: text.length }] : [];
    this.cachedString = text;
  }
}
