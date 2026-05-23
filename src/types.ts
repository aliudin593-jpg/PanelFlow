
export interface Panel {
  id: string;
  imageUrl: string;
  fullPageUrl?: string; // We can keep this if we added it, but maybe we failed
  originalImageId: string;
  rect: { x: number; y: number; width: number; height: number };
  context?: string; // Context/Lore for characters, actions, or weapons in this panel
  script: string;
  dialogue?: string; // Captured text from the full page
  duration: number; // in seconds
  voiceId: string;
  transition?: 'none' | 'fade' | 'slide' | 'zoom';
  backgroundElements?: string[]; // URLs or IDs
  order: number;
  scriptLength?: 'Short' | 'Normal' | 'Detailed';
}

export type CategoryType = 'Manga' | 'Manhwa' | 'Manhua';

export interface Title {
  id: string;
  name: string;
  categoryId: string;
  coverUrl?: string;
  createdAt: number;
}

export interface Category {
  id: string;
  name: CategoryType;
  titleIds: string[];
}

export interface SocialMetadata {
  titleHook: string;
  description: string;
  hashtags: string;
}

export interface ComicChapter {
  id: string;
  name: string;
  titleId: string;
  pages: string[]; // Base64 or Blob URLs
  panels: Panel[];
  createdAt: number;
  socialMetadata?: SocialMetadata;
}

export interface Project {
  id: string;
  name: string;
  categories: Category[];
  titles: Title[];
  chapters: ComicChapter[];
  currentChapterId?: string;
  settings: {
    globalVoiceId: string;
    globalSpeed: number;
    musicUrl?: string;
    musicVolume: number;
    language: string;
    exportResolution: '720p' | '1080p' | '4K';
    exportQuality: 'Low' | 'Medium' | 'High';
    scriptLength?: 'Short' | 'Normal' | 'Detailed';
    videoFormat?: 'landscape' | 'vertical';
  };
}
