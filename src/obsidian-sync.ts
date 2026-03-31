import { App, TFile, normalizePath } from "obsidian";
import type { XBookmarksSettings, XTweet } from "./types";

export class ObsidianSync {
  private app: App;
  private settings: XBookmarksSettings;

  constructor(app: App, settings: XBookmarksSettings) {
    this.app = app;
    this.settings = settings;
  }

  buildFilename(tweet: XTweet): string {
    // Parse X's date format: "Mon Mar 15 12:30:00 +0000 2025"
    const date = new Date(tweet.createdAt);
    const dateStr = isNaN(date.getTime())
      ? "0000-00-00"
      : date.toISOString().split("T")[0];

    // X Articles have text like "http://x.com/i/article/123..." — give them a clean title
    const rawText = tweet.text ?? "";
    const articleMatch = rawText.match(/x\.com\/i\/article\/(\d+)/);
    const sanitized = articleMatch
      ? `X Article ${articleMatch[1].slice(-8)}`
      : rawText
          .replace(/[\\/:*?"<>|#[\]^]/g, "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 50)
          .replace(/\s\S*$/, "") // cut at last word boundary
          .trimEnd();

    const screenName = tweet.author?.screenName ?? "unknown";
    return `${dateStr} @${screenName} - ${sanitized}.md`;
  }

  buildNoteContent(tweet: XTweet, tags: string[]): string {
    const screenName = tweet.author?.screenName ?? "unknown";
    const displayName = tweet.author?.name ?? screenName;
    const tweetUrl = `https://x.com/${screenName}/status/${tweet.id}`;
    const now = new Date();
    const tweetDate = new Date(tweet.createdAt);

    const tweetDateStr = isNaN(tweetDate.getTime())
      ? now.toISOString().split("T")[0]
      : tweetDate.toISOString().split("T")[0];
    const syncedDateStr = now.toISOString().split("T")[0];

    // Build YAML frontmatter — Dataview-optimized (dates as YYYY-MM-DD, native booleans)
    const tagsYaml =
      tags.length > 0
        ? `tags:\n${tags.map((t) => `  - ${t}`).join("\n")}`
        : "tags: []";

    const authorNameEscaped = displayName.replace(/"/g, '\\"');

    const frontmatter = [
      "---",
      `id: "${tweet.id}"`,
      `author: "@${screenName}"`,
      `author_name: "${authorNameEscaped}"`,
      `url: "${tweetUrl}"`,
      `tweet_date: ${tweetDateStr}`,
      `synced_at: ${syncedDateStr}`,
      tagsYaml,
      `has_media: ${tweet.mediaUrls.length > 0}`,
      "status: active",
      "source: x-bookmarks",
      "---",
    ].join("\n");

    // Detect X Article links (long-form posts — tweet text is just the article URL)
    const isArticle = /x\.com\/i\/article\/(\d+)/.test(tweet.text ?? "");

    // Body
    const bodyLines: string[] = [
      `**[@${screenName}](https://x.com/${screenName})** — [View on X ↗](${tweetUrl})`,
      "",
    ];

    if (isArticle) {
      if (tweet.articleContent) {
        const ac = tweet.articleContent;
        if (ac.title) {
          bodyLines.push(`## ${ac.title}`);
          bodyLines.push("");
        }
        if (ac.coverImageUrl) {
          bodyLines.push(`![](${ac.coverImageUrl})`);
          bodyLines.push("");
        }
        if (ac.text) {
          bodyLines.push(ac.text);
          bodyLines.push("");
        }
        bodyLines.push(`[Open full article on X ↗](${tweet.text.trim()})`);
      } else {
        bodyLines.push(`> [!note] X Article`);
        bodyLines.push(`> This is a long-form X Article. [Open to read ↗](${tweet.text.trim()})`);
      }
    } else {
      bodyLines.push(tweet.text ?? "");
    }

    bodyLines.push("");

    // Media
    if (tweet.mediaUrls.length > 0) {
      for (const url of tweet.mediaUrls) {
        bodyLines.push(`![](${url})`);
      }
      bodyLines.push("");
    }

    // Videos — use HTML video tag for inline playback in Obsidian reading view
    if (tweet.videoUrls.length > 0) {
      for (const url of tweet.videoUrls) {
        bodyLines.push(`<video controls style="width:100%;max-width:720px" src="${url}"></video>`);
      }
      bodyLines.push("");
    }

    // Quoted tweet
    if (tweet.quotedTweet) {
      const qt = tweet.quotedTweet;
      const qtScreenName = qt.author?.screenName ?? "unknown";
      const qtUrl = `https://x.com/${qtScreenName}/status/${qt.id}`;
      const qtIsArticle = /x\.com\/i\/article\/(\d+)/.test(qt.text ?? "");

      bodyLines.push("---");
      bodyLines.push("");
      if (qtIsArticle) {
        bodyLines.push(`**Quoted:** [@${qtScreenName}](https://x.com/${qtScreenName}) shared an [X Article ↗](${qt.text.trim()})`);
      } else {
        bodyLines.push(`**Quoted [@${qtScreenName}](${qtUrl}):**`);
        bodyLines.push("");
        bodyLines.push(qt.text ?? "");
      }
      bodyLines.push("");
    }

    // Sentinel for the delete button — post processor injects it here (bottom of note)
    bodyLines.push('<div class="xbm-actions"></div>');

    return `${frontmatter}\n\n${bodyLines.join("\n")}`;
  }

  async ensureFolder(folderPath: string): Promise<void> {
    const normalized = normalizePath(folderPath);
    if (!this.app.vault.getAbstractFileByPath(normalized)) {
      await this.app.vault.createFolder(normalized);
    }
  }

  private getMonthFolder(tweet: XTweet): string {
    const date = new Date(tweet.createdAt);
    const month = isNaN(date.getTime())
      ? "0000-00"
      : date.toISOString().slice(0, 7);
    return normalizePath(`${this.settings.bookmarksFolder}/${month}`);
  }

  async createNote(tweet: XTweet, tags: string[]): Promise<TFile> {
    await this.ensureFolder(this.settings.bookmarksFolder);
    const monthFolder = this.getMonthFolder(tweet);
    await this.ensureFolder(monthFolder);
    const filename = this.buildFilename(tweet);
    const filePath = normalizePath(`${monthFolder}/${filename}`);
    const content = this.buildNoteContent(tweet, tags);

    const existing = this.app.vault.getAbstractFileByPath(filePath);
    if (existing instanceof TFile) {
      return existing;
    }

    return await this.app.vault.create(filePath, content);
  }

  async archiveNote(file: TFile): Promise<void> {
    await this.ensureFolder(this.settings.archiveFolder);

    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm.status = "archived";
      fm.archived_at = new Date().toISOString().split("T")[0];
    });

    const newPath = normalizePath(
      `${this.settings.archiveFolder}/${file.name}`
    );
    await this.app.vault.rename(file, newPath);
  }

  isSynced(tweetId: string): boolean {
    return this.settings.syncedTweetIds.includes(tweetId);
  }

  markSynced(tweetId: string): void {
    if (!this.settings.syncedTweetIds.includes(tweetId)) {
      this.settings.syncedTweetIds.push(tweetId);
    }
  }
}
