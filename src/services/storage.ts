import { openDB, type IDBPDatabase } from 'idb';
import type { Project } from '../types';

const DB_NAME = 'panelflow_db';
const DB_VERSION = 1;
const PROJECT_KEY = 'current';

async function getDB(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('projects')) {
        db.createObjectStore('projects');
      }
    },
  });
}

export async function saveProjectToDB(project: Project): Promise<void> {
  const db = await getDB();
  await db.put('projects', project, project.id);
}

export async function loadProjectFromDB(id: string): Promise<Project | null> {
  const db = await getDB();
  return (await db.get('projects', id)) ?? null;
}

export async function getAllProjects(): Promise<Project[]> {
  const db = await getDB();
  return await db.getAll('projects');
}

export async function deleteProjectFromDB(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('projects', id);
}

export async function exportProjectAsZip(project: Project): Promise<void> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  const imagesFolder = zip.folder('images')!;

  // Collect unique base64 images → deduplicate with a Map
  const base64ToFilename = new Map<string, string>();
  let imgCounter = 0;

  const registerImage = (base64Url: string): string => {
    if (!base64Url?.startsWith('data:')) return base64Url;
    if (base64ToFilename.has(base64Url)) return base64ToFilename.get(base64Url)!;
    const filename = `img-${String(imgCounter++).padStart(4, '0')}.png`;
    const data = base64Url.split(',')[1];
    imagesFolder.file(filename, data, { base64: true });
    base64ToFilename.set(base64Url, filename);
    return filename;
  };

  const serializedChapters = project.chapters.map(chapter => ({
    ...chapter,
    pages: chapter.pages.map(registerImage),
    panels: chapter.panels.map(panel => ({
      ...panel,
      imageUrl: registerImage(panel.imageUrl),
      fullPageUrl: panel.fullPageUrl ? registerImage(panel.fullPageUrl) : undefined,
    })),
  }));

  zip.file(
    'project.json',
    JSON.stringify({ ...project, chapters: serializedChapters }, null, 2)
  );

  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${project.name.replace(/\s+/g, '_')}.panelflow`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function importProjectFromZip(file: File): Promise<Project> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(file);

  const projectJsonFile = zip.file('project.json');
  if (!projectJsonFile) throw new Error('File tidak valid: project.json tidak ditemukan');

  const projectData: Project = JSON.parse(await projectJsonFile.async('string'));

  // Restore image files back to base64 data URLs
  const filenameCache = new Map<string, string>();

  const restoreImage = async (ref: string): Promise<string> => {
    if (!ref || ref.startsWith('data:')) return ref;
    if (filenameCache.has(ref)) return filenameCache.get(ref)!;
    const imageFile = zip.file(`images/${ref}`);
    if (!imageFile) return ref;
    const base64 = await imageFile.async('base64');
    const dataUrl = `data:image/png;base64,${base64}`;
    filenameCache.set(ref, dataUrl);
    return dataUrl;
  };

  const restoredChapters = await Promise.all(
    projectData.chapters.map(async chapter => ({
      ...chapter,
      pages: await Promise.all(chapter.pages.map(restoreImage)),
      panels: await Promise.all(
        chapter.panels.map(async panel => ({
          ...panel,
          imageUrl: await restoreImage(panel.imageUrl),
          fullPageUrl: panel.fullPageUrl ? await restoreImage(panel.fullPageUrl) : undefined,
        }))
      ),
    }))
  );

  return { ...projectData, chapters: restoredChapters };
}
