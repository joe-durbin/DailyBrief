import type { AppEvent } from "@dailybrief/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

/** One EventSource for the app; server events invalidate the affected queries. Reconnects automatically. */
export function useLiveEvents() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const source = new EventSource("/api/events");
    source.onmessage = (msg) => {
      const event = JSON.parse(msg.data) as AppEvent;
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      if (event.type === "themes.ready") return;
      void queryClient.invalidateQueries({ queryKey: ["brief", event.topicId] });
      if (event.type !== "article.updated") void queryClient.invalidateQueries({ queryKey: ["topics"] });
      if (event.type === "brief.status") {
        void queryClient.invalidateQueries({ queryKey: ["brief-dates", event.topicId] });
        // A brief may have just picked and added feeds for its topic.
        for (const k of ["feeds", "topic", "feed-items"]) void queryClient.invalidateQueries({ queryKey: [k] });
      }
      if (event.type === "article.updated") void queryClient.invalidateQueries({ queryKey: ["article", event.articleId] });
    };
    // After a reconnect (e.g. iPad Safari resumed from background) refetch whatever is on screen.
    source.onopen = () => void queryClient.invalidateQueries({ queryKey: ["brief"] });
    return () => source.close();
  }, [queryClient]);
}
