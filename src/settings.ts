import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import type XBookmarksPlugin from "./main";
import type { XBookmarksSettings } from "./types";

// X's app-level bearer token — identical for every user of x.com.
// It's embedded in X's public JavaScript bundle and is not a personal credential.
// Update only if you see persistent 401 errors with a fresh auth_token + ct0.
export const X_BEARER_TOKEN =
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

// GraphQL queryIds as of March 2026.
// These change when X redeploys their frontend. If syncing breaks with a 400
// error, open x.com/i/bookmarks in DevTools → Network → filter "Bookmarks"
// → copy the path segment between /graphql/ and /Bookmarks in the request URL.
const DEFAULT_BOOKMARKS_QUERY_ID = "Z9GWmP0kP2dajyckAaDUBw";
const DEFAULT_DELETE_QUERY_ID = "Wlmlj2-xzyS1GN3a6cj-mQ";
const DEFAULT_ARTICLE_QUERY_ID = "sBoAB5nqJTOyR9sZ5qVLsw";

export const DEFAULT_SETTINGS: XBookmarksSettings = {
  authToken: "",
  ct0: "",
  debugMode: false,
  syncLimit: 20,
  bookmarksFolder: "X-Bookmarks",
  archiveFolder: "X-Bookmarks/Archive",
  llmApiUrl: "http://localhost:1234/v1",
  llmModelName: "",
  autoSyncEnabled: false,
  autoSyncIntervalMinutes: 30,
  aiTaggingEnabled: false,
  bookmarksQueryId: DEFAULT_BOOKMARKS_QUERY_ID,
  deleteBookmarkQueryId: DEFAULT_DELETE_QUERY_ID,
  articleQueryId: DEFAULT_ARTICLE_QUERY_ID,
  syncedTweetIds: [],
  syncCursor: "",
};

export class XBookmarksSettingTab extends PluginSettingTab {
  plugin: XBookmarksPlugin;

  constructor(app: App, plugin: XBookmarksPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // ── Authentication ──────────────────────────────────────────────────
    new Setting(containerEl).setName("X authentication").setHeading();
    containerEl.createEl("p", {
      text: "Open x.com in Chrome/Firefox → DevTools (F12) → Application → Cookies → https://x.com — copy the two values below.",
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName("Auth token")
      .setDesc("Your X session cookie (auth_token). Treat this like a password — keep it private.")
      .addText((text) =>
        text
          .setPlaceholder("Paste cookie value")
          .setValue(this.plugin.settings.authToken)
          .onChange(async (value) => {
            this.plugin.settings.authToken = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("CSRF token")
      .setDesc("Your X CSRF token cookie (ct0).")
      .addText((text) =>
        text
          .setPlaceholder("Paste cookie value")
          .setValue(this.plugin.settings.ct0)
          .onChange(async (value) => {
            this.plugin.settings.ct0 = value.trim();
            await this.plugin.saveSettings();
          })
      );

    // ── Vault Folders ───────────────────────────────────────────────────
    new Setting(containerEl).setName("Vault folders").setHeading();

    new Setting(containerEl)
      .setName("Bookmarks folder")
      .setDesc("Vault folder where bookmark notes will be created.")
      .addText((text) =>
        text
          .setPlaceholder("X-Bookmarks")
          .setValue(this.plugin.settings.bookmarksFolder)
          .onChange(async (value) => {
            this.plugin.settings.bookmarksFolder = value.trim() || "X-Bookmarks";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Archive folder")
      .setDesc("Vault folder where notes are moved when you delete a bookmark on X.")
      .addText((text) =>
        text
          .setPlaceholder("X-Bookmarks/archive")
          .setValue(this.plugin.settings.archiveFolder)
          .onChange(async (value) => {
            this.plugin.settings.archiveFolder =
              value.trim() || "X-Bookmarks/Archive";
            await this.plugin.saveSettings();
          })
      );

    // ── Auto-Sync ───────────────────────────────────────────────────────
    new Setting(containerEl).setName("Auto-sync").setHeading();

    new Setting(containerEl)
      .setName("Enable auto-sync")
      .setDesc("Automatically sync bookmarks on a schedule.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoSyncEnabled)
          .onChange(async (value) => {
            this.plugin.settings.autoSyncEnabled = value;
            await this.plugin.saveSettings();
            this.plugin.restartAutoSync();
          })
      );

    new Setting(containerEl)
      .setName("Sync interval (minutes)")
      .setDesc("How often to automatically check for new bookmarks.")
      .addText((text) =>
        text
          .setPlaceholder("30")
          .setValue(String(this.plugin.settings.autoSyncIntervalMinutes))
          .onChange(async (value) => {
            const num = parseInt(value, 10);
            if (!isNaN(num) && num >= 1) {
              this.plugin.settings.autoSyncIntervalMinutes = num;
              await this.plugin.saveSettings();
              this.plugin.restartAutoSync();
            }
          })
      );

    new Setting(containerEl)
      .setName("Max bookmarks per sync")
      .setDesc("Stop after syncing this many new bookmarks. Set to 0 for unlimited (syncs everything).")
      .addText((text) =>
        text
          .setPlaceholder("20")
          .setValue(String(this.plugin.settings.syncLimit))
          .onChange(async (value) => {
            const num = parseInt(value, 10);
            if (!isNaN(num) && num >= 0) {
              this.plugin.settings.syncLimit = num;
              await this.plugin.saveSettings();
            }
          })
      );

    // ── AI Tagging ──────────────────────────────────────────────────────
    new Setting(containerEl).setName("AI tagging").setHeading();
    containerEl.createEl("p", {
      text: "Uses a local LLM via LM Studio (port 1234) or llama.cpp (port 8080). Tip: do your first sync without AI tagging enabled — it can be slow for large imports.",
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName("Enable AI tagging")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.aiTaggingEnabled)
          .onChange(async (value) => {
            this.plugin.settings.aiTaggingEnabled = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("LLM API URL")
      .setDesc("OpenAI-compatible API base URL.")
      .addText((text) =>
        text
          .setPlaceholder("http://localhost:1234/v1")
          .setValue(this.plugin.settings.llmApiUrl)
          .onChange(async (value) => {
            this.plugin.settings.llmApiUrl = value.trim().replace(/\/$/, "");
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Model name")
      .setDesc("Exact model identifier shown in LM Studio or passed to llama.cpp at startup.")
      .addText((text) =>
        text
          .setPlaceholder("Enter model name")
          .setValue(this.plugin.settings.llmModelName)
          .onChange(async (value) => {
            this.plugin.settings.llmModelName = value.trim();
            await this.plugin.saveSettings();
          })
      );

    // ── Advanced ────────────────────────────────────────────────────────
    new Setting(containerEl).setName("Advanced").setHeading();

    new Setting(containerEl)
      .setName("Debug mode")
      .setDesc("Log raw tweet data to the developer console (Cmd+Opt+I). Useful for diagnosing parse issues.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.debugMode)
          .onChange(async (value) => {
            this.plugin.settings.debugMode = value;
            await this.plugin.saveSettings();
          })
      );
    containerEl.createEl("p", {
      text: "Only touch these if syncing breaks. X rotates these query IDs when they redeploy their frontend.",
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName("Bookmarks query ID")
      .setDesc("Find it: DevTools → Network → x.com/i/bookmarks → filter 'Bookmarks' → copy path segment after /graphql/")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.bookmarksQueryId)
          .onChange(async (value) => {
            this.plugin.settings.bookmarksQueryId = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Delete bookmark query ID")
      .setDesc("Find it: trigger a bookmark delete on x.com → Network → filter 'DeleteBookmark' → copy path segment after /graphql/")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.deleteBookmarkQueryId)
          .onChange(async (value) => {
            this.plugin.settings.deleteBookmarkQueryId = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Article query ID")
      .setDesc("Used to fetch full X Article content. Find it: open an article on x.com → Network → filter 'TweetResultByRestId' → copy path segment after /graphql/")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.articleQueryId)
          .onChange(async (value) => {
            this.plugin.settings.articleQueryId = value.trim();
            await this.plugin.saveSettings();
          })
      );

    // ── Data Management ─────────────────────────────────────────────────
    new Setting(containerEl).setName("Data management").setHeading();

    new Setting(containerEl)
      .setName("Reset sync state")
      .setDesc("Clears the synced tweet list. Next sync will re-import all bookmarks from X.")
      .addButton((btn) =>
        btn
          .setButtonText("Reset")
          .setWarning()
          .onClick(async () => {
            this.plugin.settings.syncedTweetIds = [];
            this.plugin.settings.syncCursor = "";
            await this.plugin.saveSettings();
            new Notice("Sync state reset. Next sync will re-import all bookmarks.");
          })
      );
  }
}
