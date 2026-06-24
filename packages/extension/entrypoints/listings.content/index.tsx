import {
  detectSite,
  isListingPage,
  parseBienici,
  parseCitya,
  parseLeboncoin,
  parseLeboncoinHtml,
  parseSeloger,
  type Listing,
  type Site,
} from "@empir/core";
import { sendRequest } from "@/lib/messages";
import { LISTING_MATCHES } from "@/lib/host-permissions";

const PARSERS: Partial<Record<Site, (doc: Document, url: string) => Listing>> = {
  seloger: parseSeloger,
  bienici: parseBienici,
  citya: parseCitya,
};

function waitForContent(timeoutMs = 20_000): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      const len = document.body?.innerText?.length ?? 0;
      if (len > 1500) return resolve(true);
      if (Date.now() - start > timeoutMs) return resolve(len > 600);
      setTimeout(tick, 500);
    };
    setTimeout(tick, 500);
  });
}

async function extractAndPush(url: string) {
  const site = detectSite(url);
  if (!isListingPage(url)) return;

  let listing: Listing | null = null;

  if (site === "leboncoin") {
    try {
      listing = parseLeboncoin(document, url);
    } catch {
      try {
        const resp = await fetch(url, { credentials: "include" });
        listing = parseLeboncoinHtml(await resp.text(), url);
      } catch {
        listing = null;
      }
    }
  } else {
    const ready = await waitForContent();
    if (!ready) return;
    const parser = site ? PARSERS[site] : undefined;
    if (parser) {
      try {
        listing = parser(document, url);
      } catch {
        listing = null;
      }
    }
  }

  if (listing) {
    await sendRequest({ type: "LISTING_DETECTED", listing }).catch(() => {});
  }
}

export default defineContentScript({
  matches: LISTING_MATCHES as unknown as string[],
  main(ctx) {
    void extractAndPush(location.href);
    ctx.addEventListener(window, "wxt:locationchange", ({ newUrl }: { newUrl: string | URL }) => {
      void extractAndPush(String(newUrl));
    });
  },
});
