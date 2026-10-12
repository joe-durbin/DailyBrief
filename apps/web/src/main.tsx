import "@fontsource-variable/inter";
import "@fontsource-variable/source-serif-4";
import "@fontsource-variable/jetbrains-mono";
import "./styles.css";
import type { AuthState } from "@dailybrief/shared";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import * as Tooltip from "@radix-ui/react-tooltip";
import { MotionConfig } from "motion/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { api, ApiError } from "./api.ts";
import { applyTheme, currentTheme } from "./lib/theme.ts";
import { AuthScreen } from "./pages/AuthScreen.tsx";
import { AppShell } from "./shell/AppShell.tsx";
import { ErrorBoundary } from "./shell/ErrorBoundary.tsx";
import { ChatsView } from "./views/ChatsView.tsx";
import { DashboardView } from "./views/DashboardView.tsx";
import { BriefsView } from "./views/BriefsView.tsx";
import { RssView } from "./views/RssView.tsx";
import { SavedView } from "./views/SavedView.tsx";

applyTheme(currentTheme());

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (n, err) => !(err instanceof ApiError && err.status < 500) && n < 2,
    },
  },
});

function App() {
  const auth = useQuery({ queryKey: ["auth"], queryFn: () => api<AuthState>("/api/auth/state") });
  if (!auth.data) return <div className="h-full bg-bg" />;
  if (!auth.data.authenticated) return <AuthScreen setupRequired={auth.data.setupRequired} />;
  return (
    <Routes>
      <Route element={<AppShell username={auth.data.username ?? ""} />}>
        <Route index element={<DashboardView />} />
        <Route path="/briefs/:topicId?/:date?" element={<BriefsView />} />
        <Route path="/rss/:itemId?" element={<RssView />} />
        <Route path="/saved" element={<SavedView />} />
        <Route path="/chats/:kind?/:id?" element={<ChatsView />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">
        <Tooltip.Provider delayDuration={400}>
          <BrowserRouter>
            <ErrorBoundary>
              <App />
            </ErrorBoundary>
          </BrowserRouter>
        </Tooltip.Provider>
      </MotionConfig>
    </QueryClientProvider>
  </StrictMode>,
);
