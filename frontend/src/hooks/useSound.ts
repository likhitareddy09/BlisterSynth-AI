import { useEffect, useState } from "react";
import { setSoundOn, soundOn, subscribeSound } from "../lib/sound";

/** [is sound on, turn it on/off] - shared by every toggle on the page and saved across visits. */
export function useSoundOn(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState<boolean>(() => soundOn());
  useEffect(() => subscribeSound(setOn), []);
  return [on, setSoundOn];
}
