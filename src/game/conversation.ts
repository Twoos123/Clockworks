// Conversations (config/conversation.dat): the nodes a mission briefing or an NPC talks through,
// read through their derivations with arguments applied. Each node's message and responses are
// message keys in the conversation's bundle; the walk follows each node's first response.

import { hasMessage, message } from "../i18n";
import type { GameData } from "./data";

export interface ConversationStep {
  /** The speaker's line, translated, the knight's name in its {0}. */
  message: string;
  /** The knight's replies (the first moves the conversation on). */
  responses: string[];
  /** The picture the node's interface shows (its "image" argument), if any. */
  image: string | null;
}

export interface Conversation { bundle: string; speaker: string | null; steps: ConversationStep[] }

const argsOf = (ref: any): Record<string, unknown> => Object.fromEntries((ref?.arguments?.entries ?? []) as [string, unknown][]);

/** Walks a resolved ConversationConfig.Original from its initial node. */
export function walkConversation(impl: any, knight: string): Conversation | null {
  const nodes = new Map<string, any>(((impl?.nodes ?? []) as any[]).filter(n => n?.name).map(n => [String(n.name), n]));
  if (!nodes.size) return null;
  const bundle = typeof impl.bundle === "string" && impl.bundle ? impl.bundle : "conversation";
  const say = (key: unknown) => typeof key === "string" && key && hasMessage(bundle, key) ? message(bundle, key, knight) : "";
  const steps: ConversationStep[] = [];
  const seen = new Set<string>();
  let at: string | undefined = impl.initialAction?.node;
  while (at && nodes.has(at) && !seen.has(at) && steps.length < 64) {
    seen.add(at);
    const node = nodes.get(at);
    const text = say(node.message);
    const responses = ((node.responses ?? []) as any[]).map(r => say(r?.text)).filter(Boolean);
    if (text) {
      const image = argsOf(node.userInterface).image;
      steps.push({ message: text, responses, image: typeof image === "string" ? image : null });
    }
    at = ((node.responses ?? []) as any[])[0]?.action?.node;
  }
  const speaker = say(impl.speakerName) || null;
  return steps.length ? { bundle, speaker, steps } : null;
}

/** A conversation by config name, or null when it (or its text) is missing. */
export async function loadConversation(data: GameData, name: string, knight: string): Promise<Conversation | null> {
  const impl = await data.resolve("config/conversation.dat", { name }, "conversation").catch(() => null);
  return impl ? walkConversation(impl, knight) : null;
}
