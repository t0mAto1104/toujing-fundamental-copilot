import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fitNotebookBox,
  moveNotebookBox,
  resizeNotebookBox,
  type NotebookBox,
  type ResizeEdge,
} from '../lib/notebook-window-geometry';

const viewport = { width: 1280, height: 900 };
const box = { x: 200, y: 150, width: 460, height: 430 };

void test('defaults fit the viewport and valid smaller saved dimensions remain unchanged', () => {
  assert.deepEqual(fitNotebookBox(undefined, viewport), {
    x: 796,
    y: 90,
    width: 460,
    height: 430,
  });
  const smaller = { x: 960, y: 700, width: 300, height: 180 };
  assert.deepEqual(fitNotebookBox(smaller, viewport), smaller);
});

void test('a minimized large notebook reaches every screen edge using its visible bounds', () => {
  const large = { x: 40, y: 40, width: 1000, height: 700 };
  const bottomRight = moveNotebookBox(large, 5000, 5000, viewport, true);
  assert.deepEqual(bottomRight, { x: 1050, y: 852, width: 1000, height: 700 });
  assert.deepEqual(fitNotebookBox(bottomRight, viewport, true), bottomRight);
  assert.deepEqual(moveNotebookBox(bottomRight, -5000, -5000, viewport, true), {
    x: 0,
    y: 0,
    width: 1000,
    height: 700,
  });
  assert.deepEqual(fitNotebookBox(bottomRight, viewport), {
    x: 280,
    y: 200,
    width: 1000,
    height: 700,
  });
});

void test('a notebook shrunk below the defaults can drag flush to all four screen edges', () => {
  const smaller = resizeNotebookBox(box, 'se', -1000, -1000, viewport);
  assert.deepEqual(smaller, { x: 200, y: 150, width: 300, height: 180 });
  const bottomRight = moveNotebookBox(smaller, 5000, 5000, viewport);
  assert.deepEqual(bottomRight, { x: 980, y: 720, width: 300, height: 180 });
  assert.deepEqual(moveNotebookBox(bottomRight, -5000, -5000, viewport), {
    x: 0,
    y: 0,
    width: 300,
    height: 180,
  });
});

const resized: Record<ResizeEdge, NotebookBox> = {
  n: { x: 200, y: 180, width: 460, height: 400 },
  s: { x: 200, y: 150, width: 460, height: 460 },
  e: { x: 200, y: 150, width: 480, height: 430 },
  w: { x: 220, y: 150, width: 440, height: 430 },
  ne: { x: 200, y: 180, width: 480, height: 400 },
  nw: { x: 220, y: 180, width: 440, height: 400 },
  se: { x: 200, y: 150, width: 480, height: 460 },
  sw: { x: 220, y: 150, width: 440, height: 460 },
};
for (const edge of Object.keys(resized) as ResizeEdge[]) {
  void test(`${edge} resize changes only the requested edges and keeps the opposite anchors`, () => {
    assert.deepEqual(
      resizeNotebookBox(box, edge, 20, 30, viewport),
      resized[edge],
    );
  });
}

void test('west and north stop at the minimum while their right and bottom anchors stay fixed', () => {
  const smallest = resizeNotebookBox(box, 'nw', 5000, 5000, viewport);
  assert.deepEqual(smallest, { x: 360, y: 400, width: 300, height: 180 });
  const reversed = resizeNotebookBox(smallest, 'nw', -20, -30, viewport);
  assert.deepEqual(reversed, { x: 340, y: 370, width: 320, height: 210 });
  assert.deepEqual(resizeNotebookBox(box, 'nw', -5000, -5000, viewport), {
    x: 0,
    y: 0,
    width: 660,
    height: 580,
  });
});

void test('east and south stop at the viewport without dragging the stationary top-left anchor', () => {
  const largest = resizeNotebookBox(box, 'se', 5000, 5000, viewport);
  assert.deepEqual(largest, { x: 200, y: 150, width: 1080, height: 750 });
  assert.deepEqual(resizeNotebookBox(largest, 'se', -20, -30, viewport), {
    x: 200,
    y: 150,
    width: 1060,
    height: 720,
  });
  assert.deepEqual(resizeNotebookBox(box, 'se', -5000, -5000, viewport), {
    x: 200,
    y: 150,
    width: 300,
    height: 180,
  });
});

void test('tiny viewports lower the minimum dimensions and retain nonnegative bounds', () => {
  const tiny = { width: 160, height: 100 };
  const fitted = { x: 0, y: 0, width: 160, height: 100 };
  assert.deepEqual(fitNotebookBox(box, tiny), fitted);
  assert.deepEqual(resizeNotebookBox(fitted, 'nw', 5000, 5000, tiny), fitted);
  assert.deepEqual(resizeNotebookBox(fitted, 'se', -5000, -5000, tiny), fitted);
  assert.deepEqual(moveNotebookBox(fitted, 5000, 5000, tiny, true), {
    ...fitted,
    y: 52,
  });
  assert.deepEqual(fitNotebookBox(box, { width: 80, height: 30 }, true), {
    x: 0,
    y: 0,
    width: 80,
    height: 30,
  });
});

void test('movement, fitting and anchored resize respect visual viewport offsets', () => {
  const offset = { width: 800, height: 600, left: 100, top: 50 };
  assert.deepEqual(fitNotebookBox(undefined, offset), {
    x: 416,
    y: 140,
    width: 460,
    height: 430,
  });
  assert.deepEqual(moveNotebookBox(box, 5000, 5000, offset), {
    x: 440,
    y: 220,
    width: 460,
    height: 430,
  });
  assert.deepEqual(moveNotebookBox(box, 5000, 5000, offset, true), {
    x: 670,
    y: 602,
    width: 460,
    height: 430,
  });
  assert.deepEqual(resizeNotebookBox(box, 'nw', -5000, -5000, offset), {
    x: 100,
    y: 50,
    width: 560,
    height: 530,
  });
  assert.deepEqual(resizeNotebookBox(box, 'se', 5000, 5000, offset), {
    x: 200,
    y: 150,
    width: 700,
    height: 500,
  });
});
