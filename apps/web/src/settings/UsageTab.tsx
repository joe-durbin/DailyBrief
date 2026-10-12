import type { UsageReport } from "@dailybrief/shared";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api.ts";
import { usd } from "../lib/format.ts";

const fmt = new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 1 });
const ROLE_LABEL: Record<string, string> = { researcher: "Researcher", editor: "Editor", writer: "Writer", chat: "Chat" };

export function UsageTab() {
  const usage = useQuery({ queryKey: ["usage"], queryFn: () => api<UsageReport>("/api/usage?days=30"), refetchInterval: 60_000 });
  const u = usage.data;
  if (!u) return <p className="text-sm text-muted">{usage.error?.message ?? "Loading…"}</p>;
  const total = u.days.reduce((s, d) => s + d.tokensIn + d.tokensOut, 0);

  return (
    <div className="space-y-7">
      <section>
        <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">DailyBrief usage · last 30 days</h3>
        <p className="text-sm text-muted">
          {fmt.format(total)} tokens{u.totalCostUsd !== null && ` · ${usd(u.totalCostUsd)}`} · {u.perBrief.briefs} briefs · ≈{fmt.format(u.perBrief.avgTokens)} tokens
          {u.perBrief.avgCostUsd !== null && ` (≈${usd(u.perBrief.avgCostUsd)})`} per brief
        </p>
      </section>

      <section>
        <h3 className="mb-3 text-xs font-semibold tracking-wide text-muted uppercase">By role and model</h3>
        <div className="overflow-hidden rounded-2xl border border-line">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2 font-medium">Model</th>
                <th className="px-3 py-2 text-right font-medium">Calls</th>
                <th className="px-3 py-2 text-right font-medium">Tokens in / out</th>
                <th className="px-3 py-2 text-right font-medium">Cost</th>
              </tr>
            </thead>
            <tbody>
              {u.byModel.map((m) => (
                <tr key={`${m.role}-${m.model}`} className="border-t border-line">
                  <td className="px-3 py-2">{ROLE_LABEL[m.role] ?? m.role}</td>
                  <td className="max-w-40 truncate px-3 py-2 text-muted">{m.model}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {m.calls}
                    {m.failed > 0 && <span className="text-danger"> ({m.failed} failed)</span>}
                  </td>
                  <td className="px-3 py-2 text-right text-muted tabular-nums">
                    {fmt.format(m.tokensIn)} / {fmt.format(m.tokensOut)}
                  </td>
                  <td className="px-3 py-2 text-right text-muted tabular-nums">{m.costUsd === null ? "—" : usd(m.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {u.byModel.some((m) => m.costUsd === null) && <p className="mt-2 text-xs text-muted">Models with unknown pricing are shown with —. Prices are looked up automatically and can be edited in Settings → AI.</p>}
      </section>
    </div>
  );
}
