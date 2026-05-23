import { useEffect, useState } from "react";
import { FolderOpen, Plus, Import, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getAllProjects, deleteProjectFromDB } from "../services/storage";
import type { Project } from "../types";

export function ProjectDashboard({ 
  onOpenProject, 
  onNewProject, 
  onImportProject 
}: { 
  onOpenProject: (project: Project) => void;
  onNewProject: () => void;
  onImportProject: () => void;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    setLoading(true);
    try {
      const all = await getAllProjects();
      
      // Auto-cleanup: Delete empty "Untitled Project"s to prevent clutter
      const validProjects = [];
      for (const p of all) {
        if (p.name === 'Untitled Project' && p.chapters.length === 0 && p.titles.length === 0) {
          await deleteProjectFromDB(p.id);
        } else {
          validProjects.push(p);
        }
      }
      
      setProjects(validProjects.sort((a, b) => (b.chapters[0]?.createdAt || 0) - (a.chapters[0]?.createdAt || 0)));
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm("Are you sure you want to delete this project?")) {
      await deleteProjectFromDB(id);
      loadProjects();
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-12">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 mb-12">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-500 text-xs font-bold uppercase tracking-widest mb-4">
            <FolderOpen className="w-3.5 h-3.5" />
            Workspace
          </div>
          <h1 className="text-4xl md:text-5xl font-black mb-3 tracking-tight">
            Welcome to <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-500 to-emerald-400">PanelFlow</span>
          </h1>
          <p className="text-muted-foreground text-lg max-w-xl">
            Select a project to continue editing or create a new one to start transforming your manga panels into AI narrated videos.
          </p>
        </div>
        <div className="flex items-center gap-3 w-full md:w-auto">
          <Button variant="outline" size="lg" onClick={onImportProject} className="gap-2 flex-1 md:flex-none border-border/50 hover:bg-secondary/50 rounded-xl">
            <Import className="w-4 h-4" />
            Import
          </Button>
          <Button onClick={onNewProject} size="lg" className="gap-2 flex-1 md:flex-none bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-xl shadow-blue-500/20 hover:scale-105 transition-all">
            <Plus className="w-5 h-5" />
            New Project
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
        </div>
      ) : projects.length === 0 ? (
        <div className="text-center py-24 bg-secondary/20 rounded-3xl border border-dashed border-border">
          <div className="w-20 h-20 bg-secondary rounded-full flex items-center justify-center mx-auto mb-6">
            <FolderOpen className="w-10 h-10 text-muted-foreground" />
          </div>
          <h2 className="text-2xl font-bold mb-3">No Projects Yet</h2>
          <p className="text-muted-foreground max-w-md mx-auto mb-8">
            Create a new project to start transforming your manga panels into AI narrated videos.
          </p>
          <Button onClick={onNewProject} size="lg" className="gap-2">
            <Plus className="w-5 h-5" />
            Create Your First Project
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {projects.map((proj) => (
            <Card 
              key={proj.id} 
              className="group cursor-pointer hover:border-primary/50 hover:shadow-xl hover:shadow-primary/5 transition-all overflow-hidden bg-secondary/30 backdrop-blur-sm"
              onClick={() => onOpenProject(proj)}
            >
              <div className="h-40 bg-black/40 relative overflow-hidden border-b border-border/50">
                {proj.chapters[0]?.panels[0]?.imageUrl ? (
                  <img 
                    src={proj.chapters[0].panels[0].imageUrl} 
                    className="w-full h-full object-cover opacity-60 group-hover:opacity-100 group-hover:scale-105 transition-all duration-500"
                    alt="" 
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                    <FolderOpen className="w-10 h-10 opacity-20" />
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-background/80 to-transparent" />
                <Button 
                  variant="destructive" 
                  size="icon" 
                  className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity w-8 h-8"
                  onClick={(e) => handleDelete(e, proj.id)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
              <CardContent className="p-5">
                <h3 className="font-bold text-lg mb-1 truncate text-foreground group-hover:text-primary transition-colors">{proj.name}</h3>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{proj.chapters.length} Chapters</span>
                  <span>{proj.chapters.reduce((acc, c) => acc + c.panels.length, 0)} Panels</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
