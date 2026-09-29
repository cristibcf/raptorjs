/**
 * Raptor site shell, built with RaptorJS. The view region re-binds to the route
 * `section()` (no page re-render); within a section, nested routes update the
 * content reactively inside the view. Compiled with RaptorBundle.
 */
import { render } from "raptorjs/dom";
import { installStyles } from "raptorjs/ui/styles";
import { section, navigate } from "./lib/route.ts";
import { Nav } from "./nav.tsx";
import { HomeView } from "./views/home.tsx";
import { LearnView } from "./views/learn.tsx";
import { ReferenceView } from "./views/reference.tsx";
import { PlaygroundView } from "./views/playground.tsx";
import { ComponentsView } from "./views/components.tsx";
import { TutorialView } from "./views/tutorial.tsx";
import { ShowcaseView } from "./views/showcase.tsx";
import { ChangelogView } from "./views/changelog.tsx";

function renderView() {
  switch (section()) {
    case "learn":
      return LearnView();
    case "tutorial":
      return TutorialView();
    case "components":
      return ComponentsView();
    case "reference":
      return ReferenceView();
    case "playground":
      return PlaygroundView();
    case "showcase":
      return ShowcaseView();
    case "changelog":
      return ChangelogView();
    default:
      return HomeView();
  }
}

function FootCol(props: { title: string; links: Array<[string, string]> }) {
  return (
    <div class="col">
      <div class="ct">{props.title}</div>
      {props.links.map((l) => (
        <span on:click={() => navigate(l[1])}>{l[0]}</span>
      ))}
    </div>
  );
}

function Footer() {
  return (
    <footer class="foot">
      <div class="wrap">
        <div class="foot-grid">
          <div>
            <div class="brand" style="cursor:default">
              <span class="logo"></span>
              <span class="name">raptor</span>
            </div>
            <p>A compiler-centric stack for reactive and realtime apps. MIT licensed, zero dependencies.</p>
          </div>
          <FootCol title="Learn" links={[["Learning path", "learn/quick-start"], ["State & reactivity", "learn/state-and-reactivity"], ["Realtime", "learn/realtime-with-raptorwire"], ["Playground", "playground"]]} />
          <FootCol title="Docs" links={[["raptorjs", "reference/core"], ["raptorjs/dom", "reference/dom"], ["@raptor/wire/client", "reference/wire-client"], ["@raptor/engine/bundle", "reference/bundle"]]} />
          <FootCol title="Components" links={[["All components", "components"], ["Buttons", "components/button"], ["Table", "components/table"], ["Charts", "components/line-chart"], ["Headless behaviours", "components/virtualizer"]]} />
          <FootCol title="Project" links={[["Overview", "home"], ["Tutorial", "tutorial"], ["Showcase", "showcase"], ["Changelog", "changelog"]]} />
        </div>
        <div class="foot-base">
          <span>© 2026 Raptor contributors · MIT</span>
          <span>v0.1.0-alpha · not production ready</span>
        </div>
      </div>
    </footer>
  );
}

function App() {
  return (
    <div>
      <Nav />
      <main style="min-height:70vh">{() => renderView()}</main>
      <Footer />
    </div>
  );
}

// The raptorjs/ui stylesheet is opt-in; the Components pages need it.
installStyles();

const root = document.getElementById("app");
if (root) render(App, root);
