import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "crypto";
import { NextRequest } from "next/server";
import { POST as polarWebhook } from "@/app/api/billing/webhook/route";
import { POST as telegramWebhook } from "@/app/api/telegram/webhook/route";
import { verifyPolarWebhook } from "@/lib/payments/polar";
import { sendMessage } from "@/lib/telegram/client";
import { safeCompare } from "@/lib/utils/timing-safe";
import { dbCalls } from "../helpers/fake-db";

const POLAR_SECRET = "polar_test_secret";
const TELEGRAM_SECRET = "telegram_test_secret";

beforeEach(() => {
  vi.unstubAllEnvs();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("safeCompare", () => {
  it("compares equal strings as equal and never throws on length mismatch", () => {
    expect(safeCompare("abc", "abc")).toBe(true);
    expect(safeCompare("abc", "abd")).toBe(false);
    expect(safeCompare("abc", "abcd")).toBe(false);
    expect(safeCompare("", "")).toBe(true);
    expect(safeCompare(null, "a")).toBe(false);
    expect(safeCompare("a", undefined)).toBe(false);
  });
});

describe("Polar billing webhook", () => {
  const payload = JSON.stringify({ type: "unhandled.event", data: { id: "evt_1" }, timestamp: "now" });
  const sign = (body: string, secret = POLAR_SECRET) =>
    createHmac("sha256", secret).update(body).digest("hex");

  function post(body: string, signature?: string) {
    return polarWebhook(
      new Request("http://localhost/api/billing/webhook", {
        method: "POST",
        body,
        headers: signature ? { "x-polar-signature": signature } : {},
      })
    );
  }

  it("REGRESSION: fails closed (503) when POLAR_WEBHOOK_SECRET is not configured", async () => {
    vi.stubEnv("POLAR_WEBHOOK_SECRET", "");
    const response = await post(payload, sign(payload));
    expect(response.status).toBe(503);
    expect(dbCalls).toHaveLength(0);
  });

  it("rejects a missing signature", async () => {
    vi.stubEnv("POLAR_WEBHOOK_SECRET", POLAR_SECRET);
    expect((await post(payload)).status).toBe(401);
    expect(dbCalls).toHaveLength(0);
  });

  it("rejects a wrong or truncated signature without throwing", async () => {
    vi.stubEnv("POLAR_WEBHOOK_SECRET", POLAR_SECRET);
    expect((await post(payload, sign(payload, "other_secret"))).status).toBe(401);
    expect((await post(payload, sign(payload).slice(0, 10))).status).toBe(401);
    expect(dbCalls).toHaveLength(0);
  });

  it("rejects a valid signature for a different body", async () => {
    vi.stubEnv("POLAR_WEBHOOK_SECRET", POLAR_SECRET);
    expect((await post(payload + " ", sign(payload))).status).toBe(401);
  });

  it("accepts a correctly signed payload", async () => {
    vi.stubEnv("POLAR_WEBHOOK_SECRET", POLAR_SECRET);
    const response = await post(payload, sign(payload));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
  });

  it("verifyPolarWebhook returns false for empty secret or signature", () => {
    expect(verifyPolarWebhook(payload, sign(payload), "")).toBe(false);
    expect(verifyPolarWebhook(payload, "", POLAR_SECRET)).toBe(false);
    expect(verifyPolarWebhook(payload, sign(payload), POLAR_SECRET)).toBe(true);
  });
});

describe("Telegram bot webhook", () => {
  const update = { message: { chat: { id: 7 }, text: "/status" } };

  function post(secret?: string) {
    return telegramWebhook(
      new NextRequest("http://localhost/api/telegram/webhook", {
        method: "POST",
        body: JSON.stringify(update),
        headers: {
          "content-type": "application/json",
          ...(secret !== undefined ? { "X-Telegram-Bot-Api-Secret-Token": secret } : {}),
        },
      })
    );
  }

  it("REGRESSION: fails closed (503) when TELEGRAM_WEBHOOK_SECRET is not configured, in any environment", async () => {
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "");
    vi.stubEnv("NODE_ENV", "development");
    expect((await post("anything")).status).toBe(503);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("REGRESSION: enforces the secret outside production too", async () => {
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", TELEGRAM_SECRET);
    vi.stubEnv("NODE_ENV", "development");
    expect((await post()).status).toBe(401);
    expect((await post("wrong")).status).toBe(401);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("processes updates carrying the correct secret", async () => {
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", TELEGRAM_SECRET);
    const response = await post(TELEGRAM_SECRET);
    expect(response.status).toBe(200);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
});
