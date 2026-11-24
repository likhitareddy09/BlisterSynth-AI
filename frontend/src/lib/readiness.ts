// The landing page's honest "how far is this from a factory" table. Levels count how many stages a row has reached.
// Every product claim points at the automated test that backs it (backend/scripts, frontend vitest).

export interface ReadinessRow { name: string; level: number; status: string; note: string }
export interface ReadinessGroup { id: string; title: string; stages: string[]; rows: ReadinessRow[]; footnote: string }

export const READINESS: ReadinessGroup[] = [
  {
    id: "product", title: "Product",
    stages: ["Prototype", "Tested in software", "Validated on plant data", "In production"],
    rows: [
      { name: "Physics digital twin", level: 2, status: "Tested in software", note: "Same seed, identical data; streaming equals batch (smoke_test.py)" },
      { name: "Fault engine, labels and RUL", level: 2, status: "Tested in software", note: "8 faults x 3 profiles, labelled every second (test_phase2.py)" },
      { name: "Generative models (cVAE, TimeGAN)", level: 2, status: "Tested in software", note: "Training, sampling and the generate API (test_phase3.py)" },
      { name: "Quality evidence and PdM models", level: 2, status: "Tested in software", note: "KS, TSTR, diversity, fault + RUL models (test_phase4.py, test_phase7.py)" },
      { name: "Data Lab (plant CSV import)", level: 2, status: "Tested in software", note: "Column mapping, validation and exports (test_phase7.py)" },
    ],
    footnote: "Nothing has been validated on a real production line yet. The Data Lab is ready for a plant's own CSV export when one is available.",
  },
  {
    id: "regulatory", title: "Regulatory",
    stages: ["Partly in place", "Fully in place", "Independently audited", "Certified"],
    rows: [
      { name: "GMP data integrity (ALCOA+)", level: 1, status: "Partly in place", note: "Timestamps, original CSVs, configs and seeds are kept; nothing records who did what" },
      { name: "FDA 21 CFR Part 11", level: 0, status: "Not started", note: "Needs user logins, an audit trail and electronic signatures" },
      { name: "ISO/IEC 27001", level: 0, status: "Not started", note: "Needs a security management system; the app has no user accounts yet" },
    ],
    footnote: "BlisterSynth is a research prototype. It is not certified for any regulated use, and these rows say exactly what is missing.",
  },
];

export const levelPercent = (level: number, stages: number) => Math.max(0, Math.min(100, (level / stages) * 100));
