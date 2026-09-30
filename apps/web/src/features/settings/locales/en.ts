import type th from "./th";

/** namespace `settings` — branch and user management (administrators only) · English, same keys as th.ts */
export default {
  adminOnly: {
    title: "Administrator access required",
    description:
      "This page is for administrators only — to add or edit branches and users, contact the shop's administrator",
  },
  form: {
    cancel: "Cancel",
    shortcut: "or press",
    keys: {
      ctrl: "Ctrl",
      enter: "Enter",
    },
    forbidden:
      "Administrator access required — this account can no longer save (its permissions may have changed). Try signing in again",
  },
  branchLabel: "{{code}} {{name}}",
  branches: {
    description: "Branch code, name, address and Revenue Department branch code, printed on every receipt header",
    add: "Add branch",
    caption: "All branches, including closed ones",
    list: "Branches",
    empty: "No branches yet",
    edit: "{{name}} — edit",
    taxBranch: "{{code}} · {{label}}",
    columns: {
      code: "Code",
      name: "Branch name",
      shortName: "Short name",
      taxBranch: "Revenue Dept. branch",
      docPrefix: "Bill number prefix",
      sortOrder: "Order",
      status: "Status",
      bills: "Bills",
    },
    status: {
      active: "Open",
      inactive: "Closed",
    },
    bills: {
      yes: "Has bills",
      no: "None yet",
    },
    taxMissing: "Not set — receipts cannot be issued",
    form: {
      createTitle: "Add branch",
      createDescription: "Check the branch code before saving — it cannot be changed later",
      editTitle: "Edit branch {{code}}",
      create: "Add branch",
      save: "Save changes",
      fields: {
        code: {
          label: "Branch code",
          hint: "5 digits, e.g. 00003 — cannot be changed after adding, because it is part of archived receipt file names",
          locked:
            "The branch code cannot be changed — it is already part of archived receipt file names (add a new branch for a new code)",
        },
        name: {
          label: "Branch name",
        },
        short_name: {
          label: "Short name",
          hint: "Optional · up to 20 characters",
        },
        tax_branch_code: {
          label: "Revenue Department branch code",
          hint: "5 digits · 00000 = head office (only one) · required before receipts can be issued",
        },
        address: {
          label: "Address",
          hint: "Optional · printed on the receipt header",
        },
        tel: {
          label: "Phone",
          hint: "Optional",
        },
        doc_prefix: {
          label: "Bill number prefix",
          hint: "Optional · 1–4 uppercase letters A–Z — bill numbers become <prefix>-RC…, e.g. PT-RC… · leave empty for plain RC…",
          preview: "Bill numbers for this branch will start with {{prefix}}-RC…",
          locked:
            "This branch already has bills — the prefix cannot be changed (old and new bill numbers would be mixed)",
        },
        sort_order: {
          label: "Display order",
          hint: "Whole number 0–9999 · lower numbers come first",
        },
        is_active: {
          label: "Branch is open",
          hint: "When closed, nobody can open bills at this branch · existing bills can still be viewed · can be reopened later",
        },
      },
    },
    validation: {
      code: "The branch code must be 5 digits, e.g. 00001",
      name: "Please enter the branch name",
      taxCode: "The Revenue Department branch code must be 5 digits (00000 = head office)",
      docPrefix: "The bill number prefix must be 1–4 uppercase letters A–Z, e.g. PT",
      sortOrder: "The order must be a whole number from 0 to 9999",
    },
    deactivate: {
      title: "Close branch {{name}}?",
      description:
        "This branch has bills — existing bills and receipts can still be viewed and downloaded as usual, but nobody can open buy-in bills at this branch until it is reopened",
      users: "Users assigned to this branch will immediately be unable to work at it",
      confirm: "Close branch",
      cancel: "Go back and edit",
    },
    saved: {
      created: "Branch {{name}} added",
      updated: "Branch {{name}} saved",
    },
    affected: {
      title: "Branch {{name}} closed — {{count}} users are still assigned to it",
      description:
        "These users can no longer work at this branch · anyone left without a branch must be assigned a new one",
      user: "{{name}} ({{email}}) · {{via}}",
      main: "Main branch",
      allowed: "Allowed branch",
      branchless: "No branch left to work at — assign a new branch",
      manage: "Manage this branch's users",
      dismiss: "Dismiss",
    },
  },
  users: {
    description: "Staff accounts — role, branches they can work at, and password",
    add: "Add user",
    caption: "Users",
    captionFiltered: "Users matching the filters",
    list: "Users",
    empty: "No users yet",
    emptyFiltered: "No users match the filters",
    you: "You",
    edit: "{{name}} — edit",
    filters: {
      label: "Filter users",
      q: {
        label: "Search",
        placeholder: "Name or email",
        hint: "Type and wait a moment, or press Enter · Esc clears the search",
      },
      branch: {
        label: "Branch",
        all: "All branches",
      },
      role: {
        label: "Role",
        all: "All roles",
      },
      active: {
        label: "Status",
        all: "All",
        active: "Active",
        inactive: "Disabled",
      },
      clear: "Clear filters",
    },
    columns: {
      name: "Name",
      email: "Email",
      role: "Role",
      branch: "Main branch",
      allowed: "Allowed branches",
      viewAll: "All branches",
      status: "Status",
      actions: "Password",
    },
    status: {
      active: "Active",
      inactive: "Disabled",
    },
    viewAll: {
      yes: "Yes",
      no: "No",
    },
    branchClosed: "{{branch}} (closed)",
    roleHints: {
      staff: "Open buy-in bills · add and edit customers",
      manager: "Staff work + set the gold price · void bills · view reports",
      accounting: "View bills and reports · monthly export — cannot open buy-in bills",
      admin: "Every menu + manage branches and users",
    },
    form: {
      createTitle: "Add user",
      createDescription: "Leave the password empty to have a temporary password generated, shown once after saving",
      editTitle: "Edit user",
      create: "Add user",
      save: "Save changes",
      self: "This is your own account — you cannot change your own role or disable it; ask another administrator",
      noBranch: "No branch assigned — the user can sign in but cannot work until a branch is assigned",
      fields: {
        name: {
          label: "Name",
        },
        email: {
          label: "Email",
          hint: "Used as the sign-in name — cannot be changed after adding",
          locked: "The email cannot be changed (it is the sign-in name) — add a new user for a new email",
        },
        role: {
          label: "Role",
        },
        branch_id: {
          label: "Main branch",
          none: "No main branch",
          hint: "Home branch — the user can always work here",
        },
        allowed_branch_ids: {
          label: "Additional allowed branches",
          hint: "The user can work at the main branch and every selected branch",
          main: "Main branch",
          closed: "Closed",
          empty: "No open branches yet",
          viewAll:
            "“All branches” is selected — the user can access every open branch, no need to pick them one by one",
        },
        can_view_all: {
          label: "All branches",
          hint: "Every open branch, including branches added later",
        },
        is_active: {
          label: "Account enabled",
          hint: "When disabled, the user cannot sign in and is signed out on every device immediately",
        },
        password: {
          label: "Password",
          hint: "Optional · leave empty to generate one (recommended) · if you set one, at least 10 characters",
        },
      },
    },
    validation: {
      name: "Please enter a name",
      email: "Please enter a valid email, e.g. somchai@example.com",
      passwordShort: "The password must be at least {{min}} characters",
      passwordLong: "The password is longer than {{max}} characters",
    },
    saved: {
      created: "User {{name}} added — they can sign in with the password you set",
      updated: "User {{name}} saved",
      sessionsRevoked: "The user was signed out on {{count}} devices",
    },
    reset: {
      action: "Reset password",
      actionFor: "Reset password for {{name}}",
      self: "You cannot reset your own password here — you would be signed out before seeing the new one; ask another administrator",
      title: "Reset the password for {{name}}?",
      description:
        "A new temporary password will be generated for {{email}} — the old one stops working immediately and the user is signed out on every device",
      confirm: "Reset password",
      pending: "Resetting password…",
      cancel: "Cancel",
    },
  },
  temporaryPassword: {
    title: "Temporary password for {{name}}",
    description: "Sign in with the email {{email}} and this password",
    sessionsRevoked: "The user has been signed out on {{count}} devices",
    label: "Temporary password",
    warning: "Shown only once — send it to the user through a secure channel",
    warningDetail: "Once this window is closed, the password cannot be shown again · if it is lost, reset the password",
    copy: "Copy password",
    copied: "Copied",
    copyFailed: "Could not copy automatically — press Ctrl+C (the password is already selected)",
    close: "Close",
  },
} satisfies typeof th;
