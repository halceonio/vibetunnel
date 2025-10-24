import type {
  EncodeSnapshotTaskPayload,
  EncodeSnapshotTaskResult,
} from '../types.js';

interface BufferCell {
  char: string;
  width: number;
  fg?: number;
  bg?: number;
  attributes?: number;
}

interface Snapshot {
  cols: number;
  rows: number;
  viewportY: number;
  cursorX: number;
  cursorY: number;
  cells: BufferCell[][];
}

const MAGIC_HEADER = 0x5654;

const hashRow = (row: BufferCell[]): string => {
  if (row.length === 0) {
    return 'EMPTY';
  }
  return row
    .map(
      (cell) =>
        `${cell.char}:${cell.width}:${cell.fg ?? ''}:${cell.bg ?? ''}:${cell.attributes ?? ''}`
    )
    .join('|');
};

const calculateCellSize = (cell: BufferCell): number => {
  const isSpace = cell.char === ' ';
  const hasAttrs = cell.attributes && cell.attributes !== 0;
  const hasFg = cell.fg !== undefined;
  const hasBg = cell.bg !== undefined;
  const isAscii = cell.char.charCodeAt(0) <= 127;

  if (isSpace && !hasAttrs && !hasFg && !hasBg) {
    return 1;
  }

  let size = 1;

  if (isAscii) {
    size += 1;
  } else {
    const charBytes = Buffer.byteLength(cell.char, 'utf8');
    size += 1 + charBytes;
  }

  if (hasAttrs || hasFg || hasBg) {
    size += 1;

    if (hasFg && cell.fg !== undefined) {
      size += cell.fg > 255 ? 3 : 1;
    }

    if (hasBg && cell.bg !== undefined) {
      size += cell.bg > 255 ? 3 : 1;
    }
  }

  return size;
};

const calculateRowSize = (rowCells: BufferCell[]): number => {
  if (
    rowCells.length === 0 ||
    (rowCells.length === 1 &&
      rowCells[0].char === ' ' &&
      !rowCells[0].fg &&
      !rowCells[0].bg &&
      !rowCells[0].attributes)
  ) {
    return 2;
  }

  let size = 3;
  for (const cell of rowCells) {
    size += calculateCellSize(cell);
  }
  return size;
};

const encodeRow = (buffer: Buffer, offset: number, rowCells: BufferCell[]): number => {
  if (
    rowCells.length === 0 ||
    (rowCells.length === 1 &&
      rowCells[0].char === ' ' &&
      !rowCells[0].fg &&
      !rowCells[0].bg &&
      !rowCells[0].attributes)
  ) {
    buffer.writeUInt8(0x00, offset++);
    buffer.writeUInt8(0x00, offset++);
    return offset;
  }

  buffer.writeUInt8(0x01, offset++);
  buffer.writeUInt16LE(rowCells.length, offset);
  offset += 2;

  for (const cell of rowCells) {
    const isSpace = cell.char === ' ';
    const hasAttrs = cell.attributes && cell.attributes !== 0;
    const hasFg = cell.fg !== undefined;
    const hasBg = cell.bg !== undefined;
    const isAscii = cell.char.charCodeAt(0) <= 127;

    if (isSpace && !hasAttrs && !hasFg && !hasBg) {
      buffer.writeUInt8(0x00, offset++);
      continue;
    }

    buffer.writeUInt8(0x01, offset++);

    if (isAscii) {
      buffer.writeUInt8(cell.char.charCodeAt(0), offset++);
    } else {
      const charBytes = Buffer.from(cell.char, 'utf8');
      buffer.writeUInt8(charBytes.length, offset++);
      charBytes.copy(buffer, offset);
      offset += charBytes.length;
    }

    if (hasAttrs || hasFg || hasBg) {
      let flags = 0;
      if (hasAttrs) flags |= 0x01;
      if (hasFg) flags |= 0x02;
      if (hasBg) flags |= 0x04;
      buffer.writeUInt8(flags, offset++);

      if (hasAttrs && cell.attributes !== undefined) {
        buffer.writeUInt8(cell.attributes, offset++);
      }

      if (hasFg && cell.fg !== undefined) {
        if (cell.fg > 255) {
          buffer.writeUInt8(0xff, offset++);
          buffer.writeUInt16LE(cell.fg, offset);
          offset += 2;
        } else {
          buffer.writeUInt8(cell.fg, offset++);
        }
      }

      if (hasBg && cell.bg !== undefined) {
        if (cell.bg > 255) {
          buffer.writeUInt8(0xff, offset++);
          buffer.writeUInt16LE(cell.bg, offset);
          offset += 2;
        } else {
          buffer.writeUInt8(cell.bg, offset++);
        }
      }
    }
  }

  return offset;
};

const encodeSnapshot = (
  snapshot: Snapshot,
  previousSnapshot: Snapshot | null
): { buffer: Buffer; usedDiff: boolean } => {
  const { cols, rows, viewportY, cursorX, cursorY, cells } = snapshot;

  let useDiff = false;
  let changedRows: Array<{ index: number; row: BufferCell[] }> = [];

  if (
    previousSnapshot &&
    previousSnapshot.cols === cols &&
    previousSnapshot.rows === rows &&
    previousSnapshot.viewportY === viewportY
  ) {
    const prevRowHashes = previousSnapshot.cells.map(hashRow);
    const currentRowHashes = cells.map(hashRow);

    for (let i = 0; i < currentRowHashes.length; i++) {
      if (prevRowHashes[i] !== currentRowHashes[i]) {
        changedRows.push({ index: i, row: cells[i] });
      }
    }

    if (changedRows.length > 0 && changedRows.length < cells.length) {
      useDiff = true;
    } else {
      changedRows = [];
    }
  }

  let buffer: Buffer;
  let offset = 0;
  const flags = useDiff ? 0x01 : 0x00;

  if (useDiff && changedRows.length > 0) {
    let dataSize = 32 + 2;
    for (const { row } of changedRows) {
      dataSize += 2;
      dataSize += calculateRowSize(row);
    }

    buffer = Buffer.allocUnsafe(dataSize);

    buffer.writeUInt16LE(MAGIC_HEADER, offset);
    offset += 2;
    buffer.writeUInt8(0x01, offset++);
    buffer.writeUInt8(flags, offset++);
    buffer.writeUInt32LE(cols, offset);
    offset += 4;
    buffer.writeUInt32LE(rows, offset);
    offset += 4;
    buffer.writeInt32LE(viewportY, offset);
    offset += 4;
    buffer.writeInt32LE(cursorX, offset);
    offset += 4;
    buffer.writeInt32LE(cursorY, offset);
    offset += 4;
    buffer.writeUInt32LE(0, offset);
    offset += 4;

    buffer.writeUInt16LE(changedRows.length, offset);
    offset += 2;

    for (const { index, row } of changedRows) {
      buffer.writeUInt16LE(index, offset);
      offset += 2;
      offset = encodeRow(buffer, offset, row);
    }
  } else {
    let dataSize = 32;
    for (const rowCells of cells) {
      dataSize += calculateRowSize(rowCells);
    }

    buffer = Buffer.allocUnsafe(dataSize);

    buffer.writeUInt16LE(MAGIC_HEADER, offset);
    offset += 2;
    buffer.writeUInt8(0x01, offset++);
    buffer.writeUInt8(flags, offset++);
    buffer.writeUInt32LE(cols, offset);
    offset += 4;
    buffer.writeUInt32LE(rows, offset);
    offset += 4;
    buffer.writeInt32LE(viewportY, offset);
    offset += 4;
    buffer.writeInt32LE(cursorX, offset);
    offset += 4;
    buffer.writeInt32LE(cursorY, offset);
    offset += 4;
    buffer.writeUInt32LE(0, offset);
    offset += 4;

    for (const rowCells of cells) {
      offset = encodeRow(buffer, offset, rowCells);
    }
  }

  return { buffer: buffer.subarray(0, offset), usedDiff: useDiff };
};

export async function encodeSnapshotTask(
  payload: EncodeSnapshotTaskPayload
): Promise<EncodeSnapshotTaskResult> {
  const startTime = Date.now();
  const { buffer, usedDiff } = encodeSnapshot(
    payload.snapshot as Snapshot,
    (payload.previousSnapshot as Snapshot) ?? null
  );
  const duration = Date.now() - startTime;
  if (duration > 25) {
    // eslint-disable-next-line no-console
    console.debug(
      `Worker encoded snapshot${usedDiff ? ' (diff)' : ''} in ${duration}ms (${payload.snapshot.rows} rows)`
    );
  }

  return {
    buffer: buffer.buffer,
    byteOffset: buffer.byteOffset,
    byteLength: buffer.byteLength,
    usedDiff,
  };
}
