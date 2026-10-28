import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GLOW, setup, type Harness } from "./harness";

/**
 * The auth matrix. If the middleware is removed, every "401" below turns into a
 * success and this file goes red — which is the point of having it.
 */

let h: Harness;

beforeAll(async () => {
  h = await setup();
}, 120_000);

afterAll(async () => {
  await h?.close();
});

describe("machine auth on /api/tenants/*", () => {
  it("refuses a request with no key", async () => {
    const response = await h.app.request(`/api/tenants/${GLOW}`);
    expect(response.status).toBe(401);
  });

  it("refuses the wrong key", async () => {
    const response = await h.app.request(`/api/tenants/${GLOW}`, {
      headers: { "x-engine-key": "not-the-key" },
    });
    expect(response.status).toBe(401);
  });

  it("refuses a key that is only a prefix of the real one", async () => {
    const response = await h.app.request(`/api/tenants/${GLOW}`, {
      headers: { "x-engine-key": "integration-test-ke" },
    });
    expect(response.status).toBe(401);
  });

  it("allows the real key", async () => {
    const response = await h.app.request(`/api/tenants/${GLOW}`, {
      headers: { "x-engine-key": "integration-test-key" },
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { tenant: { slug: string } };
    expect(body.tenant.slug).toBe(GLOW);
  });

  it("guards writes too, not just reads", async () => {
    const response = await h.app.request(`/api/tenants/${GLOW}/bookings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(401);
  });

  it("guards the calendar and the inbox", async () => {
    for (const path of ["bookings", "conversations", "slots"]) {
      const response = await h.app.request(`/api/tenants/${GLOW}/${path}`);
      expect(response.status, path).toBe(401);
    }
  });
});

describe("public surfaces stay public", () => {
  it("serves the price list without a key", async () => {
    const response = await h.app.request(`/api/tenants/${GLOW}/services`);
    expect(response.status).toBe(200);
  });

  it("serves widget config without a key", async () => {
    const response = await h.app.request(`/api/tenants/${GLOW}/widget/config`);
    expect(response.status).toBe(200);
  });

  it("still answers 404 for an unknown business, not 401", async () => {
    const response = await h.app.request("/api/tenants/nobody/services");
    expect(response.status).toBe(404);
  });
});
