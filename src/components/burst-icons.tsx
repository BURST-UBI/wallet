import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { tone?: "color" | "monochrome" };

const palette = {
  orange: "#ED873A",
  green: "#247A50",
  blue: "#2059A6",
  violet: "#7651CB",
};
const diamond = "M10.2 2.8a2.55 2.55 0 0 1 3.6 0l7.4 7.4a2.55 2.55 0 0 1 0 3.6l-7.4 7.4a2.55 2.55 0 0 1-3.6 0l-7.4-7.4a2.55 2.55 0 0 1 0-3.6Z";

function Symbol({ name, tone = "color", children, ...props }: IconProps & { name: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      data-burst-icon={name}
      data-tone={tone}
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export function BrnIcon({ tone = "color", ...props }: IconProps) {
  return (
    <Symbol name="brn" tone={tone} {...props}>
      <path className="burst-icon-body" d={diamond} fill={tone === "color" ? palette.orange : "currentColor"} />
      <circle className="burst-icon-cutout" cx="12" cy="12" r="4.25" fill="#fff" />
      <circle className="burst-icon-core" cx="12" cy="12" r="3" fill={tone === "color" ? palette.green : "currentColor"} />
    </Symbol>
  );
}

export function TrstIcon({ tone = "color", ...props }: IconProps) {
  return (
    <Symbol name="trst" tone={tone} {...props}>
      <path className="burst-icon-body" d={diamond} fill={tone === "color" ? palette.orange : "currentColor"} />
      <circle className="burst-icon-cutout" cx="12" cy="12" r="4.25" fill="#fff" />
      <circle className="burst-icon-core" cx="12" cy="12" r="3" fill={tone === "color" ? palette.blue : "currentColor"} />
    </Symbol>
  );
}

export function WalletIcon({ tone = "color", ...props }: IconProps) {
  const body = tone === "color" ? palette.orange : "currentColor";
  return (
    <Symbol name="wallet" tone={tone} {...props}>
      <path className="burst-icon-body" d="M7 2h9c4 0 6 2 6 6v7.5c0 1.6-.5 2.7-1.5 3.5V9c0-3.3-1.7-5-5-5H3.5C4.3 2.7 5.5 2 7 2Z" fill={body} />
      <path className="burst-icon-body" d="M6 5.5h9c3 0 4.5 1.5 4.5 4.5v7c0 3-1.5 4.5-4.5 4.5H6c-3 0-4.5-1.5-4.5-4.5v-7c0-3 1.5-4.5 4.5-4.5Z" fill={body} />
      <circle className="burst-icon-cutout" cx="6.5" cy="12.5" r="2.75" fill="#fff" />
      <circle className="burst-icon-core" cx="6.5" cy="12.5" r="1.75" fill={tone === "color" ? palette.green : "currentColor"} />
      <circle className="burst-icon-cutout" cx="14.5" cy="12.5" r="2.75" fill="#fff" />
      <circle className="burst-icon-core" cx="14.5" cy="12.5" r="1.75" fill={tone === "color" ? palette.blue : "currentColor"} />
    </Symbol>
  );
}

export function NodeIcon({ tone = "color", ...props }: IconProps) {
  const body = tone === "color" ? palette.violet : "currentColor";
  return (
    <Symbol name="node" tone={tone} {...props}>
      <path className="burst-icon-body" d="M9 1h6c4 0 6 2 6 6v10c0 1.7-.5 2.8-1.5 3.5V7c0-2.7-1.8-4.5-4.5-4.5H6C6.7 1.5 7.7 1 9 1Z" fill={body} />
      <path className="burst-icon-body" d="M8 4h6c3 0 4.5 1.5 4.5 4.5v10c0 3-1.5 4.5-4.5 4.5H8c-3 0-4.5-1.5-4.5-4.5v-10C3.5 5.5 5 4 8 4Z" fill={body} />
      <circle className="burst-icon-cutout" cx="11" cy="12" r="3.75" fill="#fff" />
      <circle className="burst-icon-core" cx="11" cy="12" r="2.5" fill={tone === "color" ? palette.green : "currentColor"} />
    </Symbol>
  );
}

// The two-token relationship is the identity; app launchers use their own silhouettes.
export function BurstMark({ tone = "color", ...props }: IconProps) {
  return (
    <Symbol name="burst" tone={tone} {...props}>
      <path className="burst-icon-body" d={diamond} fill={tone === "color" ? palette.orange : "currentColor"} />
      <circle className="burst-icon-cutout" cx="8" cy="12" r="2.75" fill="#fff" />
      <circle className="burst-icon-core" cx="8" cy="12" r="1.75" fill={tone === "color" ? palette.green : "currentColor"} />
      <circle className="burst-icon-cutout" cx="16" cy="12" r="2.75" fill="#fff" />
      <circle className="burst-icon-core" cx="16" cy="12" r="1.75" fill={tone === "color" ? palette.blue : "currentColor"} />
    </Symbol>
  );
}
