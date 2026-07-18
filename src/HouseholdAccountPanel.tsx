import {
  type FormEvent,
  useEffect,
  useState,
} from "react";
import type { Session } from "@supabase/supabase-js";

import { supabase } from "./supabaseClient";

import type {
  LibraryStateLoadStatus,
  LibraryStateSeedFeedback,
  LibraryStateSeedPreview,
} from "./data/libraryState";

type HouseholdAccountPanelProps = {
  onSessionChange: (
    session: Session | null
  ) => void;

  libraryStateLoadStatus:
    LibraryStateLoadStatus;

  libraryStateRecordCount: number;

  libraryStateLoadError: string;

  libraryStateSeedPreview:
    LibraryStateSeedPreview | null;

  onSeedLibraryState: () => void;
  isSeedingLibraryState: boolean;
  libraryStateSeedFeedback: LibraryStateSeedFeedback;
};

type AuthFeedback = {
  kind: "success" | "error";
  message: string;
};

export default function HouseholdAccountPanel({
  onSessionChange,
  libraryStateLoadStatus,
  libraryStateRecordCount,
  libraryStateLoadError,
  libraryStateSeedPreview,
  onSeedLibraryState,
  isSeedingLibraryState,
  libraryStateSeedFeedback,
}: HouseholdAccountPanelProps) {
  const [session, setSession] =
    useState<Session | null>(null);

  const [isCheckingSession, setIsCheckingSession] =
    useState(true);

  const [email, setEmail] =
    useState("");

  const [password, setPassword] =
    useState("");

  const [isSubmitting, setIsSubmitting] =
    useState(false);

  const [feedback, setFeedback] =
    useState<AuthFeedback | null>(null);

  useEffect(() => {
    let isActive = true;

    void supabase.auth.getSession().then(
      ({ data, error }) => {
        if (!isActive) return;

        if (error) {
          setFeedback({
            kind: "error",
            message:
              `Could not check the household session: ${error.message}`,
          });
        }

        setSession(data.session);
        onSessionChange(data.session);
        setIsCheckingSession(false);
      }
    );

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        if (!isActive) return;

        setSession(nextSession);
        onSessionChange(nextSession);
        setIsCheckingSession(false);
      }
    );

    return () => {
      isActive = false;
      subscription.unsubscribe();
    };
  }, [onSessionChange]);

  async function handleSignIn(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    const normalizedEmail = email.trim();

    if (!normalizedEmail || !password) {
      setFeedback({
        kind: "error",
        message:
          "Enter the household email and password.",
      });

      return;
    }

    setIsSubmitting(true);
    setFeedback(null);

    try {
      const { error } =
        await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });

      if (error) {
        setFeedback({
          kind: "error",
          message: `Login failed: ${error.message}`,
        });

        return;
      }

      setPassword("");

      setFeedback({
        kind: "success",
        message: "Household login succeeded.",
      });
    } catch (error) {
      console.error(
        "Unexpected household login error.",
        error
      );

      setFeedback({
        kind: "error",
        message:
          "An unexpected error occurred while signing in.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSignOut() {
    setIsSubmitting(true);
    setFeedback(null);

    try {
      const { error } =
        await supabase.auth.signOut();

      if (error) {
        setFeedback({
          kind: "error",
          message:
            `Sign out failed: ${error.message}`,
        });

        return;
      }

      setFeedback({
        kind: "success",
        message: "Signed out of household sync.",
      });
    } catch (error) {
      console.error(
        "Unexpected household sign-out error.",
        error
      );

      setFeedback({
        kind: "error",
        message:
          "An unexpected error occurred while signing out.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isCheckingSession) {
    return (
      <section className="householdAccountPanel">
        <div className="householdAccountCopy">
          <strong>Household sync</strong>
          <span>Checking saved sign-in…</span>
        </div>
      </section>
    );
  }

  return (
    <section
      className={
        session
          ? "householdAccountPanel householdAccountPanelSignedIn"
          : "householdAccountPanel"
      }
      aria-label="Household Supabase account"
    >
      {session ? (
        <>
          <div className="householdAccountCopy">
            <strong>Household sync ✓</strong>

            <span>
              Signed in as{" "}
              {session.user.email ??
                "household account"}
            </span>

            <span
              className={
                libraryStateLoadStatus === "error"
                  ? "householdAccountState householdAccountStateError"
                  : "householdAccountState"
              }
              aria-live="polite"
            >
              {libraryStateLoadStatus === "loading"
                ? "Loading shared library state…"
                : libraryStateLoadStatus === "error"
                  ? `Shared state failed to load: ${libraryStateLoadError}`
                  : `${libraryStateRecordCount} shared ${
                      libraryStateRecordCount === 1
                        ? "record"
                        : "records"
                    } loaded`}
            </span>

            {libraryStateLoadStatus === "ready" &&
            libraryStateRecordCount === 0 &&
            libraryStateSeedPreview ? (
              <span className="householdAccountSeedPreview">
                Seed preview:{" "}
                {libraryStateSeedPreview.totalRows} candidate{" "}
                {libraryStateSeedPreview.totalRows === 1
                  ? "record"
                  : "records"}
                {" · "}
                {libraryStateSeedPreview.readRows} read
                {" · "}
                {libraryStateSeedPreview.inProgressRows} in progress
                {" · "}
                {libraryStateSeedPreview.cjRows} CJ
                {" · "}
                {libraryStateSeedPreview.jcRows} JC
                {" · "}
                {libraryStateSeedPreview.skippedMissingCatalogKey} skipped
              </span>
            ) : null}
          </div>

          <div className="householdAccountActions">
            {libraryStateLoadStatus === "ready" &&
            libraryStateRecordCount === 0 &&
            libraryStateSeedPreview ? (
              <button
                type="button"
                className="householdAccountButton"
                disabled={
                  isSubmitting ||
                  isSeedingLibraryState ||
                  libraryStateSeedPreview.totalRows === 0 ||
                  libraryStateSeedPreview
                    .skippedMissingCatalogKey > 0
                }
                onClick={
                  onSeedLibraryState
                }
              >
                {isSeedingLibraryState
                  ? `Seeding ${libraryStateSeedPreview.totalRows}…`
                  : "Seed shared state"}
              </button>
            ) : null}

            <button
              type="button"
              className="householdAccountButton"
              disabled={
                isSubmitting ||
                isSeedingLibraryState
              }
              onClick={handleSignOut}
            >
              {isSubmitting
                ? "Signing out…"
                : "Sign out"}
            </button>
          </div>
        </>
      ) : (
        <form
          className="householdAccountForm"
          onSubmit={handleSignIn}
        >
          <div className="householdAccountCopy">
            <strong>Household sync</strong>
            <span>
              Sign in to load shared library state.
            </span>
          </div>

          <label className="householdAccountField">
            <span>Email</span>

            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setFeedback(null);
              }}
            />
          </label>

          <label className="householdAccountField">
            <span>Password</span>

            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setFeedback(null);
              }}
            />
          </label>

          <button
            type="submit"
            className="householdAccountButton"
            disabled={isSubmitting}
          >
            {isSubmitting
              ? "Signing in…"
              : "Sign in"}
          </button>
        </form>
      )}

      {session &&
      libraryStateSeedFeedback ? (
        <p
          className={`householdAccountFeedback householdAccountFeedback${libraryStateSeedFeedback.kind}`}
          role="status"
        >
          {
            libraryStateSeedFeedback.message
          }
        </p>
      ) : null}
      
      {feedback ? (
        <p
          className={`householdAccountFeedback householdAccountFeedback${feedback.kind}`}
          role="status"
        >
          {feedback.message}
        </p>
      ) : null}
    </section>
  );
}