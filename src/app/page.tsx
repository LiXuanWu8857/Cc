import { redirect } from "next/navigation";

// The app entry point. Middleware handles auth gating; land users on the
// dashboard (or /login if signed out).
export default function Index() {
  redirect("/dashboard");
}
