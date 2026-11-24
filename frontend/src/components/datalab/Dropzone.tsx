import { UploadCloud } from "lucide-react";
import { useRef, useState } from "react";
import { formatBytes, isCsvFile } from "../../lib/metrics";

/** Drag-and-drop (or click / keyboard) CSV picker. Reports wrong file types through `onError`. */
export default function Dropzone({ onFile, onError, file, disabled }: {
  onFile: (f: File) => void; onError: (msg: string) => void; file?: File | null; disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const accept = (f: File | undefined) => {
    if (!f) return;
    if (!isCsvFile(f)) { onError(`'${f.name}' is not a CSV file. Export your data as .csv first.`); return; }
    onFile(f);
  };
  return (
    <div role="button" tabIndex={disabled ? -1 : 0} aria-label="Upload a CSV file: drop it here or press Enter to browse" aria-disabled={disabled}
      onClick={() => !disabled && input.current?.click()}
      onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !disabled) { e.preventDefault(); input.current?.click(); } }}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled) accept(e.dataTransfer.files?.[0]); }}
      className={`flex cursor-pointer flex-col items-center gap-2 rounded-3xl border-2 border-dashed px-6 py-10 text-center transition-colors ${over ? "border-primary bg-primary/5" : "border-line bg-tint"} ${disabled ? "cursor-not-allowed opacity-60" : "hover:border-primary"}`}>
      <UploadCloud className="h-9 w-9 text-primary" aria-hidden />
      <p className="font-display text-base font-semibold">{file ? file.name : "Drop a CSV here, or click to browse"}</p>
      <p className="text-xs text-soft">{file ? formatBytes(file.size) : "One row per time step, one column per sensor. Up to 25 MB."}</p>
      <input ref={input} type="file" accept=".csv,text/csv" className="sr-only" tabIndex={-1} onChange={(e) => { accept(e.target.files?.[0]); e.target.value = ""; }} />
    </div>
  );
}
