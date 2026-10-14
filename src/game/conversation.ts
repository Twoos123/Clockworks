// Conversations (config/conversation.dat): what the client's conversation dialog (client C, filled
// from a ConversationDialogInfo) shows a node at a time, for townsfolk, radio calls and
// conversation missions alike, read through their derivations with arguments applied.
//
// Townsfolk: an NPC's Interaction handler runs ProjectXActionConfig.StartConversation with a
// conversation; each node has a message, the NPC's animation, an optional interface and the
// knight's responses, all message keys in the conversation's bundle ("conversation" by default).
// Conversation missions (MissionConfig.Conversation) hold the same StartConversation: the
// speaker's model ("character/npc/crew/model_kora.dat", Variant comlink), its music
// (Custom/Mission/Comlink) and the conversation, whose nodes name the comlink interface
// (ui/conversation/interface_comlink.dat).
//
// The server runs a conversation. Conversations derived from a parameterized base (the
// missions' Mission/Base/Simple Images) keep their jumps: the base's "Jump N" arguments become
// each response's { node } action and the initial action names the first node. Otherwise the
// responses' ConversationJump actions are stripped from the client data, as are the nodes'
// conditions, and the way through is inferred from the node names the designers used ("part
// 1a", "part 2a", "part 3b"...):
//
//  - response i of node N leads to node N+1 with the i-th letter when there is one (a branch:
//    "What is energy?" / "How is energy used?" lead to parts 3a and 3b);
//  - a node's only response leads to N+1's first node, or ends the conversation;
//  - otherwise the last of several responses ends it ("No thanks, I'll explore on my own"),
//    and the others return to the node that branched here ("I have another question"), or
//    go on in order.
//
// Speaker names are "n." keys named after the messages' stem ("m.hav_greeter_1a" is spoken by
// "n.hav_greeter", Hailoh), unless the action or conversation names one.

import type { GameData } from "./data";

export interface ConvResponse {
  text: string;
  /** The node the response jumps to, where the data keeps the jump. */
  jump?: string;
}
export interface ConvNode {
  name: string;
  message: string;
  /** The NPC's animation for this node (a reference), if any. */
  animation: any;
  /** A different conversation interface (ui/conversation/interface_comlink.dat...). */
  userInterface: any;
  responses: ConvResponse[];
}
export interface NpcConversation {
  bundle: string;
  speaker: string;
  nodes: ConvNode[];
  /** The node it opens on: the initial action's node, else the first. */
  start: number;
}

/** Reads a resolved ConversationConfig implementation; the speaker's name key from the action, if set. */
export function readConversation(impl: any, actionName = ""): NpcConversation | null {
  // (a parameterized base's unused nodes have no message, their responses no text)
  const nodes: ConvNode[] = (impl?.nodes ?? []).filter((n: any) => n && typeof n.message === "string" && n.message).map((n: any) => ({
    name: String(n.name ?? ""),
    message: n.message,
    animation: n.animation ?? null,
    userInterface: n.userInterface ?? null,
    responses: (n.responses ?? []).filter((r: any) => r && typeof r.text === "string" && r.text)
      .map((r: any): ConvResponse => (typeof r.action?.node === "string" ? { text: r.text, jump: r.action.node } : { text: r.text })),
  }));
  if (!nodes.length) return null;
  const first = impl.initialAction?.node;
  const start = typeof first === "string" ? Math.max(0, nodes.findIndex(n => n.name === first)) : 0;
  const speaker = actionName || impl.speakerName || speakerKey(nodes[start].message);
  return { bundle: impl.bundle || "conversation", speaker, nodes, start };
}

/**
 * A conversation mission's conversation (its StartConversation's). Some missions' own
 * conversations ("Mission/Rank/Alchemy for Beginners A") are empty in the client data: the
 * server sent the knight to the NPC, whose "... B" conversation completed the mission. Those
 * play the B conversation instead.
 */
export function missionConversation(data: GameData, action: any): NpcConversation | null {
  const ref = action?.conversation;
  if (!ref?.name) return null;
  const read = (r: any) => {
    const impl = data.resolveSync("config/conversation.dat", r, "conversation");
    return impl ? readConversation(impl, action.name ?? "") : null;
  };
  return read(ref) ?? (/ A$/.test(ref.name) ? read({ ...ref, name: ref.name.replace(/ A$/, " B") }) : null);
}

/**
 * A speaker's look where the action names no model (a gate conversation's NPC): the actor of
 * that name ("Morlin" is "Character/NPC/Laboratory/Morlin, Lab"), its sprite model and idle.
 * config/actor.dat must be loaded.
 */
export function speakerActor(data: GameData, name: string): { ref: any; idle: any } | null {
  if (!name) return null;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^Character/NPC/.*/${esc}(,|$)`);
  for (const key of data.library_("config/actor.dat").keys()) {
    if (!re.test(key)) continue;
    const a = data.resolveSync("config/actor.dat", { name: key }, "actor");
    if (a?.sprite?.model?.name) return { ref: a.sprite.model, idle: a.sprite.idles?.[0]?.animation ?? null };
  }
  return null;
}

/** "m.bazaar_tour_1a" is spoken by "n.bazaar_tour". */
export function speakerKey(message: string): string {
  const stem = message.replace(/^[a-z]\./, "").replace(/_\d+[a-z]?$/, "").replace(/_\d+$/, "");
  return "n." + stem;
}

/** "part 3b" -> { n: 3, letter: "b", rest: "" }; "part 1a adv" keeps "adv" as its series. */
function parseName(name: string): { n: number; letter: string; rest: string } | null {
  const m = /^part\s*(\d+)([a-z]?)\s*(.*)$/i.exec(name.trim());
  return m ? { n: Number(m[1]), letter: m[2].toLowerCase() || "a", rest: m[3].toLowerCase() } : null;
}

/**
 * The node a response leads to (an index into nodes), or -1 for the end of the conversation.
 * `from` is the node index and `came` the node that led here (for a return to a branch).
 */
export function nextNode(nodes: ConvNode[], from: number, response: number, came = -1): number {
  const node = nodes[from];
  // a kept jump goes where it says; where the conversation keeps its jumps, a response without
  // one ends it (Simple Images' node_end, whose response runs the end action)
  const jump = node?.responses[response]?.jump;
  if (jump !== undefined) return nodes.findIndex(n => n.name === jump);
  if (nodes.some(n => n.responses.some(r => r.jump !== undefined))) return -1;
  const count = node?.responses.length ?? 0;
  const p = parseName(node?.name ?? "");
  const find = (n: number, letter: string) => p ? nodes.findIndex(x => { const q = parseName(x.name); return !!q && q.n === n && q.letter === letter && q.rest === p.rest; }) : -1;
  if (p) {
    const branch = find(p.n + 1, String.fromCharCode(97 + response));
    if (branch >= 0 && (count > 1 || response === 0)) return branch;
    if (count <= 1) return find(p.n + 1, "a");
    if (response === count - 1) return -1;
    // a branch's sibling nodes: back to where the branch was taken
    const siblings = nodes.some((x, i) => i !== from && parseName(x.name)?.n === p.n && parseName(x.name)?.rest === p.rest);
    if (siblings && came >= 0) return came;
    const on = find(p.n + 1, "a");
    return on >= 0 ? on : -1;
  }
  // unnamed nodes: in order, the last of several responses ending it
  if (count > 1 && response === count - 1) return -1;
  return from + 1 < nodes.length ? from + 1 : -1;
}
