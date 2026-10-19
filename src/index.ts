/**
 * pi-status: live terminal/tab title with state indicator.
 * See README.md for title format, states, config, and multi-tab behavior.
 */

import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export const TITLE_MAX = 80;
export const REASSERT_DELAY_MS = 500;

export function envEnabled(name: string, def = true): boolean {
	const v = process.env[name]?.trim().toLowerCase();
	if (!v) return def;
	return v !== "0" && v !== "false" && v !== "no" && v !== "off";
}

export function oneLine(s: string): string {
	return s.replace(/[\x00-\x1f\x7f-\x9f]/g, " ").replace(/\s+/g, " ").trim();
}

export function truncate(s: string, max: number): string {
	const chars = Array.from(oneLine(s));
	if (chars.length <= max) return chars.join("");
	if (max < 2) return chars.slice(0, Math.max(0, max)).join("");
	return `${chars.slice(0, max - 1).join("").trimEnd()}…`;
}

export type State = "working" | "needs-you" | "resting";

// Per-tab state, keyed by session ID.
export interface TabState {
	state: State;
	promptOpen: boolean;
	cwd: string;
	sessionName: string | undefined;
	ctxRef: ExtensionContext | undefined;
	reassertTimer: ReturnType<typeof setTimeout> | undefined;
}

export function buildTitle(tab: Pick<TabState, "state" | "cwd" | "sessionName">): string {
	const stateGlyph = tab.state === "working" ? "⏳" : tab.state === "needs-you" ? "❗" : "✓";
	const label = tab.sessionName
		?? (envEnabled("PI_STATUS_TITLE_CWD")
			? truncate(path.basename(path.resolve(tab.cwd)) || tab.cwd, 24)
			: "");
	return truncate(`${stateGlyph}${label ? ` ${label}` : ""}`, TITLE_MAX);
}

export default function (pi: ExtensionAPI) {
	const tabs = new Map<string, TabState>();

	function getTab(ctx: ExtensionContext): TabState {
		const id = ctx.sessionManager.getSessionId();
		let tab = tabs.get(id);
		if (!tab) {
			tab = {
				state: "resting",
				promptOpen: false,
				cwd: process.cwd(),
				sessionName: undefined,
				ctxRef: undefined,
				reassertTimer: undefined,
			};
			tabs.set(id, tab);
		}
		return tab;
	}

	function remember(tab: TabState, ctx: ExtensionContext) {
		tab.ctxRef = ctx;
		if (ctx.cwd) tab.cwd = ctx.cwd;
		tab.sessionName = ctx.sessionManager.getSessionName()?.trim() || undefined;
	}

	function setTitle(tab: TabState, ctx?: ExtensionContext) {
		try {
			const target = ctx ?? tab.ctxRef;
			if (!target) return;
			const title = buildTitle(tab);
			// ctx.ui.setTitle is not in the published type declarations; accessed via cast.
			const ui = target.ui as { setTitle?: (t: string) => void } | undefined;
			if (typeof ui?.setTitle === "function") ui.setTitle(title);
		} catch { /* best-effort */ }
	}

	function reassert(tab: TabState) {
		if (tab.reassertTimer) return;
		tab.reassertTimer = setTimeout(() => {
			tab.reassertTimer = undefined;
			setTitle(tab);
		}, REASSERT_DELAY_MS);
		tab.reassertTimer.unref?.();
	}

	pi.on("session_start", async (_e, ctx) => {
		const tab = getTab(ctx);
		tab.state = "resting";
		tab.promptOpen = false;
		remember(tab, ctx);
		setTitle(tab, ctx); reassert(tab);
	});

	pi.on("session_info_changed", async (_e, ctx) => {
		const tab = getTab(ctx);
		remember(tab, ctx);
		setTitle(tab, ctx); reassert(tab);
	});

	pi.on("session_shutdown", async (_e, ctx) => {
		const id = ctx.sessionManager.getSessionId();
		const tab = tabs.get(id);
		if (tab?.reassertTimer) clearTimeout(tab.reassertTimer);
		tabs.delete(id);
	});

	pi.on("model_select", async (_e, ctx) => {
		const tab = getTab(ctx);
		remember(tab, ctx);
		setTitle(tab, ctx);
	});

	function deriveState(tab: TabState, ctx: ExtensionContext): State {
		if (tab.promptOpen) return "needs-you";
		return ctx.isIdle() ? "resting" : "working";
	}

	pi.on("agent_start", async (_e, ctx) => {
		const tab = getTab(ctx);
		// Prompt takes priority; only update state when no prompt is open.
		if (!tab.promptOpen) tab.state = "working";
		remember(tab, ctx); setTitle(tab, ctx);
	});

	pi.on("ui_prompt_start", async (_e, ctx) => {
		const tab = getTab(ctx);
		tab.promptOpen = true;
		tab.state = "needs-you";
		remember(tab, ctx); setTitle(tab, ctx);
	});

	pi.on("ui_prompt_end", async (_e, ctx) => {
		const tab = getTab(ctx);
		tab.promptOpen = false;
		tab.state = deriveState(tab, ctx);
		remember(tab, ctx); setTitle(tab, ctx);
	});

	pi.on("agent_settled", async (_e, ctx) => {
		const tab = getTab(ctx);
		// Do not override needs-you when a prompt is still open.
		if (!tab.promptOpen) tab.state = deriveState(tab, ctx);
		remember(tab, ctx); setTitle(tab, ctx);
	});
}
