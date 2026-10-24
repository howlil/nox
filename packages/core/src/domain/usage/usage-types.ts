/** Provider-reported counters; cached and reasoning tokens are subsets, not additive. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  cacheWriteTokens?: number;
}
