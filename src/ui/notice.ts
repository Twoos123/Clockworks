/** A short notice over the game (rank locks, mission results), gone after a few seconds. */
export function notice(text: string, seconds = 6) {
  let n = document.getElementById("notice");
  if (!n) {
    n = document.createElement("div");
    n.className = "game-notice";
    n.id = "notice";
    (document.getElementById("gates")?.parentElement ?? document.body).append(n);
  }
  n.textContent = text;
  n.hidden = false;
  clearTimeout((n as any)._t);
  (n as any)._t = setTimeout(() => { n!.hidden = true; }, seconds * 1000);
}
