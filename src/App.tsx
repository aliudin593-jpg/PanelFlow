/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Upload,
  Scissors,
  FileText,
  Play,
  Download,
  Plus,
  Trash2,
  X,
  Settings,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  GripVertical,
  Folder as FolderIcon,
  FolderPlus,
  Image as ImageIcon,
  Volume2,
  Save,
  Loader2,
  Undo2,
  Layout,
  Check,
  Music,
  Library,
  ChevronLeft,
  Edit,
  Grid,
  Grid3X3,
  LayoutGrid,
  Square,
  List,
  MoreVertical,
  Sparkles,
  Layers,
  Smartphone,
  Video,
  FolderDown,
  FolderUp
} from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { toast, Toaster } from 'sonner';
import confetti from 'canvas-confetti';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ModeToggle } from '@/components/mode-toggle';
import { UxGuide } from '@/components/ui/ux-guide';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger,
  DialogFooter
} from '@/components/ui/dialog';

import { Project, Panel, ComicChapter, Title, Category } from './types';
import { fileToBase64, cropImage, isBlankImage } from './services/imageProcessing';
import { detectPanels, generatePanelScripts, generateSpeech, generateSocialMetadata } from './services/gemini';
import { generateFreeSpeech } from './services/tts';
import { saveProjectToDB, loadProjectFromDB, exportProjectAsZip, importProjectFromZip } from './services/storage';

import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ManualPanelSelector } from './components/ManualPanelSelector';
import { speak, getAvailableVoices } from './services/audio';

const generateId = () => `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;

function SortableItem({ id, children, className }: { id: string, children: React.ReactNode, className?: string }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : 'auto',
    opacity: isDragging ? 0.8 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className={className} {...attributes} {...listeners}>
      {children}
    </div>
  );
}

export default function App() {
  const [project, setProject] = useState<Project>({
    id: 'default',
    name: 'Untitled Project',
    categories: [
      { id: 'manga', name: 'Manga', titleIds: [] },
      { id: 'manhwa', name: 'Manhwa', titleIds: [] },
      { id: 'manhua', name: 'Manhua', titleIds: [] }
    ],
    titles: [],
    chapters: [],
    settings: {
      globalVoiceId: '',
      globalSpeed: 1.0,
      musicVolume: 0.5,
      language: 'English',
      exportResolution: '1080p',
      exportQuality: 'High',
      scriptLength: 'Normal',
    }
  });

  const [currentCategoryId, setCurrentCategoryId] = useState<string | null>(null);
  const [currentTitleId, setCurrentTitleId] = useState<string | null>(null);

  const [selectedLibraryTitleIds, setSelectedLibraryTitleIds] = useState<Set<string>>(new Set());
  const [selectedLibraryChapterIds, setSelectedLibraryChapterIds] = useState<Set<string>>(new Set());

  const importInputRef = useRef<HTMLInputElement>(null);

  // Load draft on mount — IndexedDB, fallback to localStorage for migration
  useEffect(() => {
    const savedApiKey = localStorage.getItem('panelflow_gemini_api_key');
    if (savedApiKey) {
      import('./services/gemini').then(m => m.setCustomGeminiApiKey(savedApiKey));
    }
    
    (async () => {
      try {
        const saved = await loadProjectFromDB();
        if (saved) {
          setProject(saved);
          toast.info('Loaded your last draft');
          return;
        }
        // One-time migration from old localStorage draft
        const legacy = localStorage.getItem('panelflow_project');
        if (legacy) {
          const parsed = JSON.parse(legacy);
          setProject(parsed);
          await saveProjectToDB(parsed);
          localStorage.removeItem('panelflow_project');
          toast.info('Draft migrated to IndexedDB');
        }
      } catch (e) {
        console.error('Failed to load draft', e);
      }
    })();
  }, []);

  const saveDraft = async () => {
    try {
      await saveProjectToDB(project);
      toast.success('Draft saved!');
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#2563eb', '#ffffff']
      });
    } catch (e) {
      toast.error('Failed to save draft');
    }
  };

  const handleExportProject = async () => {
    try {
      toast.info('Packing project into ZIP...');
      await exportProjectAsZip(project);
      toast.success('Project exported as .panelflow file!');
    } catch (e: any) {
      toast.error('Export failed: ' + e.message);
    }
  };

  const handleImportProject = async (file: File) => {
    try {
      toast.info('Importing project...');
      const imported = await importProjectFromZip(file);
      setProject(imported);
      await saveProjectToDB(imported);
      toast.success(`Project "${imported.name}" imported!`);
      confetti({ particleCount: 80, spread: 60, origin: { y: 0.6 } });
    } catch (e: any) {
      toast.error('Import failed: ' + e.message);
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // 5px drag trigger threshold to allow clicking inputs
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setProject((prev) => {
        const currentChapterIndex = prev.chapters.findIndex((c: any) => c.id === prev.currentChapterId);
        if (currentChapterIndex === -1) return prev;
        
        const currentChapter = prev.chapters[currentChapterIndex];
        const oldIndex = currentChapter.panels.findIndex((p: any) => p.id === active.id);
        const newIndex = currentChapter.panels.findIndex((p: any) => p.id === over.id);
        
        const newPanels = arrayMove(currentChapter.panels, oldIndex, newIndex);
        // Correct the order property explicitly
        const orderedPanels = newPanels.map((p: any, idx: number) => ({ ...p, order: idx }));
        
        const updatedChapters = [...prev.chapters];
        updatedChapters[currentChapterIndex] = { ...currentChapter, panels: orderedPanels };
        
        return { ...prev, chapters: updatedChapters };
      });
    }
  };

  const [activeTab, setActiveTab] = useState('upload');
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentPanelIndex, setCurrentPanelIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const isPlayingRef = useRef(false);
  const [isExtendDialogOpen, setIsExtendDialogOpen] = useState(false);
  const [isSettingsDialogOpen, setIsSettingsDialogOpen] = useState(false);
  const [scriptGenerationAbortController, setScriptGenerationAbortController] = useState<AbortController | null>(null);
  const [apiKeyInputVal, setApiKeyInputVal] = useState(localStorage.getItem('panelflow_gemini_api_key') || '');
  const [editingPanelId, setEditingPanelId] = useState<string | null>(null);
  const [manualSelectionData, setManualSelectionData] = useState<{ chapterId: string; pageUrls: string[]; initialPageIndex: number; appendMode?: boolean; singlePanelMode?: boolean; initialRects?: {pageIndex: number, rects: any[]}[] } | null>(null);
  const [isManualSelectorOpen, setIsManualSelectorOpen] = useState(false);
  const [isAddTitleDialogOpen, setIsAddTitleDialogOpen] = useState(false);
  const [isRenameChapterDialogOpen, setIsRenameChapterDialogOpen] = useState(false);
  const [isDeleteChapterDialogOpen, setIsDeleteChapterDialogOpen] = useState(false);
  const [chapterToRename, setChapterToRename] = useState<ComicChapter | null>(null);
  const [chapterToDelete, setChapterToDelete] = useState<ComicChapter | null>(null);
  const [deletedPanelsStack, setDeletedPanelsStack] = useState<{chapterId: string, panel: Panel, index: number}[]>([]);
  const [newChapterName, setNewChapterName] = useState('');
  const [chapterViewMode, setChapterViewMode] = useState<'list' | 'grid-sm' | 'grid-md' | 'grid-lg'>('list');
  const [titleViewMode, setTitleViewMode] = useState<'list' | 'grid-sm' | 'grid-md' | 'grid-lg'>('grid-md');
  const [panelViewMode, setPanelViewMode] = useState<'list' | 'grid-sm' | 'grid-md' | 'grid-lg'>('grid-md');
  const [newTitleName, setNewTitleName] = useState('');
  const [autoDetectEnabled, setAutoDetectEnabled] = useState(true);
  const [exportProgress, setExportProgress] = useState(0);
  const [pendingUploadFiles, setPendingUploadFiles] = useState<File[] | null>(null);
  const [isUploadOptionsDialogOpen, setIsUploadOptionsDialogOpen] = useState(false);
  const [expandedChapterIds, setExpandedChapterIds] = useState<Set<string>>(new Set());

  // Wizard States
  const [wizardStep, setWizardStep] = useState(1);
  const [wizardTitleType, setWizardTitleType] = useState<'create' | 'select'>('create');
  const [wizardTitleName, setWizardTitleName] = useState('');
  const [wizardTitleId, setWizardTitleId] = useState('');
  const [wizardCategoryId, setWizardCategoryId] = useState('manga');
  const [wizardChapterName, setWizardChapterName] = useState('');
  const [wizardFiles, setWizardFiles] = useState<File[]>([]);

  const handlePageSort = (chapterId: string, sourceIndex: number, targetIndex: number) => {
    setProject(prev => {
      const updatedChapters = prev.chapters.map(c => {
        if (c.id === chapterId) {
          const newPages = [...c.pages];
          const [movedPage] = newPages.splice(sourceIndex, 1);
          newPages.splice(targetIndex, 0, movedPage);
          return { ...c, pages: newPages };
        }
        return c;
      });
      return { ...prev, chapters: updatedChapters };
    });
    toast.success("Page order updated!");
  };

  const handlePageMoveBetweenChapters = (sourceChapterId: string, sourceIndex: number, targetChapterId: string, targetIndex?: number) => {
    setProject(prev => {
      const sourceChapter = prev.chapters.find(c => c.id === sourceChapterId);
      const targetChapter = prev.chapters.find(c => c.id === targetChapterId);
      if (!sourceChapter || !targetChapter) return prev;

      const newSourcePages = [...sourceChapter.pages];
      const [movedPage] = newSourcePages.splice(sourceIndex, 1);

      const newTargetPages = [...targetChapter.pages];
      if (typeof targetIndex === 'number') {
        newTargetPages.splice(targetIndex, 0, movedPage);
      } else {
        newTargetPages.push(movedPage);
      }

      const panelsToMove = sourceChapter.panels.filter(p => p.fullPageUrl === movedPage);
      const remainingSourcePanels = sourceChapter.panels.filter(p => p.fullPageUrl !== movedPage).map((p, idx) => ({ ...p, order: idx }));
      
      const newTargetPanels = [...targetChapter.panels, ...panelsToMove].map((p, idx) => ({
        ...p,
        originalImageId: targetChapterId,
        order: idx
      }));

      return {
        ...prev,
        chapters: prev.chapters.map(c => {
          if (c.id === sourceChapterId) {
            return { ...c, pages: newSourcePages, panels: remainingSourcePanels };
          }
          if (c.id === targetChapterId) {
            return { ...c, pages: newTargetPages, panels: newTargetPanels };
          }
          return c;
        })
      };
    });
    toast.success("Moved page to another chapter!");
  };

  const handlePageMoveToTitle = (sourceChapterId: string, sourceIndex: number, targetTitleId: string) => {
    setProject(prev => {
      const sourceChapter = prev.chapters.find(c => c.id === sourceChapterId);
      if (!sourceChapter) return prev;

      const newSourcePages = [...sourceChapter.pages];
      const [movedPage] = newSourcePages.splice(sourceIndex, 1);

      const targetChapters = prev.chapters.filter(c => c.titleId === targetTitleId);
      let updatedChapters = [...prev.chapters];

      const panelsToMove = sourceChapter.panels.filter(p => p.fullPageUrl === movedPage);
      const remainingSourcePanels = sourceChapter.panels.filter(p => p.fullPageUrl !== movedPage).map((p, idx) => ({ ...p, order: idx }));

      if (targetChapters.length > 0) {
        const targetChapter = targetChapters[0];
        updatedChapters = updatedChapters.map(c => {
          if (c.id === sourceChapterId) {
            return { ...c, pages: newSourcePages, panels: remainingSourcePanels };
          }
          if (c.id === targetChapter.id) {
            const newPanels = [...c.panels, ...panelsToMove].map((p, idx) => ({ ...p, originalImageId: c.id, order: idx }));
            return { ...c, pages: [...c.pages, movedPage], panels: newPanels };
          }
          return c;
        });
      } else {
        const newChapterId = generateId();
        const newChapter: ComicChapter = {
          id: newChapterId,
          name: `Chapter from drag & drop`,
          titleId: targetTitleId,
          pages: [movedPage],
          panels: panelsToMove.map((p, idx) => ({ ...p, originalImageId: newChapterId, order: idx })),
          createdAt: Date.now()
        };
        updatedChapters = updatedChapters.map(c => {
          if (c.id === sourceChapterId) {
            return { ...c, pages: newSourcePages, panels: remainingSourcePanels };
          }
          return c;
        });
        updatedChapters.push(newChapter);
      }

      return { ...prev, chapters: updatedChapters };
    });
    toast.success("Moved page to another Title!");
  };

  const handlePageMoveToCategory = (sourceChapterId: string, sourceIndex: number, targetCategoryId: string) => {
    setProject(prev => {
      const sourceChapter = prev.chapters.find(c => c.id === sourceChapterId);
      if (!sourceChapter) return prev;

      const newSourcePages = [...sourceChapter.pages];
      const [movedPage] = newSourcePages.splice(sourceIndex, 1);

      const categoryTitles = prev.titles.filter(t => t.categoryId === targetCategoryId);
      let updatedChapters = [...prev.chapters];
      let updatedTitles = [...prev.titles];

      const panelsToMove = sourceChapter.panels.filter(p => p.fullPageUrl === movedPage);
      const remainingSourcePanels = sourceChapter.panels.filter(p => p.fullPageUrl !== movedPage).map((p, idx) => ({ ...p, order: idx }));

      let targetTitleId = '';
      if (categoryTitles.length > 0) {
        targetTitleId = categoryTitles[0].id;
      } else {
        targetTitleId = generateId();
        updatedTitles.push({
          id: targetTitleId,
          categoryId: targetCategoryId,
          name: `Quick Title from Move`,
          createdAt: Date.now()
        });
      }

      const targetChapters = updatedChapters.filter(c => c.titleId === targetTitleId);
      if (targetChapters.length > 0) {
        const targetChapter = targetChapters[0];
        updatedChapters = updatedChapters.map(c => {
          if (c.id === sourceChapterId) {
            return { ...c, pages: newSourcePages, panels: remainingSourcePanels };
          }
          if (c.id === targetChapter.id) {
            const newPanels = [...c.panels, ...panelsToMove].map((p, idx) => ({ ...p, originalImageId: c.id, order: idx }));
            return { ...c, pages: [...c.pages, movedPage], panels: newPanels };
          }
          return c;
        });
      } else {
        const newChapterId = generateId();
        const newChapter: ComicChapter = {
          id: newChapterId,
          name: `Chapter from Move`,
          titleId: targetTitleId,
          pages: [movedPage],
          panels: panelsToMove.map((p, idx) => ({ ...p, originalImageId: newChapterId, order: idx })),
          createdAt: Date.now()
        };
        updatedChapters = updatedChapters.map(c => {
          if (c.id === sourceChapterId) {
            return { ...c, pages: newSourcePages, panels: remainingSourcePanels };
          }
          return c;
        });
        updatedChapters.push(newChapter);
      }

      return { ...prev, titles: updatedTitles, chapters: updatedChapters };
    });
    toast.success("Moved page to Category!");
  };

  const handleWizardFinish = async () => {
    if (wizardFiles.length === 0) {
      toast.error("Please add at least one image/PDF file.");
      return;
    }
    
    let resolvedTitleId = '';
    let resolvedTitleName = '';
    
    if (wizardTitleType === 'create') {
      if (!wizardTitleName.trim()) {
        toast.error("Please enter a Title name.");
        return;
      }
      resolvedTitleId = generateId();
      resolvedTitleName = wizardTitleName.trim();
    } else {
      if (!wizardTitleId) {
        toast.error("Please select a Title.");
        return;
      }
      resolvedTitleId = wizardTitleId;
      resolvedTitleName = project.titles.find(t => t.id === wizardTitleId)?.name || 'Existing Title';
    }
    
    if (!wizardChapterName.trim()) {
      toast.error("Please enter a Chapter name.");
      return;
    }
    
    setIsProcessing(true);
    toast.info("Importing images & processing chapter...");
    
    try {
      // 1. Convert Files to Base64 (Pages)
      const base64Pages: string[] = [];
      for (const file of wizardFiles) {
        if (file.type === 'application/pdf') {
          const { pdfToImages } = await import('./services/imageProcessing');
          base64Pages.push(...(await pdfToImages(file)));
        } else {
          base64Pages.push(await fileToBase64(file));
        }
      }
      
      if (base64Pages.length === 0) {
        throw new Error("No pages could be extracted from files.");
      }
      
      // 2. Create ComicChapter
      const newChapterId = generateId();
      const newChapter: ComicChapter = {
        id: newChapterId,
        name: wizardChapterName.trim(),
        titleId: resolvedTitleId,
        pages: base64Pages,
        panels: [],
        createdAt: Date.now()
      };
      
      // 3. Update project structure
      setProject(prev => {
        const nextTitles = wizardTitleType === 'create' ? [...prev.titles, {
          id: resolvedTitleId,
          categoryId: wizardCategoryId,
          name: resolvedTitleName,
          createdAt: Date.now()
        }] : prev.titles;
        
        return {
          ...prev,
          titles: nextTitles,
          chapters: [...prev.chapters, newChapter],
          currentChapterId: newChapterId
        };
      });
      
      // Make sure UI lists open correct category and title
      setCurrentCategoryId(wizardCategoryId);
      setCurrentTitleId(resolvedTitleId);
      
      toast.success(`Chapter "${wizardChapterName.trim()}" created with ${base64Pages.length} pages! Starting Auto Snap...`);
      
      // Reset wizard
      setWizardStep(1);
      setWizardTitleName('');
      setWizardTitleId('');
      setWizardChapterName('');
      setWizardFiles([]);
      
      // 4. Automatically run Auto Snap over the newly created chapter!
      await processChapter(newChapter, 'auto');
      
    } catch (err: any) {
      console.error(err);
      toast.error("Wizard Upload failed: " + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const processChapter = async (chapter: ComicChapter, mode: 'auto' | 'manual') => {
    if (mode === 'manual') {
      const initialRects = chapter.pages.map((pageUrl, pageIndex) => ({
        pageIndex,
        rects: chapter.panels
          .filter(p => p.fullPageUrl === pageUrl)
          .map(p => ({ ...p.rect, id: p.id }))
      }));

      setManualSelectionData({ 
        chapterId: chapter.id, 
        pageUrls: chapter.pages, 
        initialPageIndex: 0,
        initialRects
      });
      setIsManualSelectorOpen(true);
      return;
    }

    setIsProcessing(true);
    try {
      const pageResults = [];
      for (let index = 0; index < chapter.pages.length; index++) {
        const pageBase64 = chapter.pages[index];
        if (index > 0) {
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
        try {
          // Process sequentially to avoid API rate limits and high high memory usage
          let detectedRects = await detectPanels(pageBase64);
          const rawCount = detectedRects.length;
          
          // Filter out noise: very small rects or extreme aspect ratios (gutters/lines)
          detectedRects = detectedRects.filter((r: {width: number, height: number}) => {
            const area = (r.width * r.height) / 10000; // area as % of page (0-100)
            const aspectRatio = r.width / r.height;
            // Drastically lowered filter to allow any small cropped face through
            return area > 0.05 && aspectRatio > 0.05 && aspectRatio < 20;
          });

          if (rawCount === 0) {
            toast.error(`Auto Snap failed: AI returned 0 panels on page ${index + 1}. Attempting to process as full page.`);
            // Fallback: use the whole page if AI completely failed
            detectedRects = [{ x: 0, y: 0, width: 1000, height: 1000 }];
          } else if (detectedRects.length === 0) {
            toast.error(`Auto Snap failed: Filtered out all ${rawCount} panels the AI found due to microscopic sizes.`);
            detectedRects = [{ x: 0, y: 0, width: 1000, height: 1000 }];
          }

          // Sort top-to-bottom heuristically, and right-to-left within rows (Manga style)
          detectedRects.sort((a: any, b: any) => {
            const yDiff = Math.abs(a.y - b.y);
            // If the vertical difference between tops is less than half their height, treat them as the same row
            const rowThreshold = Math.min(a.height, b.height) * 0.4;
            if (yDiff < rowThreshold) {
              return b.x - a.x; // High X to Low X (Right to Left)
            }
            return a.y - b.y; // Low Y to High Y (Top to Bottom)
          });

          const panels: Partial<Panel>[] = [];
          for (const rect of detectedRects) {
            const cropped = await cropImage(pageBase64, rect, false); // Disable autoTrim to respect AI's tight bounds
            if (cropped) {
              const isBlank = await isBlankImage(cropped);
              if (isBlank) {
                console.log("Filtered out blank panel crop at rect:", rect);
                continue;
              }
              panels.push({
                id: generateId(),
                imageUrl: cropped,
                fullPageUrl: pageBase64,
                originalImageId: chapter.id,
                rect,
                script: '',
                dialogue: '',
                duration: 3,
                voiceId: project.settings.globalVoiceId
              });
            }
          }
          pageResults.push({ index, panels });
        } catch (err) {
          console.error(`Failed detecting panels for page ${index}:`, err);
          pageResults.push({ index, panels: [] }); // Graceful degradation for failed pages
        }
      }

      // Restore original page sequence order
      pageResults.sort((a, b) => a.index - b.index);

      const allPanels: Panel[] = [];
      for (const res of pageResults) {
        for (const p of res.panels) {
          allPanels.push({ ...p, order: allPanels.length } as Panel);
        }
      }

      const processedChapter = { ...chapter, panels: allPanels };
      setProject(prev => ({
        ...prev,
        chapters: prev.chapters.some(c => c.id === chapter.id)
          ? prev.chapters.map(c => c.id === chapter.id ? processedChapter : c)
          : [...prev.chapters, processedChapter],
        currentChapterId: processedChapter.id
      }));
      toast.success(`Processed ${chapter.name} with ${allPanels.length} panels!`);
      setActiveTab('edit');
    } catch (e: any) {
      toast.error("Processing failed: " + e.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const ChapterItem = ({ chapter }: { chapter: ComicChapter }) => {
    const isExpanded = expandedChapterIds.has(chapter.id);
    return (
      <div className="flex flex-col gap-2">
        <div 
          className={`
            p-3 rounded-xl border transition-all duration-300 cursor-pointer flex items-center justify-between group relative
            ${project.currentChapterId === chapter.id 
              ? 'bg-blue-600/10 border-blue-500/50 shadow-lg shadow-blue-500/5' 
              : 'bg-white/[0.02] border-border/50 hover:border-border hover:bg-white/[0.04]'}
            ${selectedLibraryChapterIds.has(chapter.id) ? 'ring-2 ring-red-500 border-red-500' : ''}
          `}
          onDragOver={(e) => {
            e.preventDefault();
            e.currentTarget.classList.add('ring-2', 'ring-blue-500', 'border-blue-500');
          }}
          onDragLeave={(e) => {
            e.currentTarget.classList.remove('ring-2', 'ring-blue-500', 'border-blue-500');
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.currentTarget.classList.remove('ring-2', 'ring-blue-500', 'border-blue-500');
            try {
              const data = JSON.parse(e.dataTransfer.getData("application/json"));
              if (data && typeof data.pageIndex === 'number' && data.sourceChapterId !== chapter.id) {
                handlePageMoveBetweenChapters(data.sourceChapterId, data.pageIndex, chapter.id);
              }
            } catch (err) {
              console.error(err);
            }
          }}
        >
          <div 
            className="absolute left-3 top-1/2 -translate-y-1/2 z-20 cursor-pointer flex items-center gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              onClick={() => {
                const next = new Set(selectedLibraryChapterIds);
                if (next.has(chapter.id)) next.delete(chapter.id);
                else next.add(chapter.id);
                setSelectedLibraryChapterIds(next);
              }}
            >
              <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${selectedLibraryChapterIds.has(chapter.id) ? 'bg-red-500 border-red-500' : 'border-border bg-background/40 hover:border-border/500'}`}>
                {selectedLibraryChapterIds.has(chapter.id) && <Check className="w-3 h-3 text-foreground" />}
              </div>
            </div>

            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-foreground/40 hover:text-foreground hover:bg-foreground/10 rounded-lg p-0"
              onClick={() => {
                const next = new Set(expandedChapterIds);
                if (next.has(chapter.id)) next.delete(chapter.id);
                else next.add(chapter.id);
                setExpandedChapterIds(next);
              }}
            >
              {isExpanded ? (
                <ChevronUp className="w-4 h-4 text-blue-400" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </Button>
          </div>

          <div 
            className="flex items-center gap-3 overflow-hidden pl-16"
            onClick={() => setProject(prev => ({ ...prev, currentChapterId: chapter.id }))}
          >
            <div className="w-8 h-8 bg-background rounded-lg flex-shrink-0 overflow-hidden border border-border shadow-inner">
              {chapter.pages[0] && <img src={chapter.pages[0]} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" />}
            </div>
            <div className="flex flex-col min-w-0">
              <span className={`text-[11px] font-bold truncate transition-colors ${project.currentChapterId === chapter.id ? 'text-blue-400' : 'text-foreground/80'}`}>
                {chapter.name}
              </span>
              <span className="text-[9px] font-mono text-foreground/20 uppercase tracking-widest flex items-center gap-2">
                <span>{chapter.pages.length} Pages</span>
                <span>•</span>
                <span>{chapter.panels.length} Panels</span>
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all transform translate-x-2 group-hover:translate-x-0">
            {chapter.panels.length === 0 ? (
              <>
                <Button 
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    processChapter(chapter, 'auto');
                  }}
                  disabled={isProcessing}
                  className="h-7 px-3 bg-blue-600/20 text-blue-400 hover:text-foreground hover:bg-blue-600 rounded-full text-[9px] font-bold uppercase tracking-widest mr-2"
                >
                  Auto Snap
                </Button>
                <Button 
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    processChapter(chapter, 'manual');
                  }}
                  disabled={isProcessing}
                  className="h-7 px-3 bg-foreground/5 text-foreground/60 hover:text-foreground hover:bg-foreground/20 rounded-full text-[9px] font-bold uppercase tracking-widest mr-2"
                >
                  Manual Snap
                </Button>
              </>
            ) : (
              <Button 
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  setProject(prev => ({ ...prev, currentChapterId: chapter.id }));
                  setActiveTab('edit');
                }}
                className="h-7 px-3 bg-foreground/5 text-foreground/80 hover:text-black hover:bg-white rounded-full text-[9px] font-bold uppercase tracking-widest mr-2"
              >
                Open
              </Button>
            )}
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-7 w-7 text-foreground/20 hover:text-blue-400 hover:bg-blue-400/10 rounded-full"
              onClick={(e) => {
                e.stopPropagation();
                setChapterToRename(chapter);
                setNewChapterName(chapter.name);
                setIsRenameChapterDialogOpen(true);
              }}
            >
              <Edit className="w-3.5 h-3.5" />
            </Button>
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-7 w-7 text-foreground/20 hover:text-red-400 hover:bg-red-400/10 rounded-full"
              onClick={(e) => {
                e.stopPropagation();
                setChapterToDelete(chapter);
                setIsDeleteChapterDialogOpen(true);
              }}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        {isExpanded && (
          <div className="bg-background/20 border border-border/40 rounded-xl p-4 ml-6 flex flex-wrap gap-3 items-center transition-all duration-300">
            {chapter.pages.map((pageUrl, index) => (
              <div
                key={`${chapter.id}-page-${index}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.currentTarget.classList.add('border-blue-500', 'scale-105');
                }}
                onDragLeave={(e) => {
                  e.currentTarget.classList.remove('border-blue-500', 'scale-105');
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.currentTarget.classList.remove('border-blue-500', 'scale-105');
                  try {
                    const data = JSON.parse(e.dataTransfer.getData("application/json"));
                    if (data && typeof data.pageIndex === 'number') {
                      if (data.sourceChapterId === chapter.id) {
                        handlePageSort(chapter.id, data.pageIndex, index);
                      } else {
                        handlePageMoveBetweenChapters(data.sourceChapterId, data.pageIndex, chapter.id, index);
                      }
                    }
                  } catch (err) {
                    console.error(err);
                  }
                }}
                className="transition-all duration-200 border border-transparent rounded-lg p-0.5"
              >
                <div 
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("application/json", JSON.stringify({
                      sourceChapterId: chapter.id,
                      pageIndex: index
                    }));
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  className="relative w-16 h-24 bg-background border border-border/80 rounded-lg overflow-hidden cursor-grab active:cursor-grabbing hover:border-blue-500/50 transition-all group/page shadow-md"
                >
                  <img src={pageUrl} className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center opacity-0 group-hover/page:opacity-100 transition-opacity p-1 text-center">
                    <span className="text-[9px] font-bold text-white uppercase tracking-wider">Page {index + 1}</span>
                    <span className="text-[7px] text-white/60 mt-0.5">Drag to move</span>
                  </div>
                </div>
              </div>
            ))}

            <div
              onDragOver={(e) => {
                e.preventDefault();
                e.currentTarget.classList.add('border-dashed', 'border-blue-500', 'bg-blue-500/5');
              }}
              onDragLeave={(e) => {
                e.currentTarget.classList.remove('border-dashed', 'border-blue-500', 'bg-blue-500/5');
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.currentTarget.classList.remove('border-dashed', 'border-blue-500', 'bg-blue-500/5');
                try {
                  const data = JSON.parse(e.dataTransfer.getData("application/json"));
                  if (data && typeof data.pageIndex === 'number') {
                    if (data.sourceChapterId === chapter.id) {
                      handlePageSort(chapter.id, data.pageIndex, chapter.pages.length - 1);
                    } else {
                      handlePageMoveBetweenChapters(data.sourceChapterId, data.pageIndex, chapter.id);
                    }
                  }
                } catch (err) {
                  console.error(err);
                }
              }}
              className="w-16 h-24 border border-dashed border-border/30 rounded-lg flex flex-col items-center justify-center text-foreground/20 hover:text-blue-500/50 hover:border-blue-500/30 transition-all"
            >
              <Plus className="w-4 h-4" />
              <span className="text-[6px] font-bold mt-1 uppercase tracking-widest">Drop here</span>
            </div>
          </div>
        )}
      </div>
    );
  };

  // Auto-save to IndexedDB with 2s debounce whenever project changes
  useEffect(() => {
    const timer = setTimeout(() => {
      saveProjectToDB(project).catch(console.error);
    }, 2000);
    return () => clearTimeout(timer);
  }, [project]);

  // Load voices (now using Gemini TTS voices)
  useEffect(() => {
    if (!project.settings.globalVoiceId) {
      setProject(prev => ({
        ...prev,
        settings: { ...prev.settings, globalVoiceId: 'Kore' }
      }));
    }
  }, [project.settings.globalVoiceId]);

  const [selectedPanelIds, setSelectedPanelIds] = useState<Set<string>>(new Set());

  const handleBulkDeleteTitles = () => {
    setProject(prev => {
      const remainingTitles = prev.titles.filter(t => !selectedLibraryTitleIds.has(t.id));
      const remainingChapters = prev.chapters.filter(c => !selectedLibraryTitleIds.has(c.titleId));
      return { 
        ...prev, 
        titles: remainingTitles, 
        chapters: remainingChapters,
        currentChapterId: remainingChapters.find(c => c.id === prev.currentChapterId) ? prev.currentChapterId : null
      };
    });
    setSelectedLibraryTitleIds(new Set());
    toast.success('Titles deleted');
  };

  const handleBulkDeleteChapters = () => {
    setProject(prev => ({
      ...prev,
      chapters: prev.chapters.filter(c => !selectedLibraryChapterIds.has(c.id)),
      currentChapterId: selectedLibraryChapterIds.has(prev.currentChapterId!) ? null : prev.currentChapterId
    }));
    setSelectedLibraryChapterIds(new Set());
    toast.success('Chapters deleted');
  };

  const handleMergeAndAutoSnap = async () => {
    if (selectedLibraryChapterIds.size < 2) {
      toast.error("Please select at least 2 chapters to merge.");
      return;
    }

    const selectedChapters = project.chapters
      .filter(c => selectedLibraryChapterIds.has(c.id))
      .sort((a, b) => a.createdAt - b.createdAt);

    if (selectedChapters.length === 0) return;

    const mergedPages: string[] = [];
    const mergedPanels: Panel[] = [];
    
    selectedChapters.forEach(c => {
      mergedPages.push(...c.pages);
      c.panels.forEach(p => {
        mergedPanels.push({
          ...p,
          order: mergedPanels.length
        });
      });
    });

    const mergedName = `Merged: ${selectedChapters.map(c => c.name).join(' & ')}`.substring(0, 80);
    const mergedChapter: ComicChapter = {
      id: generateId(),
      name: mergedName,
      titleId: selectedChapters[0].titleId,
      pages: mergedPages,
      panels: mergedPanels,
      createdAt: Date.now()
    };

    setProject(prev => ({
      ...prev,
      chapters: [...prev.chapters, mergedChapter],
      currentChapterId: mergedChapter.id
    }));

    setSelectedLibraryChapterIds(new Set());
    toast.success(`Chapters merged successfully into "${mergedName}"! Starting Auto Snap...`);
    setActiveTab('edit');
    
    await processChapter(mergedChapter, 'auto');
  };

  const processUpload = async (files: File[], mode: 'separate' | 'combine' | 'append') => {
    setIsProcessing(true);
    try {
      let catId = currentCategoryId;
      let cats = [...project.categories];
      let tId = currentTitleId;
      let titles = [...project.titles];

      if (!tId) {
        if (!catId) {
          if (cats.length === 0) {
            catId = generateId();
            cats.push({ id: catId, name: 'Manga', titleIds: [] });
          } else {
            catId = cats[0].id;
          }
        }
        tId = generateId();
        titles = [{
          id: tId,
          categoryId: catId,
          name: 'Quick Upload',
          createdAt: Date.now()
        }, ...titles];
        
        setTimeout(() => {
          setCurrentCategoryId(catId);
          setCurrentTitleId(tId);
        }, 0);
      }

      if (mode === 'append') {
        if (!project.currentChapterId) throw new Error("No active chapter to append to.");
        
        const newPages: string[] = [];
        for (const file of files) {
          if (file.type === 'application/pdf') {
            const { pdfToImages } = await import('./services/imageProcessing');
            newPages.push(...(await pdfToImages(file)));
          } else {
            newPages.push(await fileToBase64(file));
          }
        }

        setProject(prev => ({
          ...prev,
          categories: cats,
          titles: titles,
          chapters: prev.chapters.map(c => 
            c.id === prev.currentChapterId 
              ? { ...c, pages: [...c.pages, ...newPages] } 
              : c
          )
        }));

        toast.success(`Appended ${newPages.length} pages to the current chapter!`);
      } else if (mode === 'combine') {
        const combinedPages: string[] = [];
        for (const file of files) {
          if (file.type === 'application/pdf') {
            const { pdfToImages } = await import('./services/imageProcessing');
            combinedPages.push(...(await pdfToImages(file)));
          } else {
            combinedPages.push(await fileToBase64(file));
          }
        }

        const firstFile = files[0];
        const chapterName = files.length > 1 ? `${firstFile.name} + ${files.length - 1} more` : firstFile.name;

        const newChapter: ComicChapter = {
          id: generateId(),
          name: chapterName,
          titleId: tId,
          pages: combinedPages,
          panels: [],
          createdAt: Date.now()
        };

        setProject(prev => ({
          ...prev,
          categories: cats,
          titles: titles,
          chapters: [...prev.chapters, newChapter],
          currentChapterId: newChapter.id
        }));

        toast.success(`Created chapter "${chapterName}" with ${combinedPages.length} pages!`);
      } else {
        const newPending: ComicChapter[] = [];
        for (const file of files) {
          let pages: string[] = [];
          if (file.type === 'application/pdf') {
            const { pdfToImages } = await import('./services/imageProcessing');
            pages = await pdfToImages(file);
          } else {
            pages = [await fileToBase64(file)];
          }

          newPending.push({
            id: generateId(),
            name: file.name,
            titleId: tId,
            pages,
            panels: [],
            createdAt: Date.now()
          });
        }

        setProject(prev => ({
          ...prev,
          categories: cats,
          titles: titles,
          chapters: [...prev.chapters, ...newPending],
          currentChapterId: newPending[newPending.length - 1]?.id || prev.currentChapterId
        }));

        toast.success(`Created ${files.length} separate chapters!`);
      }
    } catch (error: any) {
      console.error("Upload process error:", error);
      toast.error("Upload failed: " + error.message);
    } finally {
      setIsProcessing(false);
      setPendingUploadFiles(null);
      setIsUploadOptionsDialogOpen(false);
    }
  };

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;
    
    if (acceptedFiles.length > 1 || project.currentChapterId) {
      setPendingUploadFiles(acceptedFiles);
      setIsUploadOptionsDialogOpen(true);
    } else {
      await processUpload(acceptedFiles, 'separate');
    }
  }, [project.currentChapterId, currentTitleId, currentCategoryId]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop,
    accept: { 
      'image/*': ['.png', '.jpg', '.jpeg', '.webp'],
      'application/pdf': ['.pdf']
    }
  } as any);

  const togglePanelSelection = (id: string) => {
    setSelectedPanelIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleManualSelectionComplete = async (rectsByPage: { pageIndex: number; rects: { x: number; y: number; width: number; height: number, id?: string }[] }[]) => {
    if (!manualSelectionData) return;
    setIsProcessing(true);
    try {
      const existingChapter = project.chapters.find(c => c.id === manualSelectionData.chapterId);
      const existingPanelsMap = new Map<string, Panel>();
      if (existingChapter) {
         existingChapter.panels.forEach(p => existingPanelsMap.set(p.id, p));
      }

      let maxOrder = existingChapter ? Math.max(-1, ...existingChapter.panels.map(p => p.order ?? 0)) : -1;
      const newPanelsList: Panel[] = [];

      for (const item of rectsByPage) {
        const pageUrl = manualSelectionData.pageUrls[item.pageIndex];
        for (const rect of item.rects) {
          if (rect.id && existingPanelsMap.has(rect.id)) {
            // Keep existing panel properties (like script, voice)
            const existing = existingPanelsMap.get(rect.id)!;
            const r1 = existing.rect;
            const r2 = rect;
            let finalImage = existing.imageUrl;
            
            // Only re-crop if coordinates changed
            if (r1.x !== r2.x || r1.y !== r2.y || r1.width !== r2.width || r1.height !== r2.height) {
               const cropped = await cropImage(pageUrl, rect);
               if (cropped) finalImage = cropped;
            }
            
            newPanelsList.push({
               ...existing,
               rect: rect,
               imageUrl: finalImage
            });
          } else {
            // Brand new panel!
            const cropped = await cropImage(pageUrl, rect);
            if (cropped) {
              maxOrder++;
              newPanelsList.push({
                id: generateId(),
                imageUrl: cropped,
                fullPageUrl: pageUrl,
                originalImageId: manualSelectionData.chapterId,
                rect,
                script: '',
                dialogue: '',
                duration: 3,
                voiceId: project.settings.globalVoiceId,
                order: maxOrder
              });
            }
          }
        }
      }

      // Existing chapter update
      setProject(prev => ({
        ...prev,
        chapters: prev.chapters.map(c => {
          if (c.id === manualSelectionData.chapterId) {
            let updatedPanels;
            if (manualSelectionData.appendMode) {
                // Keep all old panels strictly, just append new ones. 
                // Any newly drawn rects (lacking IDs) get added.
                const brandNew = newPanelsList.filter(p => !existingPanelsMap.has(p.id));
                updatedPanels = [...c.panels, ...brandNew].map((p, i) => ({ ...p, order: i }));
            } else if (manualSelectionData.singlePanelMode) {
                // Single panel Re-Snap mode. Only update the modified panels or append newly drawn ones.
                // Keep ALL other existing panels.
                const newOrModifiedIds = new Set(newPanelsList.map(p => p.id));
                const oldPanelIdsToReplace = manualSelectionData.initialRects?.[0]?.rects.map(r => r.id) || [];
                
                const keptOldPanels = c.panels.filter(p => !oldPanelIdsToReplace.includes(p.id) && !newOrModifiedIds.has(p.id));
                updatedPanels = [...keptOldPanels, ...newPanelsList].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
                updatedPanels = updatedPanels.map((p, i) => ({...p, order: i}));
            } else {
                // Full Page Replace mode: The returned rects from ALL pages are the Source of Truth. 
                // Any existing panels NOT in newPanelsList are discarded!
                updatedPanels = newPanelsList.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
                updatedPanels = updatedPanels.map((p, i) => ({...p, order: i}));
            }
            return { ...c, panels: updatedPanels };
          }
          return c;
        })
      }));
      
      if (manualSelectionData.appendMode) {
          toast.success(`Added new panels manually!`);
      } else {
          toast.success(`Updated layout! Script and audio preserved.`);
      }

      setIsManualSelectorOpen(false);
      setManualSelectionData(null);
    } catch (error: any) {
      toast.error("Failed to process manual selection: " + error.message);
    } finally {
      setIsProcessing(false);
    }
  };
  const buildGlobalContext = () => {
    return project.chapters.map(c => 
      `[Chapter: ${c.name}]\n` + 
      c.panels.filter(pan => pan.context?.trim()).map(pan => `- ${pan.context}`).join('\n')
    ).filter(c => c.includes('- ')).join('\n\n');
  };

  const handleBulkScript = async () => {
    if (!currentChapter || selectedPanelIds.size === 0) return;
    setIsProcessing(true);
    const controller = new AbortController();
    setScriptGenerationAbortController(controller);
    try {
      const selectedPanels = currentChapter.panels.filter(p => selectedPanelIds.has(p.id));
      console.log("Generating scripts for panels:", selectedPanels.map(p => p.id));
      
      const globalContext = buildGlobalContext();

      const scripts = await generatePanelScripts(
        selectedPanels.map((p) => ({ id: p.id, imageUrl: p.imageUrl, dialogue: p.dialogue, context: p.context, scriptLength: p.scriptLength })),
        project.settings.language,
        globalContext,
        project.settings.scriptLength,
        controller.signal
      );
      console.log("Received scripts:", scripts);
      
      setProject(prev => ({
        ...prev,
        chapters: prev.chapters.map(c => {
          if (c.id === currentChapter.id) {
            return {
              ...c,
              panels: c.panels.map(p => {
                // Try to find by ID first, then by index if necessary (though service should return IDs)
                const scriptObj = scripts.find((s: any) => s.id === p.id);
                return scriptObj ? { ...p, script: scriptObj.script } : p;
              })
            };
          }
          return c;
        })
      }));
      toast.success('Scripts generated for selected panels!');
      setSelectedPanelIds(new Set());
    } catch (error: any) {
      if (error?.name === 'AbortError' || error?.message?.includes('Aborted') || controller.signal.aborted) {
        toast.info("Script generation canceled.");
      } else {
        console.error("Bulk script error:", error?.message || error);
        if (error?.message?.includes('429') || error?.message?.includes('RESOURCE_EXHAUSTED')) {
           toast.error("API Quota Exhausted. Please wait a few minutes before trying again.", { duration: 5000 });
        } else {
           toast.error(`Failed to generate scripts: ${error?.message || 'Unknown error'}`);
        }
      }
    } finally {
      setIsProcessing(false);
      setScriptGenerationAbortController(null);
    }
  };

  const handleGenerateMetadata = async () => {
    if (!currentChapter || currentChapter.panels.length === 0) {
      toast.error("No panels in this chapter.");
      return;
    }
    const scripts = currentChapter.panels.map(p => p.script).filter(s => s?.trim());
    if (scripts.length === 0) {
      toast.error("Please generate narration scripts first before creating metadata.");
      return;
    }
    setIsProcessing(true);
    try {
      const metadata = await generateSocialMetadata(scripts, project.settings.language);
      setProject(prev => ({
        ...prev,
        chapters: prev.chapters.map(c => 
          c.id === currentChapter.id ? { ...c, socialMetadata: metadata } : c
        )
      }));
      toast.success("Social media metadata generated!");
    } catch (error: any) {
      console.error("Metadata generation error:", error);
      if (error?.message?.includes('429') || error?.message?.includes('RESOURCE_EXHAUSTED')) {
         toast.error("API Quota Exhausted. Please wait a few minutes before trying again.", { duration: 5000 });
      } else {
         toast.error(`Failed to generate metadata: ${error?.message || 'Unknown error'}`);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const currentChapter = project.chapters.find(c => c.id === project.currentChapterId);

  const handleGenerateScripts = async () => {
    if (!currentChapter) return;
    setIsProcessing(true);
    const controller = new AbortController();
    setScriptGenerationAbortController(controller);
    try {
      console.log("Generating scripts for all panels in chapter:", currentChapter.id);
      
      const globalContext = buildGlobalContext();

      const scripts = await generatePanelScripts(
        currentChapter.panels.map(p => ({ id: p.id, imageUrl: p.imageUrl, dialogue: p.dialogue, context: p.context, scriptLength: p.scriptLength })),
        project.settings.language,
        globalContext,
        project.settings.scriptLength,
        controller.signal
      );
      console.log("Received scripts:", scripts);
      
      setProject(prev => ({
        ...prev,
        chapters: prev.chapters.map(c => {
          if (c.id === currentChapter.id) {
            return {
              ...c,
              panels: c.panels.map(p => {
                const scriptObj = scripts.find((s: any) => s.id === p.id);
                return scriptObj ? { ...p, script: scriptObj.script } : p;
              })
            };
          }
          return c;
        })
      }));
      toast.success('Scripts generated successfully!');
    } catch (error: any) {
      if (error?.name === 'AbortError' || error?.message?.includes('Aborted') || controller.signal.aborted) {
        toast.info("Script generation canceled.");
      } else {
        console.error("Generate scripts error:", error?.message || error);
        if (error?.message?.includes('429') || error?.message?.includes('RESOURCE_EXHAUSTED')) {
           toast.error("API Quota Exhausted. Please wait a few minutes before trying again.", { duration: 5000 });
        } else {
           toast.error(`Failed to generate scripts: ${error?.message || 'Unknown error'}`);
        }
      }
    } finally {
      setIsProcessing(false);
      setScriptGenerationAbortController(null);
    }
  };

  const handleExportVideo = async () => {
    if (!currentChapter || currentChapter.panels.length === 0) {
      toast.error("No panels to export. Please add some panels first.");
      return;
    }
    
    setIsProcessing(true);
    setExportProgress(0);
    toast.info("Generating narration audio... This may take a moment.");

    try {
      // Create AudioContext immediately to preserve user gesture
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      await audioCtx.resume();
      const dest = audioCtx.createMediaStreamDestination();

      // 1. Pre-generate all audio sequentially to avoid hitting rate limits
      const audioDataMap = new Map<string, ArrayBuffer>();
      const totalPanels = currentChapter.panels.length;
      
      for (let i = 0; i < currentChapter.panels.length; i++) {
        const panel = currentChapter.panels[i];
        if (panel.script) {
          try {
            // Generating sequentially
            const base64Audio = project.settings.voiceEngine === 'gemini'
              ? await generateSpeech(panel.script, project.settings.globalVoiceId)
              : await generateFreeSpeech(panel.script, project.settings.language);
            const binaryString = atob(base64Audio);
            const bytes = new Uint8Array(binaryString.length);
            for (let j = 0; j < binaryString.length; j++) {
              bytes[j] = binaryString.charCodeAt(j);
            }
            audioDataMap.set(panel.id, bytes.buffer);
          } catch (e: any) {
            console.error(`Failed to generate audio for panel ${panel.id}:`, e);
            if (e?.message?.includes('429') || e?.message?.includes('RESOURCE_EXHAUSTED')) {
                toast.error("API Quota Exhausted. Stopping export. Please wait a few minutes before trying again.", { duration: 5000 });
                setIsProcessing(false);
                return;
            }
          }
        }
        setExportProgress(Math.round(((i + 1) / totalPanels) * 40));
      }

      toast.info("Narration ready. Mixing audio and rendering video...");

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error("Could not create canvas context");

      // Set dimensions dynamically based on aspect ratio/videoFormat and resolution
      let width = 1920;
      let height = 1080;
      const isVertical = project.settings.videoFormat === 'vertical';
      const resolution = project.settings.exportResolution || '1080p';

      if (resolution === '720p') {
        width = isVertical ? 720 : 1280;
        height = isVertical ? 1280 : 720;
      } else if (resolution === '4K') {
        width = isVertical ? 2160 : 3840;
        height = isVertical ? 3840 : 2160;
      } else { // 1080p
        width = isVertical ? 1080 : 1920;
        height = isVertical ? 1920 : 1080;
      }

      canvas.width = width;
      canvas.height = height;

      // Use a higher frame rate for smoother video
      const stream = canvas.captureStream(30);
      
      // Background Music Setup
      if (project.settings.musicUrl) {
        try {
          const musicData = await fetch(project.settings.musicUrl).then(r => r.arrayBuffer());
          const musicBuffer = await audioCtx.decodeAudioData(musicData);
          const musicSource = audioCtx.createBufferSource();
          musicSource.buffer = musicBuffer;
          musicSource.loop = true;
          const musicGain = audioCtx.createGain();
          musicGain.gain.value = project.settings.musicVolume;
          musicSource.connect(musicGain);
          musicGain.connect(dest);
          musicSource.start();
        } catch (e) {
          console.error("Failed to load background music:", e);
        }
      }

      const combinedStream = new MediaStream([
        ...stream.getVideoTracks(),
        ...dest.stream.getAudioTracks()
      ]);

      const mimeTypes = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
        'video/mp4'
      ];
      let selectedMimeType = '';
      for (const type of mimeTypes) {
        if (MediaRecorder.isTypeSupported(type)) {
          selectedMimeType = type;
          break;
        }
      }

      if (!selectedMimeType) throw new Error("No supported video format found in your browser.");

      const mediaRecorder = new MediaRecorder(combinedStream, {
        mimeType: selectedMimeType,
        videoBitsPerSecond: 8000000 // 8Mbps for high quality
      });

      const chunks: Blob[] = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      
      const exportPromise = new Promise<Blob>((resolve, reject) => {
        mediaRecorder.onstop = () => resolve(new Blob(chunks, { type: selectedMimeType }));
        mediaRecorder.onerror = (e) => reject(e);
      });

      mediaRecorder.start(100); // Collect data every 100ms

      const drawTextWithWrappingAndStroke = (text: string, x: number, y: number, maxWidth: number, lineHeight: number) => {
        ctx.save();
        ctx.font = 'bold 44px "Inter", "Arial", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 12;
        ctx.lineJoin = 'round';
        ctx.fillStyle = '#FFFFFF';

        const words = text.split(' ');
        const lines: string[] = [];
        let currentLine = '';

        for (let j = 0; j < words.length; j++) {
          const testLine = currentLine ? currentLine + ' ' + words[j] : words[j];
          const metrics = ctx.measureText(testLine);
          if (metrics.width > maxWidth && currentLine) {
            lines.push(currentLine);
            currentLine = words[j];
          } else {
            currentLine = testLine;
          }
        }
        if (currentLine) {
          lines.push(currentLine);
        }

        const startY = y - (lines.length - 1) * lineHeight;

        for (let k = 0; k < lines.length; k++) {
          const lineY = startY + (k * lineHeight);
          ctx.strokeText(lines[k], x, lineY);
          ctx.fillText(lines[k], x, lineY);
        }
        ctx.restore();
      };

      const drawImageWithBlurBackground = (
        ctx: CanvasRenderingContext2D,
        img: HTMLImageElement,
        blurredBgCanvas: HTMLCanvasElement | null,
        opacity: number = 1,
        scaleFactor: number = 1,
        offsetX: number = 0,
        offsetY: number = 0
      ) => {
        ctx.save();
        ctx.globalAlpha = opacity;

        // 1. Draw the pre-rendered blurred background
        if (blurredBgCanvas) {
          ctx.drawImage(blurredBgCanvas, 0, 0, canvas.width, canvas.height);
        } else {
          ctx.fillStyle = '#12131a';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        // 2. Draw centered image with a subtle, highly performant drop shadow
        const scale = Math.min(canvas.width / img.width, canvas.height / img.height) * scaleFactor;
        const dw = img.width * scale;
        const dh = img.height * scale;
        const x = (canvas.width / 2) - (dw / 2) + offsetX;
        const y = (canvas.height / 2) - (dh / 2) + offsetY;
        
        ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
        ctx.shadowBlur = 15;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 6;

        ctx.drawImage(img, x, y, dw, dh);
        ctx.restore();
      };

      const drawTransitionFrame = (
        ctx: CanvasRenderingContext2D,
        prevImg: HTMLImageElement | null,
        prevBgCanvas: HTMLCanvasElement | null,
        currentImg: HTMLImageElement,
        currentBgCanvas: HTMLCanvasElement | null,
        style: string,
        t: number,
        scriptText?: string
      ) => {
        // Clear background
        ctx.fillStyle = '#12131a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        if (!prevImg) {
          // First image transition (fade & zoom in from background/black)
          const opacity = t;
          const scale = 0.95 + 0.05 * t;
          drawImageWithBlurBackground(ctx, currentImg, currentBgCanvas, opacity, scale, 0, 0);
        } else {
          switch (style) {
            case 'fade':
              // Fade out old, fade in new
              drawImageWithBlurBackground(ctx, prevImg, prevBgCanvas, 1 - t, 1, 0, 0);
              drawImageWithBlurBackground(ctx, currentImg, currentBgCanvas, t, 1, 0, 0);
              break;
            case 'zoom-in':
              drawImageWithBlurBackground(ctx, prevImg, prevBgCanvas, 1 - t, 1 + t * 0.1, 0, 0);
              drawImageWithBlurBackground(ctx, currentImg, currentBgCanvas, t, 0.85 + t * 0.15, 0, 0);
              break;
            case 'zoom-out':
              drawImageWithBlurBackground(ctx, prevImg, prevBgCanvas, 1 - t, 1.0 - t * 0.1, 0, 0);
              drawImageWithBlurBackground(ctx, currentImg, currentBgCanvas, t, 1.15 - t * 0.15, 0, 0);
              break;
            case 'slide-left':
              drawImageWithBlurBackground(ctx, prevImg, prevBgCanvas, 1 - t, 1, -canvas.width * t, 0);
              drawImageWithBlurBackground(ctx, currentImg, currentBgCanvas, t, 1, canvas.width * (1 - t), 0);
              break;
            case 'slide-right':
              drawImageWithBlurBackground(ctx, prevImg, prevBgCanvas, 1 - t, 1, canvas.width * t, 0);
              drawImageWithBlurBackground(ctx, currentImg, currentBgCanvas, t, 1, -canvas.width * (1 - t), 0);
              break;
            case 'slide-up':
              drawImageWithBlurBackground(ctx, prevImg, prevBgCanvas, 1 - t, 1, 0, -canvas.height * t);
              drawImageWithBlurBackground(ctx, currentImg, currentBgCanvas, t, 1, 0, canvas.height * (1 - t));
              break;
            case 'slide-down':
              drawImageWithBlurBackground(ctx, prevImg, prevBgCanvas, 1 - t, 1, 0, canvas.height * t);
              drawImageWithBlurBackground(ctx, currentImg, currentBgCanvas, t, 1, 0, -canvas.height * (1 - t));
              break;
            default:
              drawImageWithBlurBackground(ctx, currentImg, currentBgCanvas, t, 1, 0, 0);
              break;
          }
        }

        if (scriptText && scriptText.trim()) {
          const scale = Math.min(canvas.width / currentImg.width, canvas.height / currentImg.height);
          const dw = currentImg.width * scale;
          const dh = currentImg.height * scale;
          const y = (canvas.height / 2) - (dh / 2);
          
          const maxWidth = Math.max(canvas.width * 0.75, dw - 60);
          const subY = Math.min(canvas.height - 120, (y + dh) - 45);
          drawTextWithWrappingAndStroke(scriptText.trim(), canvas.width / 2, subY, maxWidth, 55);
        }
      };

      const drawFrame = (img: HTMLImageElement, bgCanvas: HTMLCanvasElement | null, scriptText?: string) => {
        drawImageWithBlurBackground(ctx, img, bgCanvas, 1, 1, 0, 0);
        if (scriptText && scriptText.trim()) {
          const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
          const dw = img.width * scale;
          const dh = img.height * scale;
          const y = (canvas.height / 2) - (dh / 2);
          const maxWidth = Math.max(canvas.width * 0.75, dw - 60);
          const subY = Math.min(canvas.height - 120, (y + dh) - 45);
          drawTextWithWrappingAndStroke(scriptText.trim(), canvas.width / 2, subY, maxWidth, 55);
        }
      };

      // Map to hold pre-rendered blurred background canvases for ultra-fast render loop performance
      const blurredBackgroundsMap = new Map<string, HTMLCanvasElement>();

      let prevImg: HTMLImageElement | null = null;
      let prevBgCanvas: HTMLCanvasElement | null = null;

      for (let i = 0; i < currentChapter.panels.length; i++) {
        const panel = currentChapter.panels[i];
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = panel.imageUrl;
        await new Promise((resolve, reject) => { 
          img.onload = resolve; 
          img.onerror = reject;
        });

        // Pre-render blurred background canvas for this panel
        try {
          const bgCanvas = document.createElement('canvas');
          // Downsample background to 225x400 for vertical layout OR 400x225 for landscape for instant processing
          bgCanvas.width = isVertical ? 225 : 400;
          bgCanvas.height = isVertical ? 400 : 225;
          const bgCtx = bgCanvas.getContext('2d');
          if (bgCtx) {
            bgCtx.imageSmoothingEnabled = true;
            try {
              bgCtx.filter = 'blur(3.5px)'; // Reduced blur radius for dynamic clarity and recognizable artwork
            } catch (e) {}
            
            const bgScale = Math.max(bgCanvas.width / img.width, bgCanvas.height / img.height) * 1.15;
            const bgW = img.width * bgScale;
            const bgH = img.height * bgScale;
            const bgX = (bgCanvas.width - bgW) / 2;
            const bgY = (bgCanvas.height - bgH) / 2;
            bgCtx.drawImage(img, bgX, bgY, bgW, bgH);
            
            try {
              bgCtx.filter = 'none';
            } catch (e) {}
            
            // Draw lighter semi-transparent overlay to ensure clear and bright background representation
            bgCtx.fillStyle = 'rgba(0, 0, 0, 0.23)';
            bgCtx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);
          }
          blurredBackgroundsMap.set(panel.id, bgCanvas);
        } catch (err) {
          console.error("Failed to generate blurred background for panel:", panel.id, err);
        }

        const currentBgCanvas = blurredBackgroundsMap.get(panel.id) || null;

        // PowerPoint-like sequential styles
        const transitionStyles = ['fade', 'slide-left', 'slide-right', 'zoom-in', 'slide-up', 'zoom-out', 'slide-down'];
        const transitionStyle = transitionStyles[i % transitionStyles.length];

        const audioData = audioDataMap.get(panel.id);
        let duration = 2.0; // Default 2 seconds if no audio

        // Keep drawing a tiny invisible pixel to keep MediaRecorder alive during quiet times
        const keepAliveInterval = setInterval(() => {
          ctx.fillStyle = `rgba(255,255,255,0.001)`;
          ctx.fillRect(0,0,1,1);
        }, 50);

        if (audioData) {
          try {
            const audioBuffer = await audioCtx.decodeAudioData(audioData.slice(0));
            const source = audioCtx.createBufferSource();
            source.buffer = audioBuffer;
            
            const gainNode = audioCtx.createGain();
            gainNode.gain.value = 1.0;
            source.connect(gainNode);
            gainNode.connect(dest);
            
            duration = audioBuffer.duration / project.settings.globalSpeed;
            source.playbackRate.value = project.settings.globalSpeed;
            
            source.start();

            // Run Transition Animation
            const transitionDuration = Math.min(0.6, duration * 0.4);
            const fps = 30;
            const totalTransitionFrames = Math.round(transitionDuration * fps);
            const frameInterval = 1000 / fps;
            const startTime = Date.now();

            for (let f = 0; f <= totalTransitionFrames; f++) {
              const t = f / totalTransitionFrames;
              drawTransitionFrame(ctx, prevImg, prevBgCanvas, img, currentBgCanvas, transitionStyle, t, panel.script);
              await new Promise(resolve => setTimeout(resolve, frameInterval));
            }

            // Lock stable frame
            drawTransitionFrame(ctx, prevImg, prevBgCanvas, img, currentBgCanvas, transitionStyle, 1.0, panel.script);

            // Wait until audio finished playing
            const elapsed = (Date.now() - startTime) / 1000;
            const remaining = duration - elapsed;
            if (remaining > 0) {
              await new Promise(resolve => setTimeout(resolve, remaining * 1000));
            }
          } catch (e) {
            console.error("Audio decode error:", e);
            // Fallback render loop transitions
            const transitionDuration = Math.min(0.6, duration * 0.4);
            const fps = 30;
            const totalTransitionFrames = Math.round(transitionDuration * fps);
            const frameInterval = 1000 / fps;
            const startTime = Date.now();

            for (let f = 0; f <= totalTransitionFrames; f++) {
              const t = f / totalTransitionFrames;
              drawTransitionFrame(ctx, prevImg, prevBgCanvas, img, currentBgCanvas, transitionStyle, t, panel.script);
              await new Promise(resolve => setTimeout(resolve, frameInterval));
            }

            drawTransitionFrame(ctx, prevImg, prevBgCanvas, img, currentBgCanvas, transitionStyle, 1.0, panel.script);

            const elapsed = (Date.now() - startTime) / 1000;
            const remaining = duration - elapsed;
            if (remaining > 0) {
              await new Promise(resolve => setTimeout(resolve, remaining * 1000));
            }
          }
        } else {
          // Standard animated playback fallback transition
          const transitionDuration = Math.min(0.6, duration * 0.4);
          const fps = 30;
          const totalTransitionFrames = Math.round(transitionDuration * fps);
          const frameInterval = 1000 / fps;
          const startTime = Date.now();

          for (let f = 0; f <= totalTransitionFrames; f++) {
            const t = f / totalTransitionFrames;
            drawTransitionFrame(ctx, prevImg, prevBgCanvas, img, currentBgCanvas, transitionStyle, t, panel.script);
            await new Promise(resolve => setTimeout(resolve, frameInterval));
          }

          drawTransitionFrame(ctx, prevImg, prevBgCanvas, img, currentBgCanvas, transitionStyle, 1.0, panel.script);

          const elapsed = (Date.now() - startTime) / 1000;
          const remaining = duration - elapsed;
          if (remaining > 0) {
            await new Promise(resolve => setTimeout(resolve, remaining * 1000));
          }
        }

        clearInterval(keepAliveInterval);
        prevImg = img;
        prevBgCanvas = currentBgCanvas;
        setExportProgress(40 + Math.round(((i + 1) / totalPanels) * 60));
      }

      // Finalize recording
      await new Promise(resolve => setTimeout(resolve, 500));
      mediaRecorder.stop();
      await audioCtx.close();
      
      const videoBlob = await exportPromise;
      const url = URL.createObjectURL(videoBlob);
      const a = document.createElement('a');
      a.href = url;
      const extension = selectedMimeType.includes('mp4') ? 'mp4' : 'webm';
      a.download = `${project.name.replace(/\s+/g, '_')}_export.${extension}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      toast.success("Video exported successfully!");
      confetti({
        particleCount: 150,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#3b82f6', '#ffffff', '#60a5fa']
      });
    } catch (error: any) {
      console.error("Export error:", error);
      toast.error("Failed to export video: " + error.message);
    } finally {
      setIsProcessing(false);
      setExportProgress(0);
    }
  };

  const handleDownloadFFmpegProject = async () => {
    if (!currentChapter || currentChapter.panels.length === 0) {
      toast.error("No panels to export. Please add some panels first.");
      return;
    }
    
    setIsProcessing(true);
    setExportProgress(0);
    toast.info("Generating Free TTS voice tracks for FFmpeg Offline project...");

    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      
      const panelsFolder = zip.folder("panels");
      const audioFolder = zip.folder("audio");
      
      const srtLines: string[] = [];
      const renderPyPanels: any[] = [];
      
      let totalElapsedMs = 0;
      let failedAudioCount = 0;
      const totalPanels = currentChapter.panels.length;
      
      for (let i = 0; i < currentChapter.panels.length; i++) {
        const panel = currentChapter.panels[i];
        
        // 1. Save panel image to panels/panel_001.png
        const imageBase64 = panel.imageUrl;
        const imgData = imageBase64.split(',')[1] || imageBase64;
        const panelFilename = `panel_${String(i + 1).padStart(3, '0')}.png`;
        panelsFolder?.file(panelFilename, imgData, { base64: true });

        // 2. Generate free TTS voice track with delay & retries
        let duration = 3.0; // fallback duration
        const audioFilename = `audio_${String(i + 1).padStart(3, '0')}.mp3`;
        
        if (panel.script) {
          // Introduce a sequential delay of 1200ms between consecutive calls to avoid rate limits
          if (i > 0) {
            await new Promise(resolve => setTimeout(resolve, 1200));
          }
          
          let base64Audio = '';
          let success = false;
          let retries = 3;
          let delay = 1500;
          
          for (let attempt = 0; attempt < retries; attempt++) {
            try {
              base64Audio = project.settings.voiceEngine === 'gemini'
                ? await generateSpeech(panel.script, project.settings.globalVoiceId)
                : await generateFreeSpeech(panel.script, project.settings.language);
              
              if (base64Audio) {
                success = true;
                break;
              }
            } catch (e: any) {
              console.warn(`Attempt ${attempt + 1} failed for panel ${i + 1} TTS:`, e);
              if (attempt < retries - 1) {
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2; // exponential backoff
              }
            }
          }
          
          if (success && base64Audio) {
            try {
              const binaryString = atob(base64Audio);
              const bytes = new Uint8Array(binaryString.length);
              for (let j = 0; j < binaryString.length; j++) {
                bytes[j] = binaryString.charCodeAt(j);
              }
              
              audioFolder?.file(audioFilename, bytes.buffer);

              // Get duration of the MP3 file by decoding it locally in browser AudioContext!
              const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
              const decoded = await audioCtx.decodeAudioData(bytes.buffer.slice(0));
              duration = decoded.duration / project.settings.globalSpeed;
              await audioCtx.close();
            } catch (err) {
              console.error(`Error decoding audio data for panel ${i + 1}:`, err);
              // Fallback duration based on words
              duration = Math.max(3.0, (panel.script.split(/\s+/).length * 0.4));
            }
          } else {
            console.error(`Skipping TTS audio for panel ${i + 1} after all retry failures.`);
            failedAudioCount++;
            // Fallback duration based on words
            duration = Math.max(3.0, (panel.script.split(/\s+/).length * 0.4));
          }
        }
        
        // Calculate SRT timings
        const startMs = totalElapsedMs;
        const endMs = totalElapsedMs + Math.round(duration * 1000);
        totalElapsedMs = endMs;

        const formatSrtTime = (ms: number) => {
          const totalSecs = Math.floor(ms / 1000);
          const remainMs = ms % 1000;
          const hrs = Math.floor(totalSecs / 3600);
          const mins = Math.floor((totalSecs % 3600) / 60);
          const secs = totalSecs % 60;
          return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(remainMs).padStart(3, '0')}`;
        };

        // 3. Build SRT lines
        srtLines.push(String(i + 1));
        srtLines.push(`${formatSrtTime(startMs)} --> ${formatSrtTime(endMs)}`);
        srtLines.push(panel.script || "(Tanpa Suara)");
        srtLines.push("");

        // 4. Save metadata for render.py
        renderPyPanels.push({
          image: `panels/${panelFilename}`,
          audio: panel.script ? `audio/${audioFilename}` : null,
          duration: parseFloat(duration.toFixed(3)),
          text: panel.script || ""
        });

        setExportProgress(Math.round(((i + 1) / totalPanels) * 90));
      }

      // Save subtitles.srt
      zip.file("subtitles.srt", srtLines.join("\n"));

      // 5. Generate render.py
      const isVertical = project.settings.videoFormat === 'vertical';
      const resolution = project.settings.exportResolution || '1080p';
      let w = 1920;
      let h = 1080;
      if (resolution === '720p') {
        w = isVertical ? 720 : 1280;
        h = isVertical ? 1280 : 720;
      } else if (resolution === '4K') {
        w = isVertical ? 2160 : 3840;
        h = isVertical ? 3840 : 2160;
      } else { // 1080p
        w = isVertical ? 1080 : 1920;
        h = isVertical ? 1920 : 1080;
      }

      const pythonScript = `import os
import json
import subprocess
import sys

# Panel metadata generated by PanelFlow AI
panels = ${JSON.stringify(renderPyPanels, null, 2)}
width = ${w}
height = ${h}
is_vertical = ${isVertical ? 'True' : 'False'}

print("=== PanelFlow AI: Offline FFmpeg Video Renderer ===")
print("Checking for FFmpeg on your system...")
try:
    subprocess.run(["ffmpeg", "-version"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print("FFmpeg detected successfully!")
except Exception:
    print("ERROR: FFmpeg tidak ditemukan pada system Anda.")
    print("Silakan install FFmpeg dan tambahkan ke PATH Windows Anda.")
    sys.exit(1)

# Ensure temp directory exists
os.makedirs("temp", exist_ok=True)

# 1. Compile each panel into a single dynamic video clip
clips = []
for i, p in enumerate(panels):
    clip_output = f"temp/clip_{i:03d}.mp4"
    img_path = p["image"]
    aud_path = p["audio"]
    dur = p["duration"]
    
    print(f"Rendering panel {i+1}/{len(panels)} ({dur}s)...")
    
    # POWERPOINT STYLE TRANSITION EFFECTS
    # We choose a different transition effect for each clip dynamically
    fx_index = i % 4
    if fx_index == 0:
        # Slow Zoom In
        vf = f"scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,zoompan=z='min(zoom+0.0012,1.2)':d={int(dur*30)}:s={w}x{h}:x='iw/2-(iw/zoom)/2':y='ih/2-(ih/zoom)/2'"
    elif fx_index == 1:
        # Slow Zoom Out
        vf = f"scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,zoompan=z='1.2-0.0012*on':d={int(dur*30)}:s={w}x{h}:x='iw/2-(iw/zoom)/2':y='ih/2-(iw/zoom)/2'"
    elif fx_index == 2:
        # Pan Left
        vf = f"scale={w+200}:{h}:force_original_aspect_ratio=decrease,pad={w+200}:{h}:(ow-iw)/2:(oh-ih)/2,zoompan=z=1.1:d={int(dur*30)}:s={w}x{h}:x='(iw-iw/zoom)*(1-on/({int(dur*30)}))':y='(ih-ih/zoom)/2'"
    else:
        # Pan Right
        vf = f"scale={w+200}:{h}:force_original_aspect_ratio=decrease,pad={w+200}:{h}:(ow-iw)/2:(oh-ih)/2,zoompan=z=1.1:d={int(dur*30)}:s={w}x{h}:x='(iw-iw/zoom)*(on/({int(dur*30)}))':y='(ih-ih/zoom)/2'"

    # Overlay blurry background for video landscape if aspect ratio doesn't match
    if not is_vertical:
        # Blurry background overlay logic
        bg_filter = f"[0:v]scale={w}:{h}:force_original_aspect_ratio=increase,boxblur=15[bg];[bg][0:v]scale={w}:{h}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2"
        vf = f"{bg_filter},{vf}"

    # Build the ffmpeg command for this clip
    cmd = [
        "ffmpeg", "-y", "-loop", "1", "-i", img_path
    ]
    if aud_path and os.path.exists(aud_path):
        cmd.extend(["-i", aud_path])
    else:
        cmd.extend(["-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono"])
        
    cmd.extend([
        "-filter_complex", vf,
        "-c:v", "libx264", "-t", str(dur),
        "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-shortest",
        clip_output
    ])
    
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    clips.append(clip_output)

# 2. Concatenate all compiled clips together
print("Menggabungkan semua klip panel komik...")
with open("temp/concat.txt", "w") as f:
    for c in clips:
        f.write(f"file '{c}'\\n")

cmd_concat = [
    "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", "temp/concat.txt"
]

# Background music mix (if any)
if os.path.exists("soundtrack.mp3"):
    cmd_concat.extend(["-i", "soundtrack.mp3", "-filter_complex", "[0:a][1:a]amix=inputs=2:duration=first[a]", "-map", "0:v", "-map", "[a]"])
else:
    cmd_concat.extend(["-c:a", "copy"])

# Embed wrapped subtitles into the MP4 file
cmd_concat.extend([
    "-vf", "subtitles=subtitles.srt:force_style='FontName=Arial,FontSize=18,PrimaryColour=&HFFFFFF,OutlineColour=&H000000,Outline=2,Alignment=6'",
    "-c:v", "libx264", "output_rendered.mp4"
])

subprocess.run(cmd_concat, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

# 3. Clean up temp files
print("Membersihkan file sementara...")
for c in clips:
    try:
        os.remove(c)
    except Exception:
        pass
try:
    os.remove("temp/concat.txt")
    os.rmdir("temp")
except Exception:
    pass

print("=== SUKSES! Video akhir Anda disimpan sebagai: output_rendered.mp4 ===")
`;

      zip.file("render.py", pythonScript);

      // 6. Generate render.bat (one-click batch file for Windows)
      const batScript = `@echo off
echo ===================================================
echo   PanelFlow AI: One-Click Offline Video Renderer
echo ===================================================
echo.
echo Menjalankan proses rendering video melalui Python dan FFmpeg...
python render.py
if %errorlevel% neq 0 (
    echo.
    echo Terjadi kesalahan saat merender video.
    echo Pastikan Python dan FFmpeg sudah terinstal dan ditambahkan ke PATH.
)
pause
`;
      zip.file("render.bat", batScript);

      // 7. Add background music if available
      if (project.settings.musicUrl) {
        try {
          const musicData = await fetch(project.settings.musicUrl).then(r => r.arrayBuffer());
          zip.file("soundtrack.mp3", musicData);
        } catch (e) {
          console.warn("Failed to bundle background music in ZIP project:", e);
        }
      }

      setExportProgress(95);

      // Generate ZIP blob and download
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${project.name.replace(/\s+/g, '_')}_FFmpeg_Project.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      if (failedAudioCount > 0) {
        toast.warning(`Selesai dengan ${failedAudioCount} file audio yang gagal diunduh karena rate limit. Silakan ekspor kembali nanti jika ingin melengkapi.`, { duration: 8000 });
      } else {
        toast.success("FFmpeg Offline Project downloaded successfully!");
        confetti({
          particleCount: 150,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#a855f7', '#ffffff', '#c084fc']
        });
      }

    } catch (err: any) {
      console.error("FFmpeg exporter failed:", err);
      toast.error("Failed to compile FFmpeg Project ZIP: " + err.message);
    } finally {
      setIsProcessing(false);
      setExportProgress(0);
    }
  };

  const playPreview = async () => {
    if (!currentChapter || currentChapter.panels.length === 0) return;
    setIsPlaying(true);
    isPlayingRef.current = true;
    
    let bgAudio: HTMLAudioElement | null = null;
    if (project.settings.musicUrl) {
      bgAudio = new Audio(project.settings.musicUrl);
      bgAudio.volume = project.settings.musicVolume;
      bgAudio.loop = true;
      bgAudio.play();
    }

    try {
      
      for (let i = 0; i < currentChapter.panels.length; i++) {
        if (!isPlayingRef.current && i > 0) break; // Allow stopping
        setCurrentPanelIndex(i);
        const panel = currentChapter.panels[i];
        
        if (panel.script) {
          try {
            toast.info(`Generating audio for panel ${i + 1}...`);
            const base64Audio = project.settings.voiceEngine === 'gemini'
              ? await generateSpeech(panel.script, project.settings.globalVoiceId)
              : await generateFreeSpeech(panel.script, project.settings.language);
            const binaryString = atob(base64Audio);
            const bytes = new Uint8Array(binaryString.length);
            for (let j = 0; j < binaryString.length; j++) {
              bytes[j] = binaryString.charCodeAt(j);
            }
            
            const blob = new Blob([bytes], { type: 'audio/wav' });
            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);
            audio.playbackRate = project.settings.globalSpeed;
            
            await new Promise((resolve, reject) => {
              audio.onended = resolve;
              audio.onerror = reject;
              audio.play().catch(reject);
            });
            URL.revokeObjectURL(url);
          } catch (e: any) {
            console.error(`Failed to play audio for panel ${panel.id}:`, e);
            if (e?.message?.includes('429') || e?.message?.includes('RESOURCE_EXHAUSTED')) {
                toast.error("API Quota Exhausted. Stopping playback. Please wait before trying again.", { duration: 5000 });
                break;
            }
            toast.error(`Failed to play audio for panel ${i + 1}`);
            await new Promise(resolve => setTimeout(resolve, 2000)); // Wait a bit if audio fails
          }
        } else {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    } finally {
      if (bgAudio) {
        bgAudio.pause();
        bgAudio.currentTime = 0;
      }
      setIsPlaying(false);
      isPlayingRef.current = false;
      setCurrentPanelIndex(-1);
    }
  };

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background text-foreground font-sans selection:bg-primary/30 transition-colors duration-300">
        <Toaster position="top-center" theme="dark" />
        
        {isProcessing && exportProgress > 0 && (
          <div className="fixed inset-0 z-[100] bg-background/80 backdrop-blur-sm flex items-center justify-center p-6">
            <div className="max-w-md w-full space-y-4">
              <div className="flex justify-between text-sm font-bold uppercase tracking-wider">
                <span>Compiling Video...</span>
                <span>{exportProgress}%</span>
              </div>
              <div className="h-3 bg-foreground/10 rounded-full overflow-hidden border border-border">
                <motion.div 
                  className="h-full bg-blue-600"
                  initial={{ width: 0 }}
                  animate={{ width: `${exportProgress}%` }}
                />
              </div>
              <p className="text-center text-xs text-foreground/60">Please keep this tab open until the download starts.</p>
            </div>
          </div>
        )}

        {scriptGenerationAbortController && (
          <div className="fixed inset-0 z-[100] bg-background/80 backdrop-blur-md flex items-center justify-center p-6">
            <div className="max-w-md w-full bg-card/60 backdrop-blur-2xl border border-border/50 rounded-3xl p-8 shadow-2xl flex flex-col items-center text-center gap-6">
              <div className="relative">
                <div className="w-16 h-16 rounded-full border-4 border-blue-500/20 border-t-blue-500 animate-spin" />
                <Sparkles className="w-6 h-6 text-blue-400 absolute inset-0 m-auto animate-pulse" />
              </div>
              
              <div className="space-y-2">
                <h3 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
                  Menyusun Naskah Narasi AI...
                </h3>
                <p className="text-sm text-foreground/60">
                  Gemini sedang menganalisis setiap panel komik dan menyusun skrip suara yang sinematik.
                </p>
              </div>

              <Button 
                variant="destructive"
                onClick={() => {
                  scriptGenerationAbortController.abort();
                }}
                className="w-full py-6 rounded-2xl font-bold flex items-center justify-center gap-2 transform active:scale-95 transition-all shadow-lg shadow-red-500/20"
              >
                <X className="w-5 h-5" /> Batal / Cancel
              </Button>
            </div>
          </div>
        )}
        
        {/* Navbar */}
        <nav className="border-b border-blue-500/10 bg-background/60 backdrop-blur-2xl sticky top-0 z-50 shadow-lg shadow-primary/10 border-b border-border/50">
          <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center shadow-2xl shadow-blue-500/40 transform transition-transform hover:rotate-12">
                <img src="/logo.png" className="w-8 h-8 object-contain" alt="PanelFlow Logo" />
              </div>
              <div>
                <h1 className="font-black text-2xl tracking-tighter text-foreground">PanelFlow <span className="text-primary">AI</span></h1>
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-mono font-bold uppercase tracking-[0.3em] text-blue-400/60">Comic to Video Engine</span>
                  <div className="h-px w-4 bg-foreground/10" />
                  <span className="text-[9px] font-mono text-foreground/20 uppercase tracking-widest">v2.4.0</span>
                </div>
              </div>
            </div>

            {/* Hidden file input for project import */}
            <input
              ref={importInputRef}
              type="file"
              accept=".panelflow"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleImportProject(file);
                e.target.value = '';
              }}
            />

            <div className="flex items-center gap-6">
              <div className="hidden md:flex items-center gap-3 px-4 py-2 bg-white/[0.03] rounded-2xl border border-border/50 group hover:border-blue-500/30 transition-all">
                <div className="w-2 h-2 bg-green-500 rounded-full shadow-[0_0_10px_rgba(34,197,94,0.5)]" />
                <input
                  value={project.name}
                  onChange={(e) => setProject(prev => ({ ...prev, name: e.target.value }))}
                  className="bg-transparent border-none text-xs font-bold text-foreground/60 focus:text-foreground outline-none w-40 transition-colors"
                  placeholder="Untitled Project"
                />
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  title="Import Project (.panelflow)"
                  className="text-foreground/40 hover:text-emerald-400 hover:bg-emerald-400/10 rounded-full"
                  onClick={() => importInputRef.current?.click()}
                >
                  <FolderUp className="w-5 h-5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  title="Export Project (.panelflow)"
                  className="text-foreground/40 hover:text-blue-400 hover:bg-blue-400/10 rounded-full"
                  onClick={handleExportProject}
                >
                  <FolderDown className="w-5 h-5" />
                </Button>
                <ModeToggle />
                <Button 
                  variant="ghost" 
                  size="icon" 
                  title="Settings"
                  className="text-foreground/40 hover:text-foreground hover:bg-foreground/5 rounded-full"
                  onClick={() => setIsSettingsDialogOpen(true)}
                >
                  <Settings className="w-5 h-5" />
                </Button>
                {currentChapter && currentChapter.panels.length > 0 && (
                  <Button
                    onClick={handleDownloadFFmpegProject}
                    disabled={isProcessing}
                    className="bg-purple-600 hover:bg-purple-700 text-white font-bold px-6 h-11 rounded-2xl shadow-xl shadow-purple-500/20 transition-all hover:scale-[1.02] active:scale-[0.98] mr-2"
                  >
                    <Download className="w-4 h-4 mr-2" /> Download FFmpeg
                  </Button>
                )}
                <Button
                  onClick={handleExportVideo}
                  disabled={isProcessing || !currentChapter || currentChapter.panels.some(p => !p.script.trim())}
                  className="bg-blue-600 hover:bg-blue-700 text-foreground font-bold px-8 h-11 rounded-2xl shadow-xl shadow-blue-500/20 transition-all hover:scale-[1.02] active:scale-[0.98]"
                >
                  {isProcessing ? (
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Exporting...</span>
                    </div>
                  ) : 'Export Video'}
                </Button>
              </div>
            </div>
          </div>
        </nav>

        <main className="max-w-7xl mx-auto px-6 py-8">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-8">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <TabsList className="bg-white/[0.03] border border-border/50 p-1.5 h-14 rounded-2xl">
                  <TabsTrigger 
                    value="library" 
                    className="data-[state=active]:bg-blue-600 data-[state=active]:text-foreground data-[state=active]:shadow-lg data-[state=active]:shadow-blue-500/20 px-8 rounded-xl gap-2.5 text-foreground/40 font-bold text-xs uppercase tracking-widest transition-all"
                  >
                    <Library className="w-4 h-4" />
                    Library
                  </TabsTrigger>
                  <TabsTrigger 
                    value="edit" 
                    className="data-[state=active]:bg-blue-600 data-[state=active]:text-foreground data-[state=active]:shadow-lg data-[state=active]:shadow-blue-500/20 px-8 rounded-xl gap-2.5 text-foreground/40 font-bold text-xs uppercase tracking-widest transition-all"
                  >
                    <Layout className="w-4 h-4" />
                    Edit
                  </TabsTrigger>
                  <TabsTrigger 
                    value="exposure" 
                    className="data-[state=active]:bg-fuchsia-600 data-[state=active]:text-foreground data-[state=active]:shadow-lg data-[state=active]:shadow-fuchsia-500/20 px-8 rounded-xl gap-2.5 text-foreground/40 font-bold text-xs uppercase tracking-widest transition-all"
                  >
                    <Sparkles className="w-4 h-4" />
                    Videos
                  </TabsTrigger>
                </TabsList>

                {activeTab === 'edit' && currentChapter && (
                  <div className="flex items-center gap-3 animate-in fade-in slide-in-from-left-4 duration-500">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="border-border bg-foreground/5 text-foreground/60 hover:text-foreground hover:bg-foreground/10 rounded-xl h-10 px-4 text-xs font-bold uppercase tracking-wider"
                      onClick={() => {
                        if (selectedPanelIds.size === currentChapter.panels.length) {
                          setSelectedPanelIds(new Set());
                        } else {
                          setSelectedPanelIds(new Set(currentChapter.panels.map(p => p.id)));
                        }
                      }}
                    >
                      {selectedPanelIds.size === currentChapter.panels.length ? 'Deselect All' : 'Select All'}
                    </Button>
                    {deletedPanelsStack.filter(item => item.chapterId === currentChapter.id).length > 0 && (
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="border-blue-500/30 bg-blue-500/10 text-blue-400 hover:text-blue-300 hover:bg-blue-500/20 rounded-xl h-10 px-4 text-xs font-bold uppercase tracking-wider gap-2 transition-all"
                        onClick={() => {
                          setDeletedPanelsStack(stack => {
                            const newStack = [...stack];
                            // Find last deleted panel for this chapter
                            for (let i = newStack.length - 1; i >= 0; i--) {
                              if (newStack[i].chapterId === currentChapter.id) {
                                const restoredItem = newStack.splice(i, 1)[0];
                                setProject(prev => ({
                                  ...prev,
                                  chapters: prev.chapters.map(c => {
                                    if (c.id === currentChapter.id) {
                                      const newPanels = [...c.panels];
                                      newPanels.splice(restoredItem.index, 0, restoredItem.panel);
                                      return { ...c, panels: newPanels };
                                    }
                                    return c;
                                  })
                                }));
                                toast.success('Panel restored');
                                break;
                              }
                            }
                            return newStack;
                          });
                        }}
                      >
                        <Undo2 className="w-3.5 h-3.5" />
                        Undo Delete ({deletedPanelsStack.filter(item => item.chapterId === currentChapter.id).length})
                      </Button>
                    )}
                    {selectedPanelIds.size > 0 && (
                      <div className="flex items-center gap-2">
                        <select 
                          value={project.settings.scriptLength || 'Normal'}
                          onChange={(e) => setProject(prev => ({ ...prev, settings: { ...prev.settings, scriptLength: e.target.value as any } }))}
                          className="h-10 bg-background/40 border border-border rounded-xl px-4 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500/50 appearance-none text-foreground/80 cursor-pointer text-center"
                          title="Script Length"
                        >
                          <option value="Short">Short (1 Sent.)</option>
                          <option value="Normal">Normal (1-3 Sent.)</option>
                          <option value="Detailed">Detailed (4+ Sent.)</option>
                        </select>
                        <Button 
                          onClick={handleBulkScript} 
                          disabled={isProcessing}
                          className="bg-blue-600 text-foreground hover:bg-blue-700 gap-2.5 h-10 px-6 rounded-xl shadow-lg shadow-blue-500/20 font-bold text-xs uppercase tracking-wider"
                        >
                          {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Scissors className="w-4 h-4" />}
                          Generate {selectedPanelIds.size} Scripts
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {activeTab === 'edit' && currentChapter && selectedPanelIds.size === 0 && (
                <div className="flex items-center gap-3">
                  <select 
                    value={project.settings.scriptLength || 'Normal'}
                    onChange={(e) => setProject(prev => ({ ...prev, settings: { ...prev.settings, scriptLength: e.target.value as any } }))}
                    className="h-12 bg-background/40 border border-border rounded-2xl px-4 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500/50 appearance-none text-foreground/80 cursor-pointer text-center"
                  >
                    <option value="Short">Short Script (1 Sentence)</option>
                    <option value="Normal">Normal Script (1-3 Sentences)</option>
                    <option value="Detailed">Detailed Script (4+ Sentences)</option>
                  </select>
                  <Button 
                    onClick={handleGenerateScripts} 
                    disabled={isProcessing}
                    className="bg-white text-black hover:bg-blue-50 gap-2.5 h-12 px-8 rounded-2xl font-black text-xs uppercase tracking-[0.15em] shadow-2xl transition-all hover:scale-[1.02]"
                  >
                    {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    Auto-Generate All Scripts
                  </Button>
                </div>
              )}
            </div>

            <AnimatePresence mode="wait">
              <TabsContent key="library-tab" value="library" className="m-0">
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="space-y-8"
                >
                  {/* Sequential Upload Wizard */}
                  <div className="bg-background/40 border border-border/50 rounded-[2.5rem] p-8 shadow-xl shadow-primary/5 relative overflow-hidden backdrop-blur-md mb-8">
                    {/* Stepper Header */}
                    <div className="max-w-4xl mx-auto mb-8 relative">
                      <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-foreground/10 -translate-y-1/2 z-0" />
                      <div 
                        className="absolute top-1/2 left-0 h-0.5 bg-blue-600 -translate-y-1/2 z-0 transition-all duration-500" 
                        style={{ 
                          width: wizardTitleType === 'select'
                            ? `${(((wizardStep === 1 ? 0 : wizardStep === 3 ? 1 : 2)) / 2) * 100}%`
                            : `${((wizardStep - 1) / 3) * 100}%`
                        }}
                      />
                      <div className="flex justify-between relative z-10">
                        {((wizardTitleType === 'select'
                          ? [
                              { step: 1, label: 'Pilih Judul' },
                              { step: 3, label: 'Create Chapter' },
                              { step: 4, label: 'Upload Gambar' }
                            ]
                          : [
                              { step: 1, label: 'Create Judul' },
                              { step: 2, label: 'Pilih Jenis' },
                              { step: 3, label: 'Create Chapter' },
                              { step: 4, label: 'Upload Gambar' }
                            ]
                        ) as { step: number; label: string }[]).map((s) => (
                          <div key={s.step} className="flex flex-col items-center gap-2">
                            <div 
                              className={`
                                w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm transition-all duration-500
                                ${wizardStep === s.step 
                                  ? 'bg-blue-600 text-white ring-4 ring-blue-500/20 scale-110 shadow-lg shadow-blue-500/30' 
                                  : wizardStep > s.step 
                                    ? 'bg-emerald-600 text-white' 
                                    : 'bg-background border border-border text-foreground/45'}
                              `}
                            >
                              {wizardStep > s.step ? <Check className="w-5 h-5 text-white" /> : s.step}
                            </div>
                            <span className={`text-[10px] font-black uppercase tracking-wider ${wizardStep >= s.step ? 'text-foreground' : 'text-foreground/30'}`}>
                              {s.label}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Step Panels */}
                    <div className="max-w-xl mx-auto">
                      <AnimatePresence mode="wait">
                        {wizardStep === 1 && (
                          <motion.div
                            key="step1"
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -20 }}
                            transition={{ duration: 0.3 }}
                            className="space-y-6"
                          >
                            <div className="text-center">
                              <h3 className="text-xl font-black text-foreground tracking-tight">Step 1: Judul Comic</h3>
                              <p className="text-xs text-foreground/40 mt-1 font-medium">Buat judul komik baru atau pilih judul yang sudah ada.</p>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                              <Button
                                type="button"
                                variant={wizardTitleType === 'create' ? 'default' : 'outline'}
                                onClick={() => setWizardTitleType('create')}
                                className={`h-24 rounded-2xl flex flex-col gap-2 transition-all cursor-pointer ${wizardTitleType === 'create' ? 'bg-blue-600 text-white ring-2 ring-blue-400' : 'border-border bg-background/20 text-foreground/60'}`}
                              >
                                <Plus className="w-5 h-5" />
                                <span className="font-bold text-xs uppercase tracking-wider">Judul Baru</span>
                              </Button>
                              <Button
                                type="button"
                                variant={wizardTitleType === 'select' ? 'default' : 'outline'}
                                onClick={() => setWizardTitleType('select')}
                                className={`h-24 rounded-2xl flex flex-col gap-2 transition-all cursor-pointer ${wizardTitleType === 'select' ? 'bg-blue-600 text-white ring-2 ring-blue-400' : 'border-border bg-background/20 text-foreground/60'}`}
                              >
                                <Library className="w-5 h-5" />
                                <span className="font-bold text-xs uppercase tracking-wider">Judul Existing</span>
                              </Button>
                            </div>

                            {wizardTitleType === 'create' ? (
                              <div className="space-y-2">
                                <label className="text-[10px] font-bold uppercase tracking-widest text-foreground/50">Nama Judul Baru</label>
                                <input
                                  type="text"
                                  placeholder="Contoh: Solo Leveling"
                                  value={wizardTitleName}
                                  onChange={(e) => setWizardTitleName(e.target.value)}
                                  className="w-full h-12 bg-background/40 border border-border/85 rounded-xl px-4 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/50"
                                />
                              </div>
                            ) : (
                              <div className="space-y-2">
                                <label className="text-[10px] font-bold uppercase tracking-widest text-foreground/50">Pilih Judul</label>
                                <select
                                  value={wizardTitleId}
                                  onChange={(e) => setWizardTitleId(e.target.value)}
                                  className="w-full h-12 bg-background/40 border border-border rounded-xl px-4 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/50 text-foreground/80 cursor-pointer"
                                >
                                  <option value="">-- Pilih Judul Dari Library --</option>
                                  {project.titles.map((t) => (
                                    <option key={t.id} value={t.id}>{t.name}</option>
                                  ))}
                                </select>
                              </div>
                            )}

                            <div className="flex justify-end pt-4">
                              <Button
                                onClick={() => {
                                  if (wizardTitleType === 'create' && !wizardTitleName.trim()) {
                                    toast.error("Silakan masukkan nama judul komik.");
                                    return;
                                  }
                                  if (wizardTitleType === 'select' && !wizardTitleId) {
                                    toast.error("Silakan pilih judul komik yang sudah ada.");
                                    return;
                                  }
                                  if (wizardTitleType === 'select') {
                                    const selectedTitle = project.titles.find(t => t.id === wizardTitleId);
                                    if (selectedTitle) {
                                      setWizardCategoryId(selectedTitle.categoryId);
                                    }
                                    setWizardStep(3); // Skip Step 2!
                                  } else {
                                    setWizardStep(2);
                                  }
                                }}
                                className="bg-blue-600 hover:bg-blue-700 text-white font-bold h-11 px-8 rounded-xl text-xs uppercase tracking-wider cursor-pointer"
                              >
                                Lanjut
                              </Button>
                            </div>
                          </motion.div>
                        )}

                        {wizardStep === 2 && (
                          <motion.div
                            key="step2"
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -20 }}
                            transition={{ duration: 0.3 }}
                            className="space-y-6"
                          >
                            <div className="text-center">
                              <h3 className="text-xl font-black text-foreground tracking-tight">Step 2: Pilih Jenis Comic</h3>
                              <p className="text-xs text-foreground/40 mt-1 font-medium">Tentukan format komik untuk proses snapping yang optimal.</p>
                            </div>

                            <div className="grid grid-cols-3 gap-4">
                              {[
                                { id: 'manga', name: 'Manga', desc: 'Japanese Style (Black & White, Right-to-Left)' },
                                { id: 'manhwa', name: 'Manhwa', desc: 'Korean Webtoon (Color, Vertical Long Strip)' },
                                { id: 'manhua', name: 'Manhua', desc: 'Chinese Comic (Color, High Detail Rows)' }
                              ].map((cat) => (
                                <button
                                  key={cat.id}
                                  type="button"
                                  onClick={() => {
                                    setWizardCategoryId(cat.id);
                                    setWizardStep(3); // auto-advance to step 3 on click!
                                  }}
                                  className={`
                                    p-4 rounded-2xl border-2 transition-all duration-300 flex flex-col items-center justify-center text-center gap-2 h-36 cursor-pointer
                                    ${wizardCategoryId === cat.id 
                                      ? 'bg-blue-600/10 border-blue-500 text-foreground ring-2 ring-blue-500/20' 
                                      : 'bg-background/25 border-border/50 text-foreground/60 hover:bg-background/45 hover:border-blue-500/35'}
                                  `}
                                >
                                  <span className="text-sm font-black uppercase tracking-tight">{cat.name}</span>
                                  <span className="text-[8px] font-bold text-foreground/45 leading-relaxed uppercase">{cat.desc}</span>
                                </button>
                              ))}
                            </div>

                            <div className="flex justify-between pt-4">
                              <Button
                                variant="outline"
                                onClick={() => setWizardStep(1)}
                                className="border-border text-foreground/60 hover:text-foreground h-11 px-8 rounded-xl text-xs uppercase tracking-wider cursor-pointer"
                              >
                                Kembali
                              </Button>
                              <Button
                                onClick={() => setWizardStep(3)}
                                className="bg-blue-600 hover:bg-blue-700 text-white font-bold h-11 px-8 rounded-xl text-xs uppercase tracking-wider cursor-pointer"
                              >
                                Lanjut
                              </Button>
                            </div>
                          </motion.div>
                        )}

                        {wizardStep === 3 && (
                          <motion.div
                            key="step3"
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -20 }}
                            transition={{ duration: 0.3 }}
                            className="space-y-6"
                          >
                            <div className="text-center">
                              <h3 className="text-xl font-black text-foreground tracking-tight">Step 3: Create Chapter</h3>
                              <p className="text-xs text-foreground/40 mt-1 font-medium">Buat nama chapter baru untuk mengelompokkan halaman komik.</p>
                            </div>

                            <div className="space-y-2">
                              <label className="text-[10px] font-bold uppercase tracking-widest text-foreground/50">Nama Chapter</label>
                              <input
                                type="text"
                                placeholder="Contoh: Chapter 01: Kebangkitan"
                                value={wizardChapterName}
                                onChange={(e) => setWizardChapterName(e.target.value)}
                                className="w-full h-12 bg-background/40 border border-border/80 rounded-xl px-4 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/50"
                              />
                            </div>

                            <div className="flex justify-between pt-4">
                              <Button
                                variant="outline"
                                onClick={() => {
                                  if (wizardTitleType === 'select') {
                                    setWizardStep(1);
                                  } else {
                                    setWizardStep(2);
                                  }
                                }}
                                className="border-border text-foreground/60 hover:text-foreground h-11 px-8 rounded-xl text-xs uppercase tracking-wider cursor-pointer"
                              >
                                Kembali
                              </Button>
                              <Button
                                onClick={() => {
                                  if (!wizardChapterName.trim()) {
                                    toast.error("Silakan masukkan nama chapter.");
                                    return;
                                  }
                                  setWizardStep(4);
                                }}
                                className="bg-blue-600 hover:bg-blue-700 text-white font-bold h-11 px-8 rounded-xl text-xs uppercase tracking-wider cursor-pointer"
                              >
                                Lanjut
                              </Button>
                            </div>
                          </motion.div>
                        )}

                        {wizardStep === 4 && (
                          <motion.div
                            key="step4"
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -20 }}
                            transition={{ duration: 0.3 }}
                            className="space-y-6"
                          >
                            <div className="text-center">
                              <h3 className="text-xl font-black text-foreground tracking-tight">Step 4: Upload Gambar</h3>
                              <p className="text-xs text-foreground/40 mt-1 font-medium">Unggah halaman-halaman komik untuk di-Auto Snap.</p>
                            </div>

                            {/* Drop Zone */}
                            <div
                              onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('border-blue-500', 'bg-blue-500/5'); }}
                              onDragLeave={(e) => { e.currentTarget.classList.remove('border-blue-500', 'bg-blue-500/5'); }}
                              onDrop={(e) => {
                                e.preventDefault();
                                e.currentTarget.classList.remove('border-blue-500', 'bg-blue-500/5');
                                if (e.dataTransfer.files) {
                                  const filesArray = Array.from(e.dataTransfer.files);
                                  setWizardFiles(prev => [...prev, ...filesArray]);
                                }
                              }}
                              className="border-2 border-dashed border-border/80 rounded-2xl p-8 flex flex-col items-center justify-center transition-all bg-white/[0.01] hover:bg-white/[0.02] text-center min-h-[160px] cursor-pointer"
                            >
                              <Upload className="w-8 h-8 text-foreground/30 mb-2" />
                              <p className="text-xs text-foreground/60 font-bold uppercase tracking-wider mb-2">Drag & Drop Halaman Komik Di Sini</p>
                              <p className="text-[10px] text-foreground/30 mb-4 uppercase tracking-widest font-mono">PNG, JPG, WEBP, atau PDF</p>
                              
                              <label className="bg-white text-black hover:bg-blue-50 px-5 h-8 rounded-lg font-bold text-[9px] uppercase tracking-wider shadow-md cursor-pointer flex items-center justify-center">
                                Pilih File
                                <input
                                  type="file"
                                  multiple
                                  accept="image/*,application/pdf"
                                  className="hidden"
                                  onChange={(e) => {
                                    if (e.target.files) {
                                      setWizardFiles(prev => [...prev, ...Array.from(e.target.files!)]);
                                    }
                                  }}
                                />
                              </label>
                            </div>

                            {/* Files List Preview */}
                            {wizardFiles.length > 0 && (
                              <div className="max-h-40 overflow-y-auto bg-background/20 border border-border/40 rounded-xl p-3 space-y-2">
                                <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-widest text-foreground/40 px-1 border-b border-border/30 pb-1.5 mb-1.5">
                                  <span>Nama File ({wizardFiles.length})</span>
                                  <button onClick={() => setWizardFiles([])} className="text-red-400 hover:text-red-300 uppercase tracking-widest text-[9px] cursor-pointer">Hapus Semua</button>
                                </div>
                                {wizardFiles.map((file, idx) => (
                                  <div key={idx} className="flex justify-between items-center bg-background/40 p-2 rounded-lg border border-border/30 text-xs">
                                    <span className="truncate font-bold text-foreground/80 max-w-[280px]">{file.name}</span>
                                    <button
                                      onClick={() => setWizardFiles(prev => prev.filter((_, i) => i !== idx))}
                                      className="text-red-400/60 hover:text-red-400 p-1 cursor-pointer"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}

                            <div className="flex justify-between pt-4">
                              <Button
                                variant="outline"
                                onClick={() => setWizardStep(3)}
                                className="border-border text-foreground/60 hover:text-foreground h-11 px-8 rounded-xl text-xs uppercase tracking-wider cursor-pointer"
                              >
                                Kembali
                              </Button>
                              <Button
                                onClick={handleWizardFinish}
                                disabled={isProcessing}
                                className="bg-blue-600 hover:bg-blue-700 text-white font-black h-11 px-8 rounded-xl text-xs uppercase tracking-[0.15em] shadow-lg shadow-blue-500/20 cursor-pointer"
                              >
                                {isProcessing ? (
                                  <div className="flex items-center gap-2">
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    <span>Memproses...</span>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-2">
                                    <Sparkles className="w-4 h-4" />
                                    <span>Selesai & Auto Snap</span>
                                  </div>
                                )}
                              </Button>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>

                  {/* Category Selection */}
                  <div className="grid grid-cols-3 gap-4">
                    {project.categories.map(cat => (
                      <Button
                        key={cat.id}
                        onClick={() => {
                          setCurrentCategoryId(cat.id);
                          setCurrentTitleId(null);
                        }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.currentTarget.classList.add('bg-blue-600/30', 'border-blue-500');
                        }}
                        onDragLeave={(e) => {
                          e.currentTarget.classList.remove('bg-blue-600/30', 'border-blue-500');
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          e.currentTarget.classList.remove('bg-blue-600/30', 'border-blue-500');
                          try {
                            const data = JSON.parse(e.dataTransfer.getData("application/json"));
                            if (data && typeof data.pageIndex === 'number') {
                              handlePageMoveToCategory(data.sourceChapterId, data.pageIndex, cat.id);
                            }
                          } catch (err) {
                            console.error(err);
                          }
                        }}
                        className={`
                          h-24 rounded-3xl border-2 transition-all flex flex-col gap-2
                          ${currentCategoryId === cat.id 
                            ? 'bg-blue-600 border-blue-400 text-foreground shadow-xl shadow-blue-500/20' 
                            : 'bg-background/40 border-purple-500/10 text-foreground/40 hover:bg-background/60 hover:border-blue-500/30 shadow-lg shadow-purple-900/10'}
                        `}
                      >
                        <span className="text-xl font-black uppercase tracking-tighter">{cat.name}</span>
                        <span className="text-[10px] font-bold opacity-60">
                          {project.titles.filter(t => t.categoryId === cat.id).length} TITLES
                        </span>
                      </Button>
                    ))}
                  </div>

                  {currentCategoryId && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            onClick={() => {
                              setCurrentCategoryId(null);
                              setCurrentTitleId(null);
                            }}
                            className="text-foreground/40 hover:text-foreground hover:bg-foreground/5 rounded-full"
                          >
                            <ChevronLeft className="w-6 h-6" />
                          </Button>
                          <h3 className="text-2xl font-black text-foreground uppercase tracking-tight">
                            {project.categories.find(c => c.id === currentCategoryId)?.name} Titles
                          </h3>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="flex items-center bg-foreground/5 p-1 rounded-xl border border-border/50 hidden md:flex">
                            <Button variant="ghost" size="icon" title="List View" onClick={() => setTitleViewMode('list')} className={`h-8 w-8 rounded-lg transition-all ${titleViewMode === 'list' ? 'bg-blue-600 text-foreground shadow-lg shadow-blue-500/20' : 'text-foreground/40 hover:text-foreground hover:bg-foreground/5'}`}>
                              <List className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="icon" title="Small Tiles Grid" onClick={() => setTitleViewMode('grid-sm')} className={`h-8 w-8 rounded-lg transition-all ${titleViewMode === 'grid-sm' ? 'bg-blue-600 text-foreground shadow-lg shadow-blue-500/20' : 'text-foreground/40 hover:text-foreground hover:bg-foreground/5'}`}>
                              <Grid3X3 className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="icon" title="Medium Tiles Grid" onClick={() => setTitleViewMode('grid-md')} className={`h-8 w-8 rounded-lg transition-all ${titleViewMode === 'grid-md' ? 'bg-blue-600 text-foreground shadow-lg shadow-blue-500/20' : 'text-foreground/40 hover:text-foreground hover:bg-foreground/5'}`}>
                              <LayoutGrid className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="icon" title="Large Panels Grid" onClick={() => setTitleViewMode('grid-lg')} className={`h-8 w-8 rounded-lg transition-all ${titleViewMode === 'grid-lg' ? 'bg-blue-600 text-foreground shadow-lg shadow-blue-500/20' : 'text-foreground/40 hover:text-foreground hover:bg-foreground/5'}`}>
                              <Square className="w-4 h-4" />
                            </Button>
                          </div>
                          <Button 
                            onClick={() => setIsAddTitleDialogOpen(true)}
                            className="bg-foreground/5 hover:bg-foreground/10 text-foreground border border-border rounded-xl h-10 px-4"
                          >
                            <Plus className="w-4 h-4 mr-2" /> Add Title
                          </Button>
                        </div>
                      </div>

                      <div className={`
                        grid
                        ${titleViewMode === 'list' ? 'grid-cols-1 gap-6' : ''}
                        ${titleViewMode === 'grid-sm' ? 'grid-cols-3 md:grid-cols-5 lg:grid-cols-7 xl:grid-cols-8 gap-3 lg:gap-4' : ''}
                        ${titleViewMode === 'grid-md' ? 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 gap-6' : ''}
                        ${titleViewMode === 'grid-lg' ? 'grid-cols-1 lg:grid-cols-2 xl:grid-cols-2 gap-8' : ''}
                      `}>
                        {project.titles.filter(t => t.categoryId === currentCategoryId).map(title => (
                          <Card 
                            key={title.id}
                            onDragOver={(e) => {
                              e.preventDefault();
                              e.currentTarget.classList.add('ring-2', 'ring-blue-500', 'border-blue-500');
                            }}
                            onDragLeave={(e) => {
                              e.currentTarget.classList.remove('ring-2', 'ring-blue-500', 'border-blue-500');
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              e.currentTarget.classList.remove('ring-2', 'ring-blue-500', 'border-blue-500');
                              try {
                                const data = JSON.parse(e.dataTransfer.getData("application/json"));
                                if (data && typeof data.pageIndex === 'number') {
                                  handlePageMoveToTitle(data.sourceChapterId, data.pageIndex, title.id);
                                }
                              } catch (err) {
                                console.error(err);
                              }
                            }}
                            className={`
                              bg-background/40 border-purple-500/10 overflow-hidden transition-all group shadow-lg shadow-purple-900/10 relative cursor-pointer
                              ${currentTitleId === title.id ? 'ring-2 ring-blue-600 border-blue-600' : 'hover:bg-background/60 hover:border-blue-500/30'}
                              ${selectedLibraryTitleIds.has(title.id) ? 'ring-2 ring-red-500 border-red-500' : ''}
                            `}
                          >
                            {/* Checkbox for selection */}
                            <div 
                              className="absolute top-3 left-3 z-20 cursor-pointer"
                              onClick={(e) => {
                                e.stopPropagation();
                                const next = new Set(selectedLibraryTitleIds);
                                if (next.has(title.id)) next.delete(title.id);
                                else next.add(title.id);
                                setSelectedLibraryTitleIds(next);
                              }}
                            >
                              <div className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-colors ${selectedLibraryTitleIds.has(title.id) ? 'bg-red-500 border-red-500' : 'border-border bg-background/40 hover:border-border/500'}`}>
                                {selectedLibraryTitleIds.has(title.id) && <Check className="w-4 h-4 text-foreground" />}
                              </div>
                            </div>
                            
                            <div className="aspect-[3/4] bg-background relative" onClick={() => setCurrentTitleId(title.id)}>
                              {title.coverUrl ? (
                                <img src={title.coverUrl} className="w-full h-full object-cover" />
                              ) : (
                                <div className="absolute inset-0 flex items-center justify-center text-foreground/10">
                                  <ImageIcon className="w-12 h-12" />
                                </div>
                              )}
                              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                              <div className="absolute bottom-4 left-4 right-4">
                                <h4 className="font-black text-foreground truncate uppercase tracking-tight">{title.name}</h4>
                                <p className="text-[10px] font-bold text-foreground/40 uppercase tracking-widest">
                                  {project.chapters.filter(c => c.titleId === title.id).length} Chapters
                                </p>
                              </div>
                            </div>
                          </Card>
                        ))}
                      </div>
                    </div>
                  )}

                  {currentTitleId && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            onClick={() => setCurrentTitleId(null)}
                            className="text-foreground/40 hover:text-foreground hover:bg-foreground/5 rounded-full"
                          >
                            <ChevronLeft className="w-6 h-6" />
                          </Button>
                          <h3 className="text-2xl font-black text-foreground uppercase tracking-tight">
                            {project.titles.find(t => t.id === currentTitleId)?.name} Chapters
                          </h3>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="flex items-center bg-foreground/5 p-1 rounded-xl border border-border/50">
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              onClick={() => setChapterViewMode('list')}
                              className={`h-8 w-8 rounded-lg transition-all ${chapterViewMode === 'list' ? 'bg-blue-600 text-foreground shadow-lg shadow-blue-500/20' : 'text-foreground/40 hover:text-foreground hover:bg-foreground/5'}`}
                            >
                              <List className="w-4 h-4" />
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              title="Small Tiles Grid"
                              onClick={() => setChapterViewMode('grid-sm')}
                              className={`h-8 w-8 rounded-lg transition-all ${chapterViewMode === 'grid-sm' ? 'bg-blue-600 text-foreground shadow-lg shadow-blue-500/20' : 'text-foreground/40 hover:text-foreground hover:bg-foreground/5'}`}
                            >
                              <Grid3X3 className="w-4 h-4" />
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              title="Medium Tiles Grid"
                              onClick={() => setChapterViewMode('grid-md')}
                              className={`h-8 w-8 rounded-lg transition-all ${chapterViewMode === 'grid-md' ? 'bg-blue-600 text-foreground shadow-lg shadow-blue-500/20' : 'text-foreground/40 hover:text-foreground hover:bg-foreground/5'}`}
                            >
                              <LayoutGrid className="w-4 h-4" />
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              title="Large Panels Grid"
                              onClick={() => setChapterViewMode('grid-lg')}
                              className={`h-8 w-8 rounded-lg transition-all ${chapterViewMode === 'grid-lg' ? 'bg-blue-600 text-foreground shadow-lg shadow-blue-500/20' : 'text-foreground/40 hover:text-foreground hover:bg-foreground/5'}`}
                            >
                              <Square className="w-4 h-4" />
                            </Button>
                          </div>
                          {selectedLibraryChapterIds.size > 1 && (
                            <Button 
                              onClick={handleMergeAndAutoSnap}
                              disabled={isProcessing}
                              className="bg-blue-600 hover:bg-blue-700 text-white font-bold tracking-widest text-[10px] uppercase h-10 px-4 rounded-xl mr-2"
                            >
                              <Sparkles className="w-4 h-4 mr-2" />
                              Merge & Auto Snap ({selectedLibraryChapterIds.size})
                            </Button>
                          )}
                          {selectedLibraryChapterIds.size > 0 && (
                            <Button 
                              variant="destructive" 
                              size="sm"
                              onClick={handleBulkDeleteChapters}
                              className="bg-red-500/20 text-red-500 hover:bg-red-500/30 font-bold tracking-widest text-[10px] uppercase h-10 px-4 rounded-xl"
                            >
                              <Trash2 className="w-4 h-4 mr-2" />
                              Delete {selectedLibraryChapterIds.size} Chapters
                            </Button>
                          )}
                        </div>
                      </div>

                      <div className={`
                        grid
                        ${chapterViewMode === 'list' ? 'grid-cols-1 gap-6' : ''}
                        ${chapterViewMode === 'grid-sm' ? 'grid-cols-3 md:grid-cols-5 lg:grid-cols-7 xl:grid-cols-8 gap-3 lg:gap-4' : ''}
                        ${chapterViewMode === 'grid-md' ? 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 gap-6' : ''}
                        ${chapterViewMode === 'grid-lg' ? 'grid-cols-1 lg:grid-cols-2 xl:grid-cols-2 gap-8' : ''}
                      `}>
                        {project.chapters.filter(c => c.titleId === currentTitleId).map(chapter => (
                          chapterViewMode === 'list' ? (
                            <div key={chapter.id}>
                              <ChapterItem chapter={chapter} />
                            </div>
                          ) : (
                            <Card 
                              key={chapter.id}
                              className={`
                                bg-background/40 border-purple-500/10 overflow-hidden group transition-all shadow-lg shadow-purple-900/10 relative cursor-pointer
                                ${project.currentChapterId === chapter.id ? 'ring-2 ring-blue-600 border-blue-600' : 'hover:bg-background/60'}
                                ${selectedLibraryChapterIds.has(chapter.id) ? 'ring-2 ring-red-500 border-red-500' : ''}
                              `}
                            >
                              {/* Checkbox for selection */}
                              <div 
                                className="absolute top-3 left-3 z-20 cursor-pointer"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const next = new Set(selectedLibraryChapterIds);
                                  if (next.has(chapter.id)) next.delete(chapter.id);
                                  else next.add(chapter.id);
                                  setSelectedLibraryChapterIds(next);
                                }}
                              >
                                <div className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-colors ${selectedLibraryChapterIds.has(chapter.id) ? 'bg-red-500 border-red-500' : 'border-border bg-background/40 hover:border-border/500'}`}>
                                  {selectedLibraryChapterIds.has(chapter.id) && <Check className="w-4 h-4 text-foreground" />}
                                </div>
                              </div>

                              <div 
                                onClick={() => {
                                  setProject(prev => ({ ...prev, currentChapterId: chapter.id }));
                                  setActiveTab('edit');
                                }}
                                className={`
                                bg-background relative
                                ${chapterViewMode === 'grid-sm' ? 'aspect-square' : 'aspect-video'}
                              `}>
                                {chapter.pages[0] && <img src={chapter.pages[0]} className="w-full h-full object-contain" />}
                                <div className="absolute inset-0 bg-background/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity gap-2">
                                  {chapter.panels.length === 0 ? (
                                    <>
                                      <Button 
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          processChapter(chapter, 'auto');
                                        }}
                                        disabled={isProcessing}
                                        className="bg-blue-600 hover:bg-blue-700 text-foreground font-black text-[10px] uppercase tracking-widest rounded-xl h-8 px-4"
                                      >
                                        Auto Snap
                                      </Button>
                                      <Button 
                                        variant="outline"
                                        size="icon"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          processChapter(chapter, 'manual');
                                        }}
                                        className="bg-foreground/10 border-border text-foreground hover:bg-foreground/20 h-8 w-8 rounded-xl"
                                      >
                                        <Plus className="w-3.5 h-3.5" />
                                      </Button>
                                    </>
                                  ) : (
                                    <Button 
                                      onClick={() => {
                                        setProject(prev => ({ ...prev, currentChapterId: chapter.id }));
                                        setActiveTab('edit');
                                      }}
                                      className="bg-zinc-100/90 text-black font-black text-[10px] uppercase tracking-widest rounded-xl h-8 px-4"
                                    >
                                      Open
                                    </Button>
                                  )}
                                  
                                  <Button 
                                    variant="outline"
                                    size="icon"
                                    onClick={() => {
                                      setChapterToRename(chapter);
                                      setNewChapterName(chapter.name);
                                      setIsRenameChapterDialogOpen(true);
                                    }}
                                    className="bg-foreground/10 border-border text-foreground hover:bg-foreground/20 h-8 w-8 rounded-xl"
                                  >
                                    <Edit className="w-3.5 h-3.5" />
                                  </Button>
                                  <Button 
                                    variant="outline"
                                    size="icon"
                                    onClick={() => {
                                      setChapterToDelete(chapter);
                                      setIsDeleteChapterDialogOpen(true);
                                    }}
                                    className="bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/20 h-8 w-8 rounded-xl"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </Button>
                                </div>
                              </div>
                              <CardContent className="p-4">
                                <h4 className={`font-bold text-foreground truncate ${chapterViewMode === 'grid-sm' ? 'text-xs' : 'text-sm'}`}>{chapter.name}</h4>
                                <p className="text-[9px] font-bold text-foreground/40 uppercase tracking-widest mt-1">
                                  {chapter.panels.length} Panels • {new Date(chapter.createdAt).toLocaleDateString()}
                                </p>
                              </CardContent>
                            </Card>
                          )
                        ))}
                      </div>

                    </div>
                  )}
                </motion.div>
              </TabsContent>

              <TabsContent key="edit-tab" value="edit" className="m-0">
                <motion.div 
                  key="edit-content"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="grid grid-cols-12 gap-8"
                >
                  {/* Panel List */}
                  <div className="col-span-9 space-y-6">
                    {!currentChapter ? (
                      <div className="flex flex-col items-center justify-center p-32 border-2 border-dashed border-border/50 rounded-[2.5rem] bg-white/[0.02]">
                        <div className="w-24 h-24 bg-white/[0.03] rounded-3xl flex items-center justify-center mb-8 border border-border/50">
                          <Layers className="w-10 h-10 text-foreground/40" />
                        </div>
                        <h3 className="text-3xl font-black mb-3 text-foreground tracking-tight">No Chapter Selected</h3>
                        <p className="text-foreground/40 text-center max-w-sm mb-10 text-sm leading-relaxed font-medium">
                          Select a chapter from the Library to start editing its panels, adding scripts, and generating audio.
                        </p>
                        <Button 
                          onClick={() => setActiveTab('library')}
                          className="bg-blue-600 hover:bg-blue-700 text-foreground px-10 h-14 rounded-2xl font-black text-xs uppercase tracking-[0.2em]"
                        >
                          Go to Library
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-6">
                        {currentChapter.panels.length === 0 ? (
                          <div className="flex flex-col items-center justify-center py-24 px-8 border-2 border-blue-500/20 bg-blue-500/5 rounded-[2.5rem] text-center shadow-[inset_0_0_100px_rgba(59,130,246,0.05)]">
                            <div className="w-20 h-20 bg-blue-500/10 rounded-3xl flex items-center justify-center mb-6">
                              <Scissors className="w-10 h-10 text-blue-400" />
                            </div>
                            <h3 className="text-3xl font-black mb-3 text-foreground tracking-tight">Ready to Extract Panels</h3>
                            <p className="text-foreground/40 max-w-md mx-auto mb-10 text-sm leading-relaxed font-medium">
                              This chapter has <strong>{currentChapter.pages.length}</strong> pages waiting to be sliced. Auto Snap will let AI find the panels, or you can draw them manually.
                            </p>
                            <div className="flex items-center gap-4">
                              <Button 
                                onClick={() => processChapter(currentChapter, 'auto')}
                                disabled={isProcessing}
                                className="bg-blue-600 hover:bg-blue-700 text-foreground font-black h-14 px-8 rounded-2xl shadow-xl shadow-blue-500/20 transition-all hover:scale-105"
                              >
                                {isProcessing ? <Loader2 className="w-5 h-5 animate-spin mr-3" /> : <Sparkles className="w-5 h-5 mr-3" />}
                                Auto Snap Panels
                              </Button>
                              <Button 
                                variant="outline"
                                onClick={() => processChapter(currentChapter, 'manual')}
                                disabled={isProcessing}
                                className="border-border bg-foreground/5 hover:bg-foreground/10 text-foreground font-black h-14 px-8 rounded-2xl transition-all hover:scale-105"
                              >
                                <Plus className="w-5 h-5 mr-3" />
                                Manual Snap
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <>
                            {/* Quick Actions Toolbar */}
                            <div className="flex items-center justify-between bg-white/[0.02] border border-border/50 rounded-2xl p-4">
                          <div className="flex items-center gap-4">
                            <span className="text-xs font-bold text-foreground/60 uppercase tracking-widest">
                              {selectedPanelIds.size} Selected
                            </span>
                            <div className="h-4 w-px bg-foreground/10" />
                            <Button 
                              variant="ghost" 
                              size="sm"
                              className="text-[10px] font-bold uppercase tracking-widest text-blue-400 hover:text-blue-300 hover:bg-blue-400/10 h-8"
                              onClick={() => {
                                if (selectedPanelIds.size === currentChapter.panels.length) {
                                  setSelectedPanelIds(new Set());
                                } else {
                                  setSelectedPanelIds(new Set(currentChapter.panels.map(p => p.id)));
                                }
                              }}
                            >
                              {selectedPanelIds.size === currentChapter.panels.length ? 'Deselect All' : 'Select All'}
                            </Button>
                          </div>
                            <div className="flex flex-wrap items-center gap-2 lg:gap-3">
                              {/* NEW: Reprocess Chapter Action */}
                              <Button 
                                variant="ghost" 
                                onClick={() => {
                                  if (confirm("Re-processing will permanently replace all current panels and scripts in this chapter. Continue?")) {
                                    processChapter(currentChapter, 'auto');
                                  }
                                }}
                                className="text-foreground hover:text-blue-400 hover:bg-blue-400/10 h-8 lg:h-9 font-bold text-[9px] lg:text-[10px] uppercase tracking-widest flex border border-transparent hover:border-blue-500/20"
                              >
                                <Sparkles className="w-3.5 h-3.5 mr-2" />
                                Re-Snap Chapter
                              </Button>
                              <Button 
                                variant="ghost" 
                                onClick={() => processChapter(currentChapter, 'manual')}
                                className="text-foreground hover:text-foreground hover:bg-foreground/10 h-8 lg:h-9 font-bold text-[9px] lg:text-[10px] uppercase tracking-widest flex border border-transparent"
                              >
                                <Scissors className="w-3.5 h-3.5 mr-2" />
                                Edit Panel Layout
                              </Button>
                              <Button 
                                variant="ghost" 
                                onClick={() => {
                                  setManualSelectionData({
                                    chapterId: currentChapter.id,
                                    pageUrls: currentChapter.pages,
                                    initialPageIndex: 0,
                                    appendMode: true 
                                  });
                                  setIsManualSelectorOpen(true);
                                }}
                                className="text-foreground hover:text-foreground hover:bg-foreground/10 h-8 lg:h-9 font-bold text-[9px] lg:text-[10px] uppercase tracking-widest flex border border-transparent"
                              >
                                <Plus className="w-3.5 h-3.5 mr-2" />
                                Add New Panels
                              </Button>
                              
                              <div className="w-px h-6 bg-foreground/10 hidden lg:block" />

                              <div className="flex items-center bg-foreground/5 p-1 rounded-xl border border-border/50 hidden xl:flex lg:mr-2">
                                <Button 
                                  variant="ghost" 
                                  size="icon" 
                                  title="List View"
                                  onClick={(e) => { e.stopPropagation(); setPanelViewMode('list'); }} 
                                  className={`h-8 w-8 rounded-lg transition-all ${panelViewMode === 'list' ? 'bg-blue-600 text-foreground' : 'text-foreground/40 hover:text-foreground hover:bg-foreground/5'}`}
                                >
                                  <List className="w-4 h-4" />
                                </Button>
                                <Button 
                                  variant="ghost" 
                                  size="icon" 
                                  title="Small Tiles Grid"
                                  onClick={(e) => { e.stopPropagation(); setPanelViewMode('grid-sm'); }} 
                                  className={`h-8 w-8 rounded-lg transition-all ${panelViewMode === 'grid-sm' ? 'bg-blue-600 text-foreground' : 'text-foreground/40 hover:text-foreground hover:bg-foreground/5'}`}
                                >
                                  <Grid3X3 className="w-4 h-4" />
                                </Button>
                                <Button 
                                  variant="ghost" 
                                  size="icon" 
                                  title="Medium Tiles Grid"
                                  onClick={(e) => { e.stopPropagation(); setPanelViewMode('grid-md'); }} 
                                  className={`h-8 w-8 rounded-lg transition-all ${panelViewMode === 'grid-md' ? 'bg-blue-600 text-foreground' : 'text-foreground/40 hover:text-foreground hover:bg-foreground/5'}`}
                                >
                                  <LayoutGrid className="w-4 h-4" />
                                </Button>
                                <Button 
                                  variant="ghost" 
                                  size="icon" 
                                  title="Large Panels Grid"
                                  onClick={(e) => { e.stopPropagation(); setPanelViewMode('grid-lg'); }} 
                                  className={`h-8 w-8 rounded-lg transition-all ${panelViewMode === 'grid-lg' ? 'bg-blue-600 text-foreground' : 'text-foreground/40 hover:text-foreground hover:bg-foreground/5'}`}
                                >
                                  <Square className="w-4 h-4" />
                                </Button>
                              </div>
                              <Button 
                                variant="outline" 
                                size="sm"
                                disabled={selectedPanelIds.size === 0 || isProcessing}
                                className="border-border bg-foreground/5 hover:bg-foreground/10 text-foreground font-bold h-8 lg:h-9 text-[9px] lg:text-[10px] uppercase tracking-widest hidden sm:flex"
                                onClick={handleBulkScript}
                              >
                                <Sparkles className="w-3.5 h-3.5 mr-2 text-blue-400" />
                                <span className="hidden lg:inline">Auto-Script Selected</span>
                                <span className="lg:hidden">Auto-Script</span>
                              </Button>
                              <Button 
                                variant="outline" 
                                size="sm"
                                disabled={selectedPanelIds.size === 0}
                                className="border-red-500/20 bg-red-500/5 hover:bg-red-500/10 text-red-400 font-bold h-8 lg:h-9 text-[9px] lg:text-[10px] uppercase tracking-widest hidden sm:flex"
                                onClick={() => {
                                  setSelectedPanelIds(new Set());
                                  toast.info("Selection cleared");
                                }}
                              >
                                <X className="w-3.5 h-3.5 mr-2" />
                                <span className="hidden lg:inline">Clear Selection</span>
                                <span className="lg:hidden">Clear</span>
                              </Button>
                            </div>
                          </div>

                          {/* Mobile-only visible bulk buttons to prevent overflow */}
                          {selectedPanelIds.size > 0 && (
                            <div className="flex sm:hidden gap-2 pb-4">
                              <Button 
                                variant="outline" 
                                size="sm"
                                disabled={selectedPanelIds.size === 0 || isProcessing}
                                className="flex-1 border-border bg-foreground/5 hover:bg-foreground/10 text-foreground font-bold h-10 text-[10px] uppercase tracking-widest"
                                onClick={handleBulkScript}
                              >
                                <Sparkles className="w-4 h-4 mr-2 text-blue-400" />
                                Script
                              </Button>
                              <Button 
                                variant="outline" 
                                size="sm"
                                disabled={selectedPanelIds.size === 0}
                                className="flex-1 border-red-500/20 bg-red-500/5 hover:bg-red-500/10 text-red-400 font-bold h-10 text-[10px] uppercase tracking-widest"
                                onClick={() => {
                                  setSelectedPanelIds(new Set());
                                  toast.info("Selection cleared");
                                }}
                              >
                                <X className="w-4 h-4 mr-2" />
                                Clear
                              </Button>
                            </div>
                          )}

                          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                          <div className={`grid gap-4 ${
                            panelViewMode === 'list' ? 'grid-cols-1' :
                            panelViewMode === 'grid-sm' ? 'grid-cols-2 md:grid-cols-3 xl:grid-cols-4 xxl:grid-cols-5' :
                            panelViewMode === 'grid-md' ? 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3' :
                            'grid-cols-1 lg:grid-cols-2'
                          }`}>
                            <SortableContext items={currentChapter.panels.map(p => p.id)} strategy={rectSortingStrategy}>
                              {currentChapter.panels.map((panel, idx) => (
                              <SortableItem key={panel.id} id={panel.id} className="h-full">
                                <Card 
                                  onClick={() => togglePanelSelection(panel.id)}
                                  className={`
                                    bg-background/40 border-purple-500/10 overflow-hidden group transition-all duration-300 cursor-pointer h-full
                                    hover:bg-background/60 hover:border-blue-500/30
                                    ${selectedPanelIds.has(panel.id) ? 'ring-2 ring-blue-600 border-blue-600 bg-background/80 shadow-lg shadow-blue-900/20' : ''}
                                  `}
                                >
                            <div className="aspect-square relative bg-background/40 group-hover:bg-background/20 transition-colors border-b border-border/50">
                              <img src={panel.imageUrl} alt={`Panel ${idx + 1}`} className="w-full h-full object-contain transition-transform duration-500 group-hover:scale-[1.05]" />
                              
                              {/* Panel Number Badge */}
                              <div className="absolute top-4 left-4 flex items-center gap-2">
                                <div className="px-3 py-1 bg-blue-600 text-foreground text-[10px] font-mono font-bold uppercase tracking-[0.2em] rounded-full shadow-lg shadow-blue-500/20">
                                  #{String(idx + 1).padStart(2, '0')}
                                </div>
                                <div className="px-2 py-1 bg-background/60 backdrop-blur-md rounded-full text-[9px] font-bold text-foreground/40 uppercase tracking-widest border border-border/50">
                                  Panel ID: {panel.id.slice(0, 6)}
                                </div>
                              </div>

                              {/* Selection Indicator */}
                              {selectedPanelIds.has(panel.id) && (
                                <div className="absolute inset-0 bg-blue-600/10 flex items-center justify-center">
                                  <div className="w-12 h-12 bg-blue-600 rounded-full flex items-center justify-center shadow-2xl shadow-blue-500/50 animate-in zoom-in duration-300">
                                    <Check className="w-6 h-6 text-foreground" />
                                  </div>
                                </div>
                              )}

                              {/* Hover Overlay Actions */}
                              <div className="absolute inset-0 bg-background/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3 backdrop-blur-[2px]">
                                <Button 
                                  size="sm"
                                  variant="secondary"
                                  className="h-9 px-4 rounded-full font-bold text-xs uppercase tracking-wider bg-white text-black hover:bg-blue-50"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const pageIndex = currentChapter.pages.indexOf(panel.fullPageUrl);
                                    setManualSelectionData({ 
                                      chapterId: currentChapter.id, 
                                      pageUrls: currentChapter.pages,
                                      initialPageIndex: Math.max(0, pageIndex),
                                      initialRects: [
                                        {
                                          pageIndex: Math.max(0, pageIndex),
                                          rects: [{...panel.rect, id: panel.id}]
                                        }
                                      ],
                                      appendMode: false,
                                      singlePanelMode: true // We are strictly replacing NO OTHER RECTS, just this one panel
                                    });
                                    setIsManualSelectorOpen(true);
                                  }}
                                >
                                  <Scissors className="w-3.5 h-3.5 mr-2" /> Re-Snap
                                </Button>
                                <Button 
                                  size="sm"
                                  variant="secondary"
                                  className="h-9 px-4 rounded-full font-bold text-xs uppercase tracking-wider bg-foreground/10 text-foreground border border-border hover:bg-foreground/20"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingPanelId(panel.id);
                                    setIsExtendDialogOpen(true);
                                  }}
                                >
                                  <ImageIcon className="w-3.5 h-3.5 mr-2" /> Extend
                                </Button>
                              </div>
                            </div>

                            <CardContent className="p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
                              <div className="space-y-1.5">
                                <div className="flex items-center justify-between">
                                  <label className="text-[9px] font-bold uppercase tracking-[0.2em] text-purple-400/60">Context & Characters</label>
                                </div>
                                <textarea 
                                  value={panel.context || ''}
                                  onMouseDown={(e) => e.stopPropagation()}
                                  onChange={(e) => {
                                    const newContext = e.target.value;
                                    setProject(prev => ({
                                      ...prev,
                                      chapters: prev.chapters.map(c => {
                                        if (c.id === currentChapter.id) {
                                          return {
                                            ...c,
                                            panels: c.panels.map(p => p.id === panel.id ? { ...p, context: newContext } : p)
                                          };
                                        }
                                        return c;
                                      })
                                    }));
                                  }}
                                  placeholder="E.g., This is John. He is using his Fireball skill..."
                                  className="w-full bg-background/20 border border-border/50 rounded-xl p-3 text-xs min-h-[40px] focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 outline-none transition-all text-foreground/90 placeholder:text-foreground/20 resize-none leading-relaxed relative z-10"
                                />
                              </div>

                              <div className="space-y-1.5">
                                <div className="flex items-center justify-between">
                                  <label className="text-[9px] font-bold uppercase tracking-[0.2em] text-blue-400/60">Narration Script</label>
                                  <div className="flex items-center gap-1.5 text-[9px] font-mono text-foreground/30">
                                    <Volume2 className="w-2.5 h-2.5" />
                                    <span>{panel.script.length} CHARS</span>
                                  </div>
                                </div>
                                <textarea 
                                  value={panel.script}
                                  onMouseDown={(e) => e.stopPropagation()}
                                  onChange={(e) => {
                                    const newScript = e.target.value;
                                    setProject(prev => ({
                                      ...prev,
                                      chapters: prev.chapters.map(c => {
                                        if (c.id === currentChapter.id) {
                                          return {
                                            ...c,
                                            panels: c.panels.map(p => p.id === panel.id ? { ...p, script: newScript } : p)
                                          };
                                        }
                                        return c;
                                      })
                                    }));
                                  }}
                                  placeholder="Script..."
                                  className="w-full bg-background/20 border border-border/50 rounded-xl p-3 text-xs min-h-[60px] focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 outline-none transition-all text-foreground/90 placeholder:text-foreground/10 resize-none leading-relaxed relative z-10"
                                />
                              </div>

                              <div className="flex flex-wrap items-center justify-between pt-2 border-t border-border/50 gap-2">
                                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 flex-1">
                                  <div className="flex flex-col">
                                    <span className="text-[9px] font-bold text-foreground/20 uppercase tracking-widest whitespace-nowrap">Duration (s)</span>
                                    <input 
                                      type="number"
                                      step="0.1"
                                      min="0.1"
                                      value={panel.duration || 3.0}
                                      onChange={(e) => {
                                        const newDuration = parseFloat(e.target.value) || 3.0;
                                        setProject(prev => ({
                                          ...prev,
                                          chapters: prev.chapters.map(c => {
                                            if (c.id === currentChapter.id) {
                                              return {
                                                ...c,
                                                panels: c.panels.map(p => p.id === panel.id ? { ...p, duration: newDuration } : p)
                                              };
                                            }
                                            return c;
                                          })
                                        }));
                                      }}
                                      className="bg-transparent text-xs font-mono font-bold text-foreground/60 outline-none w-12 border-b border-border focus:border-blue-500/50 py-0.5"
                                    />
                                  </div>
                                  <Separator orientation="vertical" className="h-6 bg-foreground/5 hidden sm:block" />
                                  <div className="flex flex-col">
                                    <span className="text-[9px] font-bold text-foreground/20 uppercase tracking-widest whitespace-nowrap">Transition</span>
                                    <select 
                                      value={panel.transition || 'none'}
                                      onChange={(e) => {
                                        setProject(prev => ({
                                          ...prev,
                                          chapters: prev.chapters.map(c => {
                                            if (c.id === currentChapter.id) {
                                              return {
                                                ...c,
                                                panels: c.panels.map(p => p.id === panel.id ? { ...p, transition: e.target.value as any } : p)
                                              };
                                            }
                                            return c;
                                          })
                                        }));
                                      }}
                                      className="bg-transparent text-xs font-mono font-bold text-foreground/60 outline-none cursor-pointer appearance-none min-w-[60px]"
                                    >
                                      <option style={{backgroundColor: '#0f0a20', color: 'white'}} value="none">None</option>
                                      <option style={{backgroundColor: '#0f0a20', color: 'white'}} value="fade">Fade</option>
                                      <option style={{backgroundColor: '#0f0a20', color: 'white'}} value="slide">Slide</option>
                                      <option style={{backgroundColor: '#0f0a20', color: 'white'}} value="zoom">Zoom</option>
                                    </select>
                                  </div>
                                  <Separator orientation="vertical" className="h-6 bg-foreground/5 hidden lg:block" />
                                  <div className="flex flex-col">
                                    <span className="text-[9px] font-bold text-foreground/20 uppercase tracking-widest whitespace-nowrap">AI Length</span>
                                    <select 
                                      value={panel.scriptLength || ''}
                                      onChange={(e) => {
                                        setProject(prev => ({
                                          ...prev,
                                          chapters: prev.chapters.map(c => {
                                            if (c.id === currentChapter.id) {
                                              return {
                                                ...c,
                                                panels: c.panels.map(p => p.id === panel.id ? { ...p, scriptLength: (e.target.value || undefined) as any } : p)
                                              };
                                            }
                                            return c;
                                          })
                                        }));
                                      }}
                                      className="bg-transparent text-xs font-mono font-bold text-foreground/60 outline-none cursor-pointer appearance-none min-w-[70px]"
                                    >
                                      <option style={{backgroundColor: '#0f0a20', color: 'white'}} value="">Global</option>
                                      <option style={{backgroundColor: '#0f0a20', color: 'white'}} value="Short">Short (1)</option>
                                      <option style={{backgroundColor: '#0f0a20', color: 'white'}} value="Normal">Normal (2-3)</option>
                                      <option style={{backgroundColor: '#0f0a20', color: 'white'}} value="Detailed">Long (4+)</option>
                                    </select>
                                  </div>
                                </div>
                                <div className="flex-shrink-0 ml-auto">
                                  <Button 
                                    onClick={() => {
                                      // Remove panel instantly and save to undo stack
                                      setProject(prev => ({
                                        ...prev,
                                        chapters: prev.chapters.map(c => {
                                          if (c.id === currentChapter.id) {
                                            const index = c.panels.findIndex(p => p.id === panel.id);
                                            setDeletedPanelsStack(stack => [...stack, { chapterId: c.id, panel, index }]);
                                            return {
                                              ...c,
                                              panels: c.panels.filter(p => p.id !== panel.id)
                                            };
                                          }
                                          return c;
                                        })
                                      }));
                                      toast.success('Panel deleted');
                                    }}
                                    variant="ghost" 
                                    size="sm" 
                                    className="h-9 w-9 p-0 rounded-full text-foreground/20 hover:text-red-400 hover:bg-red-400/10 transition-colors flex items-center justify-center"
                                  >
                                    <Trash2 className="w-4 h-4 text-red-500/50 hover:text-red-400" />
                                  </Button>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                          </SortableItem>
                          ))}
                            </SortableContext>
                          </div>
                        </DndContext>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Sidebar Settings */}
              <div className="col-span-3 space-y-6">
                    {/* Library / Current Selection */}
                    <Card className="bg-background/40 border-purple-500/10 overflow-hidden shadow-xl shadow-purple-900/10">
                      <CardHeader className="pb-4 flex flex-row items-center justify-between space-y-0 bg-white/[0.02] border-b border-purple-500/10">
                        <div className="flex flex-col">
                          <CardTitle className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-400/60">Current Selection</CardTitle>
                          <span className="text-[9px] font-mono text-foreground/20 uppercase tracking-widest mt-0.5">Active context</span>
                        </div>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8 text-foreground/40 hover:text-foreground hover:bg-foreground/5 rounded-full"
                          onClick={() => setActiveTab('library')}
                        >
                          <Library className="w-4 h-4" />
                        </Button>
                      </CardHeader>
                      <CardContent className="p-4 space-y-4">
                        {currentTitleId ? (
                          <div className="space-y-4">
                            <div className="flex items-center gap-3 p-3 rounded-2xl bg-white/[0.03] border border-border/50">
                              <div className="w-12 h-12 bg-background rounded-xl border border-border flex items-center justify-center overflow-hidden">
                                {project.titles.find(t => t.id === currentTitleId)?.coverUrl ? (
                                  <img src={project.titles.find(t => t.id === currentTitleId)?.coverUrl} className="w-full h-full object-cover" />
                                ) : (
                                  <ImageIcon className="w-6 h-6 text-foreground/10" />
                                )}
                              </div>
                              <div className="flex flex-col">
                                <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest">
                                  {project.categories.find(c => c.id === currentCategoryId)?.name}
                                </span>
                                <span className="text-sm font-black text-foreground uppercase tracking-tight">
                                  {project.titles.find(t => t.id === currentTitleId)?.name}
                                </span>
                              </div>
                            </div>

                            <div className="space-y-2">
                              <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-foreground/20 px-1">Recent Chapters</span>
                              <div className="space-y-2">
                                {project.chapters
                                  .filter(c => c.titleId === currentTitleId)
                                  .slice(0, 5)
                                  .map(chapter => (
                                    <div key={chapter.id}>
                                      <ChapterItem chapter={chapter} />
                                    </div>
                                  ))
                                }
                                {project.chapters.filter(c => c.titleId === currentTitleId).length === 0 && (
                                  <p className="text-[10px] text-foreground/10 py-4 text-center italic border border-dashed border-border/50 rounded-xl">
                                    No chapters yet
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="py-12 flex flex-col items-center justify-center text-center space-y-4">
                            <div className="w-16 h-16 bg-white/[0.02] rounded-full flex items-center justify-center border border-border/50">
                              <Library className="w-8 h-8 text-foreground/10" />
                            </div>
                            <div className="space-y-1">
                              <p className="text-xs font-bold text-foreground/40 uppercase tracking-widest">No Title Selected</p>
                              <p className="text-[10px] text-foreground/20 max-w-[180px]">Select a title from the library to start uploading chapters.</p>
                            </div>
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={() => setActiveTab('library')}
                              className="border-border bg-foreground/5 hover:bg-foreground/10 text-[10px] font-bold uppercase tracking-widest h-9 px-6 rounded-xl"
                            >
                              Go to Library
                            </Button>
                          </div>
                        )}
                      </CardContent>
                    </Card>

                    <Card className="bg-background/40 border-purple-500/10 overflow-hidden shadow-xl shadow-purple-900/10">
                      <CardHeader className="bg-white/[0.02] border-b border-purple-500/10 pb-6">
                        <div className="flex flex-col">
                          <CardTitle className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-400/60">Project Statistics</CardTitle>
                          <span className="text-[9px] font-mono text-foreground/20 uppercase tracking-widest mt-0.5">Current chapter overview</span>
                        </div>
                      </CardHeader>
                      <CardContent className="p-6 space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div className="bg-white/[0.02] border border-border/50 rounded-xl p-4 flex flex-col items-center justify-center text-center">
                            <span className="text-2xl font-black text-foreground">{currentChapter?.panels.length || 0}</span>
                            <span className="text-[9px] font-bold uppercase tracking-widest text-foreground/40 mt-1">Total Panels</span>
                          </div>
                          <div className="bg-white/[0.02] border border-border/50 rounded-xl p-4 flex flex-col items-center justify-center text-center">
                            <span className="text-2xl font-black text-foreground">
                              {Math.round((currentChapter?.panels.reduce((acc, p) => acc + p.duration, 0) || 0) / project.settings.globalSpeed)}s
                            </span>
                            <span className="text-[9px] font-bold uppercase tracking-widest text-foreground/40 mt-1">Est. Duration</span>
                          </div>
                        </div>
                        <div className="bg-blue-600/10 border border-blue-500/20 rounded-xl p-4 flex flex-col items-center justify-center text-center">
                          <span className="text-lg font-black text-blue-400">~{Math.round((currentChapter?.panels.length || 0) * 2.5)} MB</span>
                          <span className="text-[9px] font-bold uppercase tracking-widest text-blue-400/60 mt-1">Est. Video Size ({project.settings.exportResolution || '1080p'})</span>
                        </div>
                      </CardContent>
                    </Card>

                    <Card className="bg-background/40 border-purple-500/10 sticky top-28 overflow-hidden shadow-xl shadow-purple-900/10">
                      <CardHeader className="bg-white/[0.02] border-b border-purple-500/10 pb-6">
                        <div className="flex flex-col">
                          <CardTitle className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-400/60">Global Engine Settings</CardTitle>
                          <span className="text-[9px] font-mono text-foreground/20 uppercase tracking-widest mt-0.5">Configure output parameters</span>
                        </div>
                      </CardHeader>
                      <CardContent className="p-6 space-y-8">
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground/40">Script Language</label>
                          </div>
                          <select 
                            value={project.settings.language || 'English'}
                            onChange={(e) => setProject(prev => ({ ...prev, settings: { ...prev.settings, language: e.target.value } }))}
                            className="w-full bg-background/40 border border-border/50 rounded-xl p-4 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 text-foreground/80 transition-all appearance-none cursor-pointer"
                          >
                            <option value="English">English</option>
                            <option value="Bahasa Indonesia">Bahasa Indonesia</option>
                            <option value="Japanese">Japanese</option>
                            <option value="Korean">Korean</option>
                            <option value="Spanish">Spanish</option>
                          </select>
                        </div>

                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground/40">Narrator Voice</label>
                            <div className="px-2 py-0.5 bg-blue-600/10 rounded text-[9px] font-mono text-blue-400 border border-blue-500/20">
                              HD ENGINE
                            </div>
                          </div>
                          <select 
                            value={project.settings.globalVoiceId || 'Kore'}
                            onChange={(e) => setProject(prev => ({ ...prev, settings: { ...prev.settings, globalVoiceId: e.target.value } }))}
                            className="w-full bg-background/40 border border-border/50 rounded-xl p-4 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 text-foreground/80 transition-all appearance-none cursor-pointer"
                          >
                            <option value="Kore">Kore (Female)</option>
                            <option value="Puck">Puck (Male)</option>
                            <option value="Charon">Charon (Male)</option>
                            <option value="Fenrir">Fenrir (Male)</option>
                            <option value="Zephyr">Zephyr (Female)</option>
                          </select>
                        </div>

                        <div className="space-y-4">
                          <div className="flex justify-between items-end">
                            <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground/40">Narration Speed</label>
                            <span className="text-sm font-mono text-blue-400 font-bold tracking-tighter">{project.settings.globalSpeed.toFixed(1)}x</span>
                          </div>
                          <Slider 
                            value={[project.settings.globalSpeed]} 
                            min={0.5} 
                            max={2.0} 
                            step={0.1}
                            onValueChange={(val: number | readonly number[]) => {
                              const numVal = Array.isArray(val) ? val[0] : val;
                              setProject(prev => ({ ...prev, settings: { ...prev.settings, globalSpeed: numVal } }));
                            }}
                            className="py-2"
                          />
                          <div className="flex justify-between text-[8px] font-mono text-foreground/10 uppercase tracking-widest">
                            <span>Slower</span>
                            <span>Normal</span>
                            <span>Faster</span>
                          </div>
                        </div>

                        <div className="h-px bg-foreground/5" />

                        <div className="space-y-4">
                          <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground/40">Atmospheric Audio</label>
                          <div className="flex flex-col gap-3">
                            <Button 
                              variant="outline" 
                              className="w-full border-border/50 bg-white/[0.02] hover:bg-white/[0.05] hover:border-border gap-3 h-12 rounded-xl text-xs font-bold transition-all"
                              onClick={() => {
                                const input = document.createElement('input');
                                input.type = 'file';
                                input.accept = 'audio/*';
                                input.onchange = async (e) => {
                                  const file = (e.target as HTMLInputElement).files?.[0];
                                  if (file) {
                                    const url = URL.createObjectURL(file);
                                    setProject(prev => ({
                                      ...prev,
                                      settings: { ...prev.settings, musicUrl: url }
                                    }));
                                    toast.success('Atmospheric audio loaded');
                                  }
                                };
                                input.click();
                              }}
                            >
                              <Music className="w-4 h-4 text-blue-500" /> 
                              {project.settings.musicUrl ? 'Replace Soundtrack' : 'Add Soundtrack'}
                            </Button>
                            
                            {project.settings.musicUrl && (
                              <div className="flex items-center justify-between px-4 py-3 bg-blue-600/5 rounded-xl border border-blue-500/10 animate-in zoom-in duration-300">
                                <div className="flex items-center gap-3 overflow-hidden">
                                  <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                                  <span className="text-[10px] font-mono text-blue-400/80 truncate">AUDIO_STREAM_ACTIVE.mp3</span>
                                </div>
                                <Button 
                                  variant="ghost" 
                                  size="sm" 
                                  className="h-7 w-7 p-0 text-foreground/20 hover:text-red-400 hover:bg-red-400/10 rounded-full transition-colors"
                                  onClick={() => setProject(prev => ({ ...prev, settings: { ...prev.settings, musicUrl: undefined } }))}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="h-px bg-foreground/5" />

                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground/40">Video Ratio / Layout</label>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <button
                              type="button"
                              className={`flex flex-col items-center justify-center p-3.5 rounded-xl border text-center transition-all cursor-pointer ${
                                (project.settings.videoFormat || 'landscape') === 'landscape'
                                  ? 'bg-blue-600/10 border-blue-500/50 text-foreground shadow-xl shadow-blue-500/5'
                                  : 'bg-background/30 border-border/50 text-foreground/40 hover:text-foreground/80 hover:bg-foreground/5'
                              }`}
                              onClick={() => setProject(prev => ({ ...prev, settings: { ...prev.settings, videoFormat: 'landscape' } }))}
                            >
                              <Video className="w-5 h-5 mb-1.5 text-blue-400" />
                              <span className="text-xs font-bold leading-none mb-1">Landscape (16:9)</span>
                              <span className="text-[9px] text-foreground/35 font-medium">Standard Web & YouTube</span>
                            </button>
                            <button
                              type="button"
                              className={`flex flex-col items-center justify-center p-3.5 rounded-xl border text-center transition-all cursor-pointer ${
                                project.settings.videoFormat === 'vertical'
                                  ? 'bg-blue-600/10 border-blue-500/50 text-foreground shadow-xl shadow-blue-500/5'
                                  : 'bg-background/30 border-border/50 text-foreground/40 hover:text-foreground/80 hover:bg-foreground/5'
                              }`}
                              onClick={() => setProject(prev => ({ ...prev, settings: { ...prev.settings, videoFormat: 'vertical' } }))}
                            >
                              <Smartphone className="w-5 h-5 mb-1.5 text-pink-400" />
                              <span className="text-xs font-bold leading-none mb-1">Vertical (9:16)</span>
                              <span className="text-[9px] text-foreground/35 font-medium">YouTube Shorts & Reels</span>
                            </button>
                          </div>
                        </div>

                        <div className="h-px bg-foreground/5" />

                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground/40">Export Resolution</label>
                          </div>
                          <select 
                            value={project.settings.exportResolution || '1080p'}
                            onChange={(e) => setProject(prev => ({ ...prev, settings: { ...prev.settings, exportResolution: e.target.value as any } }))}
                            className="w-full bg-background/40 border border-border/50 rounded-xl p-4 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 text-foreground/80 transition-all appearance-none cursor-pointer"
                          >
                            <option value="720p">720p (HD)</option>
                            <option value="1080p">1080p (Full HD)</option>
                            <option value="4K">4K (Ultra HD)</option>
                          </select>
                        </div>

                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground/40">Export Quality</label>
                          </div>
                          <select 
                            value={project.settings.exportQuality || 'High'}
                            onChange={(e) => setProject(prev => ({ ...prev, settings: { ...prev.settings, exportQuality: e.target.value as any } }))}
                            className="w-full bg-background/40 border border-border/50 rounded-xl p-4 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 text-foreground/80 transition-all appearance-none cursor-pointer"
                          >
                            <option value="Low">Low (Faster Export)</option>
                            <option value="Medium">Medium (Balanced)</option>
                            <option value="High">High (Best Quality)</option>
                          </select>
                        </div>

                        <div className="h-px bg-foreground/5" />

                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground/40">AI Script Length</label>
                          </div>
                          <select 
                            value={project.settings.scriptLength || 'Normal'}
                            onChange={(e) => setProject(prev => ({ ...prev, settings: { ...prev.settings, scriptLength: e.target.value as any } }))}
                            className="w-full bg-background/40 border border-border/50 rounded-xl p-4 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 text-foreground/80 transition-all appearance-none cursor-pointer"
                          >
                            <option value="Short">Short (1 Sentence Max)</option>
                            <option value="Normal">Normal (1-3 Sentences)</option>
                            <option value="Detailed">Detailed (4+ Sentences)</option>
                          </select>
                        </div>

                        <div className="space-y-4">
                          <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground/40">Gemini API Key</label>
                          <input 
                            type="password"
                            placeholder="Enter your Gemini API Key"
                            className="w-full bg-background/40 border border-border/50 rounded-xl p-4 text-xs font-mono outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 text-foreground/80 transition-all placeholder:text-foreground/20"
                            onChange={(e) => {
                              import('./services/gemini').then(m => m.setCustomGeminiApiKey(e.target.value));
                              if (e.target.value) {
                                toast.success('Custom API Key set', { id: 'api-key-toast', duration: 2000 });
                              }
                            }}
                          />
                          <p className="text-[10px] text-foreground/30 font-medium leading-relaxed">Required for AI TTS and panel detection. Get one from Google AI Studio.</p>
                        </div>

                        <Button 
                          onClick={saveDraft}
                          className="w-full bg-blue-600 hover:bg-blue-700 text-foreground font-bold h-12"
                        >
                          <Save className="w-4 h-4 mr-2" /> Save Draft
                        </Button>
                      </CardContent>
                    </Card>
                  </div>
                </motion.div>
              </TabsContent>

              <TabsContent key="preview-tab" value="preview" className="m-0">
                <motion.div 
                  key="preview-content"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="flex flex-col items-center justify-center min-h-[60vh] space-y-8"
                >
                  <div className={`relative bg-background rounded-3xl overflow-hidden shadow-2xl shadow-blue-500/10 border border-border transition-all duration-300 ${
                    project.settings.videoFormat === 'vertical'
                      ? 'aspect-[9/16] h-[650px] md:h-[700px] w-auto'
                      : 'aspect-video w-full max-w-4xl'
                  }`}>
                    {currentPanelIndex >= 0 && currentChapter ? (
                      <div className="relative w-full h-full overflow-hidden flex items-center justify-center">
                        {/* Blurred background image - clear, bright, and recognizable visual presentation */}
                        <img 
                          src={currentChapter.panels[currentPanelIndex].imageUrl} 
                          className="absolute inset-0 w-full h-full object-cover blur-[10px] scale-110 opacity-75 select-none pointer-events-none brightness-[0.78]"
                        />
                        {/* Crispy centered image with shadow and custom PowerPoint-like enter transition */}
                        {(() => {
                          const transitionStyle = ['fade', 'slide-left', 'slide-right', 'zoom-in', 'slide-up', 'zoom-out', 'slide-down'][currentPanelIndex % 7];
                          let initial = {};
                          let animate = { opacity: 1, x: 0, y: 0, scale: 1 };
                          let duration = 0.6;

                          if (transitionStyle === 'fade') {
                            initial = { opacity: 0 };
                          } else if (transitionStyle === 'slide-left') {
                            initial = { opacity: 0, x: 120 };
                          } else if (transitionStyle === 'slide-right') {
                            initial = { opacity: 0, x: -120 };
                          } else if (transitionStyle === 'zoom-in') {
                            initial = { opacity: 0, scale: 0.85 };
                          } else if (transitionStyle === 'zoom-out') {
                            initial = { opacity: 0, scale: 1.15 };
                          } else if (transitionStyle === 'slide-up') {
                            initial = { opacity: 0, y: 120 };
                          } else if (transitionStyle === 'slide-down') {
                            initial = { opacity: 0, y: -120 };
                          }

                          return (
                            <motion.img 
                              key={currentChapter.panels[currentPanelIndex].id}
                              initial={initial}
                              animate={animate}
                              transition={{ duration, ease: "easeOut" }}
                              src={currentChapter.panels[currentPanelIndex].imageUrl} 
                              className="relative z-10 max-h-full max-w-full object-contain shadow-2xl rounded-sm border border-border/50"
                            />
                          );
                        })()}
                      </div>
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-zinc-900/50">
                        <Play className="w-20 h-20 text-foreground/10" />
                      </div>
                    )}
                    
                    {/* Subtitles */}
                    {currentPanelIndex >= 0 && currentChapter && (
                      <div className="absolute bottom-8 left-0 right-0 px-8 md:px-12 text-center pointer-events-none z-20">
                        <p className={`
                          font-medium bg-background/75 backdrop-blur-md py-2.5 px-5 rounded-2xl inline-block border border-border text-foreground text-center shadow-2xl leading-relaxed whitespace-pre-wrap
                          ${project.settings.videoFormat === 'vertical' ? 'text-xs md:text-sm max-w-[90%]' : 'text-sm md:text-base lg:text-lg max-w-[75%]'}
                        `}>
                          {currentChapter.panels[currentPanelIndex].script}
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-6">
                    <Button 
                      size="lg" 
                      onClick={() => {
                        if (isPlaying) {
                          setIsPlaying(false);
                          isPlayingRef.current = false;
                        } else {
                          playPreview();
                        }
                      }}
                      disabled={!currentChapter}
                      className="h-16 px-10 rounded-full bg-blue-600 hover:bg-blue-700 text-foreground font-bold text-lg shadow-xl shadow-blue-500/20"
                    >
                      {isPlaying ? <Loader2 className="w-6 h-6 animate-spin mr-2" /> : <Play className="w-6 h-6 mr-2 fill-current" />}
                      {isPlaying ? 'Stop Preview' : 'Start Preview'}
                    </Button>
                    {currentChapter && currentChapter.panels.length > 0 && (
                      <Button 
                        onClick={handleDownloadFFmpegProject}
                        disabled={isProcessing}
                        variant="secondary" 
                        size="lg"
                        className="h-16 px-8 rounded-full bg-purple-600/20 border border-purple-500/20 text-purple-300 hover:bg-purple-600/30 text-lg font-bold"
                      >
                        <Download className="w-6 h-6 mr-2" /> Download FFmpeg
                      </Button>
                    )}
                    <Button 
                      onClick={handleExportVideo}
                      disabled={isProcessing || !currentChapter || currentChapter.panels.some(p => !p.script.trim())}
                      variant="outline" 
                      size="lg"
                      className="h-16 px-10 rounded-full border-border bg-foreground/5 hover:bg-foreground/10 text-lg font-bold"
                    >
                      <Download className="w-6 h-6 mr-2" /> {isProcessing ? 'Exporting...' : 'Export Video'}
                    </Button>
                  </div>
                </motion.div>
              </TabsContent>

              <TabsContent value="exposure" className="mt-0">
                <div className="max-w-3xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-700 pb-20">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-2xl font-black tracking-tight text-foreground mt-10">Social Media Exposure</h2>
                      <p className="text-foreground/40 mt-1">Generate high-CTR metadata tailored for TikTok, Reels, & Shorts.</p>
                    </div>
                    <Button
                      onClick={handleGenerateMetadata}
                      disabled={isProcessing || !currentChapter || currentChapter.panels.length === 0}
                      className="bg-fuchsia-600 hover:bg-fuchsia-700 text-foreground font-bold h-12 px-6 rounded-2xl shadow-xl shadow-fuchsia-500/20"
                    >
                      <Sparkles className="w-4 h-4 mr-2" /> {isProcessing ? 'Generating...' : 'Auto-Generate Hooks'}
                    </Button>
                  </div>
                  
                  {currentChapter?.socialMetadata ? (
                    <Card className="bg-background/40 border-fuchsia-500/20 overflow-hidden shadow-2xl shadow-fuchsia-900/10">
                      <CardHeader className="bg-white/[0.02] border-b border-fuchsia-500/10">
                        <CardTitle className="text-fuchsia-400 font-bold uppercase tracking-widest text-[10px]">Viral Video Hooks</CardTitle>
                      </CardHeader>
                      <CardContent className="p-6 space-y-6">
                        <div className="space-y-2">
                          <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground/40">Title / Hook (Max 60 Chars)</label>
                          <textarea 
                            value={currentChapter.socialMetadata.titleHook}
                            onChange={(e) => setProject(prev => ({
                              ...prev,
                              chapters: prev.chapters.map(c => 
                                c.id === currentChapter?.id ? { ...c, socialMetadata: { ...c.socialMetadata!, titleHook: e.target.value } } : c
                              )
                            }))}
                            className="w-full bg-background/40 border border-border/50 rounded-xl p-4 font-bold text-foreground text-lg focus:border-fuchsia-500/50 outline-none resize-none"
                            rows={2}
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground/40">Caption</label>
                          <textarea 
                            value={currentChapter.socialMetadata.description}
                            onChange={(e) => setProject(prev => ({
                              ...prev,
                              chapters: prev.chapters.map(c => 
                                c.id === currentChapter?.id ? { ...c, socialMetadata: { ...c.socialMetadata!, description: e.target.value } } : c
                              )
                            }))}
                            className="w-full bg-background/40 border border-border/50 rounded-xl p-4 text-foreground/80 focus:border-fuchsia-500/50 outline-none resize-vertical min-h-[100px]"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground/40">Hashtags</label>
                          <input 
                            value={currentChapter.socialMetadata.hashtags}
                            onChange={(e) => setProject(prev => ({
                              ...prev,
                              chapters: prev.chapters.map(c => 
                                c.id === currentChapter?.id ? { ...c, socialMetadata: { ...c.socialMetadata!, hashtags: e.target.value } } : c
                              )
                            }))}
                            className="w-full bg-background/40 border border-border/50 rounded-xl px-4 py-3 font-mono text-blue-400 focus:border-fuchsia-500/50 outline-none"
                          />
                        </div>
                      </CardContent>
                    </Card>
                  ) : (
                    <div className="h-64 rounded-3xl border-2 border-dashed border-border flex flex-col items-center justify-center text-foreground/20">
                      <Sparkles className="w-12 h-12 mb-4 opacity-50" />
                      <p className="font-bold">No Metadata Generated</p>
                      <p className="text-sm">Click the generate button above to analyze your script.</p>
                    </div>
                  )}
                </div>
              </TabsContent>
            </AnimatePresence>
          </Tabs>
        </main>

        <Dialog open={isUploadOptionsDialogOpen} onOpenChange={setIsUploadOptionsDialogOpen}>
          <DialogContent className="bg-background border-border text-foreground max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-foreground">Upload Options</DialogTitle>
              <p className="text-sm text-foreground/40">
                You are uploading {pendingUploadFiles?.length} file(s). How would you like to process them?
              </p>
            </DialogHeader>
            <div className="grid grid-cols-1 gap-4 py-4">
              <Button 
                variant="outline"
                className="h-20 border-border bg-foreground/5 hover:bg-foreground/10 hover:border-blue-500/50 flex flex-col items-start p-4 text-left rounded-2xl gap-1 transition-all"
                onClick={() => pendingUploadFiles && processUpload(pendingUploadFiles, 'combine')}
              >
                <div className="flex items-center gap-2 font-black text-sm uppercase tracking-wider text-blue-400">
                  <FolderPlus className="w-4 h-4" />
                  Combine into Single Chapter
                </div>
                <span className="text-xs text-foreground/50 font-normal">
                  Creates one new chapter containing all uploaded images.
                </span>
              </Button>

              {project.currentChapterId && (
                <Button 
                  variant="outline"
                  className="h-20 border-border bg-foreground/5 hover:bg-foreground/10 hover:border-blue-500/50 flex flex-col items-start p-4 text-left rounded-2xl gap-1 transition-all"
                  onClick={() => pendingUploadFiles && processUpload(pendingUploadFiles, 'append')}
                >
                  <div className="flex items-center gap-2 font-black text-sm uppercase tracking-wider text-green-400">
                    <Plus className="w-4 h-4" />
                    Append to Current Chapter
                  </div>
                  <span className="text-xs text-foreground/50 font-normal">
                    Adds the new pages to the end of the currently active chapter: "
                    {project.chapters.find(c => c.id === project.currentChapterId)?.name}"
                  </span>
                </Button>
              )}

              <Button 
                variant="outline"
                className="h-20 border-border bg-foreground/5 hover:bg-foreground/10 hover:border-blue-500/50 flex flex-col items-start p-4 text-left rounded-2xl gap-1 transition-all"
                onClick={() => pendingUploadFiles && processUpload(pendingUploadFiles, 'separate')}
              >
                <div className="flex items-center gap-2 font-black text-sm uppercase tracking-wider text-purple-400">
                  <Layers className="w-4 h-4" />
                  Create Separate Chapters
                </div>
                <span className="text-xs text-foreground/50 font-normal">
                  Creates a new chapter for each uploaded file (original behavior).
                </span>
              </Button>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => {
                setIsUploadOptionsDialogOpen(false);
                setPendingUploadFiles(null);
              }}>
                Cancel
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={isAddTitleDialogOpen} onOpenChange={setIsAddTitleDialogOpen}>
          <DialogContent className="bg-background border-border text-foreground max-w-md">
            <DialogHeader>
              <DialogTitle className="text-foreground">Add New Title</DialogTitle>
              <p className="text-sm text-foreground/40">Enter the name of the series you want to add.</p>
            </DialogHeader>
            <div className="py-4">
              <input 
                autoFocus
                value={newTitleName}
                onChange={(e) => setNewTitleName(e.target.value)}
                placeholder="e.g. Solo Leveling"
                className="w-full bg-background/40 border border-border rounded-xl p-4 text-sm outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 text-foreground transition-all"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newTitleName.trim()) {
                    const newTitle: Title = {
                      id: generateId(),
                      name: newTitleName.trim(),
                      categoryId: currentCategoryId!,
                      createdAt: Date.now()
                    };
                    setProject(prev => ({
                      ...prev,
                      titles: [...prev.titles, newTitle],
                      categories: prev.categories.map(c => 
                        c.id === currentCategoryId ? { ...c, titleIds: [...c.titleIds, newTitle.id] } : c
                      )
                    }));
                    setNewTitleName('');
                    setIsAddTitleDialogOpen(false);
                  }
                }}
              />
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setIsAddTitleDialogOpen(false)}>Cancel</Button>
              <Button 
                disabled={!newTitleName.trim()}
                onClick={() => {
                  const newTitle: Title = {
                    id: generateId(),
                    name: newTitleName.trim(),
                    categoryId: currentCategoryId!,
                    createdAt: Date.now()
                  };
                  setProject(prev => ({
                    ...prev,
                    titles: [...prev.titles, newTitle],
                    categories: prev.categories.map(c => 
                      c.id === currentCategoryId ? { ...c, titleIds: [...c.titleIds, newTitle.id] } : c
                    )
                  }));
                  setNewTitleName('');
                  setIsAddTitleDialogOpen(false);
                }}
                className="bg-blue-600 hover:bg-blue-700 text-foreground"
              >
                Create Title
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={isRenameChapterDialogOpen} onOpenChange={setIsRenameChapterDialogOpen}>
          <DialogContent className="bg-background border-border text-foreground max-w-md">
            <DialogHeader>
              <DialogTitle className="text-foreground">Rename Chapter</DialogTitle>
              <p className="text-sm text-foreground/40">Enter a new name for this chapter.</p>
            </DialogHeader>
            <div className="py-4">
              <input 
                autoFocus
                value={newChapterName}
                onChange={(e) => setNewChapterName(e.target.value)}
                placeholder="Chapter Name"
                className="w-full bg-background/40 border border-border rounded-xl p-4 text-sm outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 text-foreground transition-all"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newChapterName.trim() && chapterToRename) {
                    setProject(prev => ({
                      ...prev,
                      chapters: prev.chapters.map(c => 
                        c.id === chapterToRename.id ? { ...c, name: newChapterName.trim() } : c
                      )
                    }));
                    setIsRenameChapterDialogOpen(false);
                  }
                }}
              />
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setIsRenameChapterDialogOpen(false)}>Cancel</Button>
              <Button 
                disabled={!newChapterName.trim()}
                onClick={() => {
                  if (chapterToRename) {
                    setProject(prev => ({
                      ...prev,
                      chapters: prev.chapters.map(c => 
                        c.id === chapterToRename.id ? { ...c, name: newChapterName.trim() } : c
                      )
                    }));
                    setIsRenameChapterDialogOpen(false);
                  }
                }}
                className="bg-blue-600 hover:bg-blue-700 text-foreground"
              >
                Rename
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={isDeleteChapterDialogOpen} onOpenChange={setIsDeleteChapterDialogOpen}>
          <DialogContent className="bg-background border-border text-foreground max-w-md">
            <DialogHeader>
              <DialogTitle className="text-foreground">Delete Chapter</DialogTitle>
              <p className="text-sm text-foreground/40">Are you sure you want to delete "{chapterToDelete?.name}"? This action cannot be undone and all associated panels will be lost.</p>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="ghost" onClick={() => setIsDeleteChapterDialogOpen(false)}>Cancel</Button>
              <Button 
                onClick={() => {
                  if (chapterToDelete) {
                    setProject(prev => ({
                      ...prev,
                      chapters: prev.chapters.filter(c => c.id !== chapterToDelete.id),
                      currentChapterId: prev.currentChapterId === chapterToDelete.id ? (prev.chapters.find(c => c.id !== chapterToDelete.id)?.id || '') : prev.currentChapterId
                    }));
                    toast.success('Chapter deleted');
                    setIsDeleteChapterDialogOpen(false);
                  }
                }}
                className="bg-red-600 hover:bg-red-700 text-foreground"
              >
                Delete Chapter
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={isManualSelectorOpen} onOpenChange={setIsManualSelectorOpen}>
          <DialogContent className="bg-background border-none text-foreground max-w-none sm:max-w-none w-screen h-screen flex flex-col p-0 rounded-none overflow-hidden fixed inset-0 translate-x-0 translate-y-0 left-0 top-0">
            {manualSelectionData && (
              <ManualPanelSelector 
                images={manualSelectionData.pageUrls}
                initialPageIndex={manualSelectionData.initialPageIndex}
                initialRects={manualSelectionData.initialRects}
                onComplete={handleManualSelectionComplete}
                onCancel={() => {
                  setIsManualSelectorOpen(false);
                  setManualSelectionData(null);
                }}
              />
            )}
          </DialogContent>
        </Dialog>

        <Dialog open={isExtendDialogOpen} onOpenChange={setIsExtendDialogOpen}>
          <DialogContent className="bg-background border-border text-foreground max-w-2xl">
            <DialogHeader>
              <DialogTitle className="text-foreground">Extend Visuals</DialogTitle>
              <p className="text-sm text-foreground">Add background elements or additional images to this panel.</p>
            </DialogHeader>
            
            <div className="space-y-6 py-4">
              <div className="aspect-video bg-background rounded-2xl overflow-hidden border border-border relative">
                {editingPanelId && currentChapter && (
                  <>
                    <img 
                      src={currentChapter.panels.find(p => p.id === editingPanelId)?.imageUrl} 
                      className="w-full h-full object-contain z-10 relative" 
                    />
                    {currentChapter.panels.find(p => p.id === editingPanelId)?.backgroundElements?.[0] && (
                      <img 
                        src={currentChapter.panels.find(p => p.id === editingPanelId)?.backgroundElements?.[0]} 
                        className="absolute inset-0 w-full h-full object-cover opacity-50 blur-sm" 
                      />
                    )}
                  </>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Button 
                  variant="outline" 
                  className="h-24 border-border bg-foreground/5 hover:bg-foreground/10 flex-col gap-2"
                  onClick={() => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = 'image/*';
                    input.onchange = async (e) => {
                      const file = (e.target as HTMLInputElement).files?.[0];
                      if (file && editingPanelId) {
                        const base64 = await fileToBase64(file);
                        setProject(prev => ({
                          ...prev,
                          chapters: prev.chapters.map(c => {
                            if (c.id === currentChapter?.id) {
                              return {
                                ...c,
                                panels: c.panels.map(p => p.id === editingPanelId ? { ...p, backgroundElements: [base64] } : p)
                              };
                            }
                            return c;
                          })
                        }));
                        toast.success('Background element added!');
                      }
                    };
                    input.click();
                  }}
                >
                  <Plus className="w-6 h-6" />
                  <span className="text-xs font-bold uppercase tracking-wider">Add Background</span>
                </Button>
                
                <div className="p-4 bg-foreground/5 rounded-2xl border border-border flex flex-col justify-center">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-foreground/70 mb-2">Visual Effects</h4>
                  <div className="flex gap-2">
                    {['Blur', 'Zoom', 'Pan'].map(fx => (
                      <div key={fx} className="px-2 py-1 bg-foreground/10 rounded text-[10px] font-medium border border-border text-foreground">
                        {fx}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button onClick={() => setIsExtendDialogOpen(false)} className="bg-blue-600 text-foreground font-bold">
                Done
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={isSettingsDialogOpen} onOpenChange={setIsSettingsDialogOpen}>
          <DialogContent className="bg-background border-border text-foreground max-w-2xl">
            <DialogHeader>
              <DialogTitle className="text-foreground text-xl font-black uppercase tracking-tight">Application Settings</DialogTitle>
              <p className="text-xs text-foreground/40 font-medium">Configure all standards and engine requirements for PanelFlow.</p>
            </DialogHeader>
            
            <div className="space-y-6 py-4 max-h-[70vh] overflow-y-auto pr-2">
              {/* Gemini API Key */}
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground/50">Gemini API Key</label>
                <input 
                  type="password"
                  placeholder="Masukkan Gemini API Key Anda"
                  value={apiKeyInputVal}
                  className="w-full bg-background/40 border border-border/50 rounded-xl p-4 text-xs font-mono outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 text-foreground/80 transition-all placeholder:text-foreground/20"
                  onChange={(e) => {
                    setApiKeyInputVal(e.target.value);
                    localStorage.setItem('panelflow_gemini_api_key', e.target.value);
                    import('./services/gemini').then(m => m.setCustomGeminiApiKey(e.target.value));
                  }}
                />
                <p className="text-[9px] text-foreground/30 font-medium leading-relaxed uppercase tracking-wider">
                  Dibutuhkan untuk deteksi panel bertenaga AI. Dapatkan secara gratis di Google AI Studio.
                </p>
              </div>

              {/* Speech Voice Engine */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground/50">Voice Synthesis Engine</label>
                  <select 
                    value={project.settings.voiceEngine || 'free'}
                    onChange={(e) => setProject(prev => ({ 
                      ...prev, 
                      settings: { ...prev.settings, voiceEngine: e.target.value as any } 
                    }))}
                    className="w-full bg-background/40 border border-border/50 rounded-xl p-4 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500/50 text-foreground/80 cursor-pointer"
                  >
                    <option value="free">Free Engine (Google/Edge TTS - Unlimited)</option>
                    <option value="gemini">Gemini AI Engine (Requires API Key)</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground/50">Default Voice</label>
                  <select 
                    value={project.settings.globalVoiceId || 'Kore'}
                    onChange={(e) => setProject(prev => ({ 
                      ...prev, 
                      settings: { ...prev.settings, globalVoiceId: e.target.value } 
                    }))}
                    className="w-full bg-background/40 border border-border/50 rounded-xl p-4 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500/50 text-foreground/80 cursor-pointer"
                  >
                    <option value="Kore">Kore (Standard Male)</option>
                    <option value="Puck">Puck (Energetic Male)</option>
                    <option value="Fenrir">Fenrir (Deep Voice)</option>
                    <option value="Aoede">Aoede (Standard Female)</option>
                    <option value="Charon">Charon (Whisper/Soft)</option>
                  </select>
                </div>
              </div>

              {/* Language & Script Length */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground/50">Default Narration Language</label>
                  <select 
                    value={project.settings.language || 'English'}
                    onChange={(e) => setProject(prev => ({ 
                      ...prev, 
                      settings: { ...prev.settings, language: e.target.value } 
                    }))}
                    className="w-full bg-background/40 border border-border/50 rounded-xl p-4 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500/50 text-foreground/80 cursor-pointer"
                  >
                    <option value="English">English</option>
                    <option value="Indonesian">Indonesian</option>
                    <option value="Japanese">Japanese</option>
                    <option value="Spanish">Spanish</option>
                    <option value="Korean">Korean</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground/50">Default Script Length</label>
                  <select 
                    value={project.settings.scriptLength || 'Normal'}
                    onChange={(e) => setProject(prev => ({ 
                      ...prev, 
                      settings: { ...prev.settings, scriptLength: e.target.value as any } 
                    }))}
                    className="w-full bg-background/40 border border-border/50 rounded-xl p-4 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500/50 text-foreground/80 cursor-pointer"
                  >
                    <option value="Short">Short (1 Sentence Max)</option>
                    <option value="Normal">Normal (1-3 Sentences)</option>
                    <option value="Detailed">Detailed (4+ Sentences)</option>
                  </select>
                </div>
              </div>

              {/* Video Format & Resolution Standards */}
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground/50">Video Layout</label>
                  <select 
                    value={project.settings.videoFormat || 'landscape'}
                    onChange={(e) => setProject(prev => ({ 
                      ...prev, 
                      settings: { ...prev.settings, videoFormat: e.target.value as any } 
                    }))}
                    className="w-full bg-background/40 border border-border/50 rounded-xl p-4 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500/50 text-foreground/80 cursor-pointer"
                  >
                    <option value="landscape">Landscape (16:9)</option>
                    <option value="vertical">Vertical (9:16)</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground/50">Target Resolution</label>
                  <select 
                    value={project.settings.exportResolution || '1080p'}
                    onChange={(e) => setProject(prev => ({ 
                      ...prev, 
                      settings: { ...prev.settings, exportResolution: e.target.value as any } 
                    }))}
                    className="w-full bg-background/40 border border-border/50 rounded-xl p-4 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500/50 text-foreground/80 cursor-pointer"
                  >
                    <option value="720p">HD (720p)</option>
                    <option value="1080p">FHD (1080p)</option>
                    <option value="4K">UHD (4K)</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground/50">Export Quality</label>
                  <select 
                    value={project.settings.exportQuality || 'Medium'}
                    onChange={(e) => setProject(prev => ({ 
                      ...prev, 
                      settings: { ...prev.settings, exportQuality: e.target.value as any } 
                    }))}
                    className="w-full bg-background/40 border border-border/50 rounded-xl p-4 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500/50 text-foreground/80 cursor-pointer"
                  >
                    <option value="Low">Low (Fast)</option>
                    <option value="Medium">Medium (Balanced)</option>
                    <option value="High">High (Cinematic)</option>
                  </select>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button 
                onClick={() => {
                  setIsSettingsDialogOpen(false);
                  saveDraft();
                  toast.success("Pengaturan berhasil disimpan!");
                }} 
                className="bg-blue-600 hover:bg-blue-700 text-white font-bold h-11 px-8 rounded-xl uppercase tracking-wider text-xs"
              >
                Simpan & Tutup
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Footer */}
        <footer className="border-t border-border/50 py-12 mt-20">
          <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-8">
            <div className="flex items-center gap-2 opacity-60">
              <Scissors className="w-4 h-4" />
              <span className="text-xs font-bold uppercase tracking-widest">PanelFlow AI v1.0</span>
            </div>
            <div className="flex gap-8 text-xs font-medium text-foreground/60">
              <a href="#" className="hover:text-foreground transition-colors">Privacy Policy</a>
              <a href="#" className="hover:text-foreground transition-colors">Terms of Service</a>
              <a href="#" className="hover:text-foreground transition-colors">Documentation</a>
            </div>
          </div>
        </footer>
      </div>
    </TooltipProvider>
  );
}
