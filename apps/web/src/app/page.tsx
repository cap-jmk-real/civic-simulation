import Link from "next/link";
import { SimulationLab } from "@/components/SimulationLab";

export default function Page() {
  return (
    <main className="mx-auto max-w-[1600px] p-4 lg:p-6">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] pb-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            IP · Information-sharing ABM
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Tune institutional knobs, run bounded-rational agents (heuristic / QRE) or LLM policies,
            inspect concentration & innovation dynamics.
          </p>
        </div>
        <Link
          href="/analysis"
          className="shrink-0 rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text)] hover:bg-[#1a1a1f]"
        >
          Batch analytics
        </Link>
      </header>
      <SimulationLab />
    </main>
  );
}
