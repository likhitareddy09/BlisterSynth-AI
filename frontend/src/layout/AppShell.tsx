import { Activity, BarChart3, BookOpen, Bot, Database, FlaskConical, History, LayoutDashboard, Menu, PanelLeftClose, PanelLeftOpen, Search, ShieldCheck, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { api } from "../api/client";
import type { Overview } from "../api/types";
import Logo from "../components/Logo";
import ThemeToggle from "../components/ThemeToggle";
import CommandPalette from "../components/CommandPalette";
import DemoPlayer from "../components/DemoPlayer";
import HelpMenu from "../components/HelpMenu";
import Tour from "../components/Tour";
import { Button, useToast } from "../components/ui";
import { useDemo } from "../hooks/useDemo";
import { useTheme } from "../hooks/useTheme";
import { appBus } from "../lib/bus";
import { resolveCommand, type Command } from "../lib/palette";
import { markTourDone, tourDone } from "../lib/tour";

export const NAV = [
  { to: "/app", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/app/live", label: "Live monitor", icon: Activity },
  { to: "/app/simulator", label: "Simulator", icon: FlaskConical },
  { to: "/app/copilot", label: "Scenario Copilot", icon: Bot },
  { to: "/app/runs", label: "Runs", icon: History },
  { to: "/app/generative", label: "Generative", icon: Sparkles },
  { to: "/app/pdm", label: "PdM & quality", icon: ShieldCheck },
  { to: "/app/quality", label: "Quality report", icon: BarChart3 },
  { to: "/app/data", label: "Data Lab", icon: Database },
  { to: "/app/about", label: "How it works", icon: BookOpen },
] as const;

/** "/app/live" -> "nav-live", "/app" -> "nav-overview": the data-tour attribute the product tour points at. */
export const tourId = (to: string) => `nav-${to.split("/").filter(Boolean).pop() === "app" ? "overview" : to.split("/").pop()}`;

/** What the pages get through react-router's <Outlet context>. */
export interface ShellContext { overview: Overview | null; offline: boolean; refresh: () => void; refreshKey: number }

export default function AppShell() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [offline, setOffline] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem("bs-sidebar") === "1"; } catch { return false; } });
  const [drawer, setDrawer] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const loc = useLocation();
  const nav = useNavigate();
  const { toggle: toggleTheme } = useTheme();
  const toast = useToast();
  const pathRef = useRef(loc.pathname);
  pathRef.current = loc.pathname;
  const demo = useDemo({ navigate: nav, isOnLive: () => pathRef.current.endsWith("/app/live") });

  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
    api.overview().then((o) => { setOverview(o); setOffline(false); }).catch(() => setOffline(true));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { setDrawer(false); }, [loc.pathname]);
  useEffect(() => { try { localStorage.setItem("bs-sidebar", collapsed ? "1" : "0"); } catch { /* ignore */ } }, [collapsed]);

  // Ctrl+K / Cmd+K opens the command palette from anywhere (also while typing in a field: it is a global shortcut)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setSearchOpen((o) => !o); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // First visit: show the tour once (remembered in localStorage). Not while the demo is playing.
  useEffect(() => {
    if (tourDone()) return;
    const t = setTimeout(() => setTourOpen(true), 900);
    return () => clearTimeout(t);
  }, []);
  const closeTour = useCallback((completed: boolean) => { setTourOpen(false); markTourDone(); if (completed) toast.push({ title: "You are all set", message: "Restart the tour any time from the ? menu.", tone: "success" }); }, [toast]);

  const startDemo = useCallback(() => {
    setTourOpen(false);
    if (overview && (overview.generative_models === 0 || overview.pdm_models === 0)) {
      toast.push({ title: "Heads-up for the last two steps", message: "Train a generator (Generative) and a PdM model (PdM) first, so the quality and PdM results have something to show.", tone: "warning" });
    }
    demo.start();
  }, [demo, overview, toast]);

  const runCommand = useCallback((cmd: Command) => {
    const fx = resolveCommand(cmd);
    if (!fx) return;
    switch (fx.kind) {
      case "navigate": nav(fx.to); break;
      case "live": nav(fx.to); appBus.publish({ type: "live", msg: fx.msg }); break;
      case "theme": toggleTheme(); break;
      case "demo": startDemo(); break;
      case "tour": setTourOpen(true); break;
    }
  }, [nav, toggleTheme, startDemo]);

  const ctx: ShellContext = { overview, offline, refresh, refreshKey };
  const pageTitle = (NAV.find((n) => n.to === loc.pathname) ?? NAV.find((n) => n.to !== "/app" && loc.pathname.startsWith(n.to)) ?? NAV[0]).label;

  return (
    <div className="min-h-screen">
      {drawer && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setDrawer(false)} aria-hidden />}
      <aside aria-label="Sidebar"
        className={`fixed inset-y-0 left-0 z-40 flex flex-col border-r border-line bg-surface p-3 transition-all duration-200 ${drawer ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0 ${collapsed ? "lg:w-[76px]" : "lg:w-64"} w-64`}>
        <Link to="/" className={`mb-6 mt-1 flex h-10 items-center px-2 ${collapsed ? "lg:justify-center" : ""}`} aria-label="BlisterSynth AI home">
          {collapsed ? <Logo className="[&>span]:hidden lg:[&>span]:hidden" /> : <Logo />}
        </Link>
        <nav className="flex flex-1 flex-col gap-1" aria-label="Main">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={"end" in n ? n.end : false} title={n.label} data-tour={tourId(n.to)} aria-label={collapsed ? n.label : undefined}
              className={({ isActive }) => `flex h-11 items-center gap-3 rounded-2xl px-3 text-sm font-medium transition ${collapsed ? "lg:justify-center lg:px-0" : ""} ${isActive ? "bg-primary text-on-primary shadow-sm" : "text-soft hover:bg-tint hover:text-ink"}`}>
              <n.icon className="h-5 w-5 shrink-0" aria-hidden />
              <span className={collapsed ? "lg:hidden" : ""}>{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <Link to="/" className={`rounded-2xl bg-pastel-green p-3 text-xs text-soft hover:brightness-95 ${collapsed ? "lg:hidden" : ""}`}>
          <strong className="block font-display text-sm text-ink">Back to home</strong>See the landing page
        </Link>
      </aside>

      <div className={`transition-all duration-200 ${collapsed ? "lg:pl-[76px]" : "lg:pl-64"}`}>
        <header className="sticky top-0 z-20 flex h-16 items-center gap-2 border-b border-line bg-bg/80 px-3 backdrop-blur sm:px-6">
          <Button variant="ghost" size="sm" className="!h-10 !px-2.5 lg:hidden" aria-label="Open menu" onClick={() => setDrawer(true)}><Menu className="h-5 w-5" /></Button>
          <Button variant="ghost" size="sm" className="hidden lg:inline-flex" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={() => setCollapsed((c) => !c)}>
            {collapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
          </Button>
          {/* phones: say where you are (the sidebar with the page names is hidden behind the menu button) */}
          <span className="flex min-w-0 items-center gap-2 lg:hidden">
            <Logo className="shrink-0 [&>span]:hidden" />
            <span className="truncate font-display text-base font-semibold">{pageTitle}</span>
          </span>
          <div className="counts ml-auto flex min-w-0 items-center lg:ml-0 lg:flex-1" aria-label="Backend status">
            <span className="inline-flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap rounded-full text-xs text-soft sm:gap-3 sm:border sm:border-line sm:bg-surface/70 sm:px-3 sm:py-1.5 sm:text-[13px]">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${offline ? "bg-rust" : overview ? "bg-ok" : "animate-pulse bg-warn"}`} role="img" aria-label={offline ? "Backend offline" : overview ? "Backend online" : "Connecting to backend"} />
              {offline ? <span className="warn font-medium text-rust">Backend offline</span> : overview && (
                <>
                  <span className="hidden sm:inline">{overview.runs.total} runs</span>
                  <span className="hidden text-line md:inline" aria-hidden>|</span>
                  <span className="hidden md:inline">{overview.generative_models} generators</span>
                  <span className="hidden text-line md:inline" aria-hidden>|</span>
                  <span className="hidden md:inline">{overview.pdm_models} PdM models</span>
                  {overview.active_jobs > 0 && <span className="warn font-medium text-warn">{overview.active_jobs} training</span>}
                  <span className="hidden font-mono text-[11px] lg:inline">v{overview.version}</span>
                </>
              )}
            </span>
          </div>
          <Button variant="secondary" size="sm" className="hidden sm:inline-flex" data-tour="search" onClick={() => setSearchOpen(true)} aria-label="Search" aria-keyshortcuts="Control+K Meta+K">
            <Search className="h-4 w-4" aria-hidden /><span className="hidden sm:inline">Search</span>
            <kbd className="ml-1 hidden rounded border border-line bg-tint px-1.5 text-[10px] text-soft md:inline">Ctrl K</kbd>
          </Button>
          <HelpMenu onTour={() => setTourOpen(true)} onDemo={startDemo} onPalette={() => setSearchOpen(true)} />
          <ThemeToggle />
        </header>
        <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
          <motion.div key={loc.pathname} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: "easeOut" }}>
            <Outlet context={ctx} />
          </motion.div>
        </main>
      </div>
      <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} pages={NAV.map((n) => ({ to: n.to, label: n.label }))} onRun={runCommand} />
      <Tour open={tourOpen} onClose={closeTour} />
      <DemoPlayer view={demo.view} onPause={demo.pause} onResume={demo.resume} onStop={demo.stop} onSkip={demo.skip} />
    </div>
  );
}
