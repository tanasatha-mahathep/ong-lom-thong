import type th from "./th";

/** namespace `auth` — sign-in page and branch step (English · same keys as th.ts) */
export default {
  signIn: {
    title: "Sign in",
    description: "Staff account for {{shop}}",
    email: "Email",
    emailPlaceholder: "name@example.com",
    password: "Password",
    passwordPlaceholder: "••••••••••",
    submit: "Sign in",
    submitting: "Signing in…",
    help: "Forgot your password or don't have an account? Contact the administrator",
    missingEmail: "Enter your email",
    missingPassword: "Enter your password",
    invalidEmail: "Invalid email format, e.g. name@example.com",
    welcome: "Welcome, {{name}}",
  },
  errors: {
    invalidCredentials: "Incorrect email or password",
    disabled: "This account has been disabled. Contact the administrator",
    rateLimited: "Too many sign-in attempts. Please wait a moment",
    forbiddenOrigin:
      "The server rejected this page's origin — set the api's BETTER_AUTH_URL to {{origin}} and restart the api",
    failed: "Sign-in failed. Please try again",
  },
  branch: {
    title: "Choose your branch",
    greeting: "Hello {{name}} — this account can use {{count}} branches",
    legend: "Branch for bills and reports in this session",
    hint: "You can change it later from the user menu at the bottom of the sidebar",
    submit: "Continue",
    required: "Choose your branch",
    saveFailed: "Could not save the branch — {{reason}}",
    welcome: "Welcome, {{name}} — working at {{branch}}",
  },
  brandTagline: "Counter buy-in system · Members",
} satisfies typeof th;
