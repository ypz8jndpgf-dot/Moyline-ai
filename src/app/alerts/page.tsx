import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import AlertsManager from "./alerts-manager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Line Alerts | MoyLine AI" };

export default async function AlertsPage() {
  const session = await auth();
  if (!session?.user?.email) {
    redirect("/api/auth/signin");
  }
  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <p className="text-xs font-bold uppercase tracking-[0.3em] text-gold mb-2">Limit orders for betting</p>
      <h1 className="font-display text-4xl sm:text-5xl mb-2">
        LINE <span className="gold-text">ALERTS</span>
      </h1>
      <p className="text-muted text-sm mb-8 max-w-2xl">
        Set a target line on any game. When the books hit your number, you get a push notification instantly. No more watching the screen.
      </p>
      <AlertsManager />
    </div>
  );
}
