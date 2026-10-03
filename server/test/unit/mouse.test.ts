import test, { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mouse, Point, Button } from "@nut-tree-fork/nut-js";
import {
  moveRelative,
  waitForMoveQueue,
  resetMoveQueue,
  scroll,
  click,
  dragStart,
  dragEnd,
} from "../../src/controllers/mouse.js";

describe("mouse — Move Queue Concurrency, Scroll Clamping & Input Mocking", () => {
  it("moveRelative — zero delta optimization bypasses OS calls", async (t) => {
    resetMoveQueue();
    let calls = 0;
    t.mock.method(mouse, "getPosition", async () => { calls++; return new Point(0, 0); });
    t.mock.method(mouse, "setPosition", async () => { calls++; });

    await moveRelative(0, 0);
    await waitForMoveQueue();
    assert.equal(calls, 0);
  });

  it("moveRelative — rounds fractional deltas correctly", async (t) => {
    resetMoveQueue();
    let current = { x: 100, y: 100 };
    t.mock.method(mouse, "getPosition", async () => new Point(current.x, current.y));
    t.mock.method(mouse, "setPosition", async (p: Point) => { current = { x: p.x, y: p.y }; });

    await moveRelative(1.4, 2.6); // rounded to 1, 3
    await waitForMoveQueue();
    assert.deepEqual(current, { x: 101, y: 103 });

    // Fractional delta rounding to 0,0 is a no-op
    const posBefore = { ...current };
    await moveRelative(0.2, -0.4); // rounded to 0, 0
    await waitForMoveQueue();
    assert.deepEqual(current, posBefore);
  });

  it("moveRelative — FIFO serialization accumulates deltas without lost updates", async (t) => {
    resetMoveQueue();
    let current = { x: 50, y: 50 };
    const recordedPositions: Array<{ x: number; y: number }> = [];

    t.mock.method(mouse, "getPosition", async () => new Point(current.x, current.y));
    t.mock.method(mouse, "setPosition", async (p: Point) => {
      // Simulate minor async microtask delay to expose race conditions if queue failed
      await new Promise((r) => setImmediate(r));
      current = { x: p.x, y: p.y };
      recordedPositions.push({ ...current });
    });

    const moves = [
      { dx: 10, dy: 10 },
      { dx: 5, dy: -5 },
      { dx: -20, dy: 15 },
      { dx: 8, dy: 2 },
      { dx: -3, dy: -7 },
    ];

    // Fire all moves concurrently without awaiting individual promises
    const promises = moves.map((m) => moveRelative(m.dx, m.dy));
    await Promise.all(promises);
    await waitForMoveQueue();

    assert.equal(recordedPositions.length, moves.length);
    assert.deepEqual(recordedPositions[0], { x: 60, y: 60 });
    assert.deepEqual(recordedPositions[1], { x: 65, y: 55 });
    assert.deepEqual(recordedPositions[2], { x: 45, y: 70 });
    assert.deepEqual(recordedPositions[3], { x: 53, y: 72 });
    assert.deepEqual(recordedPositions[4], { x: 50, y: 65 });
    assert.deepEqual(current, { x: 50, y: 65 });
  });

  it("moveRelative — queue self-heals after a failed task", async (t) => {
    resetMoveQueue();
    let current = { x: 0, y: 0 };
    let callCount = 0;

    t.mock.method(mouse, "getPosition", async () => new Point(current.x, current.y));
    t.mock.method(mouse, "setPosition", async (p: Point) => {
      callCount++;
      if (callCount === 1) {
        throw new Error("Display server transient error");
      }
      current = { x: p.x, y: p.y };
    });

    // Task 1 fails
    await assert.rejects(moveRelative(10, 10), /Display server transient error/);
    // Task 2 should still execute despite prior task error
    await moveRelative(20, 20);
    await waitForMoveQueue();

    assert.deepEqual(current, { x: 20, y: 20 });
  });

  it("scroll — clamps delta values within [-20, 20] range", async (t) => {
    const calls: Array<{ method: string; amount: number }> = [];
    t.mock.method(mouse, "scrollDown", async (n: number) => { calls.push({ method: "down", amount: n }); });
    t.mock.method(mouse, "scrollUp", async (n: number) => { calls.push({ method: "up", amount: n }); });
    t.mock.method(mouse, "scrollRight", async (n: number) => { calls.push({ method: "right", amount: n }); });
    t.mock.method(mouse, "scrollLeft", async (n: number) => { calls.push({ method: "left", amount: n }); });

    // Large values clamped to 20
    await scroll(0, 50);
    assert.deepEqual(calls.pop(), { method: "down", amount: 20 });

    await scroll(0, -100);
    assert.deepEqual(calls.pop(), { method: "up", amount: 20 });

    await scroll(30, 0);
    assert.deepEqual(calls.pop(), { method: "right", amount: 20 });

    await scroll(-50, 0);
    assert.deepEqual(calls.pop(), { method: "left", amount: 20 });

    // Zero scroll does not call any methods
    await scroll(0, 0);
    assert.equal(calls.length, 0);
  });

  it("click — maps button strings to nut.js Button enum values", async (t) => {
    const clickedButtons: Button[] = [];
    t.mock.method(mouse, "click", async (btn: Button) => { clickedButtons.push(btn); });

    await click("left");
    assert.equal(clickedButtons.pop(), Button.LEFT);

    await click("right");
    assert.equal(clickedButtons.pop(), Button.RIGHT);

    await click("middle");
    assert.equal(clickedButtons.pop(), Button.MIDDLE);
  });

  it("dragStart & dragEnd — calls pressButton and releaseButton", async (t) => {
    const buttonEvents: string[] = [];
    t.mock.method(mouse, "pressButton", async (btn: Button) => { buttonEvents.push(`press:${btn}`); });
    t.mock.method(mouse, "releaseButton", async (btn: Button) => { buttonEvents.push(`release:${btn}`); });

    await dragStart();
    assert.deepEqual(buttonEvents.pop(), `press:${Button.LEFT}`);

    await dragEnd();
    assert.deepEqual(buttonEvents.pop(), `release:${Button.LEFT}`);
  });
});
