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

  libraryStateSeedFeedback:
    LibraryStateSeedFeedback;
};

type AuthFeedback = {
  kind: "error";
  message: string;
};

const HOUSEHOLD_USERNAME =
  "CJade";

const HOUSEHOLD_LOGIN_EMAIL =
  import.meta.env
    .VITE_HOUSEHOLD_LOGIN_EMAIL
    ?.trim() ?? "";

export default function HouseholdAccountPanel({
  onSessionChange,
}: HouseholdAccountPanelProps) {
  const [session, setSession] =
    useState<Session | null>(null);

  const [
    isCheckingSession,
    setIsCheckingSession,
  ] = useState(true);

  const [username, setUsername] =
    useState(HOUSEHOLD_USERNAME);

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
        if (!isActive) {
          return;
        }

        if (error) {
          setFeedback({
            kind: "error",
            message:
              `Could not check the saved sign-in: ${error.message}`,
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
        if (!isActive) {
          return;
        }

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

    const normalizedUsername =
      username.trim().toLowerCase();

    const expectedUsername =
      HOUSEHOLD_USERNAME.toLowerCase();

    if (!normalizedUsername || !password) {
      setFeedback({
        kind: "error",
        message:
          "Enter the username and password.",
      });

      return;
    }

    if (
      normalizedUsername !==
      expectedUsername
    ) {
      setFeedback({
        kind: "error",
        message:
          "The username or password is incorrect.",
      });

      return;
    }

    if (!HOUSEHOLD_LOGIN_EMAIL) {
      setFeedback({
        kind: "error",
        message:
          "Household login is not configured in this app build.",
      });

      return;
    }

    setIsSubmitting(true);
    setFeedback(null);

    try {
      const { error } =
        await supabase.auth.signInWithPassword({
          email: HOUSEHOLD_LOGIN_EMAIL,
          password,
        });

      if (error) {
        setFeedback({
          kind: "error",
          message:
            "The username or password is incorrect.",
        });

        return;
      }

      setUsername(
        HOUSEHOLD_USERNAME
      );

      setPassword("");
      setFeedback(null);
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
        await supabase.auth.signOut({
          scope: "local",
        });

      if (error) {
        setFeedback({
          kind: "error",
          message:
            `Sign out failed: ${error.message}`,
        });

        return;
      }

      setUsername(
        HOUSEHOLD_USERNAME
      );

      setPassword("");
      setFeedback(null);
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
      <section
        className="householdAccountPanel householdAccountPanelSignedIn"
        aria-label="Checking household sign-in"
      >
        <div className="householdAccountIdentity">
          <strong>CJade…</strong>
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
      aria-label="Household account"
    >
      {session ? (
        <>
          <div className="householdAccountIdentity">
            <strong>CJade ✓</strong>
          </div>

          <button
            type="button"
            className="householdAccountButton"
            disabled={isSubmitting}
            onClick={handleSignOut}
          >
            {isSubmitting
              ? "Signing out…"
              : "Sign out"}
          </button>
        </>
      ) : (
        <form
          className="householdAccountForm"
          onSubmit={handleSignIn}
        >
          <label className="householdAccountField">
            <span>Username</span>

            <input
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              onChange={(event) => {
                setUsername(
                  event.target.value
                );

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
                setPassword(
                  event.target.value
                );

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

      {feedback ? (
        <p
          className="householdAccountFeedback householdAccountFeedbackerror"
          role="alert"
        >
          {feedback.message}
        </p>
      ) : null}
    </section>
  );
}