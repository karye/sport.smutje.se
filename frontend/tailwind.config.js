/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Samma tokens som class.smutje.se, så att apparna känns släkt.
        bakgrund: "hsl(var(--bakgrund) / <alpha-value>)",
        sida: "hsl(var(--sida) / <alpha-value>)",
        text: "hsl(var(--text) / <alpha-value>)",
        dampad: "hsl(var(--dampad) / <alpha-value>)",
        kant: "hsl(var(--kant) / <alpha-value>)",
        primar: "hsl(var(--primar) / <alpha-value>)",
        fel: "hsl(var(--fel) / <alpha-value>)",
        // Saknades helt: varje bg-varning/10 och text-varning i koden genererade ingen CSS, så
        // olösta krockar, "Dubbelbokat" och varningstrianglarna målades i kortets egen textfärg.
        varning: "hsl(var(--varning) / <alpha-value>)",
      },
      fontSize: {
        // Golv: 12 px. Mindre text än så förekommer inte.
        meta: ["0.75rem", { lineHeight: "1rem" }],
        brod: ["0.875rem", { lineHeight: "1.35rem" }],
        titel: ["0.9375rem", { lineHeight: "1.25rem" }],
      },
    },
  },
  plugins: [],
};
