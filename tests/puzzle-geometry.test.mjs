import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const pageSourcePromise = readFile(new URL("app/page.tsx", root), "utf8");

const puzzleSizes = [
  { count: 12, rows: 3, cols: 4, label: "RAHAT" },
  { count: 20, rows: 4, cols: 5, label: "KOLAY" },
  { count: 48, rows: 6, cols: 8, label: "ORTA" },
  { count: 120, rows: 10, cols: 12, label: "ZOR" },
  { count: 300, rows: 15, cols: 20, label: "UZMAN" },
  { count: 600, rows: 20, cols: 30, label: "USTA" },
  { count: 1024, rows: 32, cols: 32, label: "EFSANE" },
];

function extractFunction(source, name) {
  const declarationStart = source.indexOf(`function ${name}(`);
  assert.notEqual(declarationStart, -1, `${name} must remain available as a layout helper`);
  const bodyStart = source.indexOf("{", declarationStart);
  assert.notEqual(bodyStart, -1, `${name} must have a function body`);

  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(declarationStart, index + 1);
    }
  }
  assert.fail(`${name} has an unterminated function body`);
}

function replaceTypedSignature(source, name, parameters) {
  return source.replace(
    new RegExp(`function\\s+${name}\\s*\\([^)]*\\)`),
    `function ${name}(${parameters.join(", ")})`,
  );
}

function readArithmeticConstant(source, name) {
  const match = source.match(new RegExp(`const\\s+${name}\\s*=\\s*([^;]+);`));
  assert.ok(match, `${name} must be declared`);
  assert.match(match[1], /^[\d\s./()+-]+$/, `${name} must stay a numeric expression`);
  return Function(`"use strict"; return (${match[1]});`)();
}

function compileInlineLayoutHelpers(source) {
  const defaultAspect = readArithmeticConstant(source, "DEFAULT_IMAGE_ASPECT");
  const layoutVersion = readArithmeticConstant(source, "PUZZLE_LAYOUT_VERSION");
  const helperSpecs = [
    ["fitPuzzleSize", ["size", "aspect"]],
    ["pieceBoardTarget", ["id", "rows", "cols"]],
    ["pieceRailPositions", ["rows", "cols", "seed", "board", "mode"]],
    ["sidePiecePositions", ["rows", "cols", "seed"]],
    ["bandPiecePositions", ["rows", "cols", "seed"]],
    ["landscapePiecePositions", ["rows", "cols", "seed"]],
    ["scatteredPieces", ["rows", "cols", "_seed"]],
    ["normalizePieceLayout", ["pieces", "rows", "cols", "seed"]],
    ["isWithinDropBounds", ["clientX", "clientY", "bounds", "toleranceX", "toleranceY"]],
  ];
  const helpers = helperSpecs.map(([name, parameters]) => replaceTypedSignature(
    extractFunction(source, name),
    name,
    parameters,
  )
    .replace(/\s+as const\b/g, "")
    .replace(/const shuffle = <T,>\(values: T\[\]\) =>/, "const shuffle = (values) =>")
    .replace(/: PieceRailPosition\[\]/g, "")
    .replace(/new Map<number, PieceRailPosition>\(\)/g, "new Map()"));

  const factory = Function(`
    "use strict";
    const DEFAULT_IMAGE_ASPECT = ${JSON.stringify(defaultAspect)};
    const PUZZLE_LAYOUT_VERSION = ${JSON.stringify(layoutVersion)};
    const BOARD = { left: 0.19, top: 0.12, width: 0.62, height: 0.76 };
    const MOBILE_HORIZONTAL_BOARD = { left: 0.06, top: 0.26, width: 0.88, height: 0.48 };
    const MOBILE_LANDSCAPE_BOARD = { left: 0.14, top: 0.04, width: 0.72, height: 0.92 };
    ${helpers.join("\n")}
    return { fitPuzzleSize, pieceBoardTarget, sidePiecePositions, bandPiecePositions, landscapePiecePositions, scatteredPieces, normalizePieceLayout, isWithinDropBounds };
  `);
  return { ...factory(), defaultAspect, layoutVersion };
}

const helpersPromise = pageSourcePromise.then(compileInlineLayoutHelpers);

test("board drops stay stable on exact and near pixel boundaries", async () => {
  const { isWithinDropBounds } = await helpersPromise;
  const bounds = { left: 100.5, right: 500.5, top: 80.25, bottom: 380.25 };

  assert.equal(isWithinDropBounds(100.5, 80.25, bounds, 8, 8), true);
  assert.equal(isWithinDropBounds(94, 386, bounds, 8, 8), true);
  assert.equal(isWithinDropBounds(91, 389, bounds, 8, 8), false);
});

test("fitPuzzleSize chooses stable portrait, square, and landscape grids", async () => {
  const { fitPuzzleSize } = await helpersPromise;
  const cases = [
    {
      label: "9:16",
      aspect: 9 / 16,
      expected: [[4, 3], [6, 3], [10, 5], [15, 8], [23, 13], [33, 18], [43, 24]],
    },
    {
      label: "3:4",
      aspect: 3 / 4,
      expected: [[4, 3], [5, 4], [8, 6], [12, 10], [20, 15], [30, 20], [38, 27]],
    },
    {
      label: "1:1",
      aspect: 1,
      expected: [[3, 4], [4, 5], [7, 7], [11, 11], [17, 18], [24, 25], [32, 32]],
    },
    {
      label: "16:9",
      aspect: 16 / 9,
      expected: [[3, 4], [3, 6], [5, 10], [8, 15], [13, 23], [18, 33], [24, 43]],
    },
  ];

  for (const { label, aspect, expected } of cases) {
    puzzleSizes.forEach((size, index) => {
      const result = fitPuzzleSize(size, aspect);
      assert.deepEqual(
        [result.rows, result.cols],
        expected[index],
        `${label} / target ${size.count} must keep its reviewed grid`,
      );
      assert.equal(result.count, result.rows * result.cols);
      assert.ok(result.rows >= 2 && result.rows <= 48);
      assert.ok(result.cols >= 2 && result.cols <= 48);
      if (aspect < 1) assert.ok(result.rows >= result.cols, `${label} must favor rows`);
      if (aspect > 1) assert.ok(result.cols >= result.rows, `${label} must favor columns`);
    });
  }
});

test("portrait and landscape grid fitting remains transpose-symmetric", async () => {
  const { fitPuzzleSize } = await helpersPromise;
  for (const size of puzzleSizes) {
    const portrait = fitPuzzleSize(size, 9 / 16);
    const landscape = fitPuzzleSize(size, 16 / 9);
    assert.equal(portrait.rows, landscape.cols, `row/column transpose for ${size.count}`);
    assert.equal(portrait.cols, landscape.rows, `column/row transpose for ${size.count}`);
    assert.equal(portrait.count, landscape.count, `piece count symmetry for ${size.count}`);
  }
});

test("invalid image ratios consistently fall back to the default aspect", async () => {
  const { fitPuzzleSize, defaultAspect } = await helpersPromise;
  for (const size of puzzleSizes) {
    const fallback = fitPuzzleSize(size, defaultAspect);
    for (const invalidAspect of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.deepEqual(fitPuzzleSize(size, invalidAspect), fallback);
    }
  }
});

test("contained board sizing preserves every supported image aspect", async () => {
  const source = await pageSourcePromise;
  assert.match(source, /const width = Math\.min\(rect\.width, rect\.height \* imageAspect\);/);
  assert.match(source, /const height = width \/ imageAspect;/);
  assert.match(source, /style=\{boardStyle\}/);

  const containBoard = (areaWidth, areaHeight, imageAspect) => {
    const width = Math.min(areaWidth, areaHeight * imageAspect);
    return { width, height: width / imageAspect };
  };
  const areas = [[378, 534], [964, 620], [240, 900], [1200, 220]];
  const aspects = [9 / 16, 3 / 4, 1, 16 / 9];

  for (const [areaWidth, areaHeight] of areas) {
    for (const aspect of aspects) {
      const board = containBoard(areaWidth, areaHeight, aspect);
      assert.ok(board.width <= areaWidth + Number.EPSILON);
      assert.ok(board.height <= areaHeight + Number.EPSILON);
      assert.ok(Math.abs(board.width / board.height - aspect) < 1e-12);
    }
  }
});

test("side and mobile band workspaces preserve board and piece ratios", () => {
  const boards = [
    { left: 0.19, top: 0.12, width: 0.62, height: 0.76 },
    { left: 0.06, top: 0.26, width: 0.88, height: 0.48 },
    { left: 0.14, top: 0.04, width: 0.72, height: 0.92 },
  ];
  for (const imageAspect of [1 / 5, 9 / 16, 3 / 4, 1, 16 / 9, 5]) {
    for (const board of boards) {
      const workspaceAspect = imageAspect * board.height / board.width;
      const physicalBoardWidth = workspaceAspect * board.width;
      const physicalBoardHeight = board.height;
      assert.ok(Math.abs(physicalBoardWidth / physicalBoardHeight - imageAspect) < 1e-12);
      assert.ok(board.left > 0 && board.left + board.width < 1);
      assert.ok(board.top > 0 && board.top + board.height < 1);
      for (const { rows, cols } of puzzleSizes) {
        const cellAspect = workspaceAspect * (board.width / cols) / (board.height / rows);
        assert.ok(Math.abs(cellAspect - imageAspect * rows / cols) < 1e-12);
      }
    }
  }
});

test("side and mobile band projections are deterministic and bounded", async () => {
  const { bandPiecePositions, fitPuzzleSize, landscapePiecePositions, sidePiecePositions } = await helpersPromise;
  const modes = [
    {
      name: "side",
      board: { left: 0.19, top: 0.12, width: 0.62, height: 0.76 },
      positions: sidePiecePositions,
      outside: (x, y, cellWidth) => x + cellWidth / 2 < 0.19 || x + cellWidth / 2 > 0.81,
    },
    {
      name: "band",
      board: { left: 0.06, top: 0.26, width: 0.88, height: 0.48 },
      positions: bandPiecePositions,
      outside: (x, y, cellWidth, cellHeight) => y + cellHeight / 2 < 0.26 || y + cellHeight / 2 > 0.74,
    },
    {
      name: "landscape",
      board: { left: 0.14, top: 0.04, width: 0.72, height: 0.92 },
      positions: landscapePiecePositions,
      outside: (x, y, cellWidth) => cellWidth * 0.9 + 0.005 >= 0.14
        || x + cellWidth / 2 < 0.14 || x + cellWidth / 2 > 0.86,
      before: (x) => x < 0.5,
    },
  ];
  for (const mode of modes) {
    for (const imageAspect of [1 / 5, 9 / 16, 3 / 4, 1, 16 / 9, 5]) {
      for (const size of puzzleSizes) {
        const { rows, cols, count } = fitPuzzleSize(size, imageAspect);
        const first = mode.positions(rows, cols, "ROOM42");
        const second = mode.positions(rows, cols, "ROOM42");
        const cellWidth = mode.board.width / cols;
        const cellHeight = mode.board.height / rows;
        let firstRailCount = 0;
        let secondRailCount = 0;
        assert.equal(first.size, count);
        assert.deepEqual([...first], [...second]);
        for (const [id, position] of first) {
          assert.ok(id >= 0 && id < count);
          assert.ok(Number.isFinite(position.x) && Number.isFinite(position.y));
          assert.ok(position.x >= 0.005 && position.x + cellWidth <= 0.991);
          assert.ok(position.y >= 0.005 && position.y + cellHeight <= 0.991);
          assert.ok(
            mode.outside(position.x, position.y, cellWidth, cellHeight),
            `${mode.name} piece ${id} for ${rows}x${cols} must stay outside the board`,
          );
          const before = mode.before
            ? mode.before(position.x, position.y, cellWidth, cellHeight)
            : mode.name === "side"
              ? position.x + cellWidth / 2 < mode.board.left
              : position.y + cellHeight / 2 < mode.board.top;
          if (before) firstRailCount += 1;
          else secondRailCount += 1;
        }
        assert.ok(firstRailCount > 0, `${mode.name} layout must use its first rail`);
        assert.ok(secondRailCount > 0, `${mode.name} layout must use its second rail`);
      }
    }
  }
});

test("piece targets stay inside the normalized board for all reviewed grids", async () => {
  const { fitPuzzleSize, pieceBoardTarget } = await helpersPromise;
  for (const aspect of [9 / 16, 3 / 4, 1, 16 / 9]) {
    for (const size of puzzleSizes) {
      const { rows, cols, count } = fitPuzzleSize(size, aspect);
      for (let id = 0; id < count; id += 1) {
        const target = pieceBoardTarget(id, rows, cols);
        assert.ok(target.x >= 0 && target.x <= 1 - 1 / cols);
        assert.ok(target.y >= 0 && target.y <= 1 - 1 / rows);
        assert.equal(target.x, (id % cols) / cols);
        assert.equal(target.y, Math.floor(id / cols) / rows);
      }
    }
  }
});

test("piece normalization enforces board bounds and board/mat zones", async () => {
  const { layoutVersion, normalizePieceLayout, pieceBoardTarget, scatteredPieces } = await helpersPromise;
  const rows = 4;
  const cols = 3;
  const maxX = 1 - 1 / cols;
  const maxY = 1 - 1 / rows;
  const validBoardPiece = {
    id: 5,
    x: maxX,
    y: maxY,
    zone: "board",
    locked: false,
    layoutVersion,
  };

  assert.deepEqual(normalizePieceLayout([validBoardPiece], rows, cols, "ROOM")[0], validBoardPiece);
  const positionedMatPiece = {
    id: 5,
    x: 0.4,
    y: 0.5,
    zone: "mat",
    positioned: true,
    locked: false,
    layoutVersion,
  };
  assert.deepEqual(normalizePieceLayout([positionedMatPiece], rows, cols, "ROOM")[0], positionedMatPiece);

  for (const invalidPiece of [
    { ...validBoardPiece, x: -0.01 },
    { ...validBoardPiece, x: maxX + 0.01 },
    { ...validBoardPiece, y: -0.01 },
    { ...validBoardPiece, y: maxY + 0.01 },
    { ...validBoardPiece, x: Number.NaN },
    { ...validBoardPiece, y: Number.POSITIVE_INFINITY },
    { ...validBoardPiece, zone: "mat" },
    { ...validBoardPiece, layoutVersion: layoutVersion - 1 },
  ]) {
    const normalized = normalizePieceLayout([invalidPiece], rows, cols, "ROOM")[0];
    assert.deepEqual(normalized, {
      id: 5,
      x: 0,
      y: 0,
      zone: "mat",
      locked: false,
      layoutVersion,
    });
  }

  const locked = normalizePieceLayout([{
    id: 999,
    x: Number.NaN,
    y: Number.NEGATIVE_INFINITY,
    zone: "mat",
    locked: true,
    layoutVersion: 1,
  }], rows, cols, "ROOM")[0];
  assert.deepEqual(locked, {
    id: rows * cols - 1,
    ...pieceBoardTarget(rows * cols - 1, rows, cols),
    zone: "board",
    locked: true,
    layoutVersion,
  });

  const initial = scatteredPieces(rows, cols, "ROOM");
  assert.equal(initial.length, rows * cols);
  assert.deepEqual(initial.map(({ id, x, y, zone, locked, layoutVersion: version }) => ({
    id, x, y, zone, locked, layoutVersion: version,
  })), Array.from({ length: rows * cols }, (_, id) => ({
    id,
    x: 0,
    y: 0,
    zone: "mat",
    locked: false,
    layoutVersion,
  })));
});

test("the rendered puzzle switches horizontal mobile images to top and bottom rails", async () => {
  const source = await pageSourcePromise;
  assert.match(source, /const BOARD = \{ left: 0\.19, top: 0\.12, width: 0\.62, height: 0\.76 \} as const/);
  assert.match(source, /const MOBILE_HORIZONTAL_BOARD = \{ left: 0\.06, top: 0\.26, width: 0\.88, height: 0\.48 \} as const/);
  assert.match(source, /const MOBILE_LANDSCAPE_BOARD = \{ left: 0\.14, top: 0\.04, width: 0\.72, height: 0\.92 \} as const/);
  assert.match(source, /const sideWorkspaceAspect = imageAspect \* BOARD\.height \/ BOARD\.width/);
  assert.match(source, /const bandWorkspaceAspect = imageAspect \* MOBILE_HORIZONTAL_BOARD\.height \/ MOBILE_HORIZONTAL_BOARD\.width/);
  assert.match(source, /const landscapeWorkspaceAspect = imageAspect \* MOBILE_LANDSCAPE_BOARD\.height \/ MOBILE_LANDSCAPE_BOARD\.width/);
  assert.match(source, /function pieceRailPositions/);
  assert.match(source, /function sidePiecePositions/);
  assert.match(source, /function bandPiecePositions/);
  assert.match(source, /function landscapePiecePositions/);
  assert.doesNotMatch(source, /MAX_VISIBLE_LOOSE_PIECES|visibleLoosePieces/);
  assert.match(source, /\{loosePieces\.map\(\(piece\) =>/);
  assert.match(source, /imageAspect > 1 \? "horizontal-puzzle" : ""/);
  assert.match(source, /piece\.zone === "board" \|\| piece\.locked/);
  assert.match(source, /!piece\.locked && piece\.zone !== "board"/);
  assert.match(source, /!piece\.locked && piece\.zone === "board"/);
  assert.match(source, /zone: droppedOnBoard \? "board" as const : "mat" as const/);
  assert.match(source, /positioned: droppedOnBoard \? undefined : \(true as const\)/);
  assert.match(source, /const workspaceRect = workspaceRef\.current\?\.getBoundingClientRect\(\)/);
  assert.match(source, /onPointerCancel=\{cancelMove\}/);
  assert.match(source, /onLostPointerCapture=/);
  assert.match(source, /classList\.add\("drag-active"\)/);
  assert.match(source, /classList\.remove\("drag-active"\)/);
  assert.match(source, /new ResizeObserver\(updateSize\)/);
  assert.match(source, /observer\.observe\(area\)/);
  assert.doesNotMatch(source, /boardZoom|zoom-controls|Yakınlaştır|Uzaklaştır/);
});

test("every large puzzle tier uses the immediate dense rendering path", async () => {
  const source = await pageSourcePromise;
  const threshold = readArithmeticConstant(source, "LARGE_PUZZLE_THRESHOLD");
  assert.equal(threshold, 120);
  assert.deepEqual(puzzleSizes.filter(({ count }) => count >= threshold).map(({ count }) => count), [120, 300, 600, 1024]);
  assert.match(source, /pieceCount >= LARGE_PUZZLE_THRESHOLD/);
  assert.match(source, /rows \* cols >= LARGE_PUZZLE_THRESHOLD \? 1 : 2/);
  assert.doesNotMatch(source, /pieceCount > 120|rows \* cols > 120/);
});
