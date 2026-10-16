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

  // ── Integration: settle back to resting ──────────────────────────────────

  describe("ExtensionAPI: settle", () => {
    test("agent_settled → resting title", async () => {
      const pi = makeMockApi();
      extensionFactory(pi);
      const ctx = makeCtx("s4", "settle-tab");
      await pi.fire("session_start", {}, ctx);
      await pi.fire("agent_start", {}, ctx);
      ctx.ui._calls.length = 0;
      await pi.fire("agent_settled", {}, ctx);
      assert.ok(ctx.ui._calls.length >= 1);
      assert.equal(ctx.ui._calls[0], "✓ settle-tab");
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
      const ctxB = makeCtx("sid-B", "tab-b");

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

  // ── Integration: correct title calls across full lifecycle ────────────────

  describe("ExtensionAPI: correct title calls full lifecycle", () => {
    test("titles in correct order across all transitions", async () => {
      const pi = makeMockApi();
      extensionFactory(pi);

      const ctx = makeCtx("sid-lifecycle", "my-session");
      await pi.fire("session_start", {}, ctx);    // ✓
      await pi.fire("agent_start", {}, ctx);      // ⏳
      await pi.fire("ui_prompt_start", {}, ctx);  // ❗
      await pi.fire("ui_prompt_end", {}, ctx);    // ⏳ (back to working)
      await pi.fire("agent_settled", {}, ctx);    // ✓

      // First 5 synchronous calls (reassert timers fire later; skip those)
      const [t0, t1, t2, t3, t4] = ctx.ui._calls;
      assert.equal(t0, "✓ my-session",  `session_start:    ${t0}`);
      assert.equal(t1, "⏳ my-session", `agent_start:      ${t1}`);
      assert.equal(t2, "❗ my-session", `ui_prompt_start:  ${t2}`);
      assert.equal(t3, "⏳ my-session", `ui_prompt_end:    ${t3}`);
      assert.equal(t4, "✓ my-session",  `agent_settled:    ${t4}`);
    });
  });
}
