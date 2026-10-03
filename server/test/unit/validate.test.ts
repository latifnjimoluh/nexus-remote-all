import test, { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateCommand } from "../../src/validate.js";

describe("validateCommand — Input Schema Validation", () => {
  it("rejects non-object, null, array, and primitive values", () => {
    assert.equal(validateCommand(null), null);
    assert.equal(validateCommand(undefined), null);
    assert.equal(validateCommand("string"), null);
    assert.equal(validateCommand(12345), null);
    assert.equal(validateCommand(true), null);
    assert.equal(validateCommand([]), null);
    assert.equal(validateCommand([{ type: "mouse:move", dx: 0, dy: 0 }]), null);
  });

  it("prevents prototype pollution and strips unknown injected properties", () => {
    const raw = {
      type: "mouse:move",
      dx: 15,
      dy: -25,
      __proto__: { admin: true },
      injected: "malicious",
    };
    const res = validateCommand(raw);
    assert.deepEqual(res, { type: "mouse:move", dx: 15, dy: -25 });
    assert.equal(Object.hasOwn(res ?? {}, "injected"), false);
    assert.equal((res as any)?.admin, undefined);
  });

  it("mouse:move — validates valid deltas and boundary values", () => {
    assert.deepEqual(validateCommand({ type: "mouse:move", dx: 0, dy: 0 }), { type: "mouse:move", dx: 0, dy: 0 });
    assert.deepEqual(validateCommand({ type: "mouse:move", dx: 10000, dy: -10000 }), { type: "mouse:move", dx: 10000, dy: -10000 });
  });

  it("mouse:move — rejects out-of-bounds coordinates, NaN, Infinity, and invalid types", () => {
    assert.equal(validateCommand({ type: "mouse:move", dx: 10001, dy: 0 }), null);
    assert.equal(validateCommand({ type: "mouse:move", dx: 0, dy: -10001 }), null);
    assert.equal(validateCommand({ type: "mouse:move", dx: NaN, dy: 0 }), null);
    assert.equal(validateCommand({ type: "mouse:move", dx: 0, dy: Infinity }), null);
    assert.equal(validateCommand({ type: "mouse:move", dx: "10", dy: 0 }), null);
    assert.equal(validateCommand({ type: "mouse:move", dx: 10 }), null);
  });

  it("mouse:scroll — validates deltas and enforces boundaries", () => {
    assert.deepEqual(validateCommand({ type: "mouse:scroll", dx: 5, dy: -10 }), { type: "mouse:scroll", dx: 5, dy: -10 });
    assert.deepEqual(validateCommand({ type: "mouse:scroll", dx: 10000, dy: 10000 }), { type: "mouse:scroll", dx: 10000, dy: 10000 });
    assert.equal(validateCommand({ type: "mouse:scroll", dx: 10001, dy: 0 }), null);
    assert.equal(validateCommand({ type: "mouse:scroll", dx: "fast", dy: 0 }), null);
  });

  it("mouse:click — accepts only left, right, and middle buttons", () => {
    assert.deepEqual(validateCommand({ type: "mouse:click", button: "left" }), { type: "mouse:click", button: "left" });
    assert.deepEqual(validateCommand({ type: "mouse:click", button: "right" }), { type: "mouse:click", button: "right" });
    assert.deepEqual(validateCommand({ type: "mouse:click", button: "middle" }), { type: "mouse:click", button: "middle" });
    assert.equal(validateCommand({ type: "mouse:click", button: "double" }), null);
    assert.equal(validateCommand({ type: "mouse:click", button: "" }), null);
    assert.equal(validateCommand({ type: "mouse:click", button: 1 }), null);
  });

  it("mouse:drag — accepts only start and end states", () => {
    assert.deepEqual(validateCommand({ type: "mouse:drag", state: "start" }), { type: "mouse:drag", state: "start" });
    assert.deepEqual(validateCommand({ type: "mouse:drag", state: "end" }), { type: "mouse:drag", state: "end" });
    assert.equal(validateCommand({ type: "mouse:drag", state: "stop" }), null);
    assert.equal(validateCommand({ type: "mouse:drag" }), null);
  });

  it("key:tap — validates approved keys and rejects unlisted keys", () => {
    assert.deepEqual(validateCommand({ type: "key:tap", key: "Enter" }), { type: "key:tap", key: "Enter" });
    assert.deepEqual(validateCommand({ type: "key:tap", key: "Escape" }), { type: "key:tap", key: "Escape" });
    assert.deepEqual(validateCommand({ type: "key:tap", key: "F5" }), { type: "key:tap", key: "F5" });
    assert.deepEqual(validateCommand({ type: "key:tap", key: "LeftControl" }), { type: "key:tap", key: "LeftControl" });
    assert.equal(validateCommand({ type: "key:tap", key: "UnknownKey" }), null);
    assert.equal(validateCommand({ type: "key:tap", key: 42 }), null);
  });

  it("key:combo — enforces array length between 1 and 8 and valid key members", () => {
    assert.deepEqual(validateCommand({ type: "key:combo", keys: ["LeftControl", "C"] }), { type: "key:combo", keys: ["LeftControl", "C"] });
    assert.deepEqual(validateCommand({ type: "key:combo", keys: ["Escape"] }), { type: "key:combo", keys: ["Escape"] });
    assert.equal(validateCommand({ type: "key:combo", keys: [] }), null);
    const nineKeys = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];
    assert.equal(validateCommand({ type: "key:combo", keys: nineKeys }), null);
    assert.equal(validateCommand({ type: "key:combo", keys: ["LeftControl", "BadKey"] }), null);
    assert.equal(validateCommand({ type: "key:combo", keys: ["LeftControl", 123] }), null);
  });

  it("key:text — enforces string type and max 1000 characters length", () => {
    assert.deepEqual(validateCommand({ type: "key:text", text: "Hello Nexus" }), { type: "key:text", text: "Hello Nexus" });
    const maxText = "A".repeat(1000);
    assert.deepEqual(validateCommand({ type: "key:text", text: maxText }), { type: "key:text", text: maxText });
    assert.equal(validateCommand({ type: "key:text", text: "A".repeat(1001) }), null);
    assert.equal(validateCommand({ type: "key:text", text: 12345 }), null);
  });

  it("media:key — validates MEDIA_KEYS set and rejects arbitrary keys", () => {
    assert.deepEqual(validateCommand({ type: "media:key", key: "volup" }), { type: "media:key", key: "volup" });
    assert.deepEqual(validateCommand({ type: "media:key", key: "play" }), { type: "media:key", key: "play" });
    assert.deepEqual(validateCommand({ type: "media:key", key: "ok" }), { type: "media:key", key: "ok" });
    assert.equal(validateCommand({ type: "media:key", key: "power" }), null);
    assert.equal(validateCommand({ type: "media:key", key: "channel_up" }), null);
  });

  it("system:action — validates standard actions (lock, sleep, restart, shutdown)", () => {
    assert.deepEqual(validateCommand({ type: "system:action", action: "lock" }), { type: "system:action", action: "lock", mac: undefined });
    assert.deepEqual(validateCommand({ type: "system:action", action: "sleep" }), { type: "system:action", action: "sleep", mac: undefined });
    assert.equal(validateCommand({ type: "system:action", action: "format" }), null);
    assert.equal(validateCommand({ type: "system:action", action: "reboot" }), null);
  });

  it("system:action — validates Wake-on-LAN MAC address format", () => {
    assert.deepEqual(validateCommand({ type: "system:action", action: "wol", mac: "00:1A:2B:3C:4D:5E" }), {
      type: "system:action",
      action: "wol",
      mac: "00:1A:2B:3C:4D:5E",
    });
    assert.deepEqual(validateCommand({ type: "system:action", action: "wol", mac: "00-11-22-33-44-55" }), {
      type: "system:action",
      action: "wol",
      mac: "00-11-22-33-44-55",
    });
    assert.equal(validateCommand({ type: "system:action", action: "wol" }), null);
    assert.equal(validateCommand({ type: "system:action", action: "wol", mac: "invalid-mac" }), null);
    assert.equal(validateCommand({ type: "system:action", action: "wol", mac: "00:1A:2B:3C:4D" }), null);
  });

  it("launch:app — validates whitelisted application targets", () => {
    assert.deepEqual(validateCommand({ type: "launch:app", target: "chrome" }), { type: "launch:app", target: "chrome" });
    assert.deepEqual(validateCommand({ type: "launch:app", target: "notepad" }), { type: "launch:app", target: "notepad" });
    assert.equal(validateCommand({ type: "launch:app", target: "cmd" }), null);
    assert.equal(validateCommand({ type: "launch:app", target: "powershell" }), null);
    assert.equal(validateCommand({ type: "launch:app", target: "calc" }), null);
  });

  it("slide:* — validates all 5 presentation slide commands", () => {
    for (const cmd of ["slide:next", "slide:prev", "slide:start", "slide:end", "slide:black"] as const) {
      assert.deepEqual(validateCommand({ type: cmd, extra: "ignored" }), { type: cmd });
    }
  });

  it("tv:command — validates IP regex, actions, volume range, and app IDs", () => {
    assert.deepEqual(validateCommand({ type: "tv:command", targetIp: "192.168.1.50", action: "volup" }), {
      type: "tv:command",
      targetIp: "192.168.1.50",
      action: "volup",
      value: undefined,
    });
    assert.deepEqual(validateCommand({ type: "tv:command", targetIp: "192.168.1.50", action: "set_volume", value: 35 }), {
      type: "tv:command",
      targetIp: "192.168.1.50",
      action: "set_volume",
      value: 35,
    });
    assert.equal(validateCommand({ type: "tv:command", targetIp: "192.168.1.50", action: "set_volume", value: 101 }), null);
    assert.equal(validateCommand({ type: "tv:command", targetIp: "192.168.1.50", action: "set_volume", value: -1 }), null);
    assert.deepEqual(validateCommand({ type: "tv:command", targetIp: "192.168.1.50", action: "app", value: "netflix" }), {
      type: "tv:command",
      targetIp: "192.168.1.50",
      action: "app",
      value: "netflix",
    });
    assert.equal(validateCommand({ type: "tv:command", targetIp: "192.168.1.50", action: "app", value: "bad;rm -rf" }), null);
    assert.equal(validateCommand({ type: "tv:command", targetIp: "invalid-ip", action: "volup" }), null);
  });

  it("client:hello — strips control characters and trims strings", () => {
    assert.deepEqual(
      validateCommand({ type: "client:hello", name: "iPhone\x00\x1f 15", device: "Safari\x7f" }),
      { type: "client:hello", name: "iPhone 15", device: "Safari" },
    );
    assert.deepEqual(
      validateCommand({ type: "client:hello", name: "   ", device: 12345 }),
      { type: "client:hello", name: undefined, device: undefined },
    );
  });

  it("unknown command type — returns null", () => {
    assert.equal(validateCommand({ type: "arbitrary:unsupported" }), null);
    assert.equal(validateCommand({ type: "" }), null);
    assert.equal(validateCommand({}), null);
  });
});
