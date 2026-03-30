export interface XBookmarksSettings {
  authToken: string;
  ct0: string;
  debugMode: boolean;
  syncLimit: number;
  bookmarksFolder: string;
  archiveFolder: string;
  llmApiUrl: string;
  llmModelName: string;
  autoSyncEnabled: boolean;
  autoSyncIntervalMinutes: number;
  aiTaggingEnabled: boolean;
  bookmarksQueryId: string;
  deleteBookmarkQueryId: string;
  articleQueryId: string;
  syncedTweetIds: string[];
  syncCursor: string;
}

export interface XTweet {
  id: string;
  text: string;
  author: XUser;
  createdAt: string;
  mediaUrls: string[];
  videoUrls: string[];
  articleContent?: XArticleContent;
  quotedTweet?: XTweet;
}

export interface XArticleContent {
  title?: string;
  text?: string;
  coverImageUrl?: string;
}

export interface XUser {
  id: string;
  screenName?: string;
  name?: string;
}

// --- Raw X API response types ---

export interface XBookmarksResponse {
  data?: {
    bookmark_timeline_v2?: {
      timeline?: {
        instructions?: XTimelineInstruction[];
      };
    };
  };
  errors?: Array<{ message: string; code: number }>;
}

export interface XTimelineInstruction {
  type: string;
  entries?: XTimelineEntry[];
}

export interface XTimelineEntry {
  entryId: string;
  sortIndex: string;
  content: {
    entryType: string;
    itemContent?: {
      itemType: string;
      tweet_results?: {
        result: XTweetResult;
      };
    };
    value?: string;
    cursorType?: string;
  };
}

export interface XTweetResult {
  __typename: string;
  rest_id?: string;
  tweet?: XTweetResult; // TweetWithVisibilityResults wrapper
  core?: {
    user_results: {
      result?: {
        __typename?: string;
        rest_id?: string;
        core?: {
          name?: string;
          screen_name?: string;
        };
        legacy?: Record<string, unknown>;
      };
    };
  };
  // Long-form tweets store full text here; legacy.full_text is truncated at 280 chars
  note_tweet?: {
    note_tweet_results?: {
      result?: {
        text?: string;
      };
    };
  };
  // X Articles
  article?: {
    article_results?: {
      result?: {
        title?: string;
        preview_text?: string;
        cover_media?: {
          media_info?: {
            original_img_url?: string;
          };
        };
        content_state?: {
          // Rich content blocks; type is "unstyled" for plain paragraphs
          blocks?: Array<{
            type?: string;
            text?: string;
          }>;
        };
      };
    };
  };
  legacy?: {
    full_text: string;
    created_at: string;
    extended_entities?: {
      media?: Array<{
        media_url_https: string;
        type: string;
        video_info?: {
          variants?: Array<{
            content_type: string;
            url: string;
            bitrate?: number;
          }>;
        };
      }>;
    };
    entities?: {
      urls?: Array<{ url: string; expanded_url: string; display_url: string }>;
      hashtags?: Array<{ text: string }>;
    };
  };
  quoted_status_result?: {
    result: XTweetResult;
  };
}

// Response shape for TweetResultByRestId
export interface XTweetByIdResponse {
  data?: {
    tweetResult?: {
      result?: XTweetResult;
    };
  };
  errors?: Array<{ message: string; code: number }>;
}
