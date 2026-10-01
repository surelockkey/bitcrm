/**
 * `next/font/google` for vitest. Next compiles the font loaders away at build
 * time, so the real module has nothing to call; any component that picks a
 * font (the Reports hub uses Workiz's Poppins) would fail to import under
 * test. Here every loader hands back a plain class instead.
 */
const loader = () => ({
  className: "",
  style: { fontFamily: "sans-serif" },
  variable: "",
});

export const Poppins = loader;
export const Geist = loader;
export const Geist_Mono = loader;
