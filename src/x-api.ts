import { requestUrl } from "obsidian";
import type {
  XBookmarksSettings,
  XBookmarksResponse,
  XTweetResult,
  XTweet,
  XTimelineEntry,
  XArticleContent,
  XTweetByIdResponse,
} from "./types";
import { X_BEARER_TOKEN } from "./settings";

const X_GRAPHQL_BASE = "https://x.com/i/api/graphql";

// Feature flags required by X's Bookmarks endpoint.
// These rarely change — if the API returns 400 errors, capture a fresh
// Bookmarks request from browser DevTools to get the updated set.
// Captured from a live Bookmarks request (March 2026).
// Update by copying the `features` query param from a fresh DevTools capture.
const BOOKMARKS_FEATURES = {
  rweb_video_screen_enabled: false,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  responsive_web_profile_redirect_enabled: false,
  rweb_tipjar_consumption_enabled: false,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  premium_content_api_read_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: true,
  responsive_web_jetfuel_frame: true,
  responsive_web_grok_share_attachment_enabled: true,
  responsive_web_grok_annotations_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  content_disclosure_indicator_enabled: true,
  content_disclosure_ai_generated_indicator_enabled: true,
  responsive_web_grok_show_grok_translated_post: false,
  responsive_web_grok_analysis_button_from_backend: true,
  post_ctas_fetch_enabled: true,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: false,
  responsive_web_grok_image_annotation_enabled: true,
  responsive_web_grok_imagine_annotation_enabled: true,
  responsive_web_grok_community_note_auto_translation_is_enabled: false,
  responsive_web_enhance_cards_enabled: false,
};

// Feature flags for the TweetResultByRestId endpoint (used for article content).
// Different from BOOKMARKS_FEATURES — captured from a live article request (March 2026).
const TWEET_BY_ID_FEATURES = {
  creator_subscriptions_tweet_preview_api_enabled: true,
  premium_content_api_read_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: true,
  responsive_web_jetfuel_frame: true,
  responsive_web_grok_share_attachment_enabled: true,
  responsive_web_grok_annotations_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  content_disclosure_indicator_enabled: true,
  content_disclosure_ai_generated_indicator_enabled: true,
  responsive_web_grok_show_grok_translated_post: false,
  responsive_web_grok_analysis_button_from_backend: true,
  post_ctas_fetch_enabled: true,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: false,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  responsive_web_profile_redirect_enabled: false,
  rweb_tipjar_consumption_enabled: false,
  verified_phone_label_enabled: false,
  responsive_web_grok_image_annotation_enabled: true,
  responsive_web_grok_imagine_annotation_enabled: true,
  responsive_web_grok_community_note_auto_translation_is_enabled: false,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_enhance_cards_enabled: false,
};

export class XApiClient {
  private settings: XBookmarksSettings;

  constructor(settings: XBookmarksSettings) {
    this.settings = settings;
  }

  private buildHeaders(): Record<string, string> {
    return {
      authorization: `Bearer ${X_BEARER_TOKEN}`,
      "x-csrf-token": this.settings.ct0,
      cookie: `auth_token=${this.settings.authToken}; ct0=${this.settings.ct0}`,
      "content-type": "application/json",
      "x-twitter-auth-type": "OAuth2Session",
      "x-twitter-client-language": "en",
      "x-twitter-active-user": "yes",
      referer: "https://x.com/i/bookmarks",
    };
  }

  async fetchBookmarksPage(cursor?: string): Promise<{
    tweets: XTweet[];
    nextCursor: string | null;
  }> {
    const variables: Record<string, unknown> = {
      count: 20,
      includePromotedContent: false,
    };
    if (cursor) {
      variables.cursor = cursor;
    }

    const params = new URLSearchParams({
      variables: JSON.stringify(variables),
      features: JSON.stringify(BOOKMARKS_FEATURES),
    });

    const url = `${X_GRAPHQL_BASE}/${this.settings.bookmarksQueryId}/Bookmarks?${params.toString()}`;

    const response = await requestUrl({
      url,
      method: "GET",
      headers: this.buildHeaders(),
      throw: false,
    });

    if (response.status === 401 || response.status === 403) {
      throw new Error(
        "X API authentication failed. Check your auth_token and ct0 in settings."
      );
    }
    if (response.status !== 200) {
      const body = response.text;
      throw new Error(
        `X API returned status ${response.status}. ${body.slice(0, 200)}`
      );
    }

    const body = response.json as XBookmarksResponse;

    if (body.errors && body.errors.length > 0) {
      const msg = body.errors[0]?.message ?? "Unknown error";
      throw new Error(
        `X API error: ${msg}. If this started suddenly, the Bookmarks queryId may need updating in settings.`
      );
    }

    return this.parseBookmarksResponse(body);
  }

  private parseBookmarksResponse(body: XBookmarksResponse): {
    tweets: XTweet[];
    nextCursor: string | null;
  } {
    const instructions =
      body?.data?.bookmark_timeline_v2?.timeline?.instructions ?? [];

    const tweets: XTweet[] = [];
    let nextCursor: string | null = null;

    for (const instruction of instructions) {
      if (instruction.type !== "TimelineAddEntries") continue;

      for (const entry of instruction.entries ?? []) {
        if (this.isCursorEntry(entry)) {
          if (entry.content.cursorType === "Bottom") {
            nextCursor = entry.content.value ?? null;
          }
          continue;
        }

        const tweetResult = entry.content.itemContent?.tweet_results?.result;
        if (!tweetResult) continue;

        const tweet = this.parseTweetResult(tweetResult);
        if (tweet) tweets.push(tweet);
      }
    }

    return { tweets, nextCursor };
  }

  private isCursorEntry(entry: XTimelineEntry): boolean {
    return entry.content.entryType === "TimelineTimelineCursor";
  }

  private parseTweetResult(result: XTweetResult): XTweet | null {
    // Handle TweetWithVisibilityResults wrapper
    const actual: XTweetResult =
      result.__typename === "TweetWithVisibilityResults" && result.tweet
        ? result.tweet
        : result;

    if (!actual.legacy || !actual.core || !actual.rest_id) {
      if (this.settings.debugMode) {
        console.debug("[X-Bookmarks][parse] skipped (missing fields) typename=" + result.__typename + " rest_id=" + (result.rest_id ?? "?"));
      }
      return null;
    }

    const legacy = actual.legacy;
    const userResult = actual.core.user_results.result;
    // X moved name/screen_name from legacy into a nested core object (2025+)
    const userCore = userResult?.core;

    // Collect media: photos/gifs as images, videos as best-bitrate MP4
    const mediaUrls: string[] = [];
    const videoUrls: string[] = [];
    for (const media of legacy.extended_entities?.media ?? []) {
      if (media.type === "photo" || media.type === "animated_gif") {
        mediaUrls.push(media.media_url_https);
      } else if (media.type === "video") {
        const variants = media.video_info?.variants ?? [];
        const best = variants
          .filter((v) => v.content_type === "video/mp4")
          .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
        if (best?.url) videoUrls.push(best.url);
      }
    }

    // Long-form tweets (note tweets) store full text outside legacy.
    // Fall back to a tweet URL so tweets with no text still get imported
    // and marked synced — avoids infinite re-scan loop.
    const fullText =
      actual.note_tweet?.note_tweet_results?.result?.text ??
      legacy.full_text ??
      `https://x.com/i/web/status/${actual.rest_id}`;

    // Expand t.co short URLs in tweet text
    let text: string = fullText;
    for (const urlEntity of legacy.entities?.urls ?? []) {
      if (urlEntity.url && urlEntity.expanded_url) {
        text = text.replace(urlEntity.url, urlEntity.expanded_url);
      }
    }
    // Strip trailing t.co media links X appends, but only if other text remains
    const stripped = text.replace(/https:\/\/t\.co\/\w+\s*$/g, "").trim();
    text = stripped.length > 0 ? stripped : text.trim();

    // Parse quoted tweet (one level only to avoid recursion)
    let quotedTweet: XTweet | undefined;
    if (actual.quoted_status_result?.result) {
      quotedTweet =
        this.parseTweetResult(actual.quoted_status_result.result) ?? undefined;
    }

    return {
      id: actual.rest_id,
      text,
      author: {
        id: userResult?.rest_id ?? "",
        screenName: userCore?.screen_name,
        name: userCore?.name,
      },
      createdAt: legacy.created_at,
      mediaUrls,
      videoUrls,
      quotedTweet,
    };
  }

  async fetchArticleContent(tweetId: string): Promise<XArticleContent | null> {
    if (!this.settings.articleQueryId) return null;

    const variables = { tweetId, includePromotedContent: true, withBirdwatchNotes: true, withVoice: true, withCommunity: true };
    const fieldToggles = { withArticlePlainText: true, withArticleSummaryText: true, withArticleRichContentState: true };
    const params = new URLSearchParams({
      variables: JSON.stringify(variables),
      features: JSON.stringify(TWEET_BY_ID_FEATURES),
      fieldToggles: JSON.stringify(fieldToggles),
    });

    const url = `${X_GRAPHQL_BASE}/${this.settings.articleQueryId}/TweetResultByRestId?${params.toString()}`;

    const response = await requestUrl({
      url,
      method: "GET",
      headers: this.buildHeaders(),
      throw: false,
    });

    if (this.settings.debugMode) {
      console.debug("[X-Bookmarks][article] status=" + response.status + " body=" + JSON.stringify(response.json).slice(0, 300));
    }
    if (response.status !== 200) return null;

    const body = response.json as XTweetByIdResponse;
    const tweetResult = body?.data?.tweetResult?.result;
    if (!tweetResult) return null;

    const actual: XTweetResult =
      tweetResult.__typename === "TweetWithVisibilityResults" && tweetResult.tweet
        ? tweetResult.tweet
        : tweetResult;

    const articleResult = actual.article?.article_results?.result;
    if (!articleResult) return null;

    // Extract plain text from content blocks (type "unstyled" in X's rich content state)
    const blocks = articleResult.content_state?.blocks ?? [];
    const paragraphs = blocks
      .filter((b) => b.text && b.text.trim().length > 0)
      .map((b) => b.text as string);

    return {
      title: articleResult.title,
      text: paragraphs.length > 0 ? paragraphs.join("\n\n") : articleResult.preview_text,
      coverImageUrl: articleResult.cover_media?.media_info?.original_img_url,
    };
  }

  async deleteBookmark(tweetId: string): Promise<void> {
    const requestBody = {
      variables: { tweet_id: tweetId },
      queryId: this.settings.deleteBookmarkQueryId,
    };
    console.debug("[X-Bookmarks][delete] tweetId=" + tweetId + " queryId=" + this.settings.deleteBookmarkQueryId + " body=" + JSON.stringify(requestBody));

    const response = await requestUrl({
      url: `${X_GRAPHQL_BASE}/${this.settings.deleteBookmarkQueryId}/DeleteBookmark`,
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify(requestBody),
      throw: false,
    });

    console.debug("[X-Bookmarks][delete] status=" + response.status + " body=" + JSON.stringify(response.json).slice(0, 400));

    if (response.status === 401 || response.status === 403) {
      throw new Error(
        "X API authentication failed. Check your auth_token and ct0 in settings."
      );
    }
    if (response.status !== 200) {
      throw new Error(
        `Delete bookmark failed with status ${response.status}`
      );
    }

    const body = response.json;

    // Code 144 on tweet_bookmark_delete means the bookmark was already removed
    // from X (e.g. deleted via x.com directly). Archive the note anyway.
    if (body?.errors?.length > 0) {
      const err = body.errors[0];
      const code = err?.extensions?.code ?? err?.code;
      const path: string = err?.path?.[0] ?? "";
      if (code === 144 && path === "tweet_bookmark_delete") return;
      throw new Error(
        `Unexpected delete response: ${JSON.stringify(body).slice(0, 200)}`
      );
    }

    const result = body?.data?.tweet_bookmark_delete ?? body?.data?.delete_bookmark;
    if (result?.toLowerCase() !== "done") {
      throw new Error(
        `Unexpected delete response: ${JSON.stringify(body).slice(0, 200)}`
      );
    }
  }
}
