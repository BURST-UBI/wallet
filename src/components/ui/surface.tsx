import type { HTMLAttributes } from "react";
import { Card } from "@/components/ui/card";

export function Surface(props: HTMLAttributes<HTMLDivElement>) {
  return <Card {...props} />;
}
