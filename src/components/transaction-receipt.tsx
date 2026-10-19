import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export function TransactionReceipt({ status, hash, onDone, description = "The recipient can now receive the TRST.", uncertainDescription = "This transaction may already be accepted. Check activity before sending again to avoid a duplicate payment." }: { description?: string; uncertainDescription?: string; status: string; hash?: string; onDone: () => void }) {
  if (status === "sending") return <section role="status" className="balance-panel"><h2 className="text-heading">Submitting transaction…</h2><p className="text-ui text-muted-foreground">Waiting for the network to confirm. Do not submit this action again.</p></section>;
  if (status !== "confirmed" && status !== "uncertain") return null;
  return <section data-transaction-receipt tabIndex={-1} role="status" className="balance-panel">
    <h2 className="text-heading">{status === "confirmed" ? "Transaction confirmed" : "Confirmation pending"}</h2>
    <p className="text-ui text-muted-foreground">{status === "confirmed" ? description : uncertainDescription}</p>
    {hash && <details className="text-caption"><summary className="cursor-pointer py-3">Transaction ID</summary><p className="break-all select-text font-mono">{hash}</p></details>}
    <div className="flex flex-wrap gap-2">{status === "uncertain" && <Button asChild><Link to="/pay/offline">Review saved transaction</Link></Button>}<Button asChild variant="outline"><Link to="/history">View activity</Link></Button><Button variant="ghost" onClick={() => {onDone(); requestAnimationFrame(() => document.getElementById("main-content")?.focus());}}>{status === "confirmed" ? "Start another" : "I checked activity"}</Button></div>
  </section>;
}
