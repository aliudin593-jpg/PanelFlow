import { Info, Lightbulb, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function TutorialPanel({ step }: { step: number }) {
  let title = "";
  let content = null;

  switch (step) {
    case 1:
      title = "Step 1: Upload & Snap";
      content = (
        <div className="space-y-4 text-sm text-muted-foreground">
          <p>Welcome! Let's start by adding your comic pages.</p>
          <ul className="list-disc pl-4 space-y-2">
            <li><strong>Drag & Drop</strong> any image or PDF into the dotted area.</li>
            <li>Click <strong>Auto Snap</strong> to let AI automatically detect and crop comic panels.</li>
            <li>Use <strong>Manual Snap</strong> if the AI misses something or if you want custom framing.</li>
            <li>You can drag and drop panels on the right side to reorder them!</li>
          </ul>
          <div className="p-3 bg-blue-500/10 rounded-lg border border-blue-500/20 text-blue-500 mt-4 flex items-start gap-3">
            <Lightbulb className="w-5 h-5 flex-shrink-0" />
            <p className="text-xs font-medium">Pro Tip: Make sure your pages are high resolution for the best Auto Snap results.</p>
          </div>
        </div>
      );
      break;
    case 2:
      title = "Step 2: Script & Narration";
      content = (
        <div className="space-y-4 text-sm text-muted-foreground">
          <p>Now, let's bring your panels to life with AI narration.</p>
          <ul className="list-disc pl-4 space-y-2">
            <li>Select one or more panels by clicking them.</li>
            <li>Click <strong>Generate Selected Scripts</strong>. Gemini AI will analyze the images and write dialogue!</li>
            <li>You can manually edit the <em>Script</em> (what the AI reads) and the <em>Dialogue</em> (what is shown on screen).</li>
            <li>Assign different voices to different panels using the Voice Dropdown.</li>
          </ul>
          <div className="p-3 bg-purple-500/10 rounded-lg border border-purple-500/20 text-purple-500 mt-4 flex items-start gap-3">
            <Sparkles className="w-5 h-5 flex-shrink-0" />
            <p className="text-xs font-medium">The AI analyzes the visual context! If a character looks angry, the script will reflect that emotion.</p>
          </div>
        </div>
      );
      break;
    case 3:
      title = "Step 3: Preview & Export";
      content = (
        <div className="space-y-4 text-sm text-muted-foreground">
          <p>You're almost done! Time to review and export.</p>
          <ul className="list-disc pl-4 space-y-2">
            <li>Click the large <strong>Play</strong> button to preview your comic as a video flow.</li>
            <li>Use the <strong>Settings</strong> to adjust global voice speed or music volume.</li>
            <li>When ready, click <strong>Export Project</strong> to download it as a `.panelflow` file.</li>
            <li>Need captions for TikTok/Reels? Click <strong>Generate Social Metadata</strong>!</li>
          </ul>
        </div>
      );
      break;
  }

  return (
    <Card className="w-full h-full bg-secondary/30 backdrop-blur border-border/50 shadow-xl overflow-hidden flex flex-col">
      <CardHeader className="border-b border-border/50 bg-secondary/50 py-4">
        <CardTitle className="text-lg flex items-center gap-2">
          <Info className="w-5 h-5 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-6 flex-1 overflow-y-auto custom-scrollbar-visible">
        {content}
      </CardContent>
    </Card>
  );
}
