import { JWT } from "google-auth-library";

/**
 * Sends notifications via the FCM HTTP v1 API, authenticating with a service
 * account JSON read from `FCM_SERVICE_ACCOUNT_JSON` (an Azure Key Vault
 * reference in production). Port of the legacy .NET `FcmSender`. When the env
 * var is absent/invalid, push is simply disabled (`isConfigured === false`) and
 * every send is a no-op — the app keeps working, just without OS push.
 */

export type FcmResult = "ok" | "invalid-token" | "failed";

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, string>;
  /** SOS-class alerts use a high-priority channel that can wake the device. */
  highPriority?: boolean;
  /** Silent data message (no notification block, always high priority on
   *  Android): wakes the app's background push task headlessly — used to
   *  resume trip location tracking on a device that stopped transmitting.
   *  `title`/`body` are ignored. */
  dataOnly?: boolean;
}

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
}

let jwtClient: JWT | null = null;
let projectId: string | null = null;
let initialized = false;

function init(): void {
  if (initialized) return;
  initialized = true;
  const raw = process.env.FCM_SERVICE_ACCOUNT_JSON;
  if (!raw?.trim()) return;
  try {
    const sa = JSON.parse(raw) as ServiceAccount;
    jwtClient = new JWT({
      email: sa.client_email,
      key: sa.private_key,
      scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
    });
    projectId = sa.project_id ?? null;
  } catch {
    jwtClient = null;
    projectId = null;
  }
}

export function isPushConfigured(): boolean {
  init();
  return !!jwtClient && !!projectId;
}

export async function sendPush(deviceToken: string, message: PushMessage): Promise<FcmResult> {
  init();
  if (!jwtClient || !projectId) return "failed";

  let accessToken: string | null | undefined;
  try {
    accessToken = (await jwtClient.getAccessToken()).token;
  } catch {
    return "failed";
  }
  if (!accessToken) return "failed";

  const payload = {
    message: {
      token: deviceToken,
      ...(message.dataOnly ? {} : { notification: { title: message.title, body: message.body } }),
      ...(message.data ? { data: message.data } : {}),
      android: {
        priority: message.highPriority || message.dataOnly ? "high" : "normal",
        // wardyou_sos_v2: channel with the long attention-grabbing vibration
        // pattern (Android channels are immutable, hence the v2 id). Clients
        // that predate v2 fall back to their default channel via FCM.
        ...(message.dataOnly
          ? {}
          : { notification: { channel_id: message.highPriority ? "wardyou_sos_v2" : "default" } }),
      },
    },
  };

  try {
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) return "ok";
    const text = await res.text().catch(() => "");
    if (res.status === 404 || /UNREGISTERED|INVALID_ARGUMENT/i.test(text)) return "invalid-token";
    return "failed";
  } catch {
    return "failed";
  }
}
