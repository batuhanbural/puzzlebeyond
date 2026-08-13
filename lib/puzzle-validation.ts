export const PUZZLE_LAYOUT_VERSION = 3;
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const MAX_IMAGE_DIMENSION = 12_000;
// Keep worst-case RGBA decode memory near 96 MB before client-side resizing.
export const MAX_IMAGE_PIXELS = 24_000_000;
export const MAX_PUZZLE_PIECES = 1_200;
export const NEW_ROOM_CODE_LENGTH = 6;
export const MIN_IMAGE_ASPECT = 0.2;
export const MAX_IMAGE_ASPECT = 5;

export type PieceZone = "board" | "mat";
export type MatLayout = "side" | "mobile-side" | "band" | "landscape";
export type MatCoordinateSpace = "shared" | "board-relative";
export type ValidatedPiece = {
  id: number;
  x: number;
  y: number;
  locked: boolean;
  layoutVersion: number;
  zone: PieceZone;
  positioned?: true;
  matLayout?: MatLayout;
  matCoordinateSpace?: MatCoordinateSpace;
};

export type SupportedImageType = "image/jpeg" | "image/png" | "image/webp";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isValidRoomCode(value: string): boolean {
  return /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(value);
}

export function parseGridDimension(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= 2 && parsed <= 48 ? parsed : null;
}

export function boardTarget(id: number, rows: number, cols: number) {
  return { x: (id % cols) / cols, y: Math.floor(id / cols) / rows };
}

export function normalizePuzzlePiece(value: unknown, rows: number, cols: number): ValidatedPiece | null {
  if (!isRecord(value)) return null;
  const count = rows * cols;
  if (!Number.isSafeInteger(count) || count < 4 || count > MAX_PUZZLE_PIECES) return null;
  const id = value.id;
  const x = value.x;
  const y = value.y;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 0 || id >= count || typeof x !== "number" || !Number.isFinite(x) || typeof y !== "number" || !Number.isFinite(y)) {
    return null;
  }

  const locked = value.locked === true;
  if (locked) {
    const target = boardTarget(id, rows, cols);
    if (Math.abs(x - target.x) > 1e-6 || Math.abs(y - target.y) > 1e-6) return null;
    return { id, ...target, locked: true, layoutVersion: PUZZLE_LAYOUT_VERSION, zone: "board" };
  }

  const zone: PieceZone = value.zone === "board" ? "board" : "mat";
  if (zone === "mat") {
    if (value.positioned === true) {
      const matLayout = value.matLayout;
      if (matLayout !== undefined && matLayout !== "side" && matLayout !== "mobile-side" && matLayout !== "band" && matLayout !== "landscape") return null;
      const matCoordinateSpace = value.matCoordinateSpace;
      if (matCoordinateSpace !== undefined && matCoordinateSpace !== "shared" && matCoordinateSpace !== "board-relative") return null;
      const minimum = matCoordinateSpace === "board-relative" ? -2 : 0;
      const maximum = matCoordinateSpace === "board-relative" ? 3 : 0.98;
      if (x < minimum || x > maximum || y < minimum || y > maximum) return null;
      return {
        id, x, y, locked: false, layoutVersion: PUZZLE_LAYOUT_VERSION, zone, positioned: true,
        ...(matLayout ? { matLayout } : {}),
        ...(matCoordinateSpace ? { matCoordinateSpace } : {}),
      };
    }
    return { id, x: 0, y: 0, locked: false, layoutVersion: PUZZLE_LAYOUT_VERSION, zone };
  }

  const maxX = Math.max(0, 1 - 1 / cols);
  const maxY = Math.max(0, 1 - 1 / rows);
  if (x < 0 || x > maxX || y < 0 || y > maxY) return null;
  return { id, x, y, locked: false, layoutVersion: PUZZLE_LAYOUT_VERSION, zone };
}

export function normalizePuzzlePieces(value: unknown, rows: number, cols: number): ValidatedPiece[] | null {
  if (rows * cols > MAX_PUZZLE_PIECES) return null;
  if (!Array.isArray(value) || value.length !== rows * cols) return null;
  const pieces = value.map((piece) => normalizePuzzlePiece(piece, rows, cols));
  if (pieces.some((piece) => piece === null)) return null;
  const normalized = pieces as ValidatedPiece[];
  const ids = new Set(normalized.map((piece) => piece.id));
  return ids.size === rows * cols ? normalized.sort((left, right) => left.id - right.id) : null;
}

export function normalizeImageType(value: string): SupportedImageType | null {
  const normalized = value.trim().toLowerCase() === "image/jpg" ? "image/jpeg" : value.trim().toLowerCase();
  return normalized === "image/jpeg" || normalized === "image/png" || normalized === "image/webp" ? normalized : null;
}

function matches(bytes: Uint8Array, expected: number[], offset = 0) {
  return expected.every((byte, index) => bytes[offset + index] === byte);
}

export function detectImageType(bytes: Uint8Array): SupportedImageType | null {
  if (bytes.length >= 3 && matches(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (bytes.length >= 24 && matches(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (bytes.length >= 16 && matches(bytes, [0x52, 0x49, 0x46, 0x46]) && matches(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  return null;
}

function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  for (let offset = 2; offset + 8 < bytes.length;) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 1 >= bytes.length) return null;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) return null;
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isStartOfFrame && length >= 7) {
      return {
        height: (bytes[offset + 3] << 8) | bytes[offset + 4],
        width: (bytes[offset + 5] << 8) | bytes[offset + 6],
      };
    }
    offset += length;
  }
  return null;
}

function webpDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const kind = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
    const size = view.getUint32(offset + 4, true);
    const data = offset + 8;
    if (data + size > bytes.length) return null;
    if (kind === "VP8X" && size >= 10) {
      const width = 1 + bytes[data + 4] + (bytes[data + 5] << 8) + (bytes[data + 6] << 16);
      const height = 1 + bytes[data + 7] + (bytes[data + 8] << 8) + (bytes[data + 9] << 16);
      return { width, height };
    }
    if (kind === "VP8 " && size >= 10 && matches(bytes, [0x9d, 0x01, 0x2a], data + 3)) {
      return { width: view.getUint16(data + 6, true) & 0x3fff, height: view.getUint16(data + 8, true) & 0x3fff };
    }
    if (kind === "VP8L" && size >= 5 && bytes[data] === 0x2f) {
      const bits = view.getUint32(data + 1, true);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    offset = data + size + (size % 2);
  }
  return null;
}

export function imageDimensions(bytes: Uint8Array, type: SupportedImageType): { width: number; height: number } | null {
  if (type === "image/png" && bytes.length >= 24 && matches(bytes, [0x49, 0x48, 0x44, 0x52], 12)) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(8) !== 13) return null;
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (type === "image/jpeg") return jpegDimensions(bytes);
  return webpDimensions(bytes);
}

export function validateImageBytes(bytes: Uint8Array, claimedType: string): { type: SupportedImageType; width: number; height: number } | null {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) return null;
  const type = detectImageType(bytes);
  if (!type || normalizeImageType(claimedType) !== type) return null;
  const dimensions = imageDimensions(bytes, type);
  if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) return null;
  const aspect = dimensions.width / dimensions.height;
  if (dimensions.width > MAX_IMAGE_DIMENSION || dimensions.height > MAX_IMAGE_DIMENSION || dimensions.width * dimensions.height > MAX_IMAGE_PIXELS || aspect < MIN_IMAGE_ASPECT || aspect > MAX_IMAGE_ASPECT) {
    return null;
  }
  return { type, ...dimensions };
}
