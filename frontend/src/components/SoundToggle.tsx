import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useSoundOn } from "../hooks/useSound";

const STYLES = {
  glass: "border border-white/20 bg-white/10 text-white hover:bg-white/20",
  plain: "border border-line bg-surface text-ink hover:bg-tint",
} as const;

/** Mute / unmute the little "pop" sounds. Remembered across visits. */
export function SoundToggle({ variant = "plain", withLabel = false, className = "" }: { variant?: keyof typeof STYLES; withLabel?: boolean; className?: string }) {
  const [on, setOn] = useSoundOn();
  return (
    <button type="button" onClick={() => setOn(!on)} aria-pressed={!on} aria-label={on ? "Mute sounds" : "Turn sounds on"} title={on ? "Mute sounds" : "Turn sounds on"}
      className={`press inline-flex h-10 items-center justify-center gap-2 rounded-full ${withLabel ? "px-3.5 text-xs font-semibold" : "w-10"} ${STYLES[variant]} ${className}`}>
      {on ? <Volume2 className="h-4 w-4" aria-hidden /> : <VolumeX className="h-4 w-4" aria-hidden />}
      {withLabel && <span>{on ? "Sound on" : "Muted"}</span>}
    </button>
  );
}

/** Pause / resume every looping animation on the page (see useMotionPaused). */
export function MotionToggle({ paused, onToggle, variant = "plain", withLabel = false, className = "" }: {
  paused: boolean; onToggle: () => void; variant?: keyof typeof STYLES; withLabel?: boolean; className?: string;
}) {
  return (
    <button type="button" onClick={onToggle} aria-pressed={paused} aria-label={paused ? "Play animations" : "Pause animations"} title={paused ? "Play animations" : "Pause animations"}
      className={`press inline-flex h-10 items-center justify-center gap-2 rounded-full ${withLabel ? "px-3.5 text-xs font-semibold" : "w-10"} ${STYLES[variant]} ${className}`}>
      {paused ? <Play className="h-4 w-4" aria-hidden /> : <Pause className="h-4 w-4" aria-hidden />}
      {withLabel && <span>{paused ? "Play motion" : "Pause motion"}</span>}
    </button>
  );
}
