import { createFileRoute, stripSearchParams } from "@tanstack/react-router";
import { UsersSearchSchema } from "@/features/settings/users-search";
import { UsersPage } from "@/features/settings/users-page";

export const Route = createFileRoute("/_app/settings/users")({
  validateSearch: UsersSearchSchema,
  search: { middlewares: [stripSearchParams({ q: "" })] },
  staticData: { title: "จัดการผู้ใช้", crumbs: [{ title: "ตั้งค่า" }] },
  component: UsersPage,
});
