import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { TransactionReceipt } from "@/components/transaction-receipt";
import { OfflineActionButton } from "@/components/offline-action-button";
import { useTransaction } from "@/hooks/use-transaction";
import { useWallet } from "@/hooks/use-wallet";
import { formatAmount } from "@/lib/utils";
import type { TrstBatch } from "@/lib/types";

type Selection = Pick<TrstBatch, "amount" | "expiry_at" | "status"> & { id: string };
type Review = { selected: Selection[]; rpcUrl: string; address: string | null };

export function MergeBatches({ batches, onChanged }: { batches: TrstBatch[]; onChanged: () => void }) {
  const { rpcUrl, address, watchOnly, isLocked } = useWallet();
  const transaction = useTransaction(rpcUrl, address, "merge_trst");
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<Review | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [review, setReview] = useState<Review | null>(null);
  const [page, setPage] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const available = snapshot?.selected ?? [];
  const chosen = available.filter(batch => selected.includes(batch.id));
  const status = chosen[0]?.status;
  const pageCount = Math.max(1, Math.ceil(available.length / 25));
  const sending = transaction.outcome.status === "sending";
  const completed = ["confirmed", "uncertain"].includes(transaction.outcome.status);
  const total = review?.selected.reduce((sum, batch) => sum + BigInt(batch.amount), 0n);
  const expiries = review?.selected.flatMap(batch => batch.expiry_at === null ? [] : [batch.expiry_at]) ?? [];

  function changeOpen(next: boolean) {
    if (sending) return;
    if (next) {
      setSnapshot({ rpcUrl, address, selected: batches.filter(batch => batch.id && batch.status !== "revoked").map(batch => ({
        id: batch.id!, amount: batch.amount, status: batch.status, expiry_at: batch.expiry_at,
      })) });
      setSelected([]);
      setReview(null);
      setPage(0);
      transaction.clear();
    }
    setOpen(next);
  }

  if (completed || sending) return <TransactionReceipt {...transaction.outcome}
    description="Your batches are combined. Their original provenance is preserved."
    uncertainDescription="Check the saved transaction before combining again. The network may already have accepted it."
    onDone={() => { transaction.clear(); onChanged(); }} />;

  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger asChild><Button ref={trigger} variant="outline" disabled={watchOnly || isLocked || batches.filter(batch => batch.id && batch.status !== "revoked").length < 2}>Combine batches</Button></DialogTrigger>
    <DialogContent onCloseAutoFocus={event => {
      event.preventDefault();
      (trigger.current ?? document.querySelector<HTMLElement>("[data-transaction-receipt]") ?? document.getElementById("main-content"))?.focus();
    }}>
      <DialogHeader>
        <DialogTitle>{review ? "Review combination" : "Combine batches"}</DialogTitle>
        <DialogDescription>{review ? "Nothing moves to another wallet. This combination cannot be undone." : "Choose 2–256 active batches, or expired batches. Keep the two separate."}</DialogDescription>
      </DialogHeader>
      <form className="space-y-4" onSubmit={async event => {
        event.preventDefault();
        if (!review) {
          if (snapshot && chosen.length >= 2 && chosen.length <= 256) setReview({ ...snapshot, selected: chosen });
          return;
        }
        if (await transaction.submit({ selected: review.selected }, review)) { setOpen(false); onChanged(); }
      }}>
        {review ? <div className="space-y-3 text-ui">
          <dl className="space-y-2">
            <div><dt className="text-muted-foreground">Combined amount · {review.selected.length} batches</dt><dd className="break-all tabular-nums">{formatAmount(String(total), 18)} TRST</dd></div>
            <div><dt className="text-muted-foreground">Earliest expiry</dt><dd>{expiries.length ? new Date(Math.min(...expiries) * 1000).toLocaleString() : "No expiry"}</dd></div>
          </dl>
          <p className="text-sm text-muted-foreground">The combined batch keeps the oldest age. Newer TRST may expire sooner. Governance can change the expiry period.</p>
          {review.selected[0].status === "expired" && <p className="text-sm">This remains reputation, not spendable TRST.</p>}
        </div> : <>
          <div className="max-h-72 overflow-y-auto divide-y">
            {available.slice(page * 25, (page + 1) * 25).map(batch => <label key={batch.id} className="flex min-h-11 cursor-pointer items-center gap-3 py-3">
              <input type="checkbox" checked={selected.includes(batch.id)} disabled={!selected.includes(batch.id) && ((!!status && status !== batch.status) || selected.length >= 256)}
                onChange={event => setSelected(previous => event.target.checked ? [...previous, batch.id] : previous.filter(id => id !== batch.id))} />
              <span className="min-w-0 text-sm"><span className="block break-all tabular-nums">{formatAmount(batch.amount, 18)} TRST</span><span className="text-caption text-muted-foreground">{batch.status === "expired" ? "Expired" : "Active"} · {batch.expiry_at === null ? "No expiry" : new Date(batch.expiry_at * 1000).toLocaleDateString()} · {batch.id.slice(0, 8)}</span></span>
            </label>)}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-caption">
            <span role="status">{chosen.length} selected</span>
            {pageCount > 1 && <><Button type="button" variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button><span>{page + 1} / {pageCount}</span><Button type="button" variant="ghost" disabled={page + 1 === pageCount} onClick={() => setPage(page + 1)}>Next</Button></>}
          </div>
        </>}
        {transaction.outcome.status === "error" && <p role="alert" className="break-words text-sm text-destructive">{transaction.outcome.message}</p>}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => review ? setReview(null) : changeOpen(false)}>{review ? "Back" : "Cancel"}</Button>
          {review && <OfflineActionButton request={{kind:"merge",selected:review.selected}} address={review.address} rpcUrl={review.rpcUrl} disabled={sending} />}
          <Button type="submit" disabled={!review && chosen.length < 2}>{review ? "Confirm combination" : "Review"}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
