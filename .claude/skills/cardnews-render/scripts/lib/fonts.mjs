/**
 * Positive assertion that the brand faces actually loaded.
 *
 * document.fonts.ready resolving is NOT evidence: it resolves once loading has
 * settled, including when every face failed and the page fell back. This checks
 * that the specific faces the brand system depends on are usable.
 */
const REQUIRED = [
  '800 80px Montserrat',
  '700 40px Montserrat',
  '600 32px Montserrat',
  '900 40px Inter',
  '700 28px Inter',
  '400 24px Inter',
];

export async function assertFontsLoaded(page) {
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate(
    async (specs) => {
      /* load() BEFORE check(). @font-face is lazy: a face is only fetched when
       * some element on the page actually uses it. check() alone therefore
       * asks "does this page use all six brand weights?", not "are the six
       * brand weights available?" — and the first reel, which has no Inter-900
       * element, failed for no real reason.
       *
       * This does not blunt the check. load() resolves against the @font-face
       * rules in the stylesheet, not against a wish: if the woff2 is missing or
       * corrupt the FontFace ends in status "error" and check() still returns
       * false. Verified by moving assets/fonts/*.woff2 aside — all six specs
       * still came back missing (task-10-report.md §Fix 4). What disappears is
       * only the accidental extra condition "this page must already be setting
       * that weight", which was never what this module is for. */
      await Promise.all(specs.map((s) => document.fonts.load(s).catch(() => {})));
      return specs.filter((s) => !document.fonts.check(s));
    },
    REQUIRED,
  );
}
