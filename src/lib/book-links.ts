/**
 * "Open at your book" links (optimization #76): the official sportsbook
 * web home for each book the card can name. The card carries no event
 * IDs, so there is no honest event-level deep link to build — the link
 * lands the member on the book's sportsbook, one tap from the game,
 * instead of making them find the book themselves. A book with no
 * verified URL here renders NO link rather than a dead one.
 *
 * URLs verified live 2026-11-14 (all returned 200). Books the odds
 * board names are DraftKings / FanDuel / BetMGM / Caesars; BetRivers is
 * included because brief prices name it. Anything else → null.
 */
const BOOK_URLS: Record<string, string> = {
  draftkings: "https://sportsbook.draftkings.com/",
  fanduel: "https://sportsbook.fanduel.com/",
  betmgm: "https://sports.betmgm.com/en/sports",
  caesars: "https://sportsbook.caesars.com/",
  betrivers: "https://www.betrivers.com/",
};

/** Official sportsbook URL for a book label ("DraftKings"), or null. */
export function bookSportsbookUrl(book: string | null | undefined): string | null {
  if (!book) return null;
  const key = book.toLowerCase().replace(/[^a-z0-9]/g, "");
  return BOOK_URLS[key] || null;
}
