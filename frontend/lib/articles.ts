import { api, type ArticleResponse } from "./api";
import type { Citation } from "./citations";

// Articles never change while the app runs, so each is fetched once: a hover
// preview warms the cache and the sheet opened by the click shows instantly.
const cache = new Map<string, Promise<ArticleResponse>>();

export function loadArticle(codeKey: string, number: string): Promise<ArticleResponse> {
  const key = `${codeKey}/${number}`;
  let p = cache.get(key);
  if (!p) {
    p = api.article(codeKey, number);
    p.catch(() => cache.delete(key)); // let a later attempt retry
    cache.set(key, p);
  }
  return p;
}

/** The point a citation refers to ("Пункт 1"), or the article's first point. */
export function citedPoint(article: ArticleResponse, citation: Extract<Citation, { kind: "law" }>) {
  return article.points.find((p) => citation.point !== "" && p.point === citation.point) ?? article.points[0];
}
