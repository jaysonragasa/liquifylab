import React, { useRef, useEffect, useState, useCallback } from 'react';
import { ToolType, BrushSettings, Point, Layer } from '../types';

interface LiquifyCanvasProps {
  layers: Layer[];
  activeLayerId: string;
  // Called when a stroke ends to commit to history
  onInteractionEnd: (updatedLayers: Layer[]) => void;
  // Called during drag for preview (no history)
  onUpdateLayerPreview: (id: string, updates: Partial<Layer>) => void;
  tool: ToolType;
  brushSettings: BrushSettings;
  isProcessing: boolean;
  zoomLevel: number;
  setZoomLevel: (z: number) => void;
}

enum TransformHandle {
  NONE,
  BODY,
  TOP_LEFT,
  TOP_RIGHT,
  BOTTOM_LEFT,
  BOTTOM_RIGHT,
  ROTATE
}

// --- Helper Math Functions ---

const getDistance = (t1: React.Touch, t2: React.Touch): number => {
  const dx = t1.clientX - t2.clientX;
  const dy = t1.clientY - t2.clientY;
  return Math.sqrt(dx * dx + dy * dy);
};

const getMidpoint = (t1: React.Touch, t2: React.Touch): Point => {
  return {
    x: (t1.clientX + t2.clientX) / 2,
    y: (t1.clientY + t2.clientY) / 2
  };
};

const rotatePoint = (p: Point, origin: Point, angle: number): Point => {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = p.x - origin.x;
  const dy = p.y - origin.y;
  return {
    x: origin.x + (dx * cos - dy * sin),
    y: origin.y + (dx * sin + dy * cos)
  };
};

const worldToLocal = (p: Point, layer: Layer, width: number, height: number): Point => {
  const cx = layer.x;
  const cy = layer.y;
  const unrotated = rotatePoint(p, { x: cx, y: cy }, -layer.rotation);
  const unscaledX = (unrotated.x - cx) / layer.scale;
  const unscaledY = (unrotated.y - cy) / layer.scale;
  return {
    x: unscaledX + width / 2,
    y: unscaledY + height / 2
  };
};

export const LiquifyCanvas: React.FC<LiquifyCanvasProps> = ({
  layers,
  activeLayerId,
  onInteractionEnd,
  onUpdateLayerPreview,
  tool,
  brushSettings,
  isProcessing,
  zoomLevel,
  setZoomLevel
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Viewport State
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  
  // Interaction State
  const [isDrawing, setIsDrawing] = useState(false);
  const [lastPoint, setLastPoint] = useState<Point | null>(null);
  const [lassoPath, setLassoPath] = useState<Point[]>([]);

  // Transform Tool State
  const [transformHandle, setTransformHandle] = useState<TransformHandle>(TransformHandle.NONE);
  const [startTransformState, setStartTransformState] = useState<{p: Point, layer: Layer} | null>(null);

  // Engine Refs
  const mapXRef = useRef<Float32Array | null>(null);
  const mapYRef = useRef<Float32Array | null>(null);
  const activeOriginalDataRef = useRef<ImageData | null>(null);
  const loadedLayerIdRef = useRef<string | null>(null);
  
  // Ref to latest layers to avoid closure staleness in event handlers
  const layersRef = useRef(layers);
  layersRef.current = layers;

  const lastPinchDist = useRef<number | null>(null);
  const lastPinchCenter = useRef<Point | null>(null);

  const getContext = () => canvasRef.current?.getContext('2d', { willReadFrequently: true });

  // ---------------------------------------------------------------------------
  // 1. Layer Engine Initialization
  // ---------------------------------------------------------------------------

  const initEngine = (layer: Layer) => {
    if (!layer.imageData) return;
    const w = layer.imageData.width;
    const h = layer.imageData.height;
    const count = w * h;
    
    // Reset Maps to Identity
    const newMapX = new Float32Array(count);
    const newMapY = new Float32Array(count);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        newMapX[i] = x;
        newMapY[i] = y;
      }
    }
    
    mapXRef.current = newMapX;
    mapYRef.current = newMapY;
    activeOriginalDataRef.current = layer.imageData;
    loadedLayerIdRef.current = layer.id;
  };

  useEffect(() => {
    const activeLayer = layers.find(l => l.id === activeLayerId);
    
    // Check if we need to re-init (Layer switch or Layer data changed externally e.g. Undo)
    // We check if the image data reference changed or id changed
    if (activeLayer && activeLayer.imageData) {
        if (loadedLayerIdRef.current !== activeLayerId || activeOriginalDataRef.current !== activeLayer.imageData) {
            initEngine(activeLayer);
        }
    } else {
        // No active layer or no data
        activeOriginalDataRef.current = null;
        mapXRef.current = null;
        mapYRef.current = null;
        loadedLayerIdRef.current = null;
    }
  }, [activeLayerId, layers]);

  // ---------------------------------------------------------------------------
  // 2. Committing Changes
  // ---------------------------------------------------------------------------

  // Bakes the current Map distortion into a new ImageData object
  const bakeCurrentWarp = (): ImageData | null => {
    if (!mapXRef.current || !mapYRef.current || !activeOriginalDataRef.current) return null;
    
    const w = activeOriginalDataRef.current.width;
    const h = activeOriginalDataRef.current.height;
    
    // Create temporary canvas to render the warp
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const output = ctx.createImageData(w, h);
    renderRegionFromMapsRef(output.data, 0, 0, w, h, w, h, mapXRef.current, mapYRef.current, activeOriginalDataRef.current);
    
    return output;
  };

  const handleCommit = () => {
    const activeLayer = layersRef.current.find(l => l.id === activeLayerId);
    
    if (tool === ToolType.TRANSFORM) {
         // Transform changes are already in 'layers' via onUpdateLayerPreview,
         // but we need to trigger the history commit.
         // Pass the current state of layers.
         onInteractionEnd(layersRef.current);
    } else if (tool === ToolType.LASSO) {
         // Lasso commits handled inside applyLassoMask
         // but that function calls internal logic.
    } else {
         // Warp Tools
         if (activeLayer) {
             const bakedData = bakeCurrentWarp();
             if (bakedData) {
                 const updatedLayers = layersRef.current.map(l => 
                     l.id === activeLayerId ? { ...l, imageData: bakedData } : l
                 );
                 
                 // IMPORTANT: Reset the engine maps because the base image is now warped.
                 // If we don't reset, we apply the warp twice (once in pixel data, once in map).
                 initEngine({ ...activeLayer, imageData: bakedData });
                 
                 onInteractionEnd(updatedLayers);
             }
         }
    }
  };

  // ---------------------------------------------------------------------------
  // 3. Rendering
  // ---------------------------------------------------------------------------

  const renderRegionFromMapsRef = (
    outputBuffer: Uint8ClampedArray,
    startX: number, startY: number, regionW: number, regionH: number,
    totalW: number, totalH: number,
    mapX: Float32Array, mapY: Float32Array, original: ImageData
  ) => {
    const originalPixels = original.data;
    const origW = original.width;
    const origH = original.height;

    for (let y = 0; y < regionH; y++) {
      for (let x = 0; x < regionW; x++) {
        const globalX = startX + x;
        const globalY = startY + y;
        
        const pIndex = globalY * totalW + globalX;
        const srcX = mapX[pIndex];
        const srcY = mapY[pIndex];

        const x0 = Math.floor(srcX);
        const x1 = x0 + 1;
        const y0 = Math.floor(srcY);
        const y1 = y0 + 1;

        const sx0 = Math.max(0, Math.min(origW - 1, x0));
        const sx1 = Math.max(0, Math.min(origW - 1, x1));
        const sy0 = Math.max(0, Math.min(origH - 1, y0));
        const sy1 = Math.max(0, Math.min(origH - 1, y1));

        const u = srcX - x0;
        const v = srcY - y0;

        const i00 = (sy0 * origW + sx0) * 4;
        const i10 = (sy0 * origW + sx1) * 4;
        const i01 = (sy1 * origW + sx0) * 4;
        const i11 = (sy1 * origW + sx1) * 4;

        const outIndex = (y * regionW + x) * 4;

        for (let c = 0; c < 4; c++) {
           outputBuffer[outIndex + c] = 
             (originalPixels[i00 + c] * (1 - u) * (1 - v)) +
             (originalPixels[i10 + c] * u * (1 - v)) +
             (originalPixels[i01 + c] * (1 - u) * v) +
             (originalPixels[i11 + c] * u * v);
        }
      }
    }
  };

  const drawTransformGizmo = (ctx: CanvasRenderingContext2D, layer: Layer, w: number, h: number) => {
    ctx.save();
    ctx.translate(layer.x, layer.y);
    ctx.rotate(layer.rotation);
    ctx.scale(layer.scale, layer.scale);
    
    const hw = w / 2;
    const hh = h / 2;
    
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2 / layer.scale / zoomLevel;
    ctx.strokeRect(-hw, -hh, w, h);

    const handleSize = 10 / layer.scale / zoomLevel;
    ctx.fillStyle = 'white';
    ctx.strokeStyle = '#3b82f6';
    
    const drawHandle = (x: number, y: number) => {
        ctx.beginPath();
        ctx.rect(x - handleSize/2, y - handleSize/2, handleSize, handleSize);
        ctx.fill();
        ctx.stroke();
    };

    drawHandle(-hw, -hh); // TL
    drawHandle(hw, -hh);  // TR
    drawHandle(-hw, hh);  // BL
    drawHandle(hw, hh);   // BR

    ctx.beginPath();
    ctx.moveTo(0, -hh);
    ctx.lineTo(0, -hh - (30 / layer.scale / zoomLevel));
    ctx.stroke();
    
    ctx.beginPath();
    ctx.arc(0, -hh - (30 / layer.scale / zoomLevel), handleSize / 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  };

  const redrawComposed = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = getContext();
    if (!canvas || !ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    
    // Global Viewport
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(zoomLevel, zoomLevel);
    ctx.translate(offset.x, offset.y);
    
    // Background Grid
    const gridRange = 4000;
    ctx.fillStyle = '#1e1e1e';
    ctx.fillRect(-gridRange, -gridRange, gridRange*2, gridRange*2);
    
    // Render Layers
    layers.forEach(layer => {
      if (!layer.visible || !layer.imageData) return;

      ctx.save();
      
      ctx.translate(layer.x, layer.y);
      ctx.rotate(layer.rotation);
      ctx.scale(layer.scale, layer.scale);

      ctx.globalAlpha = layer.opacity;
      ctx.globalCompositeOperation = layer.blendMode;

      const lw = layer.imageData.width;
      const lh = layer.imageData.height;
      const dx = -lw / 2;
      const dy = -lh / 2;

      // If this is the active layer AND we are currently manipulating it via Warp engine
      if (layer.id === activeLayerId && mapXRef.current && mapYRef.current && activeOriginalDataRef.current) {
        const tempC = document.createElement('canvas');
        tempC.width = lw;
        tempC.height = lh;
        const tCtx = tempC.getContext('2d');
        if (tCtx) {
            const imgData = tCtx.createImageData(lw, lh);
            renderRegionFromMapsRef(imgData.data, 0, 0, lw, lh, lw, lh, mapXRef.current, mapYRef.current, activeOriginalDataRef.current);
            tCtx.putImageData(imgData, 0, 0);
            ctx.drawImage(tempC, dx, dy);
        }
      } else {
        const tempC = document.createElement('canvas');
        tempC.width = lw;
        tempC.height = lh;
        tempC.getContext('2d')?.putImageData(layer.imageData, 0, 0);
        ctx.drawImage(tempC, dx, dy);
      }
      
      ctx.restore();
    });

    // Overlays
    const activeLayer = layers.find(l => l.id === activeLayerId);
    if (tool === ToolType.TRANSFORM && activeLayer && activeLayer.imageData) {
        drawTransformGizmo(ctx, activeLayer, activeLayer.imageData.width, activeLayer.imageData.height);
    }

    if (tool === ToolType.LASSO && lassoPath.length > 0) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.strokeStyle = '#ffff00';
      ctx.lineWidth = 2 / zoomLevel;
      ctx.setLineDash([5 / zoomLevel, 5 / zoomLevel]);
      if (lassoPath.length > 0) {
          ctx.moveTo(lassoPath[0].x, lassoPath[0].y);
          for (let i = 1; i < lassoPath.length; i++) {
            ctx.lineTo(lassoPath[i].x, lassoPath[i].y);
          }
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();
  }, [layers, activeLayerId, zoomLevel, offset, tool, lassoPath]);

  useEffect(() => {
    let handle: number;
    const loop = () => {
        redrawComposed();
        handle = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(handle);
  }, [redrawComposed]);

  // ---------------------------------------------------------------------------
  // 4. Interactions
  // ---------------------------------------------------------------------------

  const getPointerWorldPos = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const screenX = clientX - rect.left - rect.width / 2;
    const screenY = clientY - rect.top - rect.height / 2;
    return { x: (screenX / zoomLevel) - offset.x, y: (screenY / zoomLevel) - offset.y };
  };

  const hitTestTransform = (worldPos: Point, layer: Layer, w: number, h: number): TransformHandle => {
      const local = worldToLocal(worldPos, layer, w, h);
      const lx = local.x - w/2;
      const ly = local.y - h/2;
      const handleRadius = 15 / zoomLevel / layer.scale;

      const rotateY = -h/2 - (30 / layer.scale); 
      if (Math.abs(lx - 0) < handleRadius && Math.abs(ly - rotateY) < handleRadius) return TransformHandle.ROTATE;

      if (Math.abs(lx - (-w/2)) < handleRadius && Math.abs(ly - (-h/2)) < handleRadius) return TransformHandle.TOP_LEFT;
      if (Math.abs(lx - (w/2)) < handleRadius && Math.abs(ly - (-h/2)) < handleRadius) return TransformHandle.TOP_RIGHT;
      if (Math.abs(lx - (-w/2)) < handleRadius && Math.abs(ly - (h/2)) < handleRadius) return TransformHandle.BOTTOM_LEFT;
      if (Math.abs(lx - (w/2)) < handleRadius && Math.abs(ly - (h/2)) < handleRadius) return TransformHandle.BOTTOM_RIGHT;

      if (lx > -w/2 && lx < w/2 && ly > -h/2 && ly < h/2) return TransformHandle.BODY;

      return TransformHandle.NONE;
  };

  const onStart = (clientX: number, clientY: number) => {
    setIsDrawing(true);
    const p = getPointerWorldPos(clientX, clientY);
    
    if (tool === ToolType.TRANSFORM) {
        const layer = layersRef.current.find(l => l.id === activeLayerId);
        if (layer && layer.imageData) {
            const handle = hitTestTransform(p, layer, layer.imageData.width, layer.imageData.height);
            setTransformHandle(handle);
            setStartTransformState({ p, layer: { ...layer } });
        }
    } else if (tool === ToolType.LASSO) {
        setLassoPath([p]);
    } else {
        setLastPoint(p);
    }
  };

  const onMove = (clientX: number, clientY: number) => {
    if (!isDrawing) return;
    const p = getPointerWorldPos(clientX, clientY);

    if (tool === ToolType.TRANSFORM) {
        if (startTransformState && transformHandle !== TransformHandle.NONE) {
            const { p: startP, layer: startLayer } = startTransformState;
            const dx = p.x - startP.x;
            const dy = p.y - startP.y;
            let updates: Partial<Layer> = {};

            if (transformHandle === TransformHandle.BODY) {
                updates = { x: startLayer.x + dx, y: startLayer.y + dy };
            } else if (transformHandle === TransformHandle.ROTATE) {
                const cx = startLayer.x;
                const cy = startLayer.y;
                const angle = Math.atan2(p.y - cy, p.x - cx);
                updates = { rotation: angle + Math.PI / 2 };
            } else {
                const cx = startLayer.x;
                const cy = startLayer.y;
                const startDist = Math.sqrt(Math.pow(startP.x - cx, 2) + Math.pow(startP.y - cy, 2));
                const currentDist = Math.sqrt(Math.pow(p.x - cx, 2) + Math.pow(p.y - cy, 2));
                const scaleFactor = currentDist / Math.max(startDist, 0.01);
                updates = { scale: startLayer.scale * scaleFactor };
            }
            onUpdateLayerPreview(activeLayerId, updates);
        }
    } else if (tool === ToolType.LASSO) {
        setLassoPath(prev => [...prev, p]);
    } else {
        // Warp Tool
        if (lastPoint && activeOriginalDataRef.current) {
            const layer = layersRef.current.find(l => l.id === activeLayerId);
            if (layer) {
                const w = activeOriginalDataRef.current.width;
                const h = activeOriginalDataRef.current.height;
                const localCurr = worldToLocal(p, layer, w, h);
                const localPrev = worldToLocal(lastPoint, layer, w, h);
                applyDistortion(localCurr.x, localCurr.y, localPrev.x, localPrev.y);
            }
            setLastPoint(p);
        }
    }
  };

  const onEnd = () => {
    if (!isDrawing) return; // Prevention
    setIsDrawing(false);
    setLastPoint(null);
    lastPinchDist.current = null;
    setTransformHandle(TransformHandle.NONE);
    setStartTransformState(null);
    
    if (tool === ToolType.LASSO) {
        applyLassoMask();
    } else {
        // Commit changes to history
        handleCommit();
    }
  };

  const applyLassoMask = () => {
    if (lassoPath.length < 3 || !activeOriginalDataRef.current) return;
    const activeLayer = layersRef.current.find(l => l.id === activeLayerId);
    if (!activeLayer) return;

    const w = activeOriginalDataRef.current.width;
    const h = activeOriginalDataRef.current.height;
    
    // Check if we have pending warp changes? 
    // Usually Lasso is used clean. If there is warp, we should probably bake it first.
    // Ideally we bake warp first.
    let workingData = activeOriginalDataRef.current;
    if (mapXRef.current && mapYRef.current) {
        const baked = bakeCurrentWarp();
        if (baked) workingData = baked;
    }

    // Rasterize polygon to a mask
    const maskC = document.createElement('canvas');
    maskC.width = w;
    maskC.height = h;
    const mCtx = maskC.getContext('2d')!;
    mCtx.fillStyle = 'black';
    mCtx.fillRect(0,0,w,h);
    
    mCtx.beginPath();
    const p0 = worldToLocal(lassoPath[0], activeLayer, w, h);
    mCtx.moveTo(p0.x, p0.y);
    for(let i=1; i<lassoPath.length; i++) {
        const pi = worldToLocal(lassoPath[i], activeLayer, w, h);
        mCtx.lineTo(pi.x, pi.y);
    }
    mCtx.closePath();
    mCtx.fillStyle = 'white';
    mCtx.fill();
    
    const maskData = mCtx.getImageData(0,0,w,h).data;
    // Create new buffer for result
    const newPixels = new Uint8ClampedArray(workingData.data);

    for(let i=0; i<newPixels.length; i+=4) {
        if(maskData[i] === 0) newPixels[i+3] = 0;
    }
    
    const finalData = new ImageData(newPixels, w, h);
    
    // Commit
    const updatedLayers = layersRef.current.map(l => 
        l.id === activeLayerId ? { ...l, imageData: finalData } : l
    );
    // Reset engine
    initEngine({ ...activeLayer, imageData: finalData });
    setLassoPath([]);
    onInteractionEnd(updatedLayers);
  };

  const applyDistortion = (mouseX: number, mouseY: number, prevX: number, prevY: number) => {
    if (!mapXRef.current || !mapYRef.current || !activeOriginalDataRef.current) return;
    
    const mapX = mapXRef.current;
    const mapY = mapYRef.current;
    const w = activeOriginalDataRef.current.width;
    const h = activeOriginalDataRef.current.height;

    const { size, strength } = brushSettings;
    const layer = layersRef.current.find(l => l.id === activeLayerId);
    const scale = layer ? layer.scale : 1;
    const localRadius = (size / 2) / zoomLevel / scale;
    const radiusSq = localRadius * localRadius;
    
    const minX = Math.max(0, Math.floor(mouseX - localRadius));
    const minY = Math.max(0, Math.floor(mouseY - localRadius));
    const maxX = Math.min(w, Math.ceil(mouseX + localRadius));
    const maxY = Math.min(h, Math.ceil(mouseY + localRadius));
    
    const regionW = maxX - minX;
    const regionH = maxY - minY;

    if (regionW <= 0 || regionH <= 0) return;

    const tempMapX = new Float32Array(regionW * regionH);
    const tempMapY = new Float32Array(regionW * regionH);
    
    const dx = mouseX - prevX;
    const dy = mouseY - prevY;

    for (let y = 0; y < regionH; y++) {
      for (let x = 0; x < regionW; x++) {
        const globalX = minX + x;
        const globalY = minY + y;
        
        const offsetX = globalX - mouseX;
        const offsetY = globalY - mouseY;
        const distSq = offsetX * offsetX + offsetY * offsetY;

        if (distSq < radiusSq) {
          const dist = Math.sqrt(distSq);
          const factor = (localRadius - dist) / localRadius;
          const smoothFactor = factor * factor * (3 - 2 * factor);
          const power = smoothFactor * strength;

          let sourceLookupX = globalX;
          let sourceLookupY = globalY;

          if (tool === ToolType.WARP) {
             sourceLookupX = globalX - dx * power;
             sourceLookupY = globalY - dy * power;
          } else if (tool === ToolType.BLOAT) {
             sourceLookupX = globalX - offsetX * power * 0.1;
             sourceLookupY = globalY - offsetY * power * 0.1;
          } else if (tool === ToolType.PUCKER) {
             sourceLookupX = globalX + offsetX * power * 0.1;
             sourceLookupY = globalY + offsetY * power * 0.1;
          } else if (tool === ToolType.TWIRL_CW) {
             const angle = 0.1 * power; 
             const sin = Math.sin(angle);
             const cos = Math.cos(angle);
             const rotX = offsetX * cos - offsetY * sin;
             const rotY = offsetX * sin + offsetY * cos;
             sourceLookupX = (mouseX + rotX);
             sourceLookupY = (mouseY + rotY);
          }

          const sample = (arr: Float32Array, u: number, v: number) => {
            const x0 = Math.floor(u);
            const x1 = x0 + 1;
            const y0 = Math.floor(v);
            const y1 = y0 + 1;
            const sx0 = Math.max(0, Math.min(w - 1, x0));
            const sx1 = Math.max(0, Math.min(w - 1, x1));
            const sy0 = Math.max(0, Math.min(h - 1, y0));
            const sy1 = Math.max(0, Math.min(h - 1, y1));
            const mu = u - x0;
            const mv = v - y0;
            return (arr[sy0 * w + sx0] * (1 - mu) * (1 - mv)) +
                   (arr[sy0 * w + sx1] * mu * (1 - mv)) +
                   (arr[sy1 * w + sx0] * (1 - mu) * mv) +
                   (arr[sy1 * w + sx1] * mu * mv);
          };

          tempMapX[y * regionW + x] = sample(mapX, sourceLookupX, sourceLookupY);
          tempMapY[y * regionW + x] = sample(mapY, sourceLookupX, sourceLookupY);
        } else {
           const idx = globalY * w + globalX;
           tempMapX[y * regionW + x] = mapX[idx];
           tempMapY[y * regionW + x] = mapY[idx];
        }
      }
    }

    for (let y = 0; y < regionH; y++) {
      for (let x = 0; x < regionW; x++) {
         const idx = (minY + y) * w + (minX + x);
         mapX[idx] = tempMapX[y * regionW + x];
         mapY[idx] = tempMapY[y * regionW + x];
      }
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    onStart(e.clientX, e.clientY);
  };
  const handleMouseMove = (e: React.MouseEvent) => onMove(e.clientX, e.clientY);
  const handleMouseUp = onEnd;

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      onStart(e.touches[0].clientX, e.touches[0].clientY);
    } else if (e.touches.length === 2) {
      setIsDrawing(false);
      lastPinchDist.current = getDistance(e.touches[0], e.touches[1]);
      lastPinchCenter.current = getMidpoint(e.touches[0], e.touches[1]);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      onMove(e.touches[0].clientX, e.touches[0].clientY);
    } else if (e.touches.length === 2 && lastPinchDist.current && lastPinchCenter.current) {
        const newDist = getDistance(e.touches[0], e.touches[1]);
        const newCenter = getMidpoint(e.touches[0], e.touches[1]);
        const scaleFactor = newDist / lastPinchDist.current;
        const newZoom = Math.min(Math.max(zoomLevel * scaleFactor, 0.1), 5);
        const dx = newCenter.x - lastPinchCenter.current.x;
        const dy = newCenter.y - lastPinchCenter.current.y;
        setZoomLevel(newZoom);
        setOffset(prev => ({ x: prev.x + dx / zoomLevel, y: prev.y + dy / zoomLevel }));
        lastPinchDist.current = newDist;
        lastPinchCenter.current = newCenter;
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    const zoomSensitivity = -0.001;
    const newZoom = Math.min(Math.max(zoomLevel + e.deltaY * zoomSensitivity, 0.1), 5);
    setZoomLevel(newZoom);
  };

  return (
    <div className="flex-1 flex items-center justify-center bg-gray-950 overflow-hidden relative cursor-crosshair touch-none">
       {layers.length === 0 && (
        <div className="text-gray-500 text-center pointer-events-none absolute z-10">
          <p className="mb-2 text-xl font-semibold">No Image Loaded</p>
        </div>
      )}
      <canvas
        ref={canvasRef}
        width={window.innerWidth}
        height={window.innerHeight}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={onEnd}
        onWheel={handleWheel}
        className={`shadow-2xl ${isProcessing ? 'opacity-50' : ''}`}
        style={{ touchAction: 'none' }} 
      />
    </div>
  );
};
