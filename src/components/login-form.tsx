"use client";

import { useActionState } from "react";

import { loginAction, type LoginState } from "@/modules/auth/actions";

type LoginLabels = {
  email: string;
  password: string;
  signIn: string;
  signingIn: string;
};

const initialState: LoginState = {};

export function LoginForm({ labels }: { labels: LoginLabels }) {
  const [state, action, pending] = useActionState(loginAction, initialState);

  return (
    <form action={action} className="mt-7 space-y-5">
      <div>
        <label className="block text-sm font-medium text-zinc-200" htmlFor="login-email">
          {labels.email}
        </label>
        <input
          autoComplete="email"
          className="mt-2 w-full rounded-xl border border-zinc-700/90 bg-zinc-950/80 px-4 py-3 text-zinc-50 shadow-inner shadow-black/10 outline-none transition hover:border-zinc-600 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/15"
          id="login-email"
          name="email"
          required
          type="email"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-zinc-200" htmlFor="login-password">
          {labels.password}
        </label>
        <input
          autoComplete="current-password"
          className="mt-2 w-full rounded-xl border border-zinc-700/90 bg-zinc-950/80 px-4 py-3 text-zinc-50 shadow-inner shadow-black/10 outline-none transition hover:border-zinc-600 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/15"
          id="login-password"
          name="password"
          required
          type="password"
        />
      </div>
      {state.error ? (
        <p className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-200" role="alert">
          {state.error}
        </p>
      ) : null}
      <button
        className="w-full rounded-xl bg-emerald-400 px-4 py-3 font-semibold text-zinc-950 shadow-lg shadow-emerald-950/30 transition hover:bg-emerald-300 disabled:cursor-wait disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? labels.signingIn : labels.signIn}
      </button>
    </form>
  );
}
