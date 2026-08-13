import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function read(relativePath) {
  return readFile(new URL(relativePath, root), "utf8");
}

test("contains the puzzle app entry points", async () => {
  const [page, layout, styles, packageJson] = await Promise.all([
    read("app/page.tsx"),
    read("app/layout.tsx"),
    read("app/globals.css"),
    read("package.json"),
  ]);

  assert.match(page, /export default function Home/);
  assert.match(page, /JigsawPiece/);
  assert.match(page, /GALERİYE GEÇ/);
  assert.match(page, /type PieceZone = "board" \| "mat"/);
  assert.match(page, /function sidePiecePositions/);
  assert.match(page, /function bandPiecePositions/);
  assert.doesNotMatch(page, /MAX_VISIBLE_LOOSE_PIECES|visibleLoosePieces/);
  assert.match(page, /\{loosePieces\.map\(\(piece\) =>/);
  assert.match(page, /"horizontal-puzzle"/);
  assert.match(page, /"side-piece"/);
  assert.match(page, /KENARA İT/);
  assert.doesNotMatch(page, /CANLI OYUN|live-dot/);
  assert.doesNotMatch(styles, /\.live-dot/);
  assert.doesNotMatch(page, /boardZoom|zoom-controls|Yakınlaştır|Uzaklaştır/);
  assert.doesNotMatch(styles, /\.zoom-controls|\.puzzle-board-area\.zoomed/);
  assert.doesNotMatch(page, /className="piece-mat"/);
  assert.doesNotMatch(page, /MATA TOPLA/);
  assert.match(page, /className="code-stamp">6</);
  assert.match(page, /6 karakterlik oda kodunu/);
  assert.match(page, /layoutVersion/);
  assert.match(styles, /\.puzzle-piece\.side-piece/);
  assert.match(styles, /\.puzzle-workspace\s*\{[^}]*width:100%;[^}]*height:calc\(100% - 10px\);[^}]*align-self:end/);
  assert.match(styles, /\.board-section\s*\{[^}]*padding:0 18px 10px/);
  assert.match(styles, /\.puzzle-board-area\s*\{[^}]*--desktop-board-left[^}]*--desktop-board-top[^}]*--desktop-board-width[^}]*--desktop-board-height/);
  assert.match(styles, /@media \(max-width:760px\) and \(orientation:portrait\)/);
  assert.match(styles, /\.puzzle-workspace\.horizontal-puzzle\s*\{[^}]*aspect-ratio:var\(--band-workspace-aspect\)/);
  assert.match(styles, /\.puzzle-workspace\.horizontal-puzzle \.puzzle-board-area\s*\{[^}]*--band-board-left,6%[^}]*--band-board-top,26%[^}]*--band-board-width,88%[^}]*--band-board-height,48%/);
  assert.match(styles, /\.puzzle-workspace\.horizontal-puzzle \.puzzle-piece\.side-piece\s*\{[^}]*--band-piece-width/);
  assert.doesNotMatch(styles, /\.piece-mat/);
  assert.match(layout, /generateMetadata|metadata/i);
  assert.match(packageJson, /\"build:vercel\"/);
});

test("the puzzle surface disables text selection and the context menu", async () => {
  const [page, styles] = await Promise.all([read("app/page.tsx"), read("app/globals.css")]);
  const bodyRule = styles.match(/body\s*\{[^}]*\}/)?.[0] || "";

  assert.match(bodyRule, /-webkit-user-select:none/);
  assert.match(bodyRule, /user-select:none/);
  assert.match(page, /onContextMenu=\{\(event\) => event\.preventDefault\(\)\}/);
});

test("pointer release commits a piece without replaying its movement", async () => {
  const [page, styles] = await Promise.all([
    read("app/page.tsx"),
    read("app/globals.css"),
  ]);
  const pieceRule = styles.match(/\.puzzle-piece\s*\{[^}]*\}/)?.[0] || "";
  assert.doesNotMatch(
    pieceRule,
    /transition\s*:[^;}]*(?:\bleft\b|\btop\b)/,
    "piece coordinates must not animate after pointer release",
  );

  const start = page.indexOf("const endMove = useCallback");
  const end = page.indexOf("\n  useEffect", start);
  assert.ok(start >= 0 && end > start, "endMove must remain inspectable");
  const endMove = page.slice(start, end);
  assert.match(endMove, /event: PointerEvent<HTMLDivElement>/);
  assert.match(endMove, /drag\.clientX = event\.clientX/);
  assert.match(endMove, /drag\.clientY = event\.clientY/);
  assert.match(endMove, /const matX = workspaceRect/);
  assert.match(endMove, /const matY = workspaceRect/);
  assert.match(endMove, /isWithinDropBounds/);
  assert.match(endMove, /drag\.width \/ 2/);
  assert.match(endMove, /drag\.height \/ 2/);
  assert.doesNotMatch(endMove, /dropTolerance|drag\.width \* 0\.2|drag\.height \* 0\.2/);
  assert.match(endMove, /positioned: droppedOnBoard \? undefined : \(true as const\)/);
  assert.ok(
    endMove.indexOf("getBoundingClientRect()") < endMove.indexOf('setAttribute("style", drag.originalStyle)'),
    "drop geometry must be measured before restoring the pre-drag style",
  );
  assert.match(endMove, /setPieces\(next\)/);
  assert.match(endMove, /sendLiveDragMessage\(drag, liveEndMessage\)/);
  assert.match(endMove, /pushMove\(next, movingId\)/);
  assert.ok(
    endMove.indexOf("sendDrag(liveEndMessage)") < endMove.indexOf("pushMove(next, movingId)"),
    "the visual snap must be broadcast before the persistence round trip",
  );
  assert.doesNotMatch(endMove, /pushMove\(next, movingId\)\.finally/);
});

test("dragged pieces stay above the board without lifting the whole board layer", async () => {
  const [page, styles] = await Promise.all([read("app/page.tsx"), read("app/globals.css")]);

  assert.doesNotMatch(page, /hasRecentBoardPiece|recent-piece-area/);
  assert.doesNotMatch(styles, /\.puzzle-board-area\.recent-piece-area/);
  assert.match(styles, /\.puzzle-board-area\.drag-active\s*\{[^}]*z-index:50/);
  assert.match(styles, /\.puzzle-piece\.recent\s*\{[^}]*z-index:45/);
  assert.match(styles, /\.puzzle-piece\.dragging\s*\{[^}]*z-index:1000/);
});

test("a piece moved onto the board paints before the handoff frame", async () => {
  const [page, styles] = await Promise.all([read("app/page.tsx"), read("app/globals.css")]);
  const start = page.indexOf("const JigsawPiece = memo");
  const end = page.indexOf("\n\nconst LockedPiecesCanvas", start);
  assert.ok(start >= 0 && end > start, "JigsawPiece must remain inspectable");
  const component = page.slice(start, end);

  assert.match(component, /useState\(eager\)/);
  assert.match(component, /useLayoutEffect\(\(\) =>/);
  assert.ok(
    component.indexOf("useLayoutEffect") > component.indexOf("return observePuzzlePiece"),
    "the canvas draw, not the visibility observer, must run before paint",
  );
  assert.match(component, /if \(eager\) drawPiece\(\)/);
  assert.match(page, /const LARGE_PUZZLE_THRESHOLD = 120/);
  assert.match(page, /imageUrl=\{imageUrl\} eager=\{pieceCount >= LARGE_PUZZLE_THRESHOLD \|\| isRecent \|\| isRemoteHeld\}/);
  assert.match(component, /rows \* cols >= LARGE_PUZZLE_THRESHOLD \? 1 : 2/);
  assert.doesNotMatch(page, /pieceCount > 120|rows \* cols > 120/);
  assert.match(component, /if \(eager\) return;[\s\S]*observePuzzlePiece/);
  assert.match(page, /drag\.phase === "end" \? "remote-drop-handoff"/);
  assert.match(page, /message\.dropZone === "mat" && message\.dropX !== undefined && message\.dropY !== undefined/);
  assert.match(page, /drag\.dropZone === "mat" \? "remote-mat-handoff"/);
  assert.match(page, /liveEndMessage\.x = finalBoardX \+ 1 \/ \(2 \* cols\)/);
  assert.match(page, /liveEndMessage\.y = finalBoardY \+ 1 \/ \(2 \* rows\)/);
  assert.match(page, /liveEndMessage\.dropX = droppedOnBoard \? finalBoardX : matX/);
  assert.match(page, /liveEndMessage\.dropY = droppedOnBoard \? finalBoardY : matY/);
  const remoteRule = styles.match(/\.puzzle-piece\.remote-drag-piece\s*\{[^}]*\}/)?.[0] || "";
  const remoteHeldRule = styles.match(/\.puzzle-piece\.remote-held:not\(\.dragging\)\s*\{[^}]*\}/)?.[0] || "";
  assert.match(remoteRule, /will-change:transform/);
  assert.doesNotMatch(remoteRule, /transition:[^;}]*(?:left|top)/);
  assert.match(remoteHeldRule, /opacity:0/);
  assert.match(remoteHeldRule, /pointer-events:none/);
  assert.match(remoteRule, /var\(--player-color/);
  assert.doesNotMatch(styles, /\.piece-player-label|\.local-piece-player-label/);
  assert.doesNotMatch(page, /className="piece-player-label"/);
  assert.match(page, /const puzzlePieceCanvasCache = new Map<string, HTMLCanvasElement>\(\)/);
  assert.match(page, /restorePuzzlePieceCanvas\(canvasKey, canvas\)/);
  assert.match(page, /rememberPuzzlePieceCanvas\(canvasKey, canvas\)/);
});

test("pushing pieces to the edge updates immediately and persists in the background", async () => {
  const page = await read("app/page.tsx");
  const start = page.indexOf("const pushToSides = useCallback");
  const end = page.indexOf("\n\n  const downloadCompletedImage", start);
  assert.ok(start >= 0 && end > start, "pushToSides must remain inspectable");
  const pushToSides = page.slice(start, end);
  assert.ok(pushToSides.indexOf("setPieces(next)") < pushToSides.indexOf("pushPieces(next)"));
  assert.ok(pushToSides.indexOf("sendAction(message)") < pushToSides.indexOf("pushPieces(next)"));
  assert.match(pushToSides, /if \(room\) \{[\s\S]*void pushPieces\(next\)/);
});

test("side panels yield before the puzzle map becomes unusable", async () => {
  const [styles, page] = await Promise.all([read("app/globals.css"), read("app/page.tsx")]);
  const hideRoom = styles.match(/@media \(max-width:1180px\)\s*\{[\s\S]*?(?=\n@media|$)/)?.[0] || "";
  const hideBoth = styles.match(/@media \(max-width:900px\)\s*\{[\s\S]*?(?=\n@media|$)/)?.[0] || "";
  const shortLandscape = styles.match(/@media \(max-height:640px\) and \(orientation:landscape\)\s*\{[\s\S]*?(?=\n@media|$)/)?.[0] || "";
  const phone = styles.match(/@media \(max-width:760px\)\s*\{[\s\S]*?(?=\n@media|$)/)?.[0] || "";
  const phoneLandscape = styles.match(/@media \(max-width:1024px\) and \(orientation:landscape\), \(orientation:landscape\) and \(hover:none\) and \(pointer:coarse\)\s*\{[\s\S]*?(?=\n@media|$)/)?.[0] || "";

  assert.match(hideRoom, /\.room-panel\s*\{\s*display:none/);
  assert.match(hideRoom, /grid-template-columns:minmax\(0,1fr\) 210px/);
  assert.match(hideBoth, /\.progress-panel\s*\{\s*display:none/);
  assert.match(hideBoth, /grid-template-columns:minmax\(0,1fr\)/);
  assert.match(shortLandscape, /\.room-panel,\s*\.progress-panel\s*\{\s*display:none/);
  assert.match(shortLandscape, /footer\s*\{\s*display:none/);
  assert.match(phone, /\.site-shell\.puzzle-active \.board-section\s*\{[^}]*padding:0 0 10px[^}]*grid-template-rows:44px minmax\(0,1fr\)/);
  assert.match(phone, /\.site-shell\.puzzle-active \.puzzle-workspace\s*\{[^}]*width:100%;[^}]*height:calc\(100% - 10px\);[^}]*aspect-ratio:auto/);
  assert.match(phone, /\.site-shell\.puzzle-active \.mobile-room-actions\s*\{[^}]*display:none/);
  assert.match(page, /site-shell \$\{galleryVisible \? "gallery-active" : "puzzle-active"\}/);
  assert.doesNotMatch(page, /className="header-copy"|className="header-slogan"|className=\{`hero-strip/);
  assert.match(page, /<b>ORTAK MASA<\/b><small>AYNI KOD, AYNI PUZZLE<\/small>/);
  assert.match(page, /className="room-puzzle-title"/);
  assert.match(page, /<b>\{room\?\.title \|\| title\.trim\(\) \|\| "Puzzle ön izlemesi"\}<\/b>/);
  assert.match(styles, /\.room-puzzle-title\s*\{[^}]*border-bottom:2px solid var\(--ink\)/);
  assert.doesNotMatch(page, /Aynı oda kodundaki herkes bu tahtayı canlı olarak paylaşır/);
  assert.match(styles, /\.site-shell\s*\{[^}]*grid-template-rows:52px minmax\(0,1fr\) 34px/);
  assert.match(phoneLandscape, /\.site-shell\.puzzle-active>\.topbar/);
  assert.match(phoneLandscape, /\.site-shell\.puzzle-active \.board-toolbar/);
  assert.doesNotMatch(page, /className="notice"/);
  assert.match(page, /<div className="toolbar-notice" role="status">\{notice\}<\/div>/);
  assert.match(styles, /\.toolbar-notice\s*\{[^}]*border:0;[^}]*background:transparent;[^}]*text-overflow:ellipsis/);
  assert.doesNotMatch(styles, /\.toolbar-notice (?:span|p)/);
  assert.match(phoneLandscape, /\.site-shell\.puzzle-active>footer/);
  assert.match(phoneLandscape, /\.site-shell\.puzzle-active \.mobile-room-actions/);
  assert.match(phoneLandscape, /grid-template-rows:minmax\(0,1fr\)/);
  assert.match(phoneLandscape, /\.puzzle-workspace\s*\{[^}]*width:100%;[^}]*height:100%;[^}]*max-width:none;[^}]*max-height:none;[^}]*aspect-ratio:auto/);
  assert.doesNotMatch(phoneLandscape, /landscape-workspace-aspect/);
  assert.match(phoneLandscape, /\.puzzle-board-area\s*\{[^}]*--landscape-board-left,14%[^}]*--landscape-board-top,4%[^}]*--landscape-board-width,72%[^}]*--landscape-board-height,92%/);
  assert.match(phoneLandscape, /\.puzzle-piece\.side-piece\s*\{[^}]*--landscape-piece-width/);
  assert.match(page, /const sideX = piece\.positioned \? piece\.x/);
});

test("exposes the production API routes", async () => {
  await Promise.all([
    access(new URL("app/api/room/route.ts", root)),
    access(new URL("app/api/gallery/route.ts", root)),
    access(new URL("app/api/cron/cleanup/route.ts", root)),
    access(new URL("supabase/schema.sql", root)),
  ]);

  const schema = await read("supabase/schema.sql");
  assert.match(schema, /create table if not exists public\.puzzle_rooms/i);
  assert.match(schema, /puzzle_rooms_updated_at_idx/);
});
