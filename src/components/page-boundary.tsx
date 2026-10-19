import { Component, Suspense, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export class PageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <section className="min-h-48 space-y-4">
          <p role="alert">This screen couldn’t be opened.</p>
          <Button asChild variant="outline"><Link to="/">Back to wallet</Link></Button>
        </section>
      );
    }
    return (
      <Suspense fallback={<p role="status" className="min-h-48 text-muted-foreground">Loading screen…</p>}>
        {this.props.children}
      </Suspense>
    );
  }
}
