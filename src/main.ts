import { Plugin, Notice, TFile, MarkdownView, addIcon, normalizePath } from "obsidian";
import type { XBookmarksSettings, XTweet } from "./types";
import { DEFAULT_SETTINGS, XBookmarksSettingTab } from "./settings";
import { XApiClient } from "./x-api";
import { ObsidianSync } from "./obsidian-sync";
import { AiTagger } from "./ai-tagger";

export default class XBookmarksPlugin extends Plugin {
  settings!: XBookmarksSettings;
  private isSyncing = false;
  private autoSyncIntervalId: number | null = null;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new XBookmarksSettingTab(this.app, this));

    // Register custom icon: bookmark outline with X inside
    addIcon("x-bookmark", `
      <path fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"
        d="M78 92 L50 72 L22 92 L22 14 C22 10 25 7 29 7 L71 7 C75 7 78 10 78 14 Z"/>
      <line x1="37" y1="27" x2="63" y2="53" stroke="currentColor" stroke-width="7" stroke-linecap="round"/>
      <line x1="63" y1="27" x2="37" y2="53" stroke="currentColor" stroke-width="7" stroke-linecap="round"/>
    `);

    // Ribbon icon
    this.addRibbonIcon("x-bookmark", "Sync X bookmarks", () => {
      void this.syncBookmarks();
    });

    // Command: sync
    this.addCommand({
      id: "sync",
      name: "Sync bookmarks",
      callback: () => { void this.syncBookmarks(); },
    });

    // Command: tag untagged notes
    this.addCommand({
      id: "tag-untagged",
      name: "Tag untagged X bookmark notes",
      callback: () => this.tagUntaggedNotes(),
    });

    // Command: reorganize existing flat notes into YYYY-MM subfolders
    this.addCommand({
      id: "reorganize-bookmarks-by-date",
      name: "Reorganize bookmarks into date folders",
      callback: () => this.reorganizeBookmarksByDate(),
    });

    // Command: delete current note's bookmark on X
    this.addCommand({
      id: "delete-current-x-bookmark",
      name: "Delete current note's X bookmark",
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        if (!file.path.startsWith(this.settings.bookmarksFolder + "/"))
          return false;
        if (checking) return true;
        void this.deleteBookmarkForFile(file);
        return true;
      },
    });

    // Inject "Delete X Bookmark" button into preview mode of bookmark notes
    this.registerMarkdownPostProcessor((el, ctx) => {
      const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
      if (!(file instanceof TFile)) return;
      if (!file.path.startsWith(this.settings.bookmarksFolder + "/")) return;

      // Button lives in the sentinel div at the bottom of the note
      const actionsDiv = el.querySelector(".xbm-actions");
      if (!actionsDiv) return;

      const cache = this.app.metadataCache.getFileCache(file);
      const tweetId: string | undefined = cache?.frontmatter?.["id"];
      const status: string | undefined = cache?.frontmatter?.["status"];
      if (!tweetId || status === "archived") return;

      const btn = document.createElement("button");
      btn.className = "xbm-delete-btn";
      btn.textContent = "Delete X bookmark";
      btn.style.cssText =
        "margin-top: 8px; font-size: 0.75em; cursor: pointer;" +
        "color: var(--text-muted); background: none;" +
        "border: 1px solid var(--text-muted); border-radius: 4px; padding: 2px 8px;";
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        void this.deleteBookmarkForFile(file);
      });
      actionsDiv.appendChild(btn);
    });

    if (this.settings.autoSyncEnabled) {
      this.startAutoSync();
    }

    // Auto-switch to reading view when opening a bookmark note
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (!file) return;
        if (!file.path.startsWith(this.settings.bookmarksFolder + "/")) return;
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (view && view.getMode() !== "preview") {
          void view.setState({ ...view.getState(), mode: "preview" }, { history: false });
        }
      })
    );

    // Set file explorer sort to newest-first (Z→A by date-prefixed filename)
    this.app.workspace.onLayoutReady(() => {
      const workspace = this.app.workspace as unknown as {
        getLeavesOfType: (type: string) => Array<{ view: { setSortOrder?: (order: string) => void } }>;
      };
      const fe = workspace.getLeavesOfType("file-explorer")[0]?.view;
      if (fe?.setSortOrder) fe.setSortOrder("alphabeticalReverse");
    });

    // Migrate old notes that are missing the delete-button sentinel div
    this.app.workspace.onLayoutReady(() => this.migrateOldNotes());
  }

  onunload() {
    this.stopAutoSync();
  }

  async loadSettings() {
    const loaded = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);
    if (!Array.isArray(this.settings.syncedTweetIds)) {
      this.settings.syncedTweetIds = [];
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  restartAutoSync() {
    this.stopAutoSync();
    if (this.settings.autoSyncEnabled) {
      this.startAutoSync();
    }
  }

  private startAutoSync() {
    const ms = this.settings.autoSyncIntervalMinutes * 60 * 1000;
    this.autoSyncIntervalId = this.registerInterval(
      window.setInterval(() => { void this.syncBookmarks(); }, ms)
    );
  }

  private stopAutoSync() {
    if (this.autoSyncIntervalId !== null) {
      window.clearInterval(this.autoSyncIntervalId);
      this.autoSyncIntervalId = null;
    }
  }

  async syncBookmarks() {
    if (this.isSyncing) {
      new Notice("Sync already in progress.");
      return;
    }

    if (!this.settings.authToken || !this.settings.ct0) {
      new Notice("Please configure your auth_token and ct0 in settings first.");
      return;
    }

    this.isSyncing = true;
    const notice = new Notice("Syncing bookmarks…", 0);
    const api = new XApiClient(this.settings);
    const sync = new ObsidianSync(this.app, this.settings);
    const tagger = new AiTagger(this.settings);
    let totalNew = 0;
    const limit = this.settings.syncLimit > 0 ? this.settings.syncLimit : Infinity;

    try {
      // ── Phase 1: check for NEW bookmarks at the top ──────────────────
      // Start from the beginning (no cursor) and stop as soon as we hit
      // a tweet we've already synced — those are all "new since last sync".
      let phase1StopCursor: string | undefined = undefined;
      {
        let cursor: string | undefined = undefined;
        let caughtUp = false;

        while (!caughtUp && totalNew < limit) {
          const { tweets, nextCursor } = await api.fetchBookmarksPage(cursor);
          if (tweets.length === 0) { caughtUp = true; break; }

          for (const tweet of tweets) {
            if (sync.isSynced(tweet.id)) { caughtUp = true; break; }
            if (totalNew >= limit) break;
            await this.importTweet(tweet, api, sync, tagger);
            totalNew++;
          }

          if (!nextCursor) { caughtUp = true; break; }
          phase1StopCursor = nextCursor;
          cursor = nextCursor;
          await sleep(500);
        }
      }

      // ── Phase 2: continue from saved cursor for OLDER bookmarks ──────
      // Pick up where the last older-batch import left off.
      // If no saved cursor yet, seamlessly continue from where phase 1 stopped.
      if (totalNew < limit) {
        const startCursor = this.settings.syncCursor || phase1StopCursor;
        if (startCursor) {
          let cursor: string | undefined = startCursor;

          while (totalNew < limit) {
            const { tweets, nextCursor } = await api.fetchBookmarksPage(cursor);
            if (tweets.length === 0) break;

            for (const tweet of tweets) {
              if (totalNew >= limit) break;
              if (sync.isSynced(tweet.id)) continue; // already have it, skip
              await this.importTweet(tweet, api, sync, tagger);
              totalNew++;
            }

            if (!nextCursor) break;
            this.settings.syncCursor = nextCursor; // save progress after each page
            cursor = nextCursor;
            await sleep(500);
          }
        }
      }

      await this.saveSettings();
      notice.hide();
      new Notice(
        totalNew > 0
          ? `Sync complete — ${totalNew} new bookmark${totalNew === 1 ? "" : "s"} imported.`
          : "Sync complete — no new bookmarks."
      );
    } catch (e) {
      notice.hide();
      new Notice(`Sync failed: ${(e as Error).message}`);
      console.error("[X-Bookmarks]", e);
    } finally {
      this.isSyncing = false;
    }
  }

  private async importTweet(
    tweet: XTweet,
    api: XApiClient,
    sync: ObsidianSync,
    tagger: AiTagger
  ): Promise<void> {
    if (/x\.com\/i\/article\//.test(tweet.text ?? "")) {
      try {
        tweet.articleContent = await api.fetchArticleContent(tweet.id) ?? undefined;
      } catch { /* non-fatal */ }
    }
    let tags: string[] = [];
    try { tags = await tagger.tagTweet(tweet); } catch { /* non-fatal */ }
    await sync.createNote(tweet, tags);
    sync.markSynced(tweet.id);
  }

  async tagUntaggedNotes() {
    if (this.isSyncing) {
      new Notice("Sync in progress — try again after it finishes.");
      return;
    }
    if (!this.settings.aiTaggingEnabled || !this.settings.llmModelName) {
      new Notice("Enable AI tagging and set a model name in settings first.");
      return;
    }

    const tagger = new AiTagger(this.settings);
    const files = this.app.vault.getFiles().filter(
      (f) => f.path.startsWith(this.settings.bookmarksFolder + "/") && f.extension === "md"
    );

    const untagged = files.filter((f) => {
      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
      if (!fm) return false;
      const tags = fm.tags;
      return !tags || (Array.isArray(tags) && tags.length === 0);
    });

    if (untagged.length === 0) {
      new Notice("No untagged notes found.");
      return;
    }

    const notice = new Notice(`Tagging ${untagged.length} notes…`, 0);
    let done = 0;

    for (const file of untagged) {
      try {
        const content = await this.app.vault.read(file);
        const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
        const author = (fm?.author ?? "@unknown").replace("@", "");
        // Extract body text: everything after the closing --- of frontmatter
        const bodyMatch = content.match(/^---[\s\S]*?---\s*([\s\S]*)$/);
        const bodyText = bodyMatch ? bodyMatch[1].trim().slice(0, 500) : "";

        const tags = await tagger.tagText(bodyText, author);
        if (tags.length > 0) {
          await this.app.fileManager.processFrontMatter(file, (fm) => {
            fm.tags = tags;
          });
        }
        done++;
        notice.setMessage(`Tagging notes… ${done}/${untagged.length}`);
      } catch {
        // skip failures silently
      }
    }

    notice.hide();
    new Notice(`Tagged ${done} note${done === 1 ? "" : "s"}.`);
  }

  private async migrateOldNotes() {
    const files = this.app.vault.getFiles().filter(
      (f) => f.path.startsWith(this.settings.bookmarksFolder + "/") && f.extension === "md"
    );
    for (const file of files) {
      const content = await this.app.vault.read(file);
      if (!content.includes("xbm-actions")) {
        await this.app.vault.modify(file, content.trimEnd() + '\n<div class="xbm-actions"></div>\n');
      }
    }
  }

  async reorganizeBookmarksByDate() {
    const sync = new ObsidianSync(this.app, this.settings);
    const bookmarksRoot = normalizePath(this.settings.bookmarksFolder);

    // Only direct children of bookmarksFolder (skip already-subfolder'd files)
    const files = this.app.vault.getFiles().filter(
      (f) =>
        f.extension === "md" &&
        normalizePath(f.parent?.path ?? "") === bookmarksRoot
    );

    if (files.length === 0) {
      new Notice("No flat notes to reorganize.");
      return;
    }

    const notice = new Notice(`Reorganizing ${files.length} notes…`, 0);
    let moved = 0;
    let skipped = 0;

    for (const file of files) {
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      const tweetDate: string | undefined = fm?.tweet_date;
      if (!tweetDate) { skipped++; continue; }

      // tweet_date is YYYY-MM-DD (string or Obsidian date object)
      const dateStr = typeof tweetDate === "string" ? tweetDate : String(tweetDate);
      const month = dateStr.slice(0, 7); // "YYYY-MM"
      if (!/^\d{4}-\d{2}$/.test(month)) { skipped++; continue; }

      const monthFolder = normalizePath(`${bookmarksRoot}/${month}`);
      await sync.ensureFolder(monthFolder);
      const newPath = normalizePath(`${monthFolder}/${file.name}`);

      try {
        await this.app.vault.rename(file, newPath);
        moved++;
      } catch {
        skipped++;
      }
    }

    notice.hide();
    new Notice(
      `Reorganized ${moved} note${moved === 1 ? "" : "s"}` +
        (skipped > 0 ? ` (${skipped} skipped)` : "") +
        "."
    );
  }

  async deleteBookmarkForFile(file: TFile) {
    const cache = this.app.metadataCache.getFileCache(file);
    const tweetId: string | undefined = cache?.frontmatter?.["id"];

    if (!tweetId) {
      new Notice("Could not find tweet ID in this note's frontmatter.");
      return;
    }

    if (!this.settings.authToken || !this.settings.ct0) {
      new Notice("Please configure your auth_token and ct0 in settings first.");
      return;
    }

    const notice = new Notice(`Deleting bookmark ${tweetId}…`, 0);
    const api = new XApiClient(this.settings);
    const sync = new ObsidianSync(this.app, this.settings);

    try {
      await api.deleteBookmark(tweetId);
      await sync.archiveNote(file);

      this.settings.syncedTweetIds = this.settings.syncedTweetIds.filter(
        (id) => id !== tweetId
      );
      await this.saveSettings();

      notice.hide();
      new Notice("Bookmark deleted and note archived.");
    } catch (e) {
      notice.hide();
      new Notice(`Delete failed: ${(e as Error).message}`);
      console.error("[X-Bookmarks]", e);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
