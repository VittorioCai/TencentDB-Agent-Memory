import { describe, expect, it } from "vitest";
import { wrapAvailableSkillsBlock } from "../skill-injector.js";
import { renderSkillToolsBlock } from "../skill-tools-injector.js";
import { isWriteSubpath } from "../../../skill/skill-bridge.js";

/**
 * The 2026-09-06 instruction audit found three statements in one system
 * prompt that could not all be true: the `<skill_tools>` block said the
 * session was read-only, the `<available_skills>` header ordered the model to
 * patch and create skills, and the catalogue offered `skill_extract` — which
 * mints a skill — outside the write gate. These cases pin the rule that
 * replaces that: one switch, and the directive, the catalogue and the bridge
 * gate all read it.
 */

const LISTING = "<available_skills>\n- demo: a demo skill\n</available_skills>";
const BRIDGE = "http://127.0.0.1:8096";

describe("read-only session: the prompt does not order what the bridge refuses", () => {
  it("the mandatory-load header stops telling the model to patch or create", () => {
    const block = wrapAvailableSkillsBlock(LISTING, { allowLlmWrite: false });
    expect(block).not.toContain("skill_patch");
    expect(block).not.toContain("skill_create");
    expect(block).toContain("Skill writes are disabled in this session");
    // The load directive itself is unchanged: reading is still mandatory.
    expect(block).toContain("you MUST load it by calling the `skill_view`");
    expect(block).toContain(LISTING);
  });

  it("the default is read-only, matching the bridge's default", () => {
    expect(wrapAvailableSkillsBlock(LISTING)).toBe(wrapAvailableSkillsBlock(LISTING, { allowLlmWrite: false }));
  });

  it("the catalogue does not offer skill_extract", () => {
    const tools = renderSkillToolsBlock(BRIDGE, false, "sess", "space");
    expect(tools).not.toContain('<tool name="skill_extract">');
    expect(tools).toContain("仅开放只读操作");
    expect(tools).toContain('<tool name="skill_search">');
  });

  it("the bridge refuses extract like any other write", () => {
    expect(isWriteSubpath("extract")).toBe(true);
    for (const sub of ["create", "update", "patch", "delete", "files/write", "files/remove"]) {
      expect(isWriteSubpath(sub)).toBe(true);
    }
    for (const sub of ["search", "get", "get-by-name", "files/read", "listing"]) {
      expect(isWriteSubpath(sub)).toBe(false);
    }
  });
});

describe("writable session: the directive and the catalogue open together", () => {
  it("the header orders patch/create and the catalogue offers extract", () => {
    const block = wrapAvailableSkillsBlock(LISTING, { allowLlmWrite: true });
    expect(block).toContain("skill_patch");
    expect(block).toContain("skill_create");
    expect(block).not.toContain("Skill writes are disabled");

    const tools = renderSkillToolsBlock(BRIDGE, true, "sess", "space");
    expect(tools).toContain('<tool name="skill_extract">');
    expect(tools).toContain('<tool name="skill_create">');
    expect(tools).not.toContain("仅开放只读操作");
  });
});
