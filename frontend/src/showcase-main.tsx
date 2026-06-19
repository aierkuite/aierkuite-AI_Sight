import React from "react";
import ReactDOM from "react-dom/client";

import { ShowcaseApp } from "./ShowcaseApp";
import "./styles/tokens.css";
import "./styles/fonts.css";
import "./styles/global.css";

const root = document.getElementById("root");

if (root !== null) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <ShowcaseApp />
    </React.StrictMode>,
  );
}
