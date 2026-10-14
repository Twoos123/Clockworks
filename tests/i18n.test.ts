import assert from "node:assert/strict";
import { test } from "node:test";
import { compose, formatMessage, loadMessages, MessageManager, parseProperties, qualify, taint, tcompose } from "../src/i18n.ts";

test(".properties: separators, comments, continuations, escapes", () => {
  const p = parseProperties([
    "# a comment",
    "! another comment \\",
    "plain=value",
    "  spaced   =   padded value  ",
    "colon:after colon",
    "white space-separated",
    "empty=",
    "keyonly",
    "multi=first \\",
    "      second \\",
    "  third",
    "uni=caf\\u00e9 \\u2014 done",
    "tabs=a\\tb\\nc",
    "esc\\=key=escaped \\= sign",
    "esc\\ key = spaced key",
    "trail=ends in a backslash \\\\",
    "next=after",
  ].join("\r\n"));
  assert.equal(p.get("plain"), "value");
  assert.equal(p.get("spaced"), "padded value  ");
  assert.equal(p.get("colon"), "after colon");
  assert.equal(p.get("white"), "space-separated");
  assert.equal(p.get("empty"), "");
  assert.equal(p.get("keyonly"), "");
  assert.equal(p.get("multi"), "first second third");
  assert.equal(p.get("uni"), "café — done");
  assert.equal(p.get("tabs"), "a\tb\nc");
  assert.equal(p.get("esc=key"), "escaped = sign");
  assert.equal(p.get("esc key"), "spaced key");
  assert.equal(p.get("trail"), "ends in a backslash \\");
  assert.equal(p.get("next"), "after");
  assert.ok(!p.has("#") && !p.has("!") && p.size === 13);
});

function manager() {
  const m = new MessageManager();
  m.add("global", parseProperties("m.ok=Okay\nm.shared=Global shared\nm.pair={0} and {1}\nm.options.2={0} or {1}\nm.control_leftbracket=<\nm.control_rightbracket=>\nm.control_noneassigned=unbound"));
  m.add("things", parseProperties([
    "m.widget=Widget", "m.greet=Hello, {0}!", "m.quote=It's {0}'s turn", "m.meta=Outer [{0}] [{1}]",
    "m.sheep.0=No sheep", "m.sheep.1=One sheep", "m.sheep.n={0} sheep", "m.sheep=Some sheep {0}",
    "m.count={0} items", "m.braces=Broken {0",
  ].join("\n")));
  m.add("things_xx", parseProperties("m.widget=Widgeto"));
  m.add("child", parseProperties("__parent=things\nm.own=Own text"));
  m.add("help", parseProperties("msgbundle_class=some.ControlAwareMessageBundle\nm.how=Press [[ACTION]] or [[?DEFEND]], not [[NOPE]]"));
  return m;
}

test("plain, qualified and parent keys", () => {
  const m = manager(), b = m.getBundle("things");
  assert.equal(b.get("m.widget"), "Widget");
  assert.equal(b.get("m.ok"), "Okay"); // from the global bundle
  assert.equal(b.get("m.missing"), "m.missing");
  assert.equal(m.getBundle("global").xlate(qualify("things", "m.widget")), "Widget");
  assert.equal(m.getBundle("child").get("m.own"), "Own text");
  assert.equal(m.getBundle("child").get("m.widget"), "Widget"); // __parent
  assert.equal(m.getBundle("child").get("m.shared"), "Global shared"); // and on to global
  assert.ok(b.exists("m.greet|x") && !b.exists("m.nothing") && m.getBundle("global").exists("%things:m.widget"));
  assert.equal(m.getBundle("nobundle").get("m.ok"), "Okay");
});

test("compound keys, taint, plurals and substitution", () => {
  const b = manager().getBundle("things");
  assert.equal(b.xlate(tcompose("m.greet", "Bob")), "Hello, Bob!");
  assert.equal(b.xlate(compose("m.greet", "m.widget")), "Hello, Widget!"); // arguments are translated
  assert.equal(b.xlate(compose("m.greet", taint("m.widget"))), "Hello, m.widget!");
  assert.equal(b.xlate(taint("m.widget")), "m.widget");
  assert.equal(b.xlate(compose("m.meta", tcompose("m.greet", "a|b"), compose("m.pair", taint("x"), "m.ok"))), "Outer [Hello, a|b!] [x and Okay]");
  assert.equal(b.xlate(compose("m.greet", "%global:m.ok")), "Hello, Okay!");
  assert.equal(b.xlate(tcompose("m.sheep", 0)), "No sheep");
  assert.equal(b.xlate(tcompose("m.sheep", 1)), "One sheep");
  assert.equal(b.xlate(tcompose("m.sheep", "42")), "42 sheep");
  assert.equal(b.xlate(tcompose("m.sheep", "lots")), "Some sheep lots");
  assert.equal(b.get("m.quote", "Ann"), "It's Ann's turn"); // quotes are literal
  assert.equal(b.get("m.count", 12345), "12,345 items");
  assert.equal(b.get("m.braces", "x"), "Broken {0(x)");
  assert.equal(b.get("m.gone", "x"), "m.gone(x)");
  assert.equal(b.message("m.not.a.key"), "m.not.a.key");
  assert.equal(b.message("Just text"), "Just text");
});

test("formatting and locales", () => {
  assert.equal(formatMessage("{1} before {0}", ["a", "b"]), "b before a");
  assert.equal(formatMessage("{0,number,integer}", ["7.6"]), "8");
  assert.equal(formatMessage("{2}", ["a"]), "{2}");
  const m = manager();
  m.setLocale("xx");
  assert.equal(m.getBundle("things").get("m.widget"), "Widgeto");
  assert.equal(m.getBundle("things").get("m.greet", "Al"), "Hello, Al!"); // falls back to the base file
});

test("control-aware bundles fill in key bindings", () => {
  const m = manager();
  m.controls = c => c === "ACTION" ? ["Mouse 1"] : c === "DEFEND" ? ["Mouse 2", "Shift"] : [];
  assert.equal(m.getBundle("help").get("m.how"), "Press <Mouse 1> or <Mouse 2> or <Shift>, not <unbound>");
});

test("loading bundles picks the base files and the chosen locale", async () => {
  const files: Record<string, string> = { global: "m.a=A", global_xx: "m.a=Ax", global_yy: "m.a=Ay", other: "m.b=caf\\u00e9" };
  const vfs = {
    messageBundles: async () => Object.keys(files),
    messageBundle: async (n: string) => n in files ? new TextEncoder().encode(files[n]) : null,
  };
  const { messages } = await import("../src/i18n.ts");
  assert.equal(await loadMessages(vfs, "yy"), 3);
  assert.equal(messages.getBundle("other").get("m.a"), "Ay");
  assert.equal(messages.getBundle("other").get("m.b"), "café");
});

test("variant keys compose as VariantConfig builds them", async () => {
  const { messages } = await import("../src/i18n.ts");
  const { variantKey, variantText } = await import("../src/game/text.ts");
  messages.add("item", parseProperties("m.attack_speed=Speed: {0}\nm.medium=Mid\nm.high=Top\nm.new_status_resist=Resist {0}: {1}\nm.low=Low\nm.health_bonus=Health +{0}"));
  messages.add("status", parseProperties("m.curse=Hex"));
  const speed = { $class: "x.VariantConfig$AttackSpeedChange", bonus: { name: "MEDIUM" }, speed: 0.03 };
  assert.equal(variantKey(speed), "%item:m.attack_speed|m.medium");
  assert.equal(variantText(speed, "ours"), "Speed: Mid");
  assert.equal(variantText({ $class: "x$AttackSpeedChange", bonus: { name: "CUSTOM" }, speed: 0.1 }, "ours"), "Speed: Top");
  assert.equal(variantText({ $class: "x$StatusResist", statusResist: { name: "LOW" }, conditionMask: 32 }, "ours"), "Resist Hex: Low");
  assert.equal(variantText({ $class: "x$HealthBonus", health: 80 }, "ours"), "Health +2");
  assert.equal(variantText({ $class: "x$Unknown" }, "ours"), "ours");
});
