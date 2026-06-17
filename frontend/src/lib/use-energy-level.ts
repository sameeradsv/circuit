export function energyDescriptor(e: number): { word: string; hint: string } {
  if (e >= 9) return { word: "Peak",    hint: "go for the hardest thing on the list" };
  if (e >= 7) return { word: "Focused", hint: "ship a deep-work block" };
  if (e >= 5) return { word: "Steady",  hint: "make a clean dent in the middle of the list" };
  if (e >= 3) return { word: "Low",     hint: "easy admin, replies, errands" };
  return        { word: "Drained",  hint: "two-minute tasks only, or rest" };
}
