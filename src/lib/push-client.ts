/**
 * Client-side Web Push subscription flow, shared by the nav bell toggle
 * (PushBell) and the one-time post-sign-in prompt (PushPrompt) so both go
 * through the exact same permission + subscribe + save steps.
 */

export type PushSubscribeResult =
  | "on"
  | "off"
  | "denied"
  | "error"
  | "unsupported";

export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Ask for permission (if needed), subscribe, and save the subscription. */
export async function subscribeToPush(): Promise<PushSubscribeResult> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return "unsupported";
  }
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") {
      return perm === "denied" ? "denied" : "off";
    }
    const keyRes = await fetch("/api/push/subscribe");
    const keyJson = (await keyRes.json()) as { ok: boolean; publicKey?: string };
    if (!keyJson.ok || !keyJson.publicKey) return "error";
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(keyJson.publicKey),
    });
    const saveRes = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription: sub.toJSON() }),
    });
    return saveRes.ok ? "on" : "error";
  } catch {
    return "error";
  }
}
