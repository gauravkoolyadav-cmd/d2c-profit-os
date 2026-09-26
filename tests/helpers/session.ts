import { vi } from "vitest";
import { auth } from "@/lib/auth/auth";
import type { Persona } from "./world";

type AuthMock = ReturnType<typeof vi.fn>;

/** Make `auth()` return the given persona's session (or null for anonymous). */
export function setSession(persona: Pick<Persona, "userId" | "platformRole"> | null): void {
  const mock = auth as unknown as AuthMock;
  if (!persona || !persona.userId) {
    mock.mockResolvedValue(null);
    return;
  }
  mock.mockResolvedValue({
    user: { id: persona.userId, role: persona.platformRole, email: `${persona.userId}@test.local` },
    expires: "2099-01-01T00:00:00.000Z",
  });
}

export function setSessionUser(userId: string | null): void {
  setSession(userId ? { userId, platformRole: "operator" } : null);
}
