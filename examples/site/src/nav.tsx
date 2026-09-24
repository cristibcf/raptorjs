/** Top navigation (light editorial theme). Active state reactive on section(). */
import { section, navigate } from "./lib/route.ts";

function link(name: string, label: string) {
  return (
    <span class={() => "nav-link" + (section() === name ? " active" : "")} on:click={() => navigate(name)}>
      {label}
    </span>
  );
}

export function Nav() {
  return (
    <header class="nav">
      <div class="wrap nav-inner">
        <div class="brand" on:click={() => navigate("home")}>
          <span class="logo"></span>
          <span class="name">raptor</span>
          <span class="ver">v0.1.0-alpha</span>
        </div>
        <nav class="links">
          {link("home", "Overview")}
          {link("learn", "Learn")}
          {link("components", "Components")}
          {link("reference", "Docs")}
          {link("playground", "Playground")}
        </nav>
        <div class="nav-right">
          <div class="npm">
            <span class="d">$</span>
            <span>npm i @raptor/dom</span>
            <span class="cp" on:click={() => navigator.clipboard?.writeText("npm i @raptor/dom")}>copy</span>
          </div>
          <a class="ghost-btn" href="https://github.com" target="_blank" rel="noreferrer">GitHub</a>
        </div>
      </div>
    </header>
  );
}
