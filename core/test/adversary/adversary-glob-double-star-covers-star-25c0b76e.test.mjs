// An adversarial regression test (design 6.3): the pass broke invariant glob-double-star-covers-star of area
// core (kb/areas/core/invariants.json) with the arguments below. Once the fix is in, this test passes;
// then remove its todo mark. It stays unless a decision retires it.
//
// Found: the property gave false, not true
// hitld-adversary: {"area":"core","invariant":"glob-double-star-covers-star","args":["a","\r"],"message":"the property gave false, not true"}
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as subject from "./properties.mjs";

test("invariant glob-double-star-covers-star: Every path a dir/* glob matches, the dir/** glob matches too, whatever characters the file name holds.", { todo: "fix item pending: Every path a dir/* glob matches, the dir/** glob matches too, whatever characters the file name holds." }, () => {
  const args = /** @type {[any, any]} */ (["a","\r"]);
  assert.equal(subject.doubleStarCoversStar(...args), true);
});
