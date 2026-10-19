import { useState } from "react";
import { useRpc } from "@/hooks/use-wallet";
import type { TrstPortfolio } from "@/lib/types";
import { formatAmount } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { OriginInspector } from "@/components/origin-inspector";

const PAGE_SIZE = 5;

export function RevocationNotice({ rpcUrl, address }: { rpcUrl: string; address: string }) {
  const { data, error } = useRpc<TrstPortfolio>("get_trst_portfolio", { rpcUrl, expectedAccount: address }, 10_000);
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(0);
  const revoked = data?.batches.filter(batch => batch.status === "revoked") ?? [];
  const hasRevoked = data && /^[0-9]+$/.test(data.total_revoked) && BigInt(data.total_revoked) > 0n;
  const pages = Math.ceil(revoked.length / PAGE_SIZE);
  const current = Math.max(0, Math.min(page, pages - 1));

  // Keep the live region mounted so newly observed revocation is announced.
  return <section aria-label="TRST revocation notice" className={hasRevoked ? "mb-4 border-b pb-3" : undefined}>
    <p role="status" aria-atomic="true" className="text-ui">
      {hasRevoked && <><span className="tabular-nums text-destructive">{formatAmount(data.total_revoked)} TRST revoked.</span>{" "}
        <span className="text-muted-foreground">Affected payment origins are no longer valid. These funds cannot be spent.</span></>}
    </p>
    {hasRevoked && <>
      {error && <p role="status" className="text-caption text-muted-foreground">Unable to refresh. Showing the last known revocation.</p>}
      <Button variant="ghost" size="sm" aria-expanded={expanded} aria-controls="revoked-origins" onClick={() => setExpanded(!expanded)}>
        {expanded ? "Hide affected origins" : "Review affected origins"}
      </Button>
      {expanded && <div id="revoked-origins" className="text-caption">
        <p className="text-muted-foreground">Reported by your node. An upheld fraud challenge or a reversed reward judgment can invalidate an origin. A later review may restore it.</p>
        <p className="py-2 tabular-nums">Exact revoked amount: {formatAmount(data.total_revoked, 18)} TRST</p>
        {error ? <p>Reconnect before reviewing current origins.</p> : <>
          {revoked.length === 0 && <p>Origin details are unavailable from this node.</p>}
          <ul className="divide-y" aria-label="Affected holdings">
            {revoked.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE).map((batch, index) => <li key={batch.id ?? `${batch.origin}:${index}`} className="py-2">
              <p className="tabular-nums">{formatAmount(batch.amount, 18)} TRST revoked</p>
              <OriginInspector rpcUrl={rpcUrl} origin={batch.origin} />
            </li>)}
          </ul>
          {pages > 1 && <nav aria-label="Affected holdings pages" className="flex items-center gap-2">
            <Button variant="ghost" size="sm" disabled={current === 0} onClick={() => setPage(current - 1)}>Previous</Button>
            <span>{current + 1} / {pages}</span>
            <Button variant="ghost" size="sm" disabled={current + 1 === pages} onClick={() => setPage(current + 1)}>Next</Button>
          </nav>}
        </>}
      </div>}
    </>}
  </section>;
}
