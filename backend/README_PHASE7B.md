# BlisterSynth AI v0.7.0 - Phase 7B

New in this phase: Scenario Copilot, command palette (Ctrl+K / Cmd+K), first-visit tour, demo mode, How it works page.

## Run it
```
# terminal 1 - backend
cd backend
pip install -r requirements.txt          # install PyTorch as a CPU build first (conda-forge pytorch-cpu, or the pytorch.org cpu wheel index)
uvicorn app.main:app --port 8000

# terminal 2 - frontend
cd frontend
npm install
npm run dev                              # http://localhost:5173
```
Optional Claude parsing for the Scenario Copilot: copy `backend/.env.example` to `.env`, set `ANTHROPIC_API_KEY` (and optionally `ANTHROPIC_MODEL`, default `claude-sonnet-5-5`). Without a key the rule-based parser is used. If a Claude call fails or returns an invalid config, the rules are used and the UI says so.

## Tests
```
cd backend
python scripts/smoke_test.py ; python scripts/test_phase2.py ; python scripts/test_phase3.py
python scripts/test_phase4.py ; python scripts/test_phase5.py
python scripts/test_phase7.py            # 7A + 7B (about 4 min); add --7b-only for just the Copilot checks (about 10 s)
cd ../frontend
npm run build                            # typecheck + production build
npx vitest run                           # 196 tests
```
The Anthropic SDK is mocked in all tests. The real Claude call has NOT been run (no API key was available while building).

## Files
Backend: `app/copilot.py` (rule parser, Claude parser with forced tool use, validation, fallback), `app/api/copilot.py` (`GET /api/copilot/status`, `POST /api/copilot/parse`, `POST /api/copilot/validate`), `app/config.py` (version, COPILOT_* settings).
Frontend: `pages/Copilot.tsx`, `pages/About.tsx`, `components/{CommandPalette,HelpMenu,Tour,DemoPlayer}.tsx`, `components/about/ArchitectureDiagram.tsx`, `hooks/{useDemo,useUiTrigger}.ts`, `lib/{copilot,palette,tour,bus,demoScript,demoRunner,about}.ts`.

## Demo mode (viva)
Help menu (?) -> "Play demo", or Ctrl+K -> "Start demo mode". Script: `frontend/src/lib/demoScript.ts` (plain data, ~3:52). Train one generator and one PdM model BEFORE the demo so the last two steps have results.
