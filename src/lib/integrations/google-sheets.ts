/**
 * Minimal read-only Google Sheets client using a service account (no extra npm package).
 *
 * Env:
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL        service account email (share the sheet with it as Viewer)
 *   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY  its private key (PEM; "\n" escapes are accepted)
 */
import { createSign } from "crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";

export class GoogleSheetsError extends Error {}

let cachedToken: { value: string; expiresAt: number } | null = null;

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function credentials(): { email: string; privateKey: string } {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!email || !privateKey) {
    throw new GoogleSheetsError(
      "Google Sheets is not configured: set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY"
    );
  }
  return { email, privateKey };
}

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const { email, privateKey } = credentials();
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({ iss: email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const assertion = `${header}.${claims}.${base64url(signer.sign(privateKey))}`;

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!response.ok) {
    throw new GoogleSheetsError(`Google auth failed (${response.status})`);
  }
  const json = (await response.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

/** Read a range (e.g. "Config!A1:Z1000") as a 2-D array of formatted strings. */
export async function readSheetValues(spreadsheetId: string, range: string): Promise<string[][]> {
  const token = await accessToken();
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}` +
    `/values/${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    const hint =
      response.status === 403
        ? "share the sheet with the service account email"
        : response.status === 404
          ? "check the sheet ID"
          : response.status === 400
            ? "check the tab name / range"
            : "try again later";
    throw new GoogleSheetsError(`Google Sheets returned ${response.status} for ${range}: ${hint}`);
  }
  const json = (await response.json()) as { values?: unknown[][] };
  return (json.values ?? []).map((row) => row.map((cell) => String(cell ?? "")));
}
