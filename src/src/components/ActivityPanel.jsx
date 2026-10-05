import React from "react";
import { ROLES } from "../domain/constants";

export function ActivityPanel({ activity }) {
  return (
    <div style={{ padding: 14 }}>
      {activity.length === 0 && <div style={{ color: "var(--muted)", fontSize: 13 }}>لا يوجد حركات مسجلة بعد</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {activity.map((a) => (
          <div key={a.id} className="cx-card" style={{ padding: 10, fontSize: 12.5, display: "flex", justifyContent: "space-between", gap: 8 }}>
            <div><b>{a.user}</b> ({ROLES.find((r) => r.key === a.role)?.label}) — {a.action}</div>
            <div style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>{new Date(a.ts).toLocaleString("ar-EG")}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
