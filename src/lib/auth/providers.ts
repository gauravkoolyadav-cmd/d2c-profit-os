import type { OAuthConfig } from "next-auth/providers";
import Google from "next-auth/providers/google";

export type Provider = "google";

export function getProviders(): Record<string, OAuthConfig<any>> {
  const providers: Record<string, OAuthConfig<any>> = {};

  if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
    providers.google = Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      allowDangerousEmailAccountLinking: true,
    }) as OAuthConfig<any>;
  }

  return providers;
}

export function isOAuthEnabled(): boolean {
  return !!(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
}
