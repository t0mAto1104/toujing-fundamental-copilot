export type NotebookBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};
export type NotebookViewport = {
  width: number;
  height: number;
  left?: number;
  top?: number;
};
export type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));

export function fitNotebookBox(
  box: NotebookBox | undefined,
  viewport: NotebookViewport,
  minimized = false,
): NotebookBox {
  const left = viewport.left ?? 0;
  const top = viewport.top ?? 0;
  const width = clamp(
    box?.width ?? 460,
    Math.min(300, viewport.width),
    viewport.width,
  );
  const height = clamp(
    box?.height ?? 430,
    Math.min(180, viewport.height),
    viewport.height,
  );
  const visibleWidth = minimized ? Math.min(230, width) : width;
  const visibleHeight = minimized ? 48 : height;
  return {
    width,
    height,
    x: clamp(
      box?.x ?? left + viewport.width - visibleWidth - 24,
      left,
      left + viewport.width - visibleWidth,
    ),
    y: clamp(box?.y ?? top + 90, top, top + viewport.height - visibleHeight),
  };
}

export function moveNotebookBox(
  box: NotebookBox,
  dx: number,
  dy: number,
  viewport: NotebookViewport,
  minimized = false,
): NotebookBox {
  return fitNotebookBox(
    { ...box, x: box.x + dx, y: box.y + dy },
    viewport,
    minimized,
  );
}

export function resizeNotebookBox(
  box: NotebookBox,
  edge: ResizeEdge,
  dx: number,
  dy: number,
  viewport: NotebookViewport,
): NotebookBox {
  const fitted = fitNotebookBox(box, viewport);
  let left = fitted.x;
  let top = fitted.y;
  let right = left + fitted.width;
  let bottom = top + fitted.height;
  const minWidth = Math.min(300, viewport.width);
  const minHeight = Math.min(180, viewport.height);
  if (edge.includes('w'))
    left = clamp(left + dx, viewport.left ?? 0, right - minWidth);
  if (edge.includes('e'))
    right = clamp(
      right + dx,
      left + minWidth,
      (viewport.left ?? 0) + viewport.width,
    );
  if (edge.includes('n'))
    top = clamp(top + dy, viewport.top ?? 0, bottom - minHeight);
  if (edge.includes('s'))
    bottom = clamp(
      bottom + dy,
      top + minHeight,
      (viewport.top ?? 0) + viewport.height,
    );
  return { x: left, y: top, width: right - left, height: bottom - top };
}
