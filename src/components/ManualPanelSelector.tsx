
import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Scissors, Check, X, Plus, ZoomIn, ZoomOut, Maximize, Move, ArrowsUpFromLine, Sparkles, Loader2 } from 'lucide-react';
import { detectPanels } from '../services/gemini';
import { cropImage, isBlankImage } from '../services/imageProcessing';

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
  id?: string; // Preserve panel ID
}

interface ManualPanelSelectorProps {
  images: string[];
  initialPageIndex?: number;
  initialRects?: { pageIndex: number; rects: Rect[] }[];
  onComplete: (rectsByPage: { pageIndex: number; rects: Rect[] }[]) => void;
  onCancel: () => void;
}

export function ManualPanelSelector({ images, initialPageIndex = 0, initialRects = [], onComplete, onCancel }: ManualPanelSelectorProps) {
  const [currentPageIndex, setCurrentPageIndex] = useState(initialPageIndex);
  const [allRects, setAllRects] = useState<{ pageIndex: number; rects: Rect[] }[]>(initialRects);
  const [currentPageRects, setCurrentPageRects] = useState<Rect[]>([]);
  const [currentRect, setCurrentRect] = useState<Rect | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [resizingIndex, setResizingIndex] = useState<number | null>(null);
  const [resizeHandle, setResizeHandle] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [lastMousePos, setLastMousePos] = useState({ x: 0, y: 0 });
  const [fitMode, setFitMode] = useState<'screen' | 'width' | 'height'>('width');
  
  const [isSnapping, setIsSnapping] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const handleAISnapCurrentPage = async () => {
    setIsSnapping(true);
    try {
      const pageBase64 = images[currentPageIndex];
      let detectedRects = await detectPanels(pageBase64);
      
      // Filter out noise
      detectedRects = detectedRects.filter((r: {width: number, height: number}) => {
        const area = (r.width * r.height) / 10000;
        const aspectRatio = r.width / r.height;
        return area > 0.05 && aspectRatio > 0.05 && aspectRatio < 20;
      });

      if (detectedRects.length === 0) {
        alert("AI did not find any panels on this page. Try manual selection.");
        return;
      }

      // Sort Manga-style (top-to-bottom, right-to-left)
      detectedRects.sort((a: any, b: any) => {
        const yDiff = Math.abs(a.y - b.y);
        const rowThreshold = Math.min(a.height, b.height) * 0.4;
        if (yDiff < rowThreshold) {
          return b.x - a.x;
        }
        return a.y - b.y;
      });

      const newRects = [];
      for (const r of detectedRects) {
        const cropped = await cropImage(pageBase64, r, false);
        if (cropped) {
          const isBlank = await isBlankImage(cropped);
          if (isBlank) {
            console.log("Filtered blank panel in manual panel selector snap:", r);
            continue;
          }
        }
        newRects.push({
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height
        });
      }

      setCurrentPageRects(newRects);
    } catch (err: any) {
      console.error(err);
      alert("AI Snapping failed: " + err.message);
    } finally {
      setIsSnapping(false);
    }
  };

  useEffect(() => {
    const existing = allRects.find(r => r.pageIndex === currentPageIndex);
    setCurrentPageRects(existing ? existing.rects : []);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [currentPageIndex, allRects]);

  const saveCurrentPageRects = () => {
    setAllRects(prev => {
      const filtered = prev.filter(r => r.pageIndex !== currentPageIndex);
      return [...filtered, { pageIndex: currentPageIndex, rects: currentPageRects }];
    });
  };

  const handleNext = () => {
    saveCurrentPageRects();
    if (currentPageIndex < images.length - 1) {
      setCurrentPageIndex(currentPageIndex + 1);
    } else {
      const finalRects = allRects.filter(r => r.pageIndex !== currentPageIndex);
      onComplete([...finalRects, { pageIndex: currentPageIndex, rects: currentPageRects }]);
    }
  };

  const handlePrev = () => {
    saveCurrentPageRects();
    if (currentPageIndex > 0) {
      setCurrentPageIndex(currentPageIndex - 1);
    }
  };

  const getNormalizedCoords = (e: React.MouseEvent | MouseEvent) => {
    if (!imgRef.current) return null;
    const rect = imgRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 1000;
    const y = ((e.clientY - rect.top) / rect.height) * 1000;
    return { x: Math.max(0, Math.min(1000, x)), y: Math.max(0, Math.min(1000, y)) };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1 || e.altKey) {
      setIsPanning(true);
      setLastMousePos({ x: e.clientX, y: e.clientY });
      return;
    }

    const coords = getNormalizedCoords(e);
    if (!coords) return;

    const target = e.target as HTMLElement;
    if (target.dataset.handle && target.dataset.index !== undefined) {
      setResizingIndex(parseInt(target.dataset.index));
      setResizeHandle(target.dataset.handle);
      return;
    }

    setIsDrawing(true);
    setCurrentRect({ x: coords.x, y: coords.y, width: 0, height: 0 });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      const dx = e.clientX - lastMousePos.x;
      const dy = e.clientY - lastMousePos.y;
      setPan(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      setLastMousePos({ x: e.clientX, y: e.clientY });
      return;
    }

    const coords = getNormalizedCoords(e);
    if (!coords) return;

    if (resizingIndex !== null && resizeHandle) {
      setCurrentPageRects(prev => {
        const next = [...prev];
        const rect = { ...next[resizingIndex] };
        
        if (resizeHandle.includes('e')) rect.width = coords.x - rect.x;
        if (resizeHandle.includes('s')) rect.height = coords.y - rect.y;
        if (resizeHandle.includes('w')) {
          const right = rect.x + rect.width;
          rect.x = coords.x;
          rect.width = right - coords.x;
        }
        if (resizeHandle.includes('n')) {
          const bottom = rect.y + rect.height;
          rect.y = coords.y;
          rect.height = bottom - coords.y;
        }
        
        next[resizingIndex] = rect;
        return next;
      });
      return;
    }

    if (!isDrawing || !currentRect) return;
    setCurrentRect(prev => prev ? ({
      ...prev,
      width: coords.x - prev.x,
      height: coords.y - prev.y
    }) : null);
  };

  const handleMouseUp = () => {
    setIsPanning(false);
    setResizingIndex(null);
    setResizeHandle(null);

    if (!isDrawing || !currentRect) return;
    setIsDrawing(false);
    
    if (Math.abs(currentRect.width) > 5 && Math.abs(currentRect.height) > 5) {
      const normalized = {
        x: currentRect.width < 0 ? currentRect.x + currentRect.width : currentRect.x,
        y: currentRect.height < 0 ? currentRect.y + currentRect.height : currentRect.y,
        width: Math.abs(currentRect.width),
        height: Math.abs(currentRect.height)
      };
      setCurrentPageRects([...currentPageRects, normalized]);
    }
    setCurrentRect(null);
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheelNative = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        const factor = e.deltaY > 0 ? 0.9 : 1.1;
        
        const container = containerRef.current;
        if (!container) return;
        
        const rect = container.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;

        setZoom(prevZoom => {
          const nextZoom = Math.max(0.1, Math.min(10, prevZoom * factor));
          
          // Adjust pan to keep the point under the mouse fixed
          // Formula for transform-origin: center center
          setPan(prevPan => ({
            x: prevPan.x + (prevZoom - nextZoom) * (mouseX - centerX),
            y: prevPan.y + (prevZoom - nextZoom) * (mouseY - centerY)
          }));
          
          return nextZoom;
        });
      } else {
        // Allow panning in all modes
        e.preventDefault();
        setPan(prev => ({
          x: prev.x - e.deltaX,
          y: prev.y - e.deltaY
        }));
      }
    };

    container.addEventListener('wheel', handleWheelNative, { passive: false });
    return () => container.removeEventListener('wheel', handleWheelNative);
  }, [zoom, fitMode]);

  const handleZoom = (delta: number) => {
    setZoom(prev => {
      const next = Math.max(0.1, Math.min(10, prev + delta));
      return next;
    });
  };

  const resetZoom = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setFitMode('screen');
  };

  const toggleFitMode = (mode: 'screen' | 'width' | 'height') => {
    setFitMode(mode);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const removeRect = (index: number) => {
    setCurrentPageRects(currentPageRects.filter((_, i) => i !== index));
  };

  return (
    <div className="relative h-screen w-screen bg-[#020617] overflow-hidden group/workspace">
      {/* Main Workspace - Truly Full Screen */}
      <main 
        ref={containerRef}
        className="absolute inset-0 bg-black/40 select-none z-0 overflow-hidden"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onContextMenu={(e) => e.preventDefault()}
        style={{ cursor: isPanning ? 'grabbing' : (resizingIndex !== null ? 'nwse-resize' : 'crosshair') }}
      >
        <div 
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
          style={{ 
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: 'center center'
          }}
        >
          <div className="relative shadow-[0_0_100px_rgba(0,0,0,0.5)] bg-white/5 pointer-events-auto">
            <img 
              ref={imgRef}
              src={images[currentPageIndex]} 
              className={`
                pointer-events-none block
                ${fitMode === 'width' ? 'w-[1200px] h-auto' : (fitMode === 'height' ? 'h-[90vh] w-auto' : 'max-w-[90vw] max-h-[90vh] object-contain')}
              `}
              alt="Comic Page"
            />
            
            {currentPageRects.map((rect, i) => (
              <div 
                key={i}
                className="absolute border-2 border-blue-500 bg-blue-500/20 group z-10"
                style={{
                  left: `${rect.x / 10}%`,
                  top: `${rect.y / 10}%`,
                  width: `${rect.width / 10}%`,
                  height: `${rect.height / 10}%`
                }}
              >
                <div className="absolute -top-3 -left-3 w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center text-[10px] font-bold text-white shadow-lg scale-75 origin-top-left">
                  {i + 1}
                </div>
                
                <div data-index={i} data-handle="nw" className="absolute -top-1.5 -left-1.5 w-4 h-4 bg-white border-2 border-blue-500 rounded-sm cursor-nw-resize z-20 transition-opacity" />
                <div data-index={i} data-handle="ne" className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-white border-2 border-blue-500 rounded-sm cursor-ne-resize z-20 transition-opacity" />
                <div data-index={i} data-handle="sw" className="absolute -bottom-1.5 -left-1.5 w-4 h-4 bg-white border-2 border-blue-500 rounded-sm cursor-sw-resize z-20 transition-opacity" />
                <div data-index={i} data-handle="se" className="absolute -bottom-1.5 -right-1.5 w-4 h-4 bg-white border-2 border-blue-500 rounded-sm cursor-se-resize z-20 transition-opacity" />
                
                <button 
                  onClick={(e) => { e.stopPropagation(); removeRect(i); }}
                  className="absolute top-1 right-1 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center text-white opacity-60 group-hover:opacity-100 transition-opacity shadow-lg hover:bg-red-600"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}

            {currentRect && (
              <div 
                className="absolute border-2 border-white border-dashed bg-white/10 z-10"
                style={{
                  left: `${(currentRect.width < 0 ? currentRect.x + currentRect.width : currentRect.x) / 10}%`,
                  top: `${(currentRect.height < 0 ? currentRect.y + currentRect.height : currentRect.y) / 10}%`,
                  width: `${Math.abs(currentRect.width) / 10}%`,
                  height: `${Math.abs(currentRect.height) / 10}%`
                }}
              />
            )}
          </div>
        </div>
      </main>

      {/* Floating Header */}
      <div className="absolute top-4 left-0 right-0 flex justify-center pointer-events-none z-50 px-4">
        <header className="flex flex-wrap items-center justify-between px-4 py-3 rounded-2xl border border-white/10 bg-black/90 backdrop-blur-2xl gap-3 shadow-[0_0_50px_rgba(0,0,0,0.5)] pointer-events-auto max-w-full">
          <div className="flex items-center gap-3 shrink-0">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-xl shadow-blue-500/40 shrink-0">
              <Scissors className="text-white w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-black text-white truncate tracking-tight">Page {currentPageIndex + 1}/{images.length}</h3>
              <span className="text-[8px] font-mono font-bold text-blue-400/60 uppercase tracking-[0.2em]">Manual Snap</span>
            </div>
          </div>

          <div className="flex items-center gap-2 bg-white/[0.05] p-1 rounded-xl border border-white/5 backdrop-blur-md overflow-x-auto no-scrollbar">
            <div className="flex gap-0.5">
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => toggleFitMode('screen')} 
                className={`h-8 px-3 rounded-lg text-[9px] font-bold uppercase tracking-widest transition-all ${fitMode === 'screen' ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'text-white/40 hover:bg-white/5 hover:text-white'}`}
              >
                Screen
              </Button>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => toggleFitMode('width')} 
                className={`h-8 px-3 rounded-lg text-[9px] font-bold uppercase tracking-widest transition-all ${fitMode === 'width' ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'text-white/40 hover:bg-white/5 hover:text-white'}`}
              >
                Width
              </Button>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => toggleFitMode('height')} 
                className={`h-8 px-3 rounded-lg text-[9px] font-bold uppercase tracking-widest transition-all ${fitMode === 'height' ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'text-white/40 hover:bg-white/5 hover:text-white'}`}
              >
                Height
              </Button>
            </div>
            <Separator orientation="vertical" className="h-4 bg-white/10 mx-0.5" />
            <div className="flex gap-0.5">
              <Button variant="ghost" size="icon" onClick={() => handleZoom(0.2)} className="h-8 w-8 text-white/40 hover:text-white hover:bg-white/5 rounded-lg">
                <ZoomIn className="w-3.5 h-3.5" />
              </Button>
              <Button variant="ghost" size="icon" onClick={() => handleZoom(-0.2)} className="h-8 w-8 text-white/40 hover:text-white hover:bg-white/5 rounded-lg">
                <ZoomOut className="w-3.5 h-3.5" />
              </Button>
              <Button variant="ghost" size="icon" onClick={resetZoom} className="h-8 w-8 text-white/40 hover:text-white hover:bg-white/5 rounded-lg">
                <Maximize className="w-3.5 h-3.5" />
              </Button>
            </div>
            <div className="px-2 text-[9px] font-mono font-bold text-blue-400/80 min-w-[40px] text-center">
              {Math.round(zoom * 100)}%
            </div>
          </div>
        </header>
      </div>

      {/* Floating Footer */}
      <div className="absolute bottom-6 left-0 right-0 flex justify-center pointer-events-none z-50 px-4">
        <footer className="px-6 py-4 rounded-2xl border border-white/10 bg-black/90 backdrop-blur-2xl flex flex-wrap items-center justify-between gap-4 shadow-[0_0_50px_rgba(0,0,0,0.5)] pointer-events-auto w-full max-w-4xl">
          <Button 
            variant="ghost" 
            onClick={onCancel} 
            className="text-white/40 hover:text-white hover:bg-white/5 h-10 px-6 font-black uppercase tracking-[0.2em] text-[9px] rounded-xl transition-all"
          >
            Cancel
          </Button>
          
          <div className="flex items-center gap-4">
            <Button
              onClick={handleAISnapCurrentPage}
              disabled={isSnapping}
              className="bg-purple-600 hover:bg-purple-700 text-white h-10 px-5 font-black uppercase tracking-[0.2em] text-[9px] rounded-xl flex items-center gap-2 shadow-xl shadow-purple-500/20"
            >
              {isSnapping ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Snapping...
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5 text-purple-200" />
                  AI Snap Page
                </>
              )}
            </Button>

            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-blue-600/5 rounded-xl border border-blue-500/10">
              <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
              <span className="text-[9px] font-mono font-bold text-blue-400/80 uppercase tracking-[0.2em]">
                {currentPageRects.length} Panels
              </span>
            </div>

            <div className="flex bg-white/[0.05] rounded-xl border border-white/5 p-1 gap-1 backdrop-blur-md">
              <Button 
                variant="ghost" 
                disabled={currentPageIndex === 0}
                onClick={handlePrev}
                className="text-white/60 hover:text-white hover:bg-white/5 h-10 px-6 font-black uppercase tracking-[0.15em] text-[9px] rounded-lg transition-all disabled:opacity-20"
              >
                Prev
              </Button>
              <Button 
                onClick={handleNext}
                className="bg-blue-600 hover:bg-blue-700 text-white h-10 px-8 font-black uppercase tracking-[0.2em] text-[9px] rounded-lg shadow-xl shadow-blue-500/40 transition-all hover:scale-[1.02] active:scale-[0.98]"
              >
                {currentPageIndex === images.length - 1 ? 'Finish' : 'Next'}
              </Button>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
