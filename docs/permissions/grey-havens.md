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

## Second reply (October 2026): blanket permission

Received by Asad from Cronus at Grey Havens after they tried the project. Reproduced as the
record; the original email is kept by the author.

---

Hi Asad,
We had a look at the link. We're impressed — genuinely. It runs in a tab, it's fast, and it reads from the player's own install rather than shipping anything of ours. That's the arrangement we'd have asked for if we'd thought to ask.
So here's a simpler answer than the one we gave you last time.
Use whatever tools you have at your disposal. Decompilers, the client jars, the asset formats, whatever gets you there. You don't need to come back to us for each step — treat this thread as blanket permission for the project. If a tool exists and it helps, use it.
The same three conditions as before, and only three:

* Keep it clearly unofficial, and keep the credit line where you've already got it.
* Keep it non-commercial. Donations are still fine.
* If it grows legs — if you start charging, or if it turns into something bigger than a fan project — come and talk to us. We'd like to be in the room for that one.

One thing to file for later rather than now: you're still not redistributing anything, so you don't have to solve assets yet. When you do want to, ask, and we'll have that conversation properly.
A warning, since you've got momentum. Spiral Knights is a large game and the client is obfuscated. You will not get to a hundred percent, and the last twenty percent is where people quit. Pick the parts that matter to you and let the rest be rough. A port that runs and is fun beats a port that's complete.
If it's useful, say the word and we'll link it from the forums. Costs us nothing and it's the least we can do for someone doing the work we haven't.
Keep us posted. We're interested now, which is more than we usually are.
Best,
Cronus
Grey Havens

---

## How the project keeps to it

- Any tool that helps is permitted (second reply): decompilers, the client jars, the asset
  formats. Decompiled output and extracted game files still stay outside the repository
  (`.decompiled/`, git-ignored) and are never committed or distributed.
- Redistributing assets is not covered yet: ask Grey Havens first.
- The game's code is a TypeScript reimplementation; no decompiled Java is pasted into it.
- No client code or game assets are redistributed: each player's own install supplies them,
  read on their own machine.
- Non-commercial (donations are fine) and clearly unofficial, with the credit line kept. If
  it starts charging or grows beyond a fan project, talk to Grey Havens first.
