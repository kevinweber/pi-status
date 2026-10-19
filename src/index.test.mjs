import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dir, "index.ts");

let mod;
let loadError;

try {
  mod = await import(`${SRC}?v=${Date.now()}`);
} catch (e) {
  loadError = e;
}

if (loadError) {
  test("module load (required for all tests)", () => {
    throw new Error(
      "src/index.ts could not be loaded. Run the test suite with:\n" +
      "  node --experimental-strip-types --test src/index.test.mjs\n" +
      `Original error: ${loadError.message}`,
    );
  });
} else {
  const {
    TITLE_MAX,
    REASSERT_DELAY_MS,
    oneLine,
    truncate,
    envEnabled,
    buildTitle,
    default: extensionFactory,
  } = mod;


  function makeCtx(sessionId, sessionName = null, cwd = "/tmp/test") {
    return {
      sessionManager: {
        getSessionId: () => sessionId,
        getSessionName: () => sessionName,
      },
      cwd,
      ui: {
        _calls: [],
        setTitle(t) { this._calls.push(t); },
      },
    };
  }

  function makeMockApi() {
    const handlers = {};
    return {
      on(event, handler) { handlers[event] = handler; },
      _handlers: handlers,
      async fire(event, eventObj, ctx) {
        const h = handlers[event];
        if (!h) throw new Error(`No handler registered for "${event}"`);
        await h(eventObj, ctx);
      },
    };
  }


  describe("constants", () => {
    test("TITLE_MAX is 80", () => assert.equal(TITLE_MAX, 80));
    test("REASSERT_DELAY_MS is 500", () => assert.equal(REASSERT_DELAY_MS, 500));
  });

  describe("truncate", () => {
    test("short string unchanged", () => assert.equal(truncate("hello", 10), "hello"));
    test("exact length unchanged", () => assert.equal(truncate("abcde", 5), "abcde"));
    test("long string gets ellipsis and correct length", () => {
      const result = truncate("abcdefghij", 5);
      assert.equal(Array.from(result).length, 5);
      assert.ok(result.endsWith("…"));
    });
    test("max=0 returns empty string", () => assert.equal(truncate("hello", 0), ""));
    test("max=1 returns single char", () => assert.equal(truncate("hello", 1), "h"));
    test("strips control characters", () => {
      const result = truncate("a\x01b\x1fc", 10);
      assert.ok(!result.includes("\x01") && !result.includes("\x1f"));
    });
    test("emoji as single code point", () => {
      const result = truncate("⏳ abcdefghijklmnopqrstuvwxyz", 10);
      assert.ok(result.startsWith("⏳") && result.endsWith("…"));
    });
  });

  describe("oneLine", () => {
    test("collapses whitespace", () => assert.equal(oneLine("a  b\tc"), "a b c"));
    test("removes newlines", () => assert.equal(oneLine("a\nb"), "a b"));
    test("trims edges", () => assert.equal(oneLine("  hello  "), "hello"));
  });

  describe("envEnabled", () => {
    test("returns default true when env unset", () => {
      delete process.env._TEST_PI_STATUS_FLAG;
      assert.equal(envEnabled("_TEST_PI_STATUS_FLAG", true), true);
    });
    test("returns default false when env unset", () => {
      delete process.env._TEST_PI_STATUS_FLAG;
      assert.equal(envEnabled("_TEST_PI_STATUS_FLAG", false), false);
    });
    test("false for '0','false','no','off'", () => {
      for (const val of ["0", "false", "no", "off", "FALSE", "OFF"]) {
        process.env._TEST_PI_STATUS_FLAG = val;
        assert.equal(envEnabled("_TEST_PI_STATUS_FLAG"), false, `expected false for '${val}'`);
      }
      delete process.env._TEST_PI_STATUS_FLAG;
    });
    test("true for '1' and 'yes'", () => {
      process.env._TEST_PI_STATUS_FLAG = "1";
      assert.equal(envEnabled("_TEST_PI_STATUS_FLAG"), true);
      process.env._TEST_PI_STATUS_FLAG = "yes";
      assert.equal(envEnabled("_TEST_PI_STATUS_FLAG"), true);
      delete process.env._TEST_PI_STATUS_FLAG;
    });
  });

  describe("buildTitle: state glyphs", () => {
    const base = { cwd: "/tmp/test-project", sessionName: undefined };
    test("activity=working, no prompt → ⏳", () =>
      assert.ok(buildTitle({ ...base, activity: "working", promptOpen: false }).startsWith("⏳")));
    test("activity=resting, prompt open → ❗ (prompt wins)", () =>
      assert.ok(buildTitle({ ...base, activity: "resting", promptOpen: true }).startsWith("❗")));
    test("activity=working, prompt open → ❗ (prompt wins)", () =>
      assert.ok(buildTitle({ ...base, activity: "working", promptOpen: true }).startsWith("❗")));
    test("activity=resting, no prompt → ✓", () =>
      assert.ok(buildTitle({ ...base, activity: "resting", promptOpen: false }).startsWith("✓")));
  });

  describe("buildTitle: session name", () => {
    test("uses sessionName when set", () =>
      assert.equal(
        buildTitle({ activity: "working", promptOpen: false, cwd: "/tmp/foo", sessionName: "my-tab" }),
        "⏳ my-tab",
      ));
    test("sessionName takes priority over cwd", () =>
      assert.equal(
        buildTitle({ activity: "resting", promptOpen: false, cwd: "/tmp/project", sessionName: "custom" }),
        "✓ custom",
      ));
    test("long sessionName truncated to TITLE_MAX", () => {
      const t = buildTitle({ activity: "working", promptOpen: false, cwd: "/tmp", sessionName: "x".repeat(120) });
      assert.ok(Array.from(t).length <= TITLE_MAX);
      assert.ok(t.endsWith("…"));
    });
  });

  describe("buildTitle: cwd fallback", () => {
    const origEnv = process.env.PI_STATUS_TITLE_CWD;
    test("shows basename by default", () => {
      delete process.env.PI_STATUS_TITLE_CWD;
      assert.ok(
        buildTitle({ activity: "resting", promptOpen: false, cwd: "/Users/demo/my-project", sessionName: undefined })
          .includes("my-project"),
      );
    });
    test("hides cwd when PI_STATUS_TITLE_CWD=0", () => {
      process.env.PI_STATUS_TITLE_CWD = "0";
      assert.equal(
        buildTitle({ activity: "resting", promptOpen: false, cwd: "/Users/demo/my-project", sessionName: undefined }),
        "✓",
      );
      process.env.PI_STATUS_TITLE_CWD = origEnv ?? "";
    });
    test("hides cwd when PI_STATUS_TITLE_CWD=false", () => {
      process.env.PI_STATUS_TITLE_CWD = "false";
      assert.equal(
        buildTitle({ activity: "working", promptOpen: false, cwd: "/Users/demo/my-project", sessionName: undefined }),
        "⏳",
      );
      process.env.PI_STATUS_TITLE_CWD = origEnv ?? "";
    });
  });


  describe("handler registration", () => {
    test("registers all required handlers", () => {
      const pi = makeMockApi();
      extensionFactory(pi);
      for (const ev of [
        "session_start", "session_info_changed", "session_shutdown",
        "model_select", "agent_start", "ui_prompt_start", "ui_prompt_end", "agent_settled",
        "session_before_compact", "session_compact", "session_compact_failed",
      ]) {
        assert.ok(pi._handlers[ev], `missing handler for "${ev}"`);
      }
    });
  });

  describe("basic state transitions", () => {
    test("session_start → resting", async () => {
      const pi = makeMockApi(); extensionFactory(pi);
      const ctx = makeCtx("s1", "my-tab");
      await pi.fire("session_start", {}, ctx);
      assert.equal(ctx.ui._calls[0], "✓ my-tab");
    });

    test("agent_start → working", async () => {
      const pi = makeMockApi(); extensionFactory(pi);
      const ctx = makeCtx("s2", "tab");
      await pi.fire("session_start", {}, ctx);
      ctx.ui._calls.length = 0;
      await pi.fire("agent_start", {}, ctx);
      assert.equal(ctx.ui._calls[0], "⏳ tab");
    });

    test("agent_settled → resting", async () => {
      const pi = makeMockApi(); extensionFactory(pi);
      const ctx = makeCtx("s3", "tab");
      await pi.fire("session_start", {}, ctx);
      await pi.fire("agent_start", {}, ctx);
      ctx.ui._calls.length = 0;
      await pi.fire("agent_settled", {}, ctx);
      assert.equal(ctx.ui._calls[0], "✓ tab");
    });

    test("ui_prompt_start → needs-you", async () => {
      const pi = makeMockApi(); extensionFactory(pi);
      const ctx = makeCtx("s4", "tab");
      await pi.fire("session_start", {}, ctx);
      ctx.ui._calls.length = 0;
      await pi.fire("ui_prompt_start", {}, ctx);
      assert.equal(ctx.ui._calls[0], "❗ tab");
    });

    test("ui_prompt_end (after idle prompt) → resting", async () => {
      const pi = makeMockApi(); extensionFactory(pi);
      const ctx = makeCtx("s5", "tab");
      await pi.fire("session_start", {}, ctx);
      await pi.fire("ui_prompt_start", {}, ctx);
      ctx.ui._calls.length = 0;
      await pi.fire("ui_prompt_end", {}, ctx);
      assert.equal(ctx.ui._calls[0], "✓ tab");
    });

    test("full lifecycle: start → working → prompt → working → resting", async () => {
      const pi = makeMockApi(); extensionFactory(pi);
      const ctx = makeCtx("s6", "my-session");
      await pi.fire("session_start", {}, ctx);    // ✓
      await pi.fire("agent_start", {}, ctx);      // ⏳
      await pi.fire("ui_prompt_start", {}, ctx);  // ❗
      await pi.fire("ui_prompt_end", {}, ctx);    // ⏳ (activity=working)
      await pi.fire("agent_settled", {}, ctx);    // ✓
      const [t0, t1, t2, t3, t4] = ctx.ui._calls;
      assert.equal(t0, "✓ my-session");
      assert.equal(t1, "⏳ my-session");
      assert.equal(t2, "❗ my-session");
      assert.equal(t3, "⏳ my-session");
      assert.equal(t4, "✓ my-session");
    });
  });


  describe("prompt × activity interleavings", () => {
    // agent_start while prompt open: activity=working, display=needs-you
    test("agent_start during prompt → needs-you; prompt close → working", async () => {
      const pi = makeMockApi(); extensionFactory(pi);
      const ctx = makeCtx("ia1", "tab");
      await pi.fire("session_start", {}, ctx);
      await pi.fire("ui_prompt_start", {}, ctx);
      ctx.ui._calls.length = 0;
      await pi.fire("agent_start", {}, ctx);         // activity=working, prompt open → ❗
      assert.equal(ctx.ui._calls[0], "❗ tab");
      ctx.ui._calls.length = 0;
      await pi.fire("ui_prompt_end", {}, ctx);        // prompt closes → ⏳
      assert.equal(ctx.ui._calls[0], "⏳ tab");
    });

    // agent_settled while prompt open: activity=resting, display=needs-you
    test("agent_settled during prompt → needs-you; prompt close → resting", async () => {
      const pi = makeMockApi(); extensionFactory(pi);
      const ctx = makeCtx("ia2", "tab");
      await pi.fire("session_start", {}, ctx);
      await pi.fire("agent_start", {}, ctx);
      await pi.fire("ui_prompt_start", {}, ctx);
      ctx.ui._calls.length = 0;
      await pi.fire("agent_settled", {}, ctx);        // activity=resting, prompt open → ❗
      assert.equal(ctx.ui._calls[0], "❗ tab");
      ctx.ui._calls.length = 0;
      await pi.fire("ui_prompt_end", {}, ctx);        // prompt closes → ✓
      assert.equal(ctx.ui._calls[0], "✓ tab");
    });

    // prompt closes before agent_settled: working, then resting
    test("prompt close before agent_settled → working then resting", async () => {
      const pi = makeMockApi(); extensionFactory(pi);
      const ctx = makeCtx("ia3", "tab");
      await pi.fire("session_start", {}, ctx);
      await pi.fire("agent_start", {}, ctx);
      await pi.fire("ui_prompt_start", {}, ctx);
      ctx.ui._calls.length = 0;
      await pi.fire("ui_prompt_end", {}, ctx);        // activity=working → ⏳
      assert.equal(ctx.ui._calls[0], "⏳ tab");
      ctx.ui._calls.length = 0;
      await pi.fire("agent_settled", {}, ctx);        // → ✓
      assert.equal(ctx.ui._calls[0], "✓ tab");
    });

    // NEW: auto compact → prompt opens → agent_settled while prompt open → prompt close → resting
    test("auto compact → prompt → agent_settled while open → prompt close → resting", async () => {
      const pi = makeMockApi(); extensionFactory(pi);
      const ctx = makeCtx("ia4", "tab");
      await pi.fire("session_start", {}, ctx);
      await pi.fire("agent_start", {}, ctx);                                              // activity=working
      await pi.fire("session_compact", { reason: "threshold", willRetry: false }, ctx);  // activity=working
      await pi.fire("ui_prompt_start", {}, ctx);                                          // display=❗
      ctx.ui._calls.length = 0;
      await pi.fire("agent_settled", {}, ctx);   // activity=resting, prompt open → ❗
      assert.equal(ctx.ui._calls[0], "❗ tab", `after agent_settled: ${ctx.ui._calls[0]}`);
      ctx.ui._calls.length = 0;
      await pi.fire("ui_prompt_end", {}, ctx);   // prompt closes → activity=resting → ✓
      assert.equal(ctx.ui._calls[0], "✓ tab", `after prompt close: ${ctx.ui._calls[0]}`);
    });

    // NEW: compaction starts during prompt → working after close
    test("session_before_compact during prompt → needs-you; prompt close → working", async () => {
      const pi = makeMockApi(); extensionFactory(pi);
      const ctx = makeCtx("ia5", "tab");
      await pi.fire("session_start", {}, ctx);
      await pi.fire("ui_prompt_start", {}, ctx);
      ctx.ui._calls.length = 0;
      await pi.fire("session_before_compact", { reason: "threshold", willRetry: false }, ctx);
      assert.equal(ctx.ui._calls[0], "❗ tab");    // activity=working but prompt wins
      ctx.ui._calls.length = 0;
      await pi.fire("ui_prompt_end", {}, ctx);     // prompt closes → ⏳
      assert.equal(ctx.ui._calls[0], "⏳ tab", `after prompt close: ${ctx.ui._calls[0]}`);
    });

    // NEW: new agent_start during prompt → working after prompt closes (no stale state)
    test("new agent_start during prompt → working after prompt close", async () => {
      const pi = makeMockApi(); extensionFactory(pi);
      const ctx = makeCtx("ia6", "tab");
      await pi.fire("session_start", {}, ctx);
      await pi.fire("agent_settled", {}, ctx);    // ensure resting first
      await pi.fire("ui_prompt_start", {}, ctx);  // prompt opens (idle prompt)
      ctx.ui._calls.length = 0;
      await pi.fire("agent_start", {}, ctx);       // new run starts — activity=working
      assert.equal(ctx.ui._calls[0], "❗ tab");   // prompt still open → ❗
      ctx.ui._calls.length = 0;
      await pi.fire("ui_prompt_end", {}, ctx);     // prompt closes → ⏳
      assert.equal(ctx.ui._calls[0], "⏳ tab");
    });

    // Duplicate prompt_start is idempotent
    test("duplicate ui_prompt_start → still needs-you", async () => {
      const pi = makeMockApi(); extensionFactory(pi);
      const ctx = makeCtx("ia7", "tab");
      await pi.fire("session_start", {}, ctx);
      await pi.fire("agent_start", {}, ctx);
      await pi.fire("ui_prompt_start", {}, ctx);
      ctx.ui._calls.length = 0;
      await pi.fire("ui_prompt_start", {}, ctx);
      assert.equal(ctx.ui._calls[0], "❗ tab");
    });

    // Duplicate prompt_end falls through to activity (working)
    test("duplicate ui_prompt_end → working (activity unchanged)", async () => {
      const pi = makeMockApi(); extensionFactory(pi);
      const ctx = makeCtx("ia8", "tab");
      await pi.fire("session_start", {}, ctx);
      await pi.fire("agent_start", {}, ctx);
      await pi.fire("ui_prompt_start", {}, ctx);
      await pi.fire("ui_prompt_end", {}, ctx);    // first end → ⏳
      ctx.ui._calls.length = 0;
      await pi.fire("ui_prompt_end", {}, ctx);    // spurious second end → still ⏳
      assert.equal(ctx.ui._calls[0], "⏳ tab");
    });
  });


  describe("session_info_changed", () => {
    test("name change reflected in title immediately", async () => {
      const pi = makeMockApi(); extensionFactory(pi);
      const ctx = makeCtx("sinf1", null, "/tmp/my-project");
      await pi.fire("session_start", {}, ctx);
      assert.ok(ctx.ui._calls[0].includes("my-project"));

      ctx.sessionManager.getSessionName = () => "renamed-tab";
      ctx.ui._calls.length = 0;
      await pi.fire("session_info_changed", {}, ctx);
      assert.ok(ctx.ui._calls[0].includes("renamed-tab"), `got: ${ctx.ui._calls[0]}`);
    });
  });


  describe("session isolation", () => {
    test("state changes in A do not affect B", async () => {
      const pi = makeMockApi(); extensionFactory(pi);
      const ctxA = makeCtx("sid-A", "tab-a");
      const ctxB = makeCtx("sid-B", "tab-b");
      await pi.fire("session_start", {}, ctxA);
      await pi.fire("session_start", {}, ctxB);
      await pi.fire("agent_start", {}, ctxA);
      ctxB.ui._calls.length = 0;
      await pi.fire("agent_settled", {}, ctxB);
      assert.equal(ctxB.ui._calls[0], "✓ tab-b");
      const lastA = ctxA.ui._calls[ctxA.ui._calls.length - 1];
      assert.equal(lastA, "⏳ tab-a");
    });
  });


  describe("session_shutdown", () => {
    test("cancels reassert timer; no delayed title update after shutdown", async () => {
      const pi = makeMockApi(); extensionFactory(pi);
      const ctx = makeCtx("sd1", "dying-tab");
      await pi.fire("session_start", {}, ctx);
      await pi.fire("agent_start", {}, ctx);
      const callsBefore = ctx.ui._calls.length;
      await pi.fire("session_shutdown", {}, ctx);
      await new Promise((res) => setTimeout(res, REASSERT_DELAY_MS + 100));
      assert.equal(ctx.ui._calls.length, callsBefore,
        `setTitle fired after shutdown (${ctx.ui._calls.length - callsBefore} unexpected)`);
    });

    test("after shutdown, same sessionId starts fresh (resting)", async () => {
      const pi = makeMockApi(); extensionFactory(pi);
      const ctx = makeCtx("sd2", "restart-tab");
      await pi.fire("session_start", {}, ctx);
      await pi.fire("agent_start", {}, ctx);
      await pi.fire("session_shutdown", {}, ctx);
      ctx.ui._calls.length = 0;
      await pi.fire("session_start", {}, ctx);
      assert.equal(ctx.ui._calls[0], "✓ restart-tab");
    });
  });


  describe("compaction: session_before_compact", () => {
    test("no prompt → working", async () => {
      const pi = makeMockApi(); extensionFactory(pi);
      const ctx = makeCtx("cb1", "tab");
      await pi.fire("session_start", {}, ctx);
      ctx.ui._calls.length = 0;
      await pi.fire("session_before_compact", { reason: "threshold", willRetry: false }, ctx);
      assert.equal(ctx.ui._calls[0], "⏳ tab");
    });

    test("prompt open → needs-you (activity=working underneath)", async () => {
      const pi = makeMockApi(); extensionFactory(pi);
      const ctx = makeCtx("cb2", "tab");
      await pi.fire("session_start", {}, ctx);
      await pi.fire("ui_prompt_start", {}, ctx);
      ctx.ui._calls.length = 0;
      await pi.fire("session_before_compact", { reason: "manual", willRetry: false }, ctx);
      assert.equal(ctx.ui._calls[0], "❗ tab");
    });
  });

  describe("compaction: session_compact", () => {
    test("manual + willRetry=false, no prompt → resting", async () => {
      const pi = makeMockApi(); extensionFactory(pi);
      const ctx = makeCtx("sc1", "tab");
      await pi.fire("session_start", {}, ctx);
      ctx.ui._calls.length = 0;
      await pi.fire("session_compact", { reason: "manual", willRetry: false }, ctx);
      assert.equal(ctx.ui._calls[0], "✓ tab");
    });

    test("manual + willRetry=true, no prompt → working", async () => {
      const pi = makeMockApi(); extensionFactory(pi);
      const ctx = makeCtx("sc2", "tab");
      await pi.fire("session_start", {}, ctx);
      ctx.ui._calls.length = 0;
      await pi.fire("session_compact", { reason: "manual", willRetry: true }, ctx);
      assert.equal(ctx.ui._calls[0], "⏳ tab");
    });

    test("threshold + willRetry=false, no prompt → working", async () => {
      const pi = makeMockApi(); extensionFactory(pi);
      const ctx = makeCtx("sc3", "tab");
      await pi.fire("session_start", {}, ctx);
      ctx.ui._calls.length = 0;
      await pi.fire("session_compact", { reason: "threshold", willRetry: false }, ctx);
      assert.equal(ctx.ui._calls[0], "⏳ tab");
    });

    test("overflow + willRetry=true, no prompt → working", async () => {
      const pi = makeMockApi(); extensionFactory(pi);
      const ctx = makeCtx("sc4", "tab");
      await pi.fire("session_start", {}, ctx);
      ctx.ui._calls.length = 0;
      await pi.fire("session_compact", { reason: "overflow", willRetry: true }, ctx);
      assert.equal(ctx.ui._calls[0], "⏳ tab");
    });

    test("threshold compact while prompt open → needs-you; close → working", async () => {
      const pi = makeMockApi(); extensionFactory(pi);
      const ctx = makeCtx("sc5", "tab");
      await pi.fire("session_start", {}, ctx);
      await pi.fire("agent_start", {}, ctx);
      await pi.fire("ui_prompt_start", {}, ctx);
      ctx.ui._calls.length = 0;
      await pi.fire("session_compact", { reason: "threshold", willRetry: false }, ctx);
      assert.equal(ctx.ui._calls[0], "❗ tab");
      ctx.ui._calls.length = 0;
      await pi.fire("ui_prompt_end", {}, ctx);
      assert.equal(ctx.ui._calls[0], "⏳ tab");
    });

    test("manual compact while prompt open → needs-you; close → resting", async () => {
      const pi = makeMockApi(); extensionFactory(pi);
      const ctx = makeCtx("sc6", "tab");
      await pi.fire("session_start", {}, ctx);
      await pi.fire("ui_prompt_start", {}, ctx);
      ctx.ui._calls.length = 0;
      await pi.fire("session_compact", { reason: "manual", willRetry: false }, ctx);
      assert.equal(ctx.ui._calls[0], "❗ tab");
      ctx.ui._calls.length = 0;
      await pi.fire("ui_prompt_end", {}, ctx);
      assert.equal(ctx.ui._calls[0], "✓ tab");
    });

    test("threshold compact → agent_settled → resting", async () => {
      const pi = makeMockApi(); extensionFactory(pi);
      const ctx = makeCtx("sc7", "tab");
      await pi.fire("session_start", {}, ctx);
      await pi.fire("agent_start", {}, ctx);
      await pi.fire("session_compact", { reason: "threshold", willRetry: false }, ctx);
      assert.equal(ctx.ui._calls.at(-1), "⏳ tab");
      ctx.ui._calls.length = 0;
      await pi.fire("agent_settled", {}, ctx);
      assert.equal(ctx.ui._calls[0], "✓ tab");
    });

    // CRITICAL: auto compact while prompt, agent settles while prompt still open → resting after close
    test("auto compact while prompt open, agent settles before close → resting after close", async () => {
      const pi = makeMockApi(); extensionFactory(pi);
      const ctx = makeCtx("sc8", "tab");
      await pi.fire("session_start", {}, ctx);
      await pi.fire("agent_start", {}, ctx);
      await pi.fire("ui_prompt_start", {}, ctx);
      await pi.fire("session_compact", { reason: "threshold", willRetry: false }, ctx); // activity=working, display=❗
      assert.equal(ctx.ui._calls.at(-1), "❗ tab");
      await pi.fire("agent_settled", {}, ctx);    // activity=resting, prompt still open → ❗
      assert.equal(ctx.ui._calls.at(-1), "❗ tab", `after agent_settled: ${ctx.ui._calls.at(-1)}`);
      ctx.ui._calls.length = 0;
      await pi.fire("ui_prompt_end", {}, ctx);    // activity=resting, no prompt → ✓
      assert.equal(ctx.ui._calls[0], "✓ tab", `after prompt close: ${ctx.ui._calls[0]}`);
    });
  });

  describe("compaction: session_compact_failed", () => {
    test("manual + willRetry=false → resting", async () => {
      const pi = makeMockApi(); extensionFactory(pi);
      const ctx = makeCtx("sf1", "tab");
      await pi.fire("session_start", {}, ctx);
      ctx.ui._calls.length = 0;
      await pi.fire("session_compact_failed",
        { reason: "manual", willRetry: false, aborted: false, fromExtension: false }, ctx);
      assert.equal(ctx.ui._calls[0], "✓ tab");
    });

    test("manual + willRetry=true → working", async () => {
      const pi = makeMockApi(); extensionFactory(pi);
      const ctx = makeCtx("sf2", "tab");
      await pi.fire("session_start", {}, ctx);
      ctx.ui._calls.length = 0;
      await pi.fire("session_compact_failed",
        { reason: "manual", willRetry: true, aborted: true, fromExtension: false }, ctx);
      assert.equal(ctx.ui._calls[0], "⏳ tab");
    });

    test("threshold fail → working", async () => {
      const pi = makeMockApi(); extensionFactory(pi);
      const ctx = makeCtx("sf3", "tab");
      await pi.fire("session_start", {}, ctx);
      ctx.ui._calls.length = 0;
      await pi.fire("session_compact_failed",
        { reason: "threshold", willRetry: false, aborted: false, fromExtension: false }, ctx);
      assert.equal(ctx.ui._calls[0], "⏳ tab");
    });

    test("overflow fail while prompt open → needs-you; close → working", async () => {
      const pi = makeMockApi(); extensionFactory(pi);
      const ctx = makeCtx("sf4", "tab");
      await pi.fire("session_start", {}, ctx);
      await pi.fire("ui_prompt_start", {}, ctx);
      ctx.ui._calls.length = 0;
      await pi.fire("session_compact_failed",
        { reason: "overflow", willRetry: true, aborted: false, fromExtension: false }, ctx);
      assert.equal(ctx.ui._calls[0], "❗ tab");
      ctx.ui._calls.length = 0;
      await pi.fire("ui_prompt_end", {}, ctx);
      assert.equal(ctx.ui._calls[0], "⏳ tab");
    });
  });
}
