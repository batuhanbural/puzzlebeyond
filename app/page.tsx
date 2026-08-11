"use client";

import { ChangeEvent, CSSProperties, PointerEvent, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { GalleryKind } from "@/lib/gallery";
import type { RealtimeSubscription, RoomDragMessage } from "@/lib/realtime-client";

type PieceZone = "board" | "mat";
type Piece = { id: number; x: number; y: number; locked?: boolean; layoutVersion?: number; zone?: PieceZone };
type Room = {
  code: string;
  title: string;
  rows: number;
  cols: number;
  pieces: Piece[];
  imageUrl: string;
  updatedAt: number;
};

type RoomPlayer = {
  clientId: string;
  nickname: string;
  lastSeenAt: number;
};

type RemoteDrag = RoomDragMessage & { expiresAt: number };
type LocalDrag = {
  id: number;
  clientX: number;
  clientY: number;
  width: number;
  height: number;
  originalStyle: string;
  element: HTMLDivElement;
  gestureId: string;
  liveX: number;
  liveY: number;
  lastBroadcastAt: number;
  subscription: RealtimeSubscription | null;
};

type ApiPayload<T> = T & { error?: string };
type GalleryItem = {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  rows: number;
  cols: number;
  count: number;
  accent: string;
  kind: GalleryKind;
};

const DEFAULT_ROWS = 3;
const DEFAULT_COLS = 4;
const DEFAULT_IMAGE_ASPECT = 4 / 3;
const ROOM_STORAGE_KEY = "puzzlebeyond-active-room";
const NICKNAME_STORAGE_KEY = "puzzle-name";
const BOARD = { left: 0.2, top: 0.15, width: 0.6, height: 0.7 } as const;
const MOBILE_HORIZONTAL_BOARD = { left: 0.06, top: 0.26, width: 0.88, height: 0.48 } as const;
const PUZZLE_LAYOUT_VERSION = 3;
const MAX_VISIBLE_LOOSE_PIECES = 120;
const LIVE_DRAG_INTERVAL_MS = 33;
const REMOTE_MOVE_TRANSITION_MS = 90;
const REMOTE_SETTLE_TRANSITION_MS = 110;
const REMOTE_DRAG_TTL_MS = 2_500;
const REMOTE_DROP_HANDOFF_MS = 2_500;
const MAX_REMOTE_DRAGS = 16;
const PUZZLE_SIZES = [
  { count: 12, rows: 3, cols: 4, label: "RAHAT" },
  { count: 20, rows: 4, cols: 5, label: "KOLAY" },
  { count: 48, rows: 6, cols: 8, label: "ORTA" },
  { count: 120, rows: 10, cols: 12, label: "ZOR" },
  { count: 300, rows: 15, cols: 20, label: "UZMAN" },
  { count: 600, rows: 20, cols: 30, label: "USTA" },
  { count: 1024, rows: 32, cols: 32, label: "EFSANE" },
] as const;

const puzzleImageCache = new Map<string, Promise<HTMLImageElement>>();
const MAX_CACHED_PUZZLE_IMAGES = 12;
const puzzlePieceCanvasCache = new Map<string, HTMLCanvasElement>();
const MAX_CACHED_PUZZLE_CANVASES = 128;
const puzzlePieceVisibility = new Map<Element, (visible: boolean) => void>();
let puzzlePieceObserver: IntersectionObserver | null = null;
let generatedDefaultImage: string | null = null;
let generatedDefaultImagePromise: Promise<string> | null = null;

function puzzlePieceCanvasKey(id: number, rows: number, cols: number, seed: string, imageUrl: string) {
  return `${imageUrl}\u0000${seed}\u0000${rows}x${cols}\u0000${id}`;
}

function rememberPuzzlePieceCanvas(key: string, canvas: HTMLCanvasElement) {
  if (canvas.width <= 1 || canvas.height <= 1) return;
  const previous = puzzlePieceCanvasCache.get(key);
  if (previous && previous !== canvas) {
    previous.width = 1;
    previous.height = 1;
  }
  puzzlePieceCanvasCache.delete(key);
  puzzlePieceCanvasCache.set(key, canvas);
  while (puzzlePieceCanvasCache.size > MAX_CACHED_PUZZLE_CANVASES) {
    const oldestKey = puzzlePieceCanvasCache.keys().next().value;
    if (typeof oldestKey !== "string") break;
    const oldest = puzzlePieceCanvasCache.get(oldestKey);
    if (oldest) {
      oldest.width = 1;
      oldest.height = 1;
    }
    puzzlePieceCanvasCache.delete(oldestKey);
  }
}

function restorePuzzlePieceCanvas(key: string, canvas: HTMLCanvasElement) {
  const cached = puzzlePieceCanvasCache.get(key);
  if (!cached) return false;
  puzzlePieceCanvasCache.delete(key);
  if (cached === canvas) return true;
  canvas.width = cached.width;
  canvas.height = cached.height;
  const context = canvas.getContext("2d");
  if (context) context.drawImage(cached, 0, 0);
  cached.width = 1;
  cached.height = 1;
  return Boolean(context);
}

function clearPuzzlePieceCanvasCache() {
  for (const canvas of puzzlePieceCanvasCache.values()) {
    canvas.width = 1;
    canvas.height = 1;
  }
  puzzlePieceCanvasCache.clear();
}

function normalizeNickname(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 24);
}

function getStoredNickname() {
  if (typeof window === "undefined") return "";
  try {
    return normalizeNickname(window.localStorage.getItem(NICKNAME_STORAGE_KEY) || "");
  } catch {
    return "";
  }
}

function loadPuzzleImage(src: string) {
  const cached = puzzleImageCache.get(src);
  if (cached) return cached;
  const pending = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => {
      if (typeof image.decode !== "function") {
        resolve(image);
        return;
      }
      void image.decode().catch(() => {}).then(() => resolve(image));
    };
    image.onerror = () => reject(new Error("Puzzle görseli yüklenemedi."));
    image.src = src;
  });
  if (puzzleImageCache.size >= MAX_CACHED_PUZZLE_IMAGES) {
    const oldest = puzzleImageCache.keys().next().value as string | undefined;
    if (oldest) puzzleImageCache.delete(oldest);
  }
  puzzleImageCache.set(src, pending);
  void pending.catch(() => {
    if (puzzleImageCache.get(src) === pending) puzzleImageCache.delete(src);
  });
  return pending;
}

function observePuzzlePiece(element: Element, callback: (visible: boolean) => void) {
  if (typeof IntersectionObserver === "undefined") {
    callback(true);
    return () => {};
  }
  if (!puzzlePieceObserver) {
    puzzlePieceObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) puzzlePieceVisibility.get(entry.target)?.(entry.isIntersecting);
    }, { rootMargin: "300px" });
  }
  puzzlePieceVisibility.set(element, callback);
  puzzlePieceObserver.observe(element);
  return () => {
    puzzlePieceObserver?.unobserve(element);
    puzzlePieceVisibility.delete(element);
    if (puzzlePieceVisibility.size === 0) {
      puzzlePieceObserver?.disconnect();
      puzzlePieceObserver = null;
    }
  };
}

type PuzzleSize = { count: number; rows: number; cols: number; label: string };

function fitPuzzleSize(size: PuzzleSize, aspect: number) {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : DEFAULT_IMAGE_ASPECT;
  let bestRows = size.rows;
  let bestCols = size.cols;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let rows = 2; rows <= 48; rows++) {
    for (let cols = 2; cols <= 48; cols++) {
      const count = rows * cols;
      const cellAspect = safeAspect * rows / cols;
      const stretch = Math.max(cellAspect, 1 / cellAspect);
      const aspectPenalty = (stretch - 1) * (stretch - 1);
      const countDev = Math.abs(count - size.count) / size.count;
      const score = aspectPenalty + countDev;
      if (score < bestScore) {
        bestScore = score;
        bestRows = rows;
        bestCols = cols;
      }
    }
  }
  return { ...size, rows: bestRows, cols: bestCols, count: bestRows * bestCols };
}

function createDefaultImage() {
  if (typeof document === "undefined") return Promise.resolve("");
  if (generatedDefaultImage) return Promise.resolve(generatedDefaultImage);
  if (generatedDefaultImagePromise) return generatedDefaultImagePromise;
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 900;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#f4f0e6";
  ctx.fillRect(0, 0, 1200, 900);
  ctx.fillStyle = "#d3d3ff";
  ctx.fillRect(0, 0, 1200, 210);
  ctx.fillStyle = "#ff6f61";
  ctx.beginPath(); ctx.arc(950, 265, 205, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#4864ff";
  ctx.fillRect(105, 310, 460, 420);
  ctx.fillStyle = "#151515";
  ctx.font = "900 126px Arial";
  ctx.fillText("BİRLİKTE", 72, 170);
  ctx.fillStyle = "#f4f0e6";
  ctx.font = "900 104px Arial";
  ctx.fillText("TAMAMLA", 140, 470);
  ctx.fillText("!", 405, 615);
  ctx.fillStyle = "#151515";
  ctx.beginPath(); ctx.arc(870, 610, 88, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#d3d3ff";
  ctx.beginPath(); ctx.arc(870, 610, 42, 0, Math.PI * 2); ctx.fill();
  generatedDefaultImagePromise = new Promise<string>((resolve) => {
    canvas.toBlob((blob) => {
      if (blob) {
        const url = URL.createObjectURL(blob);
        canvas.width = canvas.height = 1;
        generatedDefaultImage = url;
        resolve(url);
        return;
      }
      const url = canvas.toDataURL("image/jpeg", 0.9);
      canvas.width = canvas.height = 1;
      generatedDefaultImage = url;
      resolve(url);
    }, "image/jpeg", 0.9);
  }).finally(() => { generatedDefaultImagePromise = null; });
  return generatedDefaultImagePromise;
}

function pieceBoardTarget(id: number, rows: number, cols: number) {
  return {
    x: (id % cols) / cols,
    y: Math.floor(id / cols) / rows,
  };
}

type PieceRailPosition = { x: number; y: number };
type PieceRailMode = "sides" | "top-bottom";
type BoardFrame = { readonly left: number; readonly top: number; readonly width: number; readonly height: number };

function pieceRailPositions(rows: number, cols: number, seed: string, board: BoardFrame, mode: PieceRailMode) {
  let state = Array.from(seed).reduce(
    (total, character) => Math.imul(total ^ character.charCodeAt(0), 2654435761),
    2166136261,
  ) >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const shuffle = <T,>(values: T[]) => {
    for (let index = values.length - 1; index > 0; index--) {
      const swapIndex = Math.floor(random() * (index + 1));
      [values[index], values[swapIndex]] = [values[swapIndex], values[index]];
    }
    return values;
  };
  const count = rows * cols;
  const cellWidth = board.width / cols;
  const cellHeight = board.height / rows;
  const ids = shuffle(Array.from({ length: count }, (_, id) => id));
  const positions = new Map<number, PieceRailPosition>();

  if (count <= 20) {
    const perRail = Math.ceil(count / 2);
    ids.forEach((id, index) => {
      const rail = index % 2;
      const slot = Math.floor(index / 2);
      const spread = (slot + 0.18 + random() * 0.64) / perRail;
      const x = mode === "sides"
        ? (rail === 0
          ? 0.012 + random() * 0.018
          : Math.min(0.99 - cellWidth, board.left + board.width + 0.014 + random() * 0.018))
        : Math.min(0.99 - cellWidth, spread * (0.99 - cellWidth));
      const y = mode === "top-bottom"
        ? (rail === 0
          ? 0.012 + random() * 0.018
          : Math.min(0.99 - cellHeight, board.top + board.height + 0.014 + random() * 0.018))
        : Math.min(0.99 - cellHeight, spread * (0.99 - cellHeight));
      positions.set(id, { x, y });
    });
    return positions;
  }

  const firstRailSlots: PieceRailPosition[] = [];
  const secondRailSlots: PieceRailPosition[] = [];
  const stepX = cellWidth * 0.82;
  const stepY = cellHeight * 0.82;
  for (let y = 0.012; y <= 0.988 - cellHeight; y += stepY) {
    for (let x = 0.012; x <= 0.988 - cellWidth; x += stepX) {
      const fitsFirst = mode === "sides"
        ? x + cellWidth * 0.9 < board.left - 0.006
        : y + cellHeight * 0.9 < board.top - 0.006;
      const fitsSecond = mode === "sides"
        ? x > board.left + board.width + 0.006
        : y > board.top + board.height + 0.006;
      if (!fitsFirst && !fitsSecond) continue;
      const position = {
        x: Math.max(0.005, Math.min(0.99 - cellWidth, x + (random() - 0.5) * cellWidth * 0.12)),
        y: Math.max(0.005, Math.min(0.99 - cellHeight, y + (random() - 0.5) * cellHeight * 0.12)),
      };
      (fitsFirst ? firstRailSlots : secondRailSlots).push(position);
    }
  }
  shuffle(firstRailSlots);
  shuffle(secondRailSlots);
  const slots: PieceRailPosition[] = [];
  for (let index = 0; index < Math.max(firstRailSlots.length, secondRailSlots.length); index++) {
    if (firstRailSlots[index]) slots.push(firstRailSlots[index]);
    if (secondRailSlots[index]) slots.push(secondRailSlots[index]);
  }
  ids.forEach((id, index) => {
    const rawFallbackX = index % 2 === 0
      ? 0.006 + random() * Math.max(0.006, board.left - cellWidth - 0.018)
      : board.left + board.width + 0.008 + random() * Math.max(0.006, 0.982 - board.left - board.width - cellWidth);
    const rawFallbackY = index % 2 === 0
      ? 0.006 + random() * Math.max(0.006, board.top - cellHeight - 0.018)
      : board.top + board.height + 0.008 + random() * Math.max(0.006, 0.982 - board.top - board.height - cellHeight);
    const fallbackX = Math.max(0.005, Math.min(0.99 - cellWidth, rawFallbackX));
    const fallbackY = Math.max(0.005, Math.min(0.99 - cellHeight, rawFallbackY));
    positions.set(id, slots[index] ?? {
      x: mode === "sides" ? fallbackX : 0.01 + random() * Math.max(0.01, 0.98 - cellWidth),
      y: mode === "top-bottom" ? fallbackY : 0.01 + random() * Math.max(0.01, 0.98 - cellHeight),
    });
  });
  return positions;
}

function sidePiecePositions(rows: number, cols: number, seed: string) {
  return pieceRailPositions(rows, cols, seed, BOARD, "sides");
}

function bandPiecePositions(rows: number, cols: number, seed: string) {
  return pieceRailPositions(rows, cols, seed, MOBILE_HORIZONTAL_BOARD, "top-bottom");
}

function scatteredPieces(rows: number, cols: number, _seed?: string) {
  void _seed;
  return Array.from({ length: rows * cols }, (_, id) => ({
    id,
    x: 0,
    y: 0,
    zone: "mat" as const,
    locked: false,
    layoutVersion: PUZZLE_LAYOUT_VERSION,
  }));
}

function normalizePieceLayout(pieces: Piece[], rows: number, cols: number, seed: string) {
  void seed;
  const count = rows * cols;
  const maxX = Math.max(0, 1 - 1 / cols);
  const maxY = Math.max(0, 1 - 1 / rows);
  return pieces.map((piece) => {
    const id = Math.max(0, Math.min(count - 1, Math.floor(Number(piece.id) || 0)));
    if (piece.locked) {
      return { id, ...pieceBoardTarget(id, rows, cols), zone: "board" as const, locked: true, layoutVersion: PUZZLE_LAYOUT_VERSION };
    }
    const usesCurrentLayout = piece.layoutVersion === PUZZLE_LAYOUT_VERSION
      && piece.zone === "board"
      && Number.isFinite(piece.x) && Number.isFinite(piece.y)
      && piece.x >= 0 && piece.x <= maxX && piece.y >= 0 && piece.y <= maxY;
    return usesCurrentLayout
      ? { ...piece, id, zone: "board" as const, locked: false, layoutVersion: PUZZLE_LAYOUT_VERSION }
      : { id, x: 0, y: 0, zone: "mat" as const, locked: false, layoutVersion: PUZZLE_LAYOUT_VERSION };
  });
}

function normalizePieces(room: Room) {
  const count = room.rows * room.cols;
  const byId = new Map<number, Piece>();
  for (const piece of Array.isArray(room.pieces) ? room.pieces : []) {
    if (Number.isSafeInteger(piece?.id) && piece.id >= 0 && piece.id < count && !byId.has(piece.id)) byId.set(piece.id, piece);
  }
  const completeSet = Array.from({ length: count }, (_, id) => byId.get(id) ?? {
    id,
    x: 0,
    y: 0,
    zone: "mat" as const,
    locked: false,
    layoutVersion: PUZZLE_LAYOUT_VERSION,
  });
  return normalizePieceLayout(completeSet, room.rows, room.cols, room.code);
}

function edgeProfile(seed: string, row: number, col: number, axis: "h" | "v") {
  let hash = 2166136261;
  const value = `${seed}:${axis}:${row}:${col}`;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const unsigned = hash >>> 0;
  return {
    sign: unsigned % 2 === 0 ? 1 : -1,
    center: 0.42 + ((unsigned >>> 3) % 17) / 100,
    spread: 0.18 + ((unsigned >>> 8) % 6) / 100,
    neck: 0.095 + ((unsigned >>> 12) % 4) / 100,
    crown: 0.23 + ((unsigned >>> 16) % 7) / 100,
    depth: 0.8 + ((unsigned >>> 20) % 26) / 100,
  };
}

type JigsawPathWriter = Pick<Path2D, "moveTo" | "lineTo" | "bezierCurveTo" | "closePath">;

function traceJigsawPiecePath(
  path: JigsawPathWriter,
  id: number,
  rows: number,
  cols: number,
  seed: string,
  x0: number,
  y0: number,
  cellWidth: number,
  cellHeight: number,
) {
  const row = Math.floor(id / cols);
  const col = id % cols;
  const tab = Math.min(cellWidth, cellHeight) * 0.28;
  const flat = { sign: 0, center: 0.5, spread: 0.18, neck: 0.1, crown: 0.26, depth: 1 };
  const topBoundary = row === 0 ? flat : edgeProfile(seed, row - 1, col, "h");
  const rightBoundary = col === cols - 1 ? flat : edgeProfile(seed, row, col, "v");
  const bottomBoundary = row === rows - 1 ? flat : edgeProfile(seed, row, col, "h");
  const leftBoundary = col === 0 ? flat : edgeProfile(seed, row, col - 1, "v");
  const top = { ...topBoundary, sign: -topBoundary.sign };
  const left = { ...leftBoundary, sign: -leftBoundary.sign };
  const x1 = x0 + cellWidth;
  const y1 = y0 + cellHeight;

  const addEdge = (
    startX: number, startY: number, endX: number, endY: number,
    normalX: number, normalY: number,
    edge: { sign: number; center: number; spread: number; neck: number; crown: number; depth: number },
  ) => {
    if (!edge.sign) {
      path.lineTo(endX, endY);
      return;
    }
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const point = (along: number, normal: number) => ({
      x: startX + deltaX * along + normalX * normal,
      y: startY + deltaY * along + normalY * normal,
    });
    const depth = tab * edge.depth * edge.sign;
    path.lineTo(point(edge.center - edge.spread, 0).x, point(edge.center - edge.spread, 0).y);
    path.bezierCurveTo(
      point(edge.center - edge.spread + 0.035, 0).x, point(edge.center - edge.spread + 0.035, 0).y,
      point(edge.center - edge.neck + 0.025, depth * 0.04).x, point(edge.center - edge.neck + 0.025, depth * 0.04).y,
      point(edge.center - edge.neck, depth * 0.18).x, point(edge.center - edge.neck, depth * 0.18).y,
    );
    path.bezierCurveTo(
      point(edge.center - edge.neck - 0.1, depth * 0.42).x, point(edge.center - edge.neck - 0.1, depth * 0.42).y,
      point(edge.center - edge.crown * 0.6, depth * 0.96).x, point(edge.center - edge.crown * 0.6, depth * 0.96).y,
      point(edge.center, depth).x, point(edge.center, depth).y,
    );
    path.bezierCurveTo(
      point(edge.center + edge.crown * 0.6, depth * 0.96).x, point(edge.center + edge.crown * 0.6, depth * 0.96).y,
      point(edge.center + edge.neck + 0.1, depth * 0.42).x, point(edge.center + edge.neck + 0.1, depth * 0.42).y,
      point(edge.center + edge.neck, depth * 0.18).x, point(edge.center + edge.neck, depth * 0.18).y,
    );
    path.bezierCurveTo(
      point(edge.center + edge.neck - 0.025, depth * 0.04).x, point(edge.center + edge.neck - 0.025, depth * 0.04).y,
      point(edge.center + edge.spread - 0.035, 0).x, point(edge.center + edge.spread - 0.035, 0).y,
      point(edge.center + edge.spread, 0).x, point(edge.center + edge.spread, 0).y,
    );
    path.lineTo(endX, endY);
  };

  path.moveTo(x0, y0);
  addEdge(x0, y0, x1, y0, 0, -1, top);
  addEdge(x1, y0, x1, y1, 1, 0, rightBoundary);
  addEdge(x1, y1, x0, y1, 0, 1, { ...bottomBoundary, center: 1 - bottomBoundary.center });
  addEdge(x0, y1, x0, y0, -1, 0, { ...left, center: 1 - left.center });
  path.closePath();
}

const JigsawPiece = memo(function JigsawPiece({ id, rows, cols, seed, imageUrl, eager = false }: { id: number; rows: number; cols: number; seed: string; imageUrl: string; eager?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(eager);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    return observePuzzlePiece(canvas, setVisible);
  }, []);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageUrl) return;
    if (!visible) {
      canvas.width = 1;
      canvas.height = 1;
      return;
    }
    const canvasKey = puzzlePieceCanvasKey(id, rows, cols, seed, imageUrl);
    const preserveCanvas = () => rememberPuzzlePieceCanvas(canvasKey, canvas);
    if (restorePuzzlePieceCanvas(canvasKey, canvas)) return preserveCanvas;
    let cancelled = false;
    let drawTimer: number | undefined;
    void loadPuzzleImage(imageUrl).then((image) => {
      const drawPiece = () => {
        if (cancelled) return;
        const row = Math.floor(id / cols);
        const col = id % cols;
        const imageRatio = image.naturalWidth / image.naturalHeight || DEFAULT_IMAGE_ASPECT;
        const boardWidth = imageRatio >= 1 ? 800 : 800 * imageRatio;
        const boardHeight = boardWidth / imageRatio;
        const cellWidth = boardWidth / cols;
        const cellHeight = boardHeight / rows;
        const padX = cellWidth * 0.34;
        const padY = cellHeight * 0.34;
        const width = cellWidth + padX * 2;
        const height = cellHeight + padY * 2;
        const scale = rows * cols > 120 ? 1 : 2;
        canvas.width = Math.ceil(width * scale);
        canvas.height = Math.ceil(height * scale);
        const context = canvas.getContext("2d");
        if (!context) return;
        context.scale(scale, scale);

        context.beginPath();
        traceJigsawPiecePath(context, id, rows, cols, seed, padX, padY, cellWidth, cellHeight);
        context.save();
        context.clip();
        context.drawImage(image, padX - col * cellWidth, padY - row * cellHeight, boardWidth, boardHeight);
        context.restore();
        context.lineJoin = "round";
        context.lineCap = "round";
        const edgeScale = rows * cols <= 20 ? 1 : Math.max(0.18, Math.sqrt(20 / (rows * cols)));
        context.strokeStyle = "rgba(21,21,21,.92)";
        context.lineWidth = 3 * edgeScale;
        context.stroke();
        context.strokeStyle = "rgba(255,255,255,.46)";
        context.lineWidth = 0.9 * edgeScale;
        context.stroke();
      };
      if (eager) drawPiece();
      else drawTimer = window.setTimeout(drawPiece, (id % 64) * 4);
    }).catch(() => { /* The next image URL change retries the render. */ });
    return () => {
      cancelled = true;
      if (drawTimer !== undefined) window.clearTimeout(drawTimer);
      preserveCanvas();
    };
  }, [id, rows, cols, seed, imageUrl, visible, eager]);

  return <canvas ref={canvasRef} className="piece-canvas" aria-hidden="true" />;
});

const LockedPiecesCanvas = memo(function LockedPiecesCanvas({
  lockedIds,
  lockedIdsKey,
  rows,
  cols,
  seed,
  imageUrl,
}: {
  lockedIds: number[];
  lockedIdsKey: string;
  rows: number;
  cols: number;
  seed: string;
  imageUrl: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawnIdsRef = useRef(new Set<number>());
  const geometryKeyRef = useRef("");
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    const board = canvas?.parentElement;
    if (!board || typeof ResizeObserver === "undefined") return;
    const updateSize = () => {
      const width = board.clientWidth;
      const height = board.clientHeight;
      if (width <= 0 || height <= 0) return;
      setSize((current) => Math.abs(current.width - width) < 0.5 && Math.abs(current.height - height) < 0.5
        ? current
        : { width, height });
    };
    const observer = new ResizeObserver(updateSize);
    observer.observe(board);
    updateSize();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageUrl || size.width <= 0 || size.height <= 0) return;
    let cancelled = false;
    void loadPuzzleImage(imageUrl).then((image) => {
      if (cancelled) return;
      const renderScale = Math.max(0.25, Math.min(window.devicePixelRatio || 1, 2048 / Math.max(size.width, size.height)));
      const pixelWidth = Math.max(1, Math.round(size.width * renderScale));
      const pixelHeight = Math.max(1, Math.round(size.height * renderScale));
      const geometryKey = `${imageUrl}:${rows}:${cols}:${seed}:${pixelWidth}:${pixelHeight}`;
      const context = canvas.getContext("2d");
      if (!context) return;

      const nextIds = new Set(lockedIds);
      const canAppend = geometryKeyRef.current === geometryKey
        && canvas.width === pixelWidth
        && canvas.height === pixelHeight
        && Array.from(drawnIdsRef.current).every((id) => nextIds.has(id));
      if (!canAppend) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
        context.setTransform(renderScale, 0, 0, renderScale, 0, 0);
        context.clearRect(0, 0, size.width, size.height);
        drawnIdsRef.current.clear();
        geometryKeyRef.current = geometryKey;
      } else {
        context.setTransform(renderScale, 0, 0, renderScale, 0, 0);
      }

      const cellWidth = size.width / cols;
      const cellHeight = size.height / rows;
      const sourceRatio = image.naturalWidth / image.naturalHeight || DEFAULT_IMAGE_ASPECT;
      const sourceBoardWidth = sourceRatio >= 1 ? 800 : 800 * sourceRatio;
      const edgeScale = rows * cols <= 20 ? 1 : Math.max(0.18, Math.sqrt(20 / (rows * cols)));
      const displayScale = size.width / sourceBoardWidth;
      context.lineJoin = "round";
      context.lineCap = "round";

      for (const id of lockedIds) {
        if (drawnIdsRef.current.has(id)) continue;
        const row = Math.floor(id / cols);
        const col = id % cols;
        const path = new Path2D();
        traceJigsawPiecePath(path, id, rows, cols, seed, col * cellWidth, row * cellHeight, cellWidth, cellHeight);
        const destinationX = Math.max(0, (col - 0.34) * cellWidth);
        const destinationY = Math.max(0, (row - 0.34) * cellHeight);
        const destinationRight = Math.min(size.width, (col + 1.34) * cellWidth);
        const destinationBottom = Math.min(size.height, (row + 1.34) * cellHeight);
        const destinationWidth = destinationRight - destinationX;
        const destinationHeight = destinationBottom - destinationY;
        const sourceX = destinationX * image.naturalWidth / size.width;
        const sourceY = destinationY * image.naturalHeight / size.height;
        const sourceWidth = destinationWidth * image.naturalWidth / size.width;
        const sourceHeight = destinationHeight * image.naturalHeight / size.height;
        context.save();
        context.clip(path);
        context.drawImage(
          image,
          sourceX,
          sourceY,
          sourceWidth,
          sourceHeight,
          destinationX,
          destinationY,
          destinationWidth,
          destinationHeight,
        );
        context.restore();
        context.strokeStyle = "rgba(21,21,21,.92)";
        context.lineWidth = 3 * edgeScale * displayScale;
        context.stroke(path);
        context.strokeStyle = "rgba(255,255,255,.46)";
        context.lineWidth = 0.9 * edgeScale * displayScale;
        context.stroke(path);
        drawnIdsRef.current.add(id);
      }
    }).catch(() => { /* The next image URL change retries the render. */ });
    return () => { cancelled = true; };
  }, [lockedIds, lockedIdsKey, rows, cols, seed, imageUrl, size]);

  return (
    <canvas
      ref={canvasRef}
      className="locked-pieces-canvas"
      role="img"
      aria-label={`${lockedIds.length} puzzle parçası doğru yerine yerleştirildi`}
    />
  );
}, (previous, next) => previous.lockedIdsKey === next.lockedIdsKey
  && previous.rows === next.rows
  && previous.cols === next.cols
  && previous.seed === next.seed
  && previous.imageUrl === next.imageUrl);

const InteractivePuzzlePiece = memo(function InteractivePuzzlePiece({
  piece,
  zone,
  rows,
  cols,
  seed,
  imageUrl,
  pieceCount,
  isRecent,
  isKeyboardPiece,
  isRemoteHeld,
  sidePosition,
  bandPosition,
  onStart,
  onLostCapture,
  onFocusPiece,
  onPlacePiece,
}: {
  piece: Piece;
  zone: PieceZone;
  rows: number;
  cols: number;
  seed: string;
  imageUrl: string;
  pieceCount: number;
  isRecent: boolean;
  isKeyboardPiece: boolean;
  isRemoteHeld: boolean;
  sidePosition?: PieceRailPosition;
  bandPosition?: PieceRailPosition;
  onStart: (event: PointerEvent<HTMLDivElement>, piece: Piece) => void;
  onLostCapture: (pieceId: number) => void;
  onFocusPiece: (pieceId: number) => void;
  onPlacePiece: (pieceId: number) => void;
}) {
  const isBoardPiece = zone === "board";
  const style = isBoardPiece
    ? { width: `${100 / cols}%`, height: `${100 / rows}%`, left: `${piece.x * 100}%`, top: `${piece.y * 100}%` }
    : {
      "--side-piece-width": `${BOARD.width * 100 / cols}%`,
      "--side-piece-height": `${BOARD.height * 100 / rows}%`,
      "--side-piece-x": `${(sidePosition?.x ?? 0) * 100}%`,
      "--side-piece-y": `${(sidePosition?.y ?? 0) * 100}%`,
      "--band-piece-width": `${MOBILE_HORIZONTAL_BOARD.width * 100 / cols}%`,
      "--band-piece-height": `${MOBILE_HORIZONTAL_BOARD.height * 100 / rows}%`,
      "--band-piece-x": `${(bandPosition?.x ?? 0) * 100}%`,
      "--band-piece-y": `${(bandPosition?.y ?? 0) * 100}%`,
    } as CSSProperties;
  const densityClass = pieceCount > 120 ? "dense-piece" : pieceCount > 20 ? "compact-piece" : "";
  return (
    <div
      className={`puzzle-piece ${isBoardPiece ? "board-piece" : "side-piece"} ${piece.locked ? "locked" : ""} ${isRecent ? "recent" : ""} ${isRemoteHeld ? "remote-held" : ""} ${densityClass}`}
      style={style}
      onPointerDown={(event) => onStart(event, piece)}
      onLostPointerCapture={() => onLostCapture(piece.id)}
      onFocus={() => onFocusPiece(piece.id)}
      onKeyDown={(event) => {
        if (!piece.locked && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onPlacePiece(piece.id);
        }
      }}
      role="button"
      tabIndex={!piece.locked && isKeyboardPiece ? 0 : -1}
      aria-disabled={isBoardPiece ? piece.locked : undefined}
      aria-label={`${piece.id + 1}. puzzle parçası${piece.locked ? ", yerleştirildi" : ". Enter ile doğru yerine yerleştir"}`}
    >
      <JigsawPiece id={piece.id} rows={rows} cols={cols} seed={seed} imageUrl={imageUrl} eager={isRecent || isRemoteHeld} />
    </div>
  );
});

function positionRemotePuzzlePiece(element: HTMLDivElement, drag: RemoteDrag, rows: number, cols: number, animate: boolean) {
  const board = element.parentElement;
  if (!board || board.clientWidth <= 0 || board.clientHeight <= 0) return;
  const x = (drag.x - 1 / (2 * cols)) * board.clientWidth;
  const y = (drag.y - 1 / (2 * rows)) * board.clientHeight;
  element.style.transition = animate
    ? drag.phase === "end"
      ? `transform ${REMOTE_SETTLE_TRANSITION_MS}ms cubic-bezier(.2,.8,.2,1), filter 120ms ease, opacity 120ms ease`
      : `transform ${REMOTE_MOVE_TRANSITION_MS}ms linear, filter 120ms ease, opacity 120ms ease`
    : "none";
  element.style.transform = `translate3d(${x}px,${y}px,0)`;
}

const RemotePuzzlePiece = memo(function RemotePuzzlePiece({
  drag,
  rows,
  cols,
  seed,
  imageUrl,
  pieceCount,
}: {
  drag: RemoteDrag;
  rows: number;
  cols: number;
  seed: string;
  imageUrl: string;
  pieceCount: number;
}) {
  const elementRef = useRef<HTMLDivElement>(null);
  const latestDragRef = useRef(drag);
  const positionedRef = useRef(false);
  const densityClass = pieceCount > 120 ? "dense-piece" : pieceCount > 20 ? "compact-piece" : "";

  useLayoutEffect(() => {
    latestDragRef.current = drag;
    const element = elementRef.current;
    if (!element) return;
    positionRemotePuzzlePiece(element, drag, rows, cols, positionedRef.current);
    positionedRef.current = true;
  }, [drag, rows, cols]);

  useEffect(() => {
    const element = elementRef.current;
    const board = element?.parentElement;
    if (!element || !board || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => positionRemotePuzzlePiece(element, latestDragRef.current, rows, cols, false));
    observer.observe(board);
    return () => observer.disconnect();
  }, [rows, cols]);

  return (
    <div
      ref={elementRef}
      className={`puzzle-piece remote-drag-piece ${drag.phase === "end" ? "remote-drop-handoff" : ""} ${densityClass}`}
      style={{
        width: `${100 / cols}%`,
        height: `${100 / rows}%`,
        left: 0,
        top: 0,
      }}
      aria-hidden="true"
    >
      <JigsawPiece id={drag.pieceId} rows={rows} cols={cols} seed={seed} imageUrl={imageUrl} eager />
    </div>
  );
});

function formatCode(value: string) {
  return value.toUpperCase().replace(/[^ABCDEFGHJKLMNPQRSTUVWXYZ23456789]/g, "").slice(0, 6);
}

async function readApiPayload<T>(response: Response): Promise<ApiPayload<T>> {
  const body = await response.text();
  if (!body.trim()) {
    if (response.status === 413) {
      throw new Error("Fotoğraf sunucunun yükleme sınırını aşıyor. Daha küçük bir görsel dene.");
    }
    throw new Error(response.ok
      ? "Sunucudan boş yanıt geldi. Lütfen tekrar dene."
      : `İstek tamamlanamadı (${response.status || "bağlantı hatası"}).`);
  }
  try {
    return JSON.parse(body) as ApiPayload<T>;
  } catch {
    throw new Error(response.ok
      ? "Sunucudan geçersiz bir yanıt geldi. Lütfen tekrar dene."
      : `İstek tamamlanamadı (${response.status}).`);
  }
}

function isSupportedImageType(type: string) {
  return /^image\/(jpeg|jpg|png|webp)$/i.test(type);
}

async function validateImageBeforeDecode(file: File) {
  const [buffer, validation] = await Promise.all([
    file.arrayBuffer(),
    import("@/lib/puzzle-validation"),
  ]);
  const validated = validation.validateImageBytes(new Uint8Array(buffer), file.type);
  if (!validated) {
    throw new Error("Fotoğraf okunamadı veya sınırları aşıyor. JPG, PNG ya da WebP biçiminde, en fazla 24 megapiksel bir görsel seç.");
  }
  return validated;
}

async function prepareUploadImage(file: File) {
  if (!isSupportedImageType(file.type)) {
    throw new Error("Yalnızca JPG, PNG veya WebP fotoğrafları kullanılabilir.");
  }
  let bitmap: ImageBitmap | null = null;
  let image: HTMLImageElement | null = null;
  let objectUrl = "";
  try {
    await validateImageBeforeDecode(file);
    if (typeof createImageBitmap === "function") {
      try {
        bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      } catch { /* HTMLImageElement remains the compatibility fallback. */ }
    }
    if (!bitmap) {
      objectUrl = URL.createObjectURL(file);
      image = await loadPuzzleImage(objectUrl);
    }
    const width = bitmap?.width ?? image?.naturalWidth ?? 0;
    const height = bitmap?.height ?? image?.naturalHeight ?? 0;
    const aspect = width / height || DEFAULT_IMAGE_ASPECT;
    if (width <= 0 || height <= 0 || width > 12_000 || height > 12_000 || width * height > 24_000_000) {
      throw new Error("Fotoğrafın çözünürlüğü çok yüksek. En fazla 24 megapiksel bir görsel seç.");
    }
    if (aspect < 0.2 || aspect > 5) {
      throw new Error("Fotoğraf aşırı dar veya geniş. Dikey 9:16 dâhil, 1:5 ile 5:1 arası bir oran kullan.");
    }
    const maxDimension = 2400;
    const maxBytes = 2.8 * 1024 * 1024;
    if (file.size <= maxBytes && Math.max(width, height) <= maxDimension) return { file, aspect };
    const scale = Math.min(1, maxDimension / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) return { file, aspect };
    context.fillStyle = "#fffdf7";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap ?? image!, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.84));
    if (!blob || blob.size >= file.size) return { file, aspect };
    return {
      file: new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg", lastModified: Date.now() }),
      aspect,
    };
  } finally {
    bitmap?.close();
    if (objectUrl) {
      puzzleImageCache.delete(objectUrl);
      URL.revokeObjectURL(objectUrl);
    }
  }
}

function avatarColor(index: number) {
  return ["#d3d3ff", "#ff6f61", "#4864ff", "#ffd84d"][index % 4];
}

function hasSameRoomPlayers(current: RoomPlayer[], next: RoomPlayer[]) {
  if (current.length !== next.length) return false;
  const currentById = new Map(current.map((player) => [player.clientId, player.nickname]));
  return next.every((player) => currentById.get(player.clientId) === player.nickname);
}

function getStoredRoomCode() {
  if (typeof window === "undefined") return "";
  try {
    return window.sessionStorage.getItem(ROOM_STORAGE_KEY)?.trim().toUpperCase() || "";
  } catch {
    return "";
  }
}

function storeRoomCode(code: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (code) window.sessionStorage.setItem(ROOM_STORAGE_KEY, code);
    else window.sessionStorage.removeItem(ROOM_STORAGE_KEY);
  } catch { /* Storage can be unavailable in private browsing contexts. */ }
}

export default function Home() {
  const [room, setRoom] = useState<Room | null>(null);
  const [pieces, setPieces] = useState<Piece[]>(() => scatteredPieces(DEFAULT_ROWS, DEFAULT_COLS));
  const [imageUrl, setImageUrl] = useState("");
  const [imageAspect, setImageAspect] = useState(DEFAULT_IMAGE_ASPECT);
  const [pendingImageAspect, setPendingImageAspect] = useState<number | null>(null);
  const [selectedGalleryId, setSelectedGalleryId] = useState<string | null>(null);
  const [galleryItems, setGalleryItems] = useState<GalleryItem[]>([]);
  const [galleryLoading, setGalleryLoading] = useState(true);
  const [previewSeed, setPreviewSeed] = useState("PREVIEW");
  const [codeInput, setCodeInput] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploadPreviewUrl, setUploadPreviewUrl] = useState("");
  const [title, setTitle] = useState("Hafta sonu buluşması");
  const [difficulty, setDifficulty] = useState("12");
  const [dialog, setDialog] = useState<"create" | "join" | "nickname" | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [pendingGalleryItem, setPendingGalleryItem] = useState<GalleryItem | null>(null);
  const [introCompletion, setIntroCompletion] = useState<"idle" | "showing" | "gallery">("idle");
  const [previewReplay, setPreviewReplay] = useState(false);
  const [notice, setNotice] = useState("Yeni bir oda kurabilir ya da arkadaşlarının kodunu girebilirsin.");
  const [busy, setBusy] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [hintVisible, setHintVisible] = useState(false);
  const [lastHeldPieceId, setLastHeldPieceId] = useState<number | null>(null);
  const [playerName, setPlayerName] = useState(() => getStoredNickname() || "Sen");
  const [nicknameInput, setNicknameInput] = useState(() => getStoredNickname());
  const [roomPlayers, setRoomPlayers] = useState<RoomPlayer[]>([]);
  const [remoteDrags, setRemoteDrags] = useState<RemoteDrag[]>([]);
  const clientId = "self";
  const boardAreaRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const piecesRef = useRef(pieces);
  const [boardSize, setBoardSize] = useState({ width: 0, height: 0 });
  const [boardZoom, setBoardZoom] = useState(1);
  const lastLocalMove = useRef(0);
  const remoteUpdatedAt = useRef(0);
  const realtimeConnected = useRef(false);
  const realtimeSubscriptionRef = useRef<RealtimeSubscription | null>(null);
  const realtimeSenderId = useRef("");
  const realtimeSequence = useRef(0);
  const pendingLiveDragRef = useRef<RoomDragMessage | null>(null);
  const remoteDragSequence = useRef(new Map<string, number>());
  const presenceRevoked = useRef(false);
  const hintTimer = useRef<number | null>(null);
  const roomSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const pendingRoomSaves = useRef(0);
  const rafRef = useRef<number | null>(null);
  const dragRef = useRef<LocalDrag | null>(null);

  useEffect(() => {
    piecesRef.current = pieces;
  }, [pieces]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      setRemoteDrags((current) => {
        if (current.length === 0) return current;
        const active = current.filter((drag) => drag.expiresAt > now);
        return active.length === current.length ? current : active;
      });
    }, 250);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      setPreviewSeed(crypto.randomUUID());
      void createDefaultImage().then((url) => {
        if (cancelled) return;
        setImageUrl(url);
      });
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, []);
  useEffect(() => {
    if (!imageUrl) return;
    let cancelled = false;
    void loadPuzzleImage(imageUrl).then((image) => {
      if (!cancelled && image.naturalWidth > 0 && image.naturalHeight > 0) {
        setImageAspect(image.naturalWidth / image.naturalHeight);
      }
    }).catch(() => { /* The file validation flow reports unreadable images. */ });
    return () => { cancelled = true; };
  }, [imageUrl]);
  useEffect(() => {
    const area = boardAreaRef.current;
    if (!area || typeof ResizeObserver === "undefined") return;
    const updateSize = () => {
      const rect = area.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const width = Math.min(rect.width, rect.height * imageAspect);
      const height = width / imageAspect;
      setBoardSize((current) => Math.abs(current.width - width) < 0.5 && Math.abs(current.height - height) < 0.5
        ? current
        : { width, height });
    };
    const observer = new ResizeObserver(updateSize);
    observer.observe(area);
    updateSize();
    return () => observer.disconnect();
  }, [imageAspect, galleryOpen, introCompletion, room?.code]);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setBoardZoom(1));
    return () => window.cancelAnimationFrame(frame);
  }, [room?.code, imageAspect]);
  useEffect(() => {
    return () => {
      if (uploadPreviewUrl) {
        puzzleImageCache.delete(uploadPreviewUrl);
        URL.revokeObjectURL(uploadPreviewUrl);
      }
    };
  }, [uploadPreviewUrl]);
  useEffect(() => {
    if (room || (!galleryOpen && introCompletion !== "gallery") || galleryItems.length > 0) return;
    let cancelled = false;
    void Promise.all([
      fetch("/api/gallery").then(async (response) => {
        if (!response.ok) throw new Error("Gallery request failed");
        return await response.json() as { puzzles?: Array<GalleryItem & { kind?: GalleryKind; imageUrl?: string }>; setupRequired?: boolean };
      }),
      import("@/lib/gallery-images-client"),
    ]).then(async ([payload, galleryImages]) => {
      if (cancelled) return;
      if (payload.setupRequired) {
        const fallbackItems = await galleryImages.createFallbackGalleryItems();
        if (!cancelled) setGalleryItems(fallbackItems);
        return;
      }
      const items = (payload.puzzles || []).map((item) => ({
        id: item.id,
        title: item.title,
        description: item.description,
        imageUrl: item.imageUrl || "",
        rows: item.rows,
        cols: item.cols,
        count: item.count || item.rows * item.cols,
        accent: item.accent,
        kind: item.kind || "custom",
      } satisfies GalleryItem));
      const hydratedItems = await galleryImages.hydrateGalleryImages(items);
      if (!cancelled) setGalleryItems(hydratedItems);
    }).catch(async () => {
      if (cancelled) return;
      const galleryImages = await import("@/lib/gallery-images-client");
      const fallbackItems = await galleryImages.createFallbackGalleryItems();
      if (!cancelled) setGalleryItems(fallbackItems);
    }).finally(() => { if (!cancelled) setGalleryLoading(false); });
    return () => { cancelled = true; };
  }, [room, galleryOpen, introCompletion, galleryItems.length]);
  useEffect(() => {
    const storedCode = getStoredRoomCode();
    if (!storedCode) return;
    let cancelled = false;
    void fetch(`/api/room?code=${encodeURIComponent(storedCode)}`, { cache: "no-store" }).then(async (response) => {
      const data = await readApiPayload<{ room?: Room }>(response);
      if (!response.ok || !data.room) {
        if (response.status === 404) storeRoomCode(null);
        throw new Error(data.error || "Oda yeniden yüklenemedi.");
      }
      if (cancelled) return;
      remoteUpdatedAt.current = data.room.updatedAt;
      const nextRoom = { ...data.room, pieces: normalizePieces(data.room) };
      setRoom(nextRoom);
      setPieces(nextRoom.pieces);
      setRoomPlayers([]);
      setImageUrl(data.room.imageUrl);
      setGalleryOpen(false);
      setIntroCompletion("idle");
      setNotice(`${data.room.code} odasına yeniden bağlandın.`);
    }).catch((error) => {
      if (!cancelled) setNotice(error instanceof Error ? error.message : "Oda yeniden yüklenemedi.");
    });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    const sendHeartbeat = async () => {
      if (presenceRevoked.current || document.hidden) return;
      try {
        const response = await fetch("/api/presence", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roomCode: room?.code ?? null, nickname: playerName }),
        });
        if (response.status === 410) {
          presenceRevoked.current = true;
          setNotice("Bu oturum admin tarafından kapatıldı.");
        }
      } catch { /* Presence is optional until the Supabase migration is run. */ }
    };
    void sendHeartbeat();
    const timer = window.setInterval(sendHeartbeat, 20_000);
    const heartbeatWhenVisible = () => { if (!document.hidden) void sendHeartbeat(); };
    const leave = () => {
      if (presenceRevoked.current) return;
      const body = JSON.stringify({ leave: true });
      const beacon = new Blob([body], { type: "application/json" });
      if (!navigator.sendBeacon("/api/presence", beacon)) {
        void fetch("/api/presence", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", heartbeatWhenVisible);
    window.addEventListener("pagehide", leave);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", heartbeatWhenVisible);
      window.removeEventListener("pagehide", leave);
    };
  }, [playerName, room?.code]);
  useEffect(() => {
    const roomCode = room?.code;
    if (!roomCode) {
      return;
    }
    let cancelled = false;
    const loadPlayers = async () => {
      if (document.hidden) return;
      try {
        const response = await fetch(`/api/presence?roomCode=${encodeURIComponent(roomCode)}`, { cache: "no-store" });
        const data = await readApiPayload<{ players?: RoomPlayer[] }>(response);
        if (response.ok && !cancelled) {
          const nextPlayers = data.players || [];
          setRoomPlayers((current) => hasSameRoomPlayers(current, nextPlayers) ? current : nextPlayers);
        }
      } catch { /* The local player card remains visible during brief outages. */ }
    };
    void loadPlayers();
    const timer = window.setInterval(loadPlayers, 10_000);
    const refreshWhenVisible = () => { if (!document.hidden) void loadPlayers(); };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [room?.code]);
  useEffect(() => () => {
    if (hintTimer.current) window.clearTimeout(hintTimer.current);
    if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
    if (dragRef.current) {
      dragRef.current.element.classList.remove("dragging");
      dragRef.current.element.setAttribute("style", dragRef.current.originalStyle);
      boardAreaRef.current?.classList.remove("drag-active");
      dragRef.current = null;
    }
  }, []);

  useEffect(() => {
    const roomCode = room?.code;
    const roomRows = room?.rows;
    const roomCols = room?.cols;
    if (!roomCode || !roomRows || !roomCols) return;
    let cancelled = false;
    let refreshInFlight = false;
    let lastRefreshAt = 0;
    let subscription: RealtimeSubscription | null = null;
    const dragSequences = remoteDragSequence.current;
    realtimeConnected.current = false;
    realtimeSubscriptionRef.current = null;
    pendingLiveDragRef.current = null;
    dragSequences.clear();
    if (!realtimeSenderId.current) realtimeSenderId.current = crypto.randomUUID();

    const refreshAuthoritativeRoom = async () => {
      const now = Date.now();
      if (cancelled || document.hidden || refreshInFlight || dragRef.current || pendingRoomSaves.current > 0 || now - lastRefreshAt < 750) return;
      refreshInFlight = true;
      lastRefreshAt = now;
      try {
        const response = await fetch(`/api/room?code=${encodeURIComponent(roomCode)}&since=${remoteUpdatedAt.current}`, { cache: "no-store" });
        if (response.status === 204 || !response.ok) return;
        const data = await readApiPayload<{ room?: Room }>(response);
        if (!data.room || data.room.code !== roomCode || data.room.rows !== roomRows || data.room.cols !== roomCols || data.room.updatedAt <= remoteUpdatedAt.current) return;
        const nextRoom = { ...data.room, pieces: normalizePieces(data.room) };
        remoteUpdatedAt.current = data.room.updatedAt;
        setRoom(nextRoom);
        setPieces(nextRoom.pieces);
      } catch { /* Polling retries authoritative state after transient failures. */ }
      finally { refreshInFlight = false; }
    };

    // Persistent changes remain REST-authoritative. Public drag broadcasts are
    // validated, short-lived visual ghosts and never mutate pieces or clocks.
    const applyRealtimeUpdate = () => { void refreshAuthoritativeRoom(); };
    const applyRemoteDrag = (message: RoomDragMessage) => {
      if (message.senderId === realtimeSenderId.current || message.pieceId >= roomRows * roomCols) return;
      const lastSequence = dragSequences.get(message.senderId) ?? -1;
      if (message.seq <= lastSequence) return;
      dragSequences.delete(message.senderId);
      dragSequences.set(message.senderId, message.seq);
      if (dragSequences.size > 64) {
        const oldestSender = dragSequences.keys().next().value;
        if (typeof oldestSender === "string") dragSequences.delete(oldestSender);
      }
      if (message.phase === "end") {
        const expiresAt = Date.now() + REMOTE_DROP_HANDOFF_MS;
        setRemoteDrags((current) => current.map((drag) => drag.senderId === message.senderId && drag.gestureId === message.gestureId
          ? { ...message, expiresAt }
          : drag));
        return;
      }
      const piece = piecesRef.current.find((candidate) => candidate.id === message.pieceId);
      if (!piece || piece.locked || dragRef.current?.id === message.pieceId) return;
      const nextDrag: RemoteDrag = { ...message, expiresAt: Date.now() + REMOTE_DRAG_TTL_MS };
      setRemoteDrags((current) => {
        const active = current.filter((drag) => drag.senderId !== message.senderId && drag.expiresAt > Date.now());
        return [...active, nextDrag].slice(-MAX_REMOTE_DRAGS);
      });
    };

    void fetch("/api/realtime").then(async (response) => {
      if (!response.ok) return null;
      return await response.json() as { enabled?: boolean; url?: string; key?: string };
    }).then(async (config) => {
      if (cancelled || !config?.enabled || !config.url || !config.key) return;
      const { subscribeToRoomRealtime } = await import("@/lib/realtime-client");
      if (cancelled) return;
      subscription = subscribeToRoomRealtime(
        { url: config.url, key: config.key },
        roomCode,
        applyRealtimeUpdate,
        (status) => {
          realtimeConnected.current = status === "connected";
          if (status === "connected") {
            const pending = pendingLiveDragRef.current;
            if (pending && subscription?.sendDrag(pending)) pendingLiveDragRef.current = null;
          }
          if (status === "disconnected") setRemoteDrags([]);
        },
        applyRemoteDrag,
      );
      realtimeSubscriptionRef.current = subscription;
    }).catch(() => {
      // The since-polling fallback keeps rooms usable before Realtime is configured.
    });

    return () => {
      cancelled = true;
      realtimeConnected.current = false;
      subscription?.unsubscribe();
      if (realtimeSubscriptionRef.current === subscription) realtimeSubscriptionRef.current = null;
      pendingLiveDragRef.current = null;
      dragSequences.clear();
      setRemoteDrags([]);
    };
  }, [room?.code, room?.rows, room?.cols]);

  const localSize = useMemo(() => PUZZLE_SIZES.find((option) => String(option.count) === difficulty) ?? PUZZLE_SIZES[0], [difficulty]);
  const selectedPuzzleSize = useMemo(() => fitPuzzleSize(localSize, pendingImageAspect ?? imageAspect), [localSize, pendingImageAspect, imageAspect]);
  const rows = room?.rows ?? DEFAULT_ROWS;
  const cols = room?.cols ?? DEFAULT_COLS;
  const pieceCount = rows * cols;
  const puzzleSeed = room?.code ?? previewSeed;
  useEffect(() => () => clearPuzzlePieceCanvasCache(), [imageUrl, rows, cols, puzzleSeed]);
  const solvedCount = useMemo(() => pieces.filter((piece) => piece.locked).length, [pieces]);
  const remainingCount = pieceCount - solvedCount;
  const progress = Math.round((solvedCount / pieceCount) * 100);
  const galleryVisible = !room && (galleryOpen || introCompletion === "gallery");
  const sideWorkspaceAspect = imageAspect * BOARD.height / BOARD.width;
  const bandWorkspaceAspect = imageAspect * MOBILE_HORIZONTAL_BOARD.height / MOBILE_HORIZONTAL_BOARD.width;
  const workspaceStyle = {
    "--side-workspace-aspect": sideWorkspaceAspect,
    "--band-workspace-aspect": bandWorkspaceAspect,
  } as CSSProperties;
  const boardStyle = boardSize.width > 0
    ? { width: `${boardSize.width * boardZoom}px`, height: `${boardSize.height * boardZoom}px` }
    : { width: "100%", aspectRatio: imageAspect, maxHeight: "100%" };
  const hintPiece = useMemo(() => pieces.find((piece) => piece.id === lastHeldPieceId && !piece.locked)
    ?? pieces.find((piece) => !piece.locked), [lastHeldPieceId, pieces]);
  const keyboardPieceId = pieces.find((piece) => piece.id === lastHeldPieceId && !piece.locked)?.id
    ?? pieces.find((piece) => !piece.locked)?.id
    ?? -1;
  const remoteHeldIds = useMemo(() => new Set(remoteDrags.map((drag) => drag.pieceId)), [remoteDrags]);
  const boardPieces = useMemo(() => pieces.filter((piece) => piece.zone === "board" || piece.locked), [pieces]);
  const interactiveBoardPieces = useMemo(() => pieceCount > 120
    ? boardPieces.filter((piece) => !piece.locked)
    : boardPieces, [boardPieces, pieceCount]);
  const lockedIds = useMemo(() => pieces.filter((piece) => piece.locked).map((piece) => piece.id), [pieces]);
  const lockedIdsKey = useMemo(() => lockedIds.join(","), [lockedIds]);
  const sideLayout = useMemo(() => sidePiecePositions(rows, cols, puzzleSeed), [rows, cols, puzzleSeed]);
  const bandLayout = useMemo(() => bandPiecePositions(rows, cols, puzzleSeed), [rows, cols, puzzleSeed]);
  const loosePieces = useMemo(() => pieces
    .filter((piece) => !piece.locked && piece.zone !== "board")
    .sort((left, right) => left.id - right.id), [pieces]);
  const visibleLoosePieces = useMemo(() => {
    if (loosePieces.length <= MAX_VISIBLE_LOOSE_PIECES) return loosePieces;
    const visible = loosePieces.slice(0, MAX_VISIBLE_LOOSE_PIECES);
    const keyboardPiece = loosePieces.find((piece) => piece.id === keyboardPieceId);
    return keyboardPiece && !visible.some((piece) => piece.id === keyboardPiece.id)
      ? [...visible, keyboardPiece]
      : visible;
  }, [loosePieces, keyboardPieceId]);
  const commitNickname = () => {
    const name = normalizeNickname(nicknameInput);
    if (!name) {
      setNotice("Odaya girmek için bir nickname yazmalısın.");
      return null;
    }
    try { window.localStorage.setItem(NICKNAME_STORAGE_KEY, name); } catch { /* Keep the name in memory if storage is unavailable. */ }
    setNicknameInput(name);
    setPlayerName(name);
    return name;
  };
  const fallbackPlayer: RoomPlayer = { clientId, nickname: playerName, lastSeenAt: 0 };
  const visibleRoomPlayers = roomPlayers.length === 0
    ? [fallbackPlayer]
    : roomPlayers.some((player) => player.clientId === clientId)
      ? roomPlayers
      : [fallbackPlayer, ...roomPlayers];

  useEffect(() => {
    if (room || introCompletion !== "showing") return;
    const timer = window.setTimeout(() => setIntroCompletion("gallery"), 1150);
    return () => window.clearTimeout(timer);
  }, [room, introCompletion]);

  const pushMove = useCallback(async (nextPieces: Piece[], movedId: number) => {
    if (!room) return;
    const movedPiece = nextPieces.find((piece) => piece.id === movedId);
    if (!movedPiece) return;
    lastLocalMove.current = Date.now();
    pendingRoomSaves.current += 1;
    const save = async () => {
      try {
        const response = await fetch("/api/room", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: room.code, piece: movedPiece }),
        });
        if (!response.ok) throw new Error("Parça kaydedilemedi.");
        const data = await readApiPayload<{ updatedAt?: number }>(response);
        remoteUpdatedAt.current = Math.max(remoteUpdatedAt.current, data.updatedAt ?? 0);
      } catch {
        remoteUpdatedAt.current = 0;
        setNotice("Hamle sunucuya kaydedilemedi; oda durumu yeniden eşitlenecek.");
      } finally {
        pendingRoomSaves.current = Math.max(0, pendingRoomSaves.current - 1);
      }
    };
    roomSaveQueue.current = roomSaveQueue.current.then(save, save);
    await roomSaveQueue.current;
  }, [room]);

  const pushPieces = useCallback(async (nextPieces: Piece[]) => {
    if (!room) return;
    lastLocalMove.current = Date.now();
    pendingRoomSaves.current += 1;
    const save = async () => {
      try {
        const response = await fetch("/api/room", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: room.code, pieces: nextPieces }),
        });
        if (!response.ok) throw new Error("Toplu parça güncellemesi başarısız.");
        const data = await readApiPayload<{ updatedAt?: number }>(response);
        remoteUpdatedAt.current = Math.max(remoteUpdatedAt.current, data.updatedAt ?? 0);
      } catch {
        remoteUpdatedAt.current = 0;
        setNotice("Toplu hamle kaydedilemedi; oda durumu yeniden eşitlenecek.");
      } finally {
        pendingRoomSaves.current = Math.max(0, pendingRoomSaves.current - 1);
      }
    };
    roomSaveQueue.current = roomSaveQueue.current.then(save, save);
    await roomSaveQueue.current;
  }, [room]);

  const forceSyncRoom = async () => {
    if (!room || syncBusy) return;
    setSyncBusy(true);
    setHintVisible(false);
    if (dragRef.current) {
      const drag = dragRef.current;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      drag.element.classList.remove("dragging");
      drag.element.setAttribute("style", drag.originalStyle);
      boardAreaRef.current?.classList.remove("drag-active");
      dragRef.current = null;
    }
    try {
      const response = await fetch(`/api/room?code=${encodeURIComponent(room.code)}`, { cache: "no-store" });
      const data = await readApiPayload<{ room?: Room }>(response);
      if (!response.ok || !data.room) throw new Error(data.error || "Puzzle eşitlenemedi.");
      remoteUpdatedAt.current = data.room.updatedAt;
      lastLocalMove.current = Date.now();
      const nextRoom = { ...data.room, pieces: normalizePieces(data.room) };
      setRoom(nextRoom);
      setPieces(nextRoom.pieces);
      setLastHeldPieceId(null);
      setNotice("Puzzle tüm katılımcılarla eşitlendi.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Puzzle eşitlenemedi.");
    } finally {
      setSyncBusy(false);
    }
  };

  useEffect(() => {
    const roomCode = room?.code;
    if (!roomCode) return;
    let lastPollAt = 0;
    const pollRoom = async () => {
      if (document.hidden) return;
      if (dragRef.current || pendingRoomSaves.current > 0 || Date.now() - lastLocalMove.current < 1200) return;
      const now = Date.now();
      const minimumInterval = realtimeConnected.current ? 10_000 : 2_000;
      if (now - lastPollAt < minimumInterval) return;
      lastPollAt = now;
      try {
        const response = await fetch(`/api/room?code=${roomCode}&since=${remoteUpdatedAt.current}`, { cache: "no-store" });
        if (response.status === 204) return;
        if (!response.ok) return;
        const data = await readApiPayload<{ room: Room }>(response);
        if (data.room.updatedAt <= remoteUpdatedAt.current) return;
        remoteUpdatedAt.current = data.room.updatedAt;
        const nextRoom = { ...data.room, pieces: normalizePieces(data.room) };
        setRoom(nextRoom);
        setPieces(nextRoom.pieces);
      } catch { /* Keep the board usable during brief connection drops. */ }
    };
    const timer = window.setInterval(() => { void pollRoom(); }, 2_000);
    const refreshWhenVisible = () => {
      if (document.hidden) return;
      lastPollAt = 0;
      void pollRoom();
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [room?.code]);

  const createRoom = async (galleryItem?: GalleryItem) => {
    if (!commitNickname()) return;
    setBusy(true);
    try {
      const imageSource = galleryItem?.imageUrl || uploadPreviewUrl || imageUrl;
      let puzzleAspect = galleryItem ? imageAspect : pendingImageAspect ?? imageAspect;
      if (imageSource) {
        try {
          const image = await loadPuzzleImage(imageSource);
          puzzleAspect = image.naturalWidth / image.naturalHeight || puzzleAspect;
        } catch { /* The upload validation flow will report unreadable files. */ }
      }
      const requestedSize: PuzzleSize = galleryItem
        ? { count: galleryItem.rows * galleryItem.cols, rows: galleryItem.rows, cols: galleryItem.cols, label: "" }
        : PUZZLE_SIZES.find((option) => String(option.count) === difficulty) ?? PUZZLE_SIZES[0];
      const selectedSize = fitPuzzleSize(requestedSize, puzzleAspect);
      const { rows: r, cols: c } = selectedSize;
      const nextPieces = scatteredPieces(r, c, galleryItem ? `${galleryItem.id}-${crypto.randomUUID()}` : undefined);
      const form = new FormData();
      form.append("title", galleryItem?.title || title.trim() || "Bizim puzzle");
      form.append("rows", String(r));
      form.append("cols", String(c));
      form.append("pieces", JSON.stringify(nextPieces));
      if (galleryItem) {
        const galleryResponse = await fetch(galleryItem.imageUrl, { cache: "no-store" });
        if (!galleryResponse.ok) throw new Error("Galeri görseli yüklenemedi.");
        const galleryBlob = await galleryResponse.blob();
        form.append("image", new File([galleryBlob], `${galleryItem.id}.jpg`, { type: galleryBlob.type || "image/jpeg" }));
      } else if (file) form.append("image", file);
      else if (imageUrl.startsWith("blob:") || imageUrl.startsWith("data:")) {
        const defaultResponse = await fetch(imageUrl);
        if (!defaultResponse.ok) throw new Error("Varsayılan puzzle görseli hazırlanamadı.");
        const defaultBlob = await defaultResponse.blob();
        form.append("image", new File([defaultBlob], "puzzlebeyond-default.jpg", { type: defaultBlob.type || "image/jpeg" }));
      } else form.append("defaultImage", imageUrl);
      const response = await fetch("/api/room", { method: "POST", body: form });
      const data = await readApiPayload<{ room?: Room }>(response);
      if (!response.ok || !data.room) throw new Error(data.error || "Oda oluşturulamadı");
      remoteUpdatedAt.current = data.room.updatedAt;
      storeRoomCode(data.room.code);
      setPendingImageAspect(null);
      const nextRoom = { ...data.room, pieces: normalizePieces(data.room) };
      setRoom(nextRoom); setPieces(nextRoom.pieces); setRoomPlayers([]); setImageUrl(data.room.imageUrl); setUploadPreviewUrl("");
      setIntroCompletion("idle");
      setGalleryOpen(false);
      setLastHeldPieceId(null);
      setDialog(null); setNotice(`${data.room.code} kodlu oda hazır. Kodu arkadaşlarına gönder!`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Oda oluşturulamadı.");
    } finally { setBusy(false); }
  };

  const joinRoom = async () => {
    if (codeInput.length !== 6) { setNotice("Oda kodu 6 karakter olmalı."); return; }
    if (!commitNickname()) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/room?code=${codeInput}`, { cache: "no-store" });
      const data = await readApiPayload<{ room?: Room }>(response);
      if (!response.ok || !data.room) throw new Error(data.error || "Oda bulunamadı");
      remoteUpdatedAt.current = data.room.updatedAt;
      storeRoomCode(data.room.code);
      setPendingImageAspect(null);
      const nextRoom = { ...data.room, pieces: normalizePieces(data.room) };
      setRoom(nextRoom); setPieces(nextRoom.pieces); setRoomPlayers([]); setImageUrl(data.room.imageUrl);
      setIntroCompletion("idle");
      setGalleryOpen(false);
      setLastHeldPieceId(null);
      setDialog(null); setNotice(`${data.room.code} odasına katıldın. İyi eğlenceler!`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Odaya katılınamadı.");
    } finally { setBusy(false); }
  };

  const selectGalleryPuzzle = (item: GalleryItem) => {
    setSelectedGalleryId(item.id);
    if (!nicknameInput.trim()) {
      setPendingGalleryItem(item);
      setDialog("nickname");
      setNotice("Odaya katılmadan önce nickname'ini yaz.");
      return;
    }
    setNotice(`${item.title} için ortak oda hazırlanıyor…`);
    void createRoom(item);
  };

  const submitNickname = () => {
    if (!commitNickname()) return;
    const galleryItem = pendingGalleryItem;
    setPendingGalleryItem(null);
    setDialog(null);
    if (galleryItem) void createRoom(galleryItem);
  };

  const resetPreviewPuzzle = () => {
    setPreviewReplay(true);
    window.setTimeout(() => setPreviewReplay(false), 700);
    storeRoomCode(null);
    setPendingImageAspect(null);
    setRoom(null);
    setRoomPlayers([]);
    setIntroCompletion("idle");
    setGalleryOpen(false);
    setFile(null);
    setUploadPreviewUrl("");
    setSelectedGalleryId(null);
    void createDefaultImage().then(setImageUrl);
    setPieces(scatteredPieces(DEFAULT_ROWS, DEFAULT_COLS));
    setDifficulty("12");
    setTitle("Hafta sonu buluşması");
    setLastHeldPieceId(null);
    setHintVisible(false);
    setPreviewSeed(crypto.randomUUID());
    setNotice("Yeni ön izleme puzzle’ı hazır.");
  };

  const skipPreviewPuzzle = () => {
    setGalleryOpen(true);
    setHintVisible(false);
    setNotice("Ön izleme atlandı. Hazır puzzlelardan birini seçebilirsin.");
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    if (!selected) return;
    if (selected.size > 4 * 1024 * 1024) {
      setNotice("Fotoğraf en fazla 4 MB olabilir.");
      event.target.value = "";
      return;
    }
    setBusy(true);
    setNotice("Fotoğraf hazırlanıyor…");
    try {
      const prepared = await prepareUploadImage(selected);
      setPendingImageAspect(prepared.aspect);
      setFile(prepared.file);
      setSelectedGalleryId(null);
      setUploadPreviewUrl(URL.createObjectURL(prepared.file));
      setNotice(prepared.file === selected ? `${selected.name} kullanıma hazır.` : "Fotoğraf yükleme için optimize edildi.");
    } catch (error) {
      event.target.value = "";
      setFile(null);
      setNotice(error instanceof Error ? error.message : "Fotoğraf okunamadı.");
    } finally {
      setBusy(false);
    }
  };

  const createLiveDragMessage = useCallback((drag: LocalDrag, phase: RoomDragMessage["phase"]) => {
    if (!realtimeSenderId.current) return null;
    if (phase === "move") {
      const rect = boardRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) return null;
      drag.liveX = Math.max(-2, Math.min(3, (drag.clientX - rect.left) / rect.width));
      drag.liveY = Math.max(-2, Math.min(3, (drag.clientY - rect.top) / rect.height));
    }
    const message: RoomDragMessage = {
      senderId: realtimeSenderId.current,
      gestureId: drag.gestureId,
      pieceId: drag.id,
      x: drag.liveX,
      y: drag.liveY,
      seq: ++realtimeSequence.current,
      phase,
    };
    return message;
  }, []);

  const sendLiveDragMessage = useCallback((drag: LocalDrag, message: RoomDragMessage) => {
    const subscription = realtimeSubscriptionRef.current ?? drag.subscription;
    if (subscription) drag.subscription = subscription;
    if (subscription?.sendDrag(message)) {
      if ((pendingLiveDragRef.current?.seq ?? -1) <= message.seq) pendingLiveDragRef.current = null;
      return true;
    }
    if (!pendingLiveDragRef.current || pendingLiveDragRef.current.seq <= message.seq) pendingLiveDragRef.current = message;
    return false;
  }, []);

  const publishLiveDrag = useCallback((drag: LocalDrag, phase: RoomDragMessage["phase"]) => {
    const message = createLiveDragMessage(drag, phase);
    if (message) sendLiveDragMessage(drag, message);
    return message;
  }, [createLiveDragMessage, sendLiveDragMessage]);

  const movePiece = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const drag = dragRef.current;
    drag.clientX = event.clientX;
    drag.clientY = event.clientY;
    const now = performance.now();
    if (now - drag.lastBroadcastAt >= LIVE_DRAG_INTERVAL_MS) {
      drag.lastBroadcastAt = now;
      publishLiveDrag(drag, "move");
    }
    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        if (dragRef.current) {
          dragRef.current.element.style.left = `${dragRef.current.clientX - dragRef.current.width / 2}px`;
          dragRef.current.element.style.top = `${dragRef.current.clientY - dragRef.current.height / 2}px`;
        }
      });
    }
  }, [publishLiveDrag]);

  const cancelMove = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    publishLiveDrag(drag, "end");
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    drag.element.classList.remove("dragging");
    drag.element.setAttribute("style", drag.originalStyle);
    boardAreaRef.current?.classList.remove("drag-active");
    dragRef.current = null;
  }, [publishLiveDrag]);

  const endMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const drag = dragRef.current;
    const movingId = drag.id;
    drag.clientX = event.clientX;
    drag.clientY = event.clientY;
    publishLiveDrag(drag, "move");
    const liveEndMessage = createLiveDragMessage(drag, "end");
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const rect = boardRef.current?.getBoundingClientRect();
    const droppedOnBoard = Boolean(rect
      && drag.clientX >= rect.left && drag.clientX <= rect.right
      && drag.clientY >= rect.top && drag.clientY <= rect.bottom);
    const maxX = Math.max(0, 1 - 1 / cols);
    const maxY = Math.max(0, 1 - 1 / rows);
    const boardX = rect ? Math.max(0, Math.min(maxX, (drag.clientX - rect.left) / rect.width - 1 / (2 * cols))) : 0;
    const boardY = rect ? Math.max(0, Math.min(maxY, (drag.clientY - rect.top) / rect.height - 1 / (2 * rows))) : 0;
    const { x: targetX, y: targetY } = pieceBoardTarget(movingId, rows, cols);
    const snaps = droppedOnBoard
      && Math.abs(boardX - targetX) < (1 / cols) * 0.72
      && Math.abs(boardY - targetY) < (1 / rows) * 0.72;
    const finalBoardX = snaps ? targetX : boardX;
    const finalBoardY = snaps ? targetY : boardY;
    if (liveEndMessage && droppedOnBoard) {
      liveEndMessage.x = finalBoardX + 1 / (2 * cols);
      liveEndMessage.y = finalBoardY + 1 / (2 * rows);
    }
    const next = piecesRef.current.map((piece) => piece.id === movingId
      ? {
        ...piece,
        x: droppedOnBoard ? finalBoardX : 0,
        y: droppedOnBoard ? finalBoardY : 0,
        zone: droppedOnBoard ? "board" as const : "mat" as const,
        locked: snaps,
        layoutVersion: PUZZLE_LAYOUT_VERSION,
      }
      : piece);
    drag.element.classList.remove("dragging");
    drag.element.setAttribute("style", drag.originalStyle);
    boardAreaRef.current?.classList.remove("drag-active");
    dragRef.current = null;
    setPieces(next);
    if (liveEndMessage) sendLiveDragMessage(drag, liveEndMessage);
    void pushMove(next, movingId);
    if (snaps) setNotice("Tak! Parça doğru yerine oturdu.");
    if (snaps && !room && introCompletion === "idle" && next.every((piece) => piece.locked)) {
      setIntroCompletion("showing");
    }
  }, [cols, rows, pushMove, room, introCompletion, createLiveDragMessage, publishLiveDrag, sendLiveDragMessage]);

  useEffect(() => {
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancelMove();
    };
    window.addEventListener("keydown", cancelOnEscape);
    window.addEventListener("blur", cancelMove);
    return () => {
      window.removeEventListener("keydown", cancelOnEscape);
      window.removeEventListener("blur", cancelMove);
    };
  }, [cancelMove]);

  const placePieceFromKeyboard = useCallback((pieceId: number) => {
    const target = pieceBoardTarget(pieceId, rows, cols);
    const next = piecesRef.current.map((piece) => piece.id === pieceId
      ? { ...piece, ...target, zone: "board" as const, locked: true, layoutVersion: PUZZLE_LAYOUT_VERSION }
      : piece);
    setPieces(next);
    setLastHeldPieceId(pieceId);
    setHintVisible(false);
    void pushMove(next, pieceId);
    setNotice("Tak! Parça klavyeyle doğru yerine yerleştirildi.");
    if (!room && introCompletion === "idle" && next.every((piece) => piece.locked)) setIntroCompletion("showing");
  }, [rows, cols, pushMove, room, introCompletion]);

  const startMove = useCallback((event: PointerEvent<HTMLDivElement>, piece: Piece) => {
    if (piece.locked || !boardRef.current || event.button !== 0 || !event.isPrimary) return;
    if (dragRef.current) cancelMove();
    const boardRect = boardRef.current.getBoundingClientRect();
    const width = boardRect.width / cols;
    const height = boardRect.height / rows;
    const element = event.currentTarget;
    const originalStyle = element.getAttribute("style") || "";
    setLastHeldPieceId(piece.id);
    setHintVisible(false);
    event.preventDefault();
    try { element.setPointerCapture(event.pointerId); } catch { /* Pointer capture can fail after an interrupted gesture. */ }
    element.classList.add("dragging");
    if (piece.zone === "board") boardAreaRef.current?.classList.add("drag-active");
    element.style.position = "fixed";
    element.style.width = `${width}px`;
    element.style.height = `${height}px`;
    element.style.left = `${event.clientX - width / 2}px`;
    element.style.top = `${event.clientY - height / 2}px`;
    element.style.margin = "0";
    element.style.zIndex = "1000";
    if (!realtimeSenderId.current) realtimeSenderId.current = crypto.randomUUID();
    const drag: LocalDrag = {
      id: piece.id,
      clientX: event.clientX,
      clientY: event.clientY,
      width,
      height,
      originalStyle,
      element,
      gestureId: crypto.randomUUID(),
      liveX: 0,
      liveY: 0,
      lastBroadcastAt: performance.now(),
      subscription: realtimeSubscriptionRef.current,
    };
    dragRef.current = drag;
    publishLiveDrag(drag, "move");
  }, [cancelMove, cols, rows, publishLiveDrag]);

  const handleLostPieceCapture = useCallback((pieceId: number) => {
    if (dragRef.current?.id === pieceId) cancelMove();
  }, [cancelMove]);

  const focusPiece = useCallback((pieceId: number) => {
    setLastHeldPieceId(pieceId);
  }, []);

  const copyCode = useCallback(async () => {
    if (!room) return;
    await navigator.clipboard?.writeText(room.code);
    setNotice("Oda kodu panoya kopyalandı.");
  }, [room]);

  const showHint = useCallback(() => {
    if (!hintPiece) {
      setNotice("Puzzle zaten tamamlandı — ipucuna ihtiyacın kalmadı!");
      return;
    }
    if (hintTimer.current) window.clearTimeout(hintTimer.current);
    setHintVisible(true);
    setNotice(lastHeldPieceId === null
      ? "İpucu 3 saniye boyunca açık: parlayan hücreye dikkat et."
      : "Son tuttuğun parçanın doğru yeri 3 saniye boyunca gösteriliyor.");
    hintTimer.current = window.setTimeout(() => setHintVisible(false), 3200);
  }, [hintPiece, lastHeldPieceId]);

  const pushToSides = useCallback(() => {
    const boardLoosePieces = pieces.filter((piece) => !piece.locked && piece.zone === "board");
    if (boardLoosePieces.length === 0) {
      setNotice("Tahta üzerinde kenara alınacak parça yok!");
      return;
    }
    setHintVisible(false);
    const next = pieces.map((piece) => {
      if (piece.locked || piece.zone !== "board") return piece;
      return { ...piece, x: 0, y: 0, zone: "mat" as const, locked: false, layoutVersion: PUZZLE_LAYOUT_VERSION };
    });
    setPieces(next);
    if (room) void pushPieces(next);
    setNotice("Serbest parçalar tahta çevresine toplandı.");
  }, [pieces, room, pushPieces]);

  const downloadCompletedImage = async () => {
    if (!room || progress !== 100 || downloadBusy) return;
    setDownloadBusy(true);
    try {
      const response = await fetch(`/api/image?code=${encodeURIComponent(room.code)}&download=1`, { cache: "no-store" });
      if (!response.ok) throw new Error("Görsel indirilemedi.");
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      const extension = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";
      link.download = `puzzlebeyond-${room.code}.${extension}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      setNotice("Tamamlanan görsel indiriliyor.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Görsel indirilemedi.");
    } finally {
      setDownloadBusy(false);
    }
  };

  return (
    <main className="site-shell">
      <header className="topbar">
        <button className="brand" onClick={resetPreviewPuzzle} aria-label="puzzlebeyond ana sayfa">
          <span className="brand-mark">P</span><span>puzzlebeyond</span>
        </button>
        <div className="header-actions">
          <button className="text-button" onClick={() => setDialog("join")}>Kodla katıl</button>
          {!room && <button className={`primary-button small ${galleryVisible ? "header-gallery" : "header-new-setup"}`} onClick={() => setDialog("create")}><span>＋</span> Yeni puzzle</button>}
        </div>
      </header>

      <section className={`hero-strip ${room ? "compact" : ""}`}>
        <div>
          <p className="eyebrow">Herkes bir parça koysun</p>
          <h1>{room ? room.title : "Birlikte daha kolay."}</h1>
        </div>
        <p>{room ? "Aynı oda kodundaki herkes bu tahtayı canlı olarak paylaşır." : "Fotoğrafını seç, odanı kur, kodu paylaş. Puzzle tek ekranda değil, hepinizin ellerinde tamamlansın."}</p>
      </section>

      <section className="game-layout">
        <aside className="panel room-panel">
          <div className="panel-heading panel-heading-rich">
            <span className="index">01</span>
            <span><b>ORTAK MASA</b><small>AYNI KOD, AYNI PUZZLE</small></span>
          </div>
          {room ? (
            <div className="room-panel-content">
              <div className="room-live-row">
                <span className="status-beacon"><i /></span>
                <span><b>BAĞLANTI AÇIK</b><small>{pieceCount} parçalık ortak oyun</small></span>
              </div>
              <button className="share-code-card" onClick={copyCode} title="Oda kodunu kopyala">
                <span>DAVET KODU</span>
                <strong>{room.code}</strong>
                <small>KOPYALAMAK İÇİN DOKUN ↗</small>
              </button>
              <div className="invite-explainer">
                <span>1</span><p>Kodu arkadaşlarına gönder.</p>
                <span>2</span><p>Herkes aynı tahtaya bağlansın.</p>
              </div>
              <div className="room-players" aria-label="Odada çözen kişiler">
                <div className="room-players-heading"><b>ÇÖZENLER</b><small>{visibleRoomPlayers.length} KİŞİ</small></div>
                {visibleRoomPlayers.map((player, index) => (
                  <div className="current-player-card" key={player.clientId}>
                    <span className="avatar" style={{ background: avatarColor(index) }}>{player.nickname.slice(0, 1).toUpperCase()}</span>
                    <span><b>{player.nickname}</b><small>{player.clientId === clientId ? "BU CİHAZ" : "ÇÖZÜYOR"}</small></span>
                    <i className="online-dot" />
                  </div>
                ))}
              </div>
              <button className="outline-button full room-copy-button" onClick={copyCode}>KODU KOPYALA</button>
            </div>
          ) : (
            <div className="room-start-card">
              <span className="code-stamp">6</span>
              <p className="room-start-kicker">KARAKTER · TEK MASA</p>
              <h3>Arkadaşlarının puzzle&apos;ına katıl.</h3>
              <p>Sana gönderilen oda kodu herkesi aynı canlı tahtada buluşturur.</p>
              <button className="primary-button full" onClick={() => setDialog("join")}>KODLA KATIL →</button>
              <button className="panel-text-button" onClick={() => setDialog("create")}>YENİ ODA KUR</button>
              <button className="panel-text-button" onClick={skipPreviewPuzzle}>GALERİYE GEÇ</button>
            </div>
          )}
        </aside>

        <section className="board-section">
          <div className="board-toolbar">
            <div><span className="live-dot" /> {room ? "CANLI OYUN" : galleryVisible ? "PUZZLE GALERİSİ" : ""}</div>
            <div className="toolbar-right">
              {!room && !galleryVisible && <button className="skip-preview-button" onClick={skipPreviewPuzzle}>GALERİYE GEÇ →</button>}
              {room && <button className="sync-button" onClick={() => void forceSyncRoom()} disabled={syncBusy} title="Puzzle durumunu sunucudan yeniden al">{syncBusy ? "EŞİTLENİYOR…" : "↻ EŞİTLE"}</button>}
              {(room || !galleryVisible) && <button className="push-sides-button" onClick={pushToSides} title="Kilitlenmemiş parçaları tahta çevresine topla">↹ KENARA İT</button>}
              {(room || !galleryVisible) && <button className={`hint-button ${hintVisible ? "active" : ""}`} onClick={showHint} aria-pressed={hintVisible}>✦ İPUCU</button>}
              {(room || !galleryVisible) && (
                <div className="zoom-controls" aria-label="Puzzle tahtası yakınlaştırma">
                  <button type="button" onClick={() => setBoardZoom((zoom) => Math.max(1, zoom - .5))} disabled={boardZoom <= 1} aria-label="Uzaklaştır">−</button>
                  <span>{boardZoom.toFixed(1)}×</span>
                  <button type="button" onClick={() => setBoardZoom((zoom) => Math.min(3, zoom + .5))} disabled={boardZoom >= 3} aria-label="Yakınlaştır">+</button>
                </div>
              )}
              <div className="difficulty-pill" title={`${rows}×${cols}`}>{progress}% · {pieceCount} PARÇA</div>
            </div>
          </div>
          {galleryVisible ? (
            <section className="gallery-view" aria-labelledby="gallery-title">
              <div className="gallery-heading">
                <div>
                  <p className="eyebrow">Sıradaki masanı seç</p>
                  <h2 id="gallery-title">Hazır puzzlelar</h2>
                </div>
                <p>Bir karta dokunduğunda ortak oda açılır; kodu arkadaşlarınla paylaşabilirsin.</p>
              </div>
              <div className="gallery-grid">
                {galleryLoading
                  ? <p className="gallery-empty">Hazır puzzlelar hazırlanıyor…</p>
                  : galleryItems.length === 0 && <p className="gallery-empty">Şimdilik hazır puzzle yok. Kendi fotoğrafınla ilk odayı kurabilirsin.</p>}
                {galleryItems.map((item) => (
                  <button key={item.id} className={`gallery-card ${selectedGalleryId === item.id ? "selected" : ""}`} onClick={() => selectGalleryPuzzle(item)} disabled={busy}>
                    {/* Generated and authenticated gallery URLs intentionally bypass the image optimizer. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.imageUrl} alt={`${item.title} puzzle görseli`} width={1200} height={800} loading="lazy" decoding="async" />
                    <span className="gallery-card-accent" style={{ background: item.accent }} />
                    <span className="gallery-card-copy"><b>{item.title}</b><small>{item.description}</small><em>{item.count} PARÇA · ORTAK ODA KUR →</em></span>
                  </button>
                ))}
              </div>
              <div className="gallery-actions">
                <button className="outline-button" onClick={resetPreviewPuzzle}>Ön izlemeyi tekrar oyna</button>
                <button className="primary-button" onClick={() => setDialog("create")}>Kendi fotoğrafını ekle</button>
              </div>
            </section>
          ) : (
            <>
              <div
                className={`puzzle-workspace ${imageAspect > 1 ? "horizontal-puzzle" : ""} ${previewReplay ? "preview-replay" : ""}`}
                style={workspaceStyle}
                onPointerMove={movePiece}
                onPointerUp={endMove}
                onPointerCancel={cancelMove}
              >
                <div className={`puzzle-board-area ${boardZoom > 1 ? "zoomed" : ""}`} ref={boardAreaRef}>
                  <div className="puzzle-board-guide" ref={boardRef} style={boardStyle} role="group" aria-label={`${rows} satır ve ${cols} sütunluk puzzle tahtası`} aria-describedby="puzzle-keyboard-help">
                    <span className="sr-only" id="puzzle-keyboard-help">Bir parçaya odaklanıp Enter veya Boşluk tuşuyla doğru yerine yerleştirebilirsin.</span>
                    <div
                      className="board-grid"
                      style={{
                        "--grid-cell-width": `${100 / cols}%`,
                        "--grid-cell-height": `${100 / rows}%`,
                      } as CSSProperties}
                      aria-hidden="true"
                    />
                    <p>PARÇALARI BURAYA YERLEŞTİR</p>
                    {hintVisible && hintPiece && (
                      <div
                        className="hint-target"
                        style={{
                          left: `${(hintPiece.id % cols) * 100 / cols}%`,
                          top: `${Math.floor(hintPiece.id / cols) * 100 / rows}%`,
                          width: `${100 / cols}%`,
                          height: `${100 / rows}%`,
                        }}
                      >
                        <JigsawPiece id={hintPiece.id} rows={rows} cols={cols} seed={room?.code ?? previewSeed} imageUrl={imageUrl} />
                      </div>
                    )}
                    {pieceCount > 120 && lockedIds.length > 0 && (
                      <LockedPiecesCanvas
                        lockedIds={lockedIds}
                        lockedIdsKey={lockedIdsKey}
                        rows={rows}
                        cols={cols}
                        seed={puzzleSeed}
                        imageUrl={imageUrl}
                      />
                    )}
                    {interactiveBoardPieces.map((piece) => (
                      <InteractivePuzzlePiece
                        key={piece.id}
                        piece={piece}
                        zone="board"
                        rows={rows}
                        cols={cols}
                        seed={puzzleSeed}
                        imageUrl={imageUrl}
                        pieceCount={pieceCount}
                        isRecent={piece.id === lastHeldPieceId}
                        isKeyboardPiece={piece.id === keyboardPieceId}
                        isRemoteHeld={remoteHeldIds.has(piece.id)}
                        onStart={startMove}
                        onLostCapture={handleLostPieceCapture}
                        onFocusPiece={focusPiece}
                        onPlacePiece={placePieceFromKeyboard}
                      />
                    ))}
                    {remoteDrags.map((drag) => (
                      <RemotePuzzlePiece
                        key={`${drag.senderId}:${drag.gestureId}`}
                        drag={drag}
                        rows={rows}
                        cols={cols}
                        seed={puzzleSeed}
                        imageUrl={imageUrl}
                        pieceCount={pieceCount}
                      />
                    ))}
                    {room && progress === 100 && (
                      <div className="board-completion-card">
                        <div className="complete-label"><span>✓</span> TAMAMLANDI!</div>
                        <button className="download-image-button" type="button" onClick={() => void downloadCompletedImage()} disabled={downloadBusy}>{downloadBusy ? "HAZIRLANIYOR…" : "GÖRSELİ İNDİR ↓"}</button>
                      </div>
                    )}
                    {!room && introCompletion === "showing" && (
                      <div className="complete-badge intro-complete">
                        <div className="complete-label"><span>✓</span> TAMAMLANDI!</div>
                      </div>
                    )}
                  </div>
                </div>
                {visibleLoosePieces.map((piece) => (
                  <InteractivePuzzlePiece
                    key={piece.id}
                    piece={piece}
                    zone="mat"
                    rows={rows}
                    cols={cols}
                    seed={puzzleSeed}
                    imageUrl={imageUrl}
                    pieceCount={pieceCount}
                    isRecent={piece.id === lastHeldPieceId}
                    isKeyboardPiece={piece.id === keyboardPieceId}
                    isRemoteHeld={remoteHeldIds.has(piece.id)}
                    sidePosition={sideLayout.get(piece.id)}
                    bandPosition={bandLayout.get(piece.id)}
                    onStart={startMove}
                    onLostCapture={handleLostPieceCapture}
                    onFocusPiece={focusPiece}
                    onPlacePiece={placePieceFromKeyboard}
                  />
                ))}
              </div>
              <div className="mobile-room-actions">
                {room && <button className="outline-button" onClick={copyCode}>Kodu paylaş: {room.code}</button>}
                {room && <button className="primary-button" onClick={() => setDialog("create")}>YENİ PUZZLE KUR</button>}
              </div>
            </>
          )}
        </section>

        <aside className="panel progress-panel">
          <div className="panel-heading panel-heading-rich">
            <span className="index coral">02</span>
            <span><b>OYUN DURUMU</b><small>ANLIK İLERLEME</small></span>
          </div>
          <div className="progress-overview">
            <div className="progress-dial" style={{ background: `conic-gradient(var(--coral) 0 ${progress}%, #ded8cb ${progress}% 100%)` }}>
              <div><strong>{progress}</strong><span>%</span></div>
            </div>
            <p>{progress === 100 ? (room ? "Görselin tamamı ortaya çıktı." : "Hazır puzzleları keşfet.") : progress > 0 ? "Görüntü ortaya çıkıyor." : "İlk parçayı sen yerleştir."}</p>
          </div>
          <div className="progress-counts">
            <div><span>YERİNDE</span><strong>{solvedCount}</strong><i>PARÇA</i></div>
            <div><span>BEKLİYOR</span><strong>{remainingCount}</strong><i>PARÇA</i></div>
          </div>
          <div className="progress-rail"><i style={{ width: `${progress}%` }} /></div>
          <div className="panel-help">
            <span>✦ KÜÇÜK İPUCU</span>
            <p>Parçayı doğru yere yaklaştırıp bırak; yerine kendiliğinden oturur.</p>
          </div>
          <button className="primary-button full progress-create" onClick={() => setDialog("create")}>{room ? "YENİ PUZZLE KUR →" : "FOTOĞRAFINLA BAŞLA →"}</button>
        </aside>
      </section>

      <div className="notice" role="status"><span>i</span>{notice}</div>

      <footer><span>PUZZLEBEYOND / 2026</span><p>Uzakta olsanız da aynı masadasınız.</p><span>MADE FOR TOGETHERNESS</span></footer>

      {dialog && (
        <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setDialog(null)}>
          <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
            <button className="close-button" onClick={() => setDialog(null)} aria-label="Pencereyi kapat">×</button>
            {dialog === "create" ? (
              <>
                <p className="eyebrow">YENİ BİR ANIYI PARÇALA</p>
                <h2 id="dialog-title">Puzzle odanı kur</h2>
                <label className="field"><span>Nickname</span><input value={nicknameInput} onChange={(e) => setNicknameInput(e.target.value)} maxLength={24} placeholder="Örn. Zeynep" /></label>
                <label className="field"><span>Puzzle adı</span><input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={48} /></label>
                <label className="upload-field">
                  {(uploadPreviewUrl || imageUrl) ? (
                    <>
                      {/* Generated and local preview URLs intentionally bypass the image optimizer. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={uploadPreviewUrl || imageUrl} alt="Seçilen puzzle ön izlemesi" width={95} height={74} loading="eager" decoding="async" />
                    </>
                  ) : <span className="upload-icon">＋</span>}
                  <div><b>{file ? file.name : selectedGalleryId ? "Galeriden seçilen puzzle" : "Fotoğrafını ekle"}</b><small>{selectedGalleryId ? "Hazır görsel seçildi · istersen değiştirebilirsin" : "JPG, PNG veya WEBP · en fazla 4 MB"}</small></div>
                  <input type="file" accept="image/jpeg,image/png,image/webp" onChange={onFile} />
                </label>
                <fieldset><legend style={{ textAlign: "center" }}>Zorluk · hedef parça sayısı</legend><div className="difficulty-options">
                  {PUZZLE_SIZES.map((option) => (
                    <button key={option.count} className={difficulty === String(option.count) ? "selected" : ""} onClick={() => setDifficulty(String(option.count))}>
                      <b>{option.label}</b><span>≈{option.count} parça</span>
                    </button>
                  ))}
                </div><p className="difficulty-result" aria-live="polite"><strong>{selectedPuzzleSize.rows}×{selectedPuzzleSize.cols}</strong><span className="difficulty-sep" /><strong>{selectedPuzzleSize.count} PARÇA</strong></p></fieldset>
                <button className="primary-button full dialog-submit" onClick={() => createRoom()} disabled={busy}>{busy ? "ODA HAZIRLANIYOR…" : "ODAYI OLUŞTUR →"}</button>
              </>
            ) : dialog === "join" ? (
              <>
                <p className="eyebrow">ARKADAŞLARIN SENİ BEKLİYOR</p>
                <h2 id="dialog-title">Kodu gir, parçanı koy</h2>
                <p className="dialog-copy">Sana gönderilen 6 karakterlik oda kodunu aşağıya yaz.</p>
                <label className="field"><span>Nickname</span><input value={nicknameInput} onChange={(e) => setNicknameInput(e.target.value)} maxLength={24} placeholder="Örn. Zeynep" /></label>
                <input className="code-input" autoFocus value={codeInput} onChange={(e) => setCodeInput(formatCode(e.target.value))} placeholder="A7K2P9" maxLength={6} onKeyDown={(e) => e.key === "Enter" && joinRoom()} />
                <button className="primary-button full dialog-submit" onClick={joinRoom} disabled={busy}>{busy ? "BAĞLANIYOR…" : "ODAYA KATIL →"}</button>
              </>
            ) : (
              <>
                <p className="eyebrow">ORTAK MASA İÇİN HAZIR</p>
                <h2 id="dialog-title">Nickname&apos;in ne?</h2>
                <p className="dialog-copy">Aynı odadaki kişiler seni bu adla görecek.</p>
                <label className="field"><span>Nickname</span><input autoFocus value={nicknameInput} onChange={(e) => setNicknameInput(e.target.value)} maxLength={24} placeholder="Örn. Zeynep" onKeyDown={(e) => e.key === "Enter" && submitNickname()} /></label>
                <button className="primary-button full dialog-submit" onClick={submitNickname}>DEVAM ET →</button>
              </>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
