import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { countRows } from "@booking/db";
import { GLOW, book, firstSlot, getJson, postJson, setup, type Harness, type Slot } from "./harness";

/**
 * The booking surface: slots, hold, refuse, cancel, move, race.
 * Every one of these is a promise the engine makes to a customer.
 */

let h: Harness;

beforeAll(async () => {
  h = await setup();
}, 120_000);

afterAll(async () => {
  await h?.close();
});

describe("availability", () => {
  it("offers real slots with a named resource", async () => {
    const slot = await firstSlot(h.app, GLOW, "Trim");
    expect(slot.resourceId).toBeTruthy();
    expect(new Date(slot.startsAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("404s an unknown service rather than guessing", async () => {
    const slot = await firstSlot(h.app, GLOW, "Trim");
    const { status } = await getJson(
      h.app,
      `/api/tenants/${GLOW}/slots?date=${slot.date}&service=not-a-service`,
    );
    expect(status).toBe(404);
  });
});

describe("holding a slot", () => {
  it("books a slot and returns 201", async () => {
    const slot = await firstSlot(h.app, GLOW, "Trim");
    const { status, body } = await book(h.app, GLOW, slot);

    expect(status).toBe(201);
    expect(body.booking.id).toBeTruthy();
    expect(body.booking.serviceName).toBe("Trim");
  });

  it("removes the slot from availability once held", async () => {
    const slot = await firstSlot(h.app, GLOW, "Trim");
    expect((await book(h.app, GLOW, slot)).status).toBe(201);

    const { body } = await getJson(
      h.app,
      `/api/tenants/${GLOW}/slots?date=${slot.date}&service=Trim`,
    );

    const stillFree = (body.slots as Array<{ startsAt: string }>).some(
      (candidate) => candidate.startsAt === slot.startsAt,
    );
    expect(stillFree).toBe(false);
  });

  it("refuses the same slot twice with 409", async () => {
    const slot = await firstSlot(h.app, GLOW, "Trim");
    expect((await book(h.app, GLOW, slot)).status).toBe(201);
    expect((await book(h.app, GLOW, slot)).status).toBe(409);
  });

  it("refuses a made-up time outside opening hours", async () => {
    const slot = await firstSlot(h.app, GLOW, "Trim");
    const day = slot.startsAt.slice(0, 10);

    const { status } = await postJson(h.app, `/api/tenants/${GLOW}/bookings`, {
      serviceId: slot.serviceId,
      resourceId: slot.resourceId,
      startsAt: `${day}T02:00:00.000Z`,
      customerName: "Late Customer",
    });

    expect(status).toBe(422);
  });
});

describe("cancel", () => {
  it("frees the slot again and is idempotent", async () => {
    const slot = await firstSlot(h.app, GLOW, "Trim");
    const created = await book(h.app, GLOW, slot);
    const id = created.body.booking.id;

    const first = await postJson(h.app, `/api/tenants/${GLOW}/bookings/${id}/cancel`, {});
    expect(first.status).toBe(200);
    expect(first.body.booking.status).toBe("cancelled");
    expect(first.body.booking.alreadyCancelled).toBe(false);

    const second = await postJson(h.app, `/api/tenants/${GLOW}/bookings/${id}/cancel`, {});
    expect(second.status).toBe(200);
    expect(second.body.booking.alreadyCancelled).toBe(true);

    const { body } = await getJson(
      h.app,
      `/api/tenants/${GLOW}/slots?date=${slot.date}&service=Trim`,
    );
    const freeAgain = (body.slots as Array<{ startsAt: string }>).some(
      (candidate) => candidate.startsAt === slot.startsAt,
    );
    expect(freeAgain).toBe(true);
  });

  it("cannot cancel someone else's booking by id", async () => {
    const slot = await firstSlot(h.app, GLOW, "Trim");
    const { body } = await book(h.app, GLOW, slot);

    // A booking id that exists, asked for under the wrong tenant.
    const response = await postJson(
      h.app,
      `/api/tenants/fade-factory/bookings/${body.booking.id}/cancel`,
      {},
    );

    expect(response.status).toBe(404);
  });
});

describe("reschedule", () => {
  it("moves the same booking and keeps one row", async () => {
    const before = await countRows(h.db, "bookings");
    const slot = await firstSlot(h.app, GLOW, "Trim");
    const created = await book(h.app, GLOW, slot);
    const id = created.body.booking.id;

    const next = await firstSlot(h.app, GLOW, "Trim");
    const moved = await postJson(
      h.app,
      `/api/tenants/${GLOW}/bookings/${id}/reschedule`,
      { startsAt: next.startsAt },
    );

    expect(moved.status).toBe(200);
    expect(moved.body.booking.id).toBe(id);
    expect(moved.body.booking.startsAt).toBe(next.startsAt);
    expect(await countRows(h.db, "bookings")).toBe(before + 1);
  });

  it("refuses to move onto a taken slot", async () => {
    const taken = await firstSlot(h.app, GLOW, "Trim");
    expect((await book(h.app, GLOW, taken)).status).toBe(201);

    const other = await firstSlot(h.app, GLOW, "Trim");
    const created = await book(h.app, GLOW, other);

    const { status } = await postJson(
      h.app,
      `/api/tenants/${GLOW}/bookings/${created.body.booking.id}/reschedule`,
      { startsAt: taken.startsAt },
    );

    expect(status).toBe(409);
  });
});

describe("concurrency", () => {
  it("gives one slot to exactly one of eight writers, three times over", async () => {
    for (let round = 0; round < 3; round += 1) {
      const slot: Slot = await firstSlot(h.app, GLOW, "Trim");

      const before = await countRows(h.db, "bookings");
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, index) =>
          book(h.app, GLOW, slot, `Racer ${round}-${index}`),
        ),
      );

      const created = results.filter((result) => result.status === 201);
      const refused = results.filter((result) => result.status === 409);

      expect(created, `round ${round}`).toHaveLength(1);
      expect(refused, `round ${round}`).toHaveLength(7);
      expect(await countRows(h.db, "bookings"), `round ${round}`).toBe(before + 1);
    }
  }, 180_000);
});
