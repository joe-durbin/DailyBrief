import type { StorageStats } from "@dailybrief/shared";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { api } from "../api.ts";

const num = new Intl.NumberFormat("en-GB");
const mb = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} MB`;

export function DataTab() {
  const stats = useQuery({ queryKey: ["stats"], queryFn: () => api<StorageStats>("/api/stats") });
  const s = stats.data;
  const rows: [string, string][] = s
    ? [
        ["Briefs generated", num.format(s.briefs)],
        ["Articles written", num.format(s.articles)],
        ["Saved items", num.format(s.saved)],
        ["RSS items stored", num.format(s.feedItems)],
        ["Conversations", num.format(s.chats)],
        ["Database size", mb(s.dbBytes)],
      ]
    : [];
  const link = "flex min-h-10 items-center gap-2 rounded-[10px] px-4 text-sm font-medium ring-1 ring-line-strong hover:bg-surface";

  return (
    <div className="space-y-7">
      <section>
        <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">Export saved articles</h3>
        <p className="mb-3 text-sm text-muted">Everything in Saved, including full article text and sources.</p>
        <div className="flex flex-wrap gap-2">
          <a href="/api/export/saved?format=md" download className={link}>
            <Download className="size-4" /> Markdown
          </a>
          <a href="/api/export/saved?format=json" download className={link}>
            <Download className="size-4" /> JSON
          </a>
        </div>
      </section>
      <section>
        <h3 className="mb-3 text-xs font-semibold tracking-wide text-muted uppercase">Storage</h3>
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line">
          {rows.map(([k, v]) => (
            <div key={k} className="bg-surface p-3.5">
              <dt className="text-xs text-muted">{k}</dt>
              <dd className="mt-0.5 text-[15px] font-semibold tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
