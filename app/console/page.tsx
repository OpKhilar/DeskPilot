import AgentConsole from "@/components/console/AgentConsole";

export const metadata = {
  title: "DeskPilot — Agent Console",
};

export default function ConsolePage() {
  return (
    <main className="mx-auto w-full max-w-[112rem] px-4 py-5 sm:px-6">
      <AgentConsole />
    </main>
  );
}
