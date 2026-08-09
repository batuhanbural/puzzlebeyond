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
    ["scatteredPieces", ["rows", "cols", "_seed"]],
    ["normalizePieceLayout", ["pieces", "rows", "cols", "seed"]],
  ];
  const helpers = helperSpecs.map(([name, parameters]) => replaceTypedSignature(
    extractFunction(source, name),
    name,
    parameters,
  ).replace(/\s+as const\b/g, ""));

  const factory = Function(`
    "use strict";
    const DEFAULT_IMAGE_ASPECT = ${JSON.stringify(defaultAspect)};
    const PUZZLE_LAYOUT_VERSION = ${JSON.stringify(layoutVersion)};
    ${helpers.join("\n")}
    return { fitPuzzleSize, pieceBoardTarget, scatteredPieces, normalizePieceLayout };
  `);
  return { ...factory(), defaultAspect, layoutVersion };
}

const helpersPromise = pageSourcePromise.then(compileInlineLayoutHelpers);

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

test("the rendered puzzle keeps board and mat coordinate domains separate", async () => {
  const source = await pageSourcePromise;
  assert.match(source, /piece\.zone === "board" \|\| piece\.locked/);
  assert.match(source, /!piece\.locked && piece\.zone !== "board"/);
  assert.match(source, /zone: droppedOnBoard \? "board" as const : "mat" as const/);
  assert.match(source, /onPointerCancel=\{cancelMove\}/);
  assert.match(source, /onLostPointerCapture=/);
  assert.match(source, /Math\.min\(3, zoom \+ \.5\)/, "dense portrait boards keep a bounded local zoom control");
  assert.match(source, /puzzle-board-area \$\{boardZoom > 1 \? "zoomed" : ""\}/);
});
