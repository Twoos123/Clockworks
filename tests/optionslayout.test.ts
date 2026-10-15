// The options window's layout rules, as Clyde and the client lay it out: TableLayout skips
// hidden children (so OptionsDialog swaps party_with_spacer in for a hidden Party with Any), and
// a stretched InterfaceWindow sizes its interface with the display's size as hints and centres it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Component, pack, packStretched } from "../src/ui/gui.ts";

const LAYOUT = "com.threerings.opengl.gui.config.LayoutConfig$";

function box(tag: string, width: number, height: number, visible = true) {
  const c = new Component("spacer", null);
  c.tag = tag;
  c.preferredSize = { width, height };
  c.visible = visible;
  return c;
}

/** general.dat's language_container: a four-column table. */
function languageTable(playing: boolean) {
  const t = new Component("container", null);
  t.layout = { $class: `${LAYOUT}Table`, columns: 4 };
  t.children = [
    box("language_label", 80, 20), box("language", 100, 24), box("gap", 15, 1),
    box("party_with_any", 90, 18, playing), box("party_with_spacer", 0, 0, !playing),
    box("region_label", 60, 20), box("region", 100, 24),
  ];
  pack(t);
  return t;
}

const at = (t: Component, tag: string) => t.find(tag)!;

test("a table lays out only its visible children, a hidden one giving up its cell", () => {
  const t = new Component("container", null);
  t.layout = { $class: `${LAYOUT}Table`, columns: 2 };
  t.children = [box("a", 10, 10), box("b", 20, 10, false), box("c", 30, 10), box("d", 40, 10)];
  const s = pack(t);
  // a and c share the first row; d starts the second (Clyde's y runs upward); the columns are
  // as wide as a or d, and c
  assert.deepEqual(s, { width: 40 + 30, height: 20 });
  assert.equal(at(t, "c").x, 40);
  assert.equal(at(t, "a").y, at(t, "c").y);
  assert.equal(at(t, "d").x, 0);
  assert.ok(at(t, "d").y < at(t, "a").y);
});

test("the language table keeps Region on the second row with or without Party with Any", () => {
  for (const playing of [true, false]) {
    const t = languageTable(playing);
    const row1 = at(t, "language").y, row2 = at(t, "region").y;
    assert.ok(row2 < row1, `region below language (playing ${playing})`);
    assert.equal(at(t, "region_label").x, at(t, "language_label").x);
    assert.equal(at(t, "region").x, at(t, "language").x);
  }
  // in play the check box takes the fourth cell of the first row
  const t = languageTable(true);
  assert.equal(at(t, "party_with_any").y + at(t, "party_with_any").height, at(t, "language").y + at(t, "language").height);
});

/** interface.dat's root: Options Backing, 640 x -1, an AnchorLayout centring the column. */
function optionsRoot(childW: number, childH: number) {
  const host = new Component("ui", null);
  const root = new Component("container", null);
  root.preferredSize = { width: 640, height: -1 };
  root.layout = { $class: `${LAYOUT}Anchor` };
  const column = box("column", childW, childH);
  root.children = [column];
  host.children = [root];
  return { host, root, column };
}

test("a stretched window's 640 x -1 root is a centred column as tall as the display", () => {
  const { host, root, column } = optionsRoot(500, 700);
  const b = packStretched(host, 2000, 1070);
  assert.deepEqual(b, { x: 680, y: 0, width: 640, height: 1070 });
  assert.deepEqual([root.x, root.y, root.width, root.height], [0, 0, 640, 1070]);
  // the anchored column sits in the middle of the backing
  assert.deepEqual([column.x, column.y], [70, 185]);
});

test("a stretched window's root is no wider than the display, and overflows it centred", () => {
  const narrow = optionsRoot(500, 700);
  assert.deepEqual(packStretched(narrow.host, 600, 800), { x: 0, y: 0, width: 600, height: 800 });
  const short = optionsRoot(500, 700);
  assert.deepEqual(packStretched(short.host, 1000, 500), { x: 180, y: -100, width: 640, height: 700 });
});
