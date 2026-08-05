import React from "react";
import { createRoot } from "react-dom/client";
import BlockingBoard from "./BlockingBoard.jsx";
import "./index.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BlockingBoard />
  </React.StrictMode>
);
