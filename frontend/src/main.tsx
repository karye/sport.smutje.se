import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./stil.css";

const rot = document.getElementById("rot");
if (!rot) throw new Error("Saknar elementet #rot");

createRoot(rot).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// Service workern cachar skalet, så att appen startar även med dålig täckning.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => {
      /* en misslyckad registrering ska inte störa appen */
    });
  });
}
