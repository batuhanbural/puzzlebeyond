"use client";

import { ChangeEvent, PointerEvent, useCallback, useEffect, useRef, useState } from "react";

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

const DEFAULT_ROWS = 3;
const DEFAULT_COLS = 4;
const BOARD = { left: 0.18, top: 0.235, width: 0.64, height: 0.53 };

function createDefaultImage() {
  if (typeof document === "undefined") return "";
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 900;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#f4f0e6";
  ctx.fillRect(0, 0, 1200, 900);
  ctx.fillStyle = "#d8ff63";
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
  ctx.fillStyle = "#d8ff63";
  ctx.beginPath(); ctx.arc(870, 610, 42, 0, Math.PI * 2); ctx.fill();
  return canvas.toDataURL("image/jpeg", 0.9);
}

function scatteredPieces(rows: number, cols: number, seed?: string) {
  let state = seed ? Array.from(seed).reduce((total, char) => Math.imul(total ^ char.charCodeAt(0), 2654435761), 2166136261) >>> 0 : 0;
  const random = seed ? () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  } : Math.random;
  const ids = Array.from({ length: rows * cols }, (_, id) => id).sort(() => random() - 0.5);
  const perSide = Math.ceil(ids.length / 4);
  return ids.map((id, index) => {
    const side = index % 4;
    const slot = Math.floor(index / 4);
    const along = (slot + 0.35 + random() * 0.3) / perSide;
    const jitter = (random() - 0.5) * 0.035;
    if (side === 0) return { id, x: 0.07 + along * 0.75, y: 0.025 + jitter, locked: false };
    if (side === 1) return { id, x: 0.81 + jitter, y: 0.1 + along * 0.68, locked: false };
    if (side === 2) return { id, x: 0.07 + along * 0.75, y: 0.82 + jitter, locked: false };
    return { id, x: 0.025 + jitter, y: 0.1 + along * 0.68, locked: false };
  });
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
    center: 0.43 + ((unsigned >>> 3) % 15) / 100,
    spread: 0.19 + ((unsigned >>> 8) % 5) / 100,
    neck: 0.11 + ((unsigned >>> 12) % 4) / 100,
    crown: 0.22 + ((unsigned >>> 16) % 6) / 100,
    depth: 0.74 + ((unsigned >>> 20) % 23) / 100,
  };
}

function JigsawPiece({ id, rows, cols, seed, imageUrl }: { id: number; rows: number; cols: number; seed: string; imageUrl: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageUrl) return;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      const row = Math.floor(id / cols);
      const col = id % cols;
      const cellWidth = 800 / cols;
      const cellHeight = 600 / rows;
      const pad = Math.min(cellWidth, cellHeight) * 0.34;
      const tab = Math.min(cellWidth, cellHeight) * 0.28;
      const width = cellWidth + pad * 2;
      const height = cellHeight + pad * 2;
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
      const x0 = pad, y0 = pad, x1 = pad + cellWidth, y1 = pad + cellHeight;

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
        let control2 = point(center - neck + 0.055, depth * 0.04);
        context.bezierCurveTo(control1.x, control1.y, control2.x, control2.y, neckLeft.x, neckLeft.y);
        control1 = point(center - neck - 0.08, depth * 0.46);
        control2 = point(center - crown * 0.35, depth);
        context.bezierCurveTo(control1.x, control1.y, control2.x, control2.y, crownTop.x, crownTop.y);
        control1 = point(center + crown * 0.35, depth);
        control2 = point(center + neck + 0.08, depth * 0.46);
        context.bezierCurveTo(control1.x, control1.y, control2.x, control2.y, neckRight.x, neckRight.y);
        control1 = point(center + neck - 0.055, depth * 0.04);
        control2 = point(center + spread - 0.035, 0);
        context.bezierCurveTo(control1.x, control1.y, control2.x, control2.y, baseEnd.x, baseEnd.y);
        context.lineTo(endX, endY);
      };

      context.beginPath();
      context.moveTo(x0, y0);
      addEdge(x0, y0, x1, y0, 0, -1, top);
      addEdge(x1, y0, x1, y1, 1, 0, right);
      addEdge(x1, y1, x0, y1, 0, 1, bottom);
      addEdge(x0, y1, x0, y0, -1, 0, left);
      context.closePath();
      context.save();
      context.clip();
      const boardWidth = cellWidth * cols;
      const boardHeight = cellHeight * rows;
      const imageRatio = image.naturalWidth / image.naturalHeight;
      const boardRatio = boardWidth / boardHeight;
      const drawWidth = imageRatio > boardRatio ? boardHeight * imageRatio : boardWidth;
      const drawHeight = imageRatio > boardRatio ? boardHeight : boardWidth / imageRatio;
      const offsetX = (boardWidth - drawWidth) / 2;
      const offsetY = (boardHeight - drawHeight) / 2;
      context.drawImage(image, pad + offsetX - col * cellWidth, pad + offsetY - row * cellHeight, drawWidth, drawHeight);
      context.restore();
      context.lineJoin = "round";
      context.lineCap = "round";
      context.strokeStyle = "rgba(21,21,21,.92)";
      context.lineWidth = 3;
      context.stroke();
      context.strokeStyle = "rgba(255,255,255,.46)";
      context.lineWidth = 0.9;
      context.stroke();
    };
    image.src = imageUrl;
  }, [id, rows, cols, seed, imageUrl]);

  return <canvas ref={canvasRef} className="piece-canvas" aria-hidden="true" />;
}

function formatCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

function avatarColor(index: number) {
  return ["#d8ff63", "#ff6f61", "#4864ff", "#ffd84d"][index % 4];
}

export default function Home() {
  const [room, setRoom] = useState<Room | null>(null);
  const [pieces, setPieces] = useState<Piece[]>(() => scatteredPieces(DEFAULT_ROWS, DEFAULT_COLS));
  const [imageUrl, setImageUrl] = useState("");
  const [previewSeed, setPreviewSeed] = useState("PREVIEW");
  const [codeInput, setCodeInput] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("Hafta sonu buluşması");
  const [difficulty, setDifficulty] = useState("12");
  const [dialog, setDialog] = useState<"create" | "join" | null>(null);
  const [notice, setNotice] = useState("Yeni bir oda kurabilir ya da arkadaşlarının kodunu girebilirsin.");
  const [busy, setBusy] = useState(false);
  const [hintVisible, setHintVisible] = useState(false);
  const [playerName] = useState(() => typeof window === "undefined" ? "Sen" : localStorage.getItem("puzzle-name") || "Sen");
  const boardRef = useRef<HTMLDivElement>(null);
  const lastLocalMove = useRef(0);
  const remoteUpdatedAt = useRef(0);
  const hintTimer = useRef<number | null>(null);
  const dragRef = useRef<{
    id: number;
    offsetX: number;
    offsetY: number;
    currentX: number;
    currentY: number;
    element: HTMLDivElement;
  } | null>(null);

  useEffect(() => {
    setImageUrl(createDefaultImage());
    setPreviewSeed(crypto.randomUUID());
  }, []);
  useEffect(() => () => {
    if (hintTimer.current) window.clearTimeout(hintTimer.current);
  }, []);

  const rows = room?.rows ?? DEFAULT_ROWS;
  const cols = room?.cols ?? DEFAULT_COLS;
  const pieceCount = rows * cols;
  const solvedCount = pieces.filter((piece) => piece.locked).length;
  const remainingCount = pieceCount - solvedCount;
  const progress = Math.round((solvedCount / pieceCount) * 100);
  const hintPiece = pieces.find((piece) => !piece.locked);

  const pushMove = useCallback(async (nextPieces: Piece[]) => {
    if (!room) return;
    lastLocalMove.current = Date.now();
    try {
      const response = await fetch("/api/room", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: room.code, pieces: nextPieces }),
      });
      if (response.ok) {
        const data = await response.json() as { updatedAt?: number };
        remoteUpdatedAt.current = data.updatedAt ?? remoteUpdatedAt.current;
      }
    } catch {
      setNotice("Hamlen cihazında kaydedildi; bağlantı gelince tekrar eşitlenecek.");
    }
  }, [room]);

  useEffect(() => {
    if (!room) return;
    const timer = window.setInterval(async () => {
      if (dragRef.current || Date.now() - lastLocalMove.current < 1200) return;
      try {
        const response = await fetch(`/api/room?code=${room.code}`, { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json() as { room: Room };
        if (data.room.updatedAt <= remoteUpdatedAt.current) return;
        remoteUpdatedAt.current = data.room.updatedAt;
        setRoom(data.room);
        setPieces(normalizePieces(data.room));
      } catch { /* Keep the board usable during brief connection drops. */ }
    }, 1100);
    return () => window.clearInterval(timer);
  }, [room?.code]);

  const createRoom = async () => {
    setBusy(true);
    const [r, c] = difficulty === "20" ? [4, 5] : [3, 4];
    const nextPieces = scatteredPieces(r, c);
    try {
      const form = new FormData();
      form.append("title", title.trim() || "Bizim puzzle");
      form.append("rows", String(r));
      form.append("cols", String(c));
      form.append("pieces", JSON.stringify(nextPieces));
      if (file) form.append("image", file);
      else form.append("defaultImage", imageUrl);
      const response = await fetch("/api/room", { method: "POST", body: form });
      const data = await response.json() as { room?: Room; error?: string };
      if (!response.ok || !data.room) throw new Error(data.error || "Oda oluşturulamadı");
      remoteUpdatedAt.current = data.room.updatedAt;
      setRoom(data.room); setPieces(normalizePieces(data.room)); setImageUrl(data.room.imageUrl);
      setDialog(null); setNotice(`${data.room.code} kodlu oda hazır. Kodu arkadaşlarına gönder!`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Oda oluşturulamadı.");
    } finally { setBusy(false); }
  };

  const joinRoom = async () => {
    if (codeInput.length !== 6) { setNotice("Oda kodu 6 karakter olmalı."); return; }
    setBusy(true);
    try {
      const response = await fetch(`/api/room?code=${codeInput}`, { cache: "no-store" });
      const data = await response.json() as { room?: Room; error?: string };
      if (!response.ok || !data.room) throw new Error(data.error || "Oda bulunamadı");
      remoteUpdatedAt.current = data.room.updatedAt;
      setRoom(data.room); setPieces(normalizePieces(data.room)); setImageUrl(data.room.imageUrl);
      setDialog(null); setNotice(`${data.room.code} odasına katıldın. İyi eğlenceler!`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Odaya katılınamadı.");
    } finally { setBusy(false); }
  };

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    if (!selected) return;
    if (selected.size > 8 * 1024 * 1024) { setNotice("Fotoğraf en fazla 8 MB olabilir."); return; }
    setFile(selected);
    setImageUrl(URL.createObjectURL(selected));
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
  };

  const endMove = () => {
    if (!dragRef.current) return;
    const drag = dragRef.current;
    const movingId = drag.id;
    drag.element.classList.remove("dragging");
    dragRef.current = null;
    setPieces((current) => {
      const correctCol = movingId % cols;
      const correctRow = Math.floor(movingId / cols);
      const targetX = BOARD.left + correctCol * (BOARD.width / cols);
      const targetY = BOARD.top + correctRow * (BOARD.height / rows);
      const snaps = Math.abs(drag.currentX - targetX) < (BOARD.width / cols) * 0.72
        && Math.abs(drag.currentY - targetY) < (BOARD.height / rows) * 0.72;
      const next = current.map((piece) => piece.id === movingId
        ? { ...piece, x: snaps ? targetX : drag.currentX, y: snaps ? targetY : drag.currentY, locked: snaps }
        : piece);
      void pushMove(next);
      if (snaps) setNotice("Tak! Parça doğru yerine oturdu.");
      return next;
    });
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
    setNotice("İpucu 3 saniye boyunca açık: parlayan hücreye dikkat et.");
    hintTimer.current = window.setTimeout(() => setHintVisible(false), 3200);
  };

  return (
    <main className="site-shell">
      <header className="topbar">
        <button className="brand" onClick={() => { setRoom(null); setPieces(scatteredPieces(3, 4)); setPreviewSeed(crypto.randomUUID()); setImageUrl(createDefaultImage()); }} aria-label="Parça ana sayfa">
          <span className="brand-mark">P</span><span>parça</span>
        </button>
        <div className="header-actions">
          <button className="text-button" onClick={() => setDialog("join")}>Kodla katıl</button>
          <button className="primary-button small" onClick={() => setDialog("create")}><span>＋</span> Yeni puzzle</button>
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
          <div className="panel-heading"><span className="index">01</span><span>OYUN ODASI</span></div>
          {room ? (
            <>
              <p className="muted-label">ODA KODU</p>
              <button className="room-code" onClick={copyCode} title="Kopyala">{room.code}<span>⧉</span></button>
              <p className="room-hint">Arkadaşların bu kodu girerek aynı tahtaya bağlanabilir.</p>
              <div className="room-state"><span className="live-dot" /><b>ODA AÇIK</b><span>{pieceCount} parça</span></div>
              <div className="divider" />
              <p className="muted-label">OYUNCULAR · 1</p>
              <div className="players">
                <div className="player">
                  <span className="avatar" style={{ background: avatarColor(0) }}>{playerName.slice(0, 1)}</span>
                  <span>{playerName}</span><small>SEN</small>
                  <i className="online-dot" />
                </div>
              </div>
              <p className="waiting-player">Diğer oyuncular kodla katıldığında burada görünür.</p>
              <button className="outline-button full" onClick={copyCode}>Davet kodunu kopyala</button>
            </>
          ) : (
            <div className="empty-room">
              <span className="big-number">6</span>
              <p>karakterlik bir kod, herkesi aynı puzzle&apos;da buluşturur.</p>
              <button className="outline-button full" onClick={() => setDialog("join")}>KOD GİR</button>
            </div>
          )}
        </aside>

        <section className="board-section">
          <div className="board-toolbar">
            <div><span className="live-dot" /> {room ? "CANLI OYUN" : "ÖN İZLEME"}</div>
            <div className="toolbar-right">
              <button className={`hint-button ${hintVisible ? "active" : ""}`} onClick={showHint} aria-pressed={hintVisible}>✦ İPUCU</button>
              <div className="difficulty-pill">{pieceCount} PARÇA · {rows}×{cols}</div>
            </div>
          </div>
          <div
            ref={boardRef}
            className={`puzzle-workspace ${progress === 100 ? "is-complete" : ""}`}
            onPointerMove={movePiece}
            onPointerUp={endMove}
            onPointerCancel={endMove}
          >
            <div className="puzzle-board-guide">
              <div className={`hint-preview ${hintVisible ? "visible" : ""}`} style={{ backgroundImage: `url(${imageUrl})` }} />
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
              ><span>{hintPiece.id + 1}</span></div>
            )}
            {pieces.map((piece) => (
              <div
                key={piece.id}
                className={`puzzle-piece ${piece.locked ? "locked" : ""}`}
                style={{
                  width: `${BOARD.width * 100 / cols}%`, height: `${BOARD.height * 100 / rows}%`,
                  left: `${piece.x * 100}%`, top: `${piece.y * 100}%`,
                }}
                onPointerDown={(event) => {
                  if (piece.locked || !boardRef.current) return;
                  event.currentTarget.setPointerCapture(event.pointerId);
                  const rect = boardRef.current.getBoundingClientRect();
                  event.currentTarget.classList.add("dragging");
                  dragRef.current = {
                    id: piece.id,
                    offsetX: (event.clientX - rect.left) / rect.width - piece.x,
                    offsetY: (event.clientY - rect.top) / rect.height - piece.y,
                    currentX: piece.x,
                    currentY: piece.y,
                    element: event.currentTarget,
                  };
                }}
                role="button" tabIndex={0} aria-label={`${piece.id + 1}. puzzle parçası`}
              >
                <JigsawPiece id={piece.id} rows={rows} cols={cols} seed={room?.code ?? previewSeed} imageUrl={imageUrl} />
              </div>
            ))}
            {progress === 100 && <div className="complete-badge"><span>✓</span> TAMAMLANDI!</div>}
          </div>
          <div className="mobile-room-actions">
            {!room && <button className="primary-button" onClick={() => setDialog("create")}>Yeni puzzle oluştur</button>}
            {room && <button className="outline-button" onClick={copyCode}>Kodu paylaş: {room.code}</button>}
          </div>
        </section>

        <aside className="panel progress-panel">
          <div className="panel-heading"><span className="index">02</span><span>İLERLEME</span></div>
          <div className="progress-value"><strong>{progress}</strong><span>%</span></div>
          <div className="progress-track"><i style={{ width: `${progress}%` }} /></div>
          <div className="stat-grid">
            <div><strong>{solvedCount}</strong><span>YERLEŞEN</span></div>
            <div><strong>{remainingCount}</strong><span>KALAN</span></div>
          </div>
          <div className="divider" />
          <div className="tip-card"><span>NASIL OYNANIR?</span><p>Parçayı doğru yerine yakın bırakman yeterli; otomatik olarak yerine oturur.</p></div>
          {!room && <button className="primary-button full create-main" onClick={() => setDialog("create")}>FOTOĞRAFINLA BAŞLA <span>→</span></button>}
        </aside>
      </section>

      <div className="notice" role="status"><span>i</span>{notice}</div>

      <footer><span>PARÇA / 2026</span><p>Uzakta olsanız da aynı masadasınız.</p><span>MADE FOR TOGETHERNESS</span></footer>

      {dialog && (
        <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setDialog(null)}>
          <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
            <button className="close-button" onClick={() => setDialog(null)} aria-label="Pencereyi kapat">×</button>
            {dialog === "create" ? (
              <>
                <p className="eyebrow">YENİ BİR ANIYI PARÇALA</p>
                <h2 id="dialog-title">Puzzle odanı kur</h2>
                <label className="field"><span>Puzzle adı</span><input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={48} /></label>
                <label className="upload-field">
                  {imageUrl ? <img src={imageUrl} alt="Seçilen puzzle ön izlemesi" /> : <span className="upload-icon">＋</span>}
                  <div><b>{file ? file.name : "Fotoğrafını ekle"}</b><small>JPG, PNG veya WEBP · en fazla 8 MB</small></div>
                  <input type="file" accept="image/jpeg,image/png,image/webp" onChange={onFile} />
                </label>
                <fieldset><legend>Zorluk</legend><div className="difficulty-options">
                  <button className={difficulty === "12" ? "selected" : ""} onClick={() => setDifficulty("12")}><b>12</b><span>RAHAT</span></button>
                  <button className={difficulty === "20" ? "selected" : ""} onClick={() => setDifficulty("20")}><b>20</b><span>MEYDAN OKU</span></button>
                </div></fieldset>
                <button className="primary-button full dialog-submit" onClick={createRoom} disabled={busy}>{busy ? "ODA HAZIRLANIYOR…" : "ODAYI OLUŞTUR →"}</button>
              </>
            ) : (
              <>
                <p className="eyebrow">ARKADAŞLARIN SENİ BEKLİYOR</p>
                <h2 id="dialog-title">Kodu gir, parçanı koy</h2>
                <p className="dialog-copy">Sana gönderilen 6 karakterlik oda kodunu aşağıya yaz.</p>
                <input className="code-input" autoFocus value={codeInput} onChange={(e) => setCodeInput(formatCode(e.target.value))} placeholder="A7K2P9" onKeyDown={(e) => e.key === "Enter" && joinRoom()} />
                <button className="primary-button full dialog-submit" onClick={joinRoom} disabled={busy}>{busy ? "BAĞLANIYOR…" : "ODAYA KATIL →"}</button>
              </>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
