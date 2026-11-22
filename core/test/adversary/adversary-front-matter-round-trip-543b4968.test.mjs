// An adversarial regression test (design 6.3): the pass broke invariant front-matter-round-trip of area
// core (kb/areas/core/invariants.json) with the arguments below. Once the fix is in, this test passes;
// then remove its todo mark. It stays unless a decision retires it.
//
// Found: the property gave false, not true
// hitld-adversary: {"area":"core","invariant":"front-matter-round-trip","args":["a",["\"","a"]],"message":"the property gave false, not true","todo":"fix item pending: Front matter written by renderItem reads back as the same title and needs with parseItem."}
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as subject from "./properties.mjs";

test("invariant front-matter-round-trip: Front matter written by renderItem reads back as the same title and needs with parseItem.", { todo: "fix item pending: Front matter written by renderItem reads back as the same title and needs with parseItem." }, () => {
  const args = /** @type {[any, any]} */ (["a",["\"","a"]]);
  assert.equal(subject.frontMatterRoundTrip(...args), true);
});
