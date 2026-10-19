/**
 * Tests for pi-status.
 * Run with: node --experimental-strip-types --test src/index.test.mjs
 *
 * Pure helper tests import the real exports from src/index.ts via Node's
 * --experimental-strip-types loader (Node >=22.6). No duplicated logic.
 *
 * Integration tests mock the ExtensionAPI (pi.on / ui.setTitle) and drive
 * the full extension lifecycle.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dir, "index.ts");

// ── Load real exports ─────────────────────────────────────────────────────────
// Node 22.6+ with --experimental-strip-types can import .ts directly.
// Dynamic import gives us the real implementation with no logic duplication.

let mod;
let loadError;

try {
  mod = await import(`${SRC}?v=${Date.now()}`);
} catch (e) {
  loadError = e;
}

if (loadError) {
  // Emit one failing test so CI surfaces the problem clearly.
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

  // ── ExtensionAPI mock ────────────────────────────────────────────────────────

  function makeCtx(sessionId, sessionName = null, cwd = "/tmp/test", { idle = false } = {}) {
    let _idle = idle;
    const ctx = {
      sessionManager: {
        getSessionId: () => sessionId,
        getSessionName: () => sessionName,
      },
      cwd,
      isIdle: () => _idle,
      _setIdle: (v) => { _idle = v; },
      ui: {
        _calls: [],
        setTitle(t) { this._calls.push(t); },
      },
    };
    return ctx;
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

  // ── Constants ─────────────────────────────────────────────────────────────

  describe("constants (real source)", () => {
    test("TITLE_MAX is 80", () => assert.equal(TITLE_MAX, 80));
    test("REASSERT_DELAY_MS is 500", () => assert.equal(REASSERT_DELAY_MS, 500));
  });

  // ── truncate ──────────────────────────────────────────────────────────────

  describe("truncate (real source)", () => {
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

  // ── oneLine ───────────────────────────────────────────────────────────────

  describe("oneLine (real source)", () => {
    test("collapses whitespace", () => assert.equal(oneLine("a  b\tc"), "a b c"));
    test("removes newlines", () => assert.equal(oneLine("a\nb"), "a b"));
    test("trims edges", () => assert.equal(oneLine("  hello  "), "hello"));
  });

  // ── envEnabled ────────────────────────────────────────────────────────────

  describe("envEnabled (real source)", () => {
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

  // ── buildTitle ────────────────────────────────────────────────────────────

  describe("buildTitle: state glyphs (real source)", () => {
    const base = { cwd: "/tmp/test-project", sessionName: undefined };
    test("working → ⏳", () => assert.ok(buildTitle({ ...base, state: "working" }).startsWith("⏳")));
    test("needs-you → ❗", () => assert.ok(buildTitle({ ...base, state: "needs-you" }).startsWith("❗")));
    test("resting → ✓", () => assert.ok(buildTitle({ ...base, state: "resting" }).startsWith("✓")));
  });

  describe("buildTitle: session name (real source)", () => {
    test("uses sessionName when set", () =>
      assert.equal(buildTitle({ state: "working", cwd: "/tmp/foo", sessionName: "my-tab" }), "⏳ my-tab"));
    test("sessionName takes priority over cwd", () =>
      assert.equal(buildTitle({ state: "resting", cwd: "/tmp/project", sessionName: "custom" }), "✓ custom"));
    test("long sessionName truncated to TITLE_MAX", () => {
      const t = buildTitle({ state: "working", cwd: "/tmp", sessionName: "x".repeat(120) });
      assert.ok(Array.from(t).length <= TITLE_MAX);
      assert.ok(t.endsWith("…"));
    });
  });

  describe("buildTitle: cwd fallback (real source)", () => {
    const origEnv = process.env.PI_STATUS_TITLE_CWD;
    test("shows basename by default", () => {
      delete process.env.PI_STATUS_TITLE_CWD;
      assert.ok(
        buildTitle({ state: "resting", cwd: "/Users/demo/my-project", sessionName: undefined })
          .includes("my-project"),
      );
    });
    test("hides cwd when PI_STATUS_TITLE_CWD=0", () => {
      process.env.PI_STATUS_TITLE_CWD = "0";
      assert.equal(
        buildTitle({ state: "resting", cwd: "/Users/demo/my-project", sessionName: undefined }),
        "✓",
      );
      process.env.PI_STATUS_TITLE_CWD = origEnv ?? "";
    });
    test("hides cwd when PI_STATUS_TITLE_CWD=false", () => {
      process.env.PI_STATUS_TITLE_CWD = "false";
      assert.equal(
        buildTitle({ state: "working", cwd: "/Users/demo/my-project", sessionName: undefined }),
        "⏳",
      );
      process.env.PI_STATUS_TITLE_CWD = origEnv ?? "";
    });
  });

  // ── Integration: event registration ──────────────────────────────────────

  describe("ExtensionAPI: event handler registration", () => {
    test("registers all required handlers", () => {
      const pi = makeMockApi();
      extensionFactory(pi);
      for (const ev of [
        "session_start", "session_info_changed", "session_shutdown",
        "model_select", "agent_start", "ui_prompt_start", "ui_prompt_end", "agent_settled",
      ]) {
        assert.ok(pi._handlers[ev], `missing handler for "${ev}"`);
      }
    });
  });

  // ── Integration: initial / resting state ─────────────────────────────────

  describe("ExtensionAPI: initial/resting state", () => {
    test("session_start → resting title", async () => {
      const pi = makeMockApi();
      extensionFactory(pi);
      const ctx = makeCtx("s1", "my-tab");
      await pi.fire("session_start", {}, ctx);
      assert.ok(ctx.ui._calls.length >= 1);
      assert.equal(ctx.ui._calls[0], "✓ my-tab");
    });
  });

  // ── Integration: working state ────────────────────────────────────────────

  describe("ExtensionAPI: working state", () => {
    test("agent_start → working title", async () => {
      const pi = makeMockApi();
      extensionFactory(pi);
      const ctx = makeCtx("s2", "work-tab");
      await pi.fire("session_start", {}, ctx);
      ctx.ui._calls.length = 0;
      await pi.fire("agent_start", {}, ctx);
      assert.ok(ctx.ui._calls.length >= 1);
      assert.equal(ctx.ui._calls[0], "⏳ work-tab");
    });

    test("agent_start while prompt open → stays needs-you", async () => {
      const pi = makeMockApi();
      extensionFactory(pi);
      const ctx = makeCtx("s2b", "work-tab2");
      await pi.fire("session_start", {}, ctx);
      await pi.fire("ui_prompt_start", {}, ctx); // idle prompt
      ctx.ui._calls.length = 0;
      await pi.fire("agent_start", {}, ctx); // agent starts while prompt open
      assert.ok(ctx.ui._calls.length >= 1);
      assert.equal(ctx.ui._calls[0], "❗ work-tab2", `expected needs-you, got: ${ctx.ui._calls[0]}`);
    });
  });

  // ── Integration: needs-you state ─────────────────────────────────────────

  describe("ExtensionAPI: needs-you state", () => {
    test("ui_prompt_start → needs-you title", async () => {
      const pi = makeMockApi();
      extensionFactory(pi);
      const ctx = makeCtx("s3", "prompt-tab");
      await pi.fire("session_start", {}, ctx);
      ctx.ui._calls.length = 0;
      await pi.fire("ui_prompt_start", {}, ctx);
      assert.ok(ctx.ui._calls.length >= 1);
      assert.equal(ctx.ui._calls[0], "❗ prompt-tab");
    });
  });

  // ── Integration: settle ──────────────────────────────────────────────────

  describe("ExtensionAPI: settle", () => {
    test("agent_settled → resting title when idle", async () => {
      const pi = makeMockApi();
      extensionFactory(pi);
      const ctx = makeCtx("s4", "settle-tab", "/tmp", { idle: true });
      await pi.fire("session_start", {}, ctx);
      await pi.fire("agent_start", {}, ctx);
      ctx.ui._calls.length = 0;
      await pi.fire("agent_settled", {}, ctx);
      assert.ok(ctx.ui._calls.length >= 1);
      assert.equal(ctx.ui._calls[0], "✓ settle-tab");
    });

    test("agent_settled while prompt open → stays needs-you", async () => {
      const pi = makeMockApi();
      extensionFactory(pi);
      const ctx = makeCtx("s4b", "settle-tab2", "/tmp", { idle: false });
      await pi.fire("session_start", {}, ctx);
      await pi.fire("agent_start", {}, ctx);
      await pi.fire("ui_prompt_start", {}, ctx); // prompt opens mid-run
      ctx.ui._calls.length = 0;
      await pi.fire("agent_settled", {}, ctx); // main settles but prompt still open
      assert.ok(ctx.ui._calls.length >= 1);
      assert.equal(ctx.ui._calls[0], "❗ settle-tab2", `expected needs-you, got: ${ctx.ui._calls[0]}`);
    });

    test("agent_settled while prompt open, then prompt closes → resting (idle)", async () => {
      const pi = makeMockApi();
      extensionFactory(pi);
      const ctx = makeCtx("s4c", "settle-tab3", "/tmp", { idle: true });
      await pi.fire("session_start", {}, ctx);
      await pi.fire("agent_start", {}, ctx);
      await pi.fire("ui_prompt_start", {}, ctx);
      await pi.fire("agent_settled", {}, ctx); // settles while prompt open → needs-you
      ctx.ui._calls.length = 0;
      await pi.fire("ui_prompt_end", {}, ctx); // prompt closes → resting (idle)
      assert.equal(ctx.ui._calls[0], "✓ settle-tab3", `expected resting, got: ${ctx.ui._calls[0]}`);
    });
  });

  // ── Integration: session_info_changed updates name ────────────────────────

  describe("ExtensionAPI: session_info_changed", () => {
    test("name change reflected in title immediately", async () => {
      const pi = makeMockApi();
      extensionFactory(pi);
      const ctx = makeCtx("s5", null, "/tmp/my-project");
      await pi.fire("session_start", {}, ctx);
      assert.ok(ctx.ui._calls[0].includes("my-project"), `initial title: ${ctx.ui._calls[0]}`);

      ctx.sessionManager.getSessionName = () => "renamed-tab";
      ctx.ui._calls.length = 0;
      await pi.fire("session_info_changed", {}, ctx);
      assert.ok(ctx.ui._calls.length >= 1);
      assert.ok(
        ctx.ui._calls[0].includes("renamed-tab"),
        `expected renamed-tab, got: ${ctx.ui._calls[0]}`,
      );
    });
  });

  // ── Integration: two sessions stay isolated ───────────────────────────────

  describe("ExtensionAPI: two sessions isolated", () => {
    test("state changes in A do not affect B", async () => {
      const pi = makeMockApi();
      extensionFactory(pi);

      const ctxA = makeCtx("sid-A", "tab-a");
      const ctxB = makeCtx("sid-B", "tab-b", "/tmp", { idle: true });

      await pi.fire("session_start", {}, ctxA);
      await pi.fire("session_start", {}, ctxB);
      await pi.fire("agent_start", {}, ctxA);  // A → working

      ctxB.ui._calls.length = 0;
      await pi.fire("agent_settled", {}, ctxB); // B explicitly settles
      assert.equal(ctxB.ui._calls[0], "✓ tab-b");

      const lastA = ctxA.ui._calls[ctxA.ui._calls.length - 1];
      assert.equal(lastA, "⏳ tab-a");
    });
  });

  // ── Integration: session_shutdown cancels timer / deletes state ───────────

  describe("ExtensionAPI: session_shutdown", () => {
    test("cancels reassert timer; no delayed title update after shutdown", async () => {
      const pi = makeMockApi();
      extensionFactory(pi);

      const ctx = makeCtx("sid-shutdown", "dying-tab");
      await pi.fire("session_start", {}, ctx);
      await pi.fire("agent_start", {}, ctx);
      const callsBefore = ctx.ui._calls.length;

      await pi.fire("session_shutdown", {}, ctx);

      // Wait well past REASSERT_DELAY_MS
      await new Promise((res) => setTimeout(res, REASSERT_DELAY_MS + 100));

      assert.equal(
        ctx.ui._calls.length, callsBefore,
        `setTitle fired after shutdown (${ctx.ui._calls.length - callsBefore} unexpected)`,
      );
    });

    test("after shutdown, same sessionId starts fresh (resting)", async () => {
      const pi = makeMockApi();
      extensionFactory(pi);
      const ctx = makeCtx("sid-restart", "restart-tab");
      await pi.fire("session_start", {}, ctx);
      await pi.fire("agent_start", {}, ctx);
      await pi.fire("session_shutdown", {}, ctx);

      ctx.ui._calls.length = 0;
      await pi.fire("session_start", {}, ctx);
      assert.equal(ctx.ui._calls[0], "✓ restart-tab");
    });
  });

  // ── Integration: ui_prompt_end idle-awareness ───────────────────────────

  describe("ExtensionAPI: ui_prompt_end idle-awareness", () => {
    test("overlay end while idle → resting title", async () => {
      const pi = makeMockApi();
      extensionFactory(pi);
      const ctx = makeCtx("s-idle-end", "idle-tab", "/tmp", { idle: true });
      await pi.fire("session_start", {}, ctx);
      await pi.fire("ui_prompt_start", {}, ctx);  // overlay shown
      ctx.ui._calls.length = 0;
      await pi.fire("ui_prompt_end", {}, ctx);    // overlay dismissed while idle
      assert.ok(ctx.ui._calls.length >= 1);
      assert.equal(ctx.ui._calls[0], "✓ idle-tab", `expected resting, got: ${ctx.ui._calls[0]}`);
    });

    test("overlay end while main run active → working title", async () => {
      const pi = makeMockApi();
      extensionFactory(pi);
      const ctx = makeCtx("s-active-end", "active-tab", "/tmp", { idle: false });
      await pi.fire("session_start", {}, ctx);
      await pi.fire("agent_start", {}, ctx);
      await pi.fire("ui_prompt_start", {}, ctx);  // mid-run overlay
      ctx.ui._calls.length = 0;
      await pi.fire("ui_prompt_end", {}, ctx);    // overlay dismissed while run still active
      assert.ok(ctx.ui._calls.length >= 1);
      assert.equal(ctx.ui._calls[0], "⏳ active-tab", `expected working, got: ${ctx.ui._calls[0]}`);
    });

    test("ui_prompt_end then agent_settled both idle → resting", async () => {
      const pi = makeMockApi();
      extensionFactory(pi);
      const ctx = makeCtx("s-order-a", "order-a-tab", "/tmp", { idle: true });
      await pi.fire("session_start", {}, ctx);
      await pi.fire("ui_prompt_start", {}, ctx);
      ctx.ui._calls.length = 0;
      await pi.fire("ui_prompt_end", {}, ctx);
      assert.equal(ctx.ui._calls[0], "✓ order-a-tab", `after ui_prompt_end: ${ctx.ui._calls[0]}`);
      await pi.fire("agent_settled", {}, ctx);
      const last = ctx.ui._calls[ctx.ui._calls.length - 1];
      assert.equal(last, "✓ order-a-tab", `after agent_settled: ${last}`);
    });

    test("agent_settled then ui_prompt_end both idle → resting", async () => {
      const pi = makeMockApi();
      extensionFactory(pi);
      const ctx = makeCtx("s-order-b", "order-b-tab", "/tmp", { idle: true });
      await pi.fire("session_start", {}, ctx);
      await pi.fire("agent_start", {}, ctx);
      await pi.fire("ui_prompt_start", {}, ctx);
      ctx.ui._calls.length = 0;
      // agent_settled fires first — prompt still open → needs-you
      await pi.fire("agent_settled", {}, ctx);
      assert.equal(ctx.ui._calls[0], "❗ order-b-tab", `after agent_settled: ${ctx.ui._calls[0]}`);
      // ui_prompt_end fires after, session idle → resting
      ctx._setIdle(true);
      await pi.fire("ui_prompt_end", {}, ctx);
      const last = ctx.ui._calls[ctx.ui._calls.length - 1];
      assert.equal(last, "✓ order-b-tab", `after ui_prompt_end: ${last}`);
    });

    test("working: prompt opens, main settles while open → needs-you, then close → working", async () => {
      const pi = makeMockApi();
      extensionFactory(pi);
      // isIdle false: agent still considered active after settle event in this scenario
      // (pi coalesces but prompt is the blocking factor; isIdle stays false until run fully ends)
      const ctx = makeCtx("s-settle-then-close", "stc-tab", "/tmp", { idle: false });
      await pi.fire("session_start", {}, ctx);
      await pi.fire("agent_start", {}, ctx);       // ⏳
      await pi.fire("ui_prompt_start", {}, ctx);   // ❗
      ctx.ui._calls.length = 0;
      await pi.fire("agent_settled", {}, ctx);     // prompt still open → ❗
      assert.equal(ctx.ui._calls[0], "❗ stc-tab", `after agent_settled: ${ctx.ui._calls[0]}`);
      ctx.ui._calls.length = 0;
      await pi.fire("ui_prompt_end", {}, ctx);     // prompt closes, not idle → ⏳
      assert.equal(ctx.ui._calls[0], "⏳ stc-tab", `after prompt_end: ${ctx.ui._calls[0]}`);
    });

    test("prompt closes before main settles → working, then resting", async () => {
      const pi = makeMockApi();
      extensionFactory(pi);
      const ctx = makeCtx("s-prompt-first", "pf-tab", "/tmp", { idle: false });
      await pi.fire("session_start", {}, ctx);
      await pi.fire("agent_start", {}, ctx);       // ⏳
      await pi.fire("ui_prompt_start", {}, ctx);   // ❗
      ctx.ui._calls.length = 0;
      await pi.fire("ui_prompt_end", {}, ctx);     // prompt closes, run active → ⏳
      assert.equal(ctx.ui._calls[0], "⏳ pf-tab", `after prompt_end: ${ctx.ui._calls[0]}`);
      ctx.ui._calls.length = 0;
      ctx._setIdle(true);
      await pi.fire("agent_settled", {}, ctx);     // main settles → ✓
      assert.equal(ctx.ui._calls[0], "✓ pf-tab", `after agent_settled: ${ctx.ui._calls[0]}`);
    });

    test("idle prompt: open then close → resting", async () => {
      const pi = makeMockApi();
      extensionFactory(pi);
      const ctx = makeCtx("s-idle-prompt", "ip-tab", "/tmp", { idle: true });
      await pi.fire("session_start", {}, ctx);
      ctx.ui._calls.length = 0;
      await pi.fire("ui_prompt_start", {}, ctx);  // needs-you
      assert.equal(ctx.ui._calls[0], "❗ ip-tab");
      ctx.ui._calls.length = 0;
      await pi.fire("ui_prompt_end", {}, ctx);    // back to resting
      assert.equal(ctx.ui._calls[0], "✓ ip-tab");
    });

    test("prompt starts after agent settles → needs-you", async () => {
      const pi = makeMockApi();
      extensionFactory(pi);
      const ctx = makeCtx("s-post-settle", "ps-tab", "/tmp", { idle: true });
      await pi.fire("session_start", {}, ctx);
      await pi.fire("agent_start", {}, ctx);
      ctx._setIdle(true);
      await pi.fire("agent_settled", {}, ctx);    // ✓
      ctx.ui._calls.length = 0;
      await pi.fire("ui_prompt_start", {}, ctx);  // ❗ even after settle
      assert.equal(ctx.ui._calls[0], "❗ ps-tab");
    });

    test("duplicate ui_prompt_start does not produce impossible state", async () => {
      const pi = makeMockApi();
      extensionFactory(pi);
      const ctx = makeCtx("s-dup-start", "ds-tab", "/tmp", { idle: false });
      await pi.fire("session_start", {}, ctx);
      await pi.fire("agent_start", {}, ctx);
      await pi.fire("ui_prompt_start", {}, ctx);  // first start
      ctx.ui._calls.length = 0;
      await pi.fire("ui_prompt_start", {}, ctx);  // duplicate start (coalesced by pi)
      assert.equal(ctx.ui._calls[0], "❗ ds-tab"); // still needs-you, no invalid state
    });

    test("duplicate ui_prompt_end collapses to working without error", async () => {
      const pi = makeMockApi();
      extensionFactory(pi);
      const ctx = makeCtx("s-dup-end", "de-tab", "/tmp", { idle: false });
      await pi.fire("session_start", {}, ctx);
      await pi.fire("agent_start", {}, ctx);
      await pi.fire("ui_prompt_start", {}, ctx);
      await pi.fire("ui_prompt_end", {}, ctx);    // first end → working
      ctx.ui._calls.length = 0;
      await pi.fire("ui_prompt_end", {}, ctx);    // spurious second end
      assert.equal(ctx.ui._calls[0], "⏳ de-tab"); // working, not resting or invalid
    });
  });

  // ── Integration: correct title calls across full lifecycle ────────────────

  describe("ExtensionAPI: correct title calls full lifecycle", () => {
    test("titles in correct order across all transitions", async () => {
      const pi = makeMockApi();
      extensionFactory(pi);

      // isIdle starts false (agent running), set idle after settled
      const ctx = makeCtx("sid-lifecycle", "my-session", "/tmp", { idle: false });
      await pi.fire("session_start", {}, ctx);    // ✓
      await pi.fire("agent_start", {}, ctx);      // ⏳
      await pi.fire("ui_prompt_start", {}, ctx);  // ❗
      await pi.fire("ui_prompt_end", {}, ctx);    // ⏳ (run still active)
      ctx._setIdle(true);
      await pi.fire("agent_settled", {}, ctx);    // ✓

      const [t0, t1, t2, t3, t4] = ctx.ui._calls;
      assert.equal(t0, "✓ my-session",  `session_start:    ${t0}`);
      assert.equal(t1, "⏳ my-session", `agent_start:      ${t1}`);
      assert.equal(t2, "❗ my-session", `ui_prompt_start:  ${t2}`);
      assert.equal(t3, "⏳ my-session", `ui_prompt_end:    ${t3}`);
      assert.equal(t4, "✓ my-session",  `agent_settled:    ${t4}`);
    });
  });
}
