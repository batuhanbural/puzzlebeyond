"use client";

import { ChangeEvent, CSSProperties, PointerEvent, useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_GALLERY, type GalleryKind } from "@/lib/gallery";
import { subscribeToRoomRealtime, type RealtimePieceUpdate, type RealtimeSubscription } from "@/lib/realtime-client";

type Piece = { id: number; x: number; y: number; locked?: boolean };
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
const BOARD = { left: 0.2, top: 0.15, width: 0.6, height: 0.7 };
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
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Puzzle görseli yüklenemedi."));
    image.src = src;
  });
  puzzleImageCache.set(src, pending);
  return pending;
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
  if (typeof document === "undefined") return "";
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
  return canvas.toDataURL("image/jpeg", 0.9);
}

function createGalleryImage(kind: "sunset" | "garden" | "city") {
  if (typeof document === "undefined") return "";
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 800;
  const ctx = canvas.getContext("2d")!;
  if (kind === "sunset") {
    const sky = ctx.createLinearGradient(0, 0, 0, 800);
    sky.addColorStop(0, "#ff9f7f"); sky.addColorStop(.52, "#ff6f61"); sky.addColorStop(1, "#4864ff");
    ctx.fillStyle = sky; ctx.fillRect(0, 0, 1200, 800);
    ctx.fillStyle = "#ffd84d"; ctx.beginPath(); ctx.arc(830, 300, 118, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#151515"; ctx.beginPath(); ctx.moveTo(0, 590); ctx.lineTo(230, 370); ctx.lineTo(430, 565); ctx.lineTo(650, 315); ctx.lineTo(910, 590); ctx.lineTo(1080, 430); ctx.lineTo(1200, 555); ctx.lineTo(1200, 800); ctx.lineTo(0, 800); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#d3d3ff"; ctx.fillRect(0, 650, 1200, 150);
    ctx.fillStyle = "#151515"; ctx.font = "900 62px Arial"; ctx.fillText("GÜN BATIMI", 58, 735);
  } else if (kind === "garden") {
    ctx.fillStyle = "#f4f0e6"; ctx.fillRect(0, 0, 1200, 800);
    ctx.fillStyle = "#d3d3ff"; ctx.fillRect(0, 0, 1200, 170);
    ctx.fillStyle = "#4864ff"; ctx.fillRect(0, 570, 1200, 230);
    ctx.fillStyle = "#ff6f61"; ctx.beginPath(); ctx.arc(210, 300, 135, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ffd84d"; ctx.beginPath(); ctx.arc(510, 245, 92, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#151515"; ctx.fillRect(870, 250, 38, 390);
    ctx.fillStyle = "#40b866"; ctx.beginPath(); ctx.arc(890, 190, 110, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ff6f61"; ctx.beginPath(); ctx.arc(760, 400, 68, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fffdf7"; ctx.beginPath(); ctx.arc(760, 400, 24, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#151515"; ctx.font = "900 62px Arial"; ctx.fillText("ÇİÇEK BAHÇESİ", 58, 112);
  } else {
    const night = ctx.createLinearGradient(0, 0, 0, 800);
    night.addColorStop(0, "#151515"); night.addColorStop(1, "#4864ff");
    ctx.fillStyle = night; ctx.fillRect(0, 0, 1200, 800);
    ctx.fillStyle = "#ffd84d"; ctx.beginPath(); ctx.arc(950, 150, 72, 0, Math.PI * 2); ctx.fill();
    const buildings = [[70, 300, 190, 500], [290, 230, 220, 570], [545, 350, 155, 450], [730, 180, 210, 620], [980, 290, 150, 510]];
    buildings.forEach(([x, y, width, height], index) => {
      ctx.fillStyle = index % 2 ? "#d3d3ff" : "#ff6f61"; ctx.fillRect(x, y, width, height);
      ctx.fillStyle = "#151515";
      for (let row = y + 32; row < y + height - 20; row += 52) for (let col = x + 24; col < x + width - 18; col += 48) ctx.fillRect(col, row, 18, 24);
    });
    ctx.fillStyle = "#fffdf7"; ctx.font = "900 62px Arial"; ctx.fillText("GECE ŞEHRİ", 58, 112);
  }
  return canvas.toDataURL("image/jpeg", 0.88);
}

function createGalleryItems(): GalleryItem[] {
  return DEFAULT_GALLERY.map((item) => ({ ...item, imageUrl: item.kind === "custom" ? "" : createGalleryImage(item.kind) }));
}

function scatteredPieces(rows: number, cols: number, seed?: string) {
  let state = seed ? Array.from(seed).reduce((total, char) => Math.imul(total ^ char.charCodeAt(0), 2654435761), 2166136261) >>> 0 : 0;
  const random = seed ? () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  } : Math.random;
  if (rows * cols <= 20) {
    const ids = Array.from({ length: rows * cols }, (_, id) => id).sort(() => random() - 0.5);
    const perSide = Math.ceil(ids.length / 2);
    const cellWidth = BOARD.width / cols;
    const cellHeight = BOARD.height / rows;
    return ids.map((id, index) => {
      const side = index % 2;
      const slot = Math.floor(index / 2);
      const y = Math.min(0.99 - cellHeight, ((slot + 0.18 + random() * 0.64) / perSide) * (0.99 - cellHeight));
      const x = side === 0
        ? 0.012 + random() * 0.018
        : Math.min(0.99 - cellWidth, BOARD.left + BOARD.width + 0.014 + random() * 0.018);
      return { id, x, y, locked: false };
    });
  }
  const shuffle = <T,>(values: T[]) => {
    for (let index = values.length - 1; index > 0; index--) {
      const swapIndex = Math.floor(random() * (index + 1));
      [values[index], values[swapIndex]] = [values[swapIndex], values[index]];
    }
    return values;
  };
  const cellWidth = BOARD.width / cols;
  const cellHeight = BOARD.height / rows;
  const slots: Array<{ x: number; y: number }> = [];
  const stepX = cellWidth * 0.82;
  const stepY = cellHeight * 0.82;
  for (let y = 0.012; y <= 0.988 - cellHeight; y += stepY) {
    for (let x = 0.012; x <= 0.988 - cellWidth; x += stepX) {
      const fitsLeftTray = x + cellWidth * 0.9 < BOARD.left - 0.006;
      const fitsRightTray = x > BOARD.left + BOARD.width + 0.006;
      if (!fitsLeftTray && !fitsRightTray) continue;
      slots.push({
        x: Math.max(0.005, Math.min(0.99 - cellWidth, x + (random() - 0.5) * cellWidth * 0.12)),
        y: Math.max(0.005, Math.min(0.99 - cellHeight, y + (random() - 0.5) * cellHeight * 0.12)),
      });
    }
  }
  shuffle(slots);
  const ids = shuffle(Array.from({ length: rows * cols }, (_, id) => id));
  return ids.map((id, index) => ({
    id,
    x: slots[index]?.x ?? (index % 2 === 0
      ? 0.006 + random() * Math.max(0.006, BOARD.left - cellWidth - 0.018)
      : BOARD.left + BOARD.width + 0.008 + random() * Math.max(0.006, 0.982 - BOARD.left - BOARD.width - cellWidth)),
    y: slots[index]?.y ?? 0.01 + random() * Math.max(0.01, 0.98 - cellHeight),
    locked: false,
  }));
}

function normalizePieces(room: Room) {
  const legacyGrid = room.pieces.some((piece) => piece.x > 1 || piece.y > 1);
  return legacyGrid ? scatteredPieces(room.rows, room.cols, room.code) : room.pieces;
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

function JigsawPiece({ id, rows, cols, seed, imageUrl }: { id: number; rows: number; cols: number; seed: string; imageUrl: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageUrl) return;
    let cancelled = false;
    let drawTimer: number | undefined;
    void loadPuzzleImage(imageUrl).then((image) => {
      drawTimer = window.setTimeout(() => {
        if (cancelled) return;
      const row = Math.floor(id / cols);
      const col = id % cols;
      const imageRatio = image.naturalWidth / image.naturalHeight || DEFAULT_IMAGE_ASPECT;
      const boardWidth = 800;
      const boardHeight = boardWidth / imageRatio;
      const cellWidth = boardWidth / cols;
      const cellHeight = boardHeight / rows;
      // Keep the canvas padding proportional to each cell axis. The canvas is
      // rendered at 168% width/height and offset by 34%; using the same pad
      // on both axes distorts the path whenever cells are not square.
      const padX = cellWidth * 0.34;
      const padY = cellHeight * 0.34;
      const tab = Math.min(cellWidth, cellHeight) * 0.28;
      const width = cellWidth + padX * 2;
      const height = cellHeight + padY * 2;
      const scale = 2;
      canvas.width = Math.ceil(width * scale);
      canvas.height = Math.ceil(height * scale);
      const context = canvas.getContext("2d");
      if (!context) return;
      context.scale(scale, scale);

      const flat = { sign: 0, center: 0.5, spread: 0.18, neck: 0.1, crown: 0.26, depth: 1 };
      const topBoundary = row === 0 ? flat : edgeProfile(seed, row - 1, col, "h");
      const rightBoundary = col === cols - 1 ? flat : edgeProfile(seed, row, col, "v");
      const bottomBoundary = row === rows - 1 ? flat : edgeProfile(seed, row, col, "h");
      const leftBoundary = col === 0 ? flat : edgeProfile(seed, row, col - 1, "v");
      const top = { ...topBoundary, sign: -topBoundary.sign };
      const right = rightBoundary;
      const bottom = bottomBoundary;
      const left = { ...leftBoundary, sign: -leftBoundary.sign };
      const x0 = padX, y0 = padY, x1 = padX + cellWidth, y1 = padY + cellHeight;

      const addEdge = (
        startX: number, startY: number, endX: number, endY: number,
        normalX: number, normalY: number,
        edge: { sign: number; center: number; spread: number; neck: number; crown: number; depth: number },
      ) => {
        if (!edge.sign) {
          context.lineTo(endX, endY);
          return;
        }
        const deltaX = endX - startX;
        const deltaY = endY - startY;
        const point = (along: number, normal: number) => ({
          x: startX + deltaX * along + normalX * normal,
          y: startY + deltaY * along + normalY * normal,
        });
        const center = edge.center;
        const spread = edge.spread;
        const neck = edge.neck;
        const crown = edge.crown;
        const depth = tab * edge.depth * edge.sign;
        const baseStart = point(center - spread, 0);
        const neckLeft = point(center - neck, depth * 0.18);
        const crownTop = point(center, depth);
        const neckRight = point(center + neck, depth * 0.18);
        const baseEnd = point(center + spread, 0);
        context.lineTo(baseStart.x, baseStart.y);
        let control1 = point(center - spread + 0.035, 0);
        let control2 = point(center - neck + 0.025, depth * 0.04);
        context.bezierCurveTo(control1.x, control1.y, control2.x, control2.y, neckLeft.x, neckLeft.y);
        control1 = point(center - neck - 0.1, depth * 0.42);
        control2 = point(center - crown * 0.6, depth * 0.96);
        context.bezierCurveTo(control1.x, control1.y, control2.x, control2.y, crownTop.x, crownTop.y);
        control1 = point(center + crown * 0.6, depth * 0.96);
        control2 = point(center + neck + 0.1, depth * 0.42);
        context.bezierCurveTo(control1.x, control1.y, control2.x, control2.y, neckRight.x, neckRight.y);
        control1 = point(center + neck - 0.025, depth * 0.04);
        control2 = point(center + spread - 0.035, 0);
        context.bezierCurveTo(control1.x, control1.y, control2.x, control2.y, baseEnd.x, baseEnd.y);
        context.lineTo(endX, endY);
      };

      context.beginPath();
      context.moveTo(x0, y0);
      addEdge(x0, y0, x1, y0, 0, -1, top);
      addEdge(x1, y0, x1, y1, 1, 0, right);
      addEdge(x1, y1, x0, y1, 0, 1, { ...bottom, center: 1 - bottom.center });
      addEdge(x0, y1, x0, y0, -1, 0, { ...left, center: 1 - left.center });
      context.closePath();
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
      }, (id % 64) * 4);
    }).catch(() => { /* The next image URL change retries the render. */ });
    return () => {
      cancelled = true;
      if (drawTimer !== undefined) window.clearTimeout(drawTimer);
    };
  }, [id, rows, cols, seed, imageUrl]);

  return <canvas ref={canvasRef} className="piece-canvas" aria-hidden="true" />;
}

function formatCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
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

async function validateImage(file: File) {
  if (!isSupportedImageType(file.type)) {
    throw new Error("Yalnızca JPG, PNG veya WebP fotoğrafları kullanılabilir.");
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadPuzzleImage(objectUrl);
    return image.naturalWidth / image.naturalHeight || DEFAULT_IMAGE_ASPECT;
  } finally {
    puzzleImageCache.delete(objectUrl);
    URL.revokeObjectURL(objectUrl);
  }
}

async function prepareUploadFile(file: File) {
  const maxDimension = 2400;
  const maxBytes = 2.8 * 1024 * 1024;
  if (file.size <= maxBytes) {
    return file;
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadPuzzleImage(objectUrl);
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.fillStyle = "#fffdf7";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.84));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg", lastModified: Date.now() });
  } finally {
    puzzleImageCache.delete(objectUrl);
    URL.revokeObjectURL(objectUrl);
  }
}

function avatarColor(index: number) {
  return ["#d3d3ff", "#ff6f61", "#4864ff", "#ffd84d"][index % 4];
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
  const [clientId] = useState(() => {
    if (typeof window === "undefined") return "";
    const storageKey = "puzzlebeyond-client-id";
    const existing = localStorage.getItem(storageKey) || localStorage.getItem("parca-client-id");
    if (existing) return existing;
    const value = window.crypto.randomUUID();
    localStorage.setItem(storageKey, value);
    return value;
  });
  const boardRef = useRef<HTMLDivElement>(null);
  const lastLocalMove = useRef(0);
  const remoteUpdatedAt = useRef(0);
  const realtimeConnected = useRef(false);
  const realtimeLastEventAt = useRef(0);
  const realtimeSend = useRef<RealtimeSubscription["send"] | null>(null);
  const presenceRevoked = useRef(false);
  const hintTimer = useRef<number | null>(null);
  const dragRef = useRef<{
    id: number;
    offsetX: number;
    offsetY: number;
    currentX: number;
    currentY: number;
    lastBroadcastAt: number;
    element: HTMLDivElement;
  } | null>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setImageUrl(createDefaultImage());
      setPreviewSeed(crypto.randomUUID());
    });
    return () => window.cancelAnimationFrame(frame);
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
    return () => {
      if (uploadPreviewUrl) URL.revokeObjectURL(uploadPreviewUrl);
    };
  }, [uploadPreviewUrl]);
  useEffect(() => {
    let cancelled = false;
    const fallback = () => setGalleryItems(createGalleryItems());
    void fetch("/api/gallery", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error("Gallery request failed");
      return await response.json() as { puzzles?: Array<GalleryItem & { kind?: GalleryKind; imageUrl?: string }>; setupRequired?: boolean };
    }).then((payload) => {
      if (cancelled) return;
      const items = (payload.puzzles || []).map((item) => {
        const kind = item.kind || "custom";
        return {
          id: item.id,
          title: item.title,
          description: item.description,
          imageUrl: kind === "custom" ? (item.imageUrl || "") : createGalleryImage(kind),
          rows: item.rows,
          cols: item.cols,
          count: item.count || item.rows * item.cols,
          accent: item.accent,
          kind,
        } satisfies GalleryItem;
      });
      setGalleryItems(payload.setupRequired ? createGalleryItems() : items);
    }).catch(() => {
      if (!cancelled) fallback();
    });
    return () => { cancelled = true; };
  }, []);
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
      setRoom(data.room);
      setPieces(normalizePieces(data.room));
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
    if (!clientId) return;
    const sendHeartbeat = async () => {
      if (presenceRevoked.current) return;
      try {
        const response = await fetch("/api/presence", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId, roomCode: room?.code ?? null, nickname: playerName }),
        });
        if (response.status === 410) {
          presenceRevoked.current = true;
          setNotice("Bu oturum admin tarafından kapatıldı.");
        }
      } catch { /* Presence is optional until the Supabase migration is run. */ }
    };
    sendHeartbeat();
    const timer = window.setInterval(sendHeartbeat, 20_000);
    const leave = () => {
      if (presenceRevoked.current) return;
      const body = JSON.stringify({ clientId, leave: true });
      const beacon = new Blob([body], { type: "application/json" });
      if (!navigator.sendBeacon("/api/presence", beacon)) {
        void fetch("/api/presence", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
      }
    };
    window.addEventListener("pagehide", leave);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pagehide", leave);
    };
  }, [clientId, playerName, room?.code]);
  useEffect(() => {
    const roomCode = room?.code;
    if (!roomCode) {
      return;
    }
    let cancelled = false;
    const loadPlayers = async () => {
      try {
        const response = await fetch(`/api/presence?roomCode=${encodeURIComponent(roomCode)}`, { cache: "no-store" });
        const data = await readApiPayload<{ players?: RoomPlayer[] }>(response);
        if (response.ok && !cancelled) setRoomPlayers(data.players || []);
      } catch { /* The local player card remains visible during brief outages. */ }
    };
    void loadPlayers();
    const timer = window.setInterval(loadPlayers, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [room?.code]);
  useEffect(() => () => {
    if (hintTimer.current) window.clearTimeout(hintTimer.current);
  }, []);

  useEffect(() => {
    const roomCode = room?.code;
    realtimeConnected.current = false;
    if (!roomCode) return;
    let cancelled = false;
    let subscription: RealtimeSubscription | null = null;

    const applyRealtimeUpdate = (update: RealtimePieceUpdate) => {
      if (cancelled || dragRef.current || (!update.optimistic && update.updatedAt <= remoteUpdatedAt.current) || (update.optimistic && update.updatedAt <= remoteUpdatedAt.current)) return;
      realtimeLastEventAt.current = Date.now();
      if (!update.optimistic) remoteUpdatedAt.current = update.updatedAt;
      if (update.pieces) {
        const nextPieces = update.pieces as Piece[];
        setPieces(nextPieces);
        setRoom((current) => current ? { ...current, pieces: nextPieces, updatedAt: update.updatedAt } : current);
        return;
      }
      if (!update.piece) return;
      const nextPiece = update.piece as Piece;
      setPieces((current) => current.map((piece) => piece.id === nextPiece.id ? nextPiece : piece));
      setRoom((current) => {
        if (!current) return current;
        return {
          ...current,
          pieces: current.pieces.map((piece) => piece.id === nextPiece.id ? nextPiece : piece),
          updatedAt: update.updatedAt,
        };
      });
    };

    void fetch("/api/realtime", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) return null;
      return await response.json() as { enabled?: boolean; url?: string; key?: string };
    }).then((config) => {
      if (cancelled || !config?.enabled || !config.url || !config.key) return;
      subscription = subscribeToRoomRealtime(
        { url: config.url, key: config.key },
        roomCode,
        applyRealtimeUpdate,
        (status) => { realtimeConnected.current = status === "connected"; },
      );
      realtimeSend.current = subscription.send;
    }).catch(() => {
      // The since-polling fallback keeps rooms usable before Realtime is configured.
    });

    return () => {
      cancelled = true;
      realtimeConnected.current = false;
      realtimeSend.current = null;
      subscription?.unsubscribe();
    };
  }, [room?.code]);

  const localSize = PUZZLE_SIZES.find((option) => String(option.count) === difficulty) ?? PUZZLE_SIZES[0];
  const selectedPuzzleSize = fitPuzzleSize(localSize, pendingImageAspect ?? imageAspect);
  const rows = room?.rows ?? DEFAULT_ROWS;
  const cols = room?.cols ?? DEFAULT_COLS;
  const pieceCount = rows * cols;
  const solvedCount = pieces.filter((piece) => piece.locked).length;
  const remainingCount = pieceCount - solvedCount;
  const progress = Math.round((solvedCount / pieceCount) * 100);
  const galleryVisible = !room && (galleryOpen || introCompletion === "gallery");
  const workspaceAspect = imageAspect * BOARD.height / BOARD.width;
  const hintPiece = lastHeldPieceId === null
    ? pieces.find((piece) => !piece.locked)
    : pieces.find((piece) => piece.id === lastHeldPieceId);
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
    lastLocalMove.current = Date.now();
    const movedPiece = nextPieces.find((piece) => piece.id === movedId);
    if (movedPiece) {
      realtimeSend.current?.({ piece: movedPiece, updatedAt: Date.now(), optimistic: true });
    }
    try {
      const response = await fetch("/api/room", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: room.code, piece: nextPieces.find((piece) => piece.id === movedId) }),
      });
      if (response.ok) {
        const data = await readApiPayload<{ updatedAt?: number }>(response);
        remoteUpdatedAt.current = data.updatedAt ?? remoteUpdatedAt.current;
      }
    } catch {
      setNotice("Hamlen cihazında kaydedildi; bağlantı gelince tekrar eşitlenecek.");
    }
  }, [room]);

  const forceSyncRoom = async () => {
    if (!room || syncBusy) return;
    setSyncBusy(true);
    setHintVisible(false);
    if (dragRef.current) {
      dragRef.current.element.classList.remove("dragging");
      dragRef.current = null;
    }
    try {
      const response = await fetch(`/api/room?code=${encodeURIComponent(room.code)}`, { cache: "no-store" });
      const data = await readApiPayload<{ room?: Room }>(response);
      if (!response.ok || !data.room) throw new Error(data.error || "Puzzle eşitlenemedi.");
      remoteUpdatedAt.current = data.room.updatedAt;
      lastLocalMove.current = Date.now();
      setRoom(data.room);
      setPieces(normalizePieces(data.room));
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
    const timer = window.setInterval(async () => {
      const realtimeRecentlyDelivered = realtimeConnected.current && Date.now() - realtimeLastEventAt.current < 2500;
      if (realtimeRecentlyDelivered || dragRef.current || Date.now() - lastLocalMove.current < 1200) return;
      try {
        const response = await fetch(`/api/room?code=${roomCode}&since=${remoteUpdatedAt.current}`, { cache: "no-store" });
        if (response.status === 204) return;
        if (!response.ok) return;
        const data = await readApiPayload<{ room: Room }>(response);
        if (data.room.updatedAt <= remoteUpdatedAt.current) return;
        remoteUpdatedAt.current = data.room.updatedAt;
        setRoom(data.room);
        setPieces(normalizePieces(data.room));
      } catch { /* Keep the board usable during brief connection drops. */ }
    }, 400);
    return () => window.clearInterval(timer);
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
      if (galleryItem?.kind === "custom" && galleryItem.imageUrl.startsWith("/")) {
        const galleryResponse = await fetch(galleryItem.imageUrl, { cache: "no-store" });
        if (!galleryResponse.ok) throw new Error("Galeri görseli yüklenemedi.");
        const galleryBlob = await galleryResponse.blob();
        form.append("image", new File([galleryBlob], `${galleryItem.id}.jpg`, { type: galleryBlob.type || "image/jpeg" }));
      } else if (galleryItem) form.append("defaultImage", galleryItem.imageUrl);
      else if (file) form.append("image", file);
      else form.append("defaultImage", imageUrl);
      const response = await fetch("/api/room", { method: "POST", body: form });
      const data = await readApiPayload<{ room?: Room }>(response);
      if (!response.ok || !data.room) throw new Error(data.error || "Oda oluşturulamadı");
      remoteUpdatedAt.current = data.room.updatedAt;
      storeRoomCode(data.room.code);
      setPendingImageAspect(null);
      setRoom(data.room); setPieces(normalizePieces(data.room)); setRoomPlayers([]); setImageUrl(data.room.imageUrl); setUploadPreviewUrl("");
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
      setRoom(data.room); setPieces(normalizePieces(data.room)); setRoomPlayers([]); setImageUrl(data.room.imageUrl);
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
    setImageUrl(createDefaultImage());
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
      const selectedAspect = await validateImage(selected);
      setPendingImageAspect(selectedAspect);
      const preparedFile = await prepareUploadFile(selected);
      setFile(preparedFile);
      setSelectedGalleryId(null);
      setUploadPreviewUrl(URL.createObjectURL(preparedFile));
      setNotice(preparedFile === selected ? `${selected.name} kullanıma hazır.` : "Fotoğraf yükleme için optimize edildi.");
    } catch (error) {
      event.target.value = "";
      setFile(null);
      setNotice(error instanceof Error ? error.message : "Fotoğraf okunamadı.");
    } finally {
      setBusy(false);
    }
  };

  const movePiece = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || !boardRef.current) return;
    const drag = dragRef.current;
    const rect = boardRef.current.getBoundingClientRect();
    const x = Math.max(0.005, Math.min(0.91, (event.clientX - rect.left) / rect.width - drag.offsetX));
    const y = Math.max(0.005, Math.min(0.89, (event.clientY - rect.top) / rect.height - drag.offsetY));
    drag.currentX = x;
    drag.currentY = y;
    drag.element.style.left = `${x * 100}%`;
    drag.element.style.top = `${y * 100}%`;
    const now = Date.now();
    if (room && now - drag.lastBroadcastAt >= 80) {
      realtimeSend.current?.({
        piece: { id: drag.id, x, y, locked: false },
        updatedAt: now,
        optimistic: true,
      });
      drag.lastBroadcastAt = now;
    }
  };

  const endMove = () => {
    if (!dragRef.current) return;
    const drag = dragRef.current;
    const movingId = drag.id;
    drag.element.classList.remove("dragging");
    dragRef.current = null;
    const correctCol = movingId % cols;
    const correctRow = Math.floor(movingId / cols);
    const targetX = BOARD.left + correctCol * (BOARD.width / cols);
    const targetY = BOARD.top + correctRow * (BOARD.height / rows);
    const snaps = Math.abs(drag.currentX - targetX) < (BOARD.width / cols) * 0.72
      && Math.abs(drag.currentY - targetY) < (BOARD.height / rows) * 0.72;
    const next = pieces.map((piece) => piece.id === movingId
      ? { ...piece, x: snaps ? targetX : drag.currentX, y: snaps ? targetY : drag.currentY, locked: snaps }
      : piece);
    setPieces(next);
    void pushMove(next, movingId);
    if (snaps) setNotice("Tak! Parça doğru yerine oturdu.");
    if (snaps && !room && introCompletion === "idle" && next.every((piece) => piece.locked)) {
      setIntroCompletion("showing");
    }
  };

  const copyCode = async () => {
    if (!room) return;
    await navigator.clipboard?.writeText(room.code);
    setNotice("Oda kodu panoya kopyalandı.");
  };

  const showHint = () => {
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
  };

  const pushToSides = () => {
    const cellWidth = BOARD.width / cols;
    const cellHeight = BOARD.height / rows;
    const boardPadX = cellWidth * 0.3;
    const boardPadY = cellHeight * 0.3;
    const onBoard = pieces.filter((p) => {
      if (p.locked) return false;
      const cx = p.x + cellWidth / 2;
      const cy = p.y + cellHeight / 2;
      return cx >= BOARD.left - boardPadX && cx <= BOARD.left + BOARD.width + boardPadX
        && cy >= BOARD.top - boardPadY && cy <= BOARD.top + BOARD.height + boardPadY;
    });
    if (onBoard.length === 0) {
      setNotice("Tahta üzerinde kalan parça yok!");
      return;
    }
    setHintVisible(false);
    const stepX = cellWidth * 0.82;
    const stepY = cellHeight * 0.82;
    const slots: Array<{ x: number; y: number }> = [];
    for (let y = 0.012; y <= 0.988 - cellHeight; y += stepY) {
      for (let x = 0.012; x <= 0.988 - cellWidth; x += stepX) {
        const fitsLeftTray = x + cellWidth * 0.9 < BOARD.left - 0.006;
        const fitsRightTray = x > BOARD.left + BOARD.width + 0.006;
        if (!fitsLeftTray && !fitsRightTray) continue;
        slots.push({
          x: Math.max(0.005, Math.min(0.99 - cellWidth, x + (Math.random() - 0.5) * cellWidth * 0.12)),
          y: Math.max(0.005, Math.min(0.99 - cellHeight, y + (Math.random() - 0.5) * cellHeight * 0.12)),
        });
      }
    }
    for (let i = slots.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [slots[i], slots[j]] = [slots[j], slots[i]];
    }
    const ids = onBoard.map((p) => p.id);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    const fallbackX = (index: number) => index % 2 === 0
      ? 0.006 + Math.random() * Math.max(0.006, BOARD.left - cellWidth - 0.018)
      : BOARD.left + BOARD.width + 0.008 + Math.random() * Math.max(0.006, 0.982 - BOARD.left - BOARD.width - cellWidth);
    const next = pieces.map((piece) => {
      if (piece.locked || !onBoard.some((p) => p.id === piece.id)) return piece;
      const slotIndex = ids.indexOf(piece.id);
      const slot = slots[slotIndex];
      return {
        ...piece,
        x: slot?.x ?? fallbackX(slotIndex),
        y: slot?.y ?? 0.01 + Math.random() * Math.max(0.01, 0.98 - cellHeight),
        locked: false,
      };
    });
    setPieces(next);
    if (room) {
      for (const piece of onBoard) void pushMove(next, piece.id);
    }
    setNotice("Tahtadaki parçalar kenarlara dağıtıldı.");
  };

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
              {(room || !galleryVisible) && <button className="push-sides-button" onClick={pushToSides} title="Kilitlenmemiş parçaları kenarlara topla">↹ KENARA İT</button>}
              {(room || !galleryVisible) && <button className={`hint-button ${hintVisible ? "active" : ""}`} onClick={showHint} aria-pressed={hintVisible}>✦ İPUCU</button>}
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
                {galleryItems.length === 0 && <p className="gallery-empty">Şimdilik hazır puzzle yok. Kendi fotoğrafınla ilk odayı kurabilirsin.</p>}
                {galleryItems.map((item) => (
                  <button key={item.id} className={`gallery-card ${selectedGalleryId === item.id ? "selected" : ""}`} onClick={() => selectGalleryPuzzle(item)} disabled={busy}>
                    <img src={item.imageUrl} alt={`${item.title} puzzle görseli`} />
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
                ref={boardRef}
                className={`puzzle-workspace ${previewReplay ? "preview-replay" : ""}`}
                style={{ "--workspace-aspect": workspaceAspect } as CSSProperties}
                onPointerMove={movePiece}
                onPointerUp={endMove}
                onPointerCancel={endMove}
              >
                <div className="puzzle-board-guide">
                  <div className="board-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}>
                    {Array.from({ length: pieceCount }).map((_, i) => <span key={i} />)}
                  </div>
                  <p>PARÇALARI BURAYA YERLEŞTİR</p>
                </div>
                {hintVisible && hintPiece && (
                  <div
                    className="hint-target"
                    style={{
                      left: `${(BOARD.left + (hintPiece.id % cols) * BOARD.width / cols) * 100}%`,
                      top: `${(BOARD.top + Math.floor(hintPiece.id / cols) * BOARD.height / rows) * 100}%`,
                      width: `${BOARD.width * 100 / cols}%`,
                      height: `${BOARD.height * 100 / rows}%`,
                    }}
                  >
                    <JigsawPiece id={hintPiece.id} rows={rows} cols={cols} seed={room?.code ?? previewSeed} imageUrl={imageUrl} />
                  </div>
                )}
                {pieces.map((piece) => (
                  <div
                    key={piece.id}
                    className={`puzzle-piece ${piece.locked ? "locked" : ""} ${piece.id === lastHeldPieceId ? "recent" : ""} ${pieceCount > 120 ? "dense-piece" : pieceCount > 20 ? "compact-piece" : ""}`}
                    style={{
                      width: `${BOARD.width * 100 / cols}%`, height: `${BOARD.height * 100 / rows}%`,
                      left: `${piece.x * 100}%`, top: `${piece.y * 100}%`,
                    }}
                    onPointerDown={(event) => {
                      if (piece.locked || !boardRef.current) return;
                      setLastHeldPieceId(piece.id);
                      setHintVisible(false);
                      event.currentTarget.setPointerCapture(event.pointerId);
                      const rect = boardRef.current.getBoundingClientRect();
                      event.currentTarget.classList.add("dragging");
                      dragRef.current = {
                        id: piece.id,
                        offsetX: (event.clientX - rect.left) / rect.width - piece.x,
                        offsetY: (event.clientY - rect.top) / rect.height - piece.y,
                        currentX: piece.x,
                        currentY: piece.y,
                        lastBroadcastAt: 0,
                        element: event.currentTarget,
                      };
                    }}
                    role="button" tabIndex={0} aria-label={`${piece.id + 1}. puzzle parçası`}
                  >
                    <JigsawPiece id={piece.id} rows={rows} cols={cols} seed={room?.code ?? previewSeed} imageUrl={imageUrl} />
                  </div>
                ))}
                {room && progress === 100 && (
                  <div className="board-completion-card">
                    <div className="complete-label"><span>✓</span> TAMAMLANDI!</div>
                    <button className="download-image-button" type="button" onClick={() => void downloadCompletedImage()} disabled={downloadBusy}>{downloadBusy ? "HAZIRLANIYOR…" : "GÖRSELİ İNDİR ↓"}</button>
                  </div>
                )}
                {!room && introCompletion === "showing" && (
                  <div className={`complete-badge ${room ? "" : "intro-complete"}`}>
                    <div className="complete-label"><span>✓</span> TAMAMLANDI!</div>
                  </div>
                )}
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
                  {(uploadPreviewUrl || imageUrl) ? <img src={uploadPreviewUrl || imageUrl} alt="Seçilen puzzle ön izlemesi" /> : <span className="upload-icon">＋</span>}
                  <div><b>{file ? file.name : selectedGalleryId ? "Galeriden seçilen puzzle" : "Fotoğrafını ekle"}</b><small>{selectedGalleryId ? "Hazır görsel seçildi · istersen değiştirebilirsin" : "JPG, PNG veya WEBP · en fazla 4 MB"}</small></div>
                  <input type="file" accept="image/jpeg,image/png,image/webp" onChange={onFile} />
                </label>
                <fieldset><legend style={{ textAlign: "center" }}>Zorluk · hedef parça sayısı</legend><div className="difficulty-options">
                  {PUZZLE_SIZES.map((option) => (
                    <button key={option.count} className={difficulty === String(option.count) ? "selected" : ""} onClick={() => setDifficulty(String(option.count))}>
                      <b>{option.label}</b><span>≈{option.count} parça</span>
                    </button>
                  ))}
                </div><p className="difficulty-result" aria-live="polite"><span className="difficulty-sep" /><strong>{selectedPuzzleSize.count} PARÇA</strong></p></fieldset>
                <button className="primary-button full dialog-submit" onClick={() => createRoom()} disabled={busy}>{busy ? "ODA HAZIRLANIYOR…" : "ODAYI OLUŞTUR →"}</button>
              </>
            ) : dialog === "join" ? (
              <>
                <p className="eyebrow">ARKADAŞLARIN SENİ BEKLİYOR</p>
                <h2 id="dialog-title">Kodu gir, parçanı koy</h2>
                <p className="dialog-copy">Sana gönderilen 6 karakterlik oda kodunu aşağıya yaz.</p>
                <label className="field"><span>Nickname</span><input value={nicknameInput} onChange={(e) => setNicknameInput(e.target.value)} maxLength={24} placeholder="Örn. Zeynep" /></label>
                <input className="code-input" autoFocus value={codeInput} onChange={(e) => setCodeInput(formatCode(e.target.value))} placeholder="A7K2P9" onKeyDown={(e) => e.key === "Enter" && joinRoom()} />
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
