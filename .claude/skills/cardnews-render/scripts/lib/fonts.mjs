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
    (specs) => specs.filter((s) => !document.fonts.check(s)),
    REQUIRED,
  );
}
