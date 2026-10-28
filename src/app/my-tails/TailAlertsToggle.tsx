"use client";

import { useEffect, useState } from "react";

/**
 * Opt-in for tailed-pick alerts (optimization #19): a push when a line
 * moves against a pick you tailed, and a heads-up before it starts.
 * Alerts are checked at each odds refresh (morning + evening) and need
 * push notifications enabled on this device. Saved via /api/prefs.
 */
export default function TailAlertsToggle() {
  const [on, setOn] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/prefs")
      .then((r) => r.json())
      .then((d) => {
        if (d?.prefs) setOn(d.prefs.tailAlerts === true);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  async function toggle() {
    if (busy || !loaded) return;
    const next = !on;
    setOn(next); // optimistic
    setBusy(true);
    try {
      const res = await fetch("/api/prefs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tailAlerts: next }),
      });
      const d = await res.json().catch(() => ({}));
      if (!d.ok) setOn(!next); // revert
    } catch {
      setOn(!next); // revert
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4 mb-6 flex items-start justify-between gap-3">
      <div>
        <p className="text-sm font-bold">🔔 Tail alerts</p>
        <p className="text-xs text-muted mt-1">
          Get a push when a line moves against a pick you tailed, and a
          heads-up before it starts. Checked at each odds refresh (morning +
          evening) — push notifications must be on for this device.
        </p>
      </div>
      <button
        type="button"
        onClick={toggle}
        disabled={busy || !loaded}
        aria-pressed={on}
        className={`shrink-0 text-xs font-bold px-3 py-1.5 rounded-full border transition-colors disabled:opacity-50 ${
          on
            ? "bg-gold text-black border-gold"
            : "border-line text-muted hover:border-gold hover:text-gold"
        }`}
      >
        {on ? "On" : "Off"}
      </button>
    </div>
  );
}
