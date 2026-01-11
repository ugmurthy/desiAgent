/**
 * Web Search Tool
 *
 * Searches the web using DuckDuckGo HTML search (no API key needed)
 */

import { z } from 'zod';
import * as cheerio from 'cheerio';
import { BaseTool, type ToolContext } from './base.js';

const webSearchInputSchema = z.object({
  query: z.string().describe('The search query - could be list of bulleted queries'),
  limit: z.number().int().min(1).max(20).default(10).describe('Number of results to return per query'),
});

type WebSearchInput = z.infer<typeof webSearchInputSchema>;

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export class WebSearchTool extends BaseTool<any, SearchResult[]> {
  name = 'webSearch';
  description = 'Search the web for information using DuckDuckGo';
  inputSchema: any = webSearchInputSchema;

  async execute(input: WebSearchInput, ctx: ToolContext): Promise<SearchResult[]> {
    ctx.logger.info(`╰─Searching web...input for ${input.query.slice(0, 50)}...`);
    ctx.emitEvent?.progress?.(`🔎 for ${input.query.slice(0, 50)}...`);
    
    const queries = this.extractSearchQueries(input.query);
    const allResults: SearchResult[][] = [];

    for (const query of queries) {
      try {
        const response = await this.withTimeout(
          fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`),
          10000,
          'Web search timed out'
        );

        if (!response.ok) {
          throw new Error(`Search failed with status ${response.status}`);
        }

        const html = await response.text();
        const results = this.parseSearchResults(html, input.limit);

        ctx.logger.info(`╰─Found ${results.length} search results for query: ${query.slice(0, 50)}...`);
        allResults.push(results);
      } catch (error) {
        ctx.logger.error({ err: error, query }, '╰─Web search failed');
        throw error;
      }
    }

    ctx.emitEvent?.progress?.(`🔎 Found ${allResults.flat().length} results`);
    return allResults.flat();
  }

  private extractSearchQueries(text: string): string[] {
    const lines: string[] = text.trim().split('\n');

    const queries: string[] = lines
      .map((line: string) => {
        let cleaned: string = line
          .trim()
          .replace(/^(\d+\.|\*\s*|\-\s*|•\s*)/, '')
          .trim();

        const match: RegExpMatchArray | null = cleaned.match(/"([^"]*)"/);
        if (match) {
          return match[1];
        }

        return cleaned;
      })
      .filter((query: string) => query.length > 0);

    return queries;
  }

  private parseSearchResults(html: string, limit: number): SearchResult[] {
    const results: SearchResult[] = [];

    try {
      const $ = cheerio.load(html);

      $('.result').each((_, element) => {
        if (results.length >= limit) return;

        const titleLink = $(element).find('.result__a');
        const snippetElem = $(element).find('.result__snippet');

        const href = titleLink.attr('href');
        const title = titleLink.text().trim();
        const snippet = snippetElem.text().trim();

        if (href && title) {
          const url = this.cleanUrl(href);
          if (url) {
            results.push({ title, url, snippet });
          }
        }
      });
    } catch (error) {
      // If parsing fails, return fallback
    }

    if (results.length === 0) {
      return [{
        title: 'Search results unavailable',
        url: 'https://duckduckgo.com',
        snippet: 'Web search completed but parsing failed. Consider using a different search method.',
      }];
    }

    return results;
  }

  private cleanUrl(url: string): string {
    const match = url.match(/uddg=([^&]+)/);
    if (match) {
      try {
        return decodeURIComponent(match[1]);
      } catch {
        return '';
      }
    }
    return url;
  }
}
