import { useState } from "react";
import { useRpc } from "@/hooks/use-wallet";
import { Button } from "@/components/ui/button";

interface OriginReport {
  origin: string;
  complete: boolean;
  confirmed: boolean;
  origins: {
    hash: string;
    originator: string;
    timestamp: number;
    confirmed: boolean;
    revoked: boolean;
  }[];
}

const PAGE_SIZE = 10;

interface PaymentOrigins {
  payment: string;
  confirmed: boolean;
  provenance: OriginReport;
}

type InspectorTarget = { origin: string; payment?: never } | { payment: string; origin?: never };

export function PaymentOriginDisclosure({ rpcUrl, payment }: { rpcUrl: string; payment: string }) {
  const [expanded, setExpanded] = useState(false);
  return <div className="text-caption text-muted-foreground">
    <Button variant="ghost" size="sm" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
      {expanded ? "Hide original creators" : "View original creators"}
    </Button>
    {expanded && <OriginInspector rpcUrl={rpcUrl} payment={payment} />}
  </div>;
}

export function OriginInspector({ rpcUrl, origin, payment }: { rpcUrl: string } & InspectorTarget) {
  const result = useRpc<OriginReport | PaymentOrigins>(
    payment !== undefined ? "get_payment_origins" : "get_trst_origins",
    payment !== undefined ? { rpcUrl, payment } : { rpcUrl, origin },
  );
  const { loading, error, refetch } = result;
  const data = result.data && ("provenance" in result.data ? result.data.provenance : result.data);
  const [page, setPage] = useState(0);
  if (loading) return <p role="status" className="py-3">Loading original creators…</p>;
  if (error || !data) return <div role="alert" className="space-y-2 py-3">
    <p>Original creators unavailable.</p>
    {error && <p className="break-words">{error}</p>}
    <Button variant="outline" size="sm" onClick={refetch}>Try again</Button>
  </div>;

  const pages = Math.ceil(data.origins.length / PAGE_SIZE);
  const current = Math.min(page, pages - 1);
  return <section aria-label="Original creators" className="space-y-2 py-3">
    <p>Reported by your node. Not an independent proof or a breakdown of amounts.</p>
    {!result.data?.confirmed && <p className="text-warning">{payment !== undefined ? "This payment’s origin history is not fully confirmed." : "This origin is not confirmed."}</p>}
    <ol aria-label="Original BRN payments" className="divide-y">
      {data.origins.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE).map(burn => <li key={burn.hash} className="space-y-1 py-3">
        <p className="break-all font-mono text-foreground">{burn.originator}</p>
        <p>{new Date(burn.timestamp * 1000).toLocaleString()}</p>
        {burn.revoked && <p className="text-destructive">Revoked origin</p>}
        {!burn.confirmed && <p className="text-warning">Unconfirmed payment</p>}
        <details>
          <summary className="min-h-11 cursor-pointer content-center">Original payment ID</summary>
          <p className="break-all font-mono">{burn.hash}</p>
        </details>
      </li>)}
    </ol>
    {pages > 1 && <nav aria-label="Original payments pages" className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" disabled={current === 0} onClick={() => setPage(current - 1)}>Previous</Button>
      <span role="status" className="tabular-nums">{current + 1} / {pages}</span>
      <Button variant="outline" size="sm" disabled={current + 1 === pages} onClick={() => setPage(current + 1)}>Next</Button>
    </nav>}
  </section>;
}
