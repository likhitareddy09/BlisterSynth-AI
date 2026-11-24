import { useEffect } from "react";
import { HashRouter, Navigate, Route, Routes, useOutletContext } from "react-router-dom";
import { ToastProvider } from "./components/ui";
import { ThemeProvider } from "./hooks/useTheme";
import { installFoilTracking } from "./lib/foil";
import AppShell, { type ShellContext } from "./layout/AppShell";
import About from "./pages/About";
import Copilot from "./pages/Copilot";
import Generative from "./pages/Generative";
import Landing from "./pages/Landing";
import LiveMonitor from "./pages/LiveMonitor";
import Overview from "./pages/Overview";
import DataLab from "./pages/DataLab";
import Pdm from "./pages/Pdm";
import Quality from "./pages/Quality";
import Runs from "./pages/Runs";
import Simulator from "./pages/Simulator";

// The pages keep their original props; these small wrappers hand them the values from the shell.
const SimulatorRoute = () => { const c = useOutletContext<ShellContext>(); return <Simulator onRunCreated={c.refresh} />; };
const RunsRoute = () => { const c = useOutletContext<ShellContext>(); return <Runs refreshKey={c.refreshKey} />; };
const CopilotRoute = () => { const c = useOutletContext<ShellContext>(); return <Copilot onRunCreated={c.refresh} />; };
const GenerativeRoute = () => { const c = useOutletContext<ShellContext>(); return <Generative onChanged={c.refresh} />; };
const QualityRoute = () => { const c = useOutletContext<ShellContext>(); return <Quality refreshKey={c.refreshKey} />; };
const DataLabRoute = () => { const c = useOutletContext<ShellContext>(); return <DataLab refreshKey={c.refreshKey} onChanged={c.refresh} />; };
const PdmRoute = () => { const c = useOutletContext<ShellContext>(); return <Pdm refreshKey={c.refreshKey} onChanged={c.refresh} />; };

/**
 * HashRouter on purpose: URLs look like /#/app/live, which works with the Vite dev server AND when the
 * FastAPI backend serves the build under /app/ (no server-side route rewriting needed).
 */
export default function App() {
  useEffect(() => installFoilTracking(), []);       // the faint foil shine on cards follows the mouse (lib/foil.ts)
  return (
    <ThemeProvider>
      <ToastProvider>
        <HashRouter>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/app" element={<AppShell />}>
              <Route index element={<Overview />} />
              <Route path="live" element={<LiveMonitor />} />
              <Route path="simulator" element={<SimulatorRoute />} />
              <Route path="copilot" element={<CopilotRoute />} />
              <Route path="runs" element={<RunsRoute />} />
              <Route path="generative" element={<GenerativeRoute />} />
              <Route path="pdm" element={<PdmRoute />} />
              <Route path="quality" element={<QualityRoute />} />
              <Route path="data" element={<DataLabRoute />} />
              <Route path="about" element={<About />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </HashRouter>
      </ToastProvider>
    </ThemeProvider>
  );
}
