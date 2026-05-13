import { defineReactComponent } from "handoff-app";
import type { AccountDeleteProps } from "@petvet/ui";
import AccountDelete from "./AccountDelete";

const genericArgs: Partial<AccountDeleteProps> = {};

const exampleArgs: Partial<AccountDeleteProps> = {
  heading: "Delete account",
  body: "We're sorry to see you go. Deleting your account will permanently remove your data and settings. If you're experiencing an issue, you might want to contact support before deleting your account.",
  deleteLabel: "Delete Account",
};

export default defineReactComponent(AccountDelete, {
  id: "account_delete",
  name: "Account delete",
  image: "/images/components/account_delete.png",
  description:
    "Delete-account danger card: bold teal heading, warning paragraph, and a right-aligned red Delete Account button. Intended to sit at the bottom of the Account Settings page.",
  group: "Account",
  type: "block",
  shouldDo: [
    "Wire `onDelete` to a confirmation dialog before calling the deletion API.",
  ],
  shouldNotDo: [
    "Do not allow account deletion without a confirmation step.",
  ],
  entries: {
    component: "./AccountDelete.tsx",
    scss: "./styles.scss",
  },
  previews: {
    default: {
      title: "Generic (default copy)",
      args: genericArgs,
    },
    example: {
      title: "Example (screenshot copy)",
      args: exampleArgs,
    },
  },
  properties: {
    heading: {
      name: "Heading",
      type: "text",
      generic: "true",
      description: "Section title.",
      default: "Delete account",
    },
    body: {
      name: "Body",
      type: "text",
      generic: "true",
      description: "Warning paragraph.",
      default:
        "We're sorry to see you go. Deleting your account will permanently remove your data and settings.",
    },
    deleteLabel: {
      name: "Delete button label",
      type: "text",
      generic: "true",
      description: "Red destructive button.",
      default: "Delete Account",
    },
  },
});
