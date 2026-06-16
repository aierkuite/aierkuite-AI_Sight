import React from "react";
import ReactDOM from "react-dom/client";

import { App } from "./App";
import "./styles/tokens.css";
import "./styles/fonts.css";
import "./styles/global.css";

const root = document.getElementById("root");

if (root !== null) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
