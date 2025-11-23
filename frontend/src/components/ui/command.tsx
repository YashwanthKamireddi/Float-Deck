import * as React from "react";
import { type DialogProps } from "@radix-ui/react-dialog";
import { Command as CommandPrimitive } from "cmdk";
import { Search } from "lucide-react";

import { cn } from "@/lib/utils";
import { Dialog, DialogContent } from "@/components/ui/dialog";

const Command = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive>
>(({ className, ...props }, ref) => (
  <CommandPrimitive
    ref={ref}
    className={cn(
      "flex h-full w-full flex-col overflow-hidden rounded-[32px] border border-white/10 bg-slate-950/90 text-popover-foreground shadow-[0_30px_90px_-45px_rgba(14,165,233,0.4)] backdrop-blur-2xl",
      "[&::before]:pointer-events-none [&::before]:absolute [&::before]:inset-0 [&::before]:rounded-[32px] [&::before]:bg-[radial-gradient(circle_at_20%_20%,rgba(56,189,248,0.08),transparent_40%),radial-gradient(circle_at_80%_30%,rgba(129,140,248,0.08),transparent_42%)]",
      "dark:border-white/12",
      className,
    )}
    {...props}
  />
));
Command.displayName = CommandPrimitive.displayName;

interface CommandDialogProps extends DialogProps {}

const CommandDialog = ({ children, ...props }: CommandDialogProps) => {
  return (
    <Dialog {...props}>
      <DialogContent
        hideClose
        className={cn(
          "command-surface w-[620px] max-w-[95vw] overflow-hidden border-none bg-transparent p-0",
          "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-bottom-4 data-[state=open]:duration-300 data-[state=open]:ease-out",
          "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:slide-out-to-bottom-4 data-[state=closed]:duration-200 data-[state=closed]:ease-in",
        )}
      >
        <Command className="[&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground/70 [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-3 [&_[cmdk-group]]:px-1 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5">
          {children}
        </Command>
      </DialogContent>
    </Dialog>
  );
};

const CommandInput = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Input>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input>
>(({ className, ...props }, ref) => (
  <div
    className="mx-4 mt-4 flex min-h-[56px] items-center gap-3 rounded-2xl border border-white/10 bg-white/6 px-5 text-sm shadow-[0_8px_32px_-24px_rgba(15,23,42,0.35)] backdrop-blur-2xl transition-all duration-200 ease-out hover:border-white/14 focus-within:border-white/18 focus-within:shadow-[0_8px_28px_-22px_rgba(255,255,255,0.25)]"
    cmdk-input-wrapper=""
  >
    <Search className="h-5 w-5 shrink-0 text-slate-500 transition-colors duration-300 ease-out dark:text-slate-400" />
    <CommandPrimitive.Input
      ref={ref}
      className={cn(
        "flex h-10 w-full bg-transparent text-sm font-medium outline-none placeholder:text-muted-foreground/65 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  </div>
));

CommandInput.displayName = CommandPrimitive.Input.displayName;

const CommandList = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.List
    ref={ref}
    className={cn(
      "command-scroll max-h-[420px] space-y-2.5 overflow-y-auto overflow-x-hidden rounded-b-[32px] px-4 pb-6 pt-3",
      className,
    )}
    {...props}
  />
));

CommandList.displayName = CommandPrimitive.List.displayName;

const CommandEmpty = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Empty>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>((props, ref) => (
  <CommandPrimitive.Empty
    ref={ref}
    className="py-8 text-center text-sm font-medium text-muted-foreground/60"
    {...props}
  />
));

CommandEmpty.displayName = CommandPrimitive.Empty.displayName;

const CommandGroup = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Group>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Group>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Group
    ref={ref}
    className={cn(
      "group/section relative overflow-hidden rounded-2xl border border-white/12 bg-white/4 px-3.5 pb-3.5 pt-1 text-foreground shadow-[0_22px_55px_-45px_rgba(59,130,246,0.45)] backdrop-blur-xl transition-all duration-300 ease-out",
      "[&::after]:pointer-events-none [&::after]:absolute [&::after]:inset-0 [&::after]:rounded-2xl [&::after]:bg-gradient-to-br [&::after]:from-white/6 [&::after]:via-white/0 [&::after]:to-white/2",
      "[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-3 [&_[cmdk-group-heading]]:text-[0.65rem] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.32em] [&_[cmdk-group-heading]]:text-slate-300 [&_[cmdk-group-heading]]:transition-colors [&_[cmdk-group-heading]]:duration-200",
      className,
    )}
    {...props}
  />
));

CommandGroup.displayName = CommandPrimitive.Group.displayName;

const CommandSeparator = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Separator
    ref={ref}
    className={cn("my-3 h-px bg-gradient-to-r from-transparent via-slate-300/60 to-transparent dark:via-white/15", className)}
    {...props}
  />
));
CommandSeparator.displayName = CommandPrimitive.Separator.displayName;

const CommandItem = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Item
    ref={ref}
    className={cn(
      "group relative flex cursor-default select-none items-center gap-3 rounded-xl border border-transparent px-3.5 py-3 text-sm font-medium text-slate-200/90 outline-none transition-all duration-200 ease-out",
      "hover:border-white/10 hover:bg-white/5",
      "data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50",
      "data-[selected=true]:border-white/14 data-[selected=true]:bg-white/8 data-[selected=true]:text-slate-50 data-[selected=true]:shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_14px_32px_-22px_rgba(255,255,255,0.25)]",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25 focus-visible:ring-offset-0",
      className,
    )}
    {...props}
  />
));

CommandItem.displayName = CommandPrimitive.Item.displayName;

const CommandShortcut = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => {
  return (
    <span
      className={cn(
        "ml-auto rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-[0.6rem] font-semibold uppercase tracking-[0.32em] text-slate-100 shadow-sm backdrop-blur-md transition-all duration-200 ease-out",
        className,
      )}
      {...props}
    />
  );
};
CommandShortcut.displayName = "CommandShortcut";

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
};
