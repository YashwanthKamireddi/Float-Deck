import { ArrowRight, CheckCircle2, Map, MessagesSquare, Sparkles, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";

interface LandingPageProps {
  onLaunch: () => void;
}

const pillars = [
  {
    title: "Who it's for",
    body: "Scientists, policy teams, and operators who need fast, trustworthy ARGO answers without NetCDF wrangling.",
    icon: Sparkles,
  },
  {
    title: "What it does",
    body: "Converts plain English into audited SQL, live maps, and profile plots with provenance you can trace.",
    icon: Map,
  },
  {
    title: "Why it matters",
    body: "Rapid ocean awareness for climate, safety, and research missions—always brief-ready, never a black box.",
    icon: Zap,
  },
];

const steps = [
  "Ingest ARGO NetCDF + metadata into PostgreSQL and FAISS for semantic recall.",
  "Use MCP-driven RAG to turn intent into verifiable SQL and retrieve the right slices.",
  "Render maps, profiles, and time series with inline context so decisions are defensible.",
];

const LandingPage = ({ onLaunch }: LandingPageProps) => (
  <div className="min-h-screen bg-control-room text-slate-900 dark:text-slate-100">
    <div className="pointer-events-none absolute inset-0 ambient-veils opacity-60" />
    <div className="pointer-events-none absolute inset-0 grid-overlay opacity-20" />
    <div className="relative z-10 px-6 py-12 md:px-12 lg:px-16">
      <header className="max-w-6xl space-y-6">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.28em] text-slate-600 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/[0.08] dark:text-slate-200">
          FloatAI · ARGO Intelligence
        </div>
        <div className="grid gap-6 lg:grid-cols-[1.4fr,1fr] lg:items-center">
          <div className="space-y-5">
              <h1 className="text-3xl font-semibold leading-tight md:text-5xl">
                Conversational ocean intelligence for the ARGO fleet.
              </h1>
              <p className="text-lg text-subtle md:text-xl">
                Ask plain questions. Get vetted SQL, live maps, and profile plots—no NetCDF manuals required.
              </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button size="lg" onClick={onLaunch} className="rounded-full bg-gradient-ocean px-6 text-sm font-semibold shadow-lg shadow-sky-500/25">
                Launch command deck
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              <div className="text-sm text-subtle">Built for rapid ARGO/BGC situational awareness.</div>
            </div>
          </div>
          <div className="rounded-3xl border border-white/25 bg-white/75 p-5 shadow-[0_35px_70px_-50px_rgba(15,23,42,0.55)] backdrop-blur-2xl dark:border-white/10 dark:bg-white/[0.06]">
            <div className="flex items-center gap-3 text-sm text-subtle">
              <MessagesSquare className="h-4 w-4 text-sky-500" />
              <span>Example intents</span>
            </div>
            <ul className="mt-4 space-y-3 text-sm">
              <li className="rounded-xl border border-white/30 bg-white/80 px-3 py-2 shadow-sm dark:border-white/10 dark:bg-white/[0.05]">
                Show me salinity profiles near the equator in March 2023.
              </li>
              <li className="rounded-xl border border-white/30 bg-white/80 px-3 py-2 shadow-sm dark:border-white/10 dark:bg-white/[0.05]">
                Compare BGC parameters in the Arabian Sea for the last 6 months.
              </li>
              <li className="rounded-xl border border-white/30 bg-white/80 px-3 py-2 shadow-sm dark:border-white/10 dark:bg-white/[0.05]">
                What are the nearest ARGO floats to this location?
              </li>
            </ul>
          </div>
        </div>
      </header>

      <section className="mt-12 grid gap-4 lg:grid-cols-3">
        {pillars.map((pillar) => (
          <div
            key={pillar.title}
            className="flex flex-col gap-3 rounded-2xl border border-white/25 bg-white/80 p-5 shadow-[0_25px_60px_-45px_rgba(15,23,42,0.55)] backdrop-blur-2xl dark:border-white/10 dark:bg-white/[0.06]"
          >
            <pillar.icon className="h-5 w-5 text-sky-500" />
            <h3 className="text-lg font-semibold">{pillar.title}</h3>
            <p className="text-sm text-subtle">{pillar.body}</p>
          </div>
        ))}
      </section>

      <section className="mt-12 grid gap-6 lg:grid-cols-[1.1fr,1fr]">
        <div className="rounded-3xl border border-white/25 bg-white/85 p-6 shadow-[0_30px_70px_-50px_rgba(15,23,42,0.55)] backdrop-blur-2xl dark:border-white/10 dark:bg-white/[0.06]">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500 dark:text-slate-300">Pipeline</p>
          <h3 className="mt-2 text-xl font-semibold">How FloatAI answers a mission prompt</h3>
          <div className="mt-4 space-y-3">
            {steps.map((step) => (
              <div key={step} className="flex items-start gap-3 rounded-xl border border-white/25 bg-white/80 px-3 py-2 shadow-sm dark:border-white/10 dark:bg-white/[0.05]">
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-500" />
                <p className="text-sm text-slate-700 dark:text-slate-100">{step}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-3xl border border-white/25 bg-white/85 p-6 shadow-[0_30px_70px_-50px_rgba(15,23,42,0.55)] backdrop-blur-2xl dark:border-white/10 dark:bg-white/[0.06]">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500 dark:text-slate-300">At a glance</p>
          <div className="mt-4 grid gap-3 text-sm">
            <div className="flex items-center justify-between rounded-xl border border-white/30 bg-white/75 px-3 py-2 dark:border-white/10 dark:bg-white/[0.05]">
              <span className="text-subtle">Data coverage</span>
              <span className="font-semibold text-slate-900 dark:text-white">Global ARGO + BGC floats</span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-white/30 bg-white/75 px-3 py-2 dark:border-white/10 dark:bg-white/[0.05]">
              <span className="text-subtle">Modalities</span>
              <span className="font-semibold text-slate-900 dark:text-white">Maps · Profiles · Time series · SQL</span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-white/30 bg-white/75 px-3 py-2 dark:border-white/10 dark:bg-white/[0.05]">
              <span className="text-subtle">Guardrails</span>
              <span className="font-semibold text-slate-900 dark:text-white">Provenance-linked SQL + fallbacks</span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-white/30 bg-white/75 px-3 py-2 dark:border-white/10 dark:bg-white/[0.05]">
              <span className="text-subtle">Interfaces</span>
              <span className="font-semibold text-slate-900 dark:text-white">Chat · Command palette · Filters</span>
            </div>
          </div>
        </div>
      </section>

      <section className="mt-12 grid gap-4 rounded-3xl border border-white/25 bg-white/85 p-6 shadow-[0_30px_70px_-50px_rgba(15,23,42,0.55)] backdrop-blur-2xl dark:border-white/10 dark:bg-white/[0.06] lg:grid-cols-2">
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500 dark:text-slate-300">Why now</p>
          <h3 className="text-xl font-semibold">Turn NetCDF into briefing-ready insights</h3>
          <p className="text-sm text-subtle">
            Skip toolchains and wrangling. FloatAI pairs ARGO + BGC telemetry with RAG so teams can move from raw profiles to maps,
            trends, and SQL receipts in one flow.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={onLaunch} className="rounded-full bg-gradient-ocean px-5 text-sm font-semibold shadow-lg shadow-sky-500/25">
              Launch now
            </Button>
          </div>
        </div>
        <div className="grid gap-3 text-sm">
          <div className="rounded-2xl border border-white/25 bg-white/80 px-4 py-3 shadow-sm dark:border-white/10 dark:bg-white/[0.05]">
            <p className="text-[0.7rem] uppercase tracking-[0.26em] text-slate-500 dark:text-slate-300">Recent wins</p>
            <p className="mt-1 font-semibold text-slate-800 dark:text-slate-100">Detected salinity anomalies in Arabian Sea last 6 months.</p>
          </div>
          <div className="rounded-2xl border border-white/25 bg-white/80 px-4 py-3 shadow-sm dark:border-white/10 dark:bg-white/[0.05]">
            <p className="text-[0.7rem] uppercase tracking-[0.26em] text-slate-500 dark:text-slate-300">Speed</p>
            <p className="mt-1 font-semibold text-slate-800 dark:text-slate-100">Ask → SQL → charts in seconds, with provenance attached.</p>
          </div>
          <div className="rounded-2xl border border-white/25 bg-white/80 px-4 py-3 shadow-sm dark:border-white/10 dark:bg-white/[0.05]">
            <p className="text-[0.7rem] uppercase tracking-[0.26em] text-slate-500 dark:text-slate-300">Trust</p>
            <p className="mt-1 font-semibold text-slate-800 dark:text-slate-100">Every answer links to auditable SQL and backend routes.</p>
          </div>
        </div>
      </section>

      <section className="mt-12 rounded-3xl border border-white/25 bg-white/85 p-6 shadow-[0_30px_70px_-50px_rgba(15,23,42,0.55)] backdrop-blur-2xl dark:border-white/10 dark:bg-white/[0.06]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500 dark:text-slate-300">Ready to explore</p>
            <h3 className="text-xl font-semibold">Launch the command deck and start asking questions.</h3>
          </div>
          <Button size="lg" onClick={onLaunch} className="rounded-full bg-gradient-ocean px-6 text-sm font-semibold shadow-lg shadow-sky-500/25">
            Open dashboard
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </section>
    </div>
  </div>
);

export default LandingPage;
