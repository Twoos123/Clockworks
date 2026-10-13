# Permission from Grey Havens

Received by the project's author (Asad) from Cronus at Grey Havens in October 2026, in reply
to the author's outreach about this browser remake. Reproduced as the record they asked to be
quoted. The original email is kept by the author.

---

Hi Asad,
Thanks for spelling it out. A viewer and a remake are different animals, and it's good you flagged which one you're building before we answered.
So, the thing you actually need: yes. You have our permission to decompile the client JARs in the `code/` folder. Read them, study them, reimplement from them. For a browser remake by a community developer, that's the permission you're after — treat this email as it, and quote it if anyone asks you.
So there's no confusion later, here's the shape of it:

* Clyde is BSD. Use it, keep the license notice, no need to ask us again.
* The client and the game assets are ours, and are not covered by that license. Decompiling the client is a separate permission, granted to you for this project. You still don't have to redistribute anything — pointing players at their own install remains the cleanest arrangement.
* Fair warning: the client is obfuscated. Class and field names will be meaningless strings. Budget accordingly. Several people have started down this road and found it long.
* Same as before — non-commercial, clearly unofficial, and we're happy.

A word on history, so you aren't blindsided. The last community client-side project ended in a takedown, and a fair chunk of that mess came from nobody having agreed in advance what was and wasn't permitted. We would much rather say yes plainly now than have an awkward conversation in eighteen months.
Two things we'd ask in return:

1. Put a line somewhere public that it's unofficial and not endorsed by us, and that the game, its client and its assets belong to Grey Havens and Three Rings. A link to this email in your README is fine.
2. If it ever stops being a fan project — you start charging, or it grows legs — come and talk to us before you commit. We're small. We'd rather be a participant than a surprise.

On the browser platform layer: it's now the whole project instead of a footnote, which makes it more interesting to us, not less. Same answer as before, though — no roadmap, no promises. Send us a link.
Thanks for the care you're putting into this. It's genuinely good to see.
Best,
Cronus,
Grey Havens

---

## How the project keeps to it

- Decompiling the client jars is for study only. Decompiled output stays outside the
  repository (`.decompiled/`, git-ignored) and is never committed or distributed.
- The game's code is a TypeScript reimplementation; no decompiled Java is pasted into it.
- No client code or game assets are redistributed: each player's own install supplies them,
  read on their own machine.
- Non-commercial and clearly unofficial. If that ever changes, talk to Grey Havens first.
