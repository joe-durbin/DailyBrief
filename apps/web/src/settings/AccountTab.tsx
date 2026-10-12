import { PASSWORD_MIN_LENGTH, type SessionSummary } from "@dailybrief/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Laptop, Loader2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { api } from "../api.ts";
import { timeAgo } from "../lib/format.ts";
import { useNow } from "../lib/now.ts";

const input = "w-full rounded-[10px] bg-bg/70 px-3 py-2.5 text-base text-ink ring-1 ring-line outline-none focus:ring-accent/60";

export function AccountTab() {
  const now = useNow();
  const queryClient = useQueryClient();
  const sessions = useQuery({ queryKey: ["sessions"], queryFn: () => api<SessionSummary[]>("/api/auth/sessions") });
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [localError, setLocalError] = useState<string | null>(null);

  const change = useMutation({
    mutationFn: () => api("/api/auth/password", { method: "PUT", body: { current: pw.current, next: pw.next } }),
    onSuccess: () => {
      setPw({ current: "", next: "", confirm: "" });
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/api/auth/sessions/${id}`, { method: "DELETE" }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["sessions"] }),
  });
  const revokeOthers = useMutation({
    mutationFn: () => api("/api/auth/sessions", { method: "DELETE" }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["sessions"] }),
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setLocalError(pw.next !== pw.confirm ? "The new passwords don't match" : null);
    if (pw.next === pw.confirm) change.mutate();
  };
  const others = sessions.data?.filter((s) => !s.current).length ?? 0;

  return (
    <div className="space-y-7">
      <section>
        <h3 className="mb-3 text-xs font-semibold tracking-wide text-muted uppercase">Change password</h3>
        <form onSubmit={onSubmit} className="space-y-3 rounded-2xl border border-line bg-surface p-4">
          <input className={input} type="password" autoComplete="current-password" placeholder="Current password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required />
          <input
            className={input}
            type="password"
            autoComplete="new-password"
            placeholder={`New password (at least ${PASSWORD_MIN_LENGTH} characters)`}
            minLength={PASSWORD_MIN_LENGTH}
            value={pw.next}
            onChange={(e) => setPw({ ...pw, next: e.target.value })}
            required
          />
          <input className={input} type="password" autoComplete="new-password" placeholder="Confirm new password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} required />
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted">Changing it signs out your other devices.</p>
            <button disabled={change.isPending} className="flex min-h-10 shrink-0 items-center gap-2 rounded-[10px] bg-accent px-4 text-sm font-semibold text-on-accent disabled:opacity-60">
              {change.isPending && <Loader2 className="size-4 animate-spin" />}
              Update password
            </button>
          </div>
          {(localError ?? change.error) && <p className="text-sm text-danger">{localError ?? change.error?.message}</p>}
          {change.isSuccess && (
            <p className="flex items-center gap-1.5 text-sm text-emerald-400">
              <CheckCircle2 className="size-4" /> Password updated
            </p>
          )}
        </form>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">Signed-in devices</h3>
          {others > 0 && (
            <button onClick={() => revokeOthers.mutate()} className="min-h-9 rounded-lg px-2 text-xs text-muted hover:text-danger">
              Sign out all other devices
            </button>
          )}
        </div>
        <ul className="space-y-2">
          {sessions.data?.map((s) => (
            <li key={s.id} className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3.5">
              <Laptop className="size-4 shrink-0 text-muted" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {s.device}
                  {s.current && <span className="ml-2 rounded-full bg-accent/15 px-2 py-0.5 text-[11px] text-accent">This device</span>}
                </p>
                <p className="text-xs text-muted">
                  {s.ip ?? "unknown address"} · active {timeAgo(s.lastSeenAt, now)}
                </p>
              </div>
              {!s.current && (
                <button onClick={() => revoke.mutate(s.id)} className="min-h-9 shrink-0 rounded-lg px-2.5 text-xs text-muted ring-1 ring-line hover:text-danger">
                  Sign out
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
