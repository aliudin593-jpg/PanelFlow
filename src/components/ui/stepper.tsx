import { Check, Upload, Edit3, Type, Play } from "lucide-react";
import { cn } from "@/lib/utils";

export type StepItem = {
  id: number;
  title: string;
  description: string;
  icon: React.ReactNode;
};

export const STEPS: StepItem[] = [
  { id: 1, title: "Upload", description: "Snap Panels", icon: <Upload className="w-5 h-5" /> },
  { id: 2, title: "Script", description: "Generate Dialogue", icon: <Type className="w-5 h-5" /> },
  { id: 3, title: "Export", description: "Preview & Save", icon: <Play className="w-5 h-5" /> },
];

export function Stepper({ currentStep, onStepChange }: { currentStep: number; onStepChange: (step: number) => void }) {
  return (
    <div className="w-full py-6 flex items-center justify-center">
      <div className="flex items-center w-full max-w-4xl relative">
        <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-border/50 -z-10 -translate-y-1/2" />
        <div 
          className="absolute top-1/2 left-0 h-0.5 bg-primary -z-10 -translate-y-1/2 transition-all duration-500 ease-in-out" 
          style={{ width: `${((currentStep - 1) / (STEPS.length - 1)) * 100}%` }} 
        />

        {STEPS.map((step) => {
          const isActive = step.id === currentStep;
          const isPast = step.id < currentStep;

          return (
            <div key={step.id} className="relative flex-1 flex flex-col items-center group cursor-pointer" onClick={() => onStepChange(step.id)}>
              <div 
                className={cn(
                  "w-12 h-12 rounded-full flex items-center justify-center shadow-lg transition-all duration-300 border-2",
                  isActive ? "bg-primary text-primary-foreground border-primary scale-110 shadow-primary/20" : 
                  isPast ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground border-border group-hover:border-primary/50"
                )}
              >
                {isPast ? <Check className="w-5 h-5" /> : step.icon}
              </div>
              <div className="mt-3 text-center">
                <div className={cn("text-sm font-bold transition-colors", isActive || isPast ? "text-foreground" : "text-muted-foreground")}>
                  {step.title}
                </div>
                <div className="text-xs text-muted-foreground hidden sm:block mt-1">
                  {step.description}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
