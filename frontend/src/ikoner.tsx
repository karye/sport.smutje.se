/**
 * Egna ikoner, ritade som stroke-SVG.
 *
 * Varför inte ett ikonpaket: de flesta paket med klubbmärken är licensierade för "personal desktop
 * use only", och repo:t är publikt. De här är mina egna, följer textfärgen via `currentColor`,
 * skalas utan att bli suddiga och väger några hundra byte tillsammans.
 *
 * Samma mått överallt: 24 × 24 ruta, 1,75 stroke, runda ändar. Då sitter de på samma höjd i
 * rader med text, vilket `⚠`, `⚑`, `‹` och `›` aldrig gjorde.
 */
import type { ReactNode } from "react";

interface Props {
  className?: string;
  title?: string;
}

function Svg({ children, className, title }: Props & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? "h-4 w-4"}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title && <title>{title}</title>}
      {children}
    </svg>
  );
}

/* ------------------------------------------------------------------ sporter */

/** Bandy: klubban och pucken. */
export const Bandy = (p: Props) => (
  <Svg {...p}>
    <path d="M5 21 15.5 7.5" />
    <path d="M15.5 7.5c1.6-2.1 3.4-3.1 5.5-3" />
    <ellipse cx="6" cy="20" rx="3" ry="1.6" />
  </Svg>
);

/** Innebandy: bollen med hål. */
export const Innebandy = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="9" cy="10" r="1" />
    <circle cx="14.5" cy="9.5" r="1" />
    <circle cx="15" cy="15" r="1" />
    <circle cx="9.5" cy="15.5" r="1" />
  </Svg>
);

/** Fotboll: bollen med femhörningen. */
export const Fotboll = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5 16 10.4l-1.5 4.7h-5L8 10.4z" />
    <path d="M12 3.5v4M4.2 9.6l3.8.8M19.8 9.6l-3.8.8M8.7 21l.8-4.4M15.3 21l-.8-4.4" />
  </Svg>
);

/** Scout: kompassen. */
export const Scout = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="m14.8 9.2-1.6 4.4-4.4 1.6 1.6-4.4z" />
    <path d="M12 3.5v1.4M12 19.1v1.4M3.5 12h1.4M19.1 12h1.4" />
  </Svg>
);

/** Fler sporter än de fyra: en vanlig boll duger som igenkänning. */
export const Sport = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M7 7.5c2 1.6 3.4 4 3.4 9M17 7.5c-2 1.6-3.4 4-3.4 9" />
  </Svg>
);

const SPORTIKONER: Record<string, (p: Props) => ReactNode> = {
  bandy: Bandy,
  innebandy: Innebandy,
  fotboll: Fotboll,
  scout: Scout,
};

/** Ikon för en sport, med bollen som reserv för okända sporter. */
export function SportIkon({ sport, ...p }: Props & { sport: string }) {
  const Ikon = SPORTIKONER[sport.toLowerCase()] ?? Sport;
  return <Ikon {...p} />;
}

/* ------------------------------------------------------------------ gränssnitt */

/** Varning: olöst krock eller inställt pass. */
export const Varning = (p: Props) => (
  <Svg {...p}>
    <path d="M10.6 4.2 2.9 17.4a1.6 1.6 0 0 0 1.4 2.4h15.4a1.6 1.6 0 0 0 1.4-2.4L13.4 4.2a1.6 1.6 0 0 0-2.8 0z" />
    <path d="M12 9.5v4M12 16.6v.1" />
  </Svg>
);

/** Flagga: pass utan ansvarig. */
export const Flagga = (p: Props) => (
  <Svg {...p}>
    <path d="M6 21V4" />
    <path d="M6 4.5h11.5l-1.8 3.6 1.8 3.6H6" />
  </Svg>
);

export const Vanster = (p: Props) => (
  <Svg {...p}>
    <path d="m14.5 5.5-6.5 6.5 6.5 6.5" />
  </Svg>
);

export const Hoger = (p: Props) => (
  <Svg {...p}>
    <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />
  </Svg>
);

/** Uppdatera: cirkelbåge med pilspets. */
export const Uppdatera = (p: Props) => (
  <Svg {...p}>
    <path d="M20 12a8 8 0 1 1-2.6-5.9" />
    <path d="M20 4v4.5h-4.5" />
  </Svg>
);

/** Kryss: stäng arket. */
export const Stang = (p: Props) => (
  <Svg {...p}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Svg>
);
