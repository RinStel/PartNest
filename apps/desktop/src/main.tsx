import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import "./styles.css";
import "./styles/tokens.css";
import "./styles/primitives.css";
import "./styles/shell.css";
import "./styles/inventory.css";
import "./styles/welding.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
