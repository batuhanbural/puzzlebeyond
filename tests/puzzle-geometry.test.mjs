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
    ["fitBoardFrame", ["imageAspect", "workspaceAspect"]],
    ["fitRailBoardFrame", ["board", "rows", "cols", "mode"]],
    ["railModeForFrame", ["board", "pieceCount"]],
    ["pieceBoardTarget", ["id", "rows", "cols"]],
    ["boardGridPath", ["rows", "cols"]],
    ["pieceRailPositions", ["rows", "cols", "seed", "board", "mode"]],
    ["sidePiecePositions", ["rows", "cols", "seed", "board"]],
    ["bandPiecePositions", ["rows", "cols", "seed", "board"]],
    ["landscapePiecePositions", ["rows", "cols", "seed", "board", "mode"]],
    ["redistributePiecePositions", ["pieceIds", "layout"]],
    ["scatteredPieces", ["rows", "cols", "_seed"]],
    ["normalizePieceLayout", ["pieces", "rows", "cols", "seed"]],
    ["isWithinDropBounds", ["clientX", "clientY", "bounds", "insetX = 0", "insetY = 0"]],
  ];
  const helpers = helperSpecs.map(([name, parameters]) => replaceTypedSignature(
    extractFunction(source, name),
    name,
    parameters,
  )
    .replace(/\s+as const\b/g, "")
    .replace(/const shuffle = <T,>\(values: T\[\]\) =>/, "const shuffle = (values) =>")
    .replace(/const axisPositions = \(cellSize: number, step: number\) =>/, "const axisPositions = (cellSize, step) =>")
    .replace(/const randomBetween = \(minimum: number, maximum: number\) =>/, "const randomBetween = (minimum, maximum) =>")
    .replace(/const values: number\[\]/g, "const values")
    .replace(/const commands: string\[\]/g, "const commands")
    .replace(/\)\s*:\s*BoardFrame\s*\{/, ") {")
    .replace(/\)\s*:\s*PieceRailMode\s*\{/, ") {")
    .replace(/: PieceRailPosition\[\]/g, "")
    .replace(/: PieceRailPosition\[\]\[\]/g, "")
    .replace(/new Map<number, PieceRailPosition>\(\)/g, "new Map()"));

  const factory = Function(`
    "use strict";
    const DEFAULT_IMAGE_ASPECT = ${JSON.stringify(defaultAspect)};
    const PUZZLE_LAYOUT_VERSION = ${JSON.stringify(layoutVersion)};
    const BOARD = { left: 0.19, top: 0.12, width: 0.62, height: 0.76 };
    const MOBILE_HORIZONTAL_BOARD = { left: 0.06, top: 0.26, width: 0.88, height: 0.48 };
    ${helpers.join("\n")}
    return { fitPuzzleSize, fitBoardFrame, fitRailBoardFrame, railModeForFrame, pieceBoardTarget, boardGridPath, sidePiecePositions, bandPiecePositions, landscapePiecePositions, redistributePiecePositions, scatteredPieces, normalizePieceLayout, isWithinDropBounds };
  `);
  return { ...factory(), defaultAspect, layoutVersion };
}

const helpersPromise = pageSourcePromise.then(compileInlineLayoutHelpers);

test("board drops require the pointer to be strictly inside the inner boundary", async () => {
  const { isWithinDropBounds } = await helpersPromise;
  const bounds = { left: 100.5, right: 500.5, top: 80.25, bottom: 380.25 };

  assert.equal(isWithinDropBounds(100.5, 200, bounds), false);
  assert.equal(isWithinDropBounds(300, 80.25, bounds), false);
  assert.equal(isWithinDropBounds(100.51, 80.26, bounds), true);
  assert.equal(isWithinDropBounds(99, 200, bounds), false);
  assert.equal(isWithinDropBounds(125.5, 200, bounds, 25, 20), false);
  assert.equal(isWithinDropBounds(125.51, 200, bounds, 25, 20), true);
  assert.equal(isWithinDropBounds(475.5, 200, bounds, 25, 20), false);
  assert.equal(isWithinDropBounds(300, 100.25, bounds, 25, 20), false);
});

test("edge redistribution samples the full available layout", async () => {
  const { redistributePiecePositions } = await helpersPromise;
  const layout = new Map(Array.from({ length: 100 }, (_, index) => [
    index,
    { x: index / 100, y: (index % 10) / 10 },
  ]));
  const result = redistributePiecePositions([89, 2, 55, 8, 21], layout);
  const xPositions = [...result.values()].map(({ x }) => x);

  assert.equal(result.size, 5);
  assert.ok(Math.min(...xPositions) < 0.2);
  assert.ok(Math.max(...xPositions) > 0.8);
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
  assert.match(source, /const contentWidth = Math\.min\(availableWidth, availableHeight \* imageAspect\);/);
  assert.match(source, /const contentHeight = contentWidth \/ imageAspect;/);
  assert.match(source, /const width = contentWidth \+ borderWidth;/);
  assert.match(source, /style=\{boardStyle\}/);

  const containBoard = (areaWidth, areaHeight, imageAspect) => {
    const border = 4;
    const contentWidth = Math.min(areaWidth - border, (areaHeight - border) * imageAspect);
    const contentHeight = contentWidth / imageAspect;
    return { width: contentWidth + border, height: contentHeight + border, contentWidth, contentHeight };
  };
  const areas = [[378, 534], [964, 620], [240, 900], [1200, 220]];
  const aspects = [9 / 16, 3 / 4, 1, 16 / 9];

  for (const [areaWidth, areaHeight] of areas) {
    for (const aspect of aspects) {
      const board = containBoard(areaWidth, areaHeight, aspect);
      assert.ok(board.width <= areaWidth + Number.EPSILON);
      assert.ok(board.height <= areaHeight + Number.EPSILON);
      assert.ok(Math.abs(board.contentWidth / board.contentHeight - aspect) < 1e-12);
    }
  }
});

test("desktop boards maximize height while preserving every image aspect", async () => {
  const { fitBoardFrame } = await helpersPromise;
  for (const workspaceAspect of [1, 1.25, 1.55, 2]) {
    for (const imageAspect of [1 / 5, 9 / 16, 3 / 4, 1, 16 / 9, 5]) {
      const board = fitBoardFrame(imageAspect, workspaceAspect);
      assert.ok(board.width <= 0.78 + Number.EPSILON);
      assert.ok(board.height <= 0.94 + Number.EPSILON);
      assert.ok(Math.abs(workspaceAspect * board.width / board.height - imageAspect) < 1e-12);
      assert.ok(Math.abs(board.left - (1 - board.width) / 2) < 1e-12);
      assert.ok(Math.abs(board.top - (1 - board.height) / 2) < 1e-12);
      assert.ok(Math.abs(board.height - 0.94) < 1e-12 || Math.abs(board.width - 0.78) < 1e-12);
    }
  }
});

test("mobile band workspaces preserve board and piece ratios", () => {
  const boards = [
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
  const { bandPiecePositions, fitPuzzleSize, fitRailBoardFrame, landscapePiecePositions } = await helpersPromise;
  const modes = [
    {
      name: "band",
      board: { left: 0.06, top: 0.26, width: 0.88, height: 0.48 },
      positions: bandPiecePositions,
      mode: "top-bottom",
      outside: (x, y, cellWidth, cellHeight, board) => y + cellHeight * 1.28 < board.top || y - cellHeight * 0.28 > board.top + board.height,
    },
    {
      name: "landscape",
      board: { left: 0.14, top: 0.04, width: 0.72, height: 0.92 },
      positions: landscapePiecePositions,
      mode: "sides",
      outside: (x, y, cellWidth, cellHeight, board) => x + cellWidth * 1.28 < board.left || x - cellWidth * 0.28 > board.left + board.width,
      before: (x) => x < 0.5,
    },
  ];
  for (const mode of modes) {
    for (const imageAspect of [1 / 5, 9 / 16, 3 / 4, 1, 16 / 9, 5]) {
      for (const size of puzzleSizes) {
        const { rows, cols, count } = fitPuzzleSize(size, imageAspect);
        const board = fitRailBoardFrame(mode.board, rows, cols, mode.mode);
        const first = mode.positions(rows, cols, "ROOM42", board, mode.mode);
        const second = mode.positions(rows, cols, "ROOM42", board, mode.mode);
        const cellWidth = board.width / cols;
        const cellHeight = board.height / rows;
        let firstRailCount = 0;
        let secondRailCount = 0;
        assert.equal(first.size, count);
        assert.deepEqual([...first], [...second]);
        for (const [id, position] of first) {
          assert.ok(id >= 0 && id < count);
          assert.ok(Number.isFinite(position.x) && Number.isFinite(position.y));
          assert.ok(position.x >= 0.005 && position.x + cellWidth <= 0.996);
          assert.ok(position.y >= 0.005 && position.y + cellHeight <= 0.996);
          assert.ok(
            mode.outside(position.x, position.y, cellWidth, cellHeight, board),
            `${mode.name} piece ${id} for ${rows}x${cols} must stay outside the board`,
          );
          const before = mode.before
            ? mode.before(position.x, position.y, cellWidth, cellHeight)
            : mode.name === "side"
              ? position.x + cellWidth / 2 < board.left
              : position.y + cellHeight / 2 < board.top;
          if (before) firstRailCount += 1;
          else secondRailCount += 1;
        }
        assert.ok(firstRailCount > 0, `${mode.name} layout must use its first rail`);
        assert.ok(secondRailCount > 0, `${mode.name} layout must use its second rail`);
      }
    }
  }
});

test("mobile landscape uses the real viewport shape to select loose-piece rails", async () => {
  const { fitBoardFrame, railModeForFrame } = await helpersPromise;
  const portraitImage = fitBoardFrame(9 / 16, 2.1);
  const landscapeImage = fitBoardFrame(21 / 9, 2.1);

  assert.equal(railModeForFrame(portraitImage, 12), "sides");
  assert.equal(railModeForFrame(landscapeImage, 12), "top-bottom");
  assert.equal(railModeForFrame(portraitImage, 120), "perimeter");
  assert.equal(railModeForFrame(landscapeImage, 1024), "perimeter");
});

test("small desktop loose pieces remain visually outside the inner board", async () => {
  const { fitBoardFrame, fitRailBoardFrame, sidePiecePositions } = await helpersPromise;
  const baseBoard = fitBoardFrame(4 / 3, 1.45);
  const rows = 3;
  const cols = 4;
  const board = fitRailBoardFrame(baseBoard, rows, cols, "sides");
  const cellWidth = board.width / cols;
  const positions = sidePiecePositions(rows, cols, "SMALL-ROOM", board);
  const railDepths = new Set([...positions.values()].map(({ x }) => x.toFixed(4)));

  assert.ok(board.width < baseBoard.width);
  assert.ok(railDepths.size >= 6, "small loose pieces should not form two perfectly straight columns");
  for (const position of positions.values()) {
    const fullyLeft = position.x + cellWidth * 1.28 < board.left;
    const fullyRight = position.x - cellWidth * 0.28 > board.left + board.width;
    assert.ok(fullyLeft || fullyRight, "loose piece artwork must not cover the puzzle board");
  }
});

test("large desktop puzzles fill all four sides of the outer workspace", async () => {
  const { fitBoardFrame, fitRailBoardFrame, sidePiecePositions } = await helpersPromise;
  const rows = 43;
  const cols = 24;
  const board = fitRailBoardFrame(fitBoardFrame(9 / 16, 1.35), rows, cols, "perimeter");
  const positions = sidePiecePositions(rows, cols, "PORTRAIT-1024", board);
  const cellWidth = board.width / cols;
  const cellHeight = board.height / rows;
  const occupied = { left: 0, right: 0, top: 0, bottom: 0 };

  assert.equal(positions.size, rows * cols);
  for (const position of positions.values()) {
    const left = position.x + cellWidth * 1.28 < board.left;
    const right = position.x - cellWidth * 0.28 > board.left + board.width;
    const top = position.y + cellHeight * 1.28 < board.top;
    const bottom = position.y - cellHeight * 0.28 > board.top + board.height;
    assert.ok(left || right || top || bottom, "loose pieces must stay outside the puzzle board");
    if (left) occupied.left += 1;
    if (right) occupied.right += 1;
    if (top) occupied.top += 1;
    if (bottom) occupied.bottom += 1;
  }
  assert.ok(Object.values(occupied).every((count) => count > 0), JSON.stringify(occupied));
  assert.ok(occupied.left + occupied.right > occupied.top + occupied.bottom, JSON.stringify(occupied));
  assert.ok(Math.abs(occupied.left - occupied.right) < rows * cols * 0.12, JSON.stringify(occupied));
  assert.ok(Math.abs(occupied.top - occupied.bottom) < rows * cols * 0.12, JSON.stringify(occupied));
});

test("dense desktop layouts follow available perimeter capacity across image shapes", async () => {
  const { fitBoardFrame, fitPuzzleSize, fitRailBoardFrame, sidePiecePositions } = await helpersPromise;
  for (const imageAspect of [9 / 16, 3 / 4, 1, 4 / 3, 16 / 9]) {
    for (const size of puzzleSizes.filter(({ count }) => count > 20)) {
      const { rows, cols, count } = fitPuzzleSize(size, imageAspect);
      const board = fitRailBoardFrame(fitBoardFrame(imageAspect, 1.45), rows, cols, "perimeter");
      assert.ok(Math.abs(board.left + board.width / 2 - 0.5) < 1e-12);
      assert.ok(Math.abs(board.top + board.height / 2 - 0.5) < 1e-12);
      const cellWidth = board.width / cols;
      const cellHeight = board.height / rows;
      const occupied = { left: 0, right: 0, top: 0, bottom: 0 };
      for (const position of sidePiecePositions(rows, cols, `${imageAspect}:${count}`, board).values()) {
        if (position.y + cellHeight * 1.28 < board.top) occupied.top += 1;
        else if (position.y - cellHeight * 0.28 > board.top + board.height) occupied.bottom += 1;
        else if (position.x + cellWidth * 1.28 < board.left) occupied.left += 1;
        else occupied.right += 1;
      }
      assert.equal(Object.values(occupied).reduce((total, value) => total + value, 0), count);
      assert.ok(Math.abs(occupied.left - occupied.right) < count * 0.22, JSON.stringify({ imageAspect, count, occupied }));
      assert.ok(Math.abs(occupied.top - occupied.bottom) < count * 0.22, JSON.stringify({ imageAspect, count, occupied }));
      if (imageAspect < 0.8 && count >= 120) {
        assert.ok(occupied.left + occupied.right > occupied.top + occupied.bottom, JSON.stringify({ imageAspect, count, occupied }));
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

test("saved desktop edge coordinates are rejected when they overlap a mobile board", async () => {
  const source = await pageSourcePromise;
  const componentStart = source.indexOf("const InteractivePuzzlePiece");
  const componentEnd = source.indexOf("\n\nfunction positionRemotePuzzlePiece", componentStart);
  const component = source.slice(componentStart, componentEnd);

  assert.match(component, /if \(piece\.matLayout && piece\.matLayout !== layout\) return false/);
  assert.doesNotMatch(component, /if \(piece\.matLayout\) return piece\.matLayout === layout/);
  assert.match(component, /piece\.x \+ cellWidth \* 1\.28 < board\.left/);
});

test("the mobile 1034-piece grid uses the exact same 47 by 22 coordinate lattice as pieces", async () => {
  const { fitPuzzleSize, pieceBoardTarget, boardGridPath } = await helpersPromise;
  const fitted = fitPuzzleSize(puzzleSizes.at(-1), 0.45);

  assert.deepEqual({ rows: fitted.rows, cols: fitted.cols, count: fitted.count }, { rows: 47, cols: 22, count: 1034 });
  const path = boardGridPath(fitted.rows, fitted.cols);
  assert.equal((path.match(/M /g) ?? []).length, fitted.rows + fitted.cols - 2);
  assert.match(path, /M 21 0 V 47/);
  assert.match(path, /M 0 46 H 22/);
  assert.deepEqual(pieceBoardTarget(1033, fitted.rows, fitted.cols), { x: 21 / 22, y: 46 / 47 });
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
    matLayout: "band",
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
  assert.doesNotMatch(source, /MOBILE_LANDSCAPE_BOARD/);
  assert.match(source, /function fitBoardFrame/);
  assert.match(source, /function fitRailBoardFrame/);
  assert.doesNotMatch(source, /loosePieceScale/);
  assert.match(source, /"--side-piece-width": `\$\{sideBoard\.width \* 100 \/ cols\}%`/);
  assert.match(source, /const desktopBoardFrame = useMemo/);
  assert.match(source, /const bandWorkspaceAspect = imageAspect \* MOBILE_HORIZONTAL_BOARD\.height \/ MOBILE_HORIZONTAL_BOARD\.width/);
  assert.match(source, /const landscapeBaseFrame = useMemo/);
  assert.match(source, /const landscapeRailMode = railModeForFrame\(landscapeBaseFrame, pieceCount\)/);
  assert.match(source, /function pieceRailPositions/);
  assert.match(source, /function sidePiecePositions/);
  assert.match(source, /rows \* cols > 20 \? "perimeter" : "sides"/);
  assert.match(source, /function bandPiecePositions/);
  assert.match(source, /function landscapePiecePositions/);
  assert.doesNotMatch(source, /MAX_VISIBLE_LOOSE_PIECES|visibleLoosePieces/);
  assert.match(source, /\{loosePieces\.map\(\(piece\) =>/);
  assert.match(source, /imageAspect > 1 \? "horizontal-puzzle" : ""/);
  assert.match(source, /piece\.zone === "board" \|\| piece\.locked/);
  assert.match(source, /!piece\.locked && piece\.zone !== "board"/);
  assert.match(source, /const boardPieces = piecesRef\.current\.filter\(\(piece\) => !piece\.locked && piece\.zone === "board"\)/);
  assert.doesNotMatch(source, /redistributePiecePositions\(boardPieces\.map/);
  assert.match(source, /zone: droppedOnBoard \? "board" as const : "mat" as const/);
  assert.match(source, /positioned: droppedOnBoard \? undefined : \(true as const\)/);
  assert.match(source, /matLayout,/);
  assert.match(source, /function activeMatLayout/);
  assert.match(source, /const workspaceRect = workspace \? elementInnerBounds\(workspace\) : null/);
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
