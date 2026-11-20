// An adversarial regression test (design 6.3): the pass broke invariant safe-path-stays-inside of area
// core (kb/areas/core/invariants.json) with the arguments below. Once the fix is in, this test passes;
// then remove its todo mark. It stays unless a decision retires it.
//
// Found: the property gave false, not true
// hitld-adversary: {"area":"core","invariant":"safe-path-stays-inside","args":["./a:"],"message":"the property gave false, not true"}
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as subject from "./properties.mjs";

test("invariant safe-path-stays-inside: A path safePath accepts names a place inside the repository, and reads the same when given again.", { todo: "fix item pending: A path safePath accepts names a place inside the repository, and reads the same when given again." }, () => {
  const args = /** @type {[any]} */ (["./a:"]);
  assert.equal(subject.safePathStaysInside(...args), true);
});
