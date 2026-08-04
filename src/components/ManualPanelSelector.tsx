
import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Scissors, Check, X, Plus, ZoomIn, ZoomOut, Maximize, Move, ArrowsUpFromLine, Sparkles, Loader2, ChevronUp, ChevronDown, Hand, ArrowUp, ArrowDown } from 'lucide-react';
import { detectPanels } from '../services/gemini';
import { cropImage, isBlankImage } from '../services/imageProcessing';

import { toast } from 'sonner';

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
  id?: string; // Preserve panel ID
  label?: string; // Add global panel label
}

interface ManualPanelSelectorProps {
  chapterId?: string;
  images: string[];
  initialPageIndex?: number;
  initialRects?: { pageIndex: number; rects: Rect[] }[];
  onComplete: (rectsByPage: { pageIndex: number; rects: Rect[] }[], lastPageIndex: number) => void;
  onCancel: () => void;
  panelNumber?: number;
  globalStartNumber?: number;
}

export function ManualPanelSelector({ chapterId, images, initialPageIndex = 0, initialRects = [], onComplete, onCancel, panelNumber, globalStartNumber }: ManualPanelSelectorProps) {
  const [currentPageIndex, setCurrentPageIndex] = useState(initialPageIndex);
  const [allRects, setAllRects] = useState<{ pageIndex: number; rects: Rect[] }[]>(initialRects);
  const [currentPageRects, setCurrentPageRects] = useState<Rect[]>([]);

  const draftStorageKey = `panelflow_manual_snap_draft_${chapterId || 'global'}`;
  const [draftRestored, setDraftRestored] = useState(false);

  // Restore draft on mount if available
  useEffect(() => {
    try {
      const savedDraft = localStorage.getItem(draftStorageKey);
      if (savedDraft) {
        const parsed = JSON.parse(savedDraft);
        if (parsed && Array.isArray(parsed.allRects) && parsed.allRects.length > 0) {
          setAllRects(parsed.allRects);
          if (typeof parsed.pageIndex === 'number' && parsed.pageIndex < images.length) {
            setCurrentPageIndex(parsed.pageIndex);
          }
          setDraftRestored(true);
          toast.info("Manual snap draft dipulihkan secara otomatis!", { id: 'manual-snap-draft-restored' });
        }
      }
    } catch (e) {
      console.error("Failed to restore manual snap draft:", e);
    }
  }, [chapterId]);

  // Real-time draft auto-save effect
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const updatedAllRects = [
          ...allRects.filter(r => r.pageIndex !== currentPageIndex),
          { pageIndex: currentPageIndex, rects: currentPageRects }
        ];
        localStorage.setItem(draftStorageKey, JSON.stringify({
          pageIndex: currentPageIndex,
          allRects: updatedAllRects,
          timestamp: Date.now()
        }));
      } catch (e) {
        console.error("Failed to auto-save manual snap draft:", e);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [currentPageRects, allRects, currentPageIndex, draftStorageKey]);

  const clearDraft = () => {
    try {
      localStorage.removeItem(draftStorageKey);
    } catch (e) {}
  };
  const [currentRect, setCurrentRect] = useState<Rect | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [isPanMode, setIsPanMode] = useState(false);
  const [resizingIndex, setResizingIndex] = useState<number | null>(null);
  const [resizeHandle, setResizeHandle] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0.3);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [lastMousePos, setLastMousePos] = useState({ x: 0, y: 0 });
  const [fitMode, setFitMode] = useState<'screen' | 'width' | 'height'>('width');
  
  const [isSnapping, setIsSnapping] = useState(false);
  const [snappingIndex, setSnappingIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const getGlobalStartNumberForPage = (pageIdx: number) => {
    if (images.length === 1 && globalStartNumber) {
      return globalStartNumber;
    }
    let count = 0;
    for (let p = 0; p < pageIdx; p++) {
      const pageData = allRects.find(r => r.pageIndex === p);
      if (pageData) {
        count += pageData.rects.length;
      }
    }
    return count + 1;
  };

  const pageStartNumber = getGlobalStartNumberForPage(currentPageIndex);

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

  const handleAISnapSinglePanel = async (index: number) => {
    setSnappingIndex(index);
    try {
      const pageBase64 = images[currentPageIndex];
      const targetRect = currentPageRects[index];
      
      // We crop the image first with a margin to give AI context
      const margin = 50;
      const paddedRect = {
        x: Math.max(0, targetRect.x - margin),
        y: Math.max(0, targetRect.y - margin),
        width: Math.min(1000 - Math.max(0, targetRect.x - margin), targetRect.width + margin * 2),
        height: Math.min(1000 - Math.max(0, targetRect.y - margin), targetRect.height + margin * 2)
      };

      const croppedBase64 = await cropImage(pageBase64, paddedRect, false);
      if (!croppedBase64) {
        throw new Error("Failed to crop image for AI.");
      }

      const detectedRects = await detectPanels(croppedBase64);
      if (detectedRects.length === 0) {
        alert("AI did not detect any panels inside this crop. Try expanding the box slightly.");
        return;
      }

      // Take the largest detected panel
      const bestRect = detectedRects.sort((a: any, b: any) => (b.width * b.height) - (a.width * a.height))[0];

      // Convert cropped relative coords back to global coords
      const newGlobalRect = {
        x: paddedRect.x + (bestRect.x / 1000) * paddedRect.width,
        y: paddedRect.y + (bestRect.y / 1000) * paddedRect.height,
        width: (bestRect.width / 1000) * paddedRect.width,
        height: (bestRect.height / 1000) * paddedRect.height,
      };

      setCurrentPageRects(prev => {
        const next = [...prev];
        next[index] = {
          ...next[index],
          ...newGlobalRect
        };
        return next;
      });
    } catch (err: any) {
      console.error(err);
      alert("AI Snapping failed: " + err.message);
    } finally {
      setSnappingIndex(null);
    }
  };

  useEffect(() => {
    const existing = allRects.find(r => r.pageIndex === currentPageIndex);
    setCurrentPageRects(existing ? existing.rects : []);
    setZoom(0.3);
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
      clearDraft();
      const finalRects = allRects.filter(r => r.pageIndex !== currentPageIndex);
      onComplete([...finalRects, { pageIndex: currentPageIndex, rects: currentPageRects }], currentPageIndex);
    }
  };

  const handlePrev = () => {
    saveCurrentPageRects();
    if (currentPageIndex > 0) {
      setCurrentPageIndex(currentPageIndex - 1);
    }
  };

  const handleFinish = () => {
    clearDraft();
    const finalRects = allRects.filter(r => r.pageIndex !== currentPageIndex);
    onComplete([...finalRects, { pageIndex: currentPageIndex, rects: currentPageRects }], currentPageIndex);
  };

  const getNormalizedCoords = (e: React.MouseEvent | MouseEvent) => {
    if (!imgRef.current) return null;
    const rect = imgRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 1000;
    const y = ((e.clientY - rect.top) / rect.height) * 1000;
    return { x: Math.max(0, Math.min(1000, x)), y: Math.max(0, Math.min(1000, y)) };
  };

  const scrollbarTrackRef = useRef<HTMLDivElement>(null);
  const [isDraggingScrollbar, setIsDraggingScrollbar] = useState(false);

  const getMaxScrollY = () => {
    if (!imgRef.current || !containerRef.current) return 1000;
    const containerH = containerRef.current.clientHeight;
    const imgH = imgRef.current.clientHeight * zoom;
    return Math.max(400, (imgH + containerH) / 2);
  };

  const getScrollPercent = () => {
    const maxM = getMaxScrollY();
    const clampedY = Math.max(-maxM, Math.min(maxM, pan.y));
    return Math.round(((maxM - clampedY) / (2 * maxM)) * 100);
  };

  const setScrollFromPercent = (percent: number) => {
    const maxM = getMaxScrollY();
    const targetY = maxM - (Math.max(0, Math.min(100, percent)) / 100) * (2 * maxM);
    setPan(prev => ({ ...prev, y: targetY }));
  };

  const handleScrollbarPointer = (clientY: number) => {
    if (!scrollbarTrackRef.current) return;
    const rect = scrollbarTrackRef.current.getBoundingClientRect();
    const relativeY = clientY - rect.top;
    const clampedY = Math.max(0, Math.min(rect.height, relativeY));
    const percent = (clampedY / rect.height) * 100;
    setScrollFromPercent(percent);
  };

  useEffect(() => {
    if (!isDraggingScrollbar) return;

    const handlePointerMove = (e: PointerEvent) => {
      handleScrollbarPointer(e.clientY);
    };

    const handlePointerUp = () => {
      setIsDraggingScrollbar(false);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [isDraggingScrollbar, zoom]);

  const scrollBy = (amount: number) => {
    setPan(prev => ({ ...prev, y: prev.y + amount }));
  };

  const scrollToTop = () => {
    setScrollFromPercent(0);
  };

  const scrollToBottom = () => {
    setScrollFromPercent(100);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1 || e.altKey || isPanMode) {
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
        style={{ cursor: isPanning ? 'grabbing' : (isPanMode ? 'grab' : (resizingIndex !== null ? (resizeHandle === 'ne' || resizeHandle === 'sw' ? 'nesw-resize' : 'nwse-resize') : 'crosshair')) }}
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
            
            {currentPageRects.map((rect, i) => {
              const currentNum = pageStartNumber + i;
              const isTargetPanel = panelNumber && currentNum === panelNumber;
              return (
                <div 
                  key={i}
                  className={`absolute border-2 group z-10 transition-all ${isTargetPanel ? 'border-amber-400 bg-amber-500/10 ring-4 ring-amber-500/25 shadow-[0_0_30px_rgba(245,158,11,0.4)] animate-pulse' : 'border-blue-500 bg-blue-500/20'}`}
                  style={{
                    left: `${rect.x / 10}%`,
                    top: `${rect.y / 10}%`,
                    width: `${rect.width / 10}%`,
                    height: `${rect.height / 10}%`
                  }}
                >
                  <div 
                    onMouseDown={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      const newNumStr = window.prompt(`Enter new panel number for this panel (Current: ${currentNum}):`, currentNum.toString());
                      if (!newNumStr) return;
                      const newNum = parseInt(newNumStr);
                      if (isNaN(newNum)) return;
                      
                      const targetIndex = newNum - pageStartNumber;
                      if (targetIndex >= 0 && targetIndex < currentPageRects.length && targetIndex !== i) {
                        setCurrentPageRects(prev => {
                          const next = [...prev];
                          const [moved] = next.splice(i, 1);
                          next.splice(targetIndex, 0, moved);
                          return next;
                        });
                      } else {
                        alert(`Invalid panel number. For this page, please enter a number between ${pageStartNumber} and ${pageStartNumber + currentPageRects.length - 1}.`);
                      }
                    }}
                    title="Double-click to change panel number/order"
                    className={`absolute -top-10 -left-2 min-w-8 h-8 px-2 rounded-full flex items-center justify-center text-xs font-bold text-white shadow-lg origin-bottom-left transition-all cursor-pointer hover:scale-110 ${isTargetPanel ? 'bg-amber-500 border border-amber-300 shadow-amber-500/30' : 'bg-blue-600 shadow-blue-500/20'}`}
                    style={{ transform: `scale(${Math.max(0.3, Math.min(2.5, 1 / zoom))})`, zIndex: 30 }}
                  >
                    {rect.label || currentNum} {isTargetPanel && "★ TARGET"}
                  </div>
                
                <div data-index={i} data-handle="nw" className="absolute -top-3 -left-3 w-6 h-6 bg-white border-[3px] border-blue-500 rounded-sm cursor-nw-resize z-20 transition-opacity shadow-md" />
                <div data-index={i} data-handle="ne" className="absolute -top-3 -right-3 w-6 h-6 bg-white border-[3px] border-blue-500 rounded-sm cursor-ne-resize z-20 transition-opacity shadow-md" />
                <div data-index={i} data-handle="sw" className="absolute -bottom-3 -left-3 w-6 h-6 bg-white border-[3px] border-blue-500 rounded-sm cursor-sw-resize z-20 transition-opacity shadow-md" />
                <div data-index={i} data-handle="se" className="absolute -bottom-3 -right-3 w-6 h-6 bg-white border-[3px] border-blue-500 rounded-sm cursor-se-resize z-20 transition-opacity shadow-md" />
                
                <button 
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); removeRect(i); }}
                  className="absolute top-1 right-1 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center text-white opacity-60 group-hover:opacity-100 transition-opacity shadow-lg hover:bg-red-600 z-30"
                  title="Delete Panel"
                >
                  <X className="w-4 h-4" />
                </button>
                <button 
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); handleAISnapSinglePanel(i); }}
                  disabled={snappingIndex !== null}
                  className="absolute top-1 right-8 w-6 h-6 bg-indigo-500 rounded-full flex items-center justify-center text-white opacity-60 group-hover:opacity-100 transition-opacity shadow-lg hover:bg-indigo-600 z-30 disabled:opacity-50"
                  title="Auto Snap this panel"
                >
                  {snappingIndex === i ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                </button>
              </div>
              );
            })}

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

      {/* Interactive Vertical Scroll Bar */}
      <div className="absolute right-4 top-24 bottom-24 z-50 flex flex-col items-center justify-between py-4 px-2.5 rounded-2xl border border-white/10 bg-black/90 backdrop-blur-2xl shadow-[0_0_40px_rgba(0,0,0,0.6)] select-none w-14">
        <button 
          onClick={scrollToTop}
          className="text-[9px] font-mono font-bold text-blue-400/80 hover:text-blue-300 uppercase tracking-widest transition-colors mb-2 cursor-pointer"
          title="Scroll to Top (0%)"
        >
          TOP
        </button>

        {/* Scrollbar Track */}
        <div 
          ref={scrollbarTrackRef}
          onPointerDown={(e) => {
            setIsDraggingScrollbar(true);
            handleScrollbarPointer(e.clientY);
          }}
          className="relative flex-1 w-4 bg-white/10 hover:bg-white/20 rounded-full cursor-pointer transition-colors flex items-center justify-center my-1 group/track overflow-visible"
          title="Drag or click vertical scroll bar to scroll page up and down"
        >
          {/* Scrollbar Track Center Line */}
          <div className="w-0.5 h-full bg-blue-500/30 rounded-full" />

          {/* Scrollbar Thumb */}
          <div 
            className={`absolute w-7 h-10 bg-blue-600 hover:bg-blue-500 rounded-xl border-2 border-white/90 shadow-lg shadow-blue-500/50 flex flex-col items-center justify-center gap-0.5 transition-transform ${isDraggingScrollbar ? 'scale-110 bg-blue-500 ring-4 ring-blue-500/30' : ''}`}
            style={{ 
              top: `calc(${getScrollPercent()}% - 20px)`,
              left: '-6px'
            }}
          >
            <div className="w-3 h-0.5 bg-white/80 rounded-full" />
            <div className="w-3 h-0.5 bg-white/80 rounded-full" />
          </div>
        </div>

        <button 
          onClick={scrollToBottom}
          className="text-[9px] font-mono font-bold text-blue-400/80 hover:text-blue-300 uppercase tracking-widest transition-colors mt-2 cursor-pointer"
          title="Scroll to Bottom (100%)"
        >
          {getScrollPercent()}%
        </button>
      </div>

      {/* Floating Header */}
      <div className="absolute top-4 left-0 right-0 flex justify-center pointer-events-none z-50 px-4">
        <header className="flex flex-wrap items-center justify-between px-4 py-3 rounded-2xl border border-white/10 bg-black/90 backdrop-blur-2xl gap-3 shadow-[0_0_50px_rgba(0,0,0,0.5)] pointer-events-auto max-w-full">
          <div className="flex items-center gap-3 shrink-0">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-xl shadow-blue-500/40 shrink-0">
              <Scissors className="text-white w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-black text-white truncate tracking-tight">{images.length === 1 ? (panelNumber ? `Re-Snap Panel #${String(panelNumber).padStart(2, '0')}` : 'Re-Snap Panel') : `Page ${currentPageIndex + 1}/${images.length}`}</h3>
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
            <Separator orientation="vertical" className="h-4 bg-white/10 mx-0.5" />
            
            {/* Scroll & Pan Controls in Header */}
            <div className="flex items-center gap-0.5">
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => scrollBy(200)} 
                title="Scroll Ke Atas" 
                className="h-8 w-8 text-white/40 hover:text-white hover:bg-white/5 rounded-lg"
              >
                <ChevronUp className="w-4 h-4" />
              </Button>
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => setIsPanMode(prev => !prev)} 
                title={isPanMode ? "Mode Scroll Drag Aktif" : "Mode Draw Panel Aktif"}
                className={`h-8 w-8 rounded-lg transition-all ${isPanMode ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/30' : 'text-white/40 hover:bg-white/5 hover:text-white'}`}
              >
                <Hand className="w-3.5 h-3.5" />
              </Button>
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => scrollBy(-200)} 
                title="Scroll Ke Bawah" 
                className="h-8 w-8 text-white/40 hover:text-white hover:bg-white/5 rounded-lg"
              >
                <ChevronDown className="w-4 h-4" />
              </Button>
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
              {images.length > 1 && (
                <Button 
                  variant="ghost" 
                  disabled={currentPageIndex === 0}
                  onClick={handlePrev}
                  className="text-white/60 hover:text-white hover:bg-white/5 h-10 px-6 font-black uppercase tracking-[0.15em] text-[9px] rounded-lg transition-all disabled:opacity-20 mr-1"
                >
                  Prev
                </Button>
              )}
              {images.length > 1 && currentPageIndex < images.length - 1 && (
                <Button 
                  onClick={handleFinish}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white h-10 px-6 font-black uppercase tracking-[0.15em] text-[9px] rounded-lg transition-all hover:scale-[1.02] active:scale-[0.98] mr-1"
                >
                  Save & Exit
                </Button>
              )}
              <Button 
                onClick={handleNext}
                className="bg-blue-600 hover:bg-blue-700 text-white h-10 px-8 font-black uppercase tracking-[0.2em] text-[9px] rounded-lg shadow-xl shadow-blue-500/40 transition-all hover:scale-[1.02] active:scale-[0.98]"
              >
                {images.length === 1 ? 'OK' : (currentPageIndex === images.length - 1 ? 'Finish' : 'Finish & Next')}
              </Button>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
