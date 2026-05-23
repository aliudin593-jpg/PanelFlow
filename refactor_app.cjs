const fs = require('fs');

let content = fs.readFileSync('src/App.tsx', 'utf8');

// 1. Add new imports
const newImports = `import { Stepper } from "./components/ui/stepper";
import { TutorialPanel } from "./components/TutorialPanel";
import { ProjectDashboard } from "./components/ProjectDashboard";`;

content = content.replace("import { ManualPanelSelector } from './components/ManualPanelSelector';", `${newImports}\nimport { ManualPanelSelector } from './components/ManualPanelSelector';`);

content = content.replace("import { saveProjectToDB, loadProjectFromDB, exportProjectAsZip, importProjectFromZip } from './services/storage';", "import { saveProjectToDB, loadProjectFromDB, exportProjectAsZip, importProjectFromZip } from './services/storage';");

// 2. State changes
content = content.replace("const [activeTab, setActiveTab] = useState('upload');", "const [currentStep, setCurrentStep] = useState(1);");

content = content.replace(
  "id: 'default',",
  "id: generateId(),"
);

// We need to handle null project. Let's make project state allow null
content = content.replace(
  "const [project, setProject] = useState<Project>({",
  "const [project, setProject] = useState<Project | null>(null);\n  const [initialProjectLoad, setInitialProjectLoad] = useState(true);"
);

// Fix useEffect for initial load
const oldEffect = `  useEffect(() => {
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
  }, []);`;

const newEffect = `  useEffect(() => {
    // We do not load a specific project here anymore, user picks from Dashboard
    setInitialProjectLoad(false);
  }, []);`;
content = content.replace(oldEffect, newEffect);

// 3. Fix processChapter auto route
content = content.replace("setActiveTab('edit');", "setCurrentStep(2);");

// Fix auto save effect
content = content.replace(
  "saveProjectToDB(project).catch(console.error);",
  "if (project) saveProjectToDB(project).catch(console.error);"
);

// Add default project creator
const defaultProj = `
  const createNewProject = async () => {
    const newProj: Project = {
      id: generateId(),
      name: 'Untitled Project',
      categories: [
        { id: 'manga', name: 'Manga', titleIds: [] },
        { id: 'manhwa', name: 'Manhwa', titleIds: [] },
        { id: 'manhua', name: 'Manhua', titleIds: [] }
      ],
      titles: [],
      chapters: [],
      settings: {
        globalVoiceId: 'Kore',
        globalSpeed: 1.0,
        musicVolume: 0.5,
        language: 'English',
        exportResolution: '1080p',
        exportQuality: 'High',
        scriptLength: 'Normal',
      }
    };
    setProject(newProj);
    await saveProjectToDB(newProj);
  };
`;
content = content.replace("const [activeTab", `${defaultProj}\n  const [activeTab`); // Since I already replaced activeTab, let's inject before activeTab.
// Wait, I already replaced activeTab. Let's inject before currentStep:
content = content.replace("const [currentStep, setCurrentStep] = useState(1);", `${defaultProj}\n  const [currentStep, setCurrentStep] = useState(1);`);

// 4. Handle early return for Dashboard
const dashboardReturn = `
  if (initialProjectLoad) return null;
  if (!project) {
    return (
      <div className="min-h-screen bg-background text-foreground font-sans selection:bg-primary/30 transition-colors duration-300">
        <Toaster position="top-center" theme="dark" />
        <nav className="border-b border-border/50 bg-background/60 backdrop-blur-2xl sticky top-0 z-50 shadow-lg shadow-primary/10">
          <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <img src="/logo_light.png" className="w-10 h-10 object-contain dark:hidden" alt="PanelFlow Logo" />
              <img src="/logo_dark.png" className="w-10 h-10 object-contain hidden dark:block" alt="PanelFlow Logo" />
              <h1 className="font-black text-2xl tracking-tighter text-foreground">PanelFlow <span className="text-primary">AI</span></h1>
            </div>
            <ModeToggle />
          </div>
        </nav>
        <ProjectDashboard 
          onOpenProject={setProject} 
          onNewProject={createNewProject} 
          onImportProject={() => importInputRef.current?.click()} 
        />
        <input
            ref={importInputRef}
            type="file"
            accept=".panelflow"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) {
                 try {
                   const imported = await importProjectFromZip(file);
                   setProject(imported);
                   await saveProjectToDB(imported);
                 } catch (err: any) {
                   toast.error('Import failed: ' + err.message);
                 }
              }
              e.target.value = '';
            }}
          />
      </div>
    );
  }
`;

content = content.replace("return (", `${dashboardReturn}\n  return (`);

fs.writeFileSync('src/App.tsx', content);
console.log('App.tsx Dashboard injection complete');
