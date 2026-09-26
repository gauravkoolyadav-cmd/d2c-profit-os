import { NextResponse } from "next/server";
import { auth } from "./auth";
import { getBrandMembership, isUuid } from "./membership";
import { hasMinimumRole, type BrandRole } from "./roles";

export type AuthorizationErrorCode = "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND";

const STATUS_BY_CODE: Record<AuthorizationErrorCode, 401 | 403 | 404> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
};

const MESSAGE_BY_CODE: Record<AuthorizationErrorCode, string> = {
  UNAUTHENTICATED: "Unauthorized",
  FORBIDDEN: "Forbidden",
  NOT_FOUND: "Brand not found",
};

export class AuthorizationError extends Error {
  readonly code: AuthorizationErrorCode;
  readonly status: 401 | 403 | 404;

  constructor(code: AuthorizationErrorCode, message = MESSAGE_BY_CODE[code]) {
    super(message);
    this.name = "AuthorizationError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
  }
}

export interface AuthenticatedUser {
  userId: string;
}

export interface BrandAuthorization extends AuthenticatedUser {
  brandId: string;
  role: BrandRole;
}

/** Require a signed-in user. Throws AuthorizationError(401) otherwise. */
export async function requireUser(): Promise<AuthenticatedUser> {
  const session = await auth();
  const userId = session?.user?.id;

  if (typeof userId !== "string" || userId.length === 0) {
    throw new AuthorizationError("UNAUTHENTICATED");
  }

  return { userId };
}

/**
 * Require that the signed-in user belongs to `brandId` with at least
 * `minimumRole`.
 *
 * - 401: no session
 * - 404: brandId is malformed, the brand does not exist, or the user is not a
 *        member. These are deliberately indistinguishable so callers cannot
 *        probe for other tenants' brand ids.
 * - 403: the user is a member but their role is below `minimumRole`.
 *
 * Platform-level roles (users.role = "admin") grant NO implicit brand access.
 */
export async function requireBrandRole(
  brandId: unknown,
  minimumRole: BrandRole
): Promise<BrandAuthorization> {
  const { userId } = await requireUser();

  if (!isUuid(brandId)) {
    throw new AuthorizationError("NOT_FOUND");
  }

  const membership = await getBrandMembership(userId, brandId);
  if (!membership) {
    throw new AuthorizationError("NOT_FOUND");
  }

  if (!hasMinimumRole(membership.role, minimumRole)) {
    throw new AuthorizationError("FORBIDDEN");
  }

  return { userId, brandId: membership.brandId, role: membership.role };
}

export function authorizationErrorResponse(error: AuthorizationError): NextResponse {
  return NextResponse.json({ error: error.message }, { status: error.status });
}

type AuthorizeResult<T> =
  | { ok: true; context: T }
  | { ok: false; response: NextResponse };

async function toResult<T>(promise: Promise<T>): Promise<AuthorizeResult<T>> {
  try {
    return { ok: true, context: await promise };
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { ok: false, response: authorizationErrorResponse(error) };
    }
    throw error;
  }
}

/**
 * Route-handler friendly wrapper around requireBrandRole:
 *
 *   const authz = await authorizeBrandRequest(id, "manager");
 *   if (!authz.ok) return authz.response;
 *   const { brandId } = authz.context;
 */
export function authorizeBrandRequest(
  brandId: unknown,
  minimumRole: BrandRole
): Promise<AuthorizeResult<BrandAuthorization>> {
  return toResult(requireBrandRole(brandId, minimumRole));
}

/** Route-handler friendly wrapper around requireUser. */
export function authorizeUserRequest(): Promise<AuthorizeResult<AuthenticatedUser>> {
  return toResult(requireUser());
}
