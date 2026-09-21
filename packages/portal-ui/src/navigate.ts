/** The one place the viewer leaves the page (a signed PDF URL) — a seam, because jsdom cannot navigate. */
export const goTo = (url: string): void => window.location.assign(url);
