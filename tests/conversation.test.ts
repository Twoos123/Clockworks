import assert from "node:assert/strict";
import { test } from "node:test";
import { nextNode, readConversation, speakerKey } from "../src/game/conversation.ts";

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
