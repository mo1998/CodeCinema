import { describe, expect, it } from 'vitest';
import { PieceTable } from '@/lib/engine/pieceTable';

describe('PieceTable', () => {
  it('round-trips text', () => {
    const table = PieceTable.fromString('hello world');
    expect(table.toString()).toBe('hello world');
    expect(table.length).toBe(11);
  });

  it('inserts at an offset', () => {
    const table = PieceTable.fromString('hello world');
    table.insert(5, ' brave');
    expect(table.toString()).toBe('hello brave world');
  });

  it('deletes a range', () => {
    const table = PieceTable.fromString('hello world');
    table.delete(5, 6);
    expect(table.toString()).toBe('hello');
  });

  it('replaces a range', () => {
    const table = PieceTable.fromString('hello world');
    table.splice(6, 5, 'there');
    expect(table.toString()).toBe('hello there');
  });

  it('handles appends at the end', () => {
    const table = PieceTable.fromString('a');
    table.insert(1, 'bc');
    table.insert(3, 'def');
    expect(table.toString()).toBe('abcdef');
  });

  it('clamps out-of-range operations', () => {
    const table = PieceTable.fromString('abc');
    table.delete(10, 5);
    expect(table.toString()).toBe('abc');
    // An out-of-range offset clamps to the end of the document.
    table.splice(100, 0, 'x');
    expect(table.toString()).toBe('abcx');
  });

  it('stays correct after many interleaved edits', () => {
    const table = PieceTable.fromString('');
    const reference: string[] = [];
    let referenceText = '';
    for (let i = 0; i < 400; i++) {
      const insertAt = i % 2 === 0 ? referenceText.length : 0;
      const chunk = `<${i}>`;
      table.insert(insertAt, chunk);
      referenceText =
        referenceText.slice(0, insertAt) + chunk + referenceText.slice(insertAt);
      reference.push(chunk);
    }
    expect(table.toString()).toBe(referenceText);
  });

  it('compacts without changing content', () => {
    const table = PieceTable.fromString('');
    for (let i = 0; i < 5000; i++) table.insert(table.length, 'x');
    expect(table.length).toBe(5000);
    expect(table.toString().length).toBe(5000);
  });

  it('slices and reads characters', () => {
    const table = PieceTable.fromString('abcdef');
    expect(table.slice(1, 2)).toBe('bc');
    expect(table.charAt(0)).toBe('a');
    expect(table.charAt(99)).toBe('');
  });
});
