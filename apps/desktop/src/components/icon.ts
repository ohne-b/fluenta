import MdiIcon from "@mdi/react";

// MDI's Webpack/CommonJS bundle retains an extra default export in Vite dev.
const Icon =
  (MdiIcon as typeof MdiIcon & { default?: typeof MdiIcon }).default ?? MdiIcon;
export default Icon;
