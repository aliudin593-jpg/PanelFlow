const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

// Header imports
content = content.replace(
  "import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';",
  "import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';\nimport { ModeToggle } from '@/components/mode-toggle';\nimport { UxGuide } from '@/components/ui/ux-guide';"
);

// Replace hardcoded wrapper background
content = content.replace(
  'className="min-h-screen bg-gradient-to-br from-[#0B1021] via-[#1B143F] to-[#0B1B2E] text-white font-sans selection:bg-blue-500/30"',
  'className="min-h-screen bg-background text-foreground font-sans selection:bg-primary/30 transition-colors duration-300"'
);

// Replace Navbar
content = content.replace(
  'bg-[#0B1021]/60 backdrop-blur-2xl sticky top-0 z-50 shadow-lg shadow-purple-900/10',
  'bg-background/60 backdrop-blur-2xl sticky top-0 z-50 shadow-lg shadow-primary/10 border-b border-border/50'
);

// Add logo, mode toggle and UX guide to Navbar
content = content.replace(
  '<Sparkles className="text-white w-7 h-7" />',
  '<img src="/logo.png" className="w-8 h-8 object-contain" alt="PanelFlow Logo" />'
);
content = content.replace(
  '<h1 className="font-black text-2xl tracking-tighter text-white">PanelFlow <span className="text-blue-500">AI</span></h1>',
  '<h1 className="font-black text-2xl tracking-tighter text-foreground">PanelFlow <span className="text-primary">AI</span></h1>'
);
content = content.replace(
  '<div className="flex items-center gap-2">\n                  <Button variant="ghost" onClick={handleExportProject}',
  '<div className="flex items-center gap-2">\n                  <UxGuide />\n                  <ModeToggle />\n                  <Button variant="ghost" onClick={handleExportProject}'
);

// Generic replacements for theming
content = content.replace(/text-white\/20/g, 'text-foreground/20');
content = content.replace(/text-white\/40/g, 'text-foreground/40');
content = content.replace(/text-white\/60/g, 'text-foreground/60');
content = content.replace(/text-white\/80/g, 'text-foreground/80');
content = content.replace(/text-white/g, 'text-foreground');

content = content.replace(/bg-white\/\\[0\.02\\]/g, 'bg-foreground/5');
content = content.replace(/bg-white\/\\[0\.03\\]/g, 'bg-foreground/5');
content = content.replace(/bg-white\/\\[0\.04\\]/g, 'bg-foreground/10');
content = content.replace(/bg-white\/5/g, 'bg-foreground/5');
content = content.replace(/bg-white\/10/g, 'bg-foreground/10');
content = content.replace(/bg-white\/20/g, 'bg-foreground/20');

content = content.replace(/border-white\/5/g, 'border-border/50');
content = content.replace(/border-white\/10/g, 'border-border');
content = content.replace(/border-white\/20/g, 'border-border');
content = content.replace(/border-white\/50/g, 'border-border');

content = content.replace(/bg-black\/20/g, 'bg-background/20');
content = content.replace(/bg-black\/40/g, 'bg-background/40');
content = content.replace(/bg-black\/60/g, 'bg-background/60');
content = content.replace(/bg-black\/80/g, 'bg-background/80');
content = content.replace(/bg-black/g, 'bg-background');

content = content.replace(/bg-\[\#0B1021\]/g, 'bg-background');
content = content.replace(/bg-\[\#1B143F\]/g, 'bg-background');
content = content.replace(/bg-\[\#020617\]/g, 'bg-background');

fs.writeFileSync('src/App.tsx', content);
console.log('Replacements done.');
