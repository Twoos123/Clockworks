import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { missionConversation, nextNode, readConversation, speakerActor, speakerKey } from "../src/game/conversation.ts";

const node = (name: string, message: string, responses: string[]) => ({ name, message, responses: responses.map(text => ({ $class: "SimpleResponse", text })) });

test("the speaker is named after the messages' stem unless the data names one", () => {
  assert.equal(speakerKey("m.hav_greeter_1a"), "n.hav_greeter");
  assert.equal(speakerKey("m.bazaar_tour_16b"), "n.bazaar_tour");
  assert.equal(speakerKey("m.core_lead_1"), "n.core_lead");
  const c = readConversation({ nodes: [node("part 1a", "m.hav_greeter_1a", ["r.hav_greeter_1a"])] })!;
  assert.equal(c.speaker, "n.hav_greeter");
  assert.equal(c.bundle, "conversation");
  assert.equal(readConversation({ speakerName: "n.x", bundle: "town", nodes: [node("a", "m.y_1", [])] })!.speaker, "n.x");
  assert.equal(readConversation({ nodes: [] }), null);
});

test("a single response goes on to the next part, or ends the conversation", () => {
  const nodes = readConversation({ nodes: [node("part 1a", "m.a_1a", ["r.1"]), node("part 2a", "m.a_2a", ["r.2"])] })!.nodes;
  assert.equal(nextNode(nodes, 0, 0), 1);
  assert.equal(nextNode(nodes, 1, 0), -1);
});

test("branches: responses lead to their lettered parts, the last of several ends, the rest return", () => {
  // Haven/Knight/Energy Info
  const nodes = readConversation({ nodes: [
    node("part 1a", "m.energy_info_1a", ["r.more", "r.no"]),
    node("part 2a", "m.energy_info_2a", ["r.what", "r.how", "r.get", "r.bye"]),
    node("part 3a", "m.energy_info_3a", ["r.another", "r.bye"]),
    node("part 3b", "m.energy_info_3b", ["r.another", "r.bye"]),
    node("part 3c", "m.energy_info_3c", ["r.another", "r.bye"]),
  ] })!.nodes;
  assert.equal(nextNode(nodes, 0, 0), 1);
  assert.equal(nextNode(nodes, 0, 1), -1);
  assert.deepEqual([0, 1, 2, 3].map(i => nextNode(nodes, 1, i)), [2, 3, 4, -1]);
  assert.equal(nextNode(nodes, 3, 0, 1), 1);
  assert.equal(nextNode(nodes, 3, 1, 1), -1);
});

test("a series keeps to its own nodes; unnamed nodes go in order", () => {
  const nodes = readConversation({ nodes: [
    node("part 1a", "m.x_1a", ["r"]), node("part 1a adv", "m.x_adv_1", ["r"]), node("part 2a adv", "m.x_adv_2", ["r"]), node("part 2a", "m.x_2a", ["r"]),
  ] })!.nodes;
  assert.equal(nextNode(nodes, 1, 0), 2);
  assert.equal(nextNode(nodes, 0, 0), 3);
  const plain = readConversation({ nodes: [node("hello", "m.q_1", ["r", "bye"]), node("there", "m.q_2", ["r"])] })!.nodes;
  assert.equal(nextNode(plain, 0, 0), 1);
  assert.equal(nextNode(plain, 0, 1), -1);
  assert.equal(nextNode(plain, 1, 0), -1);
});

test("a conversation that keeps its jumps (Mission/Base/Simple Images) follows them from its initial node", () => {
  // Mission/Rank/First Contact, resolved: node_end first, the base's unused nodes empty
  const jump = (text: string, node: string) => ({ $class: "SimpleResponse", text, action: { node } });
  const c = readConversation({ bundle: "mission", initialAction: { node: "node_1" }, nodes: [
    { name: "node_end", message: "m.first_contact_2a", responses: [{ $class: "SimpleResponse", text: "r.first_contact_2a", action: { $class: "ActionConfig$Compound" } }] },
    { name: "node_1", message: "m.first_contact_1a", userInterface: { name: "ui/conversation/interface_comlink.dat" }, responses: [jump("r.first_contact_1a", "node_end")] },
    { name: "node_2", message: "", responses: [jump("", "node_3")] },
  ] })!;
  assert.equal(c.nodes.length, 2);
  assert.equal(c.speaker, "n.first_contact");
  assert.equal(c.nodes[c.start].name, "node_1");
  assert.equal(c.nodes[c.start].userInterface.name, "ui/conversation/interface_comlink.dat");
  assert.equal(nextNode(c.nodes, c.start, 0), 0);
  // node_end's response runs the end action: the conversation is talked through
  assert.equal(nextNode(c.nodes, 0, 0), -1);
  // without an initial action it opens on the first node
  assert.equal(readConversation({ nodes: [node("part 1a", "m.a_1a", ["r"])] })!.start, 0);
});

const SK = process.env.SK_DIR ?? "C:/Program Files (x86)/Steam/steamapps/common/Spiral Knights";
const haveInstall = existsSync(join(SK, "rsrc", "config", "conversation.dat"));

test("on the install: every conversation mission plays a conversation that can be talked through", { skip: !haveInstall }, async () => {
  const { GameData } = await import("../src/game/data.ts");
  const { nodeLoader } = await import("../tools/audit/nodevfs.ts");
  const { parseMissions } = await import("../src/game/missions.ts");
  const data = new GameData(nodeLoader());
  await data.preload("config/mission.dat", "config/mission_property.dat", "config/conversation.dat", "config/actor.dat");
  const ms = parseMissions([...data.library_("config/mission.dat").values()], data.library_("config/mission_property.dat"))
    .filter(m => m.kind === "conversation" || m.kind === "gate-conversation");
  assert.ok(ms.length > 20);
  for (const m of ms) {
    const c = missionConversation(data, m.talk);
    assert.ok(c, `${m.id} has a conversation`);
    // walking first responses reaches the end within the nodes
    let at = c!.start, steps = 0;
    while (at >= 0 && steps++ < 40) at = nextNode(c!.nodes, at, 0);
    assert.equal(at, -1, `${m.id} ends`);
  }
  // First Contact: Kora's comlink call, two nodes on the comlink interface
  const fc = ms.find(m => m.id === "first_contact")!;
  assert.equal(fc.talk.model.name, "character/npc/crew/model_kora.dat");
  assert.equal(fc.talk.music.name, "Custom/Mission/Comlink");
  const c = missionConversation(data, fc.talk)!;
  assert.deepEqual([c.nodes[c.start].message, c.speaker], ["m.first_contact_1a", "n.first_contact"]);
  assert.equal(c.nodes[c.start].userInterface.name, "ui/conversation/interface_comlink.dat");
  const end = nextNode(c.nodes, c.start, 0);
  assert.equal(c.nodes[end].message, "m.first_contact_2a");
  assert.equal(nextNode(c.nodes, end, 0), -1);
  // a gate conversation's speaker is found by name
  assert.match(speakerActor(data, "Morlin")?.ref?.name ?? "", /model_morlin\.dat$/);
});
