import { requestUrl } from "obsidian";
import type { XBookmarksSettings, XTweet } from "./types";

const SYSTEM_PROMPT = `You are a precise content classifier. Return 2-5 topic tags as a JSON array of strings.

Rules:
- Lowercase only
- Single words preferred; hyphenate only if inseparable (e.g. "machine-learning", "open-source")
- Use the shortest common form: "github" not "github-repos", "security" not "cybersecurity-tools"
- No plurals: "tool" not "tools", "agent" not "agents"
- No meta-tags: never use "tweet", "post", "interesting", "thread", "tip"
- Max 5 tags — pick the most specific ones

Return ONLY the JSON array. Example: ["ai", "claude", "open-source"]`;

const buildPrompt = (text: string, author: string): string =>
  `Tweet by @${author}:\n"${text}"`;

export class AiTagger {
  private settings: XBookmarksSettings;

  constructor(settings: XBookmarksSettings) {
    this.settings = settings;
  }

  async tagTweet(tweet: XTweet): Promise<string[]> {
    const text = tweet.articleContent?.text
      ? `${tweet.articleContent.title ?? ""}\n${tweet.articleContent.text}`.slice(0, 500)
      : tweet.text;
    return this.tagText(text, tweet.author.screenName ?? "unknown");
  }

  async tagText(text: string, author: string): Promise<string[]> {
    if (!this.settings.aiTaggingEnabled || !this.settings.llmModelName) {
      return [];
    }

    try {
      const response = await requestUrl({
        url: `${this.settings.llmApiUrl}/chat/completions`,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.settings.llmModelName,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: buildPrompt(text, author) },
          ],
          temperature: 0.1,
          max_tokens: 80,
        }),
        throw: false,
      });

      if (response.status !== 200) return [];

      const content: string =
        response.json?.choices?.[0]?.message?.content?.trim() ?? "";

      const cleaned = content
        .replace(/^```(?:json)?\n?/, "")
        .replace(/\n?```$/, "")
        .trim();

      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed) && parsed.every((t) => typeof t === "string")) {
        return (parsed as string[]).slice(0, 5);
      }
    } catch (e) {
      console.warn("[XBookmarks] AI tagging error:", e);
    }

    return [];
  }
}
