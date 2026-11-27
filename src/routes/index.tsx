import { createFileRoute } from "@tanstack/react-router";
import { DeskApp } from "@/components/desk/desk-app";
import { getDesk } from "@/lib/news/desk.functions";
import { EMPTY_DESK } from "@/lib/news/types";

export const Route = createFileRoute("/")({
  loader: async () => {
    try {
      return await getDesk();
    } catch (err) {
      console.error("[padma] loader", err);
      return { ...EMPTY_DESK, warnings: ["The wires could not be pulled."], fetchedAt: new Date().toISOString() };
    }
  },
  component: Home,
});

function Home() {
  const initial = Route.useLoaderData();
  return <DeskApp initial={initial} />;
}
