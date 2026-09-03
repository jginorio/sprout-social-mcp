import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractCustomerIds,
  parseRetryAfterMs,
} from "./sprout-http.js";

test("parseRetryAfterMs prefers Retry-After seconds and caps at 30s", () => {
  assert.equal(parseRetryAfterMs("2", 0), 2000);
  assert.equal(parseRetryAfterMs("120", 0), 30_000);
  assert.equal(parseRetryAfterMs(null, 0), 1000);
  assert.equal(parseRetryAfterMs(null, 3), 8000);
});

test("extractCustomerIds reads metadata/client payloads", () => {
  assert.deepEqual(
    extractCustomerIds({ data: [{ customer_id: 111, name: "Acme" }] }),
    [{ id: "111", name: "Acme" }]
  );
  assert.deepEqual(extractCustomerIds({ data: [] }), []);
  assert.deepEqual(extractCustomerIds({}), []);
});
