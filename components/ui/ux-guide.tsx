import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { HelpCircle, Upload, Edit3, Download, PlayCircle } from "lucide-react"

export function UxGuide() {
  return (
    <Dialog>
      <DialogTrigger 
        render={
          <Button variant="ghost" size="icon" className="w-9 h-9 rounded-full bg-background/50 backdrop-blur-sm border border-border/50">
            <HelpCircle className="w-4 h-4 text-muted-foreground" />
          </Button>
        }
      />
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold flex items-center gap-2">
            <span className="text-primary">PanelFlow</span> UX Guide
          </DialogTitle>
          <DialogDescription>
            Welcome to PanelFlow! Master the AI manga workflow in 3 simple steps.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-4">
          <div className="flex flex-col gap-3 p-4 rounded-xl bg-secondary/50 border border-border">
            <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center">
              <Upload className="w-5 h-5 text-blue-500" />
            </div>
            <h3 className="font-semibold text-lg">1. Upload & Snap</h3>
            <p className="text-sm text-muted-foreground">
              Drop your Manga pages (Images or PDFs) into the Upload tab. Use <strong>Auto Snap</strong> to let AI detect panels, or <strong>Manual Snap</strong> to draw them yourself.
            </p>
          </div>

          <div className="flex flex-col gap-3 p-4 rounded-xl bg-secondary/50 border border-border">
            <div className="w-10 h-10 rounded-full bg-purple-500/10 flex items-center justify-center">
              <Edit3 className="w-5 h-5 text-purple-500" />
            </div>
            <h3 className="font-semibold text-lg">2. Edit & Script</h3>
            <p className="text-sm text-muted-foreground">
              Switch to the Edit tab. Select multiple panels and click <strong>Auto Script</strong> to let Gemini AI analyze the images and generate immersive narration and dialogue.
            </p>
          </div>

          <div className="flex flex-col gap-3 p-4 rounded-xl bg-secondary/50 border border-border">
            <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center">
              <Download className="w-5 h-5 text-green-500" />
            </div>
            <h3 className="font-semibold text-lg">3. Preview & Export</h3>
            <p className="text-sm text-muted-foreground">
              Hit <PlayCircle className="w-4 h-4 inline" /> to preview the AI-voiced video. Once satisfied, head to Export to download the project as a `.panelflow` file or generate Social Media metadata.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
