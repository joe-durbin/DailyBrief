import { PASSWORD_MIN_LENGTH } from "@dailybrief/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, useAnimationControls } from "motion/react";
import { useState, type FormEvent } from "react";
import { api } from "../api.ts";
import { Logo } from "../shell/Logo.tsx";

const inputClass =
  "w-full rounded-[10px] border border-line bg-bg px-3.5 py-2.5 text-base text-ink placeholder:text-muted/60 outline-none transition-colors focus:border-accent/70";

export function AuthScreen({ setupRequired }: { setupRequired: boolean }) {
  const queryClient = useQueryClient();
  const shake = useAnimationControls();
  const [form, setForm] = useState({ username: "", password: "", repeat: "", remember: true });
  const mismatch = setupRequired && form.repeat.length > 0 && form.repeat !== form.password;

  const submit = useMutation({
    mutationFn: () =>
      setupRequired
        ? api("/api/auth/setup", { body: { username: form.username, password: form.password } })
        : api("/api/auth/login", { body: { username: form.username, password: form.password, remember: form.remember } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["auth"] }),
    onError: () => void shake.start({ x: [0, -8, 8, -5, 5, 0], transition: { duration: 0.35 } }),
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (setupRequired && form.password !== form.repeat) return void shake.start({ x: [0, -8, 8, -5, 5, 0], transition: { duration: 0.35 } });
    submit.mutate();
  };
  const field = (key: "username" | "password" | "repeat") => ({
    value: form[key],
    onChange: (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value }),
    className: inputClass,
    required: true,
  });

  return (
    <div className="flex min-h-full items-center justify-center bg-[radial-gradient(ellipse_at_top,color-mix(in_srgb,var(--color-accent)_8%,transparent),transparent_60%)] px-4 py-12">
      <motion.div
        initial={{ opacity: 0, scale: 0.98, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.2, 0, 0, 1] }}
        className="w-full max-w-sm"
      >
      <motion.form
        onSubmit={onSubmit}
        animate={shake}
        className="rounded-[20px] border border-line bg-surface p-8 shadow-[0_24px_64px_rgba(0,0,0,0.45)]"
      >
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <Logo className="size-10" />
          <h1 className="text-xl font-semibold tracking-tight">{setupRequired ? "Welcome to DailyBrief" : "Welcome back"}</h1>
          <p className="text-sm text-muted">{setupRequired ? "Choose a username and password to get started. You'll use them to sign in on any device." : "Sign in to your DailyBrief."}</p>
        </div>

        <div className="space-y-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted">Username</span>
            <input {...field("username")} autoComplete="username" autoCapitalize="none" spellCheck={false} />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted">Password</span>
            <input
              {...field("password")}
              type="password"
              autoComplete={setupRequired ? "new-password" : "current-password"}
              minLength={setupRequired ? PASSWORD_MIN_LENGTH : undefined}
            />
            {setupRequired && <span className="block text-xs text-muted">At least {PASSWORD_MIN_LENGTH} characters.</span>}
          </label>
          {setupRequired && (
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-muted">Repeat password</span>
              <input {...field("repeat")} type="password" autoComplete="new-password" aria-invalid={mismatch} />
              {mismatch && <span className="block text-xs text-danger">The passwords don't match.</span>}
            </label>
          )}
          {!setupRequired && (
            <label className="flex items-center gap-2.5 text-sm text-muted select-none">
              <input
                type="checkbox"
                checked={form.remember}
                onChange={(e) => setForm({ ...form, remember: e.target.checked })}
                className="size-4 accent-accent"
              />
              Keep me signed in on this device
            </label>
          )}
        </div>

        {submit.error && <p className="mt-4 text-sm text-danger">{submit.error.message}</p>}

        <button
          type="submit"
          disabled={submit.isPending}
          className="mt-6 w-full rounded-[10px] bg-accent py-2.5 text-sm font-semibold text-on-accent transition-[filter,transform] hover:brightness-110 active:scale-[0.99] disabled:opacity-60"
        >
          {submit.isPending ? "Please wait…" : setupRequired ? "Create account" : "Sign in"}
        </button>
      </motion.form>
      </motion.div>
    </div>
  );
}
