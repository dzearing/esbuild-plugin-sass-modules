export default function loadStylesheet(css) {
  const styleElement = document.createElement("style");

  styleElement.textContent = css;

  document.head.appendChild(styleElement);
}
