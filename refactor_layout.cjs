const fs = require('fs');

let content = fs.readFileSync('src/App.tsx', 'utf8');

// 1. Inject Dashboard early return
const dashboardReturn = `
  if (initialProjectLoad) return null;
  if (!project) {
    return (
      <div className="min-h-screen bg-background text-foreground font-sans selection:bg-primary/30 transition-colors duration-300">
        <Toaster position="top-center" theme="dark" />
        <nav className="border-b border-border/50 bg-background/60 backdrop-blur-2xl sticky top-0 z-50 shadow-lg shadow-primary/10">
          <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center shadow-2xl shadow-blue-500/40 transform transition-transform hover:rotate-12">
                <img src="/logo_light.png" className="w-8 h-8 object-contain dark:hidden" alt="PanelFlow Logo" />
                <img src="/logo_dark.png" className="w-8 h-8 object-contain hidden dark:block" alt="PanelFlow Logo" />
              </div>
              <div>
                <h1 className="font-black text-2xl tracking-tighter text-foreground">PanelFlow <span className="text-primary">AI</span></h1>
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-mono font-bold uppercase tracking-[0.3em] text-blue-400/60">Project Dashboard</span>
                </div>
              </div>
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
                   const { importProjectFromZip, saveProjectToDB } = await import('./services/storage');
                   const imported = await importProjectFromZip(file);
                   setProject(imported);
                   await saveProjectToDB(imported);
                 } catch (err) {}
              }
              e.target.value = '';
            }}
          />
      </div>
    );
  }
`;

content = content.replace("  return (\n    <TooltipProvider>", `${dashboardReturn}\n  return (\n    <TooltipProvider>`);

// 2. Replace Tabs logic
content = content.replace(/<Tabs value=\{activeTab\} onValueChange=\{setActiveTab\}.*?>/, `<div className="space-y-8 flex flex-col lg:flex-row gap-6">
<div className="flex-1 w-full min-w-0">
  <Stepper currentStep={currentStep} onStepChange={setCurrentStep} />`);

// Replace all setActiveTab calls with setCurrentStep
content = content.replace(/setActiveTab\('library'\)/g, "setCurrentStep(1)");
content = content.replace(/setActiveTab\('edit'\)/g, "setCurrentStep(2)");
content = content.replace(/setActiveTab\('exposure'\)/g, "setCurrentStep(3)");
content = content.replace(/activeTab === 'library'/g, "currentStep === 1");
content = content.replace(/activeTab === 'edit'/g, "currentStep === 2");
content = content.replace(/activeTab === 'exposure'/g, "currentStep === 3");

// Replace activeTab variable if still remaining in tabs content
content = content.replace(/activeTab/g, "currentStep");

// Remove TabsList and TabsTrigger block completely
content = content.replace(/<TabsList[\s\S]*?<\/TabsList>/, "");

// Convert TabsContent to div conditionals
content = content.replace(/<TabsContent value="library".*?>/, "{currentStep === 1 && (<div className=\"animate-in fade-in slide-in-from-bottom-4 duration-500\">");
content = content.replace(/<TabsContent value="edit".*?>/, "{currentStep === 2 && (<div className=\"animate-in fade-in slide-in-from-bottom-4 duration-500\">");
content = content.replace(/<TabsContent value="exposure".*?>/, "{currentStep === 3 && (<div className=\"animate-in fade-in slide-in-from-bottom-4 duration-500\">");
content = content.replace(/<\/TabsContent>/g, "</div>)}");

// Close the flex div and add TutorialPanel
content = content.replace(/<\/Tabs>/g, `</div>
  <div className="w-full lg:w-[350px] flex-shrink-0">
    <div className="sticky top-[100px] h-[calc(100vh-140px)]">
      <TutorialPanel step={currentStep} />
    </div>
  </div>
</div>`);

fs.writeFileSync('src/App.tsx', content);
