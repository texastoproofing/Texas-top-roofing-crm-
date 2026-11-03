"use client";
import { useRef } from "react";
import { STAGES, STATUSES } from "@/lib/constants";

// Selector de estado que guarda al cambiar (sin botón).
export function StatusSelect({ action, value, compact }: {
  action: (fd: FormData) => Promise<void>; value: string; compact?: boolean;
}) {
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form ref={ref} action={action}>
      <select name="status" defaultValue={value} aria-label="Cambiar estado"
        className={compact ? "w-full rounded-md border border-line bg-canvas text-xs py-1.5 px-1.5" : "input"}
        onChange={() => ref.current?.requestSubmit()}>
        {STAGES.map((st) => (
          <optgroup key={st.key} label={st.label}>
            {STATUSES.filter((s) => s.stage === st.key).map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </optgroup>
        ))}
      </select>
    </form>
  );
}
