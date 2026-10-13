// The game's text: its message bundles (rsrc/i18n/*.properties inside the player's own
// projectx-config.jar), read at runtime and resolved the way Narya's MessageManager and
// MessageBundle do. Nothing here carries the game's text; it all comes from the install.
//
// Keys, as Narya builds them:
//  - "m.calibur": a plain key, looked up in the bundle, then its parent ("__parent", or global)
//  - "%item:m.calibur": a key qualified with the bundle that translates it
//  - "m.foo|arg|arg": a compound key; each argument is translated in turn, then put in {0}, {1}...
//  - "~text": tainted text, shown as written (and an argument "~text" is not translated)
//  - with a whole-number first argument, "key.0", "key.1" or "key.n" is tried before "key"

import type { Vfs } from "./vfs";

// ----------------------------------------------------------------------------- .properties

const isWhite = (c: string) => c === " " || c === "\t" || c === "\f";

/** Unescapes a key or value: \t \n \r \f, \uXXXX, and \x for any other x. */
function unescapeProps(s: string): string {
  if (!s.includes("\\")) return s;
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== "\\") { out += c; continue; }
    const n = s[++i];
    if (n === undefined) break;
    if (n === "u") {
      const hex = s.substring(i + 1, i + 5);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new Error("malformed \\uxxxx encoding");
      out += String.fromCharCode(parseInt(hex, 16));
      i += 4;
    } else out += n === "t" ? "\t" : n === "n" ? "\n" : n === "r" ? "\r" : n === "f" ? "\f" : n;
  }
  return out;
}

/**
 * Parses a Java .properties file as Properties.load does: "#" and "!" comments, keys ended by
 * an unescaped "=", ":" or white space, a backslash at the end of a line continuing it onto
 * the next (whose leading white space is dropped), and the escapes above.
 */
export function parseProperties(text: string): Map<string, string> {
  const out = new Map<string, string>();
  const lines = text.split(/\r\n|\r|\n/);
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].replace(/^[ \t\f]+/, "");
    if (line === "" || line[0] === "#" || line[0] === "!") continue;
    // an odd number of trailing backslashes joins the next line
    const continues = (l: string) => { let n = 0; for (let j = l.length - 1; j >= 0 && l[j] === "\\"; j--) n++; return n % 2 === 1; };
    while (continues(line)) {
      line = line.slice(0, -1);
      if (++i >= lines.length) break;
      line += lines[i].replace(/^[ \t\f]+/, "");
    }
    // the key runs to the first unescaped separator
    let k = 0;
    while (k < line.length) {
      const c = line[k];
      if (c === "\\") { k += 2; continue; }
      if (c === "=" || c === ":" || isWhite(c)) break;
      k++;
    }
    const key = line.substring(0, Math.min(k, line.length));
    let v = k;
    while (v < line.length && isWhite(line[v])) v++;
    if (v < line.length && (line[v] === "=" || line[v] === ":")) v++;
    while (v < line.length && isWhite(line[v])) v++;
    out.set(unescapeProps(key), unescapeProps(line.substring(v)));
  }
  return out;
}

// ----------------------------------------------------------------------------- keys

const TAINT = "~", QUAL_PREFIX = "%", QUAL_SEP = ":";

export const taint = (text: unknown) => TAINT + String(text);
export const isTainted = (text: string) => text.startsWith(TAINT);

/** Composes a compound key, escaping "|" as "\!" and "\" as "\\" in the arguments. */
export function compose(key: string, ...args: unknown[]): string {
  return key + "|" + args.map(a => String(a ?? "").replace(/\\/g, "\\\\").replace(/\|/g, "\\!")).join("|");
}

/** compose with every argument tainted. */
export const tcompose = (key: string, ...args: unknown[]) => compose(key, ...args.map(taint));

/** A key that names the bundle that translates it: "%item:m.calibur". */
export function qualify(bundle: string, key: string): string {
  if (bundle.includes(QUAL_PREFIX) || bundle.includes(QUAL_SEP)) throw new Error(`bad bundle name ${bundle}`);
  return QUAL_PREFIX + bundle + QUAL_SEP + key;
}

const bundleOf = (q: string) => q.substring(QUAL_PREFIX.length, q.indexOf(QUAL_SEP));
const unqualified = (q: string) => q.substring(q.indexOf(QUAL_SEP) + 1);
const isQualified = (key: string) => key.startsWith(QUAL_PREFIX) && key.includes(QUAL_SEP);

/** Undoes compose's escapes. */
export function unescapeArg(v: string): string {
  if (!v.includes("\\")) return v;
  let out = "";
  for (let i = 0; i < v.length; i++) {
    const c = v[i];
    if (c !== "\\" || i === v.length - 1) out += c;
    else { const n = v[++i]; out += n === "!" ? "|" : n; }
  }
  return out;
}

// ----------------------------------------------------------------------------- formatting

export type Arg = string | number;

/**
 * MessageFormat.format(MessageUtil.escape(msg), args): every quote is literal (escape doubles
 * them), "{n}" takes argument n (numbers grouped for the locale) and "{n,number,integer}" a
 * whole number. Returns null for a malformed pattern, as MessageFormat throws.
 */
export function formatMessage(msg: string, args: readonly Arg[], locale = "en"): string | null {
  let out = "";
  const nf = (n: number, integer: boolean) => new Intl.NumberFormat(locale || "en", integer ? { maximumFractionDigits: 0 } : { maximumFractionDigits: 3 }).format(n);
  for (let i = 0; i < msg.length; i++) {
    const c = msg[i];
    if (c !== "{") { out += c; continue; }
    const end = msg.indexOf("}", i);
    if (end < 0) return null;
    const [index, type, style] = msg.substring(i + 1, end).split(",").map(s => s.trim());
    if (!/^\d+$/.test(index)) return null;
    const n = Number(index);
    if (n >= args.length) out += "{" + n + "}";
    else {
      const a = args[n];
      const num = typeof a === "number" ? a : type === "number" && a.trim() !== "" && !isNaN(Number(a)) ? Number(a) : null;
      out += num !== null && (type === "number" || typeof a === "number") ? nf(num, style === "integer") : String(a);
    }
    i = end;
  }
  return out;
}

/** The plural suffix for a whole-number first argument: ".0", ".1" or ".n". */
function suffix(args: readonly Arg[]): string {
  if (args.length === 0 || args[0] === null || args[0] === undefined) return "";
  const a = args[0];
  const n = typeof a === "number" ? (Number.isInteger(a) ? a : NaN) : /^[+-]?\d+$/.test(a) ? Number(a) : NaN;
  if (isNaN(n) || Math.abs(n) > 2147483647) return "";
  return n === 0 ? ".0" : n === 1 ? ".1" : ".n";
}

// ----------------------------------------------------------------------------- bundles

/** Command names to the labels of the keys bound to them (for "[[ACTION]]" in help text). */
export type ControlNames = (command: string) => string[];

export class MessageBundle {
  constructor(private readonly mgr: MessageManager, readonly name: string,
    private readonly props: Map<string, string> | null, private readonly parent: MessageBundle | null,
    private readonly controlAware = false) {}

  /** The raw message for a key, from this bundle or its parents; null when there is none. */
  raw(key: string): string | null {
    const v = this.plain(key);
    return v !== null && this.controlAware ? this.mgr.controlText(v, this) : v;
  }

  /** The raw message without key bindings filled in. */
  plain(key: string): string | null {
    return this.props?.get(key) ?? this.parent?.plain(key) ?? null;
  }

  /** True when the key (qualified or compound) has a translation. */
  exists(key: string): boolean {
    if (key.startsWith(QUAL_PREFIX)) return isQualified(key) && this.mgr.getBundle(bundleOf(key)).exists(unqualified(key));
    const bar = key.indexOf("|");
    return this.raw(bar < 0 ? key : key.substring(0, bar)) !== null;
  }

  /**
   * The translation of a key. Without arguments the message is returned as written; with them
   * the plural variant is tried first and the arguments are substituted. A missing key comes
   * back as itself (with its arguments), so the caller always has something to show.
   */
  get(key: string, ...args: Arg[]): string {
    if (isTainted(key)) return key.substring(1);
    if (isQualified(key)) return this.mgr.getBundle(bundleOf(key)).get(unqualified(key), ...args);
    if (args.length === 0) return this.raw(key) ?? key;
    const sfx = suffix(args);
    let msg = this.raw(key + sfx);
    if (msg === null && sfx !== "") msg = this.raw(key);
    if (msg === null) return key + "(" + args.join(", ") + ")";
    return formatMessage(msg, args, this.mgr.locale) ?? msg + "(" + args.join(", ") + ")";
  }

  /** Translates a compound key: its arguments are translated (unless tainted) and substituted. */
  xlate(compound: string): string {
    if (isQualified(compound)) return this.mgr.getBundle(bundleOf(compound)).xlate(unqualified(compound));
    const bar = compound.indexOf("|");
    if (bar < 0) return this.get(compound);
    const argstr = compound.substring(bar + 1);
    const args = argstr === "" ? [] : argstr.split("|").map(a => isTainted(a) ? unescapeArg(a.substring(1)) : this.xlate(unescapeArg(a)));
    return this.get(compound.substring(0, bar), ...args);
  }

  /** ComponentConfig.getMessage: plain keys that are missing are shown as written. */
  message(text: string): string {
    if (isTainted(text) || isQualified(text) || text.includes("|")) return this.xlate(text);
    return this.exists(text) ? this.get(text) : text;
  }

  /** Every key in this bundle (not its parents) starting with a prefix. */
  keys(prefix = ""): string[] {
    return this.props ? [...this.props.keys()].filter(k => k.startsWith(prefix)) : [];
  }
}

/** Resolves bundles by name, the way Narya's MessageManager does, from the loaded sources. */
export class MessageManager {
  /** "", "de", "es", "fr" or "pt": the locale tried before the base bundle. */
  locale = "";
  /** The locales the install has bundles for, besides the base English. */
  available: string[] = [];
  controls: ControlNames | null = null;
  private readonly sources = new Map<string, Map<string, string>>();
  private readonly bundles = new Map<string, MessageBundle>();
  private global: MessageBundle | null = null;

  /** Adds a parsed .properties file under its file name ("global", "global_de"). */
  add(file: string, props: Map<string, string>) {
    this.sources.set(file, props);
    this.reset();
  }

  setLocale(locale: string) { this.locale = locale; this.reset(); }

  /** True once any bundle has been loaded. */
  get loaded() { return this.sources.size > 0; }

  private reset() {
    this.bundles.clear();
    this.global = null;
    this.global = this.getBundle("global");
  }

  /** ResourceBundle.getBundle: the locale's file falling back to the base file. */
  private props(name: string): Map<string, string> | null {
    const base = this.sources.get(name), local = this.locale ? this.sources.get(name + "_" + this.locale) : undefined;
    if (!local) return base ?? null;
    if (!base) return local;
    return new Map([...base, ...local]);
  }

  getBundle(name: string): MessageBundle {
    const known = this.bundles.get(name);
    if (known) return known;
    const props = this.props(name);
    const parentName = props?.get("__parent")?.trim();
    const controlAware = !!props?.get("msgbundle_class")?.includes("ControlAware");
    // bundles are cached before their parent is resolved, so a loop ends at the global bundle
    const bundle = new MessageBundle(this, name, props, null, controlAware);
    this.bundles.set(name, bundle);
    const parent = parentName ? this.getBundle(parentName) : name === "global" ? null : this.global;
    const real = new MessageBundle(this, name, props, parent === bundle ? null : parent, controlAware);
    this.bundles.set(name, real);
    return real;
  }

  /** ControlAwareMessageBundle: "[[ACTION]]" becomes the bracketed key bound to the command. */
  controlText(text: string, bundle: MessageBundle): string {
    if (!text.includes("[[") || !text.includes("]]")) return text;
    const raw = (k: string) => bundle.plain(k);
    const left = raw("m.control_leftbracket") ?? "[", right = raw("m.control_rightbracket") ?? "]";
    const bracket = (s: string) => left + s + right;
    const none = bracket(raw("m.control_noneassigned") ?? "?");
    const keys = (cmd: string) => this.controls?.(cmd) ?? [];
    const options = (list: string[], bracketed: boolean) => {
      if (list.length === 0) return "";
      const items = bracketed ? list.map(bracket) : list;
      const k = (bracketed ? "m.options." : "m.plain-list.") + list.length;
      const msg = raw(k);
      return msg ? formatMessage(msg, items, this.locale) ?? items.join(", ") : items.join(", ");
    };
    const command = (name: string): string => {
      if (name === "?MOVEMENT") {
        const abs = ["MOVE_NORTH", "MOVE_WEST", "MOVE_SOUTH", "MOVE_EAST"].map(c => keys(c)[0]).filter(Boolean);
        const rel = ["MOVE_FORWARD", "MOVE_LEFT", "MOVE_BACKWARD", "MOVE_RIGHT"].map(c => keys(c)[0]).filter(Boolean);
        return abs.length && rel.length ? formatMessage(raw("m.options.2") ?? "{0} / {1}", [options(abs, false), options(rel, false)], this.locale) ?? ""
          : options(abs.length ? abs : rel, true);
      }
      if (name === "?SWITCHWEAPON") return options([...keys("NEXT_WEAPON"), ...keys("PREV_WEAPON")], true);
      if (name.startsWith("?")) return options(keys(name.substring(1)), true) || none;
      const k = keys(name)[0];
      return k ? bracket(k) : none;
    };
    let out = "", rest = text;
    for (;;) {
      const a = rest.indexOf("[["), b = a < 0 ? -1 : rest.indexOf("]]", a + 2);
      if (a < 0 || b < 0) return out + rest;
      out += rest.substring(0, a) + command(rest.substring(a + 2, b));
      rest = rest.substring(b + 2);
    }
  }
}

// ----------------------------------------------------------------------------- the game's bundles

/** The game's message manager; empty until loadMessages has read the install's bundles. */
export const messages = new MessageManager();

/** Translates a key in a bundle ("item", "m.calibur"); compound and qualified keys work too. */
export const xlate = (bundle: string, key: string) => messages.getBundle(bundle).xlate(key);

/** True when the bundle has a translation for the key. */
export const hasMessage = (bundle: string, key: string) => !!key && messages.getBundle(bundle).exists(key);

/** The translation of a key with arguments ("m.price", 100). */
export const message = (bundle: string, key: string, ...args: Arg[]) => messages.getBundle(bundle).get(key, ...args);

/** The translation when there is one, else the fallback (our own English, for a missing bundle). */
export function text(bundle: string, key: string | undefined | null, fallback: string): string {
  if (!key) return fallback;
  if (isTainted(key)) return key.substring(1);
  return hasMessage(bundle, key) ? xlate(bundle, key) : fallback;
}

/** The locales the install has bundles for, besides the base English. */
export function localesOf(files: string[]): string[] {
  const out = new Set<string>();
  for (const f of files) { const m = /_([a-z]{2})$/.exec(f); if (m) out.add(m[1]); }
  return [...out].sort();
}

/**
 * Reads every message bundle from the install (the base files and, for a locale, its own),
 * decoded as ISO-8859-1 as Properties.load reads them. Missing bundles leave the fallbacks.
 */
export async function loadMessages(vfs: Pick<Vfs, "messageBundles" | "messageBundle">, locale = ""): Promise<number> {
  let names: string[] = [];
  try { names = await vfs.messageBundles(); } catch { return 0; }
  const wanted = names.filter(n => !/_[a-z]{2}$/.test(n) || (locale && n.endsWith("_" + locale)));
  const decoder = new TextDecoder("iso-8859-1");
  const read = await Promise.all(wanted.map(async n => {
    try { const b = await vfs.messageBundle(n); return b ? [n, parseProperties(decoder.decode(b))] as const : null; } catch { return null; }
  }));
  messages.available = localesOf(names);
  let count = 0;
  for (const r of read) if (r) { messages.add(r[0], r[1]); count++; }
  messages.setLocale(locale);
  return count;
}
