import { useEffect, useRef } from "react";

const VIBE_JAM_SCRIPT_SRC = "https://jam.pieter.com/2026/widget.js";
const VIBE_JAM_WIDGET_HREF = "https://vibej.am";

function isVibeJamScriptNode(node: Node): node is HTMLScriptElement {
  return node instanceof HTMLScriptElement && node.src === VIBE_JAM_SCRIPT_SRC;
}

function isVibeJamWidgetAnchor(node: Node): node is HTMLAnchorElement {
  return node instanceof HTMLAnchorElement &&
    node.href.replace(/\/$/, "") === VIBE_JAM_WIDGET_HREF &&
    node.textContent?.includes("Vibe Jam 2026") === true &&
    node.style.position === "fixed";
}

function nodeContainsVibeJamArtifact(node: Node): boolean {
  if (isVibeJamScriptNode(node) || isVibeJamWidgetAnchor(node)) {
    return true;
  }
  if (!(node instanceof Element)) {
    return false;
  }
  return Array.from(node.querySelectorAll("a, script")).some(
    (child) => isVibeJamScriptNode(child) || isVibeJamWidgetAnchor(child),
  );
}

function getWidgetAnchors(): HTMLAnchorElement[] {
  return Array.from(document.querySelectorAll("a")).filter(
    isVibeJamWidgetAnchor,
  );
}

function getWidgetScripts(): HTMLScriptElement[] {
  return Array.from(document.querySelectorAll("script")).filter(
    isVibeJamScriptNode,
  );
}

function removeVibeJamArtifacts(): void {
  for (const anchor of getWidgetAnchors()) {
    anchor.remove();
  }
  for (const script of getWidgetScripts()) {
    script.remove();
  }
}

function dedupeVibeJamArtifacts(): void {
  const anchors = getWidgetAnchors();
  for (const anchor of anchors.slice(1)) {
    anchor.remove();
  }

  const scripts = getWidgetScripts();
  for (const script of scripts.slice(1)) {
    script.remove();
  }
}

function ensureVibeJamWidgetLoaded(): void {
  if (getWidgetAnchors().length > 0 || getWidgetScripts().length > 0) {
    dedupeVibeJamArtifacts();
    return;
  }

  const script = document.createElement("script");
  script.async = true;
  script.src = VIBE_JAM_SCRIPT_SRC;
  script.dataset.bitwarsWidget = "vibe-jam-2026";
  document.body.appendChild(script);
}

export function useVibeJamWidget(enabled: boolean): void {
  const enabledRef = useRef(enabled);

  useEffect(() => {
    enabledRef.current = enabled;

    if (enabled) {
      ensureVibeJamWidgetLoaded();
      return;
    }

    removeVibeJamArtifacts();
  }, [enabled]);

  useEffect(() => {
    const observer = new MutationObserver((records) => {
      const sawArtifact = records.some((record) =>
        Array.from(record.addedNodes).some(nodeContainsVibeJamArtifact)
      );

      if (!sawArtifact) {
        return;
      }

      if (enabledRef.current) {
        dedupeVibeJamArtifacts();
        return;
      }

      removeVibeJamArtifacts();
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    return () => {
      observer.disconnect();
      removeVibeJamArtifacts();
    };
  }, []);
}
