import type { ComponentType } from "react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import {
  Sparkles,
  Zap,
  Layers,
  Map,
  LineChart,
  Code2,
  Filter,
  Eraser,
  Thermometer,
  Droplets,
  Activity,
  Anchor,
  Compass,
} from "lucide-react";

type PersonaMode = "guided" | "expert";

type FocusMetric = "temperature" | "salinity" | "pressure" | "oxygen" | "density";

interface PaletteFilters {
  focusMetric: FocusMetric;
  floatId?: string;
  depthRange?: [number | null, number | null];
}

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: PersonaMode;
  onAction: (action: string, payload?: string) => void;
  recentQueries: string[];
  filters: PaletteFilters;
  activeTab: string;
  quickQueries: Array<{ label: string; prompt: string }>;
}

const focusMetricOptions: Array<{ value: FocusMetric; label: string; icon: ComponentType<any> }> = [
  { value: "temperature", label: "Temperature focus", icon: Thermometer },
  { value: "salinity", label: "Salinity focus", icon: Droplets },
  { value: "pressure", label: "Pressure profile", icon: Activity },
  { value: "oxygen", label: "Dissolved oxygen", icon: Anchor },
  { value: "density", label: "Water density", icon: Zap },
];

const viewOptions = [
  { value: "analysis", label: "Open analysis table", icon: Layers, action: "open-analysis" },
  { value: "map", label: "Show ocean map", icon: Map, action: "open-map" },
  { value: "profiles", label: "Inspect profiles", icon: LineChart, action: "open-profiles" },
  { value: "sql", label: "Reveal SQL query", icon: Code2, action: "open-sql" },
];

const CommandPalette = ({
  open,
  onOpenChange,
  mode,
  onAction,
  recentQueries,
  filters,
  activeTab,
  quickQueries,
}: CommandPaletteProps) => {
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      className="bg-slate-950/85 text-slate-50 shadow-[0_25px_80px_-30px_rgba(8,47,73,0.65)] backdrop-blur-xl border border-white/10"
    >
      <div className="pointer-events-none absolute inset-0 rounded-[32px] bg-[radial-gradient(circle_at_20%_20%,rgba(56,189,248,0.08),transparent_45%),radial-gradient(circle_at_80%_30%,rgba(129,140,248,0.08),transparent_42%)]" />
      <CommandInput
        placeholder="Type a command or search for an action…"
        className="mt-1 mb-2 bg-transparent text-base placeholder:text-slate-400 px-1"
      />
      <CommandList className="relative mt-3 space-y-3 rounded-2xl bg-white/3 p-3">
        <CommandEmpty className="py-4 text-sm text-slate-400">No commands found.</CommandEmpty>

        <CommandGroup heading="Persona mode" className="rounded-2xl border border-white/5 bg-white/5 px-3 py-2">
          <CommandItem
            onSelect={() => onAction("switch-guided")}
            className="group rounded-xl border border-transparent bg-gradient-to-r from-sky-900/40 to-slate-900/60 text-sm transition hover:border-sky-500/40 hover:from-sky-900/60 hover:to-slate-900/70"
          >
            <Sparkles className="mr-2 h-4 w-4 text-sky-200" />
            <span className="flex-1">Switch to Guided Mode</span>
            {mode === "guided" && (
              <span className="rounded-full bg-white/10 px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.25em] text-sky-100">
                Active
              </span>
            )}
          </CommandItem>
          <CommandItem
            onSelect={() => onAction("switch-expert")}
            className="group rounded-xl border border-transparent bg-slate-900/60 text-sm transition hover:border-sky-500/30 hover:bg-slate-900/80"
          >
            <Zap className="mr-2 h-4 w-4 text-amber-200" />
            <span className="flex-1">Switch to Expert Mode</span>
            {mode === "expert" && (
              <span className="rounded-full bg-amber-400/10 px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.25em] text-amber-100">
                Active
              </span>
            )}
          </CommandItem>
        </CommandGroup>

        <CommandGroup heading="Views" className="rounded-2xl border border-white/5 bg-white/5 px-3 py-2">
          {viewOptions.map(({ value, label, icon: Icon, action }) => (
            <CommandItem
              key={value}
              onSelect={() => onAction(action)}
              className="group rounded-xl text-sm transition hover:bg-white/5"
            >
              <Icon className="mr-2 h-4 w-4 text-sky-200" />
              <span className="flex-1">{label}</span>
              {activeTab === value && (
                <Badge className="ml-auto rounded-full bg-sky-500/15 px-3 py-0 text-[0.65rem] font-semibold uppercase tracking-[0.25em] text-sky-100">
                  Current
                </Badge>
              )}
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandGroup heading="Focus metric" className="rounded-2xl border border-white/5 bg-white/5 px-3 py-2">
          {focusMetricOptions.map(({ value, label, icon: Icon }) => (
            <CommandItem
              key={value}
              onSelect={() => onAction(`focus-${value}`, value)}
              className="group rounded-xl text-sm transition hover:bg-white/5"
            >
              <Icon className="mr-2 h-4 w-4 text-sky-200" />
              <span className="flex-1">{label}</span>
              {filters.focusMetric === value && (
                <CommandShortcut className="rounded-full bg-white/10 px-2 py-0.5 text-[0.65rem] uppercase tracking-[0.2em] text-sky-100">
                  Selected
                </CommandShortcut>
              )}
            </CommandItem>
          ))}
          <CommandItem
            onSelect={() => onAction("clear-filters")}
            className="group rounded-xl text-sm text-rose-100 transition hover:bg-rose-500/10"
          >
            <Eraser className="mr-2 h-4 w-4 text-rose-200" />
            <span>Clear filters</span>
          </CommandItem>
        </CommandGroup>

        {quickQueries.length > 0 && (
          <CommandGroup heading="Quick actions" className="rounded-2xl border border-white/5 bg-white/5 px-3 py-2">
            {quickQueries.map(({ label, prompt }) => (
              <CommandItem
                key={`${label}-${prompt}`}
                onSelect={() => onAction("prefill-query", prompt)}
                className="group rounded-xl text-sm transition hover:bg-white/5"
              >
                <Compass className="mr-2 h-4 w-4 text-emerald-200" />
                <span className="truncate">{label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {recentQueries.length > 0 && (
          <CommandGroup heading="Recent queries" className="rounded-2xl border border-white/5 bg-white/5 px-3 py-2">
            {recentQueries.map((query) => (
              <CommandItem
                key={query}
                onSelect={() => onAction("prefill-query", query)}
                className="group rounded-xl text-sm transition hover:bg-white/5"
              >
                <Filter className="mr-2 h-4 w-4 text-indigo-200" />
                <span className="truncate">{query}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
};

export default CommandPalette;
