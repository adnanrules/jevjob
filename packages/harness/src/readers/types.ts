/** One posting read from its URL. The employer's name comes from whoever supplied the URL (e.g. the feed). */
export interface Posting {
  title: string;
  location: string;
  /** YYYY-MM-DD when the source states it. */
  postedAt?: string | undefined;
  postingUrl: string;
  applyUrl: string;
  /** Plain text with list structure kept (the requirement extractor depends on it). */
  description: string;
}
