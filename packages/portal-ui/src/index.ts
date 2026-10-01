export { DocumentFrame, prepareDocumentHtml, COMPACT_BELOW } from "./document-frame";
export { PortalDocumentViewer, type DocumentLoaders } from "./document-viewer";
export * from "./lib";
export * from "./payment-lib";
// `./payment-panel` is deliberately NOT re-exported here: it pulls in Stripe.js,
// and apps/web (the staff preview) imports this barrel but never pays anything.
// The portal imports it by path — see apps/portal/components/portal-app.tsx.
export { DocumentCard, InvalidPortalLink, PortalLoadError, PortalSkeleton, PortalView, type PortalActions, type PortalSelection } from "./portal-view";
// `./sign-pay-panel` embeds the payment panel (Stripe.js): imported by path, like `./payment-panel`.
export { SignaturePad } from "./signature-pad";
export { StatusBadge } from "./status-badge";
export { useLoad, type Loaded } from "./use-load";
