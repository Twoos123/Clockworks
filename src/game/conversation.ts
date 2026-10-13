// Conversations with townsfolk (ConversationConfig, config/conversation.dat): an NPC's
// Interaction handler runs ProjectXActionConfig.StartConversation with a conversation; each
// node has a message, the NPC's animation, an optional interface and the knight's responses,
// all message keys in the conversation's bundle ("conversation" by default).
//
// The server runs a conversation: the responses' ConversationJump actions (which node comes
// next) are stripped from the client data, as are the nodes' conditions. So the way through
// is inferred from the node names the designers used ("part 1a", "part 2a", "part 3b"...):
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

export interface ConvResponse { text: string }
export interface ConvNode {
  name: string;
  message: string;
  /** The NPC's animation for this node (a reference), if any. */
  animation: any;
  /** A different conversation interface (ui/conversation/interface_centeredimage.dat...). */
  userInterface: any;
  responses: ConvResponse[];
}
export interface Conversation { bundle: string; speaker: string; nodes: ConvNode[] }

/** Reads a resolved ConversationConfig implementation; the speaker's name key from the action, if set. */
export function readConversation(impl: any, actionName = ""): Conversation | null {
  const nodes: ConvNode[] = (impl?.nodes ?? []).filter((n: any) => n && typeof n.message === "string").map((n: any) => ({
    name: String(n.name ?? ""),
    message: n.message,
    animation: n.animation ?? null,
    userInterface: n.userInterface ?? null,
    responses: (n.responses ?? []).filter((r: any) => r && typeof r.text === "string").map((r: any) => ({ text: r.text })),
  }));
  if (!nodes.length) return null;
  const speaker = actionName || impl.speakerName || speakerKey(nodes[0].message);
  return { bundle: impl.bundle || "conversation", speaker, nodes };
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
