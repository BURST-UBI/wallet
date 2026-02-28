import { cn } from "@/lib/utils";

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-md bg-muted animate-shimmer",
        className,
      )}
      style={{
        backgroundImage:
          "linear-gradient(90deg, transparent 0%, oklch(0.3 0.01 285 / 0.3) 50%, transparent 100%)",
        backgroundSize: "200% 100%",
      }}
      {...props}
    />
  );
}

export { Skeleton };
