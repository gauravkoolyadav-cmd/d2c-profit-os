import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/brands/[id]/pixel-events/route";
import { trackPixelEvent } from "@/lib/attribution/tracking";
import { BRAND_A, BRAND_B, BRAND_MISSING } from "../helpers/world";

const VALID = { eventType: "PageView", sessionId: "sess-1", pageUrl: "https://shop.test/p/1" };

function send(brandId: string, body: unknown) {
  const request = new NextRequest(`http://localhost/api/brands/${brandId}/pixel-events`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  return POST(request, { params: Promise.resolve({ id: brandId }) });
}

describe("POST /api/brands/[id]/pixel-events (public endpoint)", () => {
  it("records the event for the brand in the URL", async () => {
    const response = await send(BRAND_A, VALID);
    expect(response.status).toBe(200);
    expect(trackPixelEvent).toHaveBeenCalledWith(expect.objectContaining({ brandId: BRAND_A }));
  });

  it("REGRESSION: a body brandId cannot redirect the event to another brand", async () => {
    const response = await send(BRAND_A, { ...VALID, brandId: BRAND_B });
    expect(response.status).toBe(400);
    expect(trackPixelEvent).not.toHaveBeenCalled();
  });

  it("accepts a body brandId only when it matches the URL", async () => {
    const response = await send(BRAND_A, { ...VALID, brandId: BRAND_A });
    expect(response.status).toBe(200);
    expect(trackPixelEvent).toHaveBeenCalledWith(expect.objectContaining({ brandId: BRAND_A }));
  });

  it("rejects unknown and malformed brands with 404", async () => {
    expect((await send(BRAND_MISSING, VALID)).status).toBe(404);
    expect((await send("not-a-uuid", VALID)).status).toBe(404);
    expect(trackPixelEvent).not.toHaveBeenCalled();
  });

  it.each([
    ["missing eventType", { sessionId: "s", pageUrl: "https://x" }],
    ["oversized pageUrl", { ...VALID, pageUrl: "https://x/" + "a".repeat(3000) }],
    ["non-numeric value", { ...VALID, eventData: { value: "100" } }],
    ["invalid JSON", "{not json"],
  ])("rejects %s with 400", async (_label, body) => {
    expect((await send(BRAND_A, body)).status).toBe(400);
    expect(trackPixelEvent).not.toHaveBeenCalled();
  });
});
