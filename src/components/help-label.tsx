import { useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// Use for supplemental definitions. Put errors and recovery instructions in visible text.
export function HelpLabel({ label, explanation }: { label: string; explanation: string }) {
  const [open, setOpen] = useState(false);
  return <Tooltip open={open} onOpenChange={setOpen} delayDuration={450}>
    <TooltipTrigger asChild>
      <button type="button" className="help-label" onClick={event => { event.preventDefault(); setOpen(true); }}>{label}</button>
    </TooltipTrigger>
    <TooltipContent side="top" collisionPadding={12}>{explanation}</TooltipContent>
  </Tooltip>;
}
