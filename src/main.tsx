import React from "react";
import ReactDOM from "react-dom/client";
import App from "./StaticApp";
import EnglishApp from "./EnglishApp";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{new URLSearchParams(window.location.search).get("lang") === "en" || window.location.pathname.includes("/en/") ? <EnglishApp /> : <App />}</React.StrictMode>,
);
