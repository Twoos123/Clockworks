// Contact sheets for the Test Range sweep (tools/audit/sweep.ts): evaluated as a plain string
// in a blank page, it installs window.drawSheet({ title, cols, rows }), which draws a label
// column (each item's name and its flags) and a row of captioned thumbnails per item on a
// canvas and resolves to the sheet as a PNG data URL.
(() => {
  const TW = 320, TH = 213, LW = 250, RH = TH + 8, HEAD = 36;
  window.drawSheet = async d => {
    const c = document.createElement("canvas");
    c.width = LW + d.cols * TW;
    c.height = HEAD + d.rows.length * RH;
    const g = c.getContext("2d");
    g.fillStyle = "#14171d"; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = "#e6e9ef"; g.font = "bold 18px sans-serif"; g.fillText(d.title, 10, 24);
    const wrap = (text, x, y, w, max, lh) => {
      let line = "", n = 0;
      for (const word of text.split(/\s+/)) {
        const t = line ? line + " " + word : word;
        if (g.measureText(t).width > w && line) { g.fillText(line, x, y + n * lh); line = word; if (++n >= max) return n; }
        else line = t;
      }
      if (line) { g.fillText(line, x, y + n * lh); n++; }
      return n;
    };
    for (let r = 0; r < d.rows.length; r++) {
      const row = d.rows[r], y = HEAD + r * RH;
      g.fillStyle = r % 2 ? "#1c2028" : "#181b22"; g.fillRect(0, y, c.width, RH);
      g.fillStyle = "#e6e9ef"; g.font = "bold 13px sans-serif";
      const used = wrap(row.name, 8, y + 18, LW - 14, 4, 16);
      g.fillStyle = row.flags.length ? "#f97066" : "#7bd88f"; g.font = "11px sans-serif";
      wrap(row.flags.length ? row.flags.join(" · ") : "OK", 8, y + 22 + used * 16, LW - 14, 8, 13);
      for (let i = 0; i < d.cols; i++) {
        const t = row.tiles[i], x = LW + i * TW;
        if (!t) continue;
        let drawn = false;
        if (t.src) {
          const img = new Image();
          img.src = t.src;
          try { await img.decode(); g.drawImage(img, x, y + 4, TW - 4, TH); drawn = true; } catch { /* drawn as missing */ }
        }
        if (!drawn) { g.fillStyle = "#2a2f3a"; g.fillRect(x, y + 4, TW - 4, TH); }
        g.fillStyle = "rgba(0,0,0,0.6)"; g.fillRect(x, y + 4, TW - 4, 18);
        g.fillStyle = "#fff"; g.font = "12px sans-serif"; g.fillText(t.label, x + 6, y + 17);
      }
    }
    return c.toDataURL("image/png");
  };
})();
