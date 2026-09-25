import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";
import { runBatch } from "../dist/commands/batch.js";

test("batch coordinator isolates line failures and continues in order", () => {
  const seen = [];
  const input = '  \n{"cmd":"first"}\nnot json\n{"cmd":"reject"}\n{"cmd":"last"}\n';
  const result = runBatch(input, (op) => {
    seen.push(op.cmd);
    if (op.cmd === "reject") throw new Error("rejected");
  });

  deepStrictEqual(seen, ["first", "reject", "last"]);
  deepStrictEqual(result.summary, { ok: false, succeeded: 2, failed: 2 });
  strictEqual(result.errors[0].line, "not json");
  deepStrictEqual(result.errors[1], { error: "rejected", line: '{"cmd":"reject"}' });
});
