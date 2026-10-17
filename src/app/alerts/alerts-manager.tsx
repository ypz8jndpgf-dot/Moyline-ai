"use client";

import { useEffect, useState } from "react";
import type { LineAlert } from "@/lib/alerts";

export default function AlertsManager() {
  const [alerts, setAlerts] = useState<LineAlert[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const res = await fetch("/api/alerts");
      const data = await res.json();
      if (data.ok) setAlerts(data.alerts);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const cancel = async (id: string) => {
    try {
      await fetch(`/api/alerts?id=${id}`, { method: "DELETE" });
      setAlerts(alerts.filter((a) => a.id !== id));
    } catch {
      /* ignore */
    }
  };

  if (loading) {
    return <p className="text-muted text-sm">Loading alerts...</p>;
  }

  const active = alerts.filter((a) => !a.triggered_at);
  const triggered = alerts.filter((a) => a.triggered_at);

  return (
    <div>
      {active.length === 0 && triggered.length === 0 && (
        <div className="card p-8 text-center text-muted">
          <p className="mb-2">No alerts set.</p>
          <p className="text-sm">Hit the 🔔 button on any game in the Lines tab to set your first target.</p>
        </div>
      )}

      {active.length > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-bold uppercase tracking-widest text-gold mb-3">
            Active ({active.length})
          </h2>
          <div className="space-y-2">
            {active.map((a) => (
              <div key={a.id} className="card p-4 flex items-center justify-between">
                <div>
                  <p className="font-bold text-sm">{a.gameLabel}</p>
                  <p className="text-xs text-muted">
                    {a.side} {a.market} → <span className="text-gold font-bold">{a.target}</span>
                  </p>
                  <p className="text-[11px] text-muted mt-1">
                    Set {new Date(a.created_at).toLocaleDateString()}
                  </p>
                </div>
                <button
                  onClick={() => cancel(a.id)}
                  className="text-xs text-red-400 hover:text-red-300 border border-red-400/30 rounded px-3 py-1.5"
                >
                  Cancel
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {triggered.length > 0 && (
        <div>
          <h2 className="text-sm font-bold uppercase tracking-widest text-muted mb-3">
            Triggered ({triggered.length})
          </h2>
          <div className="space-y-2 opacity-60">
            {triggered.map((a) => (
              <div key={a.id} className="card p-4 flex items-center justify-between">
                <div>
                  <p className="font-bold text-sm">{a.gameLabel} <span className="text-emerald-400 text-xs">✓ Hit</span></p>
                  <p className="text-xs text-muted">
                    {a.side} {a.market} hit {a.target}
                  </p>
                </div>
                <button
                  onClick={() => cancel(a.id)}
                  className="text-xs text-muted hover:text-white"
                >
                  Dismiss
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
