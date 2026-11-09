"use client";

/**
 * MaskEditor - 局部重绘（inpainting）的蒙版绘制弹层（自包含单文件）
 *
 * mask 语义（OpenAI /v1/images/edits）：一张与底图同尺寸的 PNG，
 * alpha=0 = 要被重绘的区域，alpha=255 = 保持不动。
 * 上游中转实测并不真正按 mask 约束生成，最终「只改这一块」靠客户端合成兜底，
 * 所以这里只负责导出「与底图像素严格对齐、无羽化」的蒙版（羽化留给合成阶段）。
 *
 * 坐标系（本组件最容易错的地方）：
 *  - 显示层是 object-contain，图片四周会有留边；
 *  - 笔画一律以「图片自然像素坐标」记录，与显示尺寸 / DPR 无关；
 *  - 屏幕 → 自然坐标：先由 containRect 求图片显示矩形（缩放 + 留边），
 *    再连同容器在视口的位置交给 screenToImage 一次扣掉留边、换算到自然像素；
 *  - 导出时离屏画布直接用自然像素尺寸，不做任何屏幕尺寸的二次换算。
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { Eraser, Paintbrush, Trash2, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

// ===========================================================================
// 一、纯几何 / 导出核心（无 React 依赖）
//    自测脚本按 `#region mask-core` 提取本段，在真实 canvas 上断言换算与 alpha。
// ===========================================================================

// #region mask-core

/** 图片自然像素坐标：与底图 naturalWidth × naturalHeight 同一坐标系 */
export interface ImagePoint {
  x: number;
  y: number;
}

/** 矩形（相对某个容器左上角，或视口坐标系下的显示矩形） */
export interface ContainRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 一笔涂抹。点坐标与线宽都用图片自然像素，与显示尺寸 / DPR 无关。 */
export interface MaskStroke {
  points: ImagePoint[];
  /** 笔刷线宽（自然像素）：落笔时由「屏幕像素 × 显示缩放」固化，保证所见即所得 */
  width: number;
  /** true = 橡皮（擦掉已涂的标记） */
  erase: boolean;
}

/**
 * object-contain 几何：把 imageW×imageH 的图等比放进 containerW×containerH，
 * 返回图片实际占用的矩形（相对容器，含居中留边）。
 * 显示层的缩放比与留边偏移都只从这里取，避免各处各算一套。
 */
export function containRect(
  containerW: number,
  containerH: number,
  imageW: number,
  imageH: number
): ContainRect {
  if (containerW <= 0 || containerH <= 0 || imageW <= 0 || imageH <= 0) {
    return { left: 0, top: 0, width: 0, height: 0 };
  }
  const scale = Math.min(containerW / imageW, containerH / imageH);
  const width = imageW * scale;
  const height = imageH * scale;
  return {
    left: (containerW - width) / 2,
    top: (containerH - height) / 2,
    width,
    height,
  };
}

/**
 * 屏幕坐标 → 图片自然像素坐标。
 *
 * display 必须是「图片在屏幕上的实际显示矩形」（视口 / client 坐标系）：
 *   display.left/top     = 容器在视口的位置 + object-contain 的留边偏移
 *   display.width/height = 按 contain 缩放后的显示尺寸
 * 于是 ((clientX - left) / width) * naturalW 同时完成了扣留边与自然像素换算；
 * 若忽略 left/top，窄容器里整体会偏移，导出的 mask 与底图就对不上了。
 */
export function screenToImage(
  clientX: number,
  clientY: number,
  display: ContainRect,
  naturalW: number,
  naturalH: number
): ImagePoint {
  if (display.width <= 0 || display.height <= 0) return { x: 0, y: 0 };
  return {
    x: ((clientX - display.left) / display.width) * naturalW,
    y: ((clientY - display.top) / display.height) * naturalH,
  };
}

/**
 * 描出一笔的路径：单点画圆点（点一下不拖也得留下标记），多点用圆头描边。
 * map 负责自然坐标 → 目标画布坐标；widthScale 是目标坐标系相对自然像素的缩放。
 */
function traceStroke(
  ctx: CanvasRenderingContext2D,
  stroke: MaskStroke,
  map: (p: ImagePoint) => ImagePoint,
  widthScale: number
) {
  const points = stroke.points;
  if (points.length === 0) return;
  ctx.lineWidth = Math.max(0.5, stroke.width * widthScale);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (points.length === 1) {
    const p = map(points[0]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(0.5, ctx.lineWidth / 2), 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  const first = map(points[0]);
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < points.length; i += 1) {
    const p = map(points[i]);
    ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
}

/**
 * 把一笔画到「预览覆盖层」或「导出 mask 层」，两层语义相反：
 *  - invert=false（预览覆盖层，透明底）：涂抹 = 加白，橡皮 = destination-out
 *  - invert=true （导出 mask，白底）：涂抹 = destination-out（挖成 alpha=0），橡皮 = 补白
 * clip 用来限制只在图片显示区域内生效（object-contain 的留边不参与绘制）。
 */
export function paintStroke(
  ctx: CanvasRenderingContext2D,
  stroke: MaskStroke,
  map: (p: ImagePoint) => ImagePoint,
  widthScale: number,
  invert: boolean,
  clip?: ContainRect
) {
  ctx.save();
  if (clip) {
    ctx.beginPath();
    ctx.rect(clip.left, clip.top, clip.width, clip.height);
    ctx.clip();
  }
  const destinationOut = invert ? !stroke.erase : stroke.erase;
  ctx.globalCompositeOperation = destinationOut ? "destination-out" : "source-over";
  ctx.strokeStyle = "#ffffff";
  ctx.fillStyle = "#ffffff";
  traceStroke(ctx, stroke, map, widthScale);
  ctx.restore();
}

/**
 * 生成导出用的 mask 画布，尺寸严格等于底图自然尺寸：
 *  1. 整张填不透明白（alpha=255 = 保持不动）
 *  2. 涂抹笔画用 destination-out 挖成 alpha=0（= 要被重绘）
 *  3. 橡皮用 source-over 补回白色（= 恢复保护）
 * 笔画按顺序叠加，所以「涂了又擦」的结果与预览一致。返回的 canvas 交给 toBlob 导出 PNG。
 */
export function renderMaskCanvas(
  strokes: MaskStroke[],
  naturalW: number,
  naturalH: number
): HTMLCanvasElement | null {
  if (naturalW <= 0 || naturalH <= 0) return null;
  const canvas = document.createElement("canvas");
  canvas.width = naturalW;
  canvas.height = naturalH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, naturalW, naturalH);
  const identity = (p: ImagePoint): ImagePoint => p;
  for (const stroke of strokes) {
    paintStroke(ctx, stroke, identity, 1, true);
  }
  return canvas;
}

// #endregion mask-core

// ===========================================================================
// 二、组件
// ===========================================================================

/** 撤销预算：只保留最近 20 步（更早的笔画不再可退） */
const UNDO_LIMIT = 20;
const BRUSH_MIN = 2;
const BRUSH_MAX = 80;
const BRUSH_DEFAULT = 28;
/** 涂抹遮罩：仪器橙的 sRGB 近似（canvas 不直接吃 oklch，避免老 WebView 解析失败） */
const PREVIEW_RGB = "#b65009";
const PREVIEW_ALPHA = 0.42;

/** SSR / hydration 用：服务端快照恒为 false，避免 portal 与 SSR 标记不一致 */
const subscribeNothing = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

/** 按 DPR 建 backing store（上限 2x，3x 屏再高只是白烧内存），返回按 CSS 像素作画的上下文 */
function prepareCanvas(
  canvas: HTMLCanvasElement,
  cssW: number,
  cssH: number
): CanvasRenderingContext2D | null {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(cssW * dpr));
  const height = Math.max(1, Math.round(cssH * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width; // 改尺寸会自动清空，正好避免旧内容残留
    canvas.height = height;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

/**
 * 把覆盖层的 alpha 整体染成半透明橙再叠到预览画布。
 * 先画覆盖率、再 source-in 填色：同一处涂两笔不会越叠越深，读数一直均匀。
 */
function compositePreview(
  ctx: CanvasRenderingContext2D,
  coverage: HTMLCanvasElement,
  cssW: number,
  cssH: number
) {
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.save();
  ctx.drawImage(coverage, 0, 0, cssW, cssH);
  ctx.globalCompositeOperation = "source-in";
  ctx.globalAlpha = PREVIEW_ALPHA;
  ctx.fillStyle = PREVIEW_RGB;
  ctx.fillRect(0, 0, cssW, cssH);
  ctx.restore();
}

export interface MaskEditorProps {
  /** false 时不渲染任何东西 */
  open: boolean;
  /** 底图：blob: / data: URL 都可以 */
  imageUrl: string;
  /** 取消（Esc / 关闭 / 取消按钮），不产生 mask */
  onCancel: () => void;
  /** mask 为 null 表示一笔都没涂（父级据此跳过 mask，退回普通图生图） */
  onConfirm: (mask: Blob | null) => void;
}

export function MaskEditor({ open, imageUrl, onCancel, onConfirm }: MaskEditorProps) {
  // portal 只在客户端渲染：服务端与 hydration 首帧返回 null，避免标记不一致
  const isClient = useSyncExternalStore(
    subscribeNothing,
    getClientSnapshot,
    getServerSnapshot
  );

  const [tool, setTool] = useState<"brush" | "eraser">("brush");
  const [brushSize, setBrushSize] = useState(BRUSH_DEFAULT);
  // 底图自然尺寸：记录来源 URL，URL 一变就自动失效（不依赖清理顺序）
  const [loaded, setLoaded] = useState<{ url: string; w: number; h: number } | null>(null);
  const [loadErrorFor, setLoadErrorFor] = useState<string | null>(null);
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  // strokes 只是给按钮 / 读数用的渲染副本；拖拽过程读 strokesRef，避免每 move 一次 re-render
  const [strokes, setStrokes] = useState<MaskStroke[]>([]);
  const [undoLeft, setUndoLeft] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [clearArmed, setClearArmed] = useState(false);

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const paintRef = useRef<HTMLCanvasElement | null>(null);
  const cursorRef = useRef<HTMLCanvasElement | null>(null);
  /** 预览覆盖层：只存 alpha 覆盖率（不含颜色 / 透明度），重合成时统一上色 */
  const coverageRef = useRef<HTMLCanvasElement | null>(null);
  const strokesRef = useRef<MaskStroke[]>([]);
  const liveRef = useRef<{ pointerId: number; stroke: MaskStroke } | null>(null);
  const hoverRef = useRef<{ x: number; y: number } | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const natural = useMemo(
    () =>
      loaded && loaded.url === imageUrl && loaded.w > 0 && loaded.h > 0
        ? { w: loaded.w, h: loaded.h }
        : null,
    [loaded, imageUrl]
  );
  const loadFailed = !imageUrl || loadErrorFor === imageUrl;

  /** 图片在视口里的实际显示矩形（已扣掉 object-contain 留边）；未就绪时为 null */
  const displayRect = useCallback((): ContainRect | null => {
    const stage = stageRef.current;
    if (!stage || !natural) return null;
    const box = stage.getBoundingClientRect();
    const fit = containRect(box.width, box.height, natural.w, natural.h);
    if (fit.width <= 0 || fit.height <= 0) return null;
    return {
      left: box.left + fit.left,
      top: box.top + fit.top,
      width: fit.width,
      height: fit.height,
    };
  }, [natural]);

  /** 重绘预览：全部笔画先画进 coverage，再整体按半透明橙合成一次 */
  const redraw = useCallback(
    (options: { strokes?: MaskStroke[]; live?: MaskStroke | null } = {}) => {
      const paint = paintRef.current;
      const stage = stageRef.current;
      if (!paint || !stage) return;
      const cssW = stage.clientWidth;
      const cssH = stage.clientHeight;
      if (cssW <= 0 || cssH <= 0) return;
      const paintCtx = prepareCanvas(paint, cssW, cssH);
      if (!paintCtx) return;
      if (!natural) {
        // 底图未就绪（或已切图）：清空旧画面，别让上一张的涂抹残留
        paintCtx.clearRect(0, 0, cssW, cssH);
        return;
      }
      const fit = containRect(cssW, cssH, natural.w, natural.h);
      if (fit.width <= 0 || fit.height <= 0) return;
      const scale = fit.width / natural.w;
      const map = (p: ImagePoint): ImagePoint => ({
        x: fit.left + p.x * scale,
        y: fit.top + p.y * scale,
      });
      const coverage =
        coverageRef.current ?? (coverageRef.current = document.createElement("canvas"));
      const coverageCtx = prepareCanvas(coverage, cssW, cssH);
      if (!coverageCtx) return;
      coverageCtx.clearRect(0, 0, cssW, cssH);
      const all = options.strokes ?? strokesRef.current;
      for (const stroke of all) {
        paintStroke(coverageCtx, stroke, map, scale, false, fit);
      }
      if (options.live) {
        paintStroke(coverageCtx, options.live, map, scale, false, fit);
      }
      compositePreview(paintCtx, coverage, cssW, cssH);
    },
    [natural]
  );

  /** 拖拽中的增量：只把最新一段画进 coverage，再重合成一次预览 */
  const drawLiveSegment = useCallback(
    (stroke: MaskStroke, from: ImagePoint, to: ImagePoint) => {
      const paint = paintRef.current;
      const stage = stageRef.current;
      if (!paint || !stage || !natural) return;
      const cssW = stage.clientWidth;
      const cssH = stage.clientHeight;
      if (cssW <= 0 || cssH <= 0) return;
      const fit = containRect(cssW, cssH, natural.w, natural.h);
      if (fit.width <= 0 || fit.height <= 0) return;
      const coverage = coverageRef.current;
      if (!coverage) return;
      const coverageCtx = prepareCanvas(coverage, cssW, cssH);
      const paintCtx = prepareCanvas(paint, cssW, cssH);
      if (!coverageCtx || !paintCtx) return;
      const scale = fit.width / natural.w;
      const map = (p: ImagePoint): ImagePoint => ({
        x: fit.left + p.x * scale,
        y: fit.top + p.y * scale,
      });
      paintStroke(
        coverageCtx,
        { points: [from, to], width: stroke.width, erase: stroke.erase },
        map,
        scale,
        false,
        fit
      );
      compositePreview(paintCtx, coverage, cssW, cssH);
    },
    [natural]
  );

  /** 笔刷光标圈：半径 = 笔刷屏幕像素的一半，跟随指针（触屏也给出尺寸反馈） */
  const drawCursorRing = useCallback(() => {
    const cursor = cursorRef.current;
    const stage = stageRef.current;
    if (!cursor || !stage) return;
    const cssW = stage.clientWidth;
    const cssH = stage.clientHeight;
    if (cssW <= 0 || cssH <= 0) return;
    const ctx = prepareCanvas(cursor, cssW, cssH);
    if (!ctx) return;
    ctx.clearRect(0, 0, cssW, cssH);
    const pos = hoverRef.current;
    if (!pos || !natural) return;
    const fit = containRect(cssW, cssH, natural.w, natural.h);
    if (fit.width <= 0 || fit.height <= 0) return;
    const radius = Math.max(1.5, brushSize / 2);
    ctx.save();
    ctx.beginPath();
    ctx.rect(fit.left, fit.top, fit.width, fit.height);
    ctx.clip();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, radius + 1, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }, [brushSize, natural]);

  // ---- 打开 / 换图：重置编辑状态（上一张的笔画不能残留） ----
  useEffect(() => {
    liveRef.current = null;
    hoverRef.current = null;
    if (!open) return;
    strokesRef.current = [];
    /* eslint-disable react-hooks/set-state-in-effect -- 打开弹层 / 换底图时同步重置编辑状态 */
    setStrokes([]);
    setUndoLeft(0);
    setTool("brush");
    setClearArmed(false);
    setExportError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, imageUrl]);

  // ---- 预载底图拿自然尺寸：不能只靠 <img onLoad>（缓存命中时 onLoad 可能不触发） ----
  useEffect(() => {
    if (!open || !isClient || !imageUrl) return;
    let cancelled = false;
    const probe = new Image();
    probe.onload = () => {
      if (cancelled) return;
      if (probe.naturalWidth > 0 && probe.naturalHeight > 0) {
        setLoaded({ url: imageUrl, w: probe.naturalWidth, h: probe.naturalHeight });
        setLoadErrorFor(null);
      } else {
        setLoadErrorFor(imageUrl);
      }
    };
    probe.onerror = () => {
      if (!cancelled) setLoadErrorFor(imageUrl);
    };
    probe.src = imageUrl;
    return () => {
      cancelled = true;
      probe.onload = null;
      probe.onerror = null;
    };
  }, [open, isClient, imageUrl]);

  // ---- Esc 关闭 ----
  useEffect(() => {
    if (!open || !isClient) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, isClient, onCancel]);

  // ---- 弹层打开时锁 background 滚动，避免涂到一半页面跟着滚 ----
  useEffect(() => {
    if (!open || !isClient) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open, isClient]);

  // ---- 焦点：打开时接管到弹层，关闭时还给触发它的元素 ----
  useEffect(() => {
    if (!open || !isClient) return;
    const active = document.activeElement;
    restoreFocusRef.current = active instanceof HTMLElement ? active : null;
    dialogRef.current?.focus();
    return () => {
      restoreFocusRef.current?.focus();
      restoreFocusRef.current = null;
    };
  }, [open, isClient]);

  // ---- 容器尺寸变化：同步重绘（窗口旋转 / 窄屏全屏切换都会走这里） ----
  useEffect(() => {
    if (!open || !isClient) return;
    const stage = stageRef.current;
    if (!stage) return;
    const sync = () => {
      const w = stage.clientWidth;
      const h = stage.clientHeight;
      setStageSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
      redraw();
      drawCursorRing();
    };
    const observer = new ResizeObserver(sync);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [open, isClient, natural, redraw, drawCursorRing]);

  // ---- 笔刷大小变化：光标圈半径跟着变 ----
  useEffect(() => {
    if (!open || !isClient) return;
    drawCursorRing();
  }, [open, isClient, brushSize, drawCursorRing]);

  // ---- 清空的二次确认 3 秒后自动撤回，避免一直挂着「再点清空」 ----
  useEffect(() => {
    if (!clearArmed) return;
    const timer = window.setTimeout(() => setClearArmed(false), 3000);
    return () => window.clearTimeout(timer);
  }, [clearArmed]);

  // ---------------- 指针事件 ----------------

  const releaseCapture = (pointerId: number) => {
    const canvas = paintRef.current;
    if (canvas?.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
  };

  const pointerToImage = (clientX: number, clientY: number): ImagePoint | null => {
    const display = displayRect();
    if (!display || !natural) return null;
    return screenToImage(clientX, clientY, display, natural.w, natural.h);
  };

  /** 屏幕像素 → 图片自然像素线宽：图片显示得越小，一笔覆盖的自然像素越多 */
  const brushWidthInNatural = (): number => {
    const display = displayRect();
    if (!display || !natural) return brushSize;
    return brushSize * (natural.w / display.width);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!natural || loadFailed) return;
    // 鼠标只响应左键；触屏 / 触控笔直接开始
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const point = pointerToImage(event.clientX, event.clientY);
    if (!point) return;
    // 从留边（图片外）起笔不算涂抹，否则会留下看不见的空笔画
    if (point.x < 0 || point.y < 0 || point.x > natural.w || point.y > natural.h) return;
    if (event.cancelable) event.preventDefault();
    try {
      paintRef.current?.setPointerCapture(event.pointerId);
    } catch {
      // 极少数合成事件拿不到活动指针：没有 capture 也能画，只是拖出画布会断笔
    }
    liveRef.current = {
      pointerId: event.pointerId,
      stroke: { points: [point], width: brushWidthInNatural(), erase: tool === "eraser" },
    };
    setClearArmed(false);
    redraw({ live: liveRef.current.stroke });
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const stage = stageRef.current;
    if (stage) {
      const box = stage.getBoundingClientRect();
      hoverRef.current = { x: event.clientX - box.left, y: event.clientY - box.top };
      drawCursorRing();
    }
    const live = liveRef.current;
    if (!live || live.pointerId !== event.pointerId) return;
    const point = pointerToImage(event.clientX, event.clientY);
    if (!point) return;
    const points = live.stroke.points;
    const previous = points[points.length - 1];
    // 不足 0.5 自然像素的抖动不记点：4K 图一次拖动可能产生上万个无意义点
    const dx = point.x - previous.x;
    const dy = point.y - previous.y;
    if (dx * dx + dy * dy < 0.25) return;
    points.push(point);
    drawLiveSegment(live.stroke, previous, point);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const live = liveRef.current;
    if (!live || live.pointerId !== event.pointerId) return;
    liveRef.current = null;
    const next = [...strokesRef.current, live.stroke];
    strokesRef.current = next;
    setStrokes(next);
    setUndoLeft((count) => Math.min(count + 1, UNDO_LIMIT));
    redraw({ strokes: next });
    releaseCapture(live.pointerId);
    if (event.pointerType !== "mouse") {
      hoverRef.current = null;
      drawCursorRing();
    }
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLCanvasElement>) => {
    // 系统手势打断时，已画的部分照样留下（丢笔画比留半笔更糟）
    handlePointerUp(event);
    hoverRef.current = null;
    drawCursorRing();
  };

  const handlePointerLeave = () => {
    if (liveRef.current) return; // 拖拽中（pointer capture）不清光标圈
    hoverRef.current = null;
    drawCursorRing();
  };

  // ---------------- 编辑动作 ----------------

  const handleUndo = () => {
    if (undoLeft <= 0 || strokesRef.current.length === 0) return;
    const next = strokesRef.current.slice(0, -1);
    strokesRef.current = next;
    setStrokes(next);
    setUndoLeft((count) => Math.max(0, count - 1));
    setClearArmed(false);
    redraw({ strokes: next });
  };

  const handleClear = () => {
    if (strokesRef.current.length === 0) return;
    if (!clearArmed) {
      setClearArmed(true);
      return;
    }
    strokesRef.current = [];
    setStrokes([]);
    setUndoLeft(0);
    setClearArmed(false);
    redraw({ strokes: [] });
  };

  const handleConfirm = async () => {
    if (!natural || exporting) return;
    if (strokesRef.current.length === 0) {
      onConfirm(null); // 一笔没涂：不发 mask，父级退回普通图生图
      return;
    }
    setExporting(true);
    setExportError(null);
    try {
      const canvas = renderMaskCanvas(strokesRef.current, natural.w, natural.h);
      if (!canvas) {
        setExportError("蒙版画布创建失败，请重试");
        return;
      }
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((value) => resolve(value), "image/png");
      });
      if (!blob) {
        setExportError("蒙版导出失败，请重试");
        return;
      }
      onConfirm(blob);
    } finally {
      setExporting(false);
    }
  };

  if (!open || !isClient) return null;

  const fit =
    natural && stageSize.w > 0 && stageSize.h > 0
      ? containRect(stageSize.w, stageSize.h, natural.w, natural.h)
      : null;
  const hasStrokes = strokes.length > 0;

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/45 backdrop-blur-[2px]"
      role="presentation"
    >
      {/* ui-instrument：弹层走 portal 会脱离页面根节点，必须自己带上视觉作用域 */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mask-editor-title"
        aria-describedby="mask-editor-hint"
        aria-busy={exporting}
        tabIndex={-1}
        className="ui-instrument relative flex h-[100dvh] w-full flex-col overflow-hidden overscroll-contain bg-card text-card-foreground outline-none sm:h-[min(88dvh,780px)] sm:max-h-[calc(100dvh-3rem)] sm:w-[min(960px,calc(100vw-3rem))] sm:rounded-[5px] sm:border sm:border-[color:var(--inst-line-2)] sm:shadow-[0_24px_64px_-28px_rgba(0,0,0,0.55)]"
      >
        {/* 顶栏：仪器刻度字 + 唯一标题 */}
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[color:var(--inst-line)] bg-card px-3 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-4 sm:pt-3">
          <div className="min-w-0">
            <p className="font-mono text-[10px] leading-none tracking-[0.16em] text-muted-foreground uppercase">
              MASK · INPAINT
            </p>
            <h2
              id="mask-editor-title"
              className="mt-1.5 truncate font-heading text-[15px] leading-none font-medium text-foreground"
            >
              局部重绘
            </h2>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onCancel}
            aria-label="关闭蒙版编辑（不保存）"
            className="-mr-1.5 shrink-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* 语义提示：只在这一行解释 mask，省得用户猜「涂哪里」 */}
        <div className="flex shrink-0 items-center gap-2 border-b border-[color:var(--inst-line)] bg-[var(--inst-sunken)] px-3 py-2 sm:px-4">
          <span
            aria-hidden="true"
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--inst-accent)]"
          />
          <p
            id="mask-editor-hint"
            className="inst-mono truncate text-[11px] tracking-[0.04em] text-muted-foreground"
          >
            涂抹 = 重绘区域 · 其余像素保持原图
          </p>
        </div>

        {/* 画布区：底图 object-contain，两张 canvas 盖满整个区域，坐标换算负责扣留边 */}
        <div className="relative min-h-0 flex-1 bg-[var(--inst-sunken)] p-2 sm:p-3">
          <div ref={stageRef} className="relative h-full w-full overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element -- 底图是本地 blob/data URL，且要用 naturalWidth 建同尺寸 mask，不走图片优化管线 */}
            <img
              src={imageUrl}
              alt="待重绘的底图"
              draggable={false}
              className="pointer-events-none absolute inset-0 h-full w-full select-none object-contain"
            />
            <canvas
              ref={paintRef}
              aria-label={hasStrokes ? `蒙版绘制区，已涂 ${strokes.length} 笔` : "蒙版绘制区"}
              className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
              onPointerLeave={handlePointerLeave}
              onContextMenu={(event) => event.preventDefault()}
            />
            <canvas
              ref={cursorRef}
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 h-full w-full"
            />
            {/* 图片显示边界：一根发丝线，让留边与画布边界一眼可分 */}
            {fit && fit.width > 0 && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute border border-[color:var(--inst-line-2)]"
                style={{ left: fit.left, top: fit.top, width: fit.width, height: fit.height }}
              />
            )}
            {!natural && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center">
                <p className="inst-mono text-[11px] tracking-[0.12em] text-muted-foreground">
                  {loadFailed ? "底图载入失败" : "载入底图…"}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* 工具栏：窄屏贴底（含安全区），桌面跟在卡片底部 */}
        <div className="shrink-0 border-t border-[color:var(--inst-line)] bg-card px-3 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] sm:px-4 sm:py-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <div className="inst-seg shrink-0" role="group" aria-label="绘制工具">
              <button
                type="button"
                data-on={tool === "brush"}
                aria-pressed={tool === "brush"}
                onClick={() => setTool("brush")}
                className="inline-flex items-center gap-1.5"
              >
                <Paintbrush className="h-3.5 w-3.5" aria-hidden="true" />
                画笔
              </button>
              <button
                type="button"
                data-on={tool === "eraser"}
                aria-pressed={tool === "eraser"}
                onClick={() => setTool("eraser")}
                className="inline-flex items-center gap-1.5"
              >
                <Eraser className="h-3.5 w-3.5" aria-hidden="true" />
                橡皮
              </button>
            </div>

            <div className="flex min-w-[140px] flex-1 items-center gap-2.5">
              <label
                htmlFor="mask-brush-size"
                className="shrink-0 font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase"
              >
                笔刷
              </label>
              <input
                id="mask-brush-size"
                type="range"
                min={BRUSH_MIN}
                max={BRUSH_MAX}
                step={1}
                value={brushSize}
                onChange={(event) => setBrushSize(Number(event.target.value))}
                aria-label="笔刷大小（屏幕像素）"
                className="h-1 w-full min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-[var(--inst-line-2)] accent-[var(--inst-accent)]"
              />
              <span className="inst-mono w-11 shrink-0 text-right text-[11px] tracking-[0.03em] text-muted-foreground tabular-nums">
                {brushSize} px
              </span>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                onClick={handleUndo}
                disabled={undoLeft <= 0 || !hasStrokes}
                aria-label="撤销上一笔"
                className="press gap-1.5"
              >
                <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
                撤销
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleClear}
                disabled={!hasStrokes}
                aria-label={clearArmed ? "再次点击确认清空" : "清空所有涂抹"}
                className={`press gap-1.5 ${
                  clearArmed ? "border-destructive/50 bg-destructive/10 text-destructive" : ""
                }`}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                {clearArmed ? "再点清空" : "清空"}
              </Button>
            </div>
          </div>

          <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-[color:var(--inst-line)] pt-2.5">
            <span className="inst-mono hidden min-w-0 truncate text-[11px] tracking-[0.04em] text-muted-foreground sm:block">
              {natural
                ? `${natural.w} × ${natural.h} px · 已涂 ${strokes.length} 笔`
                : loadFailed
                  ? "底图载入失败"
                  : "载入底图…"}
            </span>
            {exportError && (
              <span className="truncate text-[11px] text-destructive">{exportError}</span>
            )}
            <div className="ml-auto flex shrink-0 items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                onClick={onCancel}
                aria-label="取消蒙版编辑"
                className="press"
              >
                取消
              </Button>
              <Button
                size="sm"
                onClick={() => void handleConfirm()}
                disabled={!natural || exporting}
                aria-label="确认蒙版"
                className="press min-w-[84px] gap-1.5 border-transparent bg-[var(--inst-accent)] text-[color:var(--inst-on-accent)] hover:bg-[var(--inst-accent)] hover:brightness-105"
              >
                {exporting ? "导出中…" : "确认"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
