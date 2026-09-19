/**
 * Music Madras Knowledge Engine (MMKE) - AI Layer Architecture
 * Models the agent roles, prompt engineering pipelines, and retrieval augmented generation (RAG) contexts.
 */

import { SearchResponse } from './search';
import { RecommendationResultItem } from './recommendations';

/**
 * Designated personality roles the AI Assistant can assume during chat context swaps.
 */
export type AIAssistantPersona =
  | 'MUSIC_LIBRARIAN'              // Expert cataloguer, focuses on BWV/opus references, manuscript history, and scores.
  | 'MUSIC_EDUCATOR'               // Patient tutor, explains music theory, counterpoint, modes, and active listening.
  | 'DISCOVERY_ASSISTANT'          // Recommends pieces, maps similar composers, designs listening journeys.
  | 'HISTORICAL_RESEARCH_ASSISTANT' // Investigates Chennai/Madras church music heritage, colonial instrument imports, organ specs.
  | 'RECOMMENDATION_ENGINE_AGENT'; // Translates current playing queues into personalized listening loops.

/**
 * Single message structure in the AI Conversation context.
 */
export interface AIChatMessage {
  id: string;
  role: 'user' | 'model' | 'system';
  content: string;
  timestamp: string; // ISO format
  
  // RAG sources used to generate this answer, proving the AI is not hallucinating.
  referencedEntityIds?: {
    entityId: string;
    entityType: string;
    referenceSnippet: string;
  }[];
}

/**
 * Enriched request structure sent to the LLM agent.
 */
export interface AIAgentRequest {
  conversationId: string;
  persona: AIAssistantPersona;
  currentMessage: string;
  history: AIChatMessage[];
  
  // Interactive UI constraints
  enableSearchGrounding: boolean; // Flags whether the model is allowed to query search() inside MMKE
  preferredTemperature?: number;  // Creativity parameter (e.g., 0.2 for librarian, 0.7 for educator)
}

/**
 * Structured reply compiled by the MMKE AI coordinator.
 */
export interface AIAgentResponse {
  message: AIChatMessage;
  suggestedPrompts?: string[]; // Adaptive quick-reply suggestion chips: e.g. ["Tell me more about the Henry Willis Organ", "Who composed this?"]
  referencedSearchHits?: SearchResponse; // RAG diagnostic payloads if search grounding was triggered
  recommendedMedia?: RecommendationResultItem[]; // Direct video/audio attachments to play inside the UI
}

/**
 * Core interface responsible for orchestrating LLM calls, systemic prompt templates, and local data hydration.
 */
export interface IMMKEAiCoordinator {
  /**
   * Primary streaming or non-streaming chat completion controller.
   */
  processChatSession(request: AIAgentRequest): Promise<AIAgentResponse>;

  /**
   * Generates a structural metadata blueprint for an uncatalogued YouTube video.
   * e.g., using Gemini multimodal models to watch/listen to a performance and identify composer, work, and organ specs.
   */
  analyzePerformanceMedia(videoUrl: string): Promise<{
    composerGuess: string;
    workGuess: string;
    instrumentDetected: string;
    confidenceScore: number;
    suggestedTags: string[];
  }>;

  /**
   * Synthesizes custom, voice-acted or text-based listening guides for a user queue.
   */
  synthesizeGuideTranscript(workId: string, listenerLevel: 'NOVICE' | 'EXPERT'): Promise<string>;
}
