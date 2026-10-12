import type { FeedItemPage, FeedItemRow } from "@dailybrief/shared";
import { useMutation, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { useNavigate, useParams } from "react-router";
import { api } from "../api.ts";
import { useMediaQuery } from "../lib/media.ts";
import { ItemList } from "../rss/ItemList.tsx";
import { ManageFeeds } from "../rss/ManageFeeds.tsx";
import { ReaderPane } from "../rss/ReaderPane.tsx";

const WIDTH_KEY = "rss.listWidth";
const MIN_W = 300;
const MAX_W = 560;
const clampWidth = (w: number) => Math.min(MAX_W, Math.max(MIN_W, w));
/** Article open when the reader was left; reopened on return (two-pane layouts, where nothing deselects it). */
let lastItemId: number | null = null;

/**
 * ≥900px: list ≈30% (draggable divider with a mouse/trackpad; width remembered per device).
 * 680–899px: list fixed at 300px. <680px: one pane at a time with a back button.
 */
export function RssView() {
  const { itemId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [manageOpen, setManageOpen] = useState(false);
  const selectedId = itemId ? Number(itemId) : null;
  const wide = useMediaQuery("(min-width: 900px)");
  const split = useMediaQuery("(min-width: 680px)");
  const touch = useMediaQuery("(pointer: coarse)");
  const [listWidth, setListWidth] = useState<number | null>(() => {
    const saved = Number(localStorage.getItem(WIDTH_KEY));
    return saved ? clampWidth(saved) : null;
  });
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selectedId !== null) lastItemId = selectedId;
    else if (split && lastItemId !== null) navigate(`/rss/${lastItemId}`, { replace: true });
  }, [selectedId, split, navigate]);

  const markRead = useMutation({
    mutationFn: (id: number) => api(`/api/feed-items/${id}/read`, { method: "POST" }),
    onMutate: (id) =>
      queryClient.setQueriesData<InfiniteData<FeedItemPage>>({ queryKey: ["feed-items"] }, (old) =>
        old && { ...old, pages: old.pages.map((p) => ({ ...p, items: p.items.map((i) => (i.id === id ? { ...i, read: true } : i)) })) },
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["feeds"] }),
  });

  const onSelect = (item: FeedItemRow) => {
    navigate(`/rss/${item.id}`, { replace: split && selectedId !== null });
    if (!item.read) markRead.mutate(item.id);
  };

  const startDrag = (e: PointerEvent<HTMLDivElement>) => {
    const left = container.current?.getBoundingClientRect().left ?? 0;
    e.currentTarget.setPointerCapture(e.pointerId);
    const move = (ev: globalThis.PointerEvent) => setListWidth(clampWidth(ev.clientX - left));
    const up = () => {
      window.removeEventListener("pointermove", move);
      setListWidth((w) => {
        if (w) localStorage.setItem(WIDTH_KEY, String(w));
        return w;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  };

  const list = <ItemList selectedId={selectedId} onSelect={onSelect} onManageFeeds={() => setManageOpen(true)} />;
  const dialog = <ManageFeeds open={manageOpen} onOpenChange={setManageOpen} />;

  if (!split) {
    return (
      <div className="flex h-full flex-col">
        {selectedId === null ? (
          list
        ) : (
          <>
            <button onClick={() => navigate("/rss")} className="flex min-h-11 shrink-0 items-center gap-2 border-b border-line px-3 text-sm text-muted">
              <ArrowLeft className="size-4" /> All articles
            </button>
            <ReaderPane itemId={selectedId} onSwipeBack={() => navigate("/rss")} />
          </>
        )}
        {dialog}
      </div>
    );
  }

  const columns = wide ? (listWidth ? `${listWidth}px 1fr` : "minmax(320px, min(30%, 480px)) 1fr") : "300px 1fr";
  return (
    <div ref={container} className="relative grid h-full" style={{ gridTemplateColumns: columns }}>
      {list}
      <ReaderPane itemId={selectedId} />
      {wide && !touch && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize article list"
          onPointerDown={startDrag}
          onDoubleClick={() => {
            setListWidth(null);
            localStorage.removeItem(WIDTH_KEY);
          }}
          className="absolute inset-y-0 z-10 w-2 -translate-x-1 cursor-col-resize transition-colors hover:bg-accent/30"
          style={{ left: listWidth ?? "min(max(320px, 30%), 480px)" }}
        />
      )}
      {dialog}
    </div>
  );
}
